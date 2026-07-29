import { NextRequest, NextResponse } from "next/server";

import { getPerfilPrestador } from "@/app/actions/perfil-prestador-actions";
import { etiquetaNivelSemaforo } from "@/lib/negociacion/comparativo";
import { etiquetaNivelRiesgo } from "@/lib/negociacion/dashboard-riesgo";
import { construirCsv, crearLibroExcel, agregarHojaExcel, type ColumnaExportable } from "@/lib/negociacion/exportar";
import type { FilaCodigoPerfil } from "@/types/perfil-prestador";
import type { NivelSemaforo, ReferenciaVariacion, TipoComparativo, UmbralesSemaforo } from "@/types/comparativo";

/**
 * Exportación binaria (Excel/CSV) de "Perfil Competitivo del Prestador".
 * Mismo patrón que /api/export/historico-prestador: Route Handler (no Server
 * Action) porque el resultado es un archivo binario para descarga.
 */

const ETIQUETAS_TIPO: Record<TipoComparativo, string> = {
  servicios: "Procedimientos (CUPS)",
  medicamentos: "Medicamentos (CUM)",
  insumos: "Insumos",
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
  municipio: string;
  prestadoresGrupo: number;
  valorPrestador: number;
  contratoPrestador: string | null;
  minimo: number;
  maximo: number;
  referencia: number;
  variacionPct: number;
  estado: string;
  otrosPrestadores: string;
}

const COLUMNAS_DETALLE: ColumnaExportable<FilaDetalle>[] = [
  { header: "Código", valor: (f) => f.codigo, anchoExcel: 14 },
  { header: "Descripción", valor: (f) => f.descripcion, anchoExcel: 45 },
  { header: "Municipio", valor: (f) => f.municipio, anchoExcel: 24 },
  { header: "Prestadores en el grupo", valor: (f) => f.prestadoresGrupo, formato: "entero", anchoExcel: 18 },
  { header: "Valor del prestador", valor: (f) => f.valorPrestador, formato: "moneda", anchoExcel: 18 },
  { header: "Contrato del prestador", valor: (f) => f.contratoPrestador, anchoExcel: 20 },
  { header: "Mínimo del grupo", valor: (f) => f.minimo, formato: "moneda", anchoExcel: 16 },
  { header: "Máximo del grupo", valor: (f) => f.maximo, formato: "moneda", anchoExcel: 16 },
  { header: "Referencia del grupo", valor: (f) => f.referencia, formato: "moneda", anchoExcel: 18 },
  { header: "Variación %", valor: (f) => Number(f.variacionPct.toFixed(2)), formato: "porcentaje", anchoExcel: 14 },
  { header: "Estado", valor: (f) => f.estado, anchoExcel: 26 },
  // Pedido 2026-07-29: "para ubicar rápidamente su número de contrato" —
  // también de los OTROS prestadores del grupo, no solo el analizado.
  { header: "Otros prestadores del grupo (razón social · NIT · contrato · valor)", valor: (f) => f.otrosPrestadores, anchoExcel: 70 },
];

function mapearFila(f: FilaCodigoPerfil): FilaDetalle {
  return {
    codigo: f.codigoTarifa,
    descripcion: f.descripcion,
    municipio: f.municipioNombre,
    prestadoresGrupo: f.cantidadPrestadoresGrupo,
    valorPrestador: f.valorPrestador,
    contratoPrestador: f.numeroContratoPrestador,
    minimo: f.minimo,
    maximo: f.maximo,
    referencia: f.valorReferencia,
    variacionPct: f.variacionPct,
    estado: etiquetaNivelSemaforo(f.nivel),
    otrosPrestadores: f.prestadoresGrupo
      .filter((p) => !p.esEstePrestador)
      .map((p) => `${p.razonSocial} · NIT ${p.nit} · Contrato ${p.numeroContrato} · $${p.valorFinal.toLocaleString("es-CO")}`)
      .join(" | "),
  };
}

export async function GET(request: NextRequest) {
  const params = request.nextUrl.searchParams;
  const ips = Number(params.get("ips") ?? 0);
  const tipo = (params.get("tipo") ?? "servicios") as TipoComparativo;
  const referencia = (params.get("referencia") ?? "promedio") as ReferenciaVariacion;
  const alertaPct = Number(params.get("alertaPct") ?? 1);
  const criticoPct = Number(params.get("criticoPct") ?? 10);
  const nivel = params.get("nivel") as NivelSemaforo | null;
  const formato = (params.get("formato") ?? "xlsx") as "xlsx" | "csv";

  if (!ips) {
    return NextResponse.json({ error: "El parámetro 'ips' es obligatorio." }, { status: 400 });
  }

  const umbrales: UmbralesSemaforo = { alertaPct, criticoPct };

  try {
    const resultado = await getPerfilPrestador(ips, tipo, referencia, umbrales);

    let codigos = resultado.codigos;
    if (nivel) codigos = codigos.filter((c) => c.nivel === nivel);

    const detalle = codigos.map(mapearFila);

    const filasParametros = [
      { Parámetro: "Prestador", Valor: `${resultado.razonSocial} (NIT ${resultado.nit})` },
      { Parámetro: "Tipo de tarifario", Valor: ETIQUETAS_TIPO[tipo] },
      { Parámetro: "Comparar contra", Valor: referencia === "promedio" ? "Promedio del grupo" : "Mediana del grupo" },
      { Parámetro: "Umbral de alerta (%)", Valor: String(alertaPct) },
      { Parámetro: "Umbral crítico (%)", Valor: String(criticoPct) },
      { Parámetro: "Filtro de estado", Valor: nivel ? etiquetaNivelSemaforo(nivel) : "Todos" },
      { Parámetro: "Total de códigos en el reporte", Valor: String(detalle.length) },
      {
        Parámetro: "Score de riesgo",
        Valor: resultado.resumen ? `${resultado.resumen.score} / 100 (${etiquetaNivelRiesgo(resultado.resumen.nivelRiesgo)})` : "N/A",
      },
      {
        Parámetro: "Posición en el ranking",
        Valor: resultado.resumen ? `${resultado.posicionRanking} de ${resultado.totalPrestadoresRanking}` : "N/A",
      },
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
      agregarHojaExcel(workbook, detalle, COLUMNAS_DETALLE, "Detalle por código");
      const arrayBuffer = await workbook.xlsx.writeBuffer();
      buffer = Buffer.from(arrayBuffer);
    }

    const contentType =
      formato === "xlsx" ? "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" : "text/csv;charset=utf-8";
    const extension = formato === "xlsx" ? "xlsx" : "csv";
    const nombreArchivo = `${sanearNombreArchivo(`Perfil_${resultado.razonSocial}`)}.${extension}`;

    return new NextResponse(new Uint8Array(buffer), {
      status: 200,
      headers: {
        "Content-Type": contentType,
        "Content-Disposition": `attachment; filename="${nombreArchivo}"`,
      },
    });
  } catch (error: any) {
    console.error("[export/perfil-prestador] Error generando exportación:", error);
    return NextResponse.json({ error: "No fue posible generar la exportación." }, { status: 500 });
  }
}
