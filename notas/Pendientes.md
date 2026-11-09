# Pendientes y preguntas

## Preguntas para definir (dueño del proyecto)

1. **Pasarela de pago para la inscripción de US$5.** ¿Con quién? (PixelPay, BAC Credomatic, Tigo Money, otra). Se
   necesita la cuenta de comercio y sus credenciales. Hoy: pasarela de prueba + transferencia aprobada por el master.
2. **¿Un supermercado o varios?** ¿Delivery es solo para un súper (el de Diversify POS) o un mercado donde varios
   clientes de Diversify venden con sus propios repartidores? El modelo actual es un súper por instalación.
3. **La inscripción de US$5:** ¿pago único o anual/mensual? ¿Se reembolsa? ¿Se puede regalar (código promocional)?
4. **Facturación:** ¿el pedido debe crear la venta en Diversify POS (factura con CAI e inventario)? ¿Quién emite la
   factura y cuándo?
5. **Zonas y costo de envío:** ¿tarifa fija (hoy L 50) o por zona/colonia/distancia? ¿Hay zonas sin cobertura?
6. **Pagos de pedidos:** ¿efectivo, POS al recibir y transferencia son suficientes? ¿Pago en línea del pedido?
7. **Repartidores:** ¿empleados del súper o independientes? ¿Se les paga por entrega (comisión) y hay que
   llevar esa cuenta?
8. **Dominio:** ¿`delivery.diversify.hn` u otro?
9. **Notificaciones:** ¿WhatsApp automático (requiere WhatsApp Business API, con costo), SMS o correo?
10. **Logo propio** de "Diversify Delivery" o se queda la marca Diversify con la palabra DELIVERY.

## Técnico

- [ ] Pasarela de pago real (implementar `IPaymentGateway` con página de pago externa y aviso del resultado).
- [ ] Mapa dentro de la app para marcar la ubicación (hoy: GPS del celular + enlaces a Google Maps/Waze).
      Requiere decidir proveedor de mapas (y permitir su dominio en la CSP).
- [ ] Notificaciones push / WhatsApp de cambios de estado.
- [ ] Recuperar contraseña por correo (requiere servidor de correo).
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
