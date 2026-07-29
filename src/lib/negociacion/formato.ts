/**
 * Funciones puras de formato y reglas de resolución de valores para el
 * Módulo 1 (Tarifario Vigente e Histórico) y módulos futuros.
 *
 * Principio de arquitectura (docs/ARQUITECTURA.md §2.3): todo cálculo de
 * negocio vive aquí como función pura y testeable — nunca inline en un
 * componente .tsx. Sin dependencias de Next.js/React: se pueden probar con
 * cualquier test runner sin levantar la app.
 */

/**
 * Resuelve el "valor final" negociado de una línea de tarifario.
 *
 * Por qué existe: tb_tarifario_propio_detalle trae hasta 4 columnas de valor
 * (valor, valor_base, valor_pactado, valor_regulado) y no todas están
 * pobladas para todo tipo de contrato — verificado contra datos reales
 * 2026-07-28: contratos capitados antiguos solo usan `valor`/`valor_servicio`
 * (valor_base/valor_pactado en 0), mientras que otros tipos de tarifa sí
 * pueblan valor_base + porcentaje_tarifa. Prioridad:
 *   1. valor_pactado si es > 0 (ya es el valor negociado final).
 *   2. valor_base * (1 + porcentaje_tarifa/100) si valor_base > 0 y hay % negociado.
 *   3. valor_base si es > 0 y no hay porcentaje (0% de variación sobre el manual).
 *   4. valor (columna general de la línea) como último recurso.
 */
export function resolverValorFinal(params: {
  valor: number;
  valorBase: number;
  valorPactado: number;
  porcentajeTarifa: number;
}): number {
  const { valor, valorBase, valorPactado, porcentajeTarifa } = params;

  if (valorPactado > 0) return valorPactado;
  if (valorBase > 0) return valorBase * (1 + porcentajeTarifa / 100);
  return valor;
}

/** Convierte un flag smallint (0/1) de PostgreSQL a boolean de TypeScript. */
export function swABoolean(sw: number | null | undefined): boolean {
  return Number(sw) === 1;
}

/** Formato de moneda colombiana, sin decimales (consistente con el resto del ecosistema Dusakawi). */
export function formatearMoneda(valor: number | null | undefined): string {
  const numero = Number(valor ?? 0);
  return new Intl.NumberFormat("es-CO", {
    style: "currency",
    currency: "COP",
    maximumFractionDigits: 0,
  }).format(numero);
}

/** Formato de porcentaje con hasta 2 decimales, sin ceros de más (ej. "12%", "12.5%"). */
export function formatearPorcentaje(valor: number | null | undefined): string {
  const numero = Number(valor ?? 0);
  return `${new Intl.NumberFormat("es-CO", { maximumFractionDigits: 2 }).format(numero)}%`;
}

/** Formato de fecha corta es-CO (dd/mm/aaaa) a partir de un ISO string o Date. */
export function formatearFecha(fecha: string | Date | null | undefined): string {
  if (!fecha) return "—";
  const d = typeof fecha === "string" ? new Date(fecha) : fecha;
  if (Number.isNaN(d.getTime())) return "—";
  return new Intl.DateTimeFormat("es-CO", { timeZone: "UTC" }).format(d);
}

/** Determina si un contrato está vigente HOY por fecha (independiente del código `estado`). */
export function esContratoVigente(fechaInicio: string | Date, fechaTerminacion: string | Date): boolean {
  const hoy = new Date();
  const inicio = typeof fechaInicio === "string" ? new Date(fechaInicio) : fechaInicio;
  const fin = typeof fechaTerminacion === "string" ? new Date(fechaTerminacion) : fechaTerminacion;
  return inicio.getTime() <= hoy.getTime() && fin.getTime() >= hoy.getTime();
}

/** Total de páginas a partir del total de filas y el tamaño de página (mínimo 1). */
export function calcularTotalPaginas(total: number, pageSize: number): number {
  if (pageSize <= 0) return 1;
  return Math.max(1, Math.ceil(total / pageSize));
}

/** Arma la presentación de "Manual tarifario de referencia" a partir del valor base y el % negociado. */
export function descripcionReferenciaManual(valorBase: number, porcentajeTarifa: number): string {
  if (valorBase <= 0) return "Sin valor de referencia (tarifa propia)";
  const signo = porcentajeTarifa > 0 ? "+" : "";
  return `${formatearMoneda(valorBase)} (${signo}${formatearPorcentaje(porcentajeTarifa)})`;
}
