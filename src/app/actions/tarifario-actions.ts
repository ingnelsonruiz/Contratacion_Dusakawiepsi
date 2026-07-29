"use server";

/**
 * Server Actions del Módulo 1 — Tarifario Vigente e Histórico.
 *
 * Fuente de datos: BD real de ARYUWIS (esquema administrativo), SOLO LECTURA.
 * Ningún UPDATE/DELETE/INSERT vive en este archivo. Todas las queries pasan
 * por `pool.query(sql, params, source)` (proxy HTTP, ver src/lib/db.ts).
 *
 * Esquema verificado en vivo (MCP Postgres, solo lectura, 2026-07-28) antes de
 * escribir una sola línea de SQL — ver KnowledgeBase/04-BaseDatos y CLAUDE.md
 * de Proyecto_Dusakawi. No asumir columnas nuevas sin volver a verificar.
 *
 * Cadena de relaciones usada en todo este archivo:
 *   ct_ips_contrato.ips -> ct_ips.ips
 *   ct_ips_contrato.tipo_contrato -> tb_tipo_contrato.tipo_contrato
 *   ct_ips_contrato.modalidad_contrato -> tb_modalidad_contrato.consecutivo_modalidad
 *   ct_ips_contrato.consecutivo_tarifario_{servicio,medicamento,insumo}
 *     -> tb_tarifario_propio_encabezado.consecutivo_tarifario
 *   tb_tarifario_propio_detalle.consecutivo_tarifa
 *     -> tb_tarifario_propio_encabezado.consecutivo_tarifario
 *   tb_tarifario_propio_detalle.consecutivo_cup        -> tb_cup.cup
 *   tb_tarifario_propio_detalle.consecutivo_medicamento -> tb_medicamento.medicamento
 *   tb_tarifario_propio_detalle.consecutivo_insumo      -> tb_insumo.insumo
 *   tb_medicamento.marca_medicamento         -> tb_marca_medicamento.marca_medicamento
 *   tb_tarifario_propio_detalle.consecutivo_unidad -> tb_unidad_medida.consecutivo_unidad_medida
 *
 * Semántica de pestañas dentro de un mismo tarifario "servicio" (verificada
 * contra datos reales, no asumida):
 *   - Procedimientos: consecutivo_cup IS NOT NULL AND sw_paquete = 0
 *   - Otros:          consecutivo_cup IS NULL AND consecutivo_paquete IS NULL AND sw_paquete = 0
 *                      (ítems negociados sin CUPS estándar, p. ej. medicina
 *                      tradicional indígena — ver CLAUDE.md sección de hallazgos)
 *   - Paquetes:       sw_paquete = 1, cruzando servicio+medicamento+insumo (UNION ALL)
 */

import { pool } from "@/lib/db";
import { resolverValorFinal, esContratoVigente } from "@/lib/negociacion/formato";
import { CONTRATOS_EXCLUIDOS_MIGRACION } from "@/lib/negociacion/constantes";
import type {
  ContratoListado,
  ContratoDetalle,
  FiltrosContrato,
  ParametrosBusquedaTarifario,
  ResultadoPaginado,
  ConteosTarifario,
  OpcionFiltro,
  TarifaServicioRow,
  TarifaMedicamentoRow,
  TarifaInsumoRow,
  TarifaPaqueteRow,
} from "@/types/tarifarios";

const SOURCE = "tarifarios";

// -----------------------------------------------------------------------
// Listado de contratos
// -----------------------------------------------------------------------

export async function listContratos(
  filtros: FiltrosContrato
): Promise<ResultadoPaginado<ContratoListado>> {
  const condiciones: string[] = ["c.sw_activo = 1", "c.fecha_anula IS NULL"];
  const params: unknown[] = [];

  params.push(CONTRATOS_EXCLUIDOS_MIGRACION);
  condiciones.push(`c.numero_contrato != ALL($${params.length})`);

  if (filtros.busqueda?.trim()) {
    params.push(`%${filtros.busqueda.trim()}%`);
    const idx = params.length;
    condiciones.push(
      `(c.numero_contrato ILIKE $${idx} OR ips.razon_social ILIKE $${idx} OR ips.nit ILIKE $${idx})`
    );
  }

  if (filtros.estado !== undefined) {
    params.push(filtros.estado);
    condiciones.push(`c.estado = $${params.length}`);
  }

  if (filtros.tipoContrato !== undefined) {
    params.push(filtros.tipoContrato);
    condiciones.push(`c.tipo_contrato = $${params.length}`);
  }

  if (filtros.vigencia === "vigente") {
    condiciones.push("c.fecha_inicio <= CURRENT_DATE AND c.fecha_terminacion >= CURRENT_DATE");
  } else if (filtros.vigencia === "vencido") {
    condiciones.push("c.fecha_terminacion < CURRENT_DATE");
  }

  const whereSql = condiciones.length ? `WHERE ${condiciones.join(" AND ")}` : "";

  const pageSize = Math.min(Math.max(filtros.pageSize || 25, 1), 200);
  const page = Math.max(filtros.page || 1, 1);
  const offset = (page - 1) * pageSize;

  params.push(pageSize);
  const limitIdx = params.length;
  params.push(offset);
  const offsetIdx = params.length;

  const sql = `
    SELECT
      c.consecutivo_contrato,
      c.numero_contrato,
      c.ips,
      ips.razon_social,
      ips.nit,
      ips.codigo_habilitacion,
      c.fecha_inicio,
      c.fecha_terminacion,
      c.estado,
      c.valor_contrato,
      c.tipo_contrato,
      tc.descripcion AS tipo_contrato_descripcion,
      c.modalidad_contrato,
      mc.descripcion AS modalidad_descripcion,
      (c.consecutivo_tarifario_servicio IS NOT NULL) AS tiene_servicios,
      (c.consecutivo_tarifario_medicamento IS NOT NULL) AS tiene_medicamentos,
      (c.consecutivo_tarifario_insumo IS NOT NULL) AS tiene_insumos,
      COUNT(*) OVER() AS total_count
    FROM administrativo.ct_ips_contrato c
    JOIN administrativo.ct_ips ips ON ips.ips = c.ips
    LEFT JOIN administrativo.tb_tipo_contrato tc ON tc.tipo_contrato = c.tipo_contrato
    LEFT JOIN administrativo.tb_modalidad_contrato mc ON mc.consecutivo_modalidad = c.modalidad_contrato
    ${whereSql}
    ORDER BY c.fecha_terminacion DESC, ips.razon_social ASC
    LIMIT $${limitIdx} OFFSET $${offsetIdx}
  `;

  const result = await pool.query(sql, params, `${SOURCE}/listar-contratos`);
  const rows: any[] = result?.rows ?? [];
  const total = rows.length > 0 ? Number(rows[0].total_count) : 0;

  const filas: ContratoListado[] = rows.map((r) => ({
    consecutivoContrato: Number(r.consecutivo_contrato),
    numeroContrato: r.numero_contrato,
    ips: Number(r.ips),
    razonSocial: r.razon_social,
    nit: r.nit,
    codigoHabilitacion: r.codigo_habilitacion,
    fechaInicio: r.fecha_inicio,
    fechaTerminacion: r.fecha_terminacion,
    estado: Number(r.estado),
    valorContrato: Number(r.valor_contrato ?? 0),
    tipoContrato: r.tipo_contrato !== null ? Number(r.tipo_contrato) : null,
    tipoContratoDescripcion: r.tipo_contrato_descripcion,
    modalidadContrato: r.modalidad_contrato !== null ? Number(r.modalidad_contrato) : null,
    modalidadDescripcion: r.modalidad_descripcion,
    tieneServicios: Boolean(r.tiene_servicios),
    tieneMedicamentos: Boolean(r.tiene_medicamentos),
    tieneInsumos: Boolean(r.tiene_insumos),
    vigente: esContratoVigente(r.fecha_inicio, r.fecha_terminacion),
  }));

  return {
    filas,
    total,
    page,
    pageSize,
    totalPaginas: Math.max(1, Math.ceil(total / pageSize)),
  };
}

// -----------------------------------------------------------------------
// Detalle de contrato (encabezado de la página de detalle)
// -----------------------------------------------------------------------

export async function getContratoDetalle(consecutivoContrato: number): Promise<ContratoDetalle | null> {
  const sql = `
    SELECT
      c.consecutivo_contrato,
      c.numero_contrato,
      c.ips,
      ips.razon_social,
      ips.nit,
      ips.codigo_habilitacion,
      c.fecha_inicio,
      c.fecha_terminacion,
      c.fecha_suscripcion,
      c.estado,
      c.valor_contrato,
      c.valor_mes,
      c.porcentaje_upc,
      c.valor_percapita,
      c.numero_afiliados,
      c.nombre_responsable_contratacion,
      c.observacion,
      c.monto_ejecutado,
      c.monto_acumulado_autorizaciones,
      c.tipo_contrato,
      tc.descripcion AS tipo_contrato_descripcion,
      c.modalidad_contrato,
      mc.descripcion AS modalidad_descripcion,
      c.consecutivo_tarifario_servicio,
      c.consecutivo_tarifario_medicamento,
      c.consecutivo_tarifario_insumo
    FROM administrativo.ct_ips_contrato c
    JOIN administrativo.ct_ips ips ON ips.ips = c.ips
    LEFT JOIN administrativo.tb_tipo_contrato tc ON tc.tipo_contrato = c.tipo_contrato
    LEFT JOIN administrativo.tb_modalidad_contrato mc ON mc.consecutivo_modalidad = c.modalidad_contrato
    WHERE c.consecutivo_contrato = $1
    LIMIT 1
  `;

  const result = await pool.query(sql, [consecutivoContrato], `${SOURCE}/detalle-contrato`);
  const r = result?.rows?.[0];
  if (!r) return null;

  const consecutivoTarifarioServicio = r.consecutivo_tarifario_servicio !== null ? Number(r.consecutivo_tarifario_servicio) : null;
  const consecutivoTarifarioMedicamento = r.consecutivo_tarifario_medicamento !== null ? Number(r.consecutivo_tarifario_medicamento) : null;
  const consecutivoTarifarioInsumo = r.consecutivo_tarifario_insumo !== null ? Number(r.consecutivo_tarifario_insumo) : null;

  return {
    consecutivoContrato: Number(r.consecutivo_contrato),
    numeroContrato: r.numero_contrato,
    ips: Number(r.ips),
    razonSocial: r.razon_social,
    nit: r.nit,
    codigoHabilitacion: r.codigo_habilitacion,
    fechaInicio: r.fecha_inicio,
    fechaTerminacion: r.fecha_terminacion,
    fechaSuscripcion: r.fecha_suscripcion,
    estado: Number(r.estado),
    valorContrato: Number(r.valor_contrato ?? 0),
    valorMes: Number(r.valor_mes ?? 0),
    porcentajeUpc: Number(r.porcentaje_upc ?? 0),
    valorPercapita: r.valor_percapita !== null ? Number(r.valor_percapita) : null,
    numeroAfiliados: Number(r.numero_afiliados ?? 0),
    nombreResponsableContratacion: r.nombre_responsable_contratacion,
    observacion: r.observacion,
    montoEjecutado: Number(r.monto_ejecutado ?? 0),
    montoAcumuladoAutorizaciones: Number(r.monto_acumulado_autorizaciones ?? 0),
    tipoContrato: r.tipo_contrato !== null ? Number(r.tipo_contrato) : null,
    tipoContratoDescripcion: r.tipo_contrato_descripcion,
    modalidadContrato: r.modalidad_contrato !== null ? Number(r.modalidad_contrato) : null,
    modalidadDescripcion: r.modalidad_descripcion,
    tieneServicios: consecutivoTarifarioServicio !== null,
    tieneMedicamentos: consecutivoTarifarioMedicamento !== null,
    tieneInsumos: consecutivoTarifarioInsumo !== null,
    vigente: esContratoVigente(r.fecha_inicio, r.fecha_terminacion),
    consecutivoTarifarioServicio,
    consecutivoTarifarioMedicamento,
    consecutivoTarifarioInsumo,
  };
}

// -----------------------------------------------------------------------
// Conteos por pestaña — decide cuáles mostrar ("si existen"/"si aplica")
// -----------------------------------------------------------------------

export async function getConteosTarifario(consecutivoContrato: number): Promise<ConteosTarifario> {
  const contrato = await getContratoDetalle(consecutivoContrato);
  if (!contrato) {
    return { servicios: 0, otros: 0, medicamentos: 0, insumos: 0, paquetes: 0 };
  }

  const { consecutivoTarifarioServicio, consecutivoTarifarioMedicamento, consecutivoTarifarioInsumo } = contrato;

  // IMPORTANTE (hallazgo 2026-07-28, verificado contra toda la BD, no solo
  // este contrato): la FK d.consecutivo_cup está SIEMPRE NULL en los
  // tarifarios de tipo "servicio" (114.226/114.226 filas revisadas) — no es
  // un problema de este contrato en particular, es característico de cómo
  // ARYUWIS carga estos tarifarios (probablemente vía el importador masivo
  // documentado en CLAUDE.md §9, que nunca resuelve esa FK). Un CUPS real SÍ
  // se puede identificar cruzando d.codigo_tarifa contra tb_cup.codigo_interno
  // (confirmado: 81.086 filas recuperables así, con descripciones idénticas).
  // Por eso "Procedimientos" se clasifica por ese cruce de código, no por la FK.
  const sql = `
    SELECT
      COALESCE(SUM(CASE WHEN d.consecutivo_tarifa = $1 AND cup.cup IS NOT NULL AND COALESCE(d.sw_paquete,0) = 0 THEN 1 ELSE 0 END), 0) AS servicios,
      COALESCE(SUM(CASE WHEN d.consecutivo_tarifa = $1 AND cup.cup IS NULL AND d.consecutivo_paquete IS NULL AND COALESCE(d.sw_paquete,0) = 0 THEN 1 ELSE 0 END), 0) AS otros,
      COALESCE(SUM(CASE WHEN d.consecutivo_tarifa = $2 AND COALESCE(d.sw_paquete,0) = 0 THEN 1 ELSE 0 END), 0) AS medicamentos,
      COALESCE(SUM(CASE WHEN d.consecutivo_tarifa = $3 AND COALESCE(d.sw_paquete,0) = 0 THEN 1 ELSE 0 END), 0) AS insumos,
      COALESCE(SUM(CASE WHEN d.consecutivo_tarifa IN ($1, $2, $3) AND COALESCE(d.sw_paquete,0) = 1 THEN 1 ELSE 0 END), 0) AS paquetes
    FROM administrativo.tb_tarifario_propio_detalle d
    LEFT JOIN administrativo.tb_cup cup ON cup.codigo_interno = d.codigo_tarifa
    WHERE d.consecutivo_tarifa IN ($1, $2, $3) AND COALESCE(d.sw_activo, 1) = 1
  `;

  const result = await pool.query(
    sql,
    [consecutivoTarifarioServicio ?? -1, consecutivoTarifarioMedicamento ?? -1, consecutivoTarifarioInsumo ?? -1],
    `${SOURCE}/conteos`
  );
  const r = result?.rows?.[0] ?? {};

  return {
    servicios: Number(r.servicios ?? 0),
    otros: Number(r.otros ?? 0),
    medicamentos: Number(r.medicamentos ?? 0),
    insumos: Number(r.insumos ?? 0),
    paquetes: Number(r.paquetes ?? 0),
  };
}

// -----------------------------------------------------------------------
// Helper interno: construye una fila TarifaServicioRow/común desde el row crudo
// -----------------------------------------------------------------------

function mapFilaServicio(r: any): TarifaServicioRow {
  const valorBase = Number(r.valor_base ?? 0);
  const valorPactado = Number(r.valor_pactado ?? 0);
  const porcentajeTarifa = Number(r.porcentaje_tarifa ?? 0);
  const valor = Number(r.valor ?? r.valor_servicio ?? 0);

  return {
    consecutivoTarifa: Number(r.consecutivo_tarifa),
    secuencia: Number(r.secuencia ?? 0),
    codigoTarifa: r.codigo_tarifa,
    codigoPropio: r.codigo_propio,
    descripcion: r.descripcion,
    valor,
    valorBase,
    valorPactado,
    valorRegulado: Number(r.valor_regulado ?? 0),
    porcentajeTarifa,
    valorFinal: resolverValorFinal({ valor, valorBase, valorPactado, porcentajeTarifa }),
    swPaquete: Number(r.sw_paquete ?? 0) === 1,
    swQuirurgico: Number(r.sw_quirurgico ?? 0) === 1,
    swAmbulatorio: Number(r.sw_ambulatorio ?? 0) === 1,
    swHospitalario: Number(r.sw_hospitalario ?? 0) === 1,
    swUrgencia: Number(r.sw_urgencia ?? 0) === 1,
    consecutivoCup: r.consecutivo_cup !== null && r.consecutivo_cup !== undefined ? Number(r.consecutivo_cup) : null,
    cupCodigoInterno: r.cup_codigo_interno ?? null,
    cupDescripcion: r.cup_descripcion ?? null,
  };
}

function construirPaginacion(params: ParametrosBusquedaTarifario): { pageSize: number; page: number; offset: number } {
  const pageSize = Math.min(Math.max(params.pageSize || 50, 1), 500);
  const page = Math.max(params.page || 1, 1);
  return { pageSize, page, offset: (page - 1) * pageSize };
}

// -----------------------------------------------------------------------
// Procedimientos (CUPS)
// -----------------------------------------------------------------------

export async function getTarifarioServicios(
  consecutivoContrato: number,
  params: ParametrosBusquedaTarifario
): Promise<ResultadoPaginado<TarifaServicioRow>> {
  const contrato = await getContratoDetalle(consecutivoContrato);
  if (!contrato?.consecutivoTarifarioServicio) {
    return { filas: [], total: 0, page: 1, pageSize: params.pageSize || 50, totalPaginas: 1 };
  }

  const { pageSize, page, offset } = construirPaginacion(params);
  const sqlParams: unknown[] = [contrato.consecutivoTarifarioServicio];
  let condicionBusqueda = "";

  if (params.busqueda?.trim()) {
    sqlParams.push(`%${params.busqueda.trim()}%`);
    const idx = sqlParams.length;
    condicionBusqueda = `AND (d.codigo_propio ILIKE $${idx} OR d.descripcion ILIKE $${idx} OR cup.codigo_interno ILIKE $${idx})`;
  }

  sqlParams.push(pageSize);
  const limitIdx = sqlParams.length;
  sqlParams.push(offset);
  const offsetIdx = sqlParams.length;

  // Clasificación por código (ver comentario de getConteosTarifario): un
  // Procedimiento real es una fila cuyo codigo_tarifa coincide con
  // tb_cup.codigo_interno — la FK d.consecutivo_cup no sirve, está siempre
  // NULL en este tipo de tarifario.
  const sql = `
    SELECT
      d.consecutivo_tarifa, d.secuencia, d.codigo_tarifa, d.codigo_propio, d.descripcion,
      d.valor, d.valor_servicio, d.valor_base, d.valor_pactado, d.valor_regulado, d.porcentaje_tarifa,
      d.sw_paquete, d.sw_quirurgico, d.sw_ambulatorio, d.sw_hospitalario, d.sw_urgencia,
      d.consecutivo_cup, cup.codigo_interno AS cup_codigo_interno, cup.descripcion AS cup_descripcion,
      COUNT(*) OVER() AS total_count
    FROM administrativo.tb_tarifario_propio_detalle d
    JOIN administrativo.tb_cup cup ON cup.codigo_interno = d.codigo_tarifa
    WHERE d.consecutivo_tarifa = $1
      AND COALESCE(d.sw_paquete, 0) = 0
      AND COALESCE(d.sw_activo, 1) = 1
      ${condicionBusqueda}
    ORDER BY d.codigo_tarifa ASC
    LIMIT $${limitIdx} OFFSET $${offsetIdx}
  `;

  const result = await pool.query(sql, sqlParams, `${SOURCE}/servicios`);
  const rows: any[] = result?.rows ?? [];
  const total = rows.length > 0 ? Number(rows[0].total_count) : 0;

  return {
    filas: rows.map(mapFilaServicio),
    total,
    page,
    pageSize,
    totalPaginas: Math.max(1, Math.ceil(total / pageSize)),
  };
}

// -----------------------------------------------------------------------
// Otros (mismo tarifario de servicios, sin CUPS ni paquete)
// -----------------------------------------------------------------------

export async function getTarifarioOtros(
  consecutivoContrato: number,
  params: ParametrosBusquedaTarifario
): Promise<ResultadoPaginado<TarifaServicioRow>> {
  const contrato = await getContratoDetalle(consecutivoContrato);
  if (!contrato?.consecutivoTarifarioServicio) {
    return { filas: [], total: 0, page: 1, pageSize: params.pageSize || 50, totalPaginas: 1 };
  }

  const { pageSize, page, offset } = construirPaginacion(params);
  const sqlParams: unknown[] = [contrato.consecutivoTarifarioServicio];
  let condicionBusqueda = "";

  if (params.busqueda?.trim()) {
    sqlParams.push(`%${params.busqueda.trim()}%`);
    condicionBusqueda = `AND (d.codigo_propio ILIKE $${sqlParams.length} OR d.descripcion ILIKE $${sqlParams.length})`;
  }

  sqlParams.push(pageSize);
  const limitIdx = sqlParams.length;
  sqlParams.push(offset);
  const offsetIdx = sqlParams.length;

  // "Otro" = no coincide con ningún CUPS real (ver comentario en
  // getConteosTarifario sobre por qué no se usa la FK d.consecutivo_cup).
  const sql = `
    SELECT
      d.consecutivo_tarifa, d.secuencia, d.codigo_tarifa, d.codigo_propio, d.descripcion,
      d.valor, d.valor_servicio, d.valor_base, d.valor_pactado, d.valor_regulado, d.porcentaje_tarifa,
      d.sw_paquete, d.sw_quirurgico, d.sw_ambulatorio, d.sw_hospitalario, d.sw_urgencia,
      d.consecutivo_cup,
      COUNT(*) OVER() AS total_count
    FROM administrativo.tb_tarifario_propio_detalle d
    LEFT JOIN administrativo.tb_cup cup ON cup.codigo_interno = d.codigo_tarifa
    WHERE d.consecutivo_tarifa = $1
      AND cup.cup IS NULL
      AND d.consecutivo_paquete IS NULL
      AND COALESCE(d.sw_paquete, 0) = 0
      AND COALESCE(d.sw_activo, 1) = 1
      ${condicionBusqueda}
    ORDER BY d.codigo_tarifa ASC
    LIMIT $${limitIdx} OFFSET $${offsetIdx}
  `;

  const result = await pool.query(sql, sqlParams, `${SOURCE}/otros`);
  const rows: any[] = result?.rows ?? [];
  const total = rows.length > 0 ? Number(rows[0].total_count) : 0;

  return {
    filas: rows.map(mapFilaServicio),
    total,
    page,
    pageSize,
    totalPaginas: Math.max(1, Math.ceil(total / pageSize)),
  };
}

// -----------------------------------------------------------------------
// Medicamentos (CUM)
// -----------------------------------------------------------------------

export async function getTarifarioMedicamentos(
  consecutivoContrato: number,
  params: ParametrosBusquedaTarifario
): Promise<ResultadoPaginado<TarifaMedicamentoRow>> {
  const contrato = await getContratoDetalle(consecutivoContrato);
  if (!contrato?.consecutivoTarifarioMedicamento) {
    return { filas: [], total: 0, page: 1, pageSize: params.pageSize || 50, totalPaginas: 1 };
  }

  const { pageSize, page, offset } = construirPaginacion(params);
  const sqlParams: unknown[] = [contrato.consecutivoTarifarioMedicamento];
  let condicionBusqueda = "";

  if (params.busqueda?.trim()) {
    sqlParams.push(`%${params.busqueda.trim()}%`);
    const idx = sqlParams.length;
    condicionBusqueda = `AND (d.codigo_propio ILIKE $${idx} OR d.descripcion ILIKE $${idx} OR med.codigo_interno ILIKE $${idx} OR med.principio_activo ILIKE $${idx} OR marca.descripcion ILIKE $${idx})`;
  }

  sqlParams.push(pageSize);
  const limitIdx = sqlParams.length;
  sqlParams.push(offset);
  const offsetIdx = sqlParams.length;

  // Hallazgo 2026-07-28: `d.consecutivo_medicamento` NO es confiable — en
  // muchos tarifarios (ej. contrato 20001_132EV / tarifario 50002558)
  // aparece POBLADA pero apuntando al MISMO medicamento equivocado en miles
  // de filas con códigos y precios distintos (verificado: 1570 filas, un
  // solo `consecutivo_medicamento` = LOSARTAN, cuando cada fila es en
  // realidad un medicamento distinto). Sistemáticamente, de 977.315 filas de
  // tarifarios de medicamentos en toda la BD, solo 1 tenía la FK coincidente
  // con su propio código — el resto (FK nula o FK apuntando a otro
  // registro) se recupera correctamente cruzando por código contra
  // tb_medicamento.codigo_interno (mismo patrón que Procedimientos/Insumos).
  const sql = `
    SELECT
      d.consecutivo_tarifa, d.secuencia, d.codigo_tarifa, d.codigo_propio, d.descripcion,
      d.valor, d.valor_servicio, d.valor_base, d.valor_pactado, d.valor_regulado, d.porcentaje_tarifa,
      d.sw_paquete, d.consecutivo_medicamento,
      med.codigo_interno AS cum, med.descripcion AS nombre_comercial, med.principio_activo,
      med.forma_farmaceutica, med.concentracion,
      marca.descripcion AS laboratorio,
      um.descripcion AS unidad,
      COUNT(*) OVER() AS total_count
    FROM administrativo.tb_tarifario_propio_detalle d
    LEFT JOIN administrativo.tb_medicamento med ON med.codigo_interno = d.codigo_tarifa
    LEFT JOIN administrativo.tb_marca_medicamento marca ON marca.marca_medicamento = med.marca_medicamento
    LEFT JOIN administrativo.tb_unidad_medida um ON um.consecutivo_unidad_medida = d.consecutivo_unidad
    WHERE d.consecutivo_tarifa = $1
      AND COALESCE(d.sw_paquete, 0) = 0
      AND COALESCE(d.sw_activo, 1) = 1
      ${condicionBusqueda}
    ORDER BY d.codigo_tarifa ASC
    LIMIT $${limitIdx} OFFSET $${offsetIdx}
  `;

  const result = await pool.query(sql, sqlParams, `${SOURCE}/medicamentos`);
  const rows: any[] = result?.rows ?? [];
  const total = rows.length > 0 ? Number(rows[0].total_count) : 0;

  const filas: TarifaMedicamentoRow[] = rows.map((r) => {
    const valorBase = Number(r.valor_base ?? 0);
    const valorPactado = Number(r.valor_pactado ?? 0);
    const porcentajeTarifa = Number(r.porcentaje_tarifa ?? 0);
    const valor = Number(r.valor ?? r.valor_servicio ?? 0);
    const presentacion = [r.forma_farmaceutica, r.concentracion].filter(Boolean).join(" ") || null;

    return {
      consecutivoTarifa: Number(r.consecutivo_tarifa),
      secuencia: Number(r.secuencia ?? 0),
      codigoTarifa: r.codigo_tarifa,
      codigoPropio: r.codigo_propio,
      descripcion: r.descripcion,
      valor,
      valorBase,
      valorPactado,
      valorRegulado: Number(r.valor_regulado ?? 0),
      porcentajeTarifa,
      valorFinal: resolverValorFinal({ valor, valorBase, valorPactado, porcentajeTarifa }),
      swPaquete: Number(r.sw_paquete ?? 0) === 1,
      consecutivoMedicamento: r.consecutivo_medicamento !== null ? Number(r.consecutivo_medicamento) : null,
      cum: r.cum ?? null,
      nombreComercial: r.nombre_comercial ?? null,
      principioActivo: r.principio_activo ?? null,
      presentacion,
      laboratorio: r.laboratorio ?? null,
      unidad: r.unidad ?? null,
    };
  });

  return { filas, total, page, pageSize, totalPaginas: Math.max(1, Math.ceil(total / pageSize)) };
}

// -----------------------------------------------------------------------
// Insumos
// -----------------------------------------------------------------------

export async function getTarifarioInsumos(
  consecutivoContrato: number,
  params: ParametrosBusquedaTarifario
): Promise<ResultadoPaginado<TarifaInsumoRow>> {
  const contrato = await getContratoDetalle(consecutivoContrato);
  if (!contrato?.consecutivoTarifarioInsumo) {
    return { filas: [], total: 0, page: 1, pageSize: params.pageSize || 50, totalPaginas: 1 };
  }

  const { pageSize, page, offset } = construirPaginacion(params);
  const sqlParams: unknown[] = [contrato.consecutivoTarifarioInsumo];
  let condicionBusqueda = "";

  if (params.busqueda?.trim()) {
    sqlParams.push(`%${params.busqueda.trim()}%`);
    const idx = sqlParams.length;
    condicionBusqueda = `AND (d.codigo_propio ILIKE $${idx} OR d.descripcion ILIKE $${idx} OR ins.codigo_interno ILIKE $${idx})`;
  }

  sqlParams.push(pageSize);
  const limitIdx = sqlParams.length;
  sqlParams.push(offset);
  const offsetIdx = sqlParams.length;

  // Igual que en Procedimientos: d.consecutivo_insumo está SIEMPRE NULL en
  // toda la BD (verificado 2026-07-28, 23.000/23.000 filas) — se recupera el
  // insumo real cruzando por código contra tb_insumo.codigo_interno.
  const sql = `
    SELECT
      d.consecutivo_tarifa, d.secuencia, d.codigo_tarifa, d.codigo_propio, d.descripcion,
      d.valor, d.valor_servicio, d.valor_base, d.valor_pactado, d.valor_regulado, d.porcentaje_tarifa,
      d.sw_paquete, d.consecutivo_insumo,
      ins.codigo_interno AS insumo_codigo_interno, ins.descripcion AS insumo_descripcion,
      um.descripcion AS unidad,
      COUNT(*) OVER() AS total_count
    FROM administrativo.tb_tarifario_propio_detalle d
    LEFT JOIN administrativo.tb_insumo ins ON ins.codigo_interno = d.codigo_tarifa
    LEFT JOIN administrativo.tb_unidad_medida um ON um.consecutivo_unidad_medida = d.consecutivo_unidad
    WHERE d.consecutivo_tarifa = $1
      AND COALESCE(d.sw_paquete, 0) = 0
      AND COALESCE(d.sw_activo, 1) = 1
      ${condicionBusqueda}
    ORDER BY d.codigo_tarifa ASC
    LIMIT $${limitIdx} OFFSET $${offsetIdx}
  `;

  const result = await pool.query(sql, sqlParams, `${SOURCE}/insumos`);
  const rows: any[] = result?.rows ?? [];
  const total = rows.length > 0 ? Number(rows[0].total_count) : 0;

  const filas: TarifaInsumoRow[] = rows.map((r) => {
    const valorBase = Number(r.valor_base ?? 0);
    const valorPactado = Number(r.valor_pactado ?? 0);
    const porcentajeTarifa = Number(r.porcentaje_tarifa ?? 0);
    const valor = Number(r.valor ?? r.valor_servicio ?? 0);

    return {
      consecutivoTarifa: Number(r.consecutivo_tarifa),
      secuencia: Number(r.secuencia ?? 0),
      codigoTarifa: r.codigo_tarifa,
      codigoPropio: r.codigo_propio,
      descripcion: r.descripcion,
      valor,
      valorBase,
      valorPactado,
      valorRegulado: Number(r.valor_regulado ?? 0),
      porcentajeTarifa,
      valorFinal: resolverValorFinal({ valor, valorBase, valorPactado, porcentajeTarifa }),
      swPaquete: Number(r.sw_paquete ?? 0) === 1,
      consecutivoInsumo: r.consecutivo_insumo !== null ? Number(r.consecutivo_insumo) : null,
      insumoCodigoInterno: r.insumo_codigo_interno ?? null,
      insumoDescripcion: r.insumo_descripcion ?? null,
      unidad: r.unidad ?? null,
    };
  });

  return { filas, total, page, pageSize, totalPaginas: Math.max(1, Math.ceil(total / pageSize)) };
}

// -----------------------------------------------------------------------
// Paquetes (cruce de los 3 tarifarios del contrato)
// -----------------------------------------------------------------------

export async function getTarifarioPaquetes(
  consecutivoContrato: number,
  params: ParametrosBusquedaTarifario
): Promise<ResultadoPaginado<TarifaPaqueteRow>> {
  const contrato = await getContratoDetalle(consecutivoContrato);
  if (!contrato) {
    return { filas: [], total: 0, page: 1, pageSize: params.pageSize || 50, totalPaginas: 1 };
  }

  const { pageSize, page, offset } = construirPaginacion(params);
  const tarifarios = [
    { id: contrato.consecutivoTarifarioServicio, origen: "servicios" as const },
    { id: contrato.consecutivoTarifarioMedicamento, origen: "medicamentos" as const },
    { id: contrato.consecutivoTarifarioInsumo, origen: "insumos" as const },
  ].filter((t) => t.id !== null) as { id: number; origen: "servicios" | "medicamentos" | "insumos" }[];

  if (tarifarios.length === 0) {
    return { filas: [], total: 0, page, pageSize, totalPaginas: 1 };
  }

  const uniones = tarifarios
    .map(
      (t, i) => `SELECT '${t.origen}' AS origen, d.* FROM administrativo.tb_tarifario_propio_detalle d WHERE d.consecutivo_tarifa = $${i + 1}`
    )
    .join(" UNION ALL ");

  const sqlParams: unknown[] = tarifarios.map((t) => t.id);
  let condicionBusqueda = "";
  if (params.busqueda?.trim()) {
    sqlParams.push(`%${params.busqueda.trim()}%`);
    condicionBusqueda = `AND (base.codigo_propio ILIKE $${sqlParams.length} OR base.descripcion ILIKE $${sqlParams.length})`;
  }
  sqlParams.push(pageSize);
  const limitIdx = sqlParams.length;
  sqlParams.push(offset);
  const offsetIdx = sqlParams.length;

  const sql = `
    WITH base AS (${uniones})
    SELECT
      base.origen, base.consecutivo_tarifa, base.codigo_tarifa, base.codigo_propio,
      base.codigo_paquete, base.descripcion, base.valor, base.valor_servicio,
      base.valor_base, base.valor_pactado, base.porcentaje_tarifa,
      COUNT(*) OVER() AS total_count
    FROM base
    WHERE COALESCE(base.sw_paquete, 0) = 1 AND COALESCE(base.sw_activo, 1) = 1
      ${condicionBusqueda}
    ORDER BY base.codigo_tarifa ASC
    LIMIT $${limitIdx} OFFSET $${offsetIdx}
  `;

  const result = await pool.query(sql, sqlParams, `${SOURCE}/paquetes`);
  const rows: any[] = result?.rows ?? [];
  const total = rows.length > 0 ? Number(rows[0].total_count) : 0;

  const filas: TarifaPaqueteRow[] = rows.map((r) => {
    const valorBase = Number(r.valor_base ?? 0);
    const valorPactado = Number(r.valor_pactado ?? 0);
    const porcentajeTarifa = Number(r.porcentaje_tarifa ?? 0);
    const valor = Number(r.valor ?? r.valor_servicio ?? 0);

    return {
      origen: r.origen,
      consecutivoTarifa: Number(r.consecutivo_tarifa),
      codigoTarifa: r.codigo_tarifa,
      codigoPropio: r.codigo_propio,
      codigoPaquete: r.codigo_paquete ?? null,
      descripcion: r.descripcion,
      valor,
      valorFinal: resolverValorFinal({ valor, valorBase, valorPactado, porcentajeTarifa }),
    };
  });

  return { filas, total, page, pageSize, totalPaginas: Math.max(1, Math.ceil(total / pageSize)) };
}

// -----------------------------------------------------------------------
// Opciones para filtros del listado (tipo de contrato)
// -----------------------------------------------------------------------

export async function getOpcionesFiltro(): Promise<{
  tiposContrato: OpcionFiltro[];
}> {
  // El filtro por código `estado` se retiró de la UI el 2026-07-28 (el
  // usuario no encontraba claro un selector de "Estado 3/8/10" sin
  // significado de negocio — no existe tabla maestra confiable para ese
  // código, ver hallazgo en Tablas.md de la KnowledgeBase). El código sigue
  // disponible como columna en `ContratoListado`, solo no hay selector.
  const tiposResult = await pool.query(
    `SELECT tc.tipo_contrato, tc.descripcion, COUNT(c.consecutivo_contrato) AS cantidad
     FROM administrativo.tb_tipo_contrato tc
     LEFT JOIN administrativo.ct_ips_contrato c
       ON c.tipo_contrato = tc.tipo_contrato AND c.sw_activo = 1 AND c.fecha_anula IS NULL
     GROUP BY tc.tipo_contrato, tc.descripcion
     HAVING COUNT(c.consecutivo_contrato) > 0
     ORDER BY tc.descripcion`,
    [],
    `${SOURCE}/opciones-tipo-contrato`
  );

  const tiposContrato: OpcionFiltro[] = (tiposResult?.rows ?? []).map((r: any) => ({
    valor: String(r.tipo_contrato),
    etiqueta: r.descripcion,
    cantidad: Number(r.cantidad),
  }));

  return { tiposContrato };
}
