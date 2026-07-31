/**
 * Parser del archivo de propuesta del prestador (CSV, TXT delimitado o
 * XLSX) — módulo "Análisis de Propuesta del Prestador".
 *
 * Formato esperado: una tabla con encabezado, con al menos 2 columnas:
 * "Código" (código CUPS/CUM/insumo tal como aparece en el tarifario
 * contratado, ver src/types/comparativo.ts) y "Precio Ofertado" (el valor
 * que el prestador está proponiendo para ese código). El nombre exacto del
 * encabezado se normaliza (sin tildes, sin espacios/guiones bajos, en
 * minúsculas) para tolerar variantes reales que el usuario vaya a recibir
 * ("Codigo", "CÓDIGO", "precio_ofertado", "Precio Ofertado", "PrecioOfertado").
 *
 * Las primitivas de bajo nivel (lectura de CSV/TXT/XLSX a celdas, parseo de
 * números es-CO/US, normalización de encabezados) viven en
 * `archivo-tabular.ts` — compartidas con `precio-referencia-eps-parser.ts`
 * (mismo formato de entrada, distinta estructura de columnas) desde que ese
 * segundo módulo apareció (2026-07-31). Este archivo solo aporta la
 * detección de columnas y las reglas de validación propias de ESTE formato.
 */

import type { ErrorFilaPropuesta, FilaPropuestaCargada } from "@/types/analisis-propuesta";
import {
  normalizarTextoComparable,
  parsearNumeroFlexible,
  leerArchivoACeldas,
} from "@/lib/negociacion/archivo-tabular";

export { parsearNumeroFlexible };

/** Límite defensivo de filas de datos a procesar por archivo — una propuesta de tarifas real no debería acercarse a esto (mismo criterio que LIMITE_FILAS_EXPORTACION en exportar.ts). */
export const LIMITE_FILAS_PROPUESTA = 5000;

function esColumnaCodigo(encabezadoNormalizado: string): boolean {
  return encabezadoNormalizado.includes("codigo") || encabezadoNormalizado === "cup" || encabezadoNormalizado === "cum";
}

function esColumnaPrecio(encabezadoNormalizado: string): boolean {
  // Tolera errores de tipeo comunes ("ofretado" por "ofertado") — solo se
  // exige que la columna hable de "precio" (u homólogo) y, si trae más de
  // una palabra, alguna variante de "ofertad*"/"ofretad*". Si el archivo
  // trae una sola columna de precio sin calificativo ("Precio", "Valor"),
  // también se acepta (ver resolverColumnas más abajo, que solo cae a este
  // criterio laxo si no hay ambigüedad).
  return encabezadoNormalizado.includes("precio") || encabezadoNormalizado.includes("valorofertad");
}

interface ColumnasDetectadas {
  indiceCodigo: number;
  indicePrecio: number;
}

/** Ubica, entre los encabezados de una tabla ya parseada en celdas, cuál es la columna de código y cuál la de precio ofertado. */
function resolverColumnas(encabezados: string[]): ColumnasDetectadas | { error: string } {
  const normalizados = encabezados.map(normalizarTextoComparable);

  const candidatosCodigo = normalizados
    .map((h, i) => ({ h, i }))
    .filter((c) => esColumnaCodigo(c.h));
  const candidatosPrecio = normalizados
    .map((h, i) => ({ h, i }))
    .filter((c) => esColumnaPrecio(c.h));
  // Prioriza "precio" + "ofert"/"ofret" (el caso esperado); si nada calza así
  // pero hay UNA sola columna que solo dice "precio"/"valor", se usa esa.
  const preferidos = candidatosPrecio.filter((c) => c.h.includes("ofert") || c.h.includes("ofret"));

  if (candidatosCodigo.length === 0) {
    return { error: 'No se encontró una columna de "Código" en el encabezado del archivo.' };
  }
  if (candidatosCodigo.length > 1) {
    return { error: 'Hay más de una columna cuyo nombre parece ser "Código" — deje una sola columna de código en el archivo.' };
  }

  // Si ninguna columna trae "ofert"/"ofret" (ej. el archivo solo dice
  // "Precio" o "Valor"), se acepta esa columna siempre que sea la ÚNICA
  // candidata a precio — evita adivinar entre varias columnas ambiguas.
  let columnaPrecio = preferidos[0];
  if (!columnaPrecio && candidatosPrecio.length === 1) {
    columnaPrecio = candidatosPrecio[0];
  }
  if (!columnaPrecio) {
    return {
      error:
        'No se encontró una columna de "Precio Ofertado" en el encabezado del archivo (se esperaba un nombre que contenga "precio" y "ofertado").',
    };
  }

  return { indiceCodigo: candidatosCodigo[0].i, indicePrecio: columnaPrecio.i };
}

interface ResultadoParseo {
  filas: FilaPropuestaCargada[];
  errores: ErrorFilaPropuesta[];
}

function construirResultadoDesdeFilasDeCeldas(
  filasDeCeldas: (string | number | null)[][]
): ResultadoParseo | { error: string } {
  const filasNoVacias = filasDeCeldas.filter((f) => f.some((celda) => celda !== null && celda !== "" && celda !== undefined));
  if (filasNoVacias.length === 0) {
    return { error: "El archivo está vacío." };
  }

  const encabezados = filasNoVacias[0].map((c) => (c === null || c === undefined ? "" : String(c)));
  const columnas = resolverColumnas(encabezados);
  if ("error" in columnas) return columnas;

  const errores: ErrorFilaPropuesta[] = [];
  const filas: FilaPropuestaCargada[] = [];

  const filasDeDatos = filasNoVacias.slice(1, 1 + LIMITE_FILAS_PROPUESTA);
  filasNoVacias.slice(1 + LIMITE_FILAS_PROPUESTA).forEach((_, idx) => {
    errores.push({
      filaOriginal: 1 + LIMITE_FILAS_PROPUESTA + idx + 1,
      contenido: "",
      motivo: `Se alcanzó el límite de ${LIMITE_FILAS_PROPUESTA} filas por archivo — esta fila y las siguientes no se procesaron.`,
    });
  });

  filasDeDatos.forEach((celdas, idx) => {
    const filaOriginal = idx + 2; // fila 1 es el encabezado
    const codigoCrudo = celdas[columnas.indiceCodigo];
    const precioCrudo = celdas[columnas.indicePrecio];
    const codigo = codigoCrudo === null || codigoCrudo === undefined ? "" : String(codigoCrudo).trim();
    const precioOfertado = parsearNumeroFlexible(precioCrudo);

    const contenido = `${codigo} / ${precioCrudo ?? ""}`;
    if (!codigo) {
      errores.push({ filaOriginal, contenido, motivo: "Código vacío." });
      return;
    }
    if (precioOfertado === null) {
      errores.push({ filaOriginal, contenido, motivo: `Precio ofertado no interpretable: "${precioCrudo ?? ""}".` });
      return;
    }
    if (precioOfertado <= 0) {
      errores.push({ filaOriginal, contenido, motivo: "Precio ofertado debe ser mayor a 0." });
      return;
    }

    filas.push({ filaOriginal, codigo, precioOfertado });
  });

  return { filas, errores };
}

/**
 * Punto de entrada único del parser: detecta el formato por la extensión del
 * nombre de archivo y devuelve las filas ya interpretadas + los errores de
 * filas puntuales que no se pudieron leer (nunca lanza por una fila mala
 * aislada — solo por un archivo estructuralmente ilegible, ver `{ error }`).
 */
export async function parsearArchivoPropuesta(
  buffer: Buffer,
  nombreArchivo: string
): Promise<ResultadoParseo | { error: string }> {
  const celdas = await leerArchivoACeldas(buffer, nombreArchivo);
  if ("error" in celdas) return celdas;
  return construirResultadoDesdeFilasDeCeldas(celdas);
}
