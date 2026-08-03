/**
 * Funciones puras del módulo Consumo y Frecuencia — sin dependencias de
 * Next.js/BD, testeables de forma aislada (mismo principio que el resto de
 * src/lib/negociacion/*.ts).
 */

import type { FilaConsumoCodigo, KpisConsumoPrestador, TipoConsumo } from "@/types/consumo-frecuencia";
import { descripcionOFallback } from "@/lib/negociacion/catalogo-codigos";

/**
 * Tope de seguridad del rango de fechas (días, inclusive) — decidido con el
 * usuario 2026-07-30 al reemplazar el selector de "un mes" por un rango
 * día-a-día, con tope original de 92 días (~3 meses).
 *
 * AMPLIACIÓN 2026-08-02 (pedido del usuario: "yo sé que puede hacerlo de más
 * meses hasta un año"): 366 días (cubre un año calendario completo,
 * incluyendo años bisiestos). Se basa en una medición YA documentada en este
 * mismo archivo desde 2026-07-30 (ver comentario histórico abajo): un
 * prestador de ALTO volumen con ~4.5 años de rango (todo el histórico
 * disponible, ~18x más ancho que este nuevo tope) tardó 6-8s por tabla — muy
 * por debajo del timeout de 90s del proxy. Un año es una fracción de esa
 * prueba ya realizada, así que el margen de seguridad es amplio. Como
 * precaución adicional (no probada explícitamente, por si el volumen a un
 * año resulta más alto de lo estimado), las 3 consultas pesadas de
 * `consumo-frecuencia-actions.ts` pasaron de `Promise.all` a secuenciales —
 * ver comentario en `getConsumoPrestador`.
 *
 * Único punto de verdad: se usa tanto en el cliente (deshabilitar
 * "Consultar" / mostrar aviso) como en el servidor (Server Action y Route
 * Handler de exportación, defensa en profundidad).
 */
export const MAX_DIAS_RANGO_CONSUMO = 366;

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
      error: `El rango elegido es de ${dias} días — el máximo permitido es ${MAX_DIAS_RANGO_CONSUMO} días (~1 año). Las tablas RIPS no tienen índice por fecha; un rango más amplio arriesga un timeout de la consulta.`,
    };
  }
  return { valido: true };
}

/** Construye una fila de consumo agregado (ya viene agregada desde SQL: cantidad + valor total por código). */
export function construirFilaConsumo(
  codigoTarifa: string,
  descripcion: string | null,
  tipo: TipoConsumo,
  cantidad: number,
  valorTotal: number
): FilaConsumoCodigo {
  return {
    codigoTarifa,
    // `descripcionOFallback` (fix 2026-08-02, reporte del usuario: "hay
    // códigos que no le aparecen descripción", ej. 968927/965389) — antes
    // se mostraba el código repetido como si fuera su propia descripción.
    // Ver catalogo-codigos.ts para el detalle completo.
    descripcion: descripcionOFallback(codigoTarifa, descripcion),
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
