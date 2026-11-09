# Despliegue en Proxmox (contenedor aparte de Diversify POS)

Diversify Delivery corre en **su propio contenedor LXC**, separado del de Diversify POS. Si uno se cae, se
actualiza o se restaura, el otro sigue funcionando. Los scripts son los mismos de Diversify POS, adaptados.

| | Diversify POS | Diversify Delivery |
|---|---|---|
| Contenedor | `diversify` | `diversify-delivery` |
| Dominio | `pos.diversify.hn` | `delivery.diversify.hn` (sugerido) |
| Código | `/opt/diversify` | `/opt/diversify-delivery` |
| Datos | `/var/lib/diversify` | `/var/lib/diversify-delivery` |
| Configuración y secretos | `/etc/diversify/diversify.env` | `/etc/diversify-delivery/delivery.env` |
| Servicio | `diversify` (127.0.0.1:5080) | `diversify-delivery` (127.0.0.1:5090) |
| Respaldos | `/var/backups/diversify` (02:30) | `/var/backups/diversify-delivery` (02:45) |
| Túnel | `cloudflared-diversify` | `cloudflared-diversify-delivery` |

Recursos sugeridos: 2 núcleos, 1 GB de RAM, 12 GB de disco (es una sola base SQLite).

## 1. Armar el paquete (en tu computadora)

```bash
./deploy/build-release.sh 1.0.0
```

Genera `dist/diversify-delivery-1.0.0.tar.gz` (app autocontenida para Linux x64: no hace falta .NET en el servidor)
y su `.sha256`.

## 2. Crear el contenedor e instalar (en el host de Proxmox, como root)

Copia `deploy/proxmox/crear-contenedor.sh` y el paquete al host. **Sin IP pública (Cloudflare Tunnel)**, igual que
Diversify POS:

```bash
./crear-contenedor.sh --dominio delivery.diversify.hn --tunel-cloudflare --ip 192.168.1.51/24 --gw 192.168.1.1 --ssh-key /root/.ssh/authorized_keys --red-admin 192.168.1.0/24 --paquete diversify-delivery-1.0.0.tar.gz
```

- Usa una **IP distinta** a la del contenedor de Diversify POS.
- El token del túnel se pide sin mostrarlo. Crea **un túnel nuevo** en Cloudflare Zero Trust para Delivery (no
  reutilices el de Diversify POS: así se pueden revocar por separado).
- En Cloudflare: Public hostname `delivery.diversify.hn` → `HTTP` → `localhost:8080`.
- Recomendado: **Cloudflare Access** para las rutas `/panel` y `/api/admin` (solo el personal del súper). La tienda
  (`/`) y la app de repartidores (`/repartidor`) deben quedar públicas.

Con IP pública (Let's Encrypt): cambia `--tunel-cloudflare` por `--correo ti@miempresa.hn`.

Al terminar, el instalador muestra la **contraseña inicial del usuario `master`**. Cámbiala al entrar.

## 3. Conectar con Diversify POS

Ver [INTEGRACION-DIVERSIFY.md](INTEGRACION-DIVERSIFY.md). En resumen: crear en Diversify POS un usuario rol
`bodega`, completar las líneas `Diversify__*` en `/etc/diversify-delivery/delivery.env` y
`systemctl restart diversify-delivery`.

## 3b. Configurar PixelPay

Ver [PIXELPAY.md](PIXELPAY.md): completar las líneas `PixelPay__*` en `/etc/diversify-delivery/delivery.env` con
los datos del portal de PixelPay del comercio y reiniciar el servicio.

## 3c. Configurar el correo (recuperar contraseña)

Sin correo, los clientes que olvidan su contraseña no pueden entrar. Sirve cualquier servidor SMTP:

| Opción | Costo | Notas |
|---|---|---|
| **Brevo** (antes Sendinblue) | Gratis hasta 300 correos/día | Recomendado. Verificar el dominio para que no caiga en spam. |
| **Gmail / Google Workspace** | Gratis / incluido | Usar una "contraseña de aplicación", no la contraseña normal. |
| Correo del dominio (cPanel, etc.) | Según el hosting | Puerto 587 con TLS. |

En `/etc/diversify-delivery/delivery.env` descomenta y completa:

```ini
Email__Host=smtp-relay.brevo.com
Email__Port=587
Email__User=usuario-smtp
Email__Password=llave-smtp
Email__From="Súper La Esperanza <no-responder@delivery.diversify.hn>"
```

`systemctl restart diversify-delivery` y prueba en la tienda: Ingresar → ¿Olvidaste tu contraseña?
`App__PublicUrl` (lo pone el instalador) es la dirección que va en el enlace del correo.
Si el correo falla, queda en `journalctl -u diversify-delivery` ("No se pudo enviar el correo de recuperación").
Master y repartidores no usan este enlace: un usuario master les asigna la contraseña nueva en el panel.

## 4. Primeros pasos en el panel

1. **Ajustes:** nombre del súper, horario, costo de envío, pedido mínimo, envío gratis, monto de la inscripción,
   tipo de cambio y **datos de la cuenta bancaria** para transferencias.
2. **Sincronizar con Diversify POS** (o crear productos a mano). Revisar emojis y orden de las categorías.
3. **Repartidores:** crear un usuario por repartidor. Ellos entran en `https://delivery.diversify.hn/repartidor/`
   desde el celular (se puede "Agregar a pantalla de inicio").

## 5. Publicar versiones nuevas (desde tu computadora)

```bash
./deploy/publicar.sh
```

- Desde la rama **`master`** publica en el contenedor de **producción**.
- Desde la rama **`beta`** publica en el contenedor de **pruebas** (si lo configuraste: es otro contenedor creado
  igual, por ejemplo `delivery-beta.diversify.hn`, con `--hostname diversify-delivery-beta`).
- Desde otra rama no publica. Exige que todo esté subido a GitHub.

Por dentro corre `deploy/update.sh`: respalda, instala, revisa `/healthz` y, si no responde, vuelve solo a la
versión anterior. Guarda el servidor y los contenedores en `~/.config/diversify-delivery/publicar.conf`
(independiente del de Diversify POS).

## 6. Mantenimiento

| Tarea | Comando (en el contenedor) |
|---|---|
| Ver registro | `journalctl -u diversify-delivery -f` |
| Respaldo manual | `bash /opt/diversify-delivery/deploy/backup.sh` |
| Restaurar | `bash /opt/diversify-delivery/deploy/restore.sh /var/backups/diversify-delivery/diversify-delivery-AAAAMMDD-HHMMSS.tar.gz` |
| Copia fuera del servidor | `OFFSITE="usuario@nas:/respaldos/diversify-delivery/"` en `/etc/diversify-delivery/backup.env` |

## 7. Seguridad (no romper)

- En producción la app **no arranca** si: la contraseña inicial del master es corta o de ejemplo, `AllowedHosts=*`,
  `Seed__DemoData=true`, `Payments__Simulated=true`, `PixelPay__Sandbox=true` o PixelPay sin llave secreta.
- CSP estricta: sin scripts en línea ni CDNs.
- Cookies `HttpOnly`, `Secure`, `SameSite=Lax` (Lax para que el cliente siga con sesión al llegar desde un enlace de
  WhatsApp). Límite de 10 intentos de login por minuto por IP.
- El código de entrega no se envía nunca a la app del repartidor.

## Estado

Los scripts vienen de Diversify POS, que los probó en simulación (no en un Proxmox real todavía). Aquí se probó:
paquete, arranque en modo producción, rechazo de configuración insegura y `shellcheck`. **Falta probar en el
servidor real** junto con Diversify POS.
