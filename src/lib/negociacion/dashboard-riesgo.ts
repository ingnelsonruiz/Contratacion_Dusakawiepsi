/**
 * Funciones puras del Dashboard Analítico de Competitividad y Riesgo
 * Contractual (Fase A) — sin dependencias de Next.js/BD, testeables de forma
 * aislada, mismo principio de arquitectura que src/lib/negociacion/comparativo.ts.
 *
 * Toma como entrada los mismos `FilaComparativoCodigo[]` que ya usa el resto
 * del Módulo 2 (un grupo = un código dentro de UN municipio, con su lista de
 * prestadores) pero agregados a través de TODOS los municipios a la vez — es
 * una vista analítica sobre los mismos datos, no una fuente nueva.
 *
 * Nota de negocio importante: la comparación entre prestadores sigue
 * ocurriendo SIEMPRE dentro del mismo municipio (regla ya documentada en
 * KnowledgeBase/05-ReglasNegocio/Contratación.md — nunca se compara el precio
 * de un prestador de un municipio contra el de otro). Este dashboard solo
 * AGREGA esos resultados ya calculados (ej. "cuántos códigos críticos tiene
 * este prestador, sumando todos los municipios donde opera"), no introduce
 * comparaciones cruzadas nuevas.
 */

import { clasificarSemaforo, amplitudSegunReferencia } from "@/lib/negociacion/comparativo";
import type { FilaComparativoCodigo, NivelSemaforo, ReferenciaVariacion, UmbralesSemaforo } from "@/types/comparativo";
import type {
  AhorroPotencial,
  DetallePorNivel,
  FilaDetalleGrupo,
  FilaDistribucionEstado,
  FilaEntradaDetalle,
  FilaHeatmapMunicipio,
  FilaRankingRiesgo,
  FilaTopCritico,
  KpisDashboardRiesgo,
  NivelRiesgo,
  ResultadoDashboardRiesgo,
} from "@/types/dashboard-riesgo";
import type { TipoComparativo } from "@/types/comparativo";

/**
 * Una aparición individual de UN prestador en UN código+municipio, ya
 * clasificada — unidad base de todos los cálculos de este archivo.
 * Exportada (2026-07-29) para que src/lib/negociacion/perfil-prestador.ts
 * pueda filtrar estas mismas apariciones a UN solo prestador, sin duplicar
 * la lógica de clasificación de semáforo/variación aquí.
 */
export interface EntradaPrestador {
  grupo: FilaComparativoCodigo;
  ips: number;
  razonSocial: string;
  nit: string;
  valorFinal: number;
  variacion: number;
  valorReferencia: number;
  nivel: NivelSemaforo;
}

export function aplanarEntradas(grupos: FilaComparativoCodigo[], referencia: ReferenciaVariacion, umbrales: UmbralesSemaforo): EntradaPrestador[] {
  const entradas: EntradaPrestador[] = [];
  for (const grupo of grupos) {
    const valorReferencia = referencia === "promedio" ? grupo.promedio : grupo.mediana;
    for (const p of grupo.prestadores) {
      const variacion = referencia === "promedio" ? p.variacionPctPromedio : p.variacionPctMediana;
      entradas.push({
        grupo,
        ips: p.ips,
        razonSocial: p.razonSocial,
        nit: p.nit,
        valorFinal: p.valorFinal,
        variacion,
        valorReferencia,
        nivel: clasificarSemaforo(variacion, umbrales),
      });
    }
  }
  return entradas;
}

/**
 * Score de riesgo 0-100 — HEURÍSTICO de priorización para auditoría, no un
 * modelo estadístico validado. Pesos elegidos para que el % de tarifas
 * críticas domine el score (0.40 — es la señal más directa de sobrecosto
 * real) seguido de la desviación promedio (0.25), alertas (0.20) y amplitud
 * del grupo (0.15 — mide inconsistencia del mercado, no necesariamente culpa
 * del prestador). Documentado explícitamente en KnowledgeBase para que
 * cualquier ajuste futuro de pesos sea deliberado, no accidental.
 */
interface ComponentesRiesgo {
  componenteCriticas: number;
  componenteAlertas: number;
  componenteDesviacion: number;
  componenteAmplitud: number;
  score: number;
}

/**
 * Igual que calcularScoreRiesgo() pero devolviendo también los 4 componentes
 * intermedios — se agregó 2026-07-29 para que el menú emergente de doble
 * clic del ranking (dashboard-riesgo-tab.tsx) pueda mostrar la fórmula con
 * los números reales de cada prestador, en vez de solo el resultado final.
 */
export function calcularComponentesRiesgo(params: {
  pctCritico: number;
  pctAlerta: number;
  indiceDesviacionMedio: number;
  amplitudPromedio: number;
}): ComponentesRiesgo {
  const componenteCriticas = Math.min(100, params.pctCritico * 2);
  const componenteAlertas = Math.min(100, params.pctAlerta * 1.5);
  const componenteDesviacion = Math.min(100, params.indiceDesviacionMedio);
  const componenteAmplitud = Math.min(100, params.amplitudPromedio);
  const score = Math.round(componenteCriticas * 0.4 + componenteAlertas * 0.2 + componenteDesviacion * 0.25 + componenteAmplitud * 0.15);
  return { componenteCriticas, componenteAlertas, componenteDesviacion, componenteAmplitud, score };
}

export function calcularScoreRiesgo(params: {
  pctCritico: number;
  pctAlerta: number;
  indiceDesviacionMedio: number;
  amplitudPromedio: number;
}): number {
  return calcularComponentesRiesgo(params).score;
}

/** Cuántos códigos de sobrecosto (crítico/alerta) se envían al cliente por prestador — ver FilaDetalleSobrecosto. */
const TOP_SOBRECOSTOS_POR_PRESTADOR = 25;

/** Cortes del score — documentados junto al score para que ambos cambien juntos si se ajustan. */
export function clasificarNivelRiesgo(score: number): NivelRiesgo {
  if (score < 25) return "bajo";
  if (score < 50) return "medio";
  if (score < 75) return "alto";
  return "muyAlto";
}

const ETIQUETAS_NIVEL_RIESGO: Record<NivelRiesgo, string> = {
  bajo: "🟢 Riesgo Bajo",
  medio: "🟡 Riesgo Medio",
  alto: "🟠 Riesgo Alto",
  muyAlto: "🔴 Riesgo Muy Alto",
};

export function etiquetaNivelRiesgo(nivel: NivelRiesgo): string {
  return ETIQUETAS_NIVEL_RIESGO[nivel];
}

/** Punto de entrada único — arma las 6 secciones del dashboard a partir de los grupos ya cruzados (todos los municipios). */
export function construirDashboardRiesgo(
  tipo: TipoComparativo,
  grupos: FilaComparativoCodigo[],
  referencia: ReferenciaVariacion,
  umbrales: UmbralesSemaforo
): ResultadoDashboardRiesgo {
  const entradas = aplanarEntradas(grupos, referencia, umbrales);

  // --- 1. KPIs ejecutivos ---
  const prestadoresSet = new Set(entradas.map((e) => e.ips));
  const municipiosSet = new Set(grupos.map((g) => g.municipioCodigo));
  const conteoPorNivel: Record<NivelSemaforo, number> = { ok: 0, alerta: 0, critico: 0, favorable: 0, muyFavorable: 0 };
  let sumaValorFinal = 0;
  for (const e of entradas) {
    conteoPorNivel[e.nivel]++;
    sumaValorFinal += e.valorFinal;
  }
  const variabilidadPromedio = grupos.length > 0 ? grupos.reduce((acc, g) => acc + amplitudSegunReferencia(g, referencia), 0) / grupos.length : 0;

  const kpis: KpisDashboardRiesgo = {
    totalCodigosComparables: grupos.length,
    totalPrestadores: prestadoresSet.size,
    totalMunicipios: municipiosSet.size,
    valorPromedioMercado: entradas.length > 0 ? sumaValorFinal / entradas.length : 0,
    variabilidadPromedio,
    cantidadCritico: conteoPorNivel.critico,
    cantidadAlerta: conteoPorNivel.alerta,
    cantidadOk: conteoPorNivel.ok,
    cantidadFavorable: conteoPorNivel.favorable,
    cantidadMuyFavorable: conteoPorNivel.muyFavorable,
    totalEntradasClasificadas: entradas.length,
    pctNegociacionCritica: entradas.length > 0 ? (conteoPorNivel.critico / entradas.length) * 100 : 0,
  };

  // --- 2. Ranking de riesgo + 5. Distribución de estados (misma agregación por prestador) ---
  interface AcumPrestador {
    ips: number;
    razonSocial: string;
    nit: string;
    municipios: Set<string>;
    conteo: Record<NivelSemaforo, number>;
    sumaDesviacionAbs: number;
    sumaCostoPotencial: number;
    gruposVistos: Set<FilaComparativoCodigo>;
    entradasSobrecosto: EntradaPrestador[];
  }
  const porPrestador = new Map<number, AcumPrestador>();
  for (const e of entradas) {
    let acc = porPrestador.get(e.ips);
    if (!acc) {
      acc = {
        ips: e.ips,
        razonSocial: e.razonSocial,
        nit: e.nit,
        municipios: new Set(),
        conteo: { ok: 0, alerta: 0, critico: 0, favorable: 0, muyFavorable: 0 },
        sumaDesviacionAbs: 0,
        sumaCostoPotencial: 0,
        gruposVistos: new Set(),
        entradasSobrecosto: [],
      };
      porPrestador.set(e.ips, acc);
    }
    acc.municipios.add(e.grupo.municipioNombre);
    acc.conteo[e.nivel]++;
    acc.sumaDesviacionAbs += Math.abs(e.variacion);
    acc.gruposVistos.add(e.grupo);
    if (e.nivel === "critico" || e.nivel === "alerta") {
      acc.sumaCostoPotencial += e.valorFinal - e.valorReferencia;
      acc.entradasSobrecosto.push(e);
    }
  }

  const ranking: FilaRankingRiesgo[] = [];
  const distribucionEstados: FilaDistribucionEstado[] = [];
  for (const acc of porPrestador.values()) {
    const total = acc.conteo.ok + acc.conteo.alerta + acc.conteo.critico + acc.conteo.favorable + acc.conteo.muyFavorable;
    const pctCritico = total > 0 ? (acc.conteo.critico / total) * 100 : 0;
    const pctAlerta = total > 0 ? (acc.conteo.alerta / total) * 100 : 0;
    const indiceDesviacionMedio = total > 0 ? acc.sumaDesviacionAbs / total : 0;
    const amplitudPromedioPrestador =
      acc.gruposVistos.size > 0
        ? Array.from(acc.gruposVistos).reduce((sum, g) => sum + amplitudSegunReferencia(g, referencia), 0) / acc.gruposVistos.size
        : 0;
    const { componenteCriticas, componenteAlertas, componenteDesviacion, componenteAmplitud, score } = calcularComponentesRiesgo({
      pctCritico,
      pctAlerta,
      indiceDesviacionMedio,
      amplitudPromedio: amplitudPromedioPrestador,
    });

    const sobrecostosOrdenados = [...acc.entradasSobrecosto].sort((a, b) => b.valorFinal - b.valorReferencia - (a.valorFinal - a.valorReferencia));

    ranking.push({
      ips: acc.ips,
      razonSocial: acc.razonSocial,
      nit: acc.nit,
      municipiosDondeOpera: Array.from(acc.municipios),
      totalApariciones: total,
      cantidadCritico: acc.conteo.critico,
      cantidadAlerta: acc.conteo.alerta,
      cantidadOk: acc.conteo.ok,
      cantidadFavorable: acc.conteo.favorable,
      cantidadMuyFavorable: acc.conteo.muyFavorable,
      pctCritico,
      pctAlerta,
      indiceDesviacionMedio,
      amplitudPromedio: amplitudPromedioPrestador,
      costoPotencialAdicional: acc.sumaCostoPotencial,
      score,
      nivelRiesgo: clasificarNivelRiesgo(score),
      componenteCriticas,
      componenteAlertas,
      componenteDesviacion,
      componenteAmplitud,
      cantidadSobrecostos: acc.entradasSobrecosto.length,
      detalleSobrecostos: sobrecostosOrdenados.slice(0, TOP_SOBRECOSTOS_POR_PRESTADOR).map((e) => ({
        codigoTarifa: e.grupo.codigoTarifa,
        descripcion: e.grupo.descripcion,
        municipioNombre: e.grupo.municipioNombre,
        valorFinal: e.valorFinal,
        valorReferencia: e.valorReferencia,
        diferenciaAbsoluta: e.valorFinal - e.valorReferencia,
        diferenciaPct: e.variacion,
        nivel: e.nivel as "critico" | "alerta",
      })),
    });

    distribucionEstados.push({
      ips: acc.ips,
      razonSocial: acc.razonSocial,
      cantidadMuyFavorable: acc.conteo.muyFavorable,
      cantidadFavorable: acc.conteo.favorable,
      cantidadOk: acc.conteo.ok,
      cantidadAlerta: acc.conteo.alerta,
      cantidadCritico: acc.conteo.critico,
      total,
    });
  }
  // Mayor sobrecosto económico primero — es la señal más accionable para negociación.
  ranking.sort((a, b) => b.costoPotencialAdicional - a.costoPotencialAdicional);
  distribucionEstados.sort((a, b) => b.total - a.total);

  // --- 4. Heatmap por municipio (NO municipio×prestador — ver nota de negocio arriba) ---
  interface AcumMunicipio {
    municipioCodigo: string;
    municipioNombre: string;
    departamentoNombre: string;
    grupos: FilaComparativoCodigo[];
    entradasTotal: number;
    entradasCritico: number;
  }
  const porMunicipio = new Map<string, AcumMunicipio>();
  for (const g of grupos) {
    let acc = porMunicipio.get(g.municipioCodigo);
    if (!acc) {
      acc = { municipioCodigo: g.municipioCodigo, municipioNombre: g.municipioNombre, departamentoNombre: g.departamentoNombre, grupos: [], entradasTotal: 0, entradasCritico: 0 };
      porMunicipio.set(g.municipioCodigo, acc);
    }
    acc.grupos.push(g);
  }
  for (const e of entradas) {
    const acc = porMunicipio.get(e.grupo.municipioCodigo);
    if (!acc) continue;
    acc.entradasTotal++;
    if (e.nivel === "critico") acc.entradasCritico++;
  }
  const heatmap: FilaHeatmapMunicipio[] = Array.from(porMunicipio.values()).map((acc) => ({
    municipioCodigo: acc.municipioCodigo,
    municipioNombre: acc.municipioNombre,
    departamentoNombre: acc.departamentoNombre,
    cantidadCodigos: acc.grupos.length,
    cantidadCritico: acc.entradasCritico,
    amplitudPromedio: acc.grupos.reduce((sum, g) => sum + amplitudSegunReferencia(g, referencia), 0) / acc.grupos.length,
    pctCritico: acc.entradasTotal > 0 ? (acc.entradasCritico / acc.entradasTotal) * 100 : 0,
  }));
  heatmap.sort((a, b) => b.pctCritico - a.pctCritico);

  // --- 9. Top 20 más críticos ---
  const top20: FilaTopCritico[] = entradas
    .filter((e) => e.nivel === "critico")
    .sort((a, b) => b.variacion - a.variacion)
    .slice(0, 20)
    .map((e) => ({
      codigoTarifa: e.grupo.codigoTarifa,
      descripcion: e.grupo.descripcion,
      razonSocial: e.razonSocial,
      municipioNombre: e.grupo.municipioNombre,
      valorFinal: e.valorFinal,
      valorReferencia: e.valorReferencia,
      diferenciaAbsoluta: e.valorFinal - e.valorReferencia,
      diferenciaPct: e.variacion,
    }));

  // --- 8. Ahorro potencial — SOLO sobre entradas críticas, llevadas a la referencia elegida ---
  const ahorroPorPrestador = new Map<number, { razonSocial: string; ahorro: number }>();
  const ahorroPorMunicipio = new Map<string, { municipioNombre: string; ahorro: number }>();
  let ahorroTotal = 0;
  for (const e of entradas) {
    if (e.nivel !== "critico") continue;
    const ahorro = e.valorFinal - e.valorReferencia;
    ahorroTotal += ahorro;
    const p = ahorroPorPrestador.get(e.ips) ?? { razonSocial: e.razonSocial, ahorro: 0 };
    p.ahorro += ahorro;
    ahorroPorPrestador.set(e.ips, p);
    const m = ahorroPorMunicipio.get(e.grupo.municipioCodigo) ?? { municipioNombre: e.grupo.municipioNombre, ahorro: 0 };
    m.ahorro += ahorro;
    ahorroPorMunicipio.set(e.grupo.municipioCodigo, m);
  }
  const ahorro: AhorroPotencial = {
    totalGlobal: ahorroTotal,
    porPrestador: Array.from(ahorroPorPrestador.entries())
      .map(([ips, v]) => ({ ips, razonSocial: v.razonSocial, ahorro: v.ahorro }))
      .sort((a, b) => b.ahorro - a.ahorro),
    porMunicipio: Array.from(ahorroPorMunicipio.entries())
      .map(([municipioCodigo, v]) => ({ municipioCodigo, municipioNombre: v.municipioNombre, ahorro: v.ahorro }))
      .sort((a, b) => b.ahorro - a.ahorro),
  };

  // --- 12. Narrativa automática — por reglas, NO IA generativa (mismo criterio ya decidido con el usuario para el Módulo 3). ---
  const narrativa = construirNarrativa(kpis, ranking, heatmap, top20, ahorro, referencia);

  // --- Fuente real detrás de cada KPI — pedido del usuario 2026-07-29: el
  // doble clic debe llevar al DATO (qué códigos/valores generan el número),
  // no solo a la fórmula. `detallePorNivel` acota a las TOP_ENTRADAS_POR_NIVEL
  // apariciones con mayor |variación%| absoluta por estado (las más
  // relevantes para auditar primero); `detalleGrupos` no se acota porque ya
  // es del mismo tamaño que `grupos` (sin duplicar apariciones por prestador).
  const detallePorNivel = construirDetallePorNivel(entradas);
  const detalleGrupos: FilaDetalleGrupo[] = grupos.map((g) => ({
    codigoTarifa: g.codigoTarifa,
    descripcion: g.descripcion,
    municipioNombre: g.municipioNombre,
    cantidadPrestadores: g.cantidadPrestadores,
    minimo: g.minimo,
    maximo: g.maximo,
    promedio: g.promedio,
    mediana: g.mediana,
    amplitud: amplitudSegunReferencia(g, referencia),
  }));

  return { tipo, kpis, ranking, heatmap, distribucionEstados, top20, ahorro, narrativa, detallePorNivel, detalleGrupos };
}

/** Cuántas filas como máximo se envían al cliente por nivel de semáforo — evita un payload enorme en el nivel "ok" (suele ser el más numeroso). */
const TOP_ENTRADAS_POR_NIVEL = 200;

function construirDetallePorNivel(entradas: EntradaPrestador[]): DetallePorNivel {
  const porNivel: DetallePorNivel = { ok: [], alerta: [], critico: [], favorable: [], muyFavorable: [] };
  const acumulador: Record<NivelSemaforo, EntradaPrestador[]> = { ok: [], alerta: [], critico: [], favorable: [], muyFavorable: [] };
  for (const e of entradas) acumulador[e.nivel].push(e);

  (Object.keys(acumulador) as NivelSemaforo[]).forEach((nivel) => {
    porNivel[nivel] = [...acumulador[nivel]]
      .sort((a, b) => Math.abs(b.variacion) - Math.abs(a.variacion))
      .slice(0, TOP_ENTRADAS_POR_NIVEL)
      .map((e): FilaEntradaDetalle => ({
        codigoTarifa: e.grupo.codigoTarifa,
        descripcion: e.grupo.descripcion,
        razonSocial: e.razonSocial,
        municipioNombre: e.grupo.municipioNombre,
        valorFinal: e.valorFinal,
        valorReferencia: e.valorReferencia,
        diferenciaAbsoluta: e.valorFinal - e.valorReferencia,
        diferenciaPct: e.variacion,
        nivel: e.nivel,
      }));
  });
  return porNivel;
}

function construirNarrativa(
  kpis: KpisDashboardRiesgo,
  ranking: FilaRankingRiesgo[],
  heatmap: FilaHeatmapMunicipio[],
  top20: FilaTopCritico[],
  ahorro: AhorroPotencial,
  referencia: ReferenciaVariacion
): string[] {
  const frases: string[] = [];
  const etiquetaRef = referencia === "promedio" ? "promedio" : "mediana";

  const peorPrestador = [...ranking].sort((a, b) => b.pctCritico - a.pctCritico)[0];
  if (peorPrestador && peorPrestador.pctCritico > 0) {
    frases.push(
      `El ${peorPrestador.pctCritico.toFixed(0)}% de las tarifas comparables de ${peorPrestador.razonSocial} se encuentran en estado crítico (${peorPrestador.cantidadCritico} de ${peorPrestador.totalApariciones}).`
    );
  }

  const municipioMasDisperso = heatmap.length > 0 ? [...heatmap].sort((a, b) => b.amplitudPromedio - a.amplitudPromedio)[0] : null;
  if (municipioMasDisperso) {
    frases.push(
      `El municipio de ${municipioMasDisperso.municipioNombre} presenta la mayor dispersión de precios promedio del análisis (amplitud ${municipioMasDisperso.amplitudPromedio.toFixed(0)}% vs. el ${etiquetaRef}).`
    );
  }

  if (top20.length > 0) {
    const peorDiferencia = top20[0];
    frases.push(
      `Se identifican diferencias de hasta ${peorDiferencia.diferenciaPct.toFixed(0)}% para procedimientos equivalentes entre prestadores del mismo municipio (código ${peorDiferencia.codigoTarifa}, ${peorDiferencia.razonSocial}).`
    );
  }

  if (ahorro.totalGlobal > 0) {
    frases.push(
      `El potencial de ahorro estimado asciende a ${new Intl.NumberFormat("es-CO", { style: "currency", currency: "COP", maximumFractionDigits: 0 }).format(ahorro.totalGlobal)} si las tarifas críticas se alinearan con el ${etiquetaRef} del mercado (estimado por unidad tarifada, no proyectado por volumen real de servicios prestados).`
    );
  }

  const altoRiesgo = ranking.filter((r) => r.nivelRiesgo === "alto" || r.nivelRiesgo === "muyAlto");
  if (altoRiesgo.length > 0) {
    const criticasEnAltoRiesgo = altoRiesgo.reduce((sum, r) => sum + r.cantidadCritico, 0);
    const pctCriticasConcentradas = kpis.cantidadCritico > 0 ? (criticasEnAltoRiesgo / kpis.cantidadCritico) * 100 : 0;
    frases.push(
      `${altoRiesgo.length} de ${ranking.length} prestadores presentan un score de riesgo Alto o Muy Alto, concentrando el ${pctCriticasConcentradas.toFixed(0)}% de las tarifas críticas totales.`
    );
  }

  frases.push(
    `El ${kpis.pctNegociacionCritica.toFixed(1)}% del total de negociaciones comparadas (${kpis.totalEntradasClasificadas.toLocaleString("es-CO")} apariciones prestador-código) está en estado crítico.`
  );

  return frases;
}
