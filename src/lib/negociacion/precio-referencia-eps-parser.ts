/**
 * Parser del archivo de "Precios de Referencia EPS" (CSV, TXT delimitado o
 * XLSX) — módulo pedido por el usuario 2026-07-31: una tabla con columnas
 * Nit_prestador, Prestador, Municipio, Codigo, Descripcion, Precio, donde
 * "Nit_prestador"/"Prestador" identifican en realidad a la EPS/entidad
 * pagadora de referencia (no un prestador/IPS de la red de Dusakawi).
 *
 * Mismas primitivas de bajo nivel que `analisis-propuesta-parser.ts` (ver
 * `archivo-tabular.ts`) — mismo criterio de detección de columnas tolerante
 * a variantes de encabezado (acentos, mayúsculas, guiones bajos, sinónimos).
 *
 * A diferencia del parser de propuesta (que exige exactamente 2 columnas),
 * aquí se exigen 5 (Nit, Entidad, Municipio, Código, Precio) — "Descripción"
 * es la única opcional: si no viene, se usa el propio código como
 * descripción de respaldo (mismo criterio que `clasificarCodigos` en
 * historico-prestador-actions.ts cuando no hay descripción resoluble).
 *
 * La resolución del texto libre de "Municipio" contra el código DANE
 * (tb_municipio) NO ocurre aquí — requiere acceso a BD, así que vive en
 * `precio-referencia-eps-actions.ts` (Server Action). Este parser solo
 * produce el texto crudo tal como viene en el archivo.
 */

import type { ErrorFilaPrecioReferencia, FilaPrecioReferenciaCargada } from "@/types/precio-referencia-eps";
import { normalizarTextoComparable, parsearNumeroFlexible, leerArchivoACeldas } from "@/lib/negociacion/archivo-tabular";

/** Límite defensivo de filas de datos a procesar por archivo — una lista de precios de una EPS puede ser grande (tarifarios completos de medicamentos), pero no infinita. */
export const LIMITE_FILAS_PRECIO_REFERENCIA = 20000;

function esColumnaNit(h: string): boolean {
  return h.includes("nit");
}

function esColumnaEntidad(h: string): boolean {
  return h.includes("prestador") || h.includes("entidad") || h.includes("eps") || h.includes("aseguradora") || h.includes("pagador") || h.includes("razonsocial");
}

function esColumnaMunicipio(h: string): boolean {
  return h.includes("municipio") || h.includes("ciudad");
}

function esColumnaCodigo(h: string): boolean {
  return h.includes("codigo") || h === "cup" || h === "cum";
}

function esColumnaDescripcion(h: string): boolean {
  return h.includes("descripcion") || h.includes("detalle") || h.includes("producto") || h.includes("nombreprocedimiento") || h.includes("nombremedicamento");
}

function esColumnaPrecio(h: string): boolean {
  return h.includes("precio") || h.includes("valor") || h.includes("tarifa");
}

interface ColumnasDetectadas {
  indiceNit: number;
  indiceEntidad: number;
  indiceMunicipio: number;
  indiceCodigo: number;
  indiceDescripcion: number | null;
  indicePrecio: number;
}

/**
 * Busca la columna única para un campo, EXCLUYENDO los índices ya asignados
 * a otro campo (`yaAsignados`) — necesario porque "Nit_prestador" normaliza
 * a "nitprestador", que contiene la palabra "prestador" y por lo tanto
 * también calzaría con `esColumnaEntidad` si no se excluyera: sin esto, el
 * archivo de ejemplo del usuario (columnas "Nit_prestador" + "Prestador")
 * fallaba con "hay más de una columna que parece ser Prestador" (bug real
 * reportado 2026-07-31). El orden de resolución en `resolverColumnas`
 * importa: se resuelve primero el campo más específico (Nit) para que su
 * índice quede excluido antes de buscar el campo más genérico (Entidad).
 */
function unicaColumna(
  encabezados: string[],
  normalizados: string[],
  predicado: (h: string) => boolean,
  nombreCampo: string,
  yaAsignados: Set<number>
): { indice: number } | { error: string } {
  const candidatos = normalizados
    .map((h, i) => ({ h, i }))
    .filter((c) => !yaAsignados.has(c.i) && predicado(c.h));
  if (candidatos.length === 0) {
    return { error: `No se encontró una columna de "${nombreCampo}" en el encabezado del archivo.` };
  }
  if (candidatos.length > 1) {
    const nombres = candidatos.map((c) => encabezados[c.i]).join(", ");
    return { error: `Hay más de una columna que parece ser "${nombreCampo}" (${nombres}) — deje una sola en el archivo.` };
  }
  return { indice: candidatos[0].i };
}

function resolverColumnas(encabezados: string[]): ColumnasDetectadas | { error: string } {
  const normalizados = encabezados.map(normalizarTextoComparable);
  const asignados = new Set<number>();

  const nit = unicaColumna(encabezados, normalizados, esColumnaNit, "Nit_prestador (NIT de la EPS)", asignados);
  if ("error" in nit) return nit;
  asignados.add(nit.indice);

  const entidad = unicaColumna(encabezados, normalizados, esColumnaEntidad, "Prestador (nombre de la EPS)", asignados);
  if ("error" in entidad) return entidad;
  asignados.add(entidad.indice);

  const municipio = unicaColumna(encabezados, normalizados, esColumnaMunicipio, "Municipio", asignados);
  if ("error" in municipio) return municipio;
  asignados.add(municipio.indice);

  const codigo = unicaColumna(encabezados, normalizados, esColumnaCodigo, "Codigo", asignados);
  if ("error" in codigo) return codigo;
  asignados.add(codigo.indice);

  const precio = unicaColumna(encabezados, normalizados, esColumnaPrecio, "Precio", asignados);
  if ("error" in precio) return precio;
  asignados.add(precio.indice);

  // Descripción es la única columna opcional — si falta o es ambigua, se
  // sigue con `indiceDescripcion: null` y se usa el código como respaldo
  // (nunca se rechaza el archivo completo por esta columna puntual).
  const candidatosDescripcion = normalizados
    .map((h, i) => ({ h, i }))
    .filter((c) => !asignados.has(c.i) && esColumnaDescripcion(c.h));
  const descripcion = candidatosDescripcion.length === 1 ? candidatosDescripcion[0].i : null;

  return {
    indiceNit: nit.indice,
    indiceEntidad: entidad.indice,
    indiceMunicipio: municipio.indice,
    indiceCodigo: codigo.indice,
    indiceDescripcion: descripcion,
    indicePrecio: precio.indice,
  };
}

interface ResultadoParseo {
  filas: FilaPrecioReferenciaCargada[];
  errores: ErrorFilaPrecioReferencia[];
}

function celdaTexto(valor: string | number | null | undefined): string {
  return valor === null || valor === undefined ? "" : String(valor).trim();
}

function construirResultadoDesdeFilasDeCeldas(filasDeCeldas: (string | number | null)[][]): ResultadoParseo | { error: string } {
  const filasNoVacias = filasDeCeldas.filter((f) => f.some((celda) => celda !== null && celda !== "" && celda !== undefined));
  if (filasNoVacias.length === 0) {
    return { error: "El archivo está vacío." };
  }

  const encabezados = filasNoVacias[0].map((c) => (c === null || c === undefined ? "" : String(c)));
  const columnas = resolverColumnas(encabezados);
  if ("error" in columnas) return columnas;

  const errores: ErrorFilaPrecioReferencia[] = [];
  const filas: FilaPrecioReferenciaCargada[] = [];

  const filasDeDatos = filasNoVacias.slice(1, 1 + LIMITE_FILAS_PRECIO_REFERENCIA);
  filasNoVacias.slice(1 + LIMITE_FILAS_PRECIO_REFERENCIA).forEach((_, idx) => {
    errores.push({
      filaOriginal: 1 + LIMITE_FILAS_PRECIO_REFERENCIA + idx + 1,
      contenido: "",
      motivo: `Se alcanzó el límite de ${LIMITE_FILAS_PRECIO_REFERENCIA} filas por archivo — esta fila y las siguientes no se procesaron.`,
    });
  });

  filasDeDatos.forEach((celdas, idx) => {
    const filaOriginal = idx + 2;
    const nitEntidad = celdaTexto(celdas[columnas.indiceNit]);
    const nombreEntidad = celdaTexto(celdas[columnas.indiceEntidad]);
    const municipioTexto = celdaTexto(celdas[columnas.indiceMunicipio]);
    const codigo = celdaTexto(celdas[columnas.indiceCodigo]);
    const descripcion = columnas.indiceDescripcion !== null ? celdaTexto(celdas[columnas.indiceDescripcion]) : "";
    const precioCrudo = celdas[columnas.indicePrecio];
    const precio = parsearNumeroFlexible(precioCrudo);

    const contenido = `${nombreEntidad || nitEntidad} / ${municipioTexto} / ${codigo} / ${precioCrudo ?? ""}`;

    if (!nitEntidad) {
      errores.push({ filaOriginal, contenido, motivo: "NIT de la EPS vacío." });
      return;
    }
    if (!nombreEntidad) {
      errores.push({ filaOriginal, contenido, motivo: "Nombre de la EPS vacío." });
      return;
    }
    if (!municipioTexto) {
      errores.push({ filaOriginal, contenido, motivo: "Municipio vacío." });
      return;
    }
    if (!codigo) {
      errores.push({ filaOriginal, contenido, motivo: "Código vacío." });
      return;
    }
    if (precio === null) {
      errores.push({ filaOriginal, contenido, motivo: `Precio no interpretable: "${precioCrudo ?? ""}".` });
      return;
    }
    if (precio <= 0) {
      errores.push({ filaOriginal, contenido, motivo: "Precio debe ser mayor a 0." });
      return;
    }

    filas.push({
      filaOriginal,
      nitEntidad,
      nombreEntidad,
      municipioTexto,
      codigo,
      descripcion: descripcion || codigo,
      precio,
    });
  });

  return { filas, errores };
}

/**
 * Punto de entrada único del parser: detecta el formato por la extensión del
 * nombre de archivo y devuelve las filas ya interpretadas + los errores de
 * filas puntuales que no se pudieron leer (nunca lanza por una fila mala
 * aislada — solo por un archivo estructuralmente ilegible, ver `{ error }`).
 */
export async function parsearArchivoPrecioReferencia(buffer: Buffer, nombreArchivo: string): Promise<ResultadoParseo | { error: string }> {
  const celdas = await leerArchivoACeldas(buffer, nombreArchivo);
  if ("error" in celdas) return celdas;
  return construirResultadoDesdeFilasDeCeldas(celdas);
}
