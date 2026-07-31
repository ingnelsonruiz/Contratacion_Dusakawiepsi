import { NextRequest, NextResponse } from "next/server";

import { evaluarPropuestaPrestador } from "@/app/actions/analisis-propuesta-actions";
import { etiquetaNivelSemaforo } from "@/lib/negociacion/comparativo";
import { construirCsv, crearLibroExcel, agregarHojaExcel, type ColumnaExportable } from "@/lib/negociacion/exportar";
import type { FilaEvaluacionPropuesta } from "@/types/analisis-propuesta";

/**
 * Exportación binaria (Excel/CSV) de "Análisis de Propuesta del Prestador".
 *
 * A diferencia del resto de exportaciones del proyecto (`GET` con query
 * params, ver /api/export/comparativo), esta es la única que necesita `POST`
 * con `FormData`: el resultado depende de un archivo binario subido por el
 * usuario, que no puede viajar en una URL como los demás filtros. Reutiliza
 * `evaluarPropuestaPrestador` (la MISMA Server Action que usa la UI) para que
 * el archivo descargado coincida exactamente con lo que el analista ve en
 * pantalla — nunca se recalcula la evaluación con una lógica distinta.
 *
 * Dos "vistas" (campo `vista` del FormData):
 *   - "completo" (por defecto): el análisis completo — 4 hojas en Excel
 *     (Parámetros, Resultado por código, Prestadores de referencia,
 *     Referencias de mercado — otras EPS), o la hoja de resultado sola en
 *     CSV. Para uso interno del analista.
 *   - "contrapropuesta": documento de trabajo para preparar la negociación —
 *     Código, Descripción, Tipo, Precio ofertado y, a continuación, un GRUPO
 *     de columnas por cada valor más económico YA CONOCIDO que la oferta (de
 *     menor a mayor: "Opción 1 (más económica)" + "Fuente Opción 1" +
 *     "Prestador/EPS Opción 1" + "Contrato Opción 1", "Opción 2" + …) —
 *     mezclando tanto lo YA contratado por Dusakawi en el municipio como lo
 *     reportado por OTRAS EPS (tabla `negociacion_contratacion_precio_
 *     referencia_eps`, 2026-07-31), para que el negociador elija cuál usar
 *     como base de la contraoferta. No se pre-elige un único valor
 *     automáticamente (corrección 2026-07-31: la primera versión calculaba
 *     un solo "valor de contrapropuesta" automático contra la mediana/
 *     promedio; el usuario pidió en su lugar ver TODAS las ofertas ya
 *     vigentes más baratas, como columnas, para decidir él mismo). El número
 *     de grupos de columnas es dinámico: tantos como el código con MÁS
 *     opciones más económicas en todo el archivo — el resto de filas quedan
 *     con celdas vacías donde no aplique.
 *
 *     Historial de la vista "contrapropuesta" (mismo día, 2026-07-31, tres
 *     pedidos de seguimiento sucesivos):
 *       1. Primero solo mostraba los valores numéricos ("Opción N"), sin
 *          identificar la fuente.
 *       2. Se agregó "Fuente Opción N" ("Contrato propio" / "Otra EPS") —
 *          categoría del origen, sin identidad exacta.
 *       3. **Este cambio**: el usuario pidió explícitamente el detalle
 *          completo — *"necesito saber el número de contrato y quien es el
 *          prestador en Contrato propio y si es otra IPS cual es el nombre
 *          queda más completo"* — así que ahora SÍ se incluye la razón
 *          social del prestador propio (o el nombre de la EPS externa) y el
 *          número de contrato cuando aplica. Con esto, el archivo deja de
 *          ser un documento sanitizado apto para entregar tal cual a un
 *          prestador externo — es un documento de trabajo INTERNO para que
 *          el analista prepare la negociación con el detalle completo; si se
 *          va a compartir con el prestador, debe revisarse/editarse antes.
 */

const ETIQUETAS_TIPO: Record<string, string> = {
  servicios: "Procedimiento (CUPS)",
  medicamentos: "Medicamento (CUM)",
  insumos: "Insumo",
  noEncontrado: "No identificado",
};

interface FilaResumen {
  codigo: string;
  descripcion: string;
  tipo: string;
  precioOfertado: number;
  minimo: number | null;
  maximo: number | null;
  promedio: number | null;
  mediana: number | null;
  variacionPctPromedio: number | null;
  variacionPctMediana: number | null;
  estado: string;
  cantidadPrestadores: number;
  cantidadReferenciasMercadoEps: number;
}

interface FilaDetallePrestador {
  codigo: string;
  descripcion: string;
  prestador: string;
  nit: string;
  contrato: string;
  valor: number;
  porDebajoDeMediana: string;
  porDebajoDeLaOferta: string;
}

interface FilaDetalleMercadoEps {
  codigo: string;
  descripcion: string;
  entidad: string;
  nit: string;
  municipio: string;
  valor: number;
  porDebajoDeLaOferta: string;
}

/**
 * Una opción de contraoferta ya ordenada. Incluye identidad completa
 * (2026-07-31, pedido de seguimiento: *"necesito saber el numero de
 * contrato y quien es el prestador en Contrato propio y si es otra IPS cual
 * es el nombre queda mas completo"*) — `nombre` es la razón social del
 * prestador propio o el nombre de la EPS externa, según `esMercadoEps`;
 * `numeroContrato` solo aplica a contratos propios (`null` si es de otra
 * EPS, que no tiene un contrato con Dusakawi).
 */
interface OpcionContrapropuesta {
  valor: number;
  esMercadoEps: boolean;
  nombre: string;
  numeroContrato: string | null;
}

interface FilaContrapropuesta {
  codigo: string;
  descripcion: string;
  tipo: string;
  precioOfertado: number;
  /** Valores más económicos que la oferta, de menor a mayor — mezcla contratos propios y precios de otra EPS, con su identidad completa. */
  opcionesMasEconomicas: OpcionContrapropuesta[];
}

const COLUMNAS_RESUMEN: ColumnaExportable<FilaResumen>[] = [
  { header: "Código", valor: (f) => f.codigo, anchoExcel: 14 },
  { header: "Descripción", valor: (f) => f.descripcion, anchoExcel: 45 },
  { header: "Tipo", valor: (f) => f.tipo, anchoExcel: 20 },
  { header: "Precio ofertado", valor: (f) => f.precioOfertado, formato: "moneda", anchoExcel: 16 },
  { header: "Mínimo municipio", valor: (f) => f.minimo, formato: "moneda", anchoExcel: 16 },
  { header: "Máximo municipio", valor: (f) => f.maximo, formato: "moneda", anchoExcel: 16 },
  { header: "Promedio municipio", valor: (f) => f.promedio, formato: "moneda", anchoExcel: 16 },
  { header: "Mediana municipio", valor: (f) => f.mediana, formato: "moneda", anchoExcel: 16 },
  { header: "Variación % vs. promedio", valor: (f) => (f.variacionPctPromedio !== null ? Number(f.variacionPctPromedio.toFixed(2)) : null), formato: "porcentaje", anchoExcel: 18 },
  { header: "Variación % vs. mediana", valor: (f) => (f.variacionPctMediana !== null ? Number(f.variacionPctMediana.toFixed(2)) : null), formato: "porcentaje", anchoExcel: 18 },
  { header: "Estado", valor: (f) => f.estado, anchoExcel: 26 },
  { header: "Prestadores de referencia", valor: (f) => f.cantidadPrestadores, formato: "entero", anchoExcel: 16 },
  { header: "Referencias de mercado (otras EPS)", valor: (f) => f.cantidadReferenciasMercadoEps, formato: "entero", anchoExcel: 18 },
];

const COLUMNAS_DETALLE: ColumnaExportable<FilaDetallePrestador>[] = [
  { header: "Código", valor: (f) => f.codigo, anchoExcel: 14 },
  { header: "Descripción", valor: (f) => f.descripcion, anchoExcel: 45 },
  { header: "Prestador", valor: (f) => f.prestador, anchoExcel: 35 },
  { header: "NIT", valor: (f) => f.nit, anchoExcel: 16 },
  { header: "Contrato", valor: (f) => f.contrato, anchoExcel: 20 },
  { header: "Valor", valor: (f) => f.valor, formato: "moneda", anchoExcel: 16 },
  { header: "Por debajo de la mediana", valor: (f) => f.porDebajoDeMediana, anchoExcel: 20 },
  { header: "Por debajo de la oferta", valor: (f) => f.porDebajoDeLaOferta, anchoExcel: 20 },
];

const COLUMNAS_DETALLE_MERCADO_EPS: ColumnaExportable<FilaDetalleMercadoEps>[] = [
  { header: "Código", valor: (f) => f.codigo, anchoExcel: 14 },
  { header: "Descripción", valor: (f) => f.descripcion, anchoExcel: 45 },
  { header: "EPS", valor: (f) => f.entidad, anchoExcel: 35 },
  { header: "NIT EPS", valor: (f) => f.nit, anchoExcel: 16 },
  { header: "Municipio", valor: (f) => f.municipio, anchoExcel: 20 },
  { header: "Precio reportado", valor: (f) => f.valor, formato: "moneda", anchoExcel: 16 },
  { header: "Por debajo de la oferta", valor: (f) => f.porDebajoDeLaOferta, anchoExcel: 20 },
];

function mapearResumen(f: FilaEvaluacionPropuesta): FilaResumen {
  return {
    codigo: f.codigo,
    descripcion: f.descripcion,
    tipo: ETIQUETAS_TIPO[f.tipo] ?? f.tipo,
    precioOfertado: f.precioOfertado,
    minimo: f.minimo,
    maximo: f.maximo,
    promedio: f.promedio,
    mediana: f.mediana,
    variacionPctPromedio: f.variacionPctPromedio,
    variacionPctMediana: f.variacionPctMediana,
    estado: f.nivel === "sinReferencia" ? "Sin referencia en el municipio" : etiquetaNivelSemaforo(f.nivel),
    cantidadPrestadores: f.cantidadPrestadoresReferencia,
    cantidadReferenciasMercadoEps: f.referenciasMercadoEps.length,
  };
}

function mapearDetalle(filas: FilaEvaluacionPropuesta[]): FilaDetallePrestador[] {
  const detalle: FilaDetallePrestador[] = [];
  for (const f of filas) {
    for (const p of f.prestadoresReferencia) {
      detalle.push({
        codigo: f.codigo,
        descripcion: f.descripcion,
        prestador: p.razonSocial,
        nit: p.nit,
        contrato: p.numeroContrato,
        valor: p.valorFinal,
        porDebajoDeMediana: p.porDebajoDeMediana ? "Sí" : "No",
        porDebajoDeLaOferta: p.porDebajoDePropuesta ? "Sí" : "No",
      });
    }
  }
  return detalle;
}

/** Hoja "uso interno" adicional: a diferencia de la contrapropuesta (que nunca revela identidad de terceros), aquí SÍ se muestra qué EPS reportó cada precio — es información útil para que el analista cite la fuente en la negociación. */
function mapearDetalleMercadoEps(filas: FilaEvaluacionPropuesta[], municipioNombre: string): FilaDetalleMercadoEps[] {
  const detalle: FilaDetalleMercadoEps[] = [];
  for (const f of filas) {
    for (const r of f.referenciasMercadoEps) {
      detalle.push({
        codigo: f.codigo,
        descripcion: f.descripcion,
        entidad: r.nombreEntidad,
        nit: r.nitEntidad,
        municipio: municipioNombre,
        valor: r.precio,
        porDebajoDeLaOferta: r.precio < f.precioOfertado ? "Sí" : "No",
      });
    }
  }
  return detalle;
}

/**
 * `prestadoresReferencia` y `referenciasMercadoEps` ya vienen ordenados
 * ascendente (ver construirFilaEvaluacion en
 * src/lib/negociacion/analisis-propuesta.ts) — se fusionan en un solo pool
 * ascendente de valores más económicos que la oferta, conservando la
 * identidad completa de cada fuente (razón social/EPS + número de contrato
 * cuando aplica).
 */
function mapearContrapropuesta(f: FilaEvaluacionPropuesta): FilaContrapropuesta {
  const valoresPropios: OpcionContrapropuesta[] = f.prestadoresReferencia
    .filter((p) => p.valorFinal < f.precioOfertado)
    .map((p) => ({ valor: p.valorFinal, esMercadoEps: false, nombre: p.razonSocial, numeroContrato: p.numeroContrato }));
  const valoresMercadoEps: OpcionContrapropuesta[] = f.referenciasMercadoEps
    .filter((r) => r.precio < f.precioOfertado)
    .map((r) => ({ valor: r.precio, esMercadoEps: true, nombre: r.nombreEntidad, numeroContrato: null }));
  const opcionesMasEconomicas = [...valoresPropios, ...valoresMercadoEps].sort((a, b) => a.valor - b.valor);

  return {
    codigo: f.codigo,
    descripcion: f.descripcion,
    tipo: ETIQUETAS_TIPO[f.tipo] ?? f.tipo,
    precioOfertado: f.precioOfertado,
    opcionesMasEconomicas,
  };
}

/**
 * Columnas fijas + un grupo de 4 columnas por cada "Opción" que el código
 * con MÁS opciones más económicas tenga en todo el archivo: valor, fuente
 * ("Contrato propio" / "Otra EPS"), nombre (razón social del prestador
 * propio o de la EPS externa) y número de contrato (solo si es contrato
 * propio; vacío si es otra EPS, que no tiene contrato con Dusakawi) —
 * 2026-07-31, pedido de seguimiento del usuario para que el documento
 * "quede más completo" con la identidad exacta de cada fuente.
 */
function construirColumnasContrapropuesta(filas: FilaContrapropuesta[]): ColumnaExportable<FilaContrapropuesta>[] {
  const maxOpciones = filas.reduce((max, f) => Math.max(max, f.opcionesMasEconomicas.length), 0);

  const columnas: ColumnaExportable<FilaContrapropuesta>[] = [
    { header: "Código", valor: (f) => f.codigo, anchoExcel: 14 },
    { header: "Nombre del procedimiento/medicamento/insumo", valor: (f) => f.descripcion, anchoExcel: 50 },
    { header: "Tipo", valor: (f) => f.tipo, anchoExcel: 22 },
    { header: "Precio ofertado por el prestador", valor: (f) => f.precioOfertado, formato: "moneda", anchoExcel: 20 },
  ];

  for (let i = 0; i < maxOpciones; i++) {
    columnas.push({
      header: `Opción ${i + 1}${i === 0 ? " (más económica)" : ""}`,
      valor: (f) => f.opcionesMasEconomicas[i]?.valor ?? null,
      formato: "moneda",
      anchoExcel: 20,
    });
    columnas.push({
      header: `Fuente Opción ${i + 1}`,
      valor: (f) => {
        const opcion = f.opcionesMasEconomicas[i];
        if (!opcion) return null;
        return opcion.esMercadoEps ? "Otra EPS" : "Contrato propio";
      },
      anchoExcel: 16,
    });
    columnas.push({
      header: `Prestador/EPS Opción ${i + 1}`,
      valor: (f) => f.opcionesMasEconomicas[i]?.nombre ?? null,
      anchoExcel: 32,
    });
    columnas.push({
      header: `Contrato Opción ${i + 1}`,
      valor: (f) => f.opcionesMasEconomicas[i]?.numeroContrato ?? null,
      anchoExcel: 18,
    });
  }

  return columnas;
}

export async function POST(request: NextRequest) {
  const formData = await request.formData();
  const formato = (String(formData.get("formato") ?? "xlsx") as "xlsx" | "csv") || "xlsx";
  const vista = (String(formData.get("vista") ?? "completo") as "completo" | "contrapropuesta") || "completo";

  try {
    const resultado = await evaluarPropuestaPrestador(formData);
    if ("error" in resultado) {
      return NextResponse.json({ error: resultado.error }, { status: 400 });
    }

    let buffer: Buffer;
    let nombreBase: string;

    if (vista === "contrapropuesta") {
      nombreBase = "Contrapropuesta_Prestador";
      const contrapropuesta = resultado.filas.map(mapearContrapropuesta);
      const columnasContrapropuesta = construirColumnasContrapropuesta(contrapropuesta);

      if (formato === "csv") {
        buffer = Buffer.from(construirCsv(contrapropuesta, columnasContrapropuesta), "utf-8");
      } else {
        const maxOpciones = (columnasContrapropuesta.length - 4) / 4; // 4 columnas fijas + 4 columnas (Opción/Fuente/Prestador-EPS/Contrato) por cada opción
        const filasParametros = [
          { Parámetro: "Municipio", Valor: `${resultado.municipioNombre} (${resultado.departamentoNombre})` },
          {
            Parámetro: "Cómo leer este archivo",
            Valor:
              maxOpciones > 0
                ? `Cada "Opción" es un valor más económico ya conocido que lo ofertado, de menor a mayor. "Fuente" indica si es un contrato propio de Dusakawi o un precio reportado por otra EPS; "Prestador/EPS" trae el nombre exacto y "Contrato" el número de contrato (solo aplica a contratos propios). Elija cuál opción usar como base de la contraoferta.`
                : "Ningún código tuvo un valor ya conocido más económico que la propuesta recibida.",
          },
          {
            Parámetro: "Uso de este archivo",
            Valor: 'Documento de trabajo INTERNO para preparar la negociación — incluye identidad de terceros (prestadores propios y EPS). Revíselo/edítelo antes de compartirlo con un prestador externo.',
          },
          { Parámetro: "Total de códigos", Valor: String(contrapropuesta.length) },
          { Parámetro: "Generado el", Valor: new Date().toLocaleString("es-CO", { timeZone: "America/Bogota" }) },
        ];
        const workbook = crearLibroExcel();
        agregarHojaExcel(
          workbook,
          filasParametros,
          [
            { header: "Parámetro", valor: (f) => f.Parámetro, anchoExcel: 32 },
            { header: "Valor", valor: (f) => f.Valor, anchoExcel: 60 },
          ],
          "Parámetros"
        );
        agregarHojaExcel(workbook, contrapropuesta, columnasContrapropuesta, "Contrapropuesta");
        const arrayBuffer = await workbook.xlsx.writeBuffer();
        buffer = Buffer.from(arrayBuffer);
      }
    } else {
      nombreBase = "Analisis_Propuesta_Prestador";
      const resumen = resultado.filas.map(mapearResumen);

      if (formato === "csv") {
        buffer = Buffer.from(construirCsv(resumen, COLUMNAS_RESUMEN), "utf-8");
      } else {
        const detalle = mapearDetalle(resultado.filas);
        const detalleMercadoEps = mapearDetalleMercadoEps(resultado.filas, resultado.municipioNombre);
        const filasParametros = [
          { Parámetro: "Archivo analizado", Valor: resultado.nombreArchivo },
          { Parámetro: "Municipio", Valor: `${resultado.municipioNombre} (${resultado.departamentoNombre})` },
          { Parámetro: "Comparar contra", Valor: resultado.referencia === "promedio" ? "Promedio del municipio" : "Mediana del municipio" },
          { Parámetro: "Umbral de alerta (%)", Valor: String(resultado.umbrales.alertaPct) },
          { Parámetro: "Umbral crítico (%)", Valor: String(resultado.umbrales.criticoPct) },
          { Parámetro: "Total de códigos en la propuesta", Valor: String(resultado.resumen.totalCodigos) },
          { Parámetro: "Códigos con referencia de mercado", Valor: String(resultado.resumen.totalConReferencia) },
          { Parámetro: "Códigos sin referencia de mercado", Valor: String(resultado.resumen.totalSinReferencia) },
          { Parámetro: "Favorables o iguales al mercado", Valor: String(resultado.resumen.totalFavorables) },
          { Parámetro: "A negociar (más caros que el mercado)", Valor: String(resultado.resumen.totalCriticos) },
          {
            Parámetro: "Ahorro potencial vs. mediana (por unidad tarifada, no por volumen real)",
            Valor: String(Math.round(resultado.resumen.ahorroPotencialUnitarioVsMediana)),
          },
          { Parámetro: "Filas del archivo no procesadas", Valor: String(resultado.erroresParseo.length) },
          { Parámetro: "Generado el", Valor: new Date().toLocaleString("es-CO", { timeZone: "America/Bogota" }) },
        ];

        const workbook = crearLibroExcel();
        agregarHojaExcel(
          workbook,
          filasParametros,
          [
            { header: "Parámetro", valor: (f) => f.Parámetro, anchoExcel: 45 },
            { header: "Valor", valor: (f) => f.Valor, anchoExcel: 45 },
          ],
          "Parámetros"
        );
        agregarHojaExcel(workbook, resumen, COLUMNAS_RESUMEN, "Resultado por código");
        agregarHojaExcel(workbook, detalle, COLUMNAS_DETALLE, "Prestadores de referencia");
        agregarHojaExcel(workbook, detalleMercadoEps, COLUMNAS_DETALLE_MERCADO_EPS, "Referencias de mercado (otras EPS)");
        const arrayBuffer = await workbook.xlsx.writeBuffer();
        buffer = Buffer.from(arrayBuffer);
      }
    }

    const contentType =
      formato === "xlsx" ? "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" : "text/csv;charset=utf-8";
    const extension = formato === "xlsx" ? "xlsx" : "csv";

    return new NextResponse(new Uint8Array(buffer), {
      status: 200,
      headers: {
        "Content-Type": contentType,
        "Content-Disposition": `attachment; filename="${nombreBase}.${extension}"`,
      },
    });
  } catch (error: any) {
    console.error("[export/analisis-propuesta] Error generando exportación:", error);
    return NextResponse.json({ error: "No fue posible generar la exportación." }, { status: 500 });
  }
}
