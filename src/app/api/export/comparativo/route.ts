import { NextRequest, NextResponse } from "next/server";

import {
  getComparativoMunicipioCompleto,
  getComparativoPorCodigo,
} from "@/app/actions/comparativo-actions";
import { filtrarYRecortarPorEstados, etiquetaNivelSemaforo, clasificarSemaforo } from "@/lib/negociacion/comparativo";
import {
  construirCsv,
  crearLibroExcel,
  agregarHojaExcel,
  type ColumnaExportable,
} from "@/lib/negociacion/exportar";
import type {
  TipoComparativo,
  ReferenciaVariacion,
  UmbralesSemaforo,
  NivelSemaforo,
  FilaComparativoCodigo,
} from "@/types/comparativo";

/**
 * Exportación binaria (Excel/CSV) del Módulo 2 — Comparativo entre
 * Prestadores. Route Handler (no Server Action) por la misma convención del
 * Módulo 1: los archivos binarios se generan aquí, reutilizando las Server
 * Actions de solo lectura para no duplicar acceso a datos.
 *
 * El "informe completo" pedido por el usuario 2026-07-28 tiene 3 hojas en
 * Excel (CSV solo trae la de detalle, por ser de una sola tabla):
 *   1. Parámetros  — con qué filtros/umbrales se generó el reporte
 *   2. Resumen por código — una fila por código (min/máx/promedio/mediana/amplitud)
 *   3. Detalle por prestador — una fila por prestador+código, con su semáforo
 *      (ideal para que el analista arme tablas dinámicas en Excel)
 *
 * Reutiliza exactamente la misma lógica de filtro que la UI
 * (`filtrarYRecortarPorEstados`, `getComparativoMunicipioCompleto`) para que
 * el archivo descargado coincida con lo que el usuario está viendo en
 * pantalla — nunca se recalculan reglas de negocio aquí.
 */

const ETIQUETAS_TIPO: Record<TipoComparativo, string> = {
  servicios: "Procedimientos (CUPS)",
  medicamentos: "Medicamentos (CUM)",
  insumos: "Insumos",
};

function parsearEstados(valor: string | null): NivelSemaforo[] | undefined {
  if (!valor) return undefined;
  const validos: NivelSemaforo[] = ["ok", "alerta", "critico", "favorable", "muyFavorable"];
  const estados = valor.split(",").map((s) => s.trim()) as NivelSemaforo[];
  return estados.filter((e) => validos.includes(e));
}

/** Nombre de archivo seguro: sin tildes/Ñ/espacios/caracteres especiales que puedan romper el header Content-Disposition. */
function sanearNombreArchivo(texto: string): string {
  // \u0300-\u036f = rango Unicode "Combining Diacritical Marks" — se usa el
  // código unicode explícito (no el caracter literal) para evitar el bug de
  // caracteres invisibles documentado en CLAUDE.md §9 al editar este tipo
  // de archivo con Edit/Write.
  return texto
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-zA-Z0-9-_]+/g, "_")
    .replace(/_+/g, "_")
    .replace(/^_|_$/g, "");
}

const COLUMNAS_RESUMEN: ColumnaExportable<FilaComparativoCodigo>[] = [
  { header: "Departamento", valor: (f) => f.departamentoNombre, anchoExcel: 18 },
  { header: "Municipio", valor: (f) => f.municipioNombre, anchoExcel: 18 },
  { header: "Código", valor: (f) => f.codigoTarifa, anchoExcel: 14 },
  { header: "Descripción", valor: (f) => f.descripcion, anchoExcel: 45 },
  { header: "Prestadores", valor: (f) => f.cantidadPrestadores, formato: "entero", anchoExcel: 12 },
  { header: "Mínimo", valor: (f) => f.minimo, formato: "moneda", anchoExcel: 16 },
  { header: "Máximo", valor: (f) => f.maximo, formato: "moneda", anchoExcel: 16 },
  { header: "Promedio", valor: (f) => f.promedio, formato: "moneda", anchoExcel: 16 },
  { header: "Mediana", valor: (f) => f.mediana, formato: "moneda", anchoExcel: 16 },
  { header: "Amplitud %", valor: (f) => Number(f.amplitudPct.toFixed(2)), formato: "porcentaje", anchoExcel: 14 },
];

interface FilaDetalle {
  departamento: string;
  municipio: string;
  codigo: string;
  descripcion: string;
  prestador: string;
  nit: string;
  contrato: string;
  valor: number;
  variacionPromedio: number;
  variacionMediana: number;
  estado: string;
}

const COLUMNAS_DETALLE: ColumnaExportable<FilaDetalle>[] = [
  { header: "Departamento", valor: (f) => f.departamento, anchoExcel: 18 },
  { header: "Municipio", valor: (f) => f.municipio, anchoExcel: 18 },
  { header: "Código", valor: (f) => f.codigo, anchoExcel: 14 },
  { header: "Descripción", valor: (f) => f.descripcion, anchoExcel: 45 },
  { header: "Prestador", valor: (f) => f.prestador, anchoExcel: 35 },
  { header: "NIT", valor: (f) => f.nit, anchoExcel: 14 },
  { header: "Contrato", valor: (f) => f.contrato, anchoExcel: 20 },
  { header: "Valor", valor: (f) => f.valor, formato: "moneda", anchoExcel: 16 },
  { header: "Variación % vs. Promedio", valor: (f) => Number(f.variacionPromedio.toFixed(2)), formato: "porcentaje", anchoExcel: 20 },
  { header: "Variación % vs. Mediana", valor: (f) => Number(f.variacionMediana.toFixed(2)), formato: "porcentaje", anchoExcel: 20 },
  { header: "Estado semáforo", valor: (f) => f.estado, anchoExcel: 26 },
];

function aplanarDetalle(grupos: FilaComparativoCodigo[], referencia: ReferenciaVariacion, umbrales: UmbralesSemaforo): FilaDetalle[] {
  const filas: FilaDetalle[] = [];
  for (const g of grupos) {
    for (const p of g.prestadores) {
      const variacion = referencia === "promedio" ? p.variacionPctPromedio : p.variacionPctMediana;
      // Misma función de negocio que clasifica el semáforo en la UI y en
      // filtrarYRecortarPorEstados — ver src/lib/negociacion/comparativo.ts.
      filas.push({
        departamento: g.departamentoNombre,
        municipio: g.municipioNombre,
        codigo: g.codigoTarifa,
        descripcion: g.descripcion,
        prestador: p.razonSocial,
        nit: p.nit,
        contrato: p.numeroContrato,
        valor: p.valorFinal,
        variacionPromedio: p.variacionPctPromedio,
        variacionMediana: p.variacionPctMediana,
        estado: etiquetaNivelSemaforo(clasificarSemaforo(variacion, umbrales)),
      });
    }
  }
  return filas;
}

export async function GET(request: NextRequest) {
  const params = request.nextUrl.searchParams;
  const modo = params.get("modo") as "municipio" | "codigo" | null;
  const tipo = params.get("tipo") as TipoComparativo | null;
  const municipio = params.get("municipio") ?? undefined;
  const busqueda = params.get("busqueda") ?? undefined;
  const referencia = (params.get("referencia") as ReferenciaVariacion) || "promedio";
  const alertaPct = Number(params.get("alertaPct") ?? 1);
  const criticoPct = Number(params.get("criticoPct") ?? 10);
  const estadosFiltro = parsearEstados(params.get("estados"));
  const formato = (params.get("formato") ?? "xlsx") as "xlsx" | "csv";

  if (!modo || !tipo || !ETIQUETAS_TIPO[tipo]) {
    return NextResponse.json({ error: "Parámetros 'modo' y 'tipo' son obligatorios." }, { status: 400 });
  }
  if (modo === "municipio" && !municipio) {
    return NextResponse.json({ error: "El parámetro 'municipio' es obligatorio en modo 'municipio'." }, { status: 400 });
  }
  if (modo === "codigo" && !busqueda?.trim()) {
    return NextResponse.json({ error: "El parámetro 'busqueda' es obligatorio en modo 'codigo'." }, { status: 400 });
  }

  const umbrales: UmbralesSemaforo = { alertaPct, criticoPct };

  let grupos: FilaComparativoCodigo[];
  let nombreArchivoBase: string;
  const filasParametros: { Parámetro: string; Valor: string }[] = [
    { Parámetro: "Tipo de tarifario", Valor: ETIQUETAS_TIPO[tipo] },
    { Parámetro: "Vista", Valor: modo === "municipio" ? "Comparativo por municipio" : "Búsqueda por código específico" },
  ];

  try {
    if (modo === "municipio") {
      const resultado = await getComparativoMunicipioCompleto(municipio!, tipo, busqueda, referencia, umbrales, estadosFiltro);
      grupos = resultado.grupos;
      filasParametros.push(
        { Parámetro: "Departamento", Valor: resultado.departamentoNombre },
        { Parámetro: "Municipio", Valor: resultado.municipioNombre }
      );
      nombreArchivoBase = `Comparativo_${resultado.municipioNombre}_${ETIQUETAS_TIPO[tipo]}`;
    } else {
      const resultadoCompleto = await getComparativoPorCodigo(busqueda!, tipo, municipio || undefined);
      grupos = filtrarYRecortarPorEstados(resultadoCompleto, referencia, umbrales, estadosFiltro);
      filasParametros.push({ Parámetro: "Código/descripción buscado", Valor: busqueda! });
      if (municipio) {
        filasParametros.push({ Parámetro: "Municipio (filtro)", Valor: grupos[0]?.municipioNombre ?? municipio });
      }
      nombreArchivoBase = `Comparativo_Busqueda_${busqueda}_${ETIQUETAS_TIPO[tipo]}`;
    }

    if (busqueda && modo === "municipio") {
      filasParametros.push({ Parámetro: "Filtro de código/descripción", Valor: busqueda });
    }
    filasParametros.push(
      { Parámetro: "Comparado contra", Valor: referencia === "promedio" ? "Promedio" : "Mediana" },
      { Parámetro: "Umbral de alerta (%)", Valor: String(alertaPct) },
      { Parámetro: "Umbral crítico (%)", Valor: String(criticoPct) },
      {
        Parámetro: "Estados filtrados",
        Valor: estadosFiltro && estadosFiltro.length > 0 ? estadosFiltro.map(etiquetaNivelSemaforo).join(", ") : "Todos",
      },
      { Parámetro: "Total de códigos en el reporte", Valor: String(grupos.length) },
      { Parámetro: "Generado el", Valor: new Date().toLocaleString("es-CO", { timeZone: "America/Bogota" }) }
    );

    const detalle = aplanarDetalle(grupos, referencia, umbrales);
    let buffer: Buffer;

    if (formato === "csv") {
      buffer = Buffer.from(construirCsv(detalle, COLUMNAS_DETALLE), "utf-8");
    } else {
      const workbook = crearLibroExcel();
      agregarHojaExcel(
        workbook,
        filasParametros,
        [
          { header: "Parámetro", valor: (f) => f.Parámetro, anchoExcel: 30 },
          { header: "Valor", valor: (f) => f.Valor, anchoExcel: 40 },
        ],
        "Parámetros"
      );
      agregarHojaExcel(workbook, grupos, COLUMNAS_RESUMEN, "Resumen por código");
      agregarHojaExcel(workbook, detalle, COLUMNAS_DETALLE, "Detalle por prestador");
      const arrayBuffer = await workbook.xlsx.writeBuffer();
      buffer = Buffer.from(arrayBuffer);
    }

    const contentType =
      formato === "xlsx" ? "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" : "text/csv;charset=utf-8";
    const extension = formato === "xlsx" ? "xlsx" : "csv";
    const nombreArchivo = `${sanearNombreArchivo(nombreArchivoBase)}.${extension}`;

    return new NextResponse(new Uint8Array(buffer), {
      status: 200,
      headers: {
        "Content-Type": contentType,
        "Content-Disposition": `attachment; filename="${nombreArchivo}"`,
      },
    });
  } catch (error: any) {
    console.error("[export/comparativo] Error generando exportación:", error);
    return NextResponse.json({ error: "No fue posible generar la exportación." }, { status: 500 });
  }
}
