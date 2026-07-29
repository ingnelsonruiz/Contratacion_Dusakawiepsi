/**
 * Funciones puras del módulo Consumo y Frecuencia — sin dependencias de
 * Next.js/BD, testeables de forma aislada (mismo principio que el resto de
 * src/lib/negociacion/*.ts).
 */

import type { FilaConsumoCodigo, KpisConsumoPrestador, TipoConsumo } from "@/types/consumo-frecuencia";

/** Construye una fila de consumo agregado (ya viene agregada desde SQL: cantidad + valor total por código). */
export function construirFilaConsumo(
  codigoTarifa: string,
  descripcion: string,
  tipo: TipoConsumo,
  cantidad: number,
  valorTotal: number
): FilaConsumoCodigo {
  return {
    codigoTarifa,
    descripcion,
    tipo,
    cantidad,
    valorTotal,
    valorPromedio: cantidad > 0 ? valorTotal / cantidad : 0,
  };
}

/** KPIs ejecutivos del prestador+mes — cantidadFacturas viene de fuera (se cuenta en rips_af, no se puede derivar de las filas por código). */
export function calcularKpisConsumoPrestador(filas: FilaConsumoCodigo[], cantidadFacturas: number): KpisConsumoPrestador {
  let valorTotalFacturado = 0;
  let cantidadServicios = 0;
  let cantidadMedicamentos = 0;
  let cantidadInsumos = 0;

  for (const fila of filas) {
    valorTotalFacturado += fila.valorTotal;
    if (fila.tipo === "servicios") cantidadServicios++;
    else if (fila.tipo === "medicamentos") cantidadMedicamentos++;
    else cantidadInsumos++;
  }

  return {
    cantidadFacturas,
    valorTotalFacturado,
    cantidadCodigosDistintos: filas.length,
    cantidadServicios,
    cantidadMedicamentos,
    cantidadInsumos,
  };
}
