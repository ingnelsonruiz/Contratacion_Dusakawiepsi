/**
 * Primitivas puras y compartidas para leer archivos tabulares subidos por el
 * usuario (CSV/TXT delimitado o XLSX) — extraídas de
 * `analisis-propuesta-parser.ts` (primer módulo que las necesitó) al
 * aparecer un SEGUNDO módulo con el mismo requisito (Precios de Referencia
 * EPS, 2026-07-31): mismo formato de entrada, distinta estructura de
 * columnas. Mantener esta lógica en un solo lugar evita que un fix futuro
 * (ej. un nuevo separador decimal, un nuevo caso de encabezado) tenga que
 * replicarse a mano en cada parser del proyecto.
 *
 * Sin dependencia nueva: XLSX se lee con `exceljs` (ya es dependencia del
 * proyecto para exportar, ver `exportar.ts` — `ExcelJS` también sabe LEER
 * libros, no solo escribirlos). CSV/TXT se parsean con un lector delimitado
 * propio (mismo criterio de "evitar sumar una librería nueva" documentado en
 * KnowledgeBase/09-Errores/Problemas Comunes.md #12).
 */

import ExcelJS from "exceljs";

const DELIMITADORES_CANDIDATOS = [";", ",", "\t", "|"];

// \u0300-\u036f = rango Unicode "Combining Diacritical Marks" (código
// unicode explícito, NUNCA el caracter literal — ver CLAUDE.md §9 y
// KnowledgeBase/09-Errores/Problemas Comunes.md #11: escribir el caracter
// combinante literal en el código fuente rompe el regex de forma silenciosa
// en algunos editores/entornos).
const RANGO_DIACRITICOS = /[\u0300-\u036f]/g;

/**
 * Normaliza texto para comparación tolerante: sin tildes, minúsculas, sin
 * espacios/guiones/separadores. Útil tanto para encabezados de columna
 * ("Precio Ofertado" ≡ "precio_ofertado") como para nombres propios con
 * variantes de tipeo (ver `normalizarTextoConEspacios` para el caso de
 * nombres de municipio, donde SÍ importa distinguir palabras).
 */
export function normalizarTextoComparable(texto: string): string {
  return texto
    .normalize("NFD")
    .replace(RANGO_DIACRITICOS, "")
    .toLowerCase()
    .replace(/[^a-z0-9]/g, "");
}

/**
 * Igual que `normalizarTextoComparable` pero conservando un solo espacio
 * entre palabras (en vez de eliminarlos) — necesario para nombres propios
 * como municipios, donde "Valle Del Guamuez" no debe colapsar en
 * "valledelguamuez" al punto de volverse indistinguible de un municipio
 * genuinamente distinto si en el futuro se necesita coincidencia parcial.
 */
export function normalizarTextoConEspacios(texto: string): string {
  return texto
    .normalize("NFD")
    .replace(RANGO_DIACRITICOS, "")
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9\s]/g, "")
    .replace(/\s+/g, " ");
}

/**
 * Interpreta un número escrito en formato colombiano/estadounidense
 * indistintamente: "1.234.567,89" (miles con punto, decimal con coma),
 * "1234567.89" (decimal con punto), "1,234,567.89", o un número plano.
 * Devuelve null si el texto no se puede interpretar como número.
 */
export function parsearNumeroFlexible(valorCrudo: string | number | null | undefined): number | null {
  if (valorCrudo === null || valorCrudo === undefined) return null;
  if (typeof valorCrudo === "number") return Number.isFinite(valorCrudo) ? valorCrudo : null;

  let texto = valorCrudo.trim();
  if (!texto) return null;
  texto = texto.replace(/[$\s]/g, "");
  if (!texto) return null;

  const tienePunto = texto.includes(".");
  const tieneComa = texto.includes(",");

  if (tienePunto && tieneComa) {
    // El separador decimal es el que aparece MÁS A LA DERECHA; el otro es de miles.
    const posUltimoPunto = texto.lastIndexOf(".");
    const posUltimaComa = texto.lastIndexOf(",");
    if (posUltimaComa > posUltimoPunto) {
      texto = texto.replace(/\./g, "").replace(",", ".");
    } else {
      texto = texto.replace(/,/g, "");
    }
  } else if (tieneComa) {
    // Solo coma: decimal si hay exactamente 1 y quedan 1-2 dígitos después; si no, separador de miles.
    const partes = texto.split(",");
    if (partes.length === 2 && partes[1].length <= 2) {
      texto = texto.replace(",", ".");
    } else {
      texto = texto.replace(/,/g, "");
    }
  } else if (tienePunto) {
    const partes = texto.split(".");
    if (partes.length > 2) {
      // Varios puntos -> todos son separadores de miles (ej. "1.234.567").
      texto = texto.replace(/\./g, "");
    } else if (partes.length === 2 && partes[1].length === 3 && partes[0].length > 0) {
      // Un solo punto con exactamente 3 dígitos después -> ambiguo a favor de
      // separador de miles (patrón "1.234"), consistente con el resto de
      // este proyecto (formato es-CO). Si el usuario SÍ quería 3 decimales,
      // es un caso raro para un precio en pesos colombianos.
      texto = texto.replace(".", "");
    }
    // Un punto con 1-2 dígitos después ya es decimal válido tal cual.
  }

  const numero = Number(texto);
  return Number.isFinite(numero) ? numero : null;
}

export function detectarDelimitador(lineaEncabezado: string): string {
  let mejor = DELIMITADORES_CANDIDATOS[0];
  let mejorConteo = -1;
  for (const delim of DELIMITADORES_CANDIDATOS) {
    const conteo = lineaEncabezado.split(delim).length;
    if (conteo > mejorConteo) {
      mejorConteo = conteo;
      mejor = delim;
    }
  }
  return mejor;
}

/** Parser mínimo de una línea delimitada, con soporte de campos entre comillas dobles (mismo criterio que construirCsv en exportar.ts, en sentido inverso). */
export function parsearLineaDelimitada(linea: string, delimitador: string): string[] {
  const campos: string[] = [];
  let actual = "";
  let dentroDeComillas = false;

  for (let i = 0; i < linea.length; i++) {
    const c = linea[i];
    if (c === '"') {
      if (dentroDeComillas && linea[i + 1] === '"') {
        actual += '"';
        i++;
      } else {
        dentroDeComillas = !dentroDeComillas;
      }
    } else if (c === delimitador && !dentroDeComillas) {
      campos.push(actual);
      actual = "";
    } else {
      actual += c;
    }
  }
  campos.push(actual);
  return campos.map((c) => c.trim());
}

export function quitarBom(texto: string): string {
  return texto.charCodeAt(0) === 0xfeff ? texto.slice(1) : texto;
}

/** Convierte un texto CSV/TXT delimitado completo en filas de celdas — detecta el delimitador por la primera línea. */
export function parsearTextoDelimitadoACeldas(texto: string): (string | number | null)[][] {
  const limpio = quitarBom(texto).replace(/\r\n/g, "\n").replace(/\r/g, "\n");
  const lineas = limpio.split("\n").filter((l) => l.trim().length > 0);
  if (lineas.length === 0) return [];

  const delimitador = detectarDelimitador(lineas[0]);
  return lineas.map((linea) => parsearLineaDelimitada(linea, delimitador));
}

/** Carga la primera hoja de un XLSX y la convierte en filas de celdas (resolviendo fórmulas/rich-text/fechas). */
export async function parsearXlsxACeldas(buffer: Buffer): Promise<(string | number | null)[][] | { error: string }> {
  const workbook = new ExcelJS.Workbook();
  try {
    await workbook.xlsx.load(buffer as unknown as ArrayBuffer);
  } catch {
    return { error: "No fue posible leer el archivo Excel (.xlsx). Verifique que no esté dañado ni protegido con contraseña." };
  }

  const hoja = workbook.worksheets[0];
  if (!hoja) return { error: "El archivo Excel no tiene ninguna hoja con datos." };

  const filasDeCeldas: (string | number | null)[][] = [];
  hoja.eachRow({ includeEmpty: false }, (row) => {
    const valores: (string | number | null)[] = [];
    // ExcelJS.Row.values es 1-indexado (values[0] queda vacío) — se descarta esa posición.
    const crudos = Array.isArray(row.values) ? row.values.slice(1) : [];
    for (const v of crudos) {
      if (v === null || v === undefined) {
        valores.push(null);
      } else if (typeof v === "object" && "result" in (v as any)) {
        // Celda de fórmula: usar el resultado ya calculado.
        valores.push((v as any).result ?? null);
      } else if (typeof v === "object" && "text" in (v as any)) {
        // Rich text.
        valores.push(String((v as any).text ?? ""));
      } else if (v instanceof Date) {
        valores.push(v.toISOString());
      } else {
        valores.push(v as string | number);
      }
    }
    filasDeCeldas.push(valores);
  });

  return filasDeCeldas;
}

/**
 * Detecta el formato por la extensión del nombre de archivo y devuelve las
 * filas ya interpretadas como celdas — solo soporta el formato moderno de
 * Excel (.xlsx); el binario legado (.xls) se rechaza explícitamente con un
 * mensaje claro en vez de fallar en silencio (requeriría una librería
 * adicional que `exceljs` no cubre).
 */
export async function leerArchivoACeldas(buffer: Buffer, nombreArchivo: string): Promise<(string | number | null)[][] | { error: string }> {
  const nombre = nombreArchivo.toLowerCase();

  if (nombre.endsWith(".xlsx")) {
    return parsearXlsxACeldas(buffer);
  }
  if (nombre.endsWith(".xls")) {
    return {
      error:
        'El formato Excel antiguo (.xls) no está soportado — guarde el archivo como "Libro de Excel (.xlsx)" o expórtelo como CSV/TXT.',
    };
  }
  if (nombre.endsWith(".csv") || nombre.endsWith(".txt") || nombre.endsWith(".tsv")) {
    return parsearTextoDelimitadoACeldas(buffer.toString("utf-8"));
  }

  return { error: "Formato de archivo no reconocido. Suba un archivo .csv, .txt o .xlsx." };
}
