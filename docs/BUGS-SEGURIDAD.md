# Estado de los hallazgos de seguridad

Actualizado: 9 de noviembre de 2026. Rama: beta. La auditoría inicial examinó master (a286c42).
Los estados siguientes indican correcciones y pruebas locales integradas en beta; no un despliegue en producción
ni una nueva auditoría exhaustiva de todos los cambios de beta.

## Inventario

| ID | Prioridad original | Hallazgo | Estado en beta | Evidencia / solución |
|---|---|---|---|---|
| S01 | Alta | Acceso del repartidor a pedidos no disponibles y liberación de cerrados | Corregido | [Solución S01](SOLUCION-SEGURIDAD-S01.md); acceso por estado, rechazo sin cambios en el historial |
| S02 | Media | Dos repartidores toman simultáneamente el mismo pedido | Corregido | [Solución S02](SOLUCION-SEGURIDAD-S02.md); 12 carreras con un ganador 200 y un conflicto 409 |
| S03 | Media | Se supera el máximo de tres pedidos pendientes | Corregido | [Solución S03](SOLUCION-SEGURIDAD-S03.md); ocho ráfagas de ocho peticiones con cupos iniciales distintos |
| S04 | Media, con control de otro origen del mismo sitio | CSRF usando la sesión de la víctima | Corregido | [Solución S04](SOLUCION-SEGURIDAD-S04.md); 58 comprobaciones y ataque real en Chromium con cookie, sin cambios persistidos |
| S05 | Media, requiere cookie válida copiada | La cookie copiada sobrevive al cierre de sesión | Corregido | [Solución S05](SOLUCION-SEGURIDAD-S05.md); 71 comprobaciones, revocación persistente y reinicios |
| S06 | Media | Un usuario puede acumular solicitudes de transferencia sin un límite específico | Pendiente | Limitar a una solicitud pendiente, cuotas por cuenta/IP, idempotencia y restricciones de base de datos |
| S07 | Baja | Se acepta un método de pago inexistente, como 999 | Pendiente | Rechazar valores fuera del enum y validar las reglas por método |
| S08 | Baja | Se aceptan imágenes inválidas que producen errores públicos 500 | Pendiente | Validar Base64, formato real y tamaño al cargar/importar, y normalizar imágenes de POS |

## Pruebas verificadas tras S04

- 580 comprobaciones de S01/S02/S03 con el protocolo CSRF activo.
- 71 comprobaciones de sesiones S05 con el protocolo CSRF activo.
- 58 comprobaciones S04: API, Chromium, origen distinto, cookie real, pedido intacto y operaciones legítimas.
- Compilación con -warnaserror, JavaScript y ShellCheck.
- Recorrido completo de compra y entrega, recuperación de contraseña y PixelPay contra simulador local.
- Los avisos válidos de PixelPay funcionan sin token de navegador; las firmas falsas no activan cuentas.

Las credenciales y tokens utilizados fueron de demostración. No se hicieron pagos reales ni pruebas contra producción.
El CI remoto se ejecuta después del push; los resultados aquí son los comprobados en esta instancia.

## Despliegue y asuntos operativos pendientes

- Desplegar las correcciones S01–S05 en todas las instancias y validar con cuentas de prueba.
- Actualizar conjuntamente backend y frontend: los clientes de escritura necesitan token CSRF.
- S05 obliga a iniciar sesión de nuevo con las cookies anteriores a esa protección.
- Corregir las rutas a delivery.env de systemd y actualización; verificar el paquete en un entorno desechable.
- Verificar la IP real detrás de Caddy/Cloudflare, impedir acceso directo a Kestrel y revisar límites por cuenta.
- Usar generación criptográfica de PIN y límites de intentos por pedido/cuenta.
- La advertencia CS9113 ya estaba corregida al integrar beta; no queda como bug pendiente.

Los asuntos de producto, configuración y demás tareas se conservan en [Pendientes](../notas/Pendientes.md).
