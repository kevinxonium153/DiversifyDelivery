#!/usr/bin/env bash
# Crea en Proxmox VE el contenedor LXC de Diversify Delivery (APARTE del de Diversify POS) y, si le pasas el paquete, lo instala.
# Se ejecuta EN EL HOST de Proxmox como root.
#
#   ./crear-contenedor.sh --dominio delivery.miempresa.hn --correo ti@miempresa.hn \
#       --ip 192.168.1.50/24 --gw 192.168.1.1 --ssh-key ~/.ssh/id_ed25519.pub \
#       --red-admin 192.168.1.0/24 --paquete diversify-delivery-1.0.0.tar.gz
#
# Sin IP pública (Cloudflare Tunnel; no se abre ningún puerto en el router):
#   ./crear-contenedor.sh --dominio delivery.diversify.hn --tunel-cloudflare \
#       --ip 192.168.1.50/24 --gw 192.168.1.1 --ssh-key /root/.ssh/authorized_keys \
#       --red-admin 192.168.1.0/24 --paquete diversify-delivery-1.0.0.tar.gz
#
# Opciones (con su valor por defecto):
#   --ctid N            siguiente ID libre       --hostname diversify-delivery-delivery
#   --storage local-lvm (disco del contenedor)   --bridge vmbr0
#   --cores 2  --memoria 1024 (MB)  --disco 12 (GB)
#   --ip dhcp | CIDR    --gw IP                  --ssh-key archivo .pub (recomendado)
#   --dns "1.1.1.1 8.8.8.8"  servidores DNS del contenedor (fijos, no los del host)
#   --red-admin CIDR    redes que pueden usar SSH y el panel /panel (oficina o VPN). Se puede repetir.
#   --dominio, --correo, --paquete               si se dan, instala Diversify Delivery al final
#   --tunel-cloudflare                           modo túnel: pide el token sin mostrarlo (sin --correo ni puertos)
set -euo pipefail

die() { echo "ERROR: $*" >&2; exit 1; }
[[ $EUID -eq 0 ]] || die "Ejecuta como root en el host de Proxmox."
command -v pct >/dev/null || die "No se encontró 'pct': este script es para el host de Proxmox VE."

CTID="" HOSTNAME_CT="diversify-delivery" STORAGE="local-lvm" BRIDGE="vmbr0" CORES=2 MEMORY=1024 DISK=12
IP="dhcp" GW="" DNS="1.1.1.1 8.8.8.8" SSH_KEY="" DOMAIN="" EMAIL="" PACKAGE="" ADMIN_NETS=() TUNNEL_TOKEN=""
while [[ $# -gt 0 ]]; do
  case "$1" in
    --ctid) CTID="$2"; shift 2 ;;
    --hostname) HOSTNAME_CT="$2"; shift 2 ;;
    --storage) STORAGE="$2"; shift 2 ;;
    --bridge) BRIDGE="$2"; shift 2 ;;
    --cores) CORES="$2"; shift 2 ;;
    --memoria) MEMORY="$2"; shift 2 ;;
    --disco) DISK="$2"; shift 2 ;;
    --ip) IP="$2"; shift 2 ;;
    --gw) GW="$2"; shift 2 ;;
    --dns) DNS="$2"; shift 2 ;;
    --ssh-key) SSH_KEY="$2"; shift 2 ;;
    --red-admin) ADMIN_NETS+=("$2"); shift 2 ;;
    --dominio) DOMAIN="$2"; shift 2 ;;
    --correo) EMAIL="$2"; shift 2 ;;
    --paquete) PACKAGE="$2"; shift 2 ;;
    --tunel-cloudflare)
      if [[ $# -gt 1 && "$2" != --* ]]; then TUNNEL_TOKEN="$2"; shift 2; else TUNNEL_TOKEN="-"; shift; fi ;;
    -h|--help) sed -n '2,28p' "$0"; exit 0 ;;
    *) die "Opción desconocida: $1" ;;
  esac
done

if [[ "$TUNNEL_TOKEN" == "-" ]]; then
  read -rsp "Token del túnel de Cloudflare (no se mostrará): " TUNNEL_TOKEN; echo
fi
[[ -z "$TUNNEL_TOKEN" || ( ${#TUNNEL_TOKEN} -ge 80 && "$TUNNEL_TOKEN" =~ ^[A-Za-z0-9=_-]+$ ) ]] \
  || die "El token no parece válido: copia solo el texto largo que sigue a 'cloudflared service install'."
[[ -z "$CTID" ]] && CTID="$(pvesh get /cluster/nextid)"
pct status "$CTID" >/dev/null 2>&1 && die "Ya existe el contenedor $CTID."
[[ -n "$SSH_KEY" && ! -f "$SSH_KEY" ]] && die "No existe la llave SSH $SSH_KEY."
[[ -n "$PACKAGE" && ! -f "$PACKAGE" ]] && die "No existe el paquete $PACKAGE."
[[ "$IP" != "dhcp" && -z "$GW" ]] && die "Con IP fija indica también --gw."

echo "==> Plantilla Debian 12"
pveam update >/dev/null
TEMPLATE="$(pveam available --section system | awk '/debian-12-standard/ {print $2}' | sort -V | tail -1)"
[[ -n "$TEMPLATE" ]] || die "No se encontró la plantilla debian-12-standard."
pveam list local | grep -q "$TEMPLATE" || pveam download local "$TEMPLATE"

NET="name=eth0,bridge=${BRIDGE},ip=${IP},firewall=1"
[[ -n "$GW" ]] && NET+=",gw=${GW}"

echo "==> Creando contenedor $CTID ($HOSTNAME_CT)"
ARGS=(--hostname "$HOSTNAME_CT" --cores "$CORES" --memory "$MEMORY" --swap 512
      --rootfs "${STORAGE}:${DISK}" --net0 "$NET"
      --unprivileged 1 --features nesting=1 --onboot 1 --timezone America/Tegucigalpa
      # DNS fijo: si el contenedor heredara el del host (ej. el de Tailscale), el túnel se caería al reiniciar.
      --nameserver "$DNS"
      --description "Diversify Delivery · https://${DOMAIN:-sin-dominio}")
[[ -n "$SSH_KEY" ]] && ARGS+=(--ssh-public-keys "$SSH_KEY")
pct create "$CTID" "local:vztmpl/$TEMPLATE" "${ARGS[@]}"

# Cortafuegos de Proxmox para el contenedor: solo web (80/443) y SSH desde las redes de administración.
echo "==> Cortafuegos del contenedor"
FW="/etc/pve/firewall/${CTID}.fw"
{
  echo "[OPTIONS]"
  echo "enable: 1"
  echo "policy_in: DROP"
  echo "policy_out: ACCEPT"
  echo
  echo "[RULES]"
  if [[ -z "$TUNNEL_TOKEN" ]]; then
    echo "IN ACCEPT -p tcp -dport 443 -log nolog # HTTPS"
    echo "IN ACCEPT -p udp -dport 443 -log nolog # HTTP/3"
    echo "IN ACCEPT -p tcp -dport 80 -log nolog # certificado Let's Encrypt y redirección a HTTPS"
  fi
  # Con Cloudflare Tunnel no entra tráfico web: cloudflared sale hacia Cloudflare (TCP/UDP 7844).
  echo "IN ACCEPT -p icmp -log nolog"
  for net in "${ADMIN_NETS[@]}"; do echo "IN ACCEPT -source ${net} -p tcp -dport 22 -log nolog # SSH administración"; done
} > "$FW"
[[ ${#ADMIN_NETS[@]} -eq 0 ]] && echo "   Aviso: sin --red-admin el SSH del contenedor queda cerrado (usa 'pct enter $CTID')."
echo "   Recuerda activar el cortafuegos en Datacenter → Firewall (enable: 1) si aún no lo está."

pct start "$CTID"
echo "==> Esperando red..."
for _ in $(seq 1 30); do pct exec "$CTID" -- getent hosts deb.debian.org >/dev/null 2>&1 && break; sleep 2; done

if [[ -n "$PACKAGE" ]]; then
  [[ -n "$DOMAIN" ]] || die "Para instalar indica --dominio."
  [[ -n "$EMAIL" || -n "$TUNNEL_TOKEN" ]] || die "Indica --correo (Let's Encrypt) o --tunel-cloudflare."
  MODE_ARGS=(--dominio "$DOMAIN")
  if [[ -n "$TUNNEL_TOKEN" ]]; then
    # El token viaja en un archivo temporal (solo root) y el instalador lo borra: nunca en la línea de comandos.
    TOKEN_FILE="$(mktemp)"
    chmod 600 "$TOKEN_FILE"
    printf '%s' "$TUNNEL_TOKEN" > "$TOKEN_FILE"
    pct push "$CTID" "$TOKEN_FILE" /root/.diversify-delivery-tunnel-token --perms 600
    shred -u "$TOKEN_FILE" 2>/dev/null || rm -f -- "$TOKEN_FILE"
    MODE_ARGS+=(--tunel-cloudflare-archivo /root/.diversify-delivery-tunnel-token)
  else
    MODE_ARGS+=(--correo "$EMAIL")
  fi
  echo "==> Copiando e instalando $(basename "$PACKAGE")"
  pct push "$CTID" "$PACKAGE" "/root/$(basename "$PACKAGE")"
  pct exec "$CTID" -- bash -c "cd /root && tar --no-same-owner -xzf '$(basename "$PACKAGE")'"
  DIR="$(tar -tzf "$PACKAGE" | head -1 | cut -d/ -f1)"
  for net in "${ADMIN_NETS[@]}"; do MODE_ARGS+=(--red-admin "$net"); done
  pct exec "$CTID" -- bash "/root/$DIR/deploy/install.sh" "${MODE_ARGS[@]}"
else
  echo
  echo "Contenedor listo. Para instalar Diversify Delivery:"
  echo "  pct push $CTID diversify-delivery-X.tar.gz /root/diversify-delivery-X.tar.gz"
  echo "  pct exec $CTID -- bash -c 'cd /root && tar -xzf diversify-delivery-X.tar.gz && bash diversify-delivery-X/deploy/install.sh --dominio $DOMAIN --correo $EMAIL'"
fi
