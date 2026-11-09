#!/usr/bin/env bash
# Publica en el servidor el código que tienes en esta computadora, con un solo comando.
# Se ejecuta en tu Mac o PC de desarrollo (necesita el SDK de .NET 10 y acceso SSH al host de Proxmox).
#
#   ./deploy/publicar.sh                 arma el paquete, lo sube a Proxmox e instala la versión nueva
#
# Ramas: desde "master" se publica en PRODUCCIÓN (el contenedor de Delivery). Desde "beta" se publica en el
# contenedor de PRUEBAS (opcional, se configura aparte). Desde cualquier otra rama no se publica.
#   ./deploy/publicar.sh --configurar    cambia el servidor, el contenedor o el usuario guardados
#   ./deploy/publicar.sh --version 1.1.0 nombre de la versión (por defecto: fecha-hora-commit)
#   ./deploy/publicar.sh --sin-github    publica aunque haya cambios que no están en GitHub (no recomendado)
#
# Qué hace en el servidor: copia el paquete al contenedor y corre deploy/update.sh, que respalda los datos,
# instala, revisa que responda y, si no responde, vuelve solo a la versión anterior.
# La primera vez pregunta la IP de Proxmox y el número del contenedor, y los guarda en
# ~/.config/diversify-delivery/publicar.conf (fuera del repositorio). Es independiente del de Diversify POS.
#
# Compatible con el bash 3.2 que trae macOS y con Git Bash en Windows.
set -euo pipefail

die() { echo "ERROR: $*" >&2; exit 1; }
ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
CONF="${XDG_CONFIG_HOME:-$HOME/.config}/diversify-delivery/publicar.conf"

SERVIDOR="" CTID="" CTID_BETA="" USUARIO="root"
# shellcheck source=/dev/null
[[ -f "$CONF" ]] && . "$CONF"

CONFIGURAR=0 VERSION="" SIN_GITHUB=0
while [[ $# -gt 0 ]]; do
  case "$1" in
    --configurar) CONFIGURAR=1; shift ;;
    --version) [[ $# -gt 1 ]] || die "Falta el valor de --version."; VERSION="$2"; shift 2 ;;
    --sin-github) SIN_GITHUB=1; shift ;;
    -h|--help) sed -n '2,15p' "$0"; exit 0 ;;
    *) die "Opción desconocida: $1 (usa --help)" ;;
  esac
done

configurar() {
  echo "Datos del servidor (se guardan en $CONF):"
  read -rp "  IP o nombre del host de Proxmox${SERVIDOR:+ [$SERVIDOR]}: " r; SERVIDOR="${r:-$SERVIDOR}"
  read -rp "  Número (VMID) del contenedor de Diversify Delivery (producción, rama master)${CTID:+ [$CTID]}: " r; CTID="${r:-$CTID}"
  read -rp "  Número (VMID) del contenedor de pruebas (rama beta; vacío si no hay)${CTID_BETA:+ [$CTID_BETA]}: " r; CTID_BETA="${r:-$CTID_BETA}"
  read -rp "  Usuario SSH de Proxmox [${USUARIO}]: " r; USUARIO="${r:-$USUARIO}"
  [[ -n "$SERVIDOR" && "$CTID" =~ ^[0-9]+$ ]] || die "Hace falta la IP del servidor y un número de contenedor válido."
  mkdir -p "$(dirname "$CONF")"
  printf 'SERVIDOR=%q\nCTID=%q\nCTID_BETA=%q\nUSUARIO=%q\n' "$SERVIDOR" "$CTID" "$CTID_BETA" "$USUARIO" > "$CONF"
  chmod 600 "$CONF"
}
if [[ $CONFIGURAR -eq 1 || -z "$SERVIDOR" || -z "$CTID" ]]; then configurar; fi
[[ "$CTID" =~ ^[0-9]+$ ]] || die "El número de contenedor guardado no es válido. Corre: $0 --configurar"

command -v dotnet >/dev/null || die "No encontré .NET. Instala el SDK de .NET 10: https://dotnet.microsoft.com/download/dotnet/10.0"
command -v git >/dev/null || die "No encontré git."

# Lo que se publica debe estar guardado en GitHub: así cualquier versión del servidor se puede reconstruir.
cd "$ROOT"
RAMA="$(git rev-parse --abbrev-ref HEAD)"
case "$RAMA" in
  master) ENTORNO="PRODUCCIÓN" ;;
  beta)
    [[ "$CTID_BETA" =~ ^[0-9]+$ ]] || die "No hay contenedor de pruebas configurado para la rama beta. Corre: $0 --configurar"
    [[ "$CTID_BETA" != "$CTID" ]] || die "El contenedor de pruebas no puede ser el mismo que el de producción."
    CTID="$CTID_BETA"; ENTORNO="PRUEBAS (beta)" ;;
  *) die "Solo se publica desde 'master' (producción) o 'beta' (pruebas). Estás en '$RAMA'." ;;
esac
if [[ $SIN_GITHUB -eq 0 ]]; then
  [[ -z "$(git status --porcelain)" ]] \
    || die "Hay cambios sin guardar (commit). Guárdalos y súbelos a GitHub antes de publicar, o usa --sin-github."
  SIN_SUBIR="$(git rev-list --count '@{u}..HEAD' 2>/dev/null || echo '?')"
  [[ "$SIN_SUBIR" == "0" ]] \
    || die "La rama '$RAMA' tiene cambios que no están en GitHub (Push origin en GitHub Desktop), o usa --sin-github."
fi
# Lo contrario también pasa: GitHub tiene cambios que esta computadora aún no descargó. Se usa lo último que
# GitHub Desktop (o git fetch) trajo; no se descarga nada aquí para no pedir contraseñas de GitHub.
SIN_BAJAR="$(git rev-list --count 'HEAD..@{u}' 2>/dev/null || echo 0)"
[[ "$SIN_BAJAR" == "0" ]] \
  || die "GitHub tiene $SIN_BAJAR cambio(s) en '$RAMA' que esta computadora no tiene. Haz Pull origin en GitHub Desktop y vuelve a publicar."

COMMIT="$(git rev-parse --short HEAD)"
[[ -n "$VERSION" ]] || VERSION="$(date +%Y.%m.%d-%H%M)-${COMMIT}"
[[ "$VERSION" =~ ^[A-Za-z0-9._-]+$ ]] || die "La versión solo puede tener letras, números, punto, guion y guion bajo."
NAME="diversify-delivery-${VERSION}"

echo "==> Publicando $NAME en $ENTORNO (rama $RAMA, commit $COMMIT) en $USUARIO@$SERVIDOR, contenedor $CTID"

# Una sola conexión SSH para todo el proceso: si no tienes llave SSH, la contraseña se pide una sola vez.
SOCKDIR="$(mktemp -d /tmp/diversify-delivery-ssh.XXXXXX)"
SSH_OPTS=(-o ControlMaster=auto -o "ControlPath=$SOCKDIR/c" -o ControlPersist=300 -o ConnectTimeout=15)
COMPARTIDA=1
case "$(uname -s)" in
  # En Windows (Git Bash) el SSH no maneja bien la conexión compartida: cada paso abre la suya (con llave SSH no
  # se pide contraseña).
  MINGW*|MSYS*|CYGWIN*) SSH_OPTS=(-o ConnectTimeout=15); COMPARTIDA=0 ;;
esac
cerrar() { [[ $COMPARTIDA -eq 1 ]] && ssh "${SSH_OPTS[@]}" -O exit "$USUARIO@$SERVIDOR" >/dev/null 2>&1; rm -rf -- "$SOCKDIR"; }
trap cerrar EXIT

echo "==> Revisando el servidor"
ssh "${SSH_OPTS[@]}" -o BatchMode=yes "$USUARIO@$SERVIDOR" true \
  || die "No se pudo entrar por SSH a $USUARIO@$SERVIDOR. Si es una IP 100.x de Tailscale, revisa que Tailscale esté
       activo (Connected) en esta computadora. En la oficina también sirve la IP local: $0 --configurar"
ssh "${SSH_OPTS[@]}" "$USUARIO@$SERVIDOR" "pct status $CTID" | grep -q running \
  || die "El contenedor $CTID no está encendido en $SERVIDOR (enciéndelo en Proxmox o revisa el número con --configurar)."

"$ROOT/deploy/build-release.sh" "$VERSION"
PKG="$ROOT/dist/$NAME.tar.gz"
[[ -f "$PKG" && -f "$PKG.sha256" ]] || die "No se generó el paquete."

echo "==> Subiendo el paquete a Proxmox ($(du -h "$PKG" | cut -f1 | tr -d ' '))"
scp "${SSH_OPTS[@]}" -q "$PKG" "$PKG.sha256" "$USUARIO@$SERVIDOR:/root/"

echo "==> Instalando en el contenedor $CTID (respaldo y vuelta atrás automáticos)"
set +e
ssh "${SSH_OPTS[@]}" "$USUARIO@$SERVIDOR" bash -s -- "$CTID" "$NAME" <<'REMOTO'
set -u
CTID="$1" NAME="$2"
P="/root/$NAME.tar.gz"
pct push "$CTID" "$P" "$P" && pct push "$CTID" "$P.sha256" "$P.sha256" || { echo "No se pudo copiar al contenedor." >&2; exit 1; }
rm -f -- "$P" "$P.sha256"
# Se ejecuta el update.sh del paquete nuevo desde una carpeta temporal: el del servidor puede ser anterior y,
# además, la actualización reemplaza los archivos de /opt/diversify-delivery/deploy mientras corre.
pct exec "$CTID" -- bash -c 'cd "$(dirname "$1")" && sha256sum -c --quiet "$(basename "$1").sha256" || exit 1
  d="$(mktemp -d)"
  if tar --no-same-owner -C "$d" -xzf "$1" --wildcards "*/deploy/update.sh" 2>/dev/null; then
    # Normalizar antes de que bash lea el actualizador, incluso si el paquete viene de Windows.
    sed -i "s/\\r$//" "$d"/*/deploy/update.sh || { rm -rf -- "$d"; exit 1; }
    bash "$d"/*/deploy/update.sh "$1"
  else
    bash /opt/diversify-delivery/deploy/update.sh "$1"
  fi
  rc=$?; rm -rf -- "$d"; exit $rc' _ "$P"
rc=$?
pct exec "$CTID" -- rm -f -- "$P" "$P.sha256"
exit $rc
REMOTO
RC=$?
set -e

# Paquetes locales: se conservan los 3 más recientes.
ls -1t "$ROOT"/dist/diversify-delivery-*.tar.gz 2>/dev/null | tail -n +4 | while read -r viejo; do rm -f -- "$viejo" "$viejo.sha256"; done

if [[ $RC -eq 0 ]]; then
  echo "==> Listo: $NAME publicado y funcionando."
else
  die "La actualización se detuvo (código $RC). Si falló el respaldo, no se instaló la versión nueva. Si falló el arranque, revisa arriba si se confirmó la restauración de la anterior."
fi
