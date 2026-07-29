/**
 * Tipos del módulo "Análisis de Códigos de Mayor Impacto Económico"
 * (pedido del usuario 2026-07-29): identificar los 100 procedimientos,
 * medicamentos e insumos que representan el mayor valor económico radicado
 * para la EPS, con KPIs, ranking, filtros y gráficos — para que Contratación
 * sepa en qué códigos enfocarse en la próxima negociación.
 *
 * Fuente de datos: RIPS reales (`rips_ap`/`rips_am`/`rips_at`, vía la
 * factura `rips_af`), SOLO LECTURA, en vivo — mismo patrón de rendimiento ya
 * validado en Módulo 4 (Consumo y Frecuencia) y en "Movimientos RIPS": se
 * filtra primero `rips_af` (tabla más chica) por fecha/prestador/municipio/
 * contrato, y desde ahí se resuelven las 3 tablas RIPS grandes por
 * `consecutivo_rips = ANY(ARRAY(...))` (índice real en las 3 — ver
 * KnowledgeBase/05-ReglasNegocio/Contratación.md sobre por qué NUNCA usar
 * `IN (subquery)` en su lugar).
 *
 * A diferencia de "Perfil Competitivo del Prestador" (un prestador contra
 * sus pares) y de "Movimientos RIPS" (un código+prestador puntual), aquí el
 * alcance es EPS-completa: todos los prestadores, un año a la vez (filtro
 * obligatorio, ver `FiltrosImpacto.anio`) — verificado con `EXPLAIN ANALYZE`
 * que una agregación GROUP BY código para toda la EPS en un año completo
 * corre en ~3-6s por tabla RIPS, muy por debajo del timeout de 90s del
 * proxy.
 */

/**
 * CORRECCIÓN 2026-07-29 (mismo día, tras verificar contra un caso real —
 * contrato EV-20001-2026-1 / CLINICA MEDICOS S.A.): faltaba "consultas"
 * (RIPS tipo AC, `rips_ac`). El usuario reportó que su propio estudio
 * factura-por-factura de ese contrato daba $13.363.969.239 de "Valor Real
 * Radicado" (metodología: suma AP+AC+AM+AT) mientras este módulo mostraba
 * solo $4.586.280.134 para ese mismo prestador — la ausencia total de AC
 * (consultas médicas, ~$646M solo en ese contrato) era UNA de las 2 causas
 * reales de la diferencia (ver el hallazgo más grave — códigos de prestador
 * huérfanos — en `top-impacto-actions.ts`). "Servicios" (CUPS/rips_ap) y
 * "Consultas" (rips_ac) comparten el mismo catálogo `tb_cup`, pero son
 * tablas RIPS distintas con su propia semántica de negocio — se mantienen
 * como tipos separados, no se fusionan.
 */
export type TipoImpacto = "todos" | "servicios" | "consultas" | "medicamentos" | "insumos";

export interface OpcionPrestadorImpacto {
  ips: number;
  razonSocial: string;
  nit: string;
}

export interface OpcionMunicipioImpacto {
  codigo: string;
  nombre: string;
}

export interface OpcionesFiltrosImpacto {
  prestadores: OpcionPrestadorImpacto[];
  municipios: OpcionMunicipioImpacto[];
  contratos: string[];
  /** Años con datos reales — generado de forma fija (no se consulta la BD para esto, ver comentario en el Server Action) para no depender de las fechas corruptas ya documentadas en otras tablas RIPS. */
  anios: number[];
}

export interface FiltrosImpacto {
  tipo: TipoImpacto;
  anio: number;
  ips?: number | null;
  municipioCodigo?: string | null;
  numeroContrato?: string | null;
}

/** Una fila del ranking Top 100 (o del universo completo de códigos, antes de recortar a 100). */
export interface FilaTopImpacto {
  tipo: Exclude<TipoImpacto, "todos">;
  codigo: string;
  descripcion: string;
  cantidad: number;
  valorTotal: number;
  valorPromedio: number;
  /** Número de prestadores distintos que facturaron este código en el período filtrado. */
  prestadores: number;
  /** % que representa este código del valor total radicado en el período/filtro actual. */
  pctDelTotal: number;
}

export interface FilaImpactoPrestador {
  /**
   * `null` cuando el `codigo_prestador` que aparece en el detalle RIPS no
   * tiene fila en `ct_ips` (hallazgo 2026-07-29: sedes/códigos de habilitación
   * de un mismo prestador que no están registradas como tal en `ct_ips` — ver
   * `LEFT JOIN` en `obtenerPorPrestador`, `top-impacto-actions.ts`). Antes se
   * perdía ese valor en silencio (INNER JOIN); ahora se muestra agrupado bajo
   * `razonSocial = "Código no registrado: <codigo_prestador>"` para que sea
   * visible en vez de desaparecer.
   */
  ips: number | null;
  razonSocial: string;
  valorTotal: number;
}

export interface FilaImpactoMunicipio {
  /** "" cuando el `codigo_prestador` no tiene fila en `ct_ips` — mismo hallazgo que `FilaImpactoPrestador.ips`. */
  municipioCodigo: string;
  municipioNombre: string;
  valorTotal: number;
}

export interface KpisTopImpacto {
  valorTotalRadicado: number;
  totalRegistros: number;
  totalCodigosDiferentes: number;
  codigoMayorImpacto: { codigo: string; descripcion: string; valorTotal: number } | null;
}

export interface ResultadoTopImpacto {
  filtros: FiltrosImpacto;
  kpis: KpisTopImpacto;
  /** Los 100 códigos de mayor valor — ya ordenados desc por valorTotal. */
  top100: FilaTopImpacto[];
  /** Primeros 20 de `top100` — para el gráfico de barras de códigos. */
  top20Codigos: FilaTopImpacto[];
  top20Prestadores: FilaImpactoPrestador[];
  top20Municipios: FilaImpactoMunicipio[];
}
