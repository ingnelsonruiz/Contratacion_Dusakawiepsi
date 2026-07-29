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
 * dentro del mes elegido → de ahí se obtiene la lista de `consecutivo_rips`
 * (facturas) reales de ese prestador en ese mes, y se cruza esa lista (ya
 * acotada) contra `rips_ap`/`rips_am`/`rips_at` por `consecutivo_rips`, que
 * SÍ está indexado en las 3 tablas grandes.
 */

export type TipoConsumo = "servicios" | "medicamentos" | "insumos";

/** Prestador disponible para consultar consumo — activo hoy en ct_ips/ct_ips_contrato. */
export interface OpcionPrestadorConsumo {
  ips: number;
  codigoPrestador: string;
  razonSocial: string;
  nit: string;
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
  mes: number; // 1-12
  anio: number;
}

export interface ResultadoConsumoPrestador {
  codigoPrestador: string;
  razonSocial: string;
  mes: number;
  anio: number;
  filas: FilaConsumoCodigo[];
  kpis: KpisConsumoPrestador;
}
