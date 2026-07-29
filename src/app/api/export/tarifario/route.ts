import { NextRequest, NextResponse } from "next/server";

import {
  getTarifarioServicios,
  getTarifarioMedicamentos,
  getTarifarioInsumos,
  getTarifarioPaquetes,
  getTarifarioOtros,
} from "@/app/actions/tarifario-actions";
import { construirCsv, construirLibroExcel, LIMITE_FILAS_EXPORTACION, type ColumnaExportable } from "@/lib/negociacion/exportar";
import type {
  TarifaServicioRow,
  TarifaMedicamentoRow,
  TarifaInsumoRow,
  TarifaPaqueteRow,
  TipoTarifario,
} from "@/types/tarifarios";

/**
 * Exportación binaria (Excel/CSV) del tarifario de un contrato. Route Handler
 * (no Server Action) porque el resultado es un archivo binario que el
 * navegador debe descargar — convención documentada en docs/ARQUITECTURA.md
 * §2.1. Reutiliza las mismas Server Actions de lectura que la UI para no
 * duplicar lógica de negocio ni de acceso a datos.
 */

const COLUMNAS_SERVICIOS: ColumnaExportable<TarifaServicioRow>[] = [
  { header: "Código CUPS", valor: (f) => f.cupCodigoInterno ?? f.codigoPropio, anchoExcel: 14 },
  { header: "Descripción", valor: (f) => f.descripcion, anchoExcel: 45 },
  { header: "Tarifa contratada (código)", valor: (f) => f.codigoTarifa, anchoExcel: 16 },
  { header: "Valor final", valor: (f) => f.valorFinal, formato: "moneda", anchoExcel: 16 },
  { header: "Observaciones", valor: () => "", anchoExcel: 25 },
];

const COLUMNAS_MEDICAMENTOS: ColumnaExportable<TarifaMedicamentoRow>[] = [
  { header: "Código CUM", valor: (f) => f.cum ?? f.codigoPropio, anchoExcel: 14 },
  { header: "Nombre comercial", valor: (f) => f.nombreComercial ?? f.descripcion, anchoExcel: 32 },
  { header: "Principio activo", valor: (f) => f.principioActivo ?? "", anchoExcel: 28 },
  { header: "Presentación", valor: (f) => f.presentacion ?? "", anchoExcel: 22 },
  { header: "Laboratorio", valor: (f) => f.laboratorio ?? "", anchoExcel: 22 },
  { header: "Valor contratado", valor: (f) => f.valorFinal, formato: "moneda", anchoExcel: 16 },
  { header: "Unidad", valor: (f) => f.unidad ?? "", anchoExcel: 14 },
  { header: "Observaciones", valor: () => "", anchoExcel: 25 },
];

const COLUMNAS_INSUMOS: ColumnaExportable<TarifaInsumoRow>[] = [
  { header: "Código interno", valor: (f) => f.insumoCodigoInterno ?? f.codigoPropio, anchoExcel: 16 },
  { header: "Descripción", valor: (f) => f.insumoDescripcion ?? f.descripcion, anchoExcel: 45 },
  { header: "Unidad", valor: (f) => f.unidad ?? "", anchoExcel: 14 },
  { header: "Valor contratado", valor: (f) => f.valorFinal, formato: "moneda", anchoExcel: 16 },
  { header: "Observaciones", valor: () => "", anchoExcel: 25 },
];

const COLUMNAS_PAQUETES: ColumnaExportable<TarifaPaqueteRow>[] = [
  { header: "Origen", valor: (f) => f.origen, anchoExcel: 14 },
  { header: "Código paquete", valor: (f) => f.codigoPaquete ?? f.codigoTarifa, anchoExcel: 16 },
  { header: "Código propio", valor: (f) => f.codigoPropio, anchoExcel: 14 },
  { header: "Descripción", valor: (f) => f.descripcion, anchoExcel: 45 },
  { header: "Valor final", valor: (f) => f.valorFinal, formato: "moneda", anchoExcel: 16 },
];

export async function GET(request: NextRequest) {
  const params = request.nextUrl.searchParams;
  const contrato = Number(params.get("contrato"));
  const tipo = params.get("tipo") as TipoTarifario | null;
  const formato = (params.get("formato") ?? "csv") as "xlsx" | "csv";
  const busqueda = params.get("busqueda") ?? undefined;

  if (!contrato || !tipo) {
    return NextResponse.json({ error: "Parámetros 'contrato' y 'tipo' son obligatorios." }, { status: 400 });
  }

  const paginacion = { busqueda, page: 1, pageSize: LIMITE_FILAS_EXPORTACION };

  let buffer: Buffer;
  let contentType: string;
  let extension: string;

  try {
    if (tipo === "servicios") {
      const { filas } = await getTarifarioServicios(contrato, paginacion);
      buffer = await construirArchivo(filas, COLUMNAS_SERVICIOS, "Procedimientos", formato);
    } else if (tipo === "otros") {
      const { filas } = await getTarifarioOtros(contrato, paginacion);
      buffer = await construirArchivo(filas, COLUMNAS_SERVICIOS, "Otros", formato);
    } else if (tipo === "medicamentos") {
      const { filas } = await getTarifarioMedicamentos(contrato, paginacion);
      buffer = await construirArchivo(filas, COLUMNAS_MEDICAMENTOS, "Medicamentos", formato);
    } else if (tipo === "insumos") {
      const { filas } = await getTarifarioInsumos(contrato, paginacion);
      buffer = await construirArchivo(filas, COLUMNAS_INSUMOS, "Insumos", formato);
    } else if (tipo === "paquetes") {
      const { filas } = await getTarifarioPaquetes(contrato, paginacion);
      buffer = await construirArchivo(filas, COLUMNAS_PAQUETES, "Paquetes", formato);
    } else {
      return NextResponse.json({ error: `Tipo de tarifario no soportado: ${tipo}` }, { status: 400 });
    }
  } catch (error: any) {
    console.error("[export/tarifario] Error generando exportación:", error);
    return NextResponse.json({ error: "No fue posible generar la exportación." }, { status: 500 });
  }

  contentType =
    formato === "xlsx"
      ? "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
      : "text/csv;charset=utf-8";
  extension = formato === "xlsx" ? "xlsx" : "csv";

  return new NextResponse(new Uint8Array(buffer), {
    status: 200,
    headers: {
      "Content-Type": contentType,
      "Content-Disposition": `attachment; filename="tarifario-${tipo}-${contrato}.${extension}"`,
    },
  });
}

async function construirArchivo<T>(
  filas: T[],
  columnas: ColumnaExportable<T>[],
  nombreHoja: string,
  formato: "xlsx" | "csv"
): Promise<Buffer> {
  if (formato === "csv") {
    return Buffer.from(construirCsv(filas, columnas), "utf-8");
  }
  const workbook = await construirLibroExcel(filas, columnas, nombreHoja);
  const arrayBuffer = await workbook.xlsx.writeBuffer();
  return Buffer.from(arrayBuffer);
}
