# Diversify Delivery · Boceto y funcionalidades

Capturas tomadas de la app funcionando (no son maquetas), con los datos de demostración del negocio ficticio
"Súper La Esperanza". Los productos muestran un emoji mientras no tienen foto; con la conexión a Diversify POS
llegan las fotos reales de cada producto.

Las genera `node tests/e2e-capturas.cjs`, así que se pueden volver a tomar después de cada cambio de diseño.

## Flujo completo

```mermaid
sequenceDiagram
    actor C as Cliente
    participant T as Tienda en línea
    actor M as Master
    actor R as Repartidor
    participant POS as Diversify POS
    POS-->>T: productos, precios, existencias y fotos (sincronización)
    C->>T: Se registra y paga la inscripción ($5)
    C->>T: Arma el carrito y hace el pedido (dirección + GPS + instrucciones)
    T-->>C: Código de entrega de 4 dígitos
    M->>T: Empieza a armar · ajusta lo que no hay · marca "Listo"
    R->>T: Toma el pedido (o el master se lo asigna)
    R->>T: "Recogí el pedido · voy en camino"
    T-->>C: Seguimiento en vivo: "Tu pedido va en camino"
    C->>R: Le dicta el código al recibir
    R->>T: Confirma la entrega con el código
```

Estados del pedido: **Recibido → Preparando → Listo → En camino → Entregado** (o Cancelado).

---

## 1. Tienda en línea (cliente final)

| Inicio (celular) | Registro | Inscripción de US$5 |
|---|---|---|
| ![](capturas/01-tienda-inicio-celular.png) | ![](capturas/02-registro-celular.png) | ![](capturas/03-inscripcion-5-dolares.png) |

| Catálogo con carrito | Carrito | Dirección con GPS |
|---|---|---|
| ![](capturas/04-catalogo-con-carrito.png) | ![](capturas/05-carrito.png) | ![](capturas/06-direccion-con-gps.png) |

| Seguimiento con código de entrega | Pedido entregado |
|---|---|
| ![](capturas/08-seguimiento-pedido.png) | ![](capturas/09-pedido-entregado.png) |

Confirmar pedido (pantalla completa): [07-confirmar-pedido.png](capturas/07-confirmar-pedido.png)

Escritorio, claro y oscuro:

![Tienda en escritorio](capturas/31-tienda-escritorio.png)
![Tienda en modo oscuro](capturas/30-tienda-escritorio-oscuro.png)

**Funciones**

- **Catálogo público:** cualquiera ve productos y precios sin cuenta. Portada con ofertas (precio anterior tachado
  y % de descuento), lo más pedido y una fila por categoría. Búsqueda por nombre, código o código de barras.
- **Registro + inscripción de US$5, pago único** (se muestra también en lempiras con el tipo de cambio del master):
  - **Tarjeta con PixelPay:** página de pago propia con el SDK oficial; la tarjeta va cifrada directo a PixelPay
    (la app nunca la ve ni la guarda). Aprobación inmediata, con verificación en el servidor. Ver
    [PIXELPAY.md](PIXELPAY.md).
  - **Transferencia/depósito:** el cliente escribe la referencia y el master la aprueba al verla en el banco.
  - Sin inscripción pagada se puede ver todo y llenar el carrito, pero no pedir.
- **Carrito** guardado en el celular: por libra se pide de media en media libra; aviso de cuánto falta para el
  envío gratis y del pedido mínimo.
- **Direcciones** con nombre (Casa, Trabajo), colonia, referencias ("portón negro frente a la pulpería") y
  **ubicación GPS** con un toque. La ubicación solo la ve el repartidor de ese pedido.
- **Confirmar pedido:** instrucciones para el repartidor y para quien arma, permitir o no sustituciones, y forma de
  pago: efectivo (con cuánto paga, para llevar cambio), tarjeta con POS al recibir, o transferencia.
- **Seguimiento en vivo** (se actualiza solo): barra de estados, historial, datos del repartidor con botones para
  llamar o escribir por WhatsApp, productos que no había (no se cobran) y **código de entrega**.
- Puede cancelar mientras el pedido no se empieza a armar.
- Horario de pedidos y pausa de la tienda (el master la controla).

## 2. Panel del master

![Tablero](capturas/10-panel-tablero.png)
![Pedidos en tablero kanban](capturas/11-panel-pedidos-kanban.png)
![Detalle del pedido](capturas/12-panel-detalle-pedido.png)
![Productos y precios](capturas/13-panel-productos-precios.png)
![Nuevo producto](capturas/14-panel-nuevo-producto.png)
![Clientes e inscripciones](capturas/15-panel-clientes-inscripciones.png)
![Repartidores](capturas/16-panel-repartidores.png)
![Ajustes](capturas/17-panel-ajustes.png)

**Funciones**

- **Tablero:** pedidos y ventas del día, ticket promedio, tiempo promedio de entrega, repartidores en turno,
  pedidos por estado y gráfico de los últimos 7 días. Aviso de inscripciones por revisar.
- **Pedidos (kanban):** columnas Recibido / Preparando / Listo / En camino, actualización cada 15 s, pedidos con
  más de 45 min en rojo, contador de nuevos en el menú. En el detalle:
  - Ajustar lo que se despacha (0 = no había) y recalcular el total.
  - Asignar o cambiar repartidor.
  - Avanzar estado, cancelar con motivo (el cliente lo ve).
  - Llamar o escribir por WhatsApp al cliente, ver la ubicación en el mapa, ver el código de entrega.
  - Historial de todo lo que pasó. Pestaña **Historial** con búsqueda por número, cliente, teléfono, estado y fecha.
- **Productos y precios:**
  - Alta y edición con foto (se reduce sola a 800 px), categoría, unidad, ISV (0/15/18 %), código, código de
    barras, descripción, visible/oculto y destacado.
  - **Cambio rápido de precio** en la misma tabla (escribir y Enter).
  - **Precio de oferta** (precio anterior tachado).
  - **Ajuste masivo por porcentaje** (toda la tienda o una categoría, con redondeo a L 0.50).
  - **Historial de precios** por producto (quién, cuándo, de cuánto a cuánto).
  - Categorías con emoji, orden y visibilidad.
- **Clientes e inscripciones:** transferencias por verificar (aprobar/rechazar con motivo), lista de clientes con
  estado, pedidos entregados y total comprado; suspender o reactivar.
- **Repartidores y usuarios:** crear repartidores (con vehículo/placa) y otros usuarios master, ver quién está en
  turno, pedidos activos y entregados hoy, suspender o cambiar contraseña.
- **Ajustes:** nombre, teléfono y dirección del súper; horario; pausa; costo de envío, pedido mínimo, envío gratis
  desde; monto de la inscripción y tipo de cambio; datos bancarios; estado y botón de **sincronizar con
  Diversify POS**.

## 3. App del repartidor (celular)

| Disponibles | Mi entrega | Confirmar con el código |
|---|---|---|
| ![](capturas/20-repartidor-disponibles.png) | ![](capturas/21-repartidor-mi-entrega.png) | ![](capturas/22-repartidor-codigo-entrega.png) |

**Funciones**

- **En turno / fuera de turno.** En turno ve los pedidos disponibles y recibe aviso (y vibración) cuando hay uno
  nuevo.
- **Disponibles:** pedidos listos o armándose sin repartidor, con colonia, referencias, instrucciones, monto y
  distancia desde donde está. "Tomar pedido" (si otro lo tomó primero, se le avisa).
- **Mis entregas:** dirección completa, referencias e **instrucciones resaltadas**; cuánto cobrar y **cuánto cambio
  llevar**; botones **Google Maps**, **Waze**, **Llamar** y **WhatsApp**; lista de productos para revisar al
  recoger (sin lo que no había).
- **"Recogí el pedido · voy en camino"** avisa al cliente.
- **Entregar:** pide el **código de 4 dígitos** que el cliente ve en su pedido. Sin el código correcto no se
  marca entregado (evita entregas falsas o a la persona equivocada). El repartidor no puede ver el código.
- **Historial** de los últimos 30 días.

## 4. Seguridad y operación

- Igual que Diversify POS: CSP estricta (sin CDN), cookies `HttpOnly` y `Secure`, límite de intentos de login,
  sesión que se cierra al suspender o cambiar contraseña, y la app no arranca en producción con contraseñas de
  ejemplo, datos demo o pasarela simulada.
- Contenedor LXC propio en Proxmox, servicio aislado, respaldo diario de la base con revisión de integridad,
  actualización con respaldo y vuelta atrás automática.

## Por definir (preguntas para el dueño del proyecto)

Ver la lista actualizada en [notas/Pendientes.md](../notas/Pendientes.md).
