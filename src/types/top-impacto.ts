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

/**
 * Contrato vigente de UN prestador puntual, con su municipio de
 * administración ya resuelto — agregado 2026-07-30 para el selector en
 * cascada Prestador → Contrato(s) → Municipio (ver `getContratosPrestador`
 * en top-impacto-actions.ts). Usa `ct_ips_contrato.municipio_administracion`
 * (municipio bajo el cual se administra CADA contrato), no
 * `ct_ips.municipio` (municipio de registro/sede del prestador, fijo) — mismo
 * criterio ya corregido en el Módulo 2, ver KnowledgeBase/04-BaseDatos/Tablas.md.
 */
export interface OpcionContratoPrestador {
  numeroContrato: string;
  municipioCodigo: string;
  municipioNombre: string;
}

export interface FiltrosImpacto {
  tipo: TipoImpacto;
  anio: number;
  ips?: number | null;
  municipioCodigo?: string | null;
  /**
   * Uno o varios números de contrato. Nota importante: cuando ya se filtra
   * por `ips`, elegir 1 o varios contratos de ESE MISMO prestador no cambia
   * el valor radicado — los RIPS se atribuyen por `codigo_prestador` (la
   * entidad/sede facturadora), no por contrato individual; un prestador con
   * varios contratos vigentes comparte el mismo `codigo_prestador` en la
   * enorme mayoría de los casos. Este filtro sirve para acotar el universo de
   * prestadores cuando NO hay `ips` elegido (selección EPS-completa por
   * contrato) y, con `ips` elegido, para mostrar en qué municipio(s) de
   * administración opera (ver `OpcionContratoPrestador`) — no para
   * sub-filtrar sus propios RIPS.
   */
  numerosContrato?: string[] | null;
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

/**
 * Drill-down "de lo general a lo particular" (pedido del usuario 2026-07-30:
 * "si yo le doy doble clic en Top 20 prestadores por valor radicado a un
 * prestador mostrarme de que servicios viene ese dinero... y llevarme por
 * doble clic a una información más detallada hasta las facturas"). 2 niveles:
 *
 * - Nivel 2 (prestador → códigos): NO requiere un tipo nuevo — reutiliza
 *   `ResultadoTopImpacto` completo, llamando de nuevo a `getTopImpacto` con
 *   los mismos filtros ya usados para el gráfico (`resultado.filtros`) pero
 *   sobrescribiendo `ips` con el prestador de la barra. Esto garantiza que el
 *   total mostrado en el desglose coincida EXACTO con el valor de la barra,
 *   sin importar qué haya cambiado el usuario en los selectores después de
 *   consultar.
 * - Nivel 3 (código → facturas): sí requiere un tipo/consulta nueva, ver
 *   `FilaFacturaImpacto`/`ResultadoFacturasImpacto` y `getFacturasCodigoImpacto`
 *   en `top-impacto-actions.ts`. No se reutiliza `getMovimientoRipsCodigo`
 *   (módulo "Movimientos RIPS") porque ese acota las facturas por VIGENCIA de
 *   contrato del prestador (no por el año elegido en este módulo) y no
 *   soporta el tipo "consultas" — hubiera dado un total inconsistente con el
 *   que ya se ve en el Nivel 2/gráfico de este módulo.
 */
export interface FilaFacturaImpacto {
  numeroFactura: string;
  fecha: string | null;
  /** Para "servicios"/"consultas": `COUNT(*)` (cada fila del RIPS es un evento, sin columna de unidades propia — mismo criterio que `obtenerPorCodigo`). Para "medicamentos"/"insumos": suma de unidades/cantidad física real. */
  cantidad: number;
  valor: number;
}

export interface ResultadoFacturasImpacto {
  ips: number;
  razonSocial: string;
  codigoPrestador: string;
  codigo: string;
  descripcion: string;
  tipo: Exclude<TipoImpacto, "todos">;
  anio: number;
  /** Calculados sobre TODAS las facturas encontradas, no solo las mostradas (mismo criterio que `ResultadoMovimientoRips`). */
  totalCantidad: number;
  totalValor: number;
  totalFacturas: number;
  /** Acotado a las más recientes (ver `LIMITE_FACTURAS_IMPACTO` en el Server Action) — los totales de arriba sí incluyen todas. */
  facturas: FilaFacturaImpacto[];
}
