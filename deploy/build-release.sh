#!/usr/bin/env bash
# Arma el paquete para el servidor: dist/diversify-delivery-<versión>.tar.gz
# Contiene la app publicada para Linux x64 (autocontenida: no hace falta instalar .NET en el servidor)
# y la carpeta deploy/ con los scripts de instalación.
#
# Uso (en una máquina con el SDK de .NET 10, Linux o macOS):   ./deploy/build-release.sh [versión]
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
VERSION="${1:-$(git -C "$ROOT" describe --tags --always --dirty 2>/dev/null || date +%Y%m%d%H%M)}"
NAME="diversify-delivery-${VERSION}"
OUT="$ROOT/dist/$NAME"

echo "==> Publicando Diversify Delivery $VERSION (linux-x64, autocontenido)"
rm -rf -- "$OUT"
mkdir -p "$OUT"
dotnet publish "$ROOT/src/Diversify.Delivery/Diversify.Delivery.csproj" -c Release -r linux-x64 --self-contained true \
  -p:DebugType=none -p:GenerateDocumentationFile=false -o "$OUT/app"

# Nunca empaquetar datos ni configuración de desarrollo.
rm -rf -- "$OUT/app/data" "$OUT/app/appsettings.Development.json"

cp -r "$ROOT/deploy" "$OUT/deploy"
rm -rf -- "$OUT/deploy/proxmox/.cache"
# Saltos de línea de Linux (LF) en todo lo que corre en el servidor, aunque la copia local tenga CRLF (Windows).
# Con CRLF bash falla con "set: pipefail: invalid option name" o "\r: command not found".
find "$OUT/deploy" -type f | while IFS= read -r f; do
  if grep -q $'\r' "$f"; then tr -d '\r' < "$f" > "$f.lf" && cat "$f.lf" > "$f" && rm -f -- "$f.lf"; fi
done
echo "$VERSION" > "$OUT/VERSION"

# En macOS: sin archivos "._*" ni metadatos de Apple dentro del paquete.
export COPYFILE_DISABLE=1
# Dueño root (0) dentro del paquete: el usuario de Windows o macOS no existe en el servidor y, en un contenedor
# sin privilegios, extraer con un uid grande (Windows usa 197609) falla con "Cannot change ownership".
if tar --version 2>/dev/null | grep -q bsdtar; then
  TAR_OPTS=(--no-mac-metadata --uid 0 --gid 0)
else
  TAR_OPTS=(--owner=0 --group=0 --numeric-owner)
fi
case "$(uname -s)" in
  MINGW*|MSYS*|CYGWIN*)
    # Windows (Git Bash): NTFS no guarda el permiso de ejecución. Se arma el paquete con la app y los scripts
    # marcados como ejecutables (los servidores con un update.sh anterior lo exigen).
    (cd "$ROOT/dist" && tar "${TAR_OPTS[@]}" --exclude="$NAME/app/Diversify.Delivery" --exclude="$NAME/deploy/*.sh" \
        --exclude="$NAME/deploy/proxmox/*.sh" -cf "$NAME.tar" "$NAME" \
      && tar "${TAR_OPTS[@]}" --mode=755 -rf "$NAME.tar" "$NAME/app/Diversify.Delivery" "$NAME"/deploy/*.sh "$NAME"/deploy/proxmox/*.sh \
      && gzip -f "$NAME.tar")
    ;;
  *) tar ${TAR_OPTS[@]+"${TAR_OPTS[@]}"} -C "$ROOT/dist" -czf "$ROOT/dist/$NAME.tar.gz" "$NAME" ;;
esac
rm -rf -- "$OUT"
# Ruta relativa en el .sha256 para que "sha256sum -c" funcione en el servidor.
# macOS no trae sha256sum; shasum -a 256 da el mismo formato.
if command -v sha256sum >/dev/null; then SHA=(sha256sum); else SHA=(shasum -a 256); fi
(cd "$ROOT/dist" && "${SHA[@]}" "$NAME.tar.gz" | tee "$NAME.tar.gz.sha256")
echo "==> Listo: dist/$NAME.tar.gz"
