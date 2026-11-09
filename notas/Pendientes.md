# Pendientes y preguntas

## Preguntas para definir (dueño del proyecto)

1. ~~Pasarela de pago~~ → **PixelPay** (definido 2026-11-09). Falta: credenciales del comercio (Key ID, llave
   secreta y URL del endpoint) y si cobra en HNL o USD.
2. **¿Un supermercado o varios?** ¿Delivery es solo para un súper (el de Diversify POS) o un mercado donde varios
   clientes de Diversify venden con sus propios repartidores? El modelo actual es un súper por instalación.
3. ~~La inscripción~~ → **pago único** (definido 2026-11-09). Por definir: ¿se reembolsa? ¿códigos promocionales?
4. **Facturación:** ¿el pedido debe crear la venta en Diversify POS (factura con CAI e inventario)? ¿Quién emite la
   factura y cuándo?
5. **Zonas y costo de envío:** ¿tarifa fija (hoy L 50) o por zona/colonia/distancia? ¿Hay zonas sin cobertura?
6. **Pagos de pedidos:** ¿efectivo, POS al recibir y transferencia son suficientes? ¿Pago en línea del pedido?
7. **Repartidores:** ¿empleados del súper o independientes? ¿Se les paga por entrega (comisión) y hay que
   llevar esa cuenta?
8. **Dominio:** ¿`delivery.diversify.hn` u otro?
9. **Notificaciones:** ¿WhatsApp automático (requiere WhatsApp Business API, con costo), SMS o correo?
10. **Logo propio** de "Diversify Delivery" o se queda la marca Diversify con la palabra DELIVERY.

## Seguridad y operación (revisión del 9 de noviembre de 2026)

- [x] S01: restringir consulta por ID a pedidos propios o disponibles (Preparando/Listo sin repartidor);
      impedir liberar pedidos Recibido, EnCamino, Entregado y Cancelado, conservando la atribución histórica.
      Validado con 62 comprobaciones de regresión. Solución en `docs/SOLUCION-SEGURIDAD-S01.md`.
- [x] S02: asignación condicional atómica y evento en una transacción; el competidor recibe 409 y los reintentos
      del dueño no duplican eventos. Regresión S01/S02: 308 comprobaciones, incluidas 12 carreras entre dos sesiones.
      Detalle en `docs/SOLUCION-SEGURIDAD-S02.md`.
- [ ] S03: comprobar el máximo de tres pedidos pendientes dentro de la operación atómica de creación.
- [ ] S04: protección antiforgery en operaciones autenticadas con efectos; validar orígenes como defensa adicional.
- [ ] S05: revocación de la sesión en servidor al cerrar sesión (no solo eliminación de la cookie).
- [ ] S06: una transferencia pendiente por usuario, límites por cuenta/IP e idempotencia.
- [ ] S07: rechazar métodos de pago no definidos y validar reglas de cada método.
- [ ] S08: validar y normalizar imágenes, incluyendo las importadas de Diversify POS.
- [ ] Corregir las rutas a `delivery.env` en systemd y actualización; probar instalación nueva.
- [ ] Validar IP real detrás de Caddy/Cloudflare y evitar acceso directo a Kestrel; añadir límites por cuenta.
- [ ] Generar PIN con criptografía y limitar intentos por pedido/cuenta.
- [x] Advertencia CS9113 (`httpFactory` sin usar) ya corregida en beta antes de integrar S01;
      compilación con `-warnaserror` verificada sin advertencias.
- [ ] Desplegar S01 y repetir la validación en el entorno publicado; revisar atribuciones de pedidos históricos
      que pudieran haber sido alteradas antes de la corrección, sin reconstruirlas automáticamente.
- [ ] Retomar guardado de la configuración reutilizable del entorno: la plataforma no confirmó el borrador.

## Técnico

- [x] Cobro de la inscripción con PixelPay: Hosted Payment, orden firmada (SHA3-512), regreso y aviso
      (`_callback`) verificados, prueba automática. Revisado con la documentación oficial (MCP de PixelPay).
- [ ] Probar PixelPay con el sandbox real desde una computadora (desde la nube lo bloquea Cloudflare) y luego en
      producción. Confirmar el formato del aviso (`_callback`) con un pago real.
- [ ] Mapa dentro de la app para marcar la ubicación (hoy: GPS del celular + enlaces a Google Maps/Waze).
      Requiere decidir proveedor de mapas (y permitir su dominio en la CSP).
- [ ] Notificaciones push / WhatsApp de cambios de estado.
- [x] Recuperar contraseña por correo (enlace de 1 hora y un solo uso; prueba automática).
- [ ] Elegir el servicio de correo (Brevo, Gmail…) y configurarlo en el servidor (`Email__*`).
- [ ] Enviar el pedido entregado a Diversify POS como venta (ver pregunta 4).
- [ ] EF Core Migrations (hoy `EnsureCreated` + `SchemaUpgrades`, igual que Diversify POS).
- [ ] Términos y condiciones y aviso de privacidad (texto legal).
- [ ] PWA instalable (manifest + service worker) para clientes y repartidores.
- [ ] Probar la instalación en el Proxmox real junto con Diversify POS.

## Hecho

- [x] Tienda en línea: catálogo público, búsqueda, ofertas, carrito, direcciones con GPS, pedido, seguimiento.
- [x] Registro con inscripción de US$5 (tarjeta simulada / transferencia con aprobación).
- [x] Panel master: tablero, pedidos kanban, ajuste de productos, asignación, productos y precios (rápido,
      masivo, historial), clientes e inscripciones, repartidores, ajustes.
- [x] App del repartidor: disponibles, mis entregas, navegación, llamar/WhatsApp, entrega con código.
- [x] Sincronización con Diversify POS (probada en local).
- [x] Scripts de despliegue para un contenedor LXC aparte.
- [x] Prueba de punta a punta con Playwright y capturas.
