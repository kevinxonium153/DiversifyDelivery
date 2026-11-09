# 003 · Inscripción de US$5 con pasarela externa o transferencia

**Fecha:** 2026-11-09 · **Estado:** aceptada (falta elegir la pasarela)

## Decisión
- La app **nunca** recibe ni guarda datos de tarjeta: la pasarela los pide en su página (`IPaymentGateway`
  devuelve una URL de pago o el resultado). Así no hay que cumplir PCI en nuestro servidor.
- Alternativa siempre disponible: transferencia con número de referencia, aprobada por el master.
- En desarrollo, `SimulatedGateway` aprueba sin cobrar. En producción la app no arranca con ella.
