---
name: Convenciones_y_Reglas_Criticas
description: Reglas que NUNCA se pueden romper — convenciones de código, SQL y arquitectura obligatorias
ultima_actualizacion: 2026-09-08
---

# 🚨 Convenciones y Reglas Críticas

> **Estas reglas no son sugerencias.** Violarlas genera bugs silenciosos, datos inflados, resultados incorrectos o timeouts de producción verificados en esta BD.

---

## SQL — Reglas Absolutas

### ❌ NUNCA `IN (subquery)` sobre tablas RIPS grandes
```sql
-- MAL — Merge Semi Join + Parallel Seq Scan en 171M filas = 42 segundos
WHERE ap.consecutivo_rips IN (SELECT consecutivo_rips FROM rips_af WHERE ...)

-- BIEN — Index Scan = 1.7-2 segundos
WHERE ap.consecutivo_rips = ANY(ARRAY(SELECT consecutivo_rips FROM rips_af WHERE ...))
```

### ❌ NUNCA filtrar `rips_ap`/`rips_am`/`rips_at` directamente por fecha o prestador
Siempre filtrar `rips_af` primero y usar la lista de `consecutivo_rips` resultante.

### ❌ NUNCA `SELECT *` sobre `rips_ap`/`rips_am`/`rips_at` sin filtro de período
Tablas de 60–177 millones de filas sin índice para este caso de uso.

### ❌ NUNCA interpolar valores en SQL — siempre parámetros posicionales
```ts
// MAL
`WHERE codigo = '${codigo}'`

// BIEN
`WHERE codigo = $1`, [codigo]
```

### ❌ NUNCA usar `consecutivo_cup`, `consecutivo_medicamento` o `consecutivo_insumo` de `tb_tarifario_propio_detalle`
- `consecutivo_cup` → NULL en 100% de las 114.226 filas verificadas
- `consecutivo_medicamento` → Poblada pero incorrecta (1 valor para 977.315 filas)
- `consecutivo_insumo` → NULL en 100% de las 23.000 filas verificadas
- **Siempre** cruzar por `d.codigo_tarifa` contra `codigo_interno` del catálogo correspondiente

### ❌ NUNCA usar `codigo_tarifario` de `rips_at`
Siempre NULL en 100% de filas verificadas (~1.2M TABLESAMPLE). Usar `codigo_servicio`.

### ❌ NUNCA usar `ct_ips.municipio` para agrupar contratos por ubicación
Es el municipio de sede/registro del prestador, difiere en el 33% de contratos vigentes (91 de 279). Usar `ct_ips_contrato.municipio_administracion`.

### ❌ NUNCA JOIN hacia `rips_af` por `consecutivo_rips` sin deduplicar antes
`consecutivo_rips` no es único — hasta 951 filas con el mismo valor. Sin `DISTINCT ON` el resultado puede inflarse hasta 951x.

```sql
-- SIEMPRE así:
SELECT DISTINCT ON (consecutivo_rips) consecutivo_rips, codigo_prestador
FROM rips_af WHERE ...
ORDER BY consecutivo_rips
```

### ❌ NUNCA agregar `valor_neto` de `rips_af` sin deduplicar duplicados por recarga
235.178 filas vs. 186.108 facturas reales. Inflación hasta 13x. Usar `rips-dedup.ts` → `sqlFacturasCanonicas`.

---

## TypeScript / Next.js — Reglas Absolutas

### ❌ NUNCA `Promise.all` con 3+ consultas pesadas sobre tablas RIPS
Satura el proxy y cierra la conexión (`TypeError: terminated`). Ejecutar secuencialmente.

### ❌ NUNCA lógica de negocio inline en componentes `.tsx`
Todo cálculo estadístico/financiero va en `src/lib/negociacion/` como función pura testeable.

### ❌ NUNCA hardcodear umbrales de negocio
`alertaPct`, `criticoPct`, máximos de días — siempre configurables.

### ❌ NUNCA importar `"recharts"` en código
Carpeta `node_modules/recharts` está corrupta. Usar HTML/CSS puro con `<div>` ancho en % o SVG propio hasta que se limpie manualmente.

---

## Arquitectura — Reglas Absolutas

### ❌ NUNCA escribir en tablas SIE (`rips_*`, `ct_*`, `tb_*`)
Solo lectura. Escritura exclusiva en `negociacion_contratacion_*`.

### ✅ Resolución de descripción de insumos: SIEMPRE doble catálogo
```sql
LEFT JOIN tb_insumo ins ON ins.codigo_interno = at2.codigo_servicio
LEFT JOIN tb_cup cup_bkp ON cup_bkp.codigo_interno = at2.codigo_servicio
COALESCE(ins.descripcion, cup_bkp.nombre, at2.codigo_servicio) AS descripcion
```
El 73% del valor total facturado bajo "insumos" son CUPS de estancia que solo resuelven en `tb_cup`.

### ✅ Comparación de prestadores: SIEMPRE dentro del mismo municipio
`HAVING COUNT(DISTINCT c.ips) >= 2` — nunca mostrar un código donde la comparación no es posible.

### ✅ Semáforo: la DIRECCIÓN importa — 5 estados, no 3
`"ok"`, `"alerta"`, `"critico"` (cobra MÁS) y `"favorable"`, `"muyFavorable"` (cobra MENOS). Un prestador más barato no es "crítico".

### ✅ Amplitud %: usar siempre la misma referencia que el usuario seleccionó
`amplitudSegunReferencia(fila, referencia)` — única fuente de verdad. No mezclar Promedio y Mediana.

---

## Convenciones de Código

| Aspecto | Convención |
|---|---|
| Lenguaje | TypeScript con `strict: true` |
| Componentes server | Server Components por defecto |
| Lógica de negocio | `src/lib/negociacion/` — funciones puras |
| Consultas DB | `db.ts` — nunca pool directo desde componentes |
| Exportación Excel | `exceljs` (no SheetJS) |
| Puerto de desarrollo | `9010` (`next dev -p 9010`) |
| Parámetros SQL | Posicionales `$1, $2…` — nunca interpolación |
| Roles | Verificar con `tieneRolMinimo(session, rol)` de `src/lib/auth.ts` |

---

## Migraciones — Reglas

1. `db/migrations/001_negociacion_contratacion_usuario.sql` — aplicar en BD real antes de usar el sistema de login.
2. `db/migrations/002_precio_referencia_eps.sql` — aplicar antes de usar carga de archivos en `/precio-referencia-eps`.
3. El DDL embebido en `aplicarMigracionPrecioReferenciaEps` (código fuente) debe mantenerse **idéntico** al archivo de migración físico. Si se edita uno, editar el otro.
4. Todas las migraciones deben ser **idempotentes** (`CREATE TABLE IF NOT EXISTS`, `CREATE INDEX IF NOT EXISTS`).
