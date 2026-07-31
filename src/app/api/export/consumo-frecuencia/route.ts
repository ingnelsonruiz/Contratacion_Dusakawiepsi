import { NextRequest, NextResponse } from "next/server";

import { getConsumoPrestador } from "@/app/actions/consumo-frecuencia-actions";
import { validarRangoConsumo } from "@/lib/negociacion/consumo-frecuencia";
import { formatearFecha } from "@/lib/negociacion/formato";
import { construirCsv, crearLibroExcel, agregarHojaExcel, type ColumnaExportable } from "@/lib/negociacion/exportar";
import type { TipoConsumo, FilaConsumoCodigo } from "@/types/consumo-frecuencia";

/**
 * Exportación binaria (Excel/CSV) del módulo Consumo y Frecuencia. Mismo
 * patrón que /api/export/comparativo y /api/export/historico-prestador:
 * Route Handler (no Server Action) porque el resultado es un archivo binario.
 *
 * Corrección 2026-07-30: `mes`/`anio` → `fechaInicio`/`fechaFin` (rango
 * día-a-día), mismo cambio que en consumo-frecuencia-actions.ts. Se valida el
 * rango aquí ANTES de llamar a `getConsumoPrestador` para poder devolver un
 * 400 con el mensaje exacto (la Server Action también valida y lanza, pero
 * un Route Handler no debe depender de parsear el mensaje de una excepción
 * para decidir el código HTTP).
 */

const ETIQUETAS_TIPO: Record<TipoConsumo, string> = {
  servicios: "Procedimiento (CUPS)",
  medicamentos: "Medicamento (CUM)",
  insumos: "Insumo",
};

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
  const fechaInicio = params.get("fechaInicio");
  const fechaFin = params.get("fechaFin");
  const tipo = params.get("tipo") as TipoConsumo | null;
  const formato = (params.get("formato") ?? "xlsx") as "xlsx" | "csv";

  if (!codigoPrestador || !fechaInicio || !fechaFin) {
    return NextResponse.json({ error: "Los parámetros 'codigoPrestador', 'fechaInicio' y 'fechaFin' son obligatorios." }, { status: 400 });
  }

  const validacion = validarRangoConsumo(fechaInicio, fechaFin);
  if (!validacion.valido) {
    return NextResponse.json({ error: validacion.error }, { status: 400 });
  }

  try {
    const resultado = await getConsumoPrestador(codigoPrestador, fechaInicio, fechaFin);
    if (!resultado) {
      return NextResponse.json({ error: "No se encontró información para ese prestador." }, { status: 404 });
    }

    let filas = resultado.filas;
    if (tipo) filas = filas.filter((f) => f.tipo === tipo);

    const detalle = filas.map(mapearFila);

    const filasParametros = [
      { Parámetro: "Prestador", Valor: `${resultado.razonSocial} (código ${resultado.codigoPrestador})` },
      { Parámetro: "Período", Valor: `${formatearFecha(resultado.fechaInicio)} — ${formatearFecha(resultado.fechaFin)}` },
      { Parámetro: "Filtro de tipo", Valor: tipo ? ETIQUETAS_TIPO[tipo] : "Todos" },
      { Parámetro: "Facturas del período", Valor: String(resultado.kpis.cantidadFacturas) },
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
    const nombreArchivo = `${sanearNombreArchivo(`Consumo_${resultado.razonSocial}_${resultado.fechaInicio}_a_${resultado.fechaFin}`)}.${extension}`;

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
