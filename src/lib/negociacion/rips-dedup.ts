/**
 * Deduplicación de facturas re-radicadas (lotes duplicados en `rips_af`) —
 * hallazgo crítico verificado 2026-07-30, reportado por el usuario contra un
 * caso real: la factura `MV06370` (MOVILIDAD VITAL SAS) aparecía en el
 * drill-down de "Top Impacto" con $850.000/10 unidades del código S50008,
 * mientras que en ARYUWIS esa misma factura vale $170.000/2 unidades — una
 * diferencia de exactamente 5x.
 *
 * CAUSA RAÍZ (verificada contra la BD real, ver KnowledgeBase/04-BaseDatos/Tablas.md):
 * `rips_af.consecutivo_rips` no solo agrupa muchas facturas distintas bajo un
 * mismo lote (hallazgo ya documentado del 2026-07-29 — "no es un ID de
 * factura"), sino que ADEMÁS una misma factura real (`codigo_prestador` +
 * `numero_factura`) puede aparecer repetida en VARIOS lotes/`consecutivo_rips`
 * distintos — evidencia de recargas repetidas del mismo archivo RIPS sin
 * limpiar las copias anteriores. Caso real `MV06370`: 5 filas en `rips_af`
 * (`consecutivo_rips` 638053/638054/672291/672309/672377), las 5 con
 * `valor_neto = 170.000` (el mismo valor real), pero solo 1 con
 * `fecha_radica` poblada y progreso real de auditoría — las otras 4 son
 * copias sin procesar (`estado_soporte = 0`, `fecha_radica IS NULL`). Verificado
 * a escala EPS-completa (año 2026): 235.178 filas en `rips_af` vs. 186.108
 * facturas realmente distintas — sumar sin deduplicar infla el valor total
 * en **$16.165.439.260 (7,4%)**; para prestadores puntuales (ej. MOVILIDAD
 * VITAL SAS) la inflación llega a 11-13x por factura.
 *
 * CRITERIO DE DEDUPLICACIÓN (confirmado con el usuario 2026-07-30): entre las
 * copias de una misma factura, se elige la que tenga `fecha_radica IS NOT
 * NULL` (la más reciente si hay más de una — cubre re-radicaciones legítimas
 * por corrección, no solo copias basura) — verificado que coincide EXACTO con
 * el campo "Fecha Radicado" que muestra ARYUWIS para la factura auditada.
 * Facturas donde NINGUNA copia tiene `fecha_radica` (≈3,3% EPS-completa,
 * datos reportados pero nunca radicados formalmente) se incluyen igual
 * (se toma 1 copia arbitraria, `ORDER BY consecutivo_rips` como desempate
 * determinístico) — decisión de negocio del usuario: mejor sobre-incluir que
 * subestimar el valor real facturado.
 *
 * USO: esta CTE se combina SIEMPRE junto con el filtro de período/prestador
 * ya existente en cada módulo (mismo WHERE, para que Postgres solo escanee
 * `rips_af` una vez por consulta) — ver `sqlFacturasCanonicas` (recibe el
 * `WHERE` ya armado por el llamador, con sus propios parámetros bindeados) y
 * `joinFacturaCanonica` (el JOIN que aplica la deduplicación real sobre la
 * tabla de detalle — filtra por `numero_factura` Y `consecutivo_rips` a la
 * vez, así una línea de detalle solo cuenta si pertenece al lote GANADOR de
 * ESA factura puntual, sin afectar los demás lotes que aportan otras
 * facturas distintas).
 *
 * Verificado con `EXPLAIN ANALYZE` (año 2026 completo, sin filtro de
 * prestador, tabla `rips_at` ~60M filas): 4,78s — dentro del mismo rango ya
 * aceptado para este módulo (3-10s), sin perder el `Index Scan` sobre
 * `rips_at_idx_rips` que ya se documentó como crítico para el rendimiento.
 */

/** CTE "facturas_canonicas" — 1 fila por factura real, la copia ganadora entre posibles lotes duplicados. `whereClause` debe ser EXACTAMENTE el mismo WHERE (mismos parámetros bindeados) que ya se usa para acotar `rips_af` por período/prestador en cada módulo. */
export function sqlFacturasCanonicas(whereClause: string): string {
  return `
    SELECT DISTINCT ON (codigo_prestador, numero_factura)
      codigo_prestador, numero_factura, consecutivo_rips AS consecutivo_rips_canonico
    FROM administrativo.rips_af
    WHERE ${whereClause}
    ORDER BY codigo_prestador, numero_factura, (fecha_radica IS NOT NULL) DESC, fecha_radica DESC NULLS LAST, consecutivo_rips ASC
  `;
}

/** JOIN que aplica la deduplicación sobre una tabla de detalle (`rips_ap`/`rips_ac`/`rips_am`/`rips_at`) ya alias-ada — solo cuenta una línea si su `consecutivo_rips` coincide con el canónico de esa factura puntual. */
export function joinFacturaCanonica(aliasDetalle: string, aliasCanonicas = "fc"): string {
  return `JOIN facturas_canonicas ${aliasCanonicas} ON ${aliasCanonicas}.numero_factura = ${aliasDetalle}.numero_factura AND ${aliasCanonicas}.consecutivo_rips_canonico = ${aliasDetalle}.consecutivo_rips`;
}
