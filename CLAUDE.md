# Diversify Delivery · Contexto del proyecto

Léelo antes de cambiar algo. Uso y comandos: `README.md`. Funciones y capturas: `docs/FUNCIONALIDADES.md`.
Integración: `docs/INTEGRACION-DIVERSIFY.md`. Servidor: `docs/DESPLIEGUE-PROXMOX.md`. Preguntas abiertas:
`notas/Pendientes.md`.

## Qué es

- Tienda en línea + pedidos a domicilio de un supermercado de **Honduras** (lempiras, ISV 0/15/18 %), conectada a
  **Diversify POS** (repositorio `kevinxonium153/Diversifyfin1`, rama de desarrollo `betas`).
- Tres roles: `cliente` (tienda, inscripción de US$5), `master` (panel) y `repartidor` (app de entregas).
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
  RegistrationPayment, StoreSettings (una fila).
- `Core/SchemaUpgrades.cs`: columnas nuevas en tablas existentes **se declaran ahí** (tablas nuevas se crean solas).
  Nunca borrar ni renombrar columnas.
- `Core/Security.cs`: roles, `RequireRoles`, sesión validada cada 30 s (suspender o cambiar contraseña la cierra;
  aprobar el pago la renueva). Tras cambiar un usuario: `cache.Remove(SessionCacheKey(id))`.
- `Core/Hosting.cs`: CSP estricta, límites de intentos, validación de producción.
- Errores: `AppException(mensaje, status)` → `{ "error": "..." }`.
- Módulos: `AuthEndpoints`, `RegistrationEndpoints` (inscripción, `IPaymentGateway`), `CatalogEndpoints`
  (público + master), `Orders` (cliente, master, repartidor; reglas y estados), `AdminEndpoints`, `DiversifySync`.

### Reglas de negocio

- Estados: Recibido → Preparando → Listo → EnCamino → Entregado | Cancelado. Transiciones del master en
  `Orders.MasterTransitions`; el repartidor: take/release/pickup/deliver.
- Solo clientes con `Status = Activo` (inscripción pagada) pueden pedir. Horario y pausa en `StoreSettings`.
- Precios con ISV incluido. Total = subtotal (con lo realmente despachado) + envío (gratis desde
  `FreeDeliveryFrom`). Pedido mínimo sin envío.
- **Código de entrega**: lo ven cliente y master; `ToDto(o, includePin: false)` para el repartidor. No romper.
- Datos de tarjeta: **nunca** en esta app (pasarela externa).
- Productos de Diversify POS: `Source = Diversify`, `DiversifyId`. Cambiar el precio a mano → `PriceLocked`.

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
