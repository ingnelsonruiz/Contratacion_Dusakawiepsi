import { NextRequest, NextResponse } from "next/server";

import { getConsumoPrestador } from "@/app/actions/consumo-frecuencia-actions";
import { construirCsv, crearLibroExcel, agregarHojaExcel, type ColumnaExportable } from "@/lib/negociacion/exportar";
import type { TipoConsumo, FilaConsumoCodigo } from "@/types/consumo-frecuencia";

/**
 * Exportación binaria (Excel/CSV) del módulo Consumo y Frecuencia. Mismo
 * patrón que /api/export/comparativo y /api/export/historico-prestador:
 * Route Handler (no Server Action) porque el resultado es un archivo binario.
 */

const ETIQUETAS_TIPO: Record<TipoConsumo, string> = {
  servicios: "Procedimiento (CUPS)",
  medicamentos: "Medicamento (CUM)",
  insumos: "Insumo",
};

const NOMBRES_MES = [
  "Enero", "Febrero", "Marzo", "Abril", "Mayo", "Junio",
  "Julio", "Agosto", "Septiembre", "Octubre", "Noviembre", "Diciembre",
];

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

interface FilaDetalle {
  codigo: string;
  descripcion: string;
  tipo: string;
  cantidad: number;
  valorTotal: number;
  valorPromedio: number;
}

const COLUMNAS_DETALLE: ColumnaExportable<FilaDetalle>[] = [
  { header: "Código", valor: (f) => f.codigo, anchoExcel: 14 },
  { header: "Descripción", valor: (f) => f.descripcion, anchoExcel: 45 },
  { header: "Tipo", valor: (f) => f.tipo, anchoExcel: 20 },
  { header: "Cantidad", valor: (f) => f.cantidad, formato: "entero", anchoExcel: 14 },
  { header: "Valor total", valor: (f) => f.valorTotal, formato: "moneda", anchoExcel: 16 },
  { header: "Valor promedio", valor: (f) => f.valorPromedio, formato: "moneda", anchoExcel: 16 },
];

function mapearFila(f: FilaConsumoCodigo): FilaDetalle {
  return {
    codigo: f.codigoTarifa,
    descripcion: f.descripcion,
    tipo: ETIQUETAS_TIPO[f.tipo],
    cantidad: f.cantidad,
    valorTotal: f.valorTotal,
    valorPromedio: f.valorPromedio,
  };
}

export async function GET(request: NextRequest) {
  const params = request.nextUrl.searchParams;
  const codigoPrestador = params.get("codigoPrestador");
  const mes = Number(params.get("mes"));
  const anio = Number(params.get("anio"));
  const tipo = params.get("tipo") as TipoConsumo | null;
  const formato = (params.get("formato") ?? "xlsx") as "xlsx" | "csv";

  if (!codigoPrestador || !mes || !anio) {
    return NextResponse.json({ error: "Los parámetros 'codigoPrestador', 'mes' y 'anio' son obligatorios." }, { status: 400 });
  }

  try {
    const resultado = await getConsumoPrestador(codigoPrestador, mes, anio);
    if (!resultado) {
      return NextResponse.json({ error: "No se encontró información para ese prestador." }, { status: 404 });
    }

    let filas = resultado.filas;
    if (tipo) filas = filas.filter((f) => f.tipo === tipo);

    const detalle = filas.map(mapearFila);

    const filasParametros = [
      { Parámetro: "Prestador", Valor: `${resultado.razonSocial} (código ${resultado.codigoPrestador})` },
      { Parámetro: "Período", Valor: `${NOMBRES_MES[resultado.mes - 1]} ${resultado.anio}` },
      { Parámetro: "Filtro de tipo", Valor: tipo ? ETIQUETAS_TIPO[tipo] : "Todos" },
      { Parámetro: "Facturas del mes", Valor: String(resultado.kpis.cantidadFacturas) },
      { Parámetro: "Códigos distintos", Valor: String(detalle.length) },
      { Parámetro: "Valor total facturado", Valor: String(resultado.kpis.valorTotalFacturado) },
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
      agregarHojaExcel(workbook, detalle, COLUMNAS_DETALLE, "Consumo por código");
      const arrayBuffer = await workbook.xlsx.writeBuffer();
      buffer = Buffer.from(arrayBuffer);
    }

    const contentType =
      formato === "xlsx" ? "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" : "text/csv;charset=utf-8";
    const extension = formato === "xlsx" ? "xlsx" : "csv";
    const nombreArchivo = `${sanearNombreArchivo(`Consumo_${resultado.razonSocial}_${NOMBRES_MES[resultado.mes - 1]}_${resultado.anio}`)}.${extension}`;

    return new NextResponse(new Uint8Array(buffer), {
      status: 200,
      headers: {
        "Content-Type": contentType,
        "Content-Disposition": `attachment; filename="${nombreArchivo}"`,
      },
    });
  } catch (error: any) {
    console.error("[export/consumo-frecuencia] Error generando exportación:", error);
    return NextResponse.json({ error: "No fue posible generar la exportación." }, { status: 500 });
  }
}
