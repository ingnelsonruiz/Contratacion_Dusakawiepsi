/**
 * Tipos del módulo — Consumo y Frecuencia.
 *
 * Objetivo de negocio (tarjeta del dashboard): "Consumo real facturado
 * (RIPS) agregado por prestador, código y período". A diferencia de los
 * Módulos 1/2/3 (que viven sobre el TARIFARIO contratado, tablas pequeñas),
 * este módulo consulta directamente los RIPS reales — las tablas de detalle
 * (`rips_ap`, `rips_am`, `rips_at`) tienen decenas a cientos de millones de
 * filas y NO tienen índice por fecha ni por prestador (verificado
 * 2026-07-28 vía `EXPLAIN ANALYZE`, ver KnowledgeBase/05-ReglasNegocio/
 * Contratación.md). Por eso el alcance se acotó explícitamente con el
 * usuario:
 *   - Un MES específico a la vez (no rango libre) — evita escaneos de
 *     rangos abiertos sobre tablas de cientos de millones de filas.
 *   - Un prestador a la vez (no ranking de todos a la vez en esta iteración).
 *   - Solo Servicios (CUPS) + Medicamentos (CUM) + Insumos — igual alcance
 *     que Módulos 1/2/3 (no incluye Consultas/Hospitalizaciones en este MVP).
 *
 * Estrategia de consulta: filtrar primero `rips_af` (10M filas, la más
 * pequeña de las tablas RIPS) por `codigo_prestador` + `fecha_servicio_rips`
 * dentro del rango elegido → de ahí se obtiene la lista de `consecutivo_rips`
 * (facturas) reales de ese prestador en ese rango, y se cruza esa lista (ya
 * acotada) contra `rips_ap`/`rips_am`/`rips_at` por `consecutivo_rips`, que
 * SÍ está indexado en las 3 tablas grandes.
 *
 * Corrección 2026-07-30 (pedido del usuario): el selector pasó de "un mes
 * específico" a un rango de fechas día-a-día (fechaInicio/fechaFin), con un
 * tope de seguridad de `MAX_DIAS_RANGO_CONSUMO` días (366, ~1 año desde
 * 2026-08-02; originalmente 92, ~3 meses) — decidido
 * con el usuario tras verificar con `EXPLAIN ANALYZE` que el costo del Seq
 * Scan sobre `rips_af` es prácticamente constante (bounded por el tamaño de
 * la tabla, no por el ancho del rango), pero el tamaño del resultado
 * (`consecutivo_rips` encontrados) sí crece con el rango y con él el costo de
 * los `Index Scan` posteriores sobre `rips_ap/am/at` — un prestador de alto
 * volumen con ~4.5 años de rango (todo el histórico disponible) tardó ~6-8s
 * por tabla, ya no instantáneo. El tope evita que un rango arbitrariamente
 * grande (o varios usuarios consultando rangos grandes a la vez) arriesgue el
 * timeout de 90s del proxy. Ver KnowledgeBase/05-ReglasNegocio/Contratación.md.
 */

export type TipoConsumo = "servicios" | "medicamentos" | "insumos";

/** Prestador disponible para consultar consumo — activo hoy en ct_ips/ct_ips_contrato. */
export interface OpcionPrestadorConsumo {
  ips: number;
  codigoPrestador: string;
  razonSocial: string;
  nit: string;
}

/**
 * Contrato de un prestador puntual, para el desglose "consumo por contrato"
 * (2026-08-02) — a diferencia de `OpcionPrestadorConsumo`, incluye contratos
 * YA VENCIDOS (el caso de uso es comparar un contrato antiguo contra un
 * otrosí/ampliación posterior). Ver `getContratosPrestadorConsumo`.
 *
 * CORRECCIÓN 2026-08-02 (el usuario verificó y tenía razón: "en la factura
 * va el número de contrato, es más fácil identificar por ahí"): la atribución
 * por contrato ya NO es una aproximación por solape de fechas de vigencia —
 * se confirmó en la BD real que `rips_af.numero_contrato`/`consecutivo_contrato`
 * existen y coinciden exactamente con `ct_ips_contrato.consecutivo_contrato`,
 * con cobertura ~87-94% desde 2022. El filtro ahora es EXACTO
 * (`numero_contrato = ANY(...)`, ver `construirFragmentoRango` en
 * `consumo-frecuencia-actions.ts`), sobre el MISMO rango de fechas elegido
 * por el usuario — ya no hay "período efectivo" intersectado por contrato.
 */
export interface OpcionContratoConsumo {
  numeroContrato: string;
  /** ISO `YYYY-MM-DD`. */
  fechaInicio: string;
  fechaTerminacion: string;
}

/** Un resultado de consumo filtrado EXACTAMENTE por `numero_contrato`, dentro del mismo rango de fechas elegido por el usuario para el prestador. */
export interface ResultadoConsumoContrato {
  contrato: OpcionContratoConsumo;
  resultado: ResultadoConsumoPrestador | null;
  cargando: boolean;
  error: string | null;
}

/** Consumo agregado de un código puntual, dentro del prestador+mes elegido. */
export interface FilaConsumoCodigo {
  codigoTarifa: string;
  descripcion: string;
  tipo: TipoConsumo;
  /** Servicios: cantidad de eventos (1 fila RIPS = 1 evento). Medicamentos: suma de unidades dispensadas. Insumos: suma de cantidad. */
  cantidad: number;
  valorTotal: number;
  valorPromedio: number;
}

export interface KpisConsumoPrestador {
  cantidadFacturas: number;
  valorTotalFacturado: number;
  cantidadCodigosDistintos: number;
  cantidadServicios: number;
  cantidadMedicamentos: number;
  cantidadInsumos: number;
}

export interface ParametrosConsumoPrestador {
  codigoPrestador: string;
  /** ISO `YYYY-MM-DD`, inclusive en ambos extremos. */
  fechaInicio: string;
  fechaFin: string;
}

export interface ResultadoConsumoPrestador {
  codigoPrestador: string;
  razonSocial: string;
  fechaInicio: string;
  fechaFin: string;
  filas: FilaConsumoCodigo[];
  kpis: KpisConsumoPrestador;
}
