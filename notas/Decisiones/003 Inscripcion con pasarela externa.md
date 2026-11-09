# 003 · Inscripción de US$5 (pago único) con PixelPay o transferencia

**Fecha:** 2026-11-09 · **Estado:** aceptada · **Actualizada:** PixelPay elegido; la inscripción es pago único.

## Decisión
- Pasarela: **PixelPay**, con su SDK oficial en el navegador (alojado en el servidor, no por CDN). El SDK cifra la
  tarjeta y la manda directo a PixelPay: esta app **nunca** recibe datos de tarjeta.
- El servidor activa la cuenta solo si `payment_hash` es válido (MD5 con la llave secreta) **y** PixelPay confirma
  la transacción aprobada. Si no se puede confirmar, queda en revisión para el master.
- La página `/pago/` tiene una CSP propia que permite PixelPay y 3-D Secure; el resto del sitio sigue estricto.
- Alternativa siempre disponible: transferencia con número de referencia, aprobada por el master.
- En desarrollo sin PixelPay, una pasarela simulada aprueba sin cobrar. En producción la app no arranca con ella
  ni con el sandbox de PixelPay.

Detalle: [docs/PIXELPAY.md](../../docs/PIXELPAY.md).
