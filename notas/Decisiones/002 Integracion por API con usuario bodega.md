# 002 · Integración con Diversify POS por su API, con un usuario de solo consulta

**Fecha:** 2026-11-09 · **Estado:** aceptada

## Contexto
El catálogo, los precios y las fotos ya están en Diversify POS. No se quiere tocar el POS ni compartir su base.

## Decisión
Delivery inicia sesión en Diversify POS con un usuario normal de rol `bodega` y lee `/api/categories` y
`/api/products`. Copia los datos a su base. Sincronización manual (botón) o cada N minutos.
El master puede fijar precios propios para la tienda en línea: esos ya no se sobrescriben.

## Consecuencias
- Cero cambios en Diversify POS.
- La tienda sigue funcionando aunque el POS esté caído (con la última copia).
- Los pedidos aún no viajan al POS (por decidir: facturación).
