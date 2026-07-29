---
tags: [base-datos, indices, rendimiento]
---

# Índices

## Índices implementados

`negociacion_contratacion_usuario`:

```sql
CREATE INDEX IF NOT EXISTS idx_negociacion_contratacion_usuario_activo
    ON administrativo.negociacion_contratacion_usuario (activo);
```

- **Columna**: `activo`.
- **Propósito**: acelerar filtros de listado de usuarios activos (Módulo 8 — Administración, planificado). `username` ya tiene índice implícito por su restricción `UNIQUE`.

## Ausencia de índices en tablas SIE — restricción crítica de arquitectura

> [!danger] No confundir con un detalle menor
> Las tablas fuente de consumo real **no están indexadas para este caso de uso**, y esta es la razón de ser del ETL propio (ver [[Arquitectura General#2. Restricción de rendimiento que condiciona la arquitectura]]):

| Tabla | Filas aprox. | Índice sobre código/fecha |
|---|---:|---|
| `rips_ap` | ~177.7 M | No |
| `rips_am` | ~81.8 M | No |
| `rips_at` | ~60.1 M | No |
| `tb_tarifario_propio_detalle` | ~1.45 M | Solo por `consecutivo_cup/medicamento/insumo/paquete`, no por `codigo_tarifa` suelto |

**Implicación práctica**: cualquier query nueva contra estas tablas debe filtrar primero por período (`fecha_recepciona` u homólogo) para evitar un *sequential scan* completo, que puede disparar el timeout de gateway del proxy (ver [[Middleware#Problemas conocidos]]).

## Índices recomendados cuando se creen las tablas planificadas

| Tabla | Índice sugerido | Por qué |
|---|---|---|
| `negociacion_contratacion_snapshot_tarifario` | `(codigo, fecha_snapshot)` | Consulta de serie temporal por código — caso de uso central del Módulo 1 |
| `negociacion_contratacion_consumo_agregado` | `(prestador, codigo, periodo)` | Llave natural de agregación, consultada en Módulos 3-4 |
| `negociacion_contratacion_indicador_cache` | `(nombre_indicador)` (único) | Lectura puntual por KPI desde el Dashboard Ejecutivo |
| `negociacion_contratacion_log_auditoria` | `(usuario_id, fecha)` | Consulta de auditoría por usuario/rango de fecha |

> [!todo] No implementado
> Estos índices son una recomendación de este documento (buena práctica estándar), no una decisión ya tomada en `docs/ARQUITECTURA.md`. Deben confirmarse con el equipo de base de datos al escribir la migración real de cada tabla.

## Ver también
- [[Tablas]]
- [[Modelo ER]]
- [[Procedimientos]]
