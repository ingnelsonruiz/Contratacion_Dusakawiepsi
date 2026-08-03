/**
 * Helpers COMPARTIDOS para joinear/etiquetar códigos contra los catálogos
 * maestros (`tb_cup`, `tb_medicamento`, `tb_insumo`) — extraídos 2026-08-02
 * de `top-impacto-actions.ts` (donde se corrigieron por primera vez) para
 * que "Consumo y Frecuencia" y cualquier módulo futuro que cruce por
 * `codigo_interno` los reutilicen en vez de duplicar la misma lógica —
 * mismo criterio de este archivo (`src/lib/negociacion/*.ts`, sin `"use
 * server"`, sin acceso a BD, solo builders de texto SQL y funciones puras).
 */

/**
 * JOIN a un catálogo garantizado 1:1 por `codigo_interno`.
 *
 * Por qué existe: `codigo_interno` NO es la PK real de `tb_cup`/
 * `tb_medicamento`/`tb_insumo` (las PK son `cup`/`medicamento`/`insumo` — ver
 * CLAUDE.md del ecosistema, sección 6). Si el catálogo tiene 2+ filas con el
 * mismo `codigo_interno`, un `LEFT JOIN` directo contra la tabla completa
 * multiplica cada línea de detalle RIPS por esa cantidad — inflando
 * `COUNT`/`SUM` en cualquier consulta que agregue por código.
 *
 * Encontrado y corregido primero en "Análisis de Códigos de Mayor Impacto
 * Económico" (caso real: KPI "Valor total radicado" $3.510.936.767 vs. la
 * barra del mismo prestador en "Top 20 prestadores" $3.229.580.952, mismo
 * filtro — la única diferencia entre ambas consultas era este join). Debe
 * aplicarse en TODO módulo que joinee un detalle RIPS contra estos 3
 * catálogos por `codigo_interno`.
 *
 * Fix: joinear contra el catálogo YA deduplicado (`GROUP BY codigo_interno`
 * + `MAX(descripcion)`, determinístico). Son tablas chicas (miles de filas),
 * agruparlas cuesta milisegundos. Sin duplicados el resultado es idéntico al
 * join directo — el cambio solo corrige los casos donde el join directo
 * contaba dinero de más.
 */
export function joinCatalogoDeduplicado(
  tabla: string,
  aliasCatalogo: string,
  columnaDescripcion: string,
  aliasDetalle: string,
  columnaCodigo: string
): string {
  return `LEFT JOIN (SELECT codigo_interno, MAX(${columnaDescripcion}) AS ${columnaDescripcion} FROM administrativo.${tabla} GROUP BY codigo_interno) ${aliasCatalogo} ON ${aliasCatalogo}.codigo_interno = ${aliasDetalle}.${columnaCodigo}`;
}

/**
 * Etiqueta honesta cuando un código no resuelve en NINGÚN catálogo (ni el
 * principal ni el de respaldo) — reemplaza el patrón anterior
 * `descripcion ?? codigo`, que mostraba el código repetido como si fuera su
 * propia descripción (ej. "139 — 139"), o el literal "N/A" que ARYUWIS
 * reporta como CÓDIGO en algunas líneas de `rips_at` como si fuera una
 * descripción real. Es un problema de dato de origen (código no registrado
 * en catálogos), no de la consulta — se etiqueta así en vez de ocultarlo,
 * mismo criterio de honestidad ya aplicado en el resto del proyecto (ver
 * `obtenerPorPrestador` en top-impacto-actions.ts: "Código no registrado").
 */
export function descripcionOFallback(codigo: string | null | undefined, descripcion: string | null | undefined): string {
  if (descripcion) return descripcion;
  const codigoLimpio = (codigo ?? "").trim();
  if (!codigoLimpio || codigoLimpio.toUpperCase() === "N/A") {
    return "Sin código informado en RIPS";
  }
  return `${codigoLimpio} (sin descripción en catálogos)`;
}
