# Solución S03: máximo de tres pedidos sin atender

Fecha: 9 de noviembre de 2026. Rama: beta. Corrección sobre 8bfd1f3.

## Problema reproducido

La aplicación contaba los pedidos Recibido antes de abrir la transacción que los insertaba. Varias solicitudes
simultáneas podían ver el mismo cupo libre y crear más de tres pedidos para un cliente. La prueba nueva falló
contra la versión anterior: ocho solicitudes simultáneas crearon ocho pedidos cuando solo debían aceptarse tres.

## Solución aplicada

Archivo: src/Diversify.Delivery/Modules/Orders.cs, POST /api/orders/.

La comprobación del cupo se trasladó al interior de la transacción existente, antes de calcular el siguiente número
e insertar el pedido. En Microsoft.Data.Sqlite esta transacción es serializable y no diferida: reserva la escritura
al comenzar. El siguiente escritor solo puede contar después de que el anterior confirme o revierta su operación.
No se emplea un candado en memoria que pudiera dejar de funcionar al ejecutar otra instancia de la aplicación.

Secuencia de la sección crítica:

1. Comenzar la transacción SQLite.
2. Contar los pedidos del cliente autenticado cuyo estado es Recibido.
3. Si hay tres o más, responder HTTP 400 con el mensaje de límite y revertir la transacción.
4. Si hay cupo, asignar el número correlativo e insertar el pedido, sus líneas y el evento inicial.
5. Confirmar la transacción y devolver HTTP 201.

Las validaciones de cuenta, dirección, carrito, productos, cantidades y pago permanecen antes de la sección
crítica para mantener breve el bloqueo de escritura. No cambió el esquema de datos ni el contrato HTTP.

El límite se aplica por cliente a los pedidos sin atender en estado Recibido. Preparando y los demás estados
no cuentan para ese cupo. Cancelar o empezar a preparar un pedido libera espacio. No se limita el total global
de pedidos de la tienda ni el historial del cliente. La corrección no elimina ni cancela automáticamente pedidos
excedentes que ya existieran antes del despliegue; si hay tres o más, rechaza nuevas creaciones hasta liberar cupo.

## Pruebas y evidencia

La prueba tests/seguridad-repartidor.cjs, incluida en CI, conserva las regresiones S01 y S02 y añade:

- Ocho ráfagas de ocho solicitudes concurrentes (64 intentos): dos ráfagas con cada estado inicial de 0, 1, 2 o 3 pendientes.
- Creaciones aceptadas por ráfaga: exactamente 3, 2, 1 o 0, respectivamente; el resto responde HTTP 400 por el límite.
- Comprobación posterior de la base mediante la API: exactamente tres Recibido; los rechazos no crean filas.
- Números de pedido únicos después de cada ráfaga.
- Cancelación de un pendiente y creación de su reemplazo.
- Cambio de otro pendiente a Preparando y creación de su reemplazo.
- Un carrito inválido rechazado no consume cupo.

Resultado conjunto: 580 comprobaciones correctas con datos demo aislados. Compilación con -warnaserror,
JavaScript y ShellCheck aprobados. El recorrido completo de navegador terminó sin errores, desde el registro hasta la entrega con PIN correcto.
La prueba reproduce el exceso en la versión anterior y pasa con la corrección. No se hicieron pruebas de carga
prolongadas ni se enviaron peticiones a producción.

## Ejecución y entrega

Desde la raíz del repositorio, usar una instancia local con base demo nueva:

```bash
Storage__DataRoot="$(mktemp -d)" dotnet run --project src/Diversify.Delivery --launch-profile http
# En otra terminal:
ALLOW_DEMO_MUTATIONS=1 BASE=http://localhost:5390 node tests/seguridad-repartidor.cjs
```

Debe terminar con 580 comprobaciones correctas. La suite crea cliente y pedidos y restaura ajustes al finalizar;
no usar con datos reales. No se desactivan las validaciones de negocio ni se cambia el límite del servidor.

La entrega se realiza en beta. El push no despliega producción. Tras desplegar, verificar el límite con cuentas de
prueba y revisar si existen clientes con excedentes anteriores. La idempotencia de la creación ante reenvíos de
red es una mejora adicional: este cambio garantiza el cupo, no identifica dos solicitudes como el mismo pedido.
Posteriormente se corrigieron S04 y S05; los hallazgos S06, S07 y S08 siguen pendientes en notas/Pendientes.md.
