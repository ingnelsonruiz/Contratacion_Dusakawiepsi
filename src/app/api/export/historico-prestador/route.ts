import { NextRequest, NextResponse } from "next/server";

import { getHistoricoPrestador } from "@/app/actions/historico-prestador-actions";
import { etiquetaNivelSemaforo } from "@/lib/negociacion/comparativo";
import { construirCsv, crearLibroExcel, agregarHojaExcel, type ColumnaExportable } from "@/lib/negociacion/exportar";
import type { FilaHistoricoCodigo, TipoTarifaHistorico } from "@/types/historico-prestador";
import type { NivelSemaforo, UmbralesSemaforo } from "@/types/comparativo";

/**
 * Exportación binaria (Excel/CSV) del módulo Comparativo Histórico del
 * Prestador. Mismo patrón que /api/export/comparativo: Route Handler (no
 * Server Action) porque el resultado es un archivo binario para descarga.
 *
 * A diferencia del Módulo 2, aquí una fila = un código (no hay lista de
 * prestadores anidada por código), así que basta con 2 hojas en Excel:
 * Parámetros + Detalle por código.
 */

const ETIQUETAS_TIPO: Record<TipoTarifaHistorico, string> = {
  servicios: "Procedimiento (CUPS)",
  medicamentos: "Medicamento (CUM)",
  insumos: "Insumo",
  otros: "Otro",
};

function parsearEstados(valor: string | null): NivelSemaforo[] | undefined {
  if (!valor) return undefined;
  const validos: NivelSemaforo[] = ["ok", "alerta", "critico", "favorable", "muyFavorable"];
  const estados = valor.split(",").map((s) => s.trim()) as NivelSemaforo[];
  return estados.filter((e) => validos.includes(e));
}

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
  valor2025: number | null;
  contrato2025: string | null;
  valorVigente: number | null;
  contratoVigente: string | null;
  variacionAbsoluta: number | null;
  variacionPct: number | null;
  estado: string;
}

const COLUMNAS_DETALLE: ColumnaExportable<FilaDetalle>[] = [
  { header: "Código", valor: (f) => f.codigo, anchoExcel: 14 },
  { header: "Descripción", valor: (f) => f.descripcion, anchoExcel: 45 },
  { header: "Tipo", valor: (f) => f.tipo, anchoExcel: 20 },
  { header: "Valor 2025", valor: (f) => f.valor2025, formato: "moneda", anchoExcel: 16 },
  { header: "Contrato 2025", valor: (f) => f.contrato2025, anchoExcel: 20 },
  { header: "Valor vigente", valor: (f) => f.valorVigente, formato: "moneda", anchoExcel: 16 },
  { header: "Contrato vigente", valor: (f) => f.contratoVigente, anchoExcel: 20 },
  { header: "Variación $", valor: (f) => f.variacionAbsoluta, formato: "moneda", anchoExcel: 16 },
  { header: "Variación %", valor: (f) => (f.variacionPct !== null ? Number(f.variacionPct.toFixed(2)) : null), formato: "porcentaje", anchoExcel: 14 },
  { header: "Estado", valor: (f) => f.estado, anchoExcel: 26 },
];

function mapearFila(f: FilaHistoricoCodigo): FilaDetalle {
  return {
    codigo: f.codigoTarifa,
    descripcion: f.descripcion,
    tipo: ETIQUETAS_TIPO[f.tipo],
    valor2025: f.valor2025,
    contrato2025: f.contrato2025,
    valorVigente: f.valorVigente,
    contratoVigente: f.contratoVigente,
    variacionAbsoluta: f.variacionAbsoluta,
    variacionPct: f.variacionPct,
    estado: f.nivel ? etiquetaNivelSemaforo(f.nivel) : f.valorVigente === null ? "Solo en 2025 (eliminado)" : "Nuevo (sin foto 2025)",
  };
}

export async function GET(request: NextRequest) {
  const params = request.nextUrl.searchParams;
  const nit = params.get("nit");
  const alertaPct = Number(params.get("alertaPct") ?? 1);
  const criticoPct = Number(params.get("criticoPct") ?? 10);
  const tipo = params.get("tipo") as TipoTarifaHistorico | null;
  const estadosFiltro = parsearEstados(params.get("estados"));
  const segmento = params.get("segmento") as "comparados" | "nuevos" | "eliminados" | null;
  const direccion = params.get("direccion") as "subieron" | "bajaron" | "igual" | null;
  const formato = (params.get("formato") ?? "xlsx") as "xlsx" | "csv";

  if (!nit) {
    return NextResponse.json({ error: "El parámetro 'nit' es obligatorio." }, { status: 400 });
  }

  const umbrales: UmbralesSemaforo = { alertaPct, criticoPct };

  try {
    const resultado = await getHistoricoPrestador(nit, umbrales);
    if (!resultado) {
      return NextResponse.json({ error: "No se encontró histórico para ese prestador." }, { status: 404 });
    }

    let filas = resultado.filas;
    if (tipo) filas = filas.filter((f) => f.tipo === tipo);
    if (estadosFiltro && estadosFiltro.length > 0) {
      const set = new Set(estadosFiltro);
      filas = filas.filter((f) => f.nivel && set.has(f.nivel));
    }
    // Mismo segmentador (comparados/nuevos/eliminados) disponible en la UI —
    // pedido del usuario 2026-07-29 — para que el Excel/CSV refleje
    // exactamente lo que el analista está viendo en pantalla al exportar.
    if (segmento === "comparados") filas = filas.filter((f) => f.valor2025 !== null && f.valorVigente !== null);
    if (segmento === "nuevos") filas = filas.filter((f) => f.valor2025 === null);
    if (segmento === "eliminados") filas = filas.filter((f) => f.valorVigente === null);
    // Sub-segmentador subieron/bajaron/igual dentro de "comparados" — mismo
    // criterio (signo de `variacionAbsoluta`) que usa `calcularKpisHistoricoPrestador`.
    if (direccion === "subieron") filas = filas.filter((f) => f.variacionAbsoluta !== null && f.variacionAbsoluta > 0);
    if (direccion === "bajaron") filas = filas.filter((f) => f.variacionAbsoluta !== null && f.variacionAbsoluta < 0);
    if (direccion === "igual") filas = filas.filter((f) => f.variacionAbsoluta !== null && f.variacionAbsoluta === 0);

    const detalle = filas.map(mapearFila);

    const filasParametros = [
      { Parámetro: "Prestador", Valor: `${resultado.razonSocial} (NIT ${resultado.nit})` },
      { Parámetro: "Comparación", Valor: "Foto histórica 2025 vs. valor vigente hoy en ARYUWIS" },
      { Parámetro: "Umbral de alerta (%)", Valor: String(alertaPct) },
      { Parámetro: "Umbral crítico (%)", Valor: String(criticoPct) },
      { Parámetro: "Filtro de tipo", Valor: tipo ? ETIQUETAS_TIPO[tipo] : "Todos" },
      {
        Parámetro: "Estados filtrados",
        Valor: estadosFiltro && estadosFiltro.length > 0 ? estadosFiltro.map(etiquetaNivelSemaforo).join(", ") : "Todos",
      },
      {
        Parámetro: "Segmento filtrado",
        Valor:
          segmento === "comparados"
            ? "Solo códigos comparados (ambos lados)"
            : segmento === "nuevos"
              ? "Solo códigos nuevos"
              : segmento === "eliminados"
                ? "Solo códigos eliminados"
                : "Todos",
      },
      {
        Parámetro: "Dirección filtrada",
        Valor: direccion === "subieron" ? "Solo subieron" : direccion === "bajaron" ? "Solo bajaron" : direccion === "igual" ? "Solo sin cambio" : "Todas",
      },
      { Parámetro: "Total de códigos en el reporte", Valor: String(detalle.length) },
      { Parámetro: "Códigos comparados (en ambos lados)", Valor: String(resultado.kpis.cantidadCodigosComparados) },
      { Parámetro: "Incremento acumulado", Valor: String(resultado.kpis.incrementoAcumulado) },
      { Parámetro: "Incremento acumulado (%)", Valor: resultado.kpis.incrementoAcumuladoPct.toFixed(2) },
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
    const nombreArchivo = `${sanearNombreArchivo(`Historico_${resultado.razonSocial}`)}.${extension}`;

    return new NextResponse(new Uint8Array(buffer), {
      status: 200,
      headers: {
        "Content-Type": contentType,
        "Content-Disposition": `attachment; filename="${nombreArchivo}"`,
      },
    });
  } catch (error: any) {
    console.error("[export/historico-prestador] Error generando exportación:", error);
    return NextResponse.json({ error: "No fue posible generar la exportación." }, { status: 500 });
  }
}
