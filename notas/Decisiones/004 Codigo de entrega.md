# 004 · Código de entrega de 4 dígitos

**Fecha:** 2026-11-09 · **Estado:** aceptada

## Decisión
Cada pedido tiene un código de 4 dígitos que solo ven el cliente y el master. El repartidor lo pide al entregar;
sin el código correcto el pedido no se marca entregado. La API del repartidor nunca devuelve el código y el
endpoint de entrega tiene límite de intentos.

## Consecuencias
Evita entregas marcadas sin llegar o a la persona equivocada. Si el cliente no tiene el celular a mano, el master
puede marcar la entrega desde el panel.
