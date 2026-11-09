# Solución S01 y pendientes de Diversify Delivery

Fecha: 9 de noviembre de 2026. Repositorio: kevinxonium153/DiversifyDelivery. Rama de pruebas: beta.

## Resultado

Se corrigió el hallazgo de prioridad alta S01: un repartidor ya no puede consultar por ID pedidos sin asignar
que todavía estén Recibido o que estén cerrados; tampoco puede quitarse de pedidos entregados o cancelados.
La corrección está integrada sobre beta (base 2d55812) y comprobada. No se ha desplegado en producción.

Los otros siete hallazgos de seguridad siguen pendientes. Este cambio no los da por resueltos.
El inventario completo de pendientes de seguridad, operación, producto y decisiones está en notas/Pendientes.md;
el PDF `docs/Solucion_S01_y_todos_los_pendientes.pdf` incorpora ese inventario, incluyendo los avances existentes
en beta de PixelPay y recuperación de contraseña.

## Causa y cambio técnico

Archivo: src/Diversify.Delivery/Modules/Orders.cs, método MapDriver.

La consulta GET /api/driver/orders/{id} aceptaba cualquier pedido con DriverId nulo, aunque el listado de
pedidos disponibles solo admitía Preparando o Listo. Conocer o adivinar el ID permitía consultar teléfono,
dirección, instrucciones y coordenadas cuando existieran. Ahora la consulta exige que el pedido pertenezca al
repartidor autenticado o que esté sin asignar y en Preparando/Listo. Los accesos no permitidos responden 404.

Regla de consulta implementada:

```csharp
x.Id == id &&
(x.DriverId == me.UserId() || (x.DriverId == null &&
    (x.Status == OrderStatus.Preparando || x.Status == OrderStatus.Listo)))
```

La acción POST /api/driver/orders/{id}/release solo prohibía EnCamino. Ahora permite únicamente Preparando y
Listo, siempre que quien la solicita sea el repartidor asignado. Los estados Recibido, EnCamino, Entregado y
Cancelado se rechazan con 400. Otro repartidor recibe 404. La lectura, validación, actualización y evento de
liberación se realizan en una transacción SQLite; un rechazo no persiste cambios.

Validación añadida, además de conservar el mensaje existente para EnCamino:

```csharp
AppException.ThrowIf(o.Status is not (OrderStatus.Preparando or OrderStatus.Listo),
    "Solo puedes soltar pedidos que se estén preparando o estén listos. Los pedidos cerrados conservan su repartidor.");
```

La transacción se inicia antes de cargar el pedido y se confirma después de SaveChangesAsync. No se cambiaron
los datos históricos ni el esquema de base de datos. La carrera al tomar pedidos (S02) sigue pendiente.

## Comportamiento esperado

- Pedido Recibido sin repartidor: consulta por repartidor devuelve 404.
- Pedido Preparando o Listo sin repartidor: consulta permitida, igual que el listado de disponibles.
- Pedido asignado a otro repartidor: consulta y liberación devuelven 404.
- Pedido propio Preparando o Listo: se puede soltar y se registra el evento.
- Pedido propio Recibido, EnCamino, Entregado o Cancelado: no se puede soltar; se conserva toda la información.
- Pedido propio entregado: sigue visible en el historial de su repartidor. El PIN permanece oculto.
- Pedido cerrado sin asignar: no queda expuesto por conocer su ID.

Los datos necesarios para repartir siguen visibles en pedidos realmente disponibles. Reducir los datos personales
mostrados antes de aceptar una entrega es una decisión adicional de privacidad, fuera de esta corrección.

## Validación ejecutada

- Compilación .NET 10 sobre beta con -warnaserror: correcta, sin advertencias ni errores.
  La advertencia CS9113 observada en master ya estaba corregida en beta antes de integrar S01.
- Regresión API tests/seguridad-repartidor.cjs: 62 comprobaciones correctas en una base demo nueva.
- El rechazo de una liberación se compara con el pedido completo anterior: estado, repartidor, fechas y eventos
  permanecen iguales. Se comprueban también el acceso al historial, PIN oculto y límites entre usuarios/roles.
- Recorrido existente tests/e2e-capturas.cjs: completó registro, pago simulado, pedido, preparación, salida,
  rechazo de PIN incorrecto y entrega correcta, sin errores de JavaScript.
- Las pruebas se ejecutaron en localhost:5493 con datos desechables; no se enviaron solicitudes a producción.

Prueba de regresión, desde la raíz del repositorio, con una app local de desarrollo y base demo desechable:

```bash
Storage__DataRoot="$(mktemp -d)" dotnet run --project src/Diversify.Delivery --launch-profile http
# En otra terminal:
ALLOW_DEMO_MUTATIONS=1 BASE=http://localhost:5390 node tests/seguridad-repartidor.cjs
```

El script crea cliente y pedidos propios y restaura ajustes al terminar; no limpia la base. No usar con datos
reales. Debe finalizar con 62 comprobaciones correctas. Las instrucciones completas están en tests/README.md.

## Entrega y comprobaciones posteriores

Revisar la corrección integrada en beta. Antes de producción, corregir el pendiente de
rutas a delivery.env y verificar el paquete. Tras publicar, repetir casos de acceso por estado y liberación con
cuentas de prueba. Revisar posibles pedidos históricos sin atribución o con eventos de liberación posteriores al
cierre; esta corrección no repara automáticamente datos alterados previamente ni demuestra que hubo abuso real.

La auditoría original se realizó sobre master, commit a286c42. Sus resultados originales se conservan en el
entorno de revisión; no constituyen una nueva auditoría completa de beta. La validación pública de
Caddy/Cloudflare, TLS, host, dependencias y pasarela real sigue fuera de lo probado. No se garantiza ausencia de
otras vulnerabilidades.
