# Pruebas

## Recorrido de punta a punta (`e2e-capturas.cjs`)

Usa Playwright con Chromium. Simula tres personas a la vez:

1. **Cliente** (celular): se registra, paga la inscripción (pasarela de prueba), agrega productos, crea una
   dirección con GPS simulado en San Pedro Sula y hace el pedido. Lee su código de entrega.
2. **Master** (escritorio): ve el tablero, abre el pedido, lo pasa a Preparando y a Listo, recorre productos,
   clientes, repartidores y ajustes.
3. **Repartidor** (celular): toma el pedido, va en camino, prueba un código equivocado (debe fallar) y entrega con
   el código correcto. El cliente ve su pedido entregado.

Falla si hay errores de JavaScript en cualquier pantalla.

```bash
rm -rf src/Diversify.Delivery/data
dotnet run --project src/Diversify.Delivery --launch-profile http &
node tests/e2e-capturas.cjs                 # guarda docs/capturas/*.png
CAPTURAS=0 node tests/e2e-capturas.cjs      # solo prueba
```

Necesita base nueva con datos demo (usa los usuarios `master` y `repartidor` y los pedidos de ejemplo).
