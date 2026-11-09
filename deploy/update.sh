#!/usr/bin/env bash
# Actualiza Diversify Delivery a una versión nueva, con respaldo antes y vuelta atrás automática si no arranca.
#
#   bash /opt/diversify-delivery/deploy/update.sh /root/diversify-1.1.0.tar.gz
set -euo pipefail

# Todo va dentro de main y termina con exit en la misma línea: bash lee la función completa antes de ejecutarla,
# así que reemplazar este archivo durante la actualización (al copiar deploy/) no lo corrompe a mitad de camino.
main() {
  die() { echo "ERROR: $*" >&2; exit 1; }
  [[ $EUID -eq 0 ]] || die "Ejecuta como root."
  PACKAGE="${1:-}"
  [[ -f "$PACKAGE" ]] || die "Uso: update.sh diversify-delivery-X.tar.gz"
  if [[ -f "$PACKAGE.sha256" ]]; then
    (cd "$(dirname "$PACKAGE")" && sha256sum -c "$(basename "$PACKAGE").sha256") || die "El paquete no coincide con su .sha256."
  fi

  OPT=/opt/diversify-delivery
  PORT="$(sed -n 's|^ASPNETCORE_URLS=http://127.0.0.1:\([0-9]*\).*|\1|p' /etc/diversify-delivery-delivery/delivery.env)"
  PORT="${PORT:-5090}"
  WORK="$(mktemp -d)"
  trap 'rm -rf -- "$WORK"' EXIT
  tar --no-same-owner -C "$WORK" -xzf "$PACKAGE"
  PKG="$(find "$WORK" -mindepth 1 -maxdepth 1 -type d | head -1)"
  # Un paquete armado en Windows puede venir sin el permiso de ejecución.
  [[ -f "$PKG/app/Diversify.Delivery" ]] && chmod +x "$PKG/app/Diversify.Delivery"
  [[ -x "$PKG/app/Diversify.Delivery" ]] || die "El paquete no contiene la app."
  VERSION="$(cat "$PKG/VERSION" 2>/dev/null || date +%Y%m%d%H%M)"
  PREVIOUS="$(readlink -f "$OPT/current")"
  REL="$OPT/releases/$VERSION"
  [[ "$REL" == "$PREVIOUS" ]] && die "La versión $VERSION ya es la actual."

  # Reparar los scripts extraídos antes de ejecutar el respaldo: un paquete anterior puede traer CRLF.
  # Solo se toca la carpeta temporal; los scripts instalados y la app siguen intactos si el respaldo falla.
  [[ -f "$PKG/deploy/backup.sh" ]] || die "El paquete no contiene el script de respaldo."
  find "$PKG/deploy" -type f -exec sed -i 's/\r$//' {} +

  echo "==> Respaldo antes de actualizar"
  # El backup.sh del paquete nuevo (el instalado puede estar dañado por una actualización anterior incompleta).
  bash "$PKG/deploy/backup.sh"

  echo "==> Instalando $VERSION (anterior: $(basename "$PREVIOUS"))"
  rm -rf -- "$REL"
  cp -a "$PKG/app" "$REL"
  chown -R root:root "$REL"
  chmod -R go-w "$REL"
  cp -a "$PKG/deploy/." "$OPT/deploy/"
  chmod +x "$OPT/deploy/"*.sh
  install -m 0644 "$OPT/deploy/systemd/"*.service "$OPT/deploy/systemd/"*.timer /etc/systemd/system/
  systemctl daemon-reload

  ln -sfn "$REL" "$OPT/current"
  systemctl restart diversify-delivery

  healthy() {
    for _ in $(seq 1 40); do
      curl -fsS "http://127.0.0.1:${PORT}/healthz" >/dev/null 2>&1 && return 0
      sleep 1
    done
    return 1
  }

  if healthy; then
    echo "==> Diversify Delivery $VERSION funcionando"
    # cloudflared viene de un repositorio aparte: las actualizaciones automáticas de Debian no lo cubren.
    if systemctl is-enabled cloudflared-diversify-delivery >/dev/null 2>&1; then
      apt-get update -q >/dev/null && apt-get install -y -q --only-upgrade cloudflared >/dev/null && systemctl restart cloudflared-diversify-delivery
    fi
    # Se conservan las 3 versiones más recientes para poder volver atrás.
    find "$OPT/releases" -mindepth 1 -maxdepth 1 -type d -printf '%T@ %p\n' | sort -rn | tail -n +4 | cut -d' ' -f2- |
      while read -r old; do [[ "$old" != "$REL" && "$old" != "$PREVIOUS" ]] && rm -rf -- "$old"; done
  else
    echo "!!! La versión nueva no respondió: volviendo a $(basename "$PREVIOUS")" >&2
    journalctl -u diversify-delivery -n 30 --no-pager >&2 || true
    ln -sfn "$PREVIOUS" "$OPT/current"
    systemctl restart diversify-delivery
    healthy && echo "Se restauró la versión anterior. Los datos están en el último respaldo de /var/backups/diversify-delivery." >&2
    exit 1
  fi
}

# "exit" en la misma línea: bash ya la leyó antes de que el archivo cambie.
main "$@"; exit $?
