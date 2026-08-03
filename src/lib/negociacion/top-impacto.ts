import type { FilaTopImpacto, KpisTopImpacto, TipoImpacto } from "@/types/top-impacto";
import { descripcionOFallback } from "@/lib/negociacion/catalogo-codigos";

/** Fila cruda tal como sale de la consulta SQL agregada por código (antes de calcular % del total). */
export interface FilaCrudaTopImpacto {
  tipo: Exclude<TipoImpacto, "todos">;
  codigo: string;
  descripcion: string | null;
  cantidad: number;
  valor: number;
  prestadores: number;
}

export function construirFilaTopImpacto(cruda: FilaCrudaTopImpacto, valorTotalRadicado: number): FilaTopImpacto {
  return {
    tipo: cruda.tipo,
    codigo: cruda.codigo,
    // `descripcionOFallback` (fix 2026-08-02, reporte del usuario: "hay
    // códigos que no les aparece descripción" — antes se mostraba el código
    // repetido, ej. "139 — 139", o el literal "N/A" de rips_at como si fuera
    // descripción) — extraída a catalogo-codigos.ts para reutilizar en
    // "Consumo y Frecuencia".
    descripcion: descripcionOFallback(cruda.codigo, cruda.descripcion),
    cantidad: cruda.cantidad,
    valorTotal: cruda.valor,
    valorPromedio: cruda.cantidad > 0 ? cruda.valor / cruda.cantidad : 0,
    prestadores: cruda.prestadores,
    pctDelTotal: valorTotalRadicado > 0 ? (cruda.valor / valorTotalRadicado) * 100 : 0,
  };
}

/** `filas` debe venir YA ordenada desc por valorTotal (la consulta SQL ya trae `ORDER BY valor DESC`). */
export function calcularKpisTopImpacto(filas: FilaTopImpacto[], valorTotalRadicado: number, totalRegistros: number): KpisTopImpacto {
  const primero = filas[0] ?? null;
  return {
    valorTotalRadicado,
    totalRegistros,
    totalCodigosDiferentes: filas.length,
    codigoMayorImpacto: primero
      ? { codigo: primero.codigo, descripcion: primero.descripcion, valorTotal: primero.valorTotal }
      : null,
  };
}

export const ETIQUETAS_TIPO_IMPACTO: Record<TipoImpacto, string> = {
  todos: "Todos (Servicios + Consultas + Medicamentos + Insumos)",
  servicios: "Procedimientos (CUPS)",
  consultas: "Consultas",
  medicamentos: "Medicamentos (CUM)",
  insumos: "Insumos",
};
