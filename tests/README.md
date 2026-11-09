# Pruebas

## Protección CSRF (`seguridad-csrf.cjs`)

```bash
dotnet build src/Diversify.Delivery -warnaserror
npm install --no-save playwright@1.49.1
npx playwright install --with-deps chromium
node tests/seguridad-csrf.cjs
```

Arranca su propia app demo en un puerto libre y una base en `test-results/csrf-*`; no usa producción.
Comprueba 58 condiciones: token ausente/falso, cookie o identidad incorrectas, origen distinto incluso con
token válido, Fetch Metadata, POST sin cuerpo, PUT/DELETE, login/logout, aviso de PixelPay y flujo legítimo.
En Chromium abre otro origen del mismo sitio, verifica con CDP que envió la cookie de la víctima y comprueba
que el pedido completo quedó intacto. También comprueba que el frontend no reintenta una escritura rechazada.

Los clientes HTTP de las otras suites usan `api-csrf.cjs`: obtienen tokens reales y conservan la cookie
antiforgery. No hay bypass de la protección en pruebas. El simulador de PixelPay conserva sus avisos firmados.

## Sesiones revocables (`seguridad-sesiones.cjs`)

Regresión S05: copia de cookie tras logout, independencia entre equipos, rotación al editar perfil, cambio de
contraseña, suspensión, vencimiento, renovación concurrente con logout y persistencia tras reinicios.
Simula una base anterior quitando únicamente la tabla de sesiones de su base desechable y verifica que se crea
de nuevo sin perder usuarios. La suite inicia y detiene sus propios procesos y usa un puerto libre.

```bash
dotnet build src/Diversify.Delivery -warnaserror
node tests/seguridad-sesiones.cjs
```

Requiere Node 22+, `dotnet` y `python3` (solo para ajustar fechas y simular el esquema anterior en la base de
prueba). Guarda datos de demostración en `test-results/sesiones-*`, ignorado por Git. No usa producción ni
SMTP. El resultado esperado es `71 comprobaciones correctas`. El límite de login se eleva únicamente en su
instancia desechable para poder probar varios equipos sin esperas; el valor de la aplicación no cambia.

## Seguridad del repartidor (`seguridad-repartidor.cjs`)

Regresiones S01, S02 y S03: acceso por ID según asignación y estado, PIN oculto, liberación solo en
Preparando/Listo y conservación de asignación, fechas e historial ante rechazos. Incluye 12 carreras entre dos
sesiones, alternando Preparando/Listo: exactamente un HTTP 200 y un 409, una sola asignación/evento y reintentos
idempotentes del ganador. Además ejecuta ocho ráfagas de ocho solicitudes con 0/1/2/3 pedidos pendientes:
el total persistido queda en tres, los rechazos no generan pedidos y el cupo se reutiliza al cancelar o preparar.
Requiere Node 22 o posterior
y una app local en desarrollo con datos demo. Crea su propio cliente y pedidos; restaura los ajustes al acabar.
Usar **solo una base desechable**: no borra ni limpia datos existentes.

```bash
# En una terminal, desde la raíz del repositorio:
Storage__DataRoot="$(mktemp -d)" dotnet run --project src/Diversify.Delivery --launch-profile http
# En otra terminal:
ALLOW_DEMO_MUTATIONS=1 BASE=http://localhost:5390 node tests/seguridad-repartidor.cjs
```

No ejecutar en producción. El resultado esperado es `580 comprobaciones correctas`.

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
