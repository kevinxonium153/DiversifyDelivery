#!/usr/bin/env bash
# Restaura un respaldo hecho por backup.sh. Antes guarda una copia de los datos actuales.
#
#   bash /opt/diversify-delivery/deploy/restore.sh /var/backups/diversify-delivery/diversify-20261103-023000.tar.gz [--con-config]
#
#   --con-config  restaura también /etc/diversify-delivery (contraseñas iniciales, redes, dominio). Por defecto solo datos.
set -euo pipefail

die() { echo "ERROR: $*" >&2; exit 1; }
[[ $EUID -eq 0 ]] || die "Ejecuta como root."
FILE="${1:-}"
[[ -f "$FILE" ]] || die "Uso: restore.sh respaldo.tar.gz [--con-config]"
WITH_CONFIG=0
[[ "${2:-}" == "--con-config" ]] && WITH_CONFIG=1
DATA=/var/lib/diversify-delivery/data

WORK="$(mktemp -d)"
trap 'rm -rf -- "$WORK"' EXIT
tar --no-same-owner -C "$WORK" -xzf "$FILE"
[[ -d "$WORK/data" ]] || die "El archivo no parece un respaldo de Diversify Delivery."
while IFS= read -r -d '' db; do
  [[ "$(sqlite3 "$db" 'PRAGMA integrity_check;')" == "ok" ]] || die "La base ${db#"$WORK"/} del respaldo está dañada."
done < <(find "$WORK/data" -name '*.db' -type f -print0)

echo "Se reemplazarán TODOS los datos actuales por los del respaldo $(basename "$FILE")."
read -r -p "Escribe RESTAURAR para continuar: " answer
[[ "$answer" == "RESTAURAR" ]] || die "Cancelado."

echo "==> Deteniendo Diversify Delivery"
systemctl stop diversify-delivery

SAFETY="/var/backups/diversify-delivery/antes-de-restaurar-$(date +%Y%m%d-%H%M%S).tar.gz"
echo "==> Copia de seguridad de los datos actuales: $SAFETY"
tar -C "$DATA" -czf "$SAFETY" .
chmod 600 "$SAFETY"

echo "==> Restaurando datos"
find "$DATA" -mindepth 1 -delete
cp -a "$WORK/data/." "$DATA/"
chown -R diversify-delivery:diversify-delivery "$DATA"
chmod -R u=rwX,go= "$DATA"

if [[ $WITH_CONFIG -eq 1 && -d "$WORK/etc" ]]; then
  echo "==> Restaurando configuración"
  find "$WORK/etc" -maxdepth 1 -type f ! -name Caddyfile -exec cp {} /etc/diversify-delivery/ \;
  chown root:diversify /etc/diversify-delivery/*
  chmod 640 /etc/diversify-delivery/*
fi

systemctl start diversify-delivery
echo "==> Listo. Revisa https://<tu-dominio>/ y 'journalctl -u diversify-delivery -n 50'."
