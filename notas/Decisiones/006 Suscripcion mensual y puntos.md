# 006 · Suscripción mensual de US$5 y puntos por compras y referidos

**Fecha:** 2026-11-10 · **Estado:** aceptada · **Reemplaza:** el pago único de la inscripción (003).

## Decisión

**Suscripción mensual** (`StoreSettings.RegistrationFeeUsd`, US$5):
- Cada pago aprobado (PixelPay, transferencia aprobada o pasarela simulada) suma **un mes** a
  `User.SubscriptionEndsAt`: desde hoy o, si paga por adelantado, desde que vence.
- Solo se puede adelantar **el mes siguiente**: con más de 35 días restantes, no se acepta otro pago.
- Al vencer, la cuenta pasa a "Pendiente de pago" y no puede pedir. Lo revisa `SubscriptionExpiryWorker` cada hora
  y también se revisa al pedir. **Los puntos se conservan.**
- Una transferencia de renovación no bloquea a un cliente activo mientras se revisa.
- Pagar no reactiva a un cliente que el master suspendió.
- Bases anteriores: los clientes que ya estaban activos (pagaron la inscripción única) reciben un mes desde la
  actualización.

**Puntos** (1 punto = L 1, tabla `PointsEntries`; el saldo es la suma de los movimientos):
- **Compra:** el cliente gana `PointsPercent` (2 %) del **total** del pedido (productos + envío).
- **Referido:** quien invitó al cliente gana `ReferralPercent` (2 %) del total de **cada** pedido de su invitado.
  Un solo nivel y sin límite de tiempo.
- Se acreditan **al entregar** el pedido, con el total final. Los cancelados no dan puntos. Un pedido no da puntos
  dos veces (índice único).
- La invitación es un código de 6 caracteres (`User.ReferralCode`) en el enlace `/#/registro?ref=CÓDIGO`. Solo se
  aplica al crear la cuenta.
- El master cambia los dos porcentajes en Ajustes (0–20 %).

## Pendiente de definir

- **Canje de puntos:** hoy el cliente ve su saldo y su equivalente en lempiras, pero no puede usarlos. Hay que
  decidir cómo se usan (descuento en el pedido, tope por pedido, si cubren el envío) y cómo cuadra el repartidor
  el cobro en efectivo.
- **Cobro automático cada mes:** hoy el cliente renueva a mano. Con tarjeta guardada hace falta la pasarela:
  - PixelPay "Cobros recurrentes" (en beta).
  - Tokenización de BAC (si se cambia de pasarela).
  La lógica de "sumar un mes al recibir el pago" ya sirve para los dos.
- **Vencimiento de puntos** y qué pasa con los puntos de una cuenta suspendida.

## Consecuencias

- Dejan de valer los textos de "inscripción única y no reembolsable". Los términos del servicio deben describir la
  suscripción y los puntos.
- Las rutas y tablas internas conservan el nombre "registration" para no romper bases ni enlaces de PixelPay.
