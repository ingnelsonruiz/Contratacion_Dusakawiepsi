import { NextRequest, NextResponse } from "next/server";

import { getTopImpacto } from "@/app/actions/top-impacto-actions";
import { ETIQUETAS_TIPO_IMPACTO } from "@/lib/negociacion/top-impacto";
import { construirCsv, crearLibroExcel, agregarHojaExcel, type ColumnaExportable } from "@/lib/negociacion/exportar";
import type { TipoImpacto, FilaTopImpacto } from "@/types/top-impacto";

/**
 * Exportación binaria (Excel/CSV) de "Análisis de Códigos de Mayor Impacto
 * Económico" — mismo patrón Route Handler que /api/export/perfil-prestador.
 */

function sanearNombreArchivo(texto: string): string {
  // \u0300-\u036f = rango Unicode "Combining Diacritical Marks" — código
  // unicode explícito (no el caracter literal), ver CLAUDE.md §9.
  return texto
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-zA-Z0-9-_]+/g, "_")
    .replace(/_+/g, "_")
    .replace(/^_|_$/g, "");
}

const ETIQUETAS_TIPO_CORTA: Record<Exclude<TipoImpacto, "todos">, string> = {
  servicios: "Servicio",
  consultas: "Consulta",
  medicamentos: "Medicamento",
  insumos: "Insumo",
};

interface FilaDetalle {
  tipo: string;
  codigo: string;
  descripcion: string;
  cantidad: number;
  valorTotal: number;
  valorPromedio: number;
  prestadores: number;
  pctDelTotal: number;
}

const COLUMNAS_DETALLE: ColumnaExportable<FilaDetalle>[] = [
  { header: "Tipo", valor: (f) => f.tipo, anchoExcel: 14 },
  { header: "Código", valor: (f) => f.codigo, anchoExcel: 14 },
  { header: "Descripción", valor: (f) => f.descripcion, anchoExcel: 45 },
  { header: "Cantidad radicada", valor: (f) => f.cantidad, formato: "entero", anchoExcel: 16 },
  { header: "Valor total radicado", valor: (f) => f.valorTotal, formato: "moneda", anchoExcel: 18 },
  { header: "Valor promedio", valor: (f) => f.valorPromedio, formato: "moneda", anchoExcel: 16 },
  { header: "Prestadores que lo facturaron", valor: (f) => f.prestadores, formato: "entero", anchoExcel: 20 },
  { header: "% del total", valor: (f) => Number(f.pctDelTotal.toFixed(2)), formato: "porcentaje", anchoExcel: 12 },
];

function mapearFila(f: FilaTopImpacto): FilaDetalle {
  return {
    tipo: ETIQUETAS_TIPO_CORTA[f.tipo],
    codigo: f.codigo,
    descripcion: f.descripcion,
    cantidad: f.cantidad,
    valorTotal: f.valorTotal,
    valorPromedio: f.valorPromedio,
    prestadores: f.prestadores,
    pctDelTotal: f.pctDelTotal,
  };
}

export async function GET(request: NextRequest) {
  const params = request.nextUrl.searchParams;
  const tipo = (params.get("tipo") ?? "todos") as TipoImpacto;
  const anio = Number(params.get("anio") ?? new Date().getFullYear());
  const ips = params.get("ips") ? Number(params.get("ips")) : null;
  const municipioCodigo = params.get("municipioCodigo") || null;
  // Lista separada por comas — mismo criterio que `estados` en el export de
  // Comparativo (/api/export/comparativo). Reemplazó el `numeroContrato`
  // único el 2026-07-30 al agregar el selector en cascada Prestador→Contrato(s).
  const numerosContratoRaw = params.get("numerosContrato");
  const numerosContrato = numerosContratoRaw ? numerosContratoRaw.split(",").filter(Boolean) : null;
  const formato = (params.get("formato") ?? "xlsx") as "xlsx" | "csv";

  try {
    const resultado = await getTopImpacto({ tipo, anio, ips, municipioCodigo, numerosContrato });
    const detalle = resultado.top100.map(mapearFila);

    const filasParametros = [
      { Parámetro: "Tipo", Valor: ETIQUETAS_TIPO_IMPACTO[tipo] },
      { Parámetro: "Año", Valor: String(anio) },
      { Parámetro: "Prestador", Valor: ips ? String(ips) : "Todos" },
      { Parámetro: "Municipio", Valor: municipioCodigo ?? "Todos" },
      { Parámetro: "Contrato(s)", Valor: numerosContrato && numerosContrato.length > 0 ? numerosContrato.join(", ") : "Todos" },
      { Parámetro: "Valor total radicado", Valor: resultado.kpis.valorTotalRadicado.toLocaleString("es-CO") },
      { Parámetro: "Total de registros radicados", Valor: resultado.kpis.totalRegistros.toLocaleString("es-CO") },
      { Parámetro: "Total de códigos diferentes", Valor: String(resultado.kpis.totalCodigosDiferentes) },
      { Parámetro: "Generado el", Valor: new Date().toLocaleString("es-CO", { timeZone: "America/Bogota" }) },
    ];

    let buffer: Buffer;
    if (formato === "csv") {
      buffer = Buffer.from(construirCsv(detalle, COLUMNAS_DETALLE), "utf-8");
    } else {
      const workbook = crearLibroExcel();
      agregarHojaExcel(
        workbook,
        filasParametros,
        [
          { header: "Parámetro", valor: (f) => f.Parámetro, anchoExcel: 32 },
          { header: "Valor", valor: (f) => f.Valor, anchoExcel: 45 },
        ],
        "Parámetros"
      );
      agregarHojaExcel(workbook, detalle, COLUMNAS_DETALLE, "Top 100");
      const arrayBuffer = await workbook.xlsx.writeBuffer();
      buffer = Buffer.from(arrayBuffer);
    }

    const contentType =
      formato === "xlsx" ? "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" : "text/csv;charset=utf-8";
    const extension = formato === "xlsx" ? "xlsx" : "csv";
    const nombreArchivo = `${sanearNombreArchivo(`Top_Impacto_${anio}`)}.${extension}`;

    return new NextResponse(new Uint8Array(buffer), {
      status: 200,
      headers: {
        "Content-Type": contentType,
        "Content-Disposition": `attachment; filename="${nombreArchivo}"`,
      },
    });
  } catch (error: any) {
    console.error("[export/top-impacto] Error generando exportación:", error);
    return NextResponse.json({ error: "No fue posible generar la exportación." }, { status: 500 });
  }
}
