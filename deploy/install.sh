#!/usr/bin/env bash
# Instala Diversify Delivery en un Debian 12 limpio (contenedor LXC de Proxmox o VM). Ejecutar como root
# desde la carpeta extraída del paquete:
#
#   Con IP pública (puertos 80/443 abiertos en el router, certificado de Let's Encrypt):
#   bash diversify-delivery-X/deploy/install.sh --dominio delivery.miempresa.hn --correo ti@miempresa.hn [--red-admin 192.168.1.0/24]
#
#   Sin IP pública (Cloudflare Tunnel: sin abrir puertos; el token sale del panel de Cloudflare Zero Trust):
#   bash diversify-delivery-X/deploy/install.sh --dominio delivery.diversify.hn --tunel-cloudflare [--red-admin 192.168.1.0/24]
#
#   --tunel-cloudflare     modo túnel: pide el token sin mostrarlo (no queda en el historial ni en la lista de
#                          procesos). El panel /panel se protege con Cloudflare Access; --red-admin solo limita SSH.
#   --tunel-cloudflare-archivo F  lee el token de un archivo y lo borra (lo usa crear-contenedor.sh).
#
#   --red-admin CIDR       redes que pueden abrir el panel del master (/panel) y SSH (repetible). Sin esto, el
#                          panel queda abierto a internet (protegido por contraseña y límite de intentos).
#                          La tienda y la app de repartidores siempre son públicas.
#   --tls-interno          certificado propio de Caddy (solo red local, sin dominio público). Hay que instalar
#                          su certificado raíz en las computadoras de las cajas.
#   --sin-firewall         no aplicar el cortafuegos interno (solo el de Proxmox).
#
# Se puede volver a ejecutar: no borra datos ni cambia contraseñas ya generadas.
set -euo pipefail

die() { echo "ERROR: $*" >&2; exit 1; }
[[ $EUID -eq 0 ]] || die "Ejecuta como root."
HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PKG="$(cd "$HERE/.." && pwd)"
[[ -f "$PKG/app/Diversify.Delivery" ]] && chmod +x "$PKG/app/Diversify.Delivery"   # paquete armado en Windows
[[ -x "$PKG/app/Diversify.Delivery" ]] || die "No encontré la app en $PKG/app. Ejecuta este script desde el paquete extraído."
VERSION="$(cat "$PKG/VERSION" 2>/dev/null || echo manual)"

DOMAIN="" EMAIL="" ADMIN_NETS=() FIREWALL=1 TLS_INTERNAL=0 TUNNEL_TOKEN=""
while [[ $# -gt 0 ]]; do
  case "$1" in
    --dominio) DOMAIN="$2"; shift 2 ;;
    --correo) EMAIL="$2"; shift 2 ;;
    --red-admin) ADMIN_NETS+=("$2"); shift 2 ;;
    --sin-firewall) FIREWALL=0; shift ;;
    --tls-interno) TLS_INTERNAL=1; shift ;;
    --tunel-cloudflare)
      # Por compatibilidad acepta el token como argumento, pero lo seguro es dejar que lo pida.
      if [[ $# -gt 1 && "$2" != --* ]]; then TUNNEL_TOKEN="$2"; shift 2
        echo "Aviso: el token quedó en el historial de la terminal. Mejor usa --tunel-cloudflare sin valor." >&2
      else TUNNEL_TOKEN="-"; shift; fi ;;
    --tunel-cloudflare-archivo)
      [[ -f "$2" ]] || die "No existe $2."
      TUNNEL_TOKEN="$(tr -d '[:space:]' < "$2")"; shred -u "$2" 2>/dev/null || rm -f -- "$2"; shift 2 ;;
    -h|--help) sed -n '2,24p' "$0"; exit 0 ;;
    *) die "Opción desconocida: $1" ;;
  esac
done
[[ -n "$DOMAIN" ]] || die "Indica --dominio (ej. delivery.diversify.hn)."
TUNNEL=0
if [[ "$TUNNEL_TOKEN" == "-" ]]; then
  if [[ -f /etc/cloudflared/diversify-delivery.env ]]; then
    TUNNEL_TOKEN="$(sed -n 's/^TUNNEL_TOKEN=//p' /etc/cloudflared/diversify-delivery.env)"   # reinstalación: se conserva
  else
    read -rsp "Token del túnel de Cloudflare (no se mostrará): " TUNNEL_TOKEN; echo
  fi
fi
if [[ -n "$TUNNEL_TOKEN" ]]; then
  TUNNEL=1
  [[ ${#TUNNEL_TOKEN} -ge 80 && "$TUNNEL_TOKEN" =~ ^[A-Za-z0-9=_-]+$ ]] \
    || die "El token del túnel no parece válido: copia solo el texto largo que sigue a 'cloudflared service install'."
fi
[[ $TUNNEL -eq 1 || $TLS_INTERNAL -eq 1 || -n "$EMAIL" ]] || die "Indica --correo (Let's Encrypt avisa ahí si el certificado tiene problemas)."

APP_USER=diversify-delivery
OPT=/opt/diversify-delivery
DATA=/var/lib/diversify-delivery
ETC=/etc/diversify-delivery
BACKUPS=/var/backups/diversify-delivery
PORT=5090

echo "==> Paquetes del sistema"
export DEBIAN_FRONTEND=noninteractive
apt-get update -q
apt-get install -y -q --no-install-recommends ca-certificates curl libicu72 sqlite3 caddy nftables \
  unattended-upgrades apt-listchanges fail2ban tzdata openssl rsync jq
# Actualizaciones de seguridad automáticas de Debian.
cat > /etc/apt/apt.conf.d/20auto-upgrades <<'EOF'
APT::Periodic::Update-Package-Lists "1";
APT::Periodic::Unattended-Upgrade "1";
EOF

echo "==> Zona horaria America/Tegucigalpa (el horario de pedidos usa la hora del servidor)"
ln -sf /usr/share/zoneinfo/America/Tegucigalpa /etc/localtime
echo "America/Tegucigalpa" > /etc/timezone

echo "==> Usuario y carpetas"
id "$APP_USER" >/dev/null 2>&1 || useradd --system --home-dir "$DATA" --shell /usr/sbin/nologin "$APP_USER"
install -d -m 0755 "$OPT" "$OPT/releases"
install -d -m 0700 -o "$APP_USER" -g "$APP_USER" "$DATA" "$DATA/data"
install -d -m 0750 -o root -g "$APP_USER" "$ETC"
install -d -m 0700 "$BACKUPS"

echo "==> Aplicación $VERSION"
REL="$OPT/releases/$VERSION"
rm -rf -- "$REL"
cp -a "$PKG/app" "$REL"
chown -R root:root "$REL"          # el servicio solo puede leer el código, no modificarlo
chmod -R go-w "$REL"
ln -sfn "$REL" "$OPT/current"
install -d -m 0755 "$OPT/deploy"
cp -a "$HERE/." "$OPT/deploy/"
chmod +x "$OPT/deploy/"*.sh

ENV_FILE="$ETC/delivery.env"
if [[ ! -f "$ENV_FILE" ]]; then
  echo "==> Configuración y contraseñas iniciales ($ENV_FILE)"
  MASTER_PASS="$(openssl rand -base64 18 | tr -d '/+=' | cut -c1-20)"
  {
    echo "# Diversify Delivery · configuración del servidor. Permisos 640 root:${APP_USER}: contiene secretos."
    echo "ASPNETCORE_ENVIRONMENT=Production"
    echo "ASPNETCORE_URLS=http://127.0.0.1:${PORT}"
    echo "AllowedHosts=\"${DOMAIN};localhost;127.0.0.1\""
    echo "Storage__DataRoot=${DATA}"
    echo "TZ=America/Tegucigalpa"
    echo "DOTNET_CLI_TELEMETRY_OPTOUT=1"
    echo
    echo "# Contraseña INICIAL del usuario master: solo se usa la primera vez que arranca (crea el usuario)."
    echo "# Cámbiala al entrar. Cambiarla aquí después no modifica la ya creada."
    echo "Seed__StoreName=\"Mi supermercado\""
    echo "Seed__MasterUser=master"
    echo "Seed__MasterPassword=${MASTER_PASS}"
    echo "Seed__DemoData=false"
    echo
    echo "# Pasarela de pago de la inscripción. En producción nunca la simulada."
    echo "Payments__Simulated=false"
    echo
    echo "# Conexión con Diversify POS (catálogo, precios, existencias y fotos). Usuario de rol 'bodega'."
    echo "# Descomenta y completa, luego: systemctl restart diversify-delivery"
    echo "#Diversify__BaseUrl=https://pos.diversify.hn"
    echo "#Diversify__Company=codigo-de-la-empresa"
    echo "#Diversify__Username=delivery"
    echo "#Diversify__Password=contraseña-del-usuario"
    echo "#Diversify__SyncMinutes=15"
  } > "$ENV_FILE"
  chown root:"$APP_USER" "$ENV_FILE"
  chmod 0640 "$ENV_FILE"
  NEW_PASSWORDS=1
else
  echo "==> Se conserva la configuración existente ($ENV_FILE)"
  NEW_PASSWORDS=0
fi

echo "==> Servicios systemd"
install -m 0644 "$HERE/systemd/diversify-delivery.service" /etc/systemd/system/diversify-delivery.service
install -m 0644 "$HERE/systemd/diversify-delivery-backup.service" /etc/systemd/system/diversify-delivery-backup.service
install -m 0644 "$HERE/systemd/diversify-delivery-backup.timer" /etc/systemd/system/diversify-delivery-backup.timer
systemctl daemon-reload
systemctl enable diversify-delivery.service diversify-delivery-backup.timer >/dev/null

if [[ $TUNNEL -eq 1 ]]; then
  echo "==> Caddy (detrás de Cloudflare Tunnel, solo en 127.0.0.1:8080)"
  sed -e "s|__PORT__|${PORT}|g" "$HERE/caddy/Caddyfile.tunnel.template" > /etc/caddy/Caddyfile
  CADDY_NETS=""
else
  echo "==> Caddy (HTTPS)"
  CADDY_NETS="${ADMIN_NETS[*]:-}"
  TLS_LINE=""
  [[ $TLS_INTERNAL -eq 1 ]] && TLS_LINE="tls internal"
  sed -e "s|__DOMAIN__|${DOMAIN}|g" -e "s|__EMAIL__|${EMAIL:-admin@${DOMAIN}}|g" -e "s|__PORT__|${PORT}|g" \
      -e "s|__TLS__|${TLS_LINE}|g" -e "s|__ADMIN_NETS__|${CADDY_NETS}|g" "$HERE/caddy/Caddyfile.template" > /etc/caddy/Caddyfile
fi
if [[ -z "$CADDY_NETS" ]]; then
  # Sin redes de administración: se quita el bloque que limita el panel.
  sed -i '/# BEGIN-CONSOLA/,/# END-CONSOLA/d' /etc/caddy/Caddyfile
fi
install -d -m 0755 -o caddy -g caddy /var/log/caddy
caddy validate --config /etc/caddy/Caddyfile --adapter caddyfile >/dev/null
systemctl enable caddy >/dev/null
systemctl reload-or-restart caddy

if [[ $TUNNEL -eq 1 ]]; then
  echo "==> Cloudflare Tunnel (cloudflared)"
  if ! command -v cloudflared >/dev/null; then
    install -d -m 0755 /usr/share/keyrings
    curl -fsSL https://pkg.cloudflare.com/cloudflare-main.gpg -o /usr/share/keyrings/cloudflare-main.gpg
    echo "deb [signed-by=/usr/share/keyrings/cloudflare-main.gpg] https://pkg.cloudflare.com/cloudflared any main" \
      > /etc/apt/sources.list.d/cloudflared.list
    apt-get update -q
    apt-get install -y -q cloudflared
  fi
  # El token va en un archivo solo para root (no en la línea de comandos del servicio, que cualquiera puede ver).
  install -d -m 0700 /etc/cloudflared
  umask 077
  printf 'TUNNEL_TOKEN=%s\n' "$TUNNEL_TOKEN" > /etc/cloudflared/diversify-delivery.env
  umask 022
  install -m 0644 "$HERE/systemd/cloudflared-diversify-delivery.service" /etc/systemd/system/cloudflared-diversify-delivery.service
  systemctl daemon-reload
  systemctl enable cloudflared-diversify-delivery >/dev/null
  systemctl restart cloudflared-diversify-delivery
fi

if [[ $FIREWALL -eq 1 ]]; then
  echo "==> Cortafuegos del contenedor (nftables)"
  SSH_RULE=""
  if [[ ${#ADMIN_NETS[@]} -gt 0 ]]; then
    V4=() V6=()
    for net in "${ADMIN_NETS[@]}"; do if [[ "$net" == *:* ]]; then V6+=("$net"); else V4+=("$net"); fi; done
    [[ ${#V4[@]} -gt 0 ]] && SSH_RULE+="    ip saddr { $(IFS=,; echo "${V4[*]}") } tcp dport 22 accept"$'\n'
    [[ ${#V6[@]} -gt 0 ]] && SSH_RULE+="    ip6 saddr { $(IFS=,; echo "${V6[*]}") } tcp dport 22 accept"$'\n'
  fi
  # Con túnel no entra nada desde afuera: el túnel es una conexión saliente hacia Cloudflare.
  WEB_RULE=""
  [[ $TUNNEL -eq 0 ]] && WEB_RULE="    tcp dport { 80, 443 } accept"$'\n'"    udp dport 443 accept"$'\n'
  awk -v rule="$SSH_RULE" -v web="$WEB_RULE" '{ if ($0 ~ /__SSH_RULES__/) printf "%s", rule; else if ($0 ~ /__WEB_RULES__/) printf "%s", web; else print }' \
    "$HERE/nftables.conf" > /etc/nftables.conf
  if nft -c -f /etc/nftables.conf && nft -f /etc/nftables.conf; then
    systemctl enable nftables >/dev/null
  else
    echo "   Aviso: no se pudo aplicar nftables en este contenedor; usa el cortafuegos de Proxmox (ver docs)."
  fi
fi

echo "==> fail2ban para SSH"
install -m 0644 "$HERE/fail2ban/diversify-delivery.local" /etc/fail2ban/jail.d/diversify-delivery.local
systemctl enable fail2ban >/dev/null 2>&1 || true
systemctl restart fail2ban >/dev/null 2>&1 || echo "   Aviso: fail2ban no arrancó (revisa 'journalctl -u fail2ban')."

echo "==> Iniciando Diversify Delivery"
systemctl restart diversify-delivery
ok=0
for _ in $(seq 1 30); do
  if curl -fsS "http://127.0.0.1:${PORT}/healthz" >/dev/null 2>&1; then ok=1; break; fi
  sleep 1
done
[[ $ok -eq 1 ]] || { journalctl -u diversify-delivery -n 40 --no-pager; die "Diversify Delivery no respondió. Revisa el registro de arriba."; }

if [[ $TUNNEL -eq 1 ]]; then
  # Lo mismo que hará el túnel: entrar por Caddy en 127.0.0.1:8080 con el dominio público.
  curl -fsS -H "Host: ${DOMAIN}" http://127.0.0.1:8080/healthz >/dev/null || die "Caddy no responde en 127.0.0.1:8080."
  TUNNEL_OK=0
  for _ in $(seq 1 20); do
    journalctl -u cloudflared-diversify-delivery --no-pager -n 50 2>/dev/null | grep -q "Registered tunnel connection" && { TUNNEL_OK=1; break; }
    sleep 1
  done
fi

echo
echo "============================================================"
echo " Diversify Delivery $VERSION instalado"
echo "  Tienda (clientes):      https://${DOMAIN}/"
echo "  Panel (master):         https://${DOMAIN}/panel/"
echo "  App de repartidores:    https://${DOMAIN}/repartidor/"
if [[ $NEW_PASSWORDS -eq 1 ]]; then
  echo
  echo "  Contraseña inicial (guárdala en un gestor de contraseñas y cámbiala al entrar):"
  echo "    Panel   master / ${MASTER_PASS}"
  echo "  También está en $ENV_FILE (solo root)."
fi
echo
echo "  Conectar con Diversify POS: edita $ENV_FILE (líneas Diversify__*) y reinicia el servicio."
if [[ $TUNNEL -eq 1 ]]; then
  echo
  if [[ $TUNNEL_OK -eq 1 ]]; then echo "  Túnel de Cloudflare: CONECTADO"
  else echo "  Túnel de Cloudflare: aún sin conexión (revisa: journalctl -u cloudflared-diversify-delivery -n 30)"; fi
  echo "  En el panel de Cloudflare (Zero Trust → Networks → Tunnels → tu túnel → Public hostname):"
  echo "    ${DOMAIN}  →  HTTP  →  localhost:8080"
  echo "  Recomendado: protege el panel con Cloudflare Access (rutas /panel y /api/admin). Ver docs/DESPLIEGUE-PROXMOX.md."
fi
echo
echo "  Respaldos diarios: $BACKUPS (systemctl list-timers diversify-delivery-backup)"
echo "  Registro:          journalctl -u diversify-delivery -f"
echo "============================================================"
