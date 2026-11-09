# Pruebas

## Seguridad del repartidor (`seguridad-repartidor.cjs`)

Regresiones S01 y S02: acceso por ID según asignación y estado, PIN oculto, liberación solo en
Preparando/Listo y conservación de asignación, fechas e historial ante rechazos. Incluye 12 carreras entre dos
sesiones, alternando Preparando/Listo: exactamente un HTTP 200 y un 409, una sola asignación/evento y reintentos
idempotentes del ganador. Requiere Node 22 o posterior
y una app local en desarrollo con datos demo. Crea su propio cliente y pedidos; restaura los ajustes al acabar.
Usar **solo una base desechable**: no borra ni limpia datos existentes.

```bash
# En una terminal, desde la raíz del repositorio:
Storage__DataRoot="$(mktemp -d)" dotnet run --project src/Diversify.Delivery --launch-profile http
# En otra terminal:
ALLOW_DEMO_MUTATIONS=1 BASE=http://localhost:5390 node tests/seguridad-repartidor.cjs
```

No ejecutar en producción. El resultado esperado es `308 comprobaciones correctas`.

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

## Pago de la inscripción con PixelPay (`pago-pixelpay.cjs`)

Hosted Payment contra `pixelpay-simulado.cjs` (servidor local con las rutas, campos y firmas de la documentación de
PixelPay; rechaza una firma SHA3-512 inválida). Prueba: pago aprobado, cancelado, rechazado con reintento, cliente
que cierra la ventana (activa el aviso), aviso con monto distinto (queda en revisión), `paymentHash` y avisos
falsos, y la CSP estricta.

```bash
rm -rf src/Diversify.Delivery/data
PixelPay__Endpoint=http://localhost:5399 PixelPay__Key=prueba-key PixelPay__SecretKey=prueba-secreto \
  dotnet run --project src/Diversify.Delivery --launch-profile http &
node tests/pago-pixelpay.cjs
```

El simulado arranca solo dentro de la prueba (puerto 5399).

## Recuperar contraseña (`recuperar-contrasena.cjs`)

Sin servidor de correo, la app guarda los correos en `src/Diversify.Delivery/data/correos/*.eml`; la prueba toma el
enlace de ahí. Revisa: no revela si un correo tiene cuenta, el enlace llega y funciona, la contraseña anterior deja
de servir, se cierra la sesión de otro equipo, el enlace no sirve dos veces, uno nuevo invalida el anterior y el
máximo de 3 correos por hora.

```bash
Security__LoginAttemptsPerMinute=100 dotnet run --project src/Diversify.Delivery --launch-profile http &
node tests/recuperar-contrasena.cjs
```
