# Bugs conocidos

Revisión completa del código (backend, tienda, panel, app del repartidor y scripts de despliegue) del
**2026-11-10**, sobre la rama `beta` (commit `d6cfcb2`, que ya incluye las correcciones de seguridad S01–S05).

Se complementa con el inventario de seguridad de Kevin, [docs/BUGS-SEGURIDAD.md](../docs/BUGS-SEGURIDAD.md)
(S01–S08). Cuando un bug coincide con uno de esa lista, se indica aquí.

**Cómo se verificó** cada bug (columna *Verificado*):
- **Reproducido**: se provocó en la app corriendo o con el script real.
- **Código**: se encontró leyendo el código. No se reprodujo, pero la causa está identificada.

Al corregir uno, márcalo con ~~tachado~~ y anota el commit.

## Resumen

| # | Gravedad | Área | Bug | Verificado |
|---|---|---|---|---|
| [B01](#b01) | 🔴 Crítico | Despliegue | El servicio no arranca: ruta del `.env` equivocada en systemd | Código |
| [B02](#b02) | 🔴 Crítico | Despliegue | `update.sh` (y `publicar.sh`) se detienen siempre: misma ruta equivocada | Reproducido |
| [B03](#b03) | 🟠 Alto | Sincronización | Un error en la sincronización con Diversify POS apaga toda la app | Reproducido |
| [B04](#b04) | 🟠 Alto | Privacidad | La lista "Disponibles" da a todos los repartidores el teléfono y el GPS del cliente (el resto lo corrigió S01) | Reproducido |
| ~~[B05](#b05)~~ | ✅ Corregido | Pedidos | ~~Dos repartidores toman el mismo pedido~~ → S02 (`8bfd1f3`) | Reproducido |
| [B06](#b06) | 🟠 Alto | Seguridad | "Olvidé mi contraseña" revela qué correos tienen cuenta (por el tiempo de respuesta) | Código |
| [B07](#b07) | 🟡 Medio | Catálogo | La búsqueda no encuentra nombres con mayúsculas acentuadas (AZÚCAR, JAMÓN) | Reproducido |
| ~~[B08](#b08)~~ | ✅ Corregido | Repartidor | ~~Soltar un pedido entregado o cancelado~~ → S01 (`bc24bbf`) | Reproducido |
| [B09](#b09) | 🟡 Medio | Pedidos | Se puede pedir más cantidad de la que hay en existencia | Código |
| [B10](#b10) | 🟡 Medio | Pedidos | El ajuste del master acepta media unidad en productos por unidad | Reproducido |
| [B11](#b11) | 🟡 Medio | Panel | Borrar la cantidad en el ajuste marca el producto como "no había" | Código |
| [B12](#b12) | 🟡 Medio | Tienda | El seguimiento del pedido sigue actualizándose después de salir y tapa otras páginas | Código |
| [B13](#b13) | 🟡 Medio | Catálogo | Sin paginación: se ven máx. 200 productos por categoría/búsqueda (500 en el panel) | Código |
| [B14](#b14) | 🟡 Medio | Sincronización | Un producto que se reactiva en Diversify POS nunca vuelve a la tienda | Código |
| [B15](#b15) | 🟡 Medio | Sincronización | La sincronización deshace los cambios del master en nombre, código y categoría | Código |
| [B16](#b16) | 🟡 Medio | Sincronización | La sincronización carga todas las fotos en memoria (riesgo con 1 GB de RAM) | Código |
| [B17](#b17) | 🟡 Medio | Despliegue | `restore.sh --con-config` falla a medias y deja el servicio apagado | Código |
| [B18](#b18) | 🟡 Medio | Tienda | Si un producto del carrito se oculta, el pedido falla sin decir cuál | Código |
| [B19](#b19) | 🟢 Bajo | Panel | Después de cerrar sesión, la pantalla de ingreso se reinicia sola cada 30 s | Código |
| [B20](#b20) | 🟢 Bajo | Repartidor | Al cambiar de pestaña rápido se puede ver una lista con los botones de otra | Código |
| [B21](#b21) | 🟢 Bajo | Seguridad | Código de entrega: generador no criptográfico y sin límite de intentos por pedido (también en BUGS-SEGURIDAD) | Código |
| [B22](#b22) | 🟢 Bajo | Seguridad | Sin SMTP en producción, los enlaces de recuperación quedan guardados en disco | Código |
| [B23](#b23) | 🟢 Bajo | Inscripciones | Aprobar un pago reactiva a un cliente suspendido; rechazar ignora otro pago en revisión | Código |
| [B24](#b24) | 🟢 Bajo | Direcciones | Se puede quedar sin dirección principal | Código |
| [B25](#b25) | 🟢 Bajo | Tienda | Un corte de red muestra "No encontramos ese pedido" y deja de actualizar | Código |
| [B26](#b26) | 🟢 Bajo | Sincronización | Las fotos que llegan de Diversify POS no se validan (= S08) | Código |
| [B27](#b27) | ⚪ Menor | Documentación | Referencias que no existen (`IPaymentGateway`, `deploy/README.md`) | Código |

---

## 🔴 Críticos

### B01
**El servicio no arranca en el servidor.** `deploy/systemd/diversify-delivery.service:13` dice
`EnvironmentFile=/etc/diversify-delivery-delivery/delivery.env`, pero `install.sh` crea
`/etc/diversify-delivery/delivery.env` ("delivery" repetido, de un buscar y reemplazar de Diversify POS). systemd no
encuentra el archivo y el servicio falla, así que `install.sh` termina con "Diversify Delivery no respondió".
- **Arreglo:** `EnvironmentFile=/etc/diversify-delivery/delivery.env`. Agregar al CI una prueba que compare las
  rutas de `install.sh` con las del `.service`.
- Figura como pendiente en "Despliegue y asuntos operativos" de `docs/BUGS-SEGURIDAD.md`.

### B02
**Toda actualización se detiene al empezar.** `deploy/update.sh:19` lee el puerto de la misma ruta equivocada. Con
`set -euo pipefail`, el `sed` sobre un archivo que no existe termina el script (código 2) antes del respaldo.
`publicar.sh` usa `update.sh`, así que tampoco se puede publicar.
- **Reproducido:** `bash -c 'set -euo pipefail; P="$(sed -n p /etc/diversify-delivery-delivery/delivery.env)"'`
  sale con código 2.
- También: `deploy/proxmox/crear-contenedor.sh:15` documenta el nombre por defecto como
  `diversify-delivery-delivery` (el valor real, línea 29, está bien).
- **Arreglo:** corregir la ruta y buscar `delivery-delivery` en todo el repositorio.

## 🟠 Altos

### B03
**Un error en la sincronización con Diversify POS apaga toda la app.** `DiversifySyncWorker`
(`Modules/DiversifySync.cs:173`) no atrapa los errores que `RunAsync` no espera. En .NET, un `BackgroundService`
que falla **detiene el servidor completo** (`BackgroundServiceExceptionBehavior.StopHost`). systemd lo reinicia y
vuelve a caer, en bucle cada ~25 s: la tienda queda caída.
- **Reproducido:** con `Diversify__BaseUrl=pos.ejemplo.hn` (sin `https://`), 20 s después de arrancar el registro
  muestra `UriFormatException` y "the IHost instance is stopping".
- Otras causas posibles: un producto sin `Code`, `Name` o `Unit` en la respuesta del POS, o un error de la base al
  guardar (`DbUpdateException`).
- **Arreglo:**
  - En el worker, `try/catch (Exception)` alrededor de cada ciclo, con registro del error.
  - En `RunAsync`, atrapar cualquier excepción y guardarla en `LastSyncResult`.
  - Validar `Diversify:BaseUrl` al arrancar (en producción, igual que las otras validaciones).

### B04
**La lista "Disponibles" da a todos los repartidores los datos personales del cliente.** Esto contradice lo que
se le dice al cliente: "Tu ubicación solo se comparte con el repartidor de tu pedido".
- **Ya corregido por S01:** el detalle por número de pedido (`Orders.cs:396`) solo responde pedidos propios o
  disponibles.
- **Sigue pendiente:**
  - La lista "Disponibles" (`Orders.cs:386`) y el detalle de un pedido disponible devuelven el pedido completo a
    **todos** los repartidores, aunque estén fuera de turno.
  - Incluye nombre, teléfono, dirección, referencias, GPS y productos del cliente, antes de que nadie lo tome.
- **Reproducido en `d6cfcb2`:** `GET /api/driver/orders?scope=available` devuelve `deliveryName`, `deliveryPhone`,
  `latitude` y `longitude` de cada pedido disponible. El detalle del pedido 6 (Recibido) ya responde 404.
- **Arreglo:**
  - Para pedidos no asignados, devolver un resumen: colonia, distancia aproximada, monto, instrucciones y número
    de productos.
  - El teléfono, el nombre, la dirección exacta y el GPS, solo al repartidor que lo tomó.
  - Exigir `OnDuty` para ver y tomar disponibles.

### B05
✅ **Corregido en `8bfd1f3` (S02):** asignación condicional atómica; el segundo recibe 409. Se deja el detalle
como referencia.

**Dos repartidores pueden tomar el mismo pedido.** `take` (`Orders.cs:402`) lee el pedido, revisa que
`DriverId` sea nulo y guarda. No hay control de concurrencia, así que dos peticiones simultáneas pasan la
revisión. Las dos reciben "Pedido tomado" y solo una queda guardada: un repartidor sale a buscar un pedido que no
es suyo.
- **Reproducido:** dos repartidores tomando el pedido 4 al mismo tiempo. En 4 de 5 intentos **los dos** recibieron
  200 "Pedido tomado".
- **Arreglo:** actualización condicional con
  `ExecuteUpdateAsync(... WHERE Id = @id AND DriverId IS NULL)` y revisar las filas afectadas, o un token de
  concurrencia en `Order`. Lo mismo vale para `assign`, `release`, `pickup` y los cambios de estado.

### B06
**"Olvidé mi contraseña" revela qué correos tienen cuenta.** La respuesta es la misma, pero
`PasswordResetEndpoints.cs:62` espera a que el correo se envíe por SMTP (de 0,5 a 3 s, o hasta 100 s si el
servidor no responde). Si el correo no existe, responde al instante. Midiendo el tiempo se sabe quién es cliente.
- **Arreglo:** enviar el correo en segundo plano, con una cola (`Channel<EmailMessage>` + `BackgroundService`), y
  responder de inmediato en los dos casos. Así tampoco se cuelga la petición si el SMTP no responde.

## 🟡 Medios

### B07
**La búsqueda no encuentra nombres con mayúsculas acentuadas.** `CatalogEndpoints.cs:43` (tienda) y `:113`
(panel) comparan `p.Name.ToLower()` con el texto ya en minúsculas en C#. En SQLite, `lower()` solo convierte A–Z:
"AZÚCAR" queda "azÚcar" y no coincide con "azúcar". Diversify POS suele guardar los nombres en MAYÚSCULAS, así que
afecta a muchos productos sincronizados. Tampoco encuentra "azucar" sin tilde.
- **Reproducido:** con el producto "AZÚCAR MORENA 2 LB", las búsquedas "azúcar morena", "AZÚCAR MORENA" y
  "azucar" dan 0 resultados.
- **Arreglo:** guardar una columna `SearchName` (minúsculas y sin tildes, calculada en C#) y buscar sobre ella.
  Normalizar el texto buscado igual.

### B08
✅ **Corregido en `bc24bbf` (S01):** solo se sueltan pedidos en Preparando o Listo.

**Un repartidor puede "soltar" un pedido entregado o cancelado.** `release` (`Orders.cs:416`) solo bloquea En
camino. Sobre un pedido cerrado le quita el repartidor: desaparece de su historial y de "Entregados hoy", y el
pedido queda sin responsable.
- **Reproducido:** `POST /api/driver/orders/1/release` sobre DD-000001 (Entregado) devuelve 200 y
  `driverId: null`.
- **Arreglo:** permitir soltar solo en Preparando y Listo.

### B09
**Se puede pedir más de lo que hay en existencia.** `Orders.cs:195` solo rechaza si `Stock <= 0`. Con 2 unidades
en el POS se puede pedir 20. El master se entera al armar el pedido.
- **Arreglo:** rechazar si `qty > Stock` (cuando `Stock` no es nulo) con el mensaje "Solo quedan N". En la tienda,
  limitar el botón + a la existencia.

### B10
**El ajuste del master acepta fracciones en productos por unidad.** `PUT /api/admin/orders/{id}/items`
(`Orders.cs:317`) solo revisa que la cantidad no sea negativa. Además, el campo del panel tiene `step="0.5"` para
todo.
- **Reproducido:** "Aguacate hass" (UND) se ajusta a 0.5 y se cobra L 12.50.
- Tampoco limita a la cantidad pedida: se puede despachar y cobrar más de lo que pidió el cliente.
- **Arreglo:** exigir enteros salvo en LB y KG, y poner un tope razonable (por ejemplo, no más que lo pedido salvo
  en productos por peso). En el panel, `step` según la unidad.

### B11
**Borrar la cantidad en el ajuste marca el producto como "no había".** `panel/orders.js:116` usa
`Number(i.value)`, y un campo vacío da 0. Si el master borra el número para escribir otro y guarda, el producto
sale del pedido y no se cobra.
- **Arreglo:** si el campo está vacío, mandar `null` (sin cambio) o no dejar guardar.

### B12
**El seguimiento del pedido sigue corriendo después de salir de la página y tapa otras.**
`tienda/orders.js:23` se actualiza cada 20 s. Si el cliente navega mientras una consulta está en curso, la
limpieza ya corrió. Al llegar la respuesta, el pedido se dibuja **encima de la página nueva** y programa otra
actualización que ya nadie detiene. En celulares con datos lentos es fácil que pase.
- La causa de fondo es el enrutador de la tienda (`tienda/app.js:51`): no descarta el resultado de una página si
  mientras tanto se navegó a otra.
- **Arreglo:** un número de navegación en `route()`. Cada página revisa que siga vigente antes de escribir en
  `view`, y `load()` no reprograma si se canceló.

### B13
**Sin paginación en el catálogo ni en el panel.**
- **Categoría y búsqueda** (`tienda/catalog.js:111`): se piden máx. 200 productos y se muestra "350 productos",
  pero solo se ven 200.
- **Portada** (`tienda/catalog.js:93`): toma los primeros 200 de toda la tienda. Las categorías que quedan después
  no aparecen.
- **Panel** (`CatalogEndpoints.cs:117`): muestra 500 productos. El resto solo se encuentra buscando.
- Un súper sincronizado con Diversify POS pasa esos números fácilmente.
- **Arreglo:** "Ver más" o scroll infinito con `offset`. En la portada, pedir cada fila por categoría
  (`categoryId`, `limit 10`).

### B14
**Un producto que se reactiva en Diversify POS nunca vuelve a la tienda.** La sincronización
(`DiversifySync.cs:146` y `:152`) oculta los productos inactivos o borrados en el POS, pero nunca los vuelve a
mostrar. Un producto desactivado un día por error queda oculto para siempre, salvo que el master lo encuentre y lo
reactive a mano.
- **Arreglo:** guardar por qué se ocultó (`HiddenBySync`) y reactivar solo los que ocultó la sincronización. Los
  que ocultó el master se respetan.

### B15
**La sincronización deshace lo que el master corrige en productos del POS.** En cada sincronización
(`DiversifySync.cs:138-144`) se pisan el nombre, el código, el código de barras, la unidad, el ISV y la categoría.
El panel permite editarlos sin avisar que se perderán en ≤15 min (solo el precio queda fijo).
- **Arreglo:**
  - En el panel, bloquear esos campos en productos de Diversify, o avisar.
  - Alternativa: banderas `NameLocked` y `CategoryLocked`, como `PriceLocked`.

### B16
**La sincronización carga todas las fotos en memoria.** El listado de productos de Diversify POS incluye
`ImageData`: se revisó en `Diversifyfin1/betas`, `CatalogModule.Project`. Se piden 2000 productos por página, con
fotos de hasta 400 KB cada uno (`DiversifySync.cs:90`), y además se cargan en memoria todos los productos locales
con sus fotos (`db.Products.ToListAsync()`).
- Con muchas fotos son cientos de MB por ciclo, en un contenedor de 1 GB. El riesgo es que el sistema mate el
  proceso por falta de memoria.
- **Arreglo:**
  - Pedir el listado sin fotos (un parámetro en el POS o un endpoint aparte) y bajar solo las fotos que
    cambiaron.
  - Páginas más chicas.
  - No cargar `ImageData` de los productos locales (proyección).

### B17
**`restore.sh --con-config` falla a medias.** `deploy/restore.sh:46` hace `chown root:diversify`, pero el grupo
es `diversify-delivery` (otra herencia de Diversify POS). Con `set -e` el script termina **después** de detener el
servicio y copiar los datos, pero **antes** de `systemctl start`: la tienda queda apagada.
- La línea 4 (ejemplo) también usa el nombre de archivo `diversify-…` en lugar de `diversify-delivery-…`.
- **Arreglo:** `chown root:diversify-delivery`. Iniciar el servicio en un `trap` aunque algo falle.

### B18
**El carrito no avisa qué producto ya no está.** Si el master oculta un producto que está en carritos guardados,
el pedido falla con "Un producto del carrito ya no está disponible" (`Orders.cs:194`), sin decir cuál. El
carrito tampoco lo detecta: `refreshCartPrices` solo actualiza precios de lo que se ve en pantalla.
- En el resumen del pedido, los precios pueden ser los viejos del carrito. El servidor cobra el vigente y el total
  confirmado no coincide con lo que vio el cliente.
- **Arreglo:**
  - Un endpoint `POST /api/catalog/cart` que reciba los ids y devuelva precio, disponibilidad y existencia.
  - Llamarlo al abrir el carrito y la confirmación: quitar o marcar lo que no hay y avisar los cambios de precio.
  - En el error, nombrar el producto.

## 🟢 Bajos

### B19
**Después de cerrar sesión, el panel reinicia la pantalla de ingreso cada 30 s.** El cierre de sesión
(`panel/app.js:58`) no detiene el contador del menú ni la actualización de la página abierta. Cada 30 s
`/admin/dashboard` responde 401 y se dibuja de nuevo el ingreso con "Tu sesión terminó", borrando lo que se estaba
escribiendo. Pasa lo mismo cuando expira la sesión (`:99`).
- **Arreglo:** `clearInterval(countsTimer)` y llamar a `cleanup()` al cerrar sesión y en el manejador de 401.

### B20
**App del repartidor: carrera al cambiar de pestaña.** `load()` (`repartidor/app.js:107`) no descarta respuestas
viejas. Si se cambia de pestaña mientras corre la actualización de 15 s, puede dibujarse la lista de una pestaña
con los botones de otra (por ejemplo, el historial con "Tomar pedido").
- **Arreglo:** número de petición. Dibujar solo si `tab` no cambió.

### B21
**Código de entrega débil.**
- Se genera con `Random.Shared` (`Orders.cs:188`), que no es criptográfico.
- El único freno a probar códigos es el límite de 10 por minuto **por IP** (`Orders.cs:468`), compartido con el
  login. Por eso los repartidores que usan el wifi de la tienda se bloquean entre sí.
- **Arreglo:** `RandomNumberGenerator.GetInt32(1000, 10000)` y contar los intentos fallidos por pedido (por
  ejemplo, 5; después, que lo confirme el master).

### B22
**Sin SMTP en producción, los enlaces de recuperación quedan en disco.** Sin `Email:Host`, `Core/Email.cs:53`
guarda los correos (con enlaces válidos por 1 hora) en `/var/lib/diversify-delivery/data/correos`. El cliente ve
"te enviamos un enlace" aunque no llegó nada.
- **Arreglo:** en producción, sin SMTP, no guardar el correo. Solo registrar el aviso, o devolver un mensaje que
  indique escribir al supermercado.

### B23
**Inscripciones: estados que se pisan.**
- Aprobar un pago, a mano (`RegistrationEndpoints.cs:240`) o por PixelPay (`:42`), pone la cuenta en Activo
  **aunque el master la haya suspendido**.
- Rechazar un pago (`:254`) devuelve la cuenta a "Pendiente de pago" aunque haya **otro** pago en revisión.
- **Arreglo:** no tocar cuentas suspendidas. Al rechazar, revisar si quedan otros pagos en revisión.

### B24
**Se puede quedar sin dirección principal.**
- Al borrar la dirección principal, ninguna otra pasa a serlo.
- Al editarla y desmarcar "principal", tampoco (`Orders.cs:138-156`).
- **Arreglo:** si no queda ninguna principal, marcar la más reciente.

### B25
**Un corte de red en el seguimiento del pedido.** Si una de las actualizaciones de 20 s falla
(`tienda/orders.js:24`), la página cambia a "No encontramos ese pedido" y deja de actualizarse.
- **Arreglo:** si ya se mostró el pedido, conservarlo, mostrar "Sin conexión, reintentando…" y seguir intentando.

### B26
**Las fotos de Diversify POS no se validan.** `DiversifySync.cs:147` guarda `ImageData` tal como llega, sin pasar
por `Text.Image`. Así se aceptaría un tipo distinto de PNG, JPEG o WebP, por ejemplo SVG.
- `/api/catalog/images/{id}` (`CatalogEndpoints.cs:65`) da error 500 si al dato le falta el `;`.
- **Arreglo:** validar con `Text.Image` (ignorar la foto si no pasa). Es el mismo hallazgo que S08 de
  `docs/BUGS-SEGURIDAD.md`, que además cubre las imágenes subidas desde el panel.

## ⚪ Menores

### B27
**Documentación desactualizada.**
- `CLAUDE.md` menciona `IPaymentGateway`, que no existe.
- `deploy/systemd/diversify-delivery.service:3` apunta a `deploy/README.md`, que no existe.

## Para decidir (no son bugs, pero conviene definirlos)

- **Existencia de Diversify POS:** se usa la de la sucursal del usuario de sincronización (o la Principal). Si el
  POS vende con existencia negativa o no lleva inventario de algunos productos, en la tienda salen "Agotado".
- **El master marca "Entregado" sin código** desde el panel. Tiene sentido como respaldo, pero conviene que quede
  el motivo en el historial.
- **Cobro doble de la inscripción:** si el cliente abre el pago en dos pestañas y paga en las dos, se aprueban las
  dos y no hay flujo de reembolso.
