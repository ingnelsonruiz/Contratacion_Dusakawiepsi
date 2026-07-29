/**
 * Tipos de "Movimientos RIPS" — consulta puntual, a pedido del usuario
 * (2026-07-29) desde el acordeón de "Perfil Competitivo del Prestador":
 * *"necesito saber cuántos procedimientos de esos ha radicado cada
 * prestador y su número de factura... eso es muy importante para el
 * análisis, para mirar movimientos de ese código... debes traerlo de los
 * RIPS... cuando traigas medicamentos el archivo de RIPS es otro"*.
 *
 * Reutiliza el mismo patrón ya validado en el módulo "Consumo y Frecuencia"
 * (src/app/actions/consumo-frecuencia-actions.ts): filtrar primero
 * `rips_af` por `codigo_prestador` (Seq Scan, sin índice por prestador pero
 * dentro del timeout del proxy — ver KnowledgeBase/05-ReglasNegocio/
 * Contratación.md), y desde ahí resolver `rips_ap`/`rips_am`/`rips_at` por
 * `consecutivo_rips` (SÍ indexado en las 3). A diferencia de Módulo 4 (que
 * agrega TODOS los códigos de un mes), aquí se filtra a UN código puntual
 * pero SIN límite de fecha (todo el histórico facturado), porque el objetivo
 * es auditar el movimiento completo de ese código para ese prestador.
 */

import type { TipoComparativo } from "@/types/comparativo";

/** Una factura (RIPS) donde aparece el código consultado — puede haber varias líneas por factura si el mismo código se repite dentro de la misma cuenta, ya agregadas aquí. */
export interface FilaFacturaMovimientoRips {
  numeroFactura: string;
  /** Fecha del procedimiento/dispensación — puede ser null si el dato viene vacío en el RIPS original. */
  fecha: string | null;
  /** Unidades: conteo de líneas para servicios (rips_ap no tiene columna de cantidad, cada fila = 1 evento), suma de numero_unidades para medicamentos, suma de cantidad para insumos. */
  cantidad: number;
  valor: number;
}

export interface ResultadoMovimientoRips {
  ips: number;
  codigoPrestador: string;
  razonSocial: string;
  codigoTarifa: string;
  tipo: TipoComparativo;
  totalCantidad: number;
  totalValor: number;
  totalFacturas: number;
  /** Ordenadas por fecha descendente (más reciente primero). */
  facturas: FilaFacturaMovimientoRips[];
}
