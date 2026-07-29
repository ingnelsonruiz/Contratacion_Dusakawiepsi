/**
 * Construcción de archivos de exportación (Excel/CSV) para los módulos de
 * Inteligencia de Precios. Funciones puras respecto a los datos de entrada
 * (reciben filas ya resueltas, no consultan la BD) — se pueden testear sin
 * red ni base de datos. El único efecto de librería externa es ExcelJS al
 * serializar el workbook a buffer.
 *
 * Usadas desde el Route Handler `src/app/api/export/tarifario/route.ts`
 * (exportaciones binarias van en Route Handlers, no en Server Actions — ver
 * docs/ARQUITECTURA.md §2.1).
 */
import ExcelJS from "exceljs";

export type FormatoColumna = "texto" | "moneda" | "porcentaje" | "fecha" | "entero";

export interface ColumnaExportable<T> {
  header: string;
  /** Función que extrae el valor crudo (no formateado) de la fila. */
  valor: (fila: T) => string | number | null | undefined;
  formato?: FormatoColumna;
  anchoExcel?: number;
}

const FORMATOS_NUMERO_EXCEL: Record<FormatoColumna, string | undefined> = {
  texto: undefined,
  moneda: '"$" #,##0',
  porcentaje: '0.00"%"',
  fecha: "dd/mm/yyyy",
  entero: "#,##0",
};

/** Escapa un valor para una celda CSV (comillas dobles + separador ; para locale es-CO/Excel). */
function escaparCeldaCsv(valor: string | number | null | undefined): string {
  const texto = valor === null || valor === undefined ? "" : String(valor);
  if (/[";\n\r]/.test(texto)) {
    return `"${texto.replace(/"/g, '""')}"`;
  }
  return texto;
}

/**
 * Construye un CSV listo para Excel: separador `;` (evita que Excel en
 * configuración regional es-CO interprete cada celda como una sola columna
 * por usar coma como separador decimal) y BOM UTF-8 (sin el BOM, Excel en
 * Windows abre el archivo asumiendo ANSI/Windows-1252 y corrompe tildes/Ñ —
 * mismo hallazgo documentado en el ecosistema Dusakawi para otros exports).
 */
export function construirCsv<T>(filas: T[], columnas: ColumnaExportable<T>[]): string {
  const encabezado = columnas.map((c) => escaparCeldaCsv(c.header)).join(";");
  const lineas = filas.map((fila) =>
    columnas.map((c) => escaparCeldaCsv(c.valor(fila))).join(";")
  );
  const BOM = String.fromCharCode(0xfeff);
  return BOM + [encabezado, ...lineas].join("\r\n");
}

/** Crea un libro de Excel vacío, con los metadatos comunes del ecosistema. */
export function crearLibroExcel(): ExcelJS.Workbook {
  const workbook = new ExcelJS.Workbook();
  workbook.creator = "Sistema de Inteligencia de Precios · DUSAKAWI EPSI";
  workbook.created = new Date();
  return workbook;
}

/**
 * Agrega una hoja de datos tabulares a un libro YA EXISTENTE — permite armar
 * reportes de varias hojas (ej. "Parámetros" + "Resumen" + "Detalle" del
 * Módulo 2 Comparativo) sin duplicar la lógica de columnas/formato/autofiltro.
 */
export function agregarHojaExcel<T>(
  workbook: ExcelJS.Workbook,
  filas: T[],
  columnas: ColumnaExportable<T>[],
  nombreHoja: string
): ExcelJS.Worksheet {
  const hoja = workbook.addWorksheet(nombreHoja.substring(0, 31)); // límite de 31 caracteres de Excel

  hoja.columns = columnas.map((c) => ({
    header: c.header,
    key: c.header,
    width: c.anchoExcel ?? 22,
    style: FORMATOS_NUMERO_EXCEL[c.formato ?? "texto"]
      ? { numFmt: FORMATOS_NUMERO_EXCEL[c.formato ?? "texto"] }
      : undefined,
  }));

  hoja.getRow(1).font = { bold: true };
  hoja.getRow(1).fill = {
    type: "pattern",
    pattern: "solid",
    fgColor: { argb: "FFE5E7EB" },
  };

  for (const fila of filas) {
    const registro: Record<string, string | number | null> = {};
    for (const c of columnas) {
      const valor = c.valor(fila);
      registro[c.header] = valor === undefined ? null : valor;
    }
    hoja.addRow(registro);
  }

  if (columnas.length > 0) {
    hoja.autoFilter = {
      from: { row: 1, column: 1 },
      to: { row: 1, column: columnas.length },
    };
  }

  return hoja;
}

/** Construye un libro de Excel (una sola hoja) a partir de filas ya resueltas — usado por el export de Módulo 1 (Tarifario). */
export async function construirLibroExcel<T>(
  filas: T[],
  columnas: ColumnaExportable<T>[],
  nombreHoja: string
): Promise<ExcelJS.Workbook> {
  const workbook = crearLibroExcel();
  agregarHojaExcel(workbook, filas, columnas, nombreHoja);
  return workbook;
}

/** Límite de filas exportables en una sola operación — evita timeouts del proxy/gateway en tarifarios enormes. */
export const LIMITE_FILAS_EXPORTACION = 20000;
