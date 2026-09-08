---
name: Reglas_de_Negocio
description: Todas las reglas de negocio por módulo — fórmulas, umbrales y validaciones
ultima_actualizacion: 2026-09-08
---

# 📐 Reglas de Negocio

---

## Módulo 1 — Tarifario Vigente e Histórico (`/tarifarios`)

### Vigencia de contrato
La vigencia se calcula por fecha, no por el campo `estado` (sin tabla maestra confiable):
```ts
function esContratoVigente(fechaInicio, fechaTerminacion) {
  const hoy = new Date()
  return new Date(fechaInicio) <= hoy && new Date(fechaTerminacion) >= hoy
}
```

### Resolución del valor final (`resolverValorFinal()`)
Prioridad en cascada:
1. `valor_pactado` si es > 0
2. `valor_base * (1 + porcentaje_tarifa/100)` si `valor_base` > 0 y hay % negociado
3. `valor_base` si es > 0 sin porcentaje
4. `valor` (columna general) como último recurso

### Clasificación de ítems del tarifario
| Tipo | Criterio |
|---|---|
| **Procedimiento** | `codigo_tarifa` coincide con `tb_cup.codigo_interno` Y `sw_paquete = 0` |
| **Otro** | No coincide con `tb_cup` Y `sw_paquete = 0` |
| **Paquete** | `sw_paquete = 1` |
| **Medicamento/Insumo** | Tarifarios distintos del contrato de procedimientos |

---

## Módulo 2 — Comparativo entre Prestadores (`/comparativo`)

### Regla de municipio
> La comparación es **SIEMPRE dentro del mismo municipio**. Mezclar prestadores de municipios distintos confunde variabilidad por ubicación con variabilidad por negociación. Campo: `ct_ips_contrato.municipio_administracion`.

### Solo donde la comparación es posible
Un municipio o código con un solo prestador no se muestra:
```sql
HAVING COUNT(DISTINCT c.ips) >= 2
```

### Deduplicación por mejor precio (`dedupMejorPrecio()`)
Si el mismo prestador tiene más de una fila para el mismo código, se toma el valor **más bajo** como su precio real. En `src/lib/negociacion/comparativo.ts`.

### Exclusión de contratos capitados
`valorFinal = 0` = ítem de contrato capitado, no dato faltante. Se descarta ANTES de calcular estadísticas para no inflar la amplitud. Si tras el descarte quedan menos de 2 prestadores, el código no se muestra.

### Referencia configurable: Promedio vs Mediana
Se calculan ambas. La UI expone un selector — cambiar la referencia reclasifica datos sin re-consultar la BD.

### Semáforo de variación (5 estados — la DIRECCIÓN importa)
| Estado | Condición | Interpretación |
|---|---|---|
| `"ok"` | Variación ≤ 1% (cualquier dirección) | Sin diferencia significativa |
| `"alerta"` | Cobra MÁS, variación 1–10% | Riesgo moderado |
| `"critico"` | Cobra MÁS, variación > 10% | Riesgo alto |
| `"favorable"` | Cobra MENOS, variación 1–10% | Positivo para Dusakawi |
| `"muyFavorable"` | Cobra MENOS, variación > 10% | Muy positivo |

> Umbrales `alertaPct` / `criticoPct` son configurables en la UI (por defecto 1% / 10%).

### Amplitud según referencia
`calcularEstadisticas()` devuelve `amplitudPctPromedio` Y `amplitudPctMediana`. El helper `amplitudSegunReferencia(fila, referencia)` es la única fuente de verdad — nunca dividir por Promedio cuando la referencia activa es Mediana.

---

## Dashboard de Riesgo Contractual (dentro de `/comparativo`)

### Score de Riesgo (0–100, heurístico)
```
componenteCriticas   = min(100, %críticas × 2)
componenteAlertas    = min(100, %alertas × 1.5)
componenteDesviacion = min(100, promedio |variación%| absoluta)
componenteAmplitud   = min(100, amplitud % promedio)

score = round(0.40×criticas + 0.20×alertas + 0.25×desviación + 0.15×amplitud)
```

| Rango | Nivel |
|---|---|
| < 25 | Bajo |
| 25–49 | Medio |
| 50–74 | Alto |
| ≥ 75 | Muy Alto |

> ⚠️ "Costo potencial adicional" y "Ahorro potencial" son estimados **por unidad tarifada**, NO proyectados por volumen real (el dashboard vive sobre el tarifario, no sobre RIPS reales).

---

## Módulo 3 — Histórico del Prestador (`/historico-prestador`)

### Códigos nuevos / eliminados
- **Solo en foto 2025** (eliminado): `variacionPct` / `nivel` = `null` — no entran en totales monetarios.
- **Solo en vigente** (nuevo): ídem — comparar contra la ausencia de dato produciría una variación falsa de ±100%/∞%.

---

## Módulo 4 — Consumo y Frecuencia (`/consumo-frecuencia`)

### Tope de seguridad: 92 días
`MAX_DIAS_RANGO_CONSUMO = 92 días` — evita timeout del proxy sobre tablas de cientos de millones de filas sin índice de fecha.

### Estrategia de consulta (filtrar tabla chica primero)
1. Filtrar `rips_af` (10.2M filas) por `codigo_prestador` + rango de fechas → lista de `consecutivo_rips`.
2. Usar esa lista como `WHERE consecutivo_rips = ANY($1)` en `rips_ap`/`rips_am`/`rips_at`.
3. Las 3 consultas de detalle corren **secuencialmente** (no `Promise.all`) para no saturar el proxy.

---

## Módulo Top Impacto Económico (`/top-impacto`)

### Factura canónica (deduplicación de lotes)
Entre copias de una misma factura, se elige la que tenga `fecha_radica IS NOT NULL`. Si ninguna la tiene, se incluye 1 copia arbitraria (desempate por `consecutivo_rips`).

### Drill-down optimizado
Cuando el drill-down Nivel 2 llama a `getTopImpacto` con `ips` fijo, pasar `{ soloPorCodigo: true }` para saltarse las sub-consultas de "top prestadores"/"top municipios" (que el drill-down nunca muestra).

### LEFT JOIN, nunca INNER JOIN hacia `ct_ips`
El 7.9% del valor en `rips_ap` 2026 EPS-completa tiene `codigo_prestador` sin fila en `ct_ips`. Con INNER JOIN ese valor desaparece en silencio. Con LEFT JOIN se etiqueta `"Código no registrado: <codigo>"`.

---

## Módulo Análisis de Propuesta (`/analisis-propuesta`)

- El archivo subido **NUNCA se persiste** en BD.
- El documento "Contrapropuesta" incluye identidad de terceros (razón social, NIT, número de contrato) — **revisar/editar antes de compartir externamente** con el prestador.
- `obtenerReferenciasMercadoEps`: si la tabla `negociacion_contratacion_precio_referencia_eps` no existe, captura el error y sigue el análisis sin esa referencia (no bloquea la evaluación).

---

## Módulo Precios de Referencia EPS (`/precio-referencia-eps`)

- Upsert (no historial): misma clave `(nit_entidad, municipio_codigo, codigo)` actualiza el precio existente.
- Resolución de municipio: texto libre → código DANE. Si el nombre es ambiguo (varios municipios con el mismo nombre en distintos departamentos), la fila NO se carga y se reporta en `municipiosNoResueltos`.
- El botón "Aplicar migración" requiere rol `admin` — único lugar donde `tieneRolMinimo()` se invoca actualmente.
- DDL embebido en `aplicarMigracionPrecioReferenciaEps` debe mantenerse **idéntico** al de `db/migrations/002_precio_referencia_eps.sql`.
