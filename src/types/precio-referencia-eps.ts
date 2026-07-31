/**
 * Tipos del módulo "Precios de Referencia EPS" (pedido por el usuario
 * 2026-07-31): una tabla propia, alimentada por el analista vía archivo
 * (CSV/TXT/XLSX), con precios que OTRAS EPS pagan a prestadores por código
 * en un municipio dado. Dos usos:
 *   1. Consulta/administración directa (subir, ver, filtrar, depurar).
 *   2. Insumo del módulo "Análisis de Propuesta Prestador": si el código
 *      ofertado por un prestador ya tiene un precio de otra EPS en ese
 *      mismo municipio, se muestra en el acordeón y se lleva a la
 *      contrapropuesta como una opción más económica adicional — ver
 *      `ReferenciaMercadoEps` y src/types/analisis-propuesta.ts.
 *
 * Persistencia: administrativo.negociacion_contratacion_precio_referencia_eps
 * (ver db/migrations/002_precio_referencia_eps.sql y
 * KnowledgeBase/04-BaseDatos/Tablas.md — tabla con DDL escrito pero AÚN NO
 * aplicada en la BD real, debe ejecutarse manualmente antes de usar el
 * módulo).
 */

/** Una fila cruda, tal como se leyó del archivo (CSV/TXT/XLSX), antes de resolver el municipio contra el catálogo DANE. */
export interface FilaPrecioReferenciaCargada {
  /** Número de fila del archivo original (2 = primera fila de datos). */
  filaOriginal: number;
  nitEntidad: string;
  nombreEntidad: string;
  /** Texto tal como venía en el archivo (ej. "Valledupar "), antes de resolver contra tb_municipio. */
  municipioTexto: string;
  codigo: string;
  descripcion: string;
  precio: number;
}

/** Una fila del archivo que no se pudo interpretar (columna vacía, precio no numérico, etc.) — se reporta, nunca se descarta en silencio. */
export interface ErrorFilaPrecioReferencia {
  filaOriginal: number;
  contenido: string;
  motivo: string;
}

/** Resultado de resolver el texto libre "Municipio" del archivo contra el catálogo DANE (tb_municipio). */
export interface MunicipioCatalogo {
  municipioCodigo: string;
  municipioNombre: string;
  departamentoNombre: string;
}

/** Resultado completo de cargar (parsear + resolver municipio + UPSERT) un archivo de precios de referencia. */
export interface ResultadoCargaPrecioReferencia {
  nombreArchivo: string;
  totalFilasArchivo: number;
  /** Filas nuevas insertadas (combinación EPS+municipio+código que no existía). */
  insertados: number;
  /** Filas ya existentes cuyo precio/descripción se actualizó (misma combinación EPS+municipio+código). */
  actualizados: number;
  errores: ErrorFilaPrecioReferencia[];
  /**
   * Textos de municipio del archivo que no se pudieron resolver contra el
   * catálogo DANE (ni de forma exacta ni ambigua) — esas filas NO se
   * cargaron, se listan aparte para que el analista corrija el archivo.
   */
  municipiosNoResueltos: { texto: string; filas: number[]; motivo: string }[];
  fechaCarga: string;
}

/** Una fila ya persistida — para la pantalla de administración/consulta del módulo. */
export interface FilaPrecioReferenciaEps {
  id: number;
  nitEntidad: string;
  nombreEntidad: string;
  municipioCodigo: string;
  municipioNombre: string;
  departamentoNombre: string;
  codigo: string;
  descripcion: string;
  precio: number;
  fechaActualizado: string;
}

export interface FiltrosPrecioReferenciaEps {
  municipioCodigo?: string;
  /** Búsqueda libre sobre nombre/NIT de la entidad. */
  entidadTexto?: string;
  /** Búsqueda libre sobre código o descripción. */
  codigoTexto?: string;
  pagina: number;
  tamanoPagina: number;
}

export interface ResultadoListadoPrecioReferenciaEps {
  filas: FilaPrecioReferenciaEps[];
  total: number;
}

/**
 * Una referencia de otra EPS para UN código, ya resuelta contra el
 * municipio de la evaluación — usada dentro de
 * `FilaEvaluacionPropuesta.referenciasMercadoEps`
 * (src/types/analisis-propuesta.ts). Deliberadamente más liviana que
 * `PrestadorReferenciaPropuesta` (no tiene NIT/contrato de un prestador de
 * la red propia porque no aplica: es un precio reportado por una EPS
 * externa, no un contrato de Dusakawi).
 */
export interface ReferenciaMercadoEps {
  nitEntidad: string;
  nombreEntidad: string;
  precio: number;
}
