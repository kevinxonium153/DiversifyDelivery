# 005 · PixelPay con Hosted Payment (checkout de PixelPay)

**Fecha:** 2026-11-09 · **Estado:** aceptada · **Reemplaza:** la integración con el SDK en el navegador (003).

## Contexto
La primera versión usaba el SDK de PixelPay (`@pixelpay/sdk-core`) en el navegador del cliente. Al revisarla con
la documentación oficial de PixelPay (a través de su servidor MCP) aparecieron tres problemas:

1. PixelPay pide llamar al SDK **desde el backend** (todo salvo `withAuthenticationRequest`). Desde el navegador
   había que mandarle el hash de la llave secreta.
2. Desde enero de 2026 `doSale`, `getStatus` y el checkout exigen la **Firma de Seguridad** `x-client-signature`
   (HMAC SHA3-512 con la llave secreta), que solo puede calcular el servidor. La versión anterior no la enviaba.
3. Desde julio de 2025 la cabecera `x-auth-hash` es el **SHA-512** de la llave secreta, no el MD5 que usábamos.

Con 1 a 3, el cobro no habría funcionado con un comercio real.

## Opciones
- **SDK de .NET en el servidor:** la tarjeta pasaría por nuestro servidor (más carga de PCI) y ese SDK no soporta
  3-D Secure.
- **Hosted Payment:** PixelPay muestra su propio checkout, con 3-D Secure; nosotros firmamos la orden en el
  servidor y verificamos el resultado. Es la opción que PixelPay recomienda si no se quiere manejar tarjetas.

## Decisión
Hosted Payment (`api/v2/transaction/hosted/other`):
- Orden creada servidor a servidor, firmada, con el monto fijado por el servidor.
- Confirmación por el regreso del cliente (`paymentHash`) y por el aviso de PixelPay (`_callback`), los dos
  verificados con la llave secreta.
- Sin SDK ni excepciones de CSP: el sitio entero queda con la política estricta.

## Consecuencias
- El cliente sale un momento de la tienda para pagar (en la página de PixelPay) y vuelve sola al terminar.
- `App__PublicUrl` debe ser la dirección https real: PixelPay devuelve ahí al cliente y avisa los pagos.
- `/api/pixelpay/aviso` debe quedar público (no detrás de Cloudflare Access).

Detalle: [docs/PIXELPAY.md](../../docs/PIXELPAY.md).
