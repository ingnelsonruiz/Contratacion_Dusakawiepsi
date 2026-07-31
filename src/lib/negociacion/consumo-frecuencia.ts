/**
 * Funciones puras del módulo Consumo y Frecuencia — sin dependencias de
 * Next.js/BD, testeables de forma aislada (mismo principio que el resto de
 * src/lib/negociacion/*.ts).
 */

import type { FilaConsumoCodigo, KpisConsumoPrestador, TipoConsumo } from "@/types/consumo-frecuencia";

/**
 * Tope de seguridad del rango de fechas (días, inclusive) — decidido con el
 * usuario 2026-07-30 al reemplazar el selector de "un mes" por un rango
 * día-a-día. 92 días cubre cómodamente 3 meses calendario consecutivos
 * (incluyendo meses de 31 días). Único punto de verdad: se usa tanto en el
 * cliente (deshabilitar "Consultar" / mostrar aviso) como en el servidor
 * (Server Action y Route Handler de exportación, defensa en profundidad) —
 * ver KnowledgeBase/05-ReglasNegocio/Contratación.md para el detalle de
 * rendimiento verificado con EXPLAIN ANALYZE que motivó este tope.
 */
export const MAX_DIAS_RANGO_CONSUMO = 92;

export interface ValidacionRangoConsumo {
  valido: boolean;
  error?: string;
}

/** Valida un rango de fechas día-a-día para el módulo de Consumo y Frecuencia — única fuente de verdad (cliente + servidor). */
export function validarRangoConsumo(fechaInicio: string, fechaFin: string): ValidacionRangoConsumo {
  const inicio = new Date(fechaInicio);
  const fin = new Date(fechaFin);
  if (!fechaInicio || !fechaFin || Number.isNaN(inicio.getTime()) || Number.isNaN(fin.getTime())) {
    return { valido: false, error: "Seleccione una fecha inicial y una fecha final válidas." };
  }
  if (fin.getTime() < inicio.getTime()) {
    return { valido: false, error: "La fecha final no puede ser anterior a la fecha inicial." };
  }
  const dias = Math.round((fin.getTime() - inicio.getTime()) / 86_400_000) + 1;
  if (dias > MAX_DIAS_RANGO_CONSUMO) {
    return {
      valido: false,
      error: `El rango elegido es de ${dias} días — el máximo permitido es ${MAX_DIAS_RANGO_CONSUMO} días (~3 meses). Las tablas RIPS no tienen índice por fecha; un rango más amplio arriesga un timeout de la consulta.`,
    };
  }
  return { valido: true };
}

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
