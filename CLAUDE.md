# Diversify Delivery · Contexto del proyecto

Léelo antes de cambiar algo. Uso y comandos: `README.md`. Funciones y capturas: `docs/FUNCIONALIDADES.md`.
Integración: `docs/INTEGRACION-DIVERSIFY.md`. Servidor: `docs/DESPLIEGUE-PROXMOX.md`. Preguntas abiertas:
`notas/Pendientes.md`. Bugs conocidos: `notas/Bugs.md` (revisarlo antes de tocar un área).

## Qué es

- Tienda en línea + pedidos a domicilio de un supermercado de **Honduras** (lempiras, ISV 0/15/18 %), conectada a
  **Diversify POS** (repositorio `kevinxonium153/Diversifyfin1`, rama de desarrollo `betas`).
- Tres roles: `cliente` (tienda, suscripción mensual de US$5, puntos), `master` (panel) y `repartidor` (app de entregas).
- Desarrolla **PolyMorpha**. Todo en **español**: interfaz, errores, comentarios, documentación y commits.
- La demo es un negocio ficticio, "Súper La Esperanza". Nunca usar "Diversify" como nombre de tienda.

## Ramas

| Rama | Uso |
|---|---|
| `master` | Lo publicado (producción). Solo recibe merges desde `beta` ya probados. |
| `beta` | Cambios pendientes de probar. **El trabajo nuevo va aquí** salvo que se pida otra cosa. |

No crear PR ni hacer merge a `master` sin que lo pidan.

## Comandos

| Acción | Comando |
|---|---|
| Desarrollo | `dotnet run --project src/Diversify.Delivery --launch-profile http` → http://localhost:5390 |
| Compilar | `dotnet build src/Diversify.Delivery` |
| Prueba completa + capturas | `node tests/e2e-capturas.cjs` (base nueva con datos demo) |
| Paquete | `./deploy/build-release.sh 1.0.0` |
| Publicar | `./deploy/publicar.sh` (master → producción, beta → pruebas) |

Credenciales demo: `master/master123`, `repartidor/repartidor123`, `cliente@demo.hn/cliente123`.
Datos locales en `src/Diversify.Delivery/data/` (ignorado por git).

## Backend (`src/Diversify.Delivery`)

- ASP.NET Core 10 Minimal APIs, EF Core + SQLite, una sola base `delivery.db`. Cookie `diversify.delivery`.
- `Core/Entities.cs`: User (Role, Status), Category, Product, PriceChange, Address, Order, OrderItem, OrderEvent,
  RegistrationPayment, PointsEntry, StoreSettings (una fila).
- `Core/SchemaUpgrades.cs`: columnas nuevas en tablas existentes **se declaran ahí** (tablas nuevas se crean solas).
  Nunca borrar ni renombrar columnas.
- `Core/Security.cs`: roles, `RequireRoles`, sesión validada cada 30 s (suspender o cambiar contraseña la cierra;
  aprobar el pago la renueva). Tras cambiar un usuario: `cache.Remove(SessionCacheKey(id))`.
- `Core/Hosting.cs`: CSP estricta, límites de intentos, validación de producción.
- Errores: `AppException(mensaje, status)` → `{ "error": "..." }`.
- Módulos: `AuthEndpoints`, `RegistrationEndpoints` (pagos de la suscripción), `Loyalty` (puntos, referidos y
  `Subscriptions`), `CatalogEndpoints`
  (público + master), `Orders` (cliente, master, repartidor; reglas y estados), `AdminEndpoints`, `DiversifySync`.

### Reglas de negocio

- Estados: Recibido → Preparando → Listo → EnCamino → Entregado | Cancelado. Transiciones del master en
  `Orders.MasterTransitions`; el repartidor: take/release/pickup/deliver.
- Solo clientes con `Status = Activo` y `SubscriptionEndsAt` vigente pueden pedir. Horario y pausa en `StoreSettings`.
- **Suscripción mensual** (Decisión 006): cada pago aprobado llama a `Subscriptions.Extend` (+1 mes); al vencer pasa a
  `PendientePago` (`SubscriptionExpiryWorker`). Solo se adelanta el mes siguiente.
- **Puntos** (1 punto = L 1): `Loyalty.CreditDeliveredAsync` al entregar (master o repartidor): `PointsPercent` del
  total para el cliente y `ReferralPercent` para quien lo invitó (`ReferredById`). El saldo es la suma de
  `PointsEntries`; nunca editar saldos. Aún no se canjean. Prueba: `tests/puntos-suscripcion.cjs`.
- Precios con ISV incluido. Total = subtotal (con lo realmente despachado) + envío (gratis desde
  `FreeDeliveryFrom`). Pedido mínimo sin envío.
- **Código de entrega**: lo ven cliente y master; `ToDto(o, includePin: false)` para el repartidor. No romper.
- Datos de tarjeta: **nunca** en esta app. Suscripción (US$5 al mes) con **PixelPay Hosted Payment**: el
  servidor crea la orden firmada (HMAC SHA3-512) y el cliente paga en la página de PixelPay; se verifica
  `payment_hash` al regresar (`/api/pixelpay/registro/{id}/completo`) y en el aviso (`/api/pixelpay/aviso`).
  Código: `Modules/PixelPay.cs` + `RegistrationEndpoints`. Ver `docs/PIXELPAY.md` y la Decisión 005. Prueba:
  `tests/pago-pixelpay.cjs`. Hay un MCP de la documentación de PixelPay: consúltalo antes de cambiar el cobro.
- Productos de Diversify POS: `Source = Diversify`, `DiversifyId`. Cambiar el precio a mano → `PriceLocked`.

- Dirección pública (correos, regreso de PixelPay): `HostingSecurity.PublicBaseUrl` (`App:PublicUrl`).
- Recuperar contraseña: `Modules/PasswordResetEndpoints.cs` (tabla `PasswordResets`, solo el SHA-256 del enlace,
  1 hora, un uso, máx. 3 por hora). Correos con `Core/Email.cs` (`IEmailSender`, SMTP de `Email:*`; sin `Email:Host`
  se guardan en `data/correos/*.eml`). Prueba: `tests/recuperar-contrasena.cjs`.

## Frontend (`wwwroot`)

- Sin build, sin npm, sin CDNs (la CSP lo bloquea). ES modules.
- `js/ui.js`: `esc` (escapar **siempre** lo interpolado), `money`, `modal`, `toast`, `attempt`, `formData`,
  `icon(name)`, estados (`statusBadge`, `steps`), enlaces de mapas/WhatsApp. `js/api.js`: cliente de `/api`.
- Tienda: `index.html` + `js/tienda/*` (enrutador por hash en `app.js`, carrito en `localStorage 'dd.cart.v1'`).
- Panel: `panel/index.html` + `js/panel/*`, una página por archivo `{ route, title, icon, render(el, ctx) }`.
- Repartidor: `repartidor/index.html` + `js/repartidor/app.js`.
- Estilos: tokens en `css/app.css` (claro/oscuro), más `tienda.css`, `panel.css`, `repartidor.css`. Usar tokens,
  no colores fijos.

## Despliegue

Contenedor LXC **aparte** de Diversify POS: `/opt/diversify-delivery`, `/var/lib/diversify-delivery`,
`/etc/diversify-delivery/delivery.env`, servicio `diversify-delivery` en `127.0.0.1:5090`. En producción no arranca
con contraseña de ejemplo, `AllowedHosts=*`, datos demo o pasarela simulada.

## Convenciones

- Commits en español, descriptivos, con las líneas `Co-Authored-By` y `Claude-Session` que indique la sesión.
  Sin identificadores de modelo en commits, PRs ni código.
- Al terminar una funcionalidad: marcarla en `notas/Pendientes.md`. Decisión difícil de revertir: nueva nota en
  `notas/Decisiones/`.
- Volver a generar capturas con `node tests/e2e-capturas.cjs` si cambia el diseño.

## Trampas del entorno de Claude

- Detener la app por `readlink /proc/<pid>/exe`, no con `pkill -f` (mata la propia shell).
- `curl --noproxy '*'` para `localhost`.
- El límite de login (10/min por IP) cuenta todos los intentos: en pruebas repetidas, esperar 60 s.
