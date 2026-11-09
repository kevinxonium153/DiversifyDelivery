# Solución S02: asignación exclusiva de pedidos

Fecha: 9 de noviembre de 2026. Rama: beta. Corrección sobre bc24bbf.

## Problema reproducido

Dos repartidores consultaban el mismo pedido sin dueño antes de que cualquiera guardara su asignación.
Ambos recibían HTTP 200, aunque solo uno terminaba registrado en la base. La nueva regresión falló contra
la versión anterior exactamente por ese resultado: [200, 200] en lugar de [200, 409].

## Solución aplicada

Archivo: src/Diversify.Delivery/Modules/Orders.cs, POST /api/driver/orders/{id}/take.

La asignación es una única escritura condicional con ExecuteUpdateAsync: exige el ID solicitado, DriverId nulo
y estado Preparando o Listo. La base devuelve cuántas filas cambió. Si cambia una fila, ese repartidor ganó;
se añade un único evento y se confirma todo dentro de la misma transacción. No hay un intervalo entre consultar
la disponibilidad y asignar el pedido. El evento y la asignación se confirman juntos o se revierten juntos.

Si no cambia ninguna fila, se comprueba el resultado persistido:

- Pedido inexistente: HTTP 404.
- Pedido de otro repartidor o estado no disponible: HTTP 409, con mensaje para actualizar la lista.
- Pedido que ya pertenece al mismo repartidor y sigue Preparando/Listo: HTTP 200 sin cambiar fechas ni
  añadir eventos. Permite reintentos ante pérdida de conexión sin repetir la toma.

Las respuestas 409 solo incluyen el error, sin datos personales del pedido. El PIN continúa oculto al repartidor.
El cliente existente muestra el mensaje devuelto por la API. No se cambió el esquema ni se alteraron asignaciones
históricas. El límite de pedidos se corrigió posteriormente en S03; ver `docs/SOLUCION-SEGURIDAD-S03.md`.
El resto de operaciones concurrentes requiere su propia revisión.

## Verificación

Prueba tests/seguridad-repartidor.cjs, ya incluida en CI:

- 12 rondas concurrentes entre dos cookies de repartidor, seis en Preparando y seis en Listo, alternando el orden.
- En todas las rondas, un ganador HTTP 200 y un conflicto HTTP 409.
- Verificación posterior por el master: dueño persistido igual al confirmado y exactamente un evento nuevo.
- El perdedor no puede consultar ni liberar el pedido.
- Dos reintentos paralelos del ganador mantienen idéntico el pedido completo: estado, fecha y eventos.
- Liberación válida entre rondas y rechazo de toma de un pedido cancelado sin modificarlo.
- Las regresiones previas de S01 se conservan. Resultado inicial S01/S02: 308 comprobaciones correctas;
  la suite ampliada con S03 verifica ahora 580 comprobaciones.
- Compilación con -warnaserror sin errores ni advertencias; JavaScript y ShellCheck correctos.

Las pruebas se hicieron con datos demo aislados en localhost. La prueba de concurrencia falla contra la versión
anterior y pasa con la corrección. El recorrido completo de navegador terminó sin errores, desde el registro hasta la entrega con PIN correcto.

## Reproducción local y entrega

Desde la raíz del repositorio, iniciar una instancia de desarrollo con base demo nueva:

```bash
Storage__DataRoot="$(mktemp -d)" dotnet run --project src/Diversify.Delivery --launch-profile http
# En otra terminal:
ALLOW_DEMO_MUTATIONS=1 BASE=http://localhost:5390 node tests/seguridad-repartidor.cjs
```

No usar con datos reales: la suite crea cliente y pedidos, ejecuta entregas y restaura los ajustes al finalizar.
La corrección se entrega en beta. La ejecución local y el push no implican despliegue en producción ni que el CI
remoto haya terminado. Tras desplegar, repetir la prueba con cuentas de prueba y revisar posibles asignaciones
inconsistentes anteriores; el parche no repara automáticamente datos históricos.
