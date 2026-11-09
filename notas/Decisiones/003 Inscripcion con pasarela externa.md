# 003 · Inscripción de US$5 (pago único) con PixelPay o transferencia

**Fecha:** 2026-11-09 · **Estado:** aceptada · **Actualizada:** PixelPay elegido; la inscripción es pago único. La forma de integrar
PixelPay la reemplaza la [Decisión 005](005%20PixelPay%20Hosted%20Payment.md) (Hosted Payment).

## Decisión
- Pasarela: **PixelPay**. Esta app **nunca** recibe datos de tarjeta (cómo se integra: Decisión 005).
- Alternativa siempre disponible: transferencia con número de referencia, aprobada por el master.
- En desarrollo sin PixelPay, una pasarela simulada aprueba sin cobrar. En producción la app no arranca con ella
  ni con el sandbox de PixelPay.

Detalle: [docs/PIXELPAY.md](../../docs/PIXELPAY.md).
