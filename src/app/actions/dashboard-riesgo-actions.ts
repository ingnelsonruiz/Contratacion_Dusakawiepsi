"use server";

/**
 * Server Actions del Dashboard Analítico de Competitividad y Riesgo
 * Contractual (Fase A) — pestaña nueva del Módulo 2, pedida por el usuario
 * 2026-07-29 como herramienta de auditoría para Gerencia/Contratación.
 *
 * Reutiliza EXACTAMENTE la misma query base y agregación que
 * `getComparativoPorCodigo` en comparativo-actions.ts (mismo cruce por
 * código, mismo `dedupMejorPrecio`, mismo `construirFilaComparativo`), pero
 * SIN el filtro de búsqueda por código — aquí se trae el tarifario completo
 * de un tipo a través de TODOS los municipios, para poder agregar por
 * prestador/municipio en `construirDashboardRiesgo`
 * (src/lib/negociacion/dashboard-riesgo.ts).
 *
 * Nota de negocio (no se repite en cada función): la comparación de precios
 * sigue ocurriendo SIEMPRE dentro del mismo municipio — este archivo solo
 * agrega resultados ya calculados así, nunca compara precios entre
 * municipios distintos.
 *
 * Filtros nuevos verificados contra el esquema real antes de implementar
 * (2026-07-29, ver KnowledgeBase/05-ReglasNegocio/Contratación.md):
 *   - `tipoContrato` (ct_ips_contrato.tipo_contrato → tb_tipo_contrato):
 *     viable, valores reales en uso: Capitado/Evento/PGP.
 *   - `nivelComplejidad` (ct_ips.nivel_complejidad, smallint 0-3): viable,
 *     sin tabla de catálogo — se usa la clasificación estándar del sistema
 *     de salud colombiano.
 *   - Especialidad/Grupo CUPS/Grupo CUM (tb_cup.consecutivo_especialidad_nt/
 *     consecutivo_grupo_nt, tb_medicamento.grupo_medicamento): NO se
 *     implementaron — verificado que `consecutivo_especialidad_nt` y
 *     `consecutivo_grupo_nt` están NULL en >99.9% de tb_cup, y
 *     `grupo_medicamento` vale "No Aplica" en el 100% de tb_medicamento. No
 *     discriminan nada en la práctica; agregarlos como filtro sería
 *     decorativo, no funcional.
 *   - Familia de insumos: no existe columna equivalente en tb_insumo (solo
 *     `tipo_insumo`, sin verificar qué cataloga) — fuera de alcance.
 */

import { pool } from "@/lib/db";
import { CONTRATOS_EXCLUIDOS_MIGRACION, CONFIG_TIPO_TARIFARIO } from "@/lib/negociacion/constantes";
import { calcularEstadisticas, calcularVariacionPct, dedupMejorPrecio, filtrarYRecortarPorEstados } from "@/lib/negociacion/comparativo";
import { resolverValorFinal } from "@/lib/negociacion/formato";
import { construirDashboardRiesgo } from "@/lib/negociacion/dashboard-riesgo";
import type { TipoComparativo, FilaComparativoCodigo } from "@/types/comparativo";
import type {
  FiltrosDashboardRiesgo,
  OpcionNivelComplejidad,
  OpcionTipoContrato,
  ResultadoDashboardRiesgo,
} from "@/types/dashboard-riesgo";

const SOURCE = "dashboard-riesgo";
/** Igual criterio que LIMITE_FILAS_CRUDAS en comparativo-actions.ts — defensivo, no una paginación real de negocio. */
const LIMITE_FILAS_CRUDAS = 200_000;

const ETIQUETAS_NIVEL_COMPLEJIDAD: Record<number, string> = {
  0: "Sin definir",
  1: "Baja complejidad",
  2: "Media complejidad",
  3: "Alta complejidad",
};

interface FilaCruda {
  ips: number;
  razonSocial: string;
  nit: string;
  numeroContrato: string;
  consecutivoContrato: number;
  municipioCodigo: string;
  municipioNombre: string;
  departamentoNombre: string;
  codigoTarifa: string;
  descripcion: string;
  valorFinal: number;
}

function mapFilaCruda(r: any): FilaCruda {
  const valor = Number(r.valor ?? r.valor_servicio ?? 0);
  const valorBase = Number(r.valor_base ?? 0);
  const valorPactado = Number(r.valor_pactado ?? 0);
  const porcentajeTarifa = Number(r.porcentaje_tarifa ?? 0);
  return {
    ips: Number(r.ips),
    razonSocial: r.razon_social,
    nit: r.nit,
    numeroContrato: r.numero_contrato,
    consecutivoContrato: Number(r.consecutivo_contrato),
    municipioCodigo: r.municipio_codigo,
    municipioNombre: r.municipio_nombre,
    departamentoNombre: r.departamento_nombre,
    codigoTarifa: r.codigo_tarifa,
    descripcion: r.descripcion_maestro ?? r.codigo_tarifa,
    valorFinal: resolverValorFinal({ valor, valorBase, valorPactado, porcentajeTarifa }),
  };
}

function construirFilaComparativo(codigoTarifa: string, filas: FilaCruda[]): FilaComparativoCodigo {
  const valores = filas.map((f) => f.valorFinal);
  const stats = calcularEstadisticas(valores);
  const primera = filas[0];
  return {
    codigoTarifa,
    descripcion: primera.descripcion,
    municipioCodigo: primera.municipioCodigo,
    municipioNombre: primera.municipioNombre,
    departamentoNombre: primera.departamentoNombre,
    cantidadPrestadores: filas.length,
    minimo: stats.minimo,
    maximo: stats.maximo,
    promedio: stats.promedio,
    mediana: stats.mediana,
    amplitudPctPromedio: stats.amplitudPctPromedio,
    amplitudPctMediana: stats.amplitudPctMediana,
    prestadores: filas
      .map((f) => ({
        ips: f.ips,
        razonSocial: f.razonSocial,
        nit: f.nit,
        numeroContrato: f.numeroContrato,
        consecutivoContrato: f.consecutivoContrato,
        valorFinal: f.valorFinal,
        variacionPctPromedio: calcularVariacionPct(f.valorFinal, stats.promedio),
        variacionPctMediana: calcularVariacionPct(f.valorFinal, stats.mediana),
      }))
      .sort((a, b) => a.valorFinal - b.valorFinal),
  };
}

/**
 * Trae y agrupa TODO el tarifario de un tipo, a través de todos los
 * municipios, ya filtrado por los criterios que SÍ afectan la formación de
 * los grupos (prestador/tipo de contrato/nivel de complejidad).
 *
 * Exportada (2026-07-29) para que perfil-prestador-actions.ts la reutilice
 * tal cual — IMPORTANTE: si se llama con `filtros.ips` puesto, los grupos
 * resultantes tendrán como máximo 1 prestador (el filtro se aplica en el
 * WHERE de la consulta) y por lo tanto NINGUNO pasará el `filas.length < 2`
 * de más abajo — quedarían 0 grupos. Para "Perfil del Prestador" (comparar A
 * un prestador CONTRA sus pares) se debe llamar SIEMPRE sin `ips` en los
 * filtros, y filtrar por ese prestador DESPUÉS de tener los grupos completos
 * (ver aplanarEntradas() + filtro por `e.ips` en perfil-prestador.ts).
 */
export async function construirGruposTodosMunicipios(
  tipo: TipoComparativo,
  filtros: Pick<FiltrosDashboardRiesgo, "municipioCodigo" | "ips" | "tipoContrato" | "nivelComplejidad">
): Promise<FilaComparativoCodigo[]> {
  const cfg = CONFIG_TIPO_TARIFARIO[tipo];
  const sqlParams: unknown[] = [CONTRATOS_EXCLUIDOS_MIGRACION];
  const condiciones: string[] = [];

  if (filtros.municipioCodigo) {
    sqlParams.push(filtros.municipioCodigo);
    condiciones.push(`AND ips.municipio = $${sqlParams.length}`);
  }
  if (filtros.ips) {
    sqlParams.push(filtros.ips);
    condiciones.push(`AND c.ips = $${sqlParams.length}`);
  }
  if (filtros.tipoContrato && filtros.tipoContrato.length > 0) {
    sqlParams.push(filtros.tipoContrato);
    condiciones.push(`AND c.tipo_contrato = ANY($${sqlParams.length})`);
  }
  if (filtros.nivelComplejidad && filtros.nivelComplejidad.length > 0) {
    sqlParams.push(filtros.nivelComplejidad);
    condiciones.push(`AND ips.nivel_complejidad = ANY($${sqlParams.length})`);
  }

  const sql = `
    SELECT
      c.ips, ips.razon_social, ips.nit, c.numero_contrato, c.consecutivo_contrato,
      ips.municipio AS municipio_codigo, munA.descripcion AS municipio_nombre, depA.descripcion AS departamento_nombre,
      d.codigo_tarifa, ${cfg.aliasMaestro}.descripcion AS descripcion_maestro,
      d.valor, d.valor_servicio, d.valor_base, d.valor_pactado, d.porcentaje_tarifa
    FROM administrativo.ct_ips_contrato c
    JOIN administrativo.ct_ips ips ON ips.ips = c.ips
    JOIN administrativo.tb_municipio munA ON munA.municipio = ips.municipio
    JOIN administrativo.tb_municipio depA ON depA.municipio = munA.departamento
    JOIN administrativo.tb_tarifario_propio_detalle d ON d.consecutivo_tarifa = c.${cfg.columnaTarifario}
    JOIN ${cfg.tablaMaestro} ${cfg.aliasMaestro} ON ${cfg.aliasMaestro}.codigo_interno = d.codigo_tarifa
    WHERE c.sw_activo = 1
      AND c.fecha_anula IS NULL
      AND c.numero_contrato != ALL($1)
      AND c.fecha_inicio <= CURRENT_DATE AND c.fecha_terminacion >= CURRENT_DATE
      AND COALESCE(d.sw_paquete, 0) = 0
      AND COALESCE(d.sw_activo, 1) = 1
      ${condiciones.join("\n      ")}
    LIMIT ${LIMITE_FILAS_CRUDAS}
  `;

  const result = await pool.query(sql, sqlParams, `${SOURCE}/todos-municipios-${tipo}`);
  const rows: any[] = result?.rows ?? [];
  const crudas: FilaCruda[] = rows.map(mapFilaCruda).filter((f) => f.valorFinal > 0);

  // dedupMejorPrecio dedup por (ips + codigoTarifa) — a diferencia del resto
  // del módulo (que ya trabaja UN municipio a la vez, sin ambigüedad), aquí
  // se cruzan TODOS los municipios en una sola pasada, así que se antepone
  // el municipio a `codigoTarifa` solo para la deduplicación (un prestador
  // con el mismo código en 2 municipios distintos no debe pisarse), guardando
  // el código real aparte para restaurarlo después — sin tocar la función
  // genérica compartida con el resto del Módulo 2.
  interface FilaParaDedup extends FilaCruda {
    codigoOriginal: string;
  }
  const paraDedup: FilaParaDedup[] = crudas.map((f) => ({ ...f, codigoOriginal: f.codigoTarifa, codigoTarifa: `${f.municipioCodigo}__${f.codigoTarifa}` }));
  const deduplicadas = dedupMejorPrecio(paraDedup).map((f) => ({ ...f, codigoTarifa: f.codigoOriginal }));

  const porGrupo = new Map<string, FilaCruda[]>();
  for (const fila of deduplicadas) {
    const clave = `${fila.municipioCodigo}__${fila.codigoTarifa}`;
    const lista = porGrupo.get(clave) ?? [];
    lista.push(fila);
    porGrupo.set(clave, lista);
  }

  const grupos: FilaComparativoCodigo[] = [];
  for (const [, filas] of porGrupo) {
    if (filas.length < 2) continue; // solo interesa donde SÍ hay comparación real
    grupos.push(construirFilaComparativo(filas[0].codigoTarifa, filas));
  }
  return grupos;
}

export async function getDashboardRiesgoContractual(
  tipo: TipoComparativo,
  filtros: FiltrosDashboardRiesgo
): Promise<ResultadoDashboardRiesgo> {
  const gruposCrudos = await construirGruposTodosMunicipios(tipo, filtros);
  const grupos = filtrarYRecortarPorEstados(gruposCrudos, filtros.referencia, filtros.umbrales, filtros.estadosFiltro);
  return construirDashboardRiesgo(tipo, grupos, filtros.referencia, filtros.umbrales);
}

// -----------------------------------------------------------------------
// Opciones de filtros nuevos de esta pestaña
// -----------------------------------------------------------------------

export async function getOpcionesTipoContrato(): Promise<OpcionTipoContrato[]> {
  const sql = `
    SELECT DISTINCT tc.tipo_contrato, tc.descripcion
    FROM administrativo.ct_ips_contrato c
    JOIN administrativo.tb_tipo_contrato tc ON tc.tipo_contrato = c.tipo_contrato
    WHERE c.sw_activo = 1 AND c.fecha_anula IS NULL
      AND c.fecha_inicio <= CURRENT_DATE AND c.fecha_terminacion >= CURRENT_DATE
      AND c.numero_contrato != ALL($1)
    ORDER BY tc.descripcion ASC
  `;
  const result = await pool.query(sql, [CONTRATOS_EXCLUIDOS_MIGRACION], `${SOURCE}/opciones-tipo-contrato`);
  const rows: any[] = result?.rows ?? [];
  return rows.map((r) => ({ tipoContrato: Number(r.tipo_contrato), descripcion: (r.descripcion ?? "").trim() }));
}

export async function getOpcionesNivelComplejidad(): Promise<OpcionNivelComplejidad[]> {
  const sql = `
    SELECT DISTINCT ips.nivel_complejidad
    FROM administrativo.ct_ips_contrato c
    JOIN administrativo.ct_ips ips ON ips.ips = c.ips
    WHERE c.sw_activo = 1 AND c.fecha_anula IS NULL
      AND c.fecha_inicio <= CURRENT_DATE AND c.fecha_terminacion >= CURRENT_DATE
      AND c.numero_contrato != ALL($1)
      AND ips.nivel_complejidad IS NOT NULL
    ORDER BY ips.nivel_complejidad ASC
  `;
  const result = await pool.query(sql, [CONTRATOS_EXCLUIDOS_MIGRACION], `${SOURCE}/opciones-nivel-complejidad`);
  const rows: any[] = result?.rows ?? [];
  return rows.map((r) => {
    const nivel = Number(r.nivel_complejidad);
    return { nivelComplejidad: nivel, etiqueta: ETIQUETAS_NIVEL_COMPLEJIDAD[nivel] ?? `Nivel ${nivel}` };
  });
}

export async function getOpcionesPrestadoresRiesgo(tipo: TipoComparativo): Promise<{ ips: number; razonSocial: string; nit: string }[]> {
  const cfg = CONFIG_TIPO_TARIFARIO[tipo];
  const sql = `
    SELECT DISTINCT ips.ips, ips.razon_social, ips.nit
    FROM administrativo.ct_ips_contrato c
    JOIN administrativo.ct_ips ips ON ips.ips = c.ips
    JOIN administrativo.tb_tarifario_propio_detalle d ON d.consecutivo_tarifa = c.${cfg.columnaTarifario}
    WHERE c.sw_activo = 1 AND c.fecha_anula IS NULL
      AND c.fecha_inicio <= CURRENT_DATE AND c.fecha_terminacion >= CURRENT_DATE
      AND c.numero_contrato != ALL($1)
      AND COALESCE(d.sw_activo, 1) = 1
    ORDER BY ips.razon_social ASC
  `;
  const result = await pool.query(sql, [CONTRATOS_EXCLUIDOS_MIGRACION], `${SOURCE}/opciones-prestador-${tipo}`);
  const rows: any[] = result?.rows ?? [];
  return rows.map((r) => ({ ips: Number(r.ips), razonSocial: r.razon_social, nit: r.nit }));
}
