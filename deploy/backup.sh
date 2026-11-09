#!/usr/bin/env bash
# Respaldo en caliente de Diversify Delivery: copia cada base SQLite con la API de respaldo de SQLite (consistente
# aunque haya ventas en curso), revisa que la copia esté sana y guarda todo en un .tar.gz.
# Lo ejecuta el temporizador diario (diversify-delivery-backup.timer); también se puede correr a mano.
#
# Variables opcionales (en /etc/diversify-delivery/backup.env):
#   KEEP_DAYS=30                      días que se conservan los respaldos locales
#   OFFSITE="usuario@nas:/respaldos/diversify-delivery/"   copia fuera del servidor con rsync por SSH
set -euo pipefail

DATA=/var/lib/diversify-delivery/data
DEST=/var/backups/diversify-delivery
KEEP_DAYS=30
OFFSITE=""
# shellcheck disable=SC1091
[[ -f /etc/diversify-delivery/backup.env ]] && source /etc/diversify-delivery/backup.env

mkdir -p "$DEST"
STAMP="$(date +%Y%m%d-%H%M%S)"
WORK="$(mktemp -d "$DEST/.tmp-XXXXXX")"
trap 'rm -rf -- "$WORK"' EXIT
mkdir -p "$WORK/data"

count=0
while IFS= read -r -d '' db; do
  rel="${db#"$DATA"/}"
  mkdir -p "$WORK/data/$(dirname "$rel")"
  sqlite3 "$db" ".timeout 10000" ".backup '$WORK/data/$rel'"
  result="$(sqlite3 "$WORK/data/$rel" "PRAGMA integrity_check;")"
  if [[ "$result" != "ok" ]]; then
    echo "ERROR: la copia de $rel no pasó la revisión de integridad: $result" >&2
    exit 1
  fi
  count=$((count + 1))
done < <(find "$DATA" -name '*.db' -type f -print0)

# Llaves que cifran las sesiones y la configuración (con secretos: el respaldo queda solo para root).
[[ -d "$DATA/keys" ]] && cp -a "$DATA/keys" "$WORK/data/keys"
mkdir -p "$WORK/etc"
cp -a /etc/diversify-delivery/. "$WORK/etc/"
[[ -f /etc/caddy/Caddyfile ]] && cp /etc/caddy/Caddyfile "$WORK/etc/Caddyfile"
readlink -f /opt/diversify-delivery/current > "$WORK/VERSION" 2>/dev/null || true

FILE="$DEST/diversify-delivery-$STAMP.tar.gz"
tar -C "$WORK" -czf "$FILE.part" .
mv "$FILE.part" "$FILE"
chmod 600 "$FILE"
echo "Respaldo listo: $FILE ($count base(s) de datos, $(du -h "$FILE" | cut -f1))"

find "$DEST" -maxdepth 1 -name 'diversify-delivery-*.tar.gz' -mtime +"$KEEP_DAYS" -delete

if [[ -n "$OFFSITE" ]]; then
  rsync -a --chmod=F600 "$FILE" "$OFFSITE" && echo "Copia externa enviada a $OFFSITE"
fi
