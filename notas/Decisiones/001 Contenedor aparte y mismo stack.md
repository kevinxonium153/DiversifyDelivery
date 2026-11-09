# 001 · Contenedor aparte de Diversify POS, mismo stack

**Fecha:** 2026-11-09 · **Estado:** aceptada

## Contexto
Diversify POS ya corre en Proxmox. Delivery es público para clientes finales (más tráfico y más exposición) y no
debe poner en riesgo las cajas del supermercado.

## Decisión
- Contenedor LXC propio (`diversify-delivery`), base propia (`delivery.db`), túnel de Cloudflare propio.
- Mismo stack que Diversify POS: ASP.NET Core 10 + SQLite + JavaScript sin build, mismos scripts de despliegue.

## Consecuencias
- Si Delivery se cae o se actualiza, el POS sigue vendiendo (y al revés).
- Un solo conjunto de conocimientos para mantener los dos.
- La comunicación entre ambos va por HTTPS (ver 002).
