"use server";

/**
 * Server Actions del módulo "Análisis de Propuesta del Prestador" — nueva
 * tarjeta del dashboard (pedida por el usuario 2026-07-31), en la misma
 * línea que Perfil Competitivo del Prestador / Top Impacto Económico: no
 * estaba en los 8 módulos originales de docs/ARQUITECTURA.md, pero reutiliza
 * la infraestructura ya validada del Módulo 2 (Comparativo entre
 * Prestadores) — mismo cruce por código, mismo `resolverValorFinal`, mismo
 * `dedupMejorPrecio`, mismo semáforo con dirección.
 *
 * Flujo: el usuario sube un archivo (CSV/TXT/XLSX) con columnas Código +
 * Precio Ofertado y elige un municipio. Por cada código del archivo:
 *   1. Se clasifica contra los 3 maestros (servicios/medicamentos/insumos)
 *      reutilizando `clasificarCodigos` de historico-prestador-actions.ts —
 *      el cruce SIEMPRE es por código, nunca por la FK consecutivo_cup/
 *      _medicamento/_insumo (no confiable, ver KnowledgeBase/04-BaseDatos/
 *      Tablas.md).
 *   2. Se busca, en ESE municipio, qué prestadores YA tienen ese código
 *      contratado (join acotado por `d.codigo_tarifa = ANY(...)` — solo los
 *      códigos del archivo, no todo el tarifario del municipio, a
 *      diferencia de `construirGruposMunicipio` del Módulo 2).
 *   3. Se compara el precio ofertado contra la mediana/promedio de esos
 *      prestadores (src/lib/negociacion/analisis-propuesta.ts).
 *
 * A diferencia de `construirGruposMunicipio`/`construirGruposTodosMunicipios`
 * (Módulo 2 y Dashboard de Riesgo), aquí NO se exige un mínimo de 2
 * prestadores por código — con que exista 1 solo prestador YA contratado en
 * el municipio, ya hay una referencia real de mercado para negociar. La
 * regla de "≥2 prestadores" de esos otros módulos existe para comparar
 * prestadores ENTRE SÍ (necesita al menos 2 para que "comparar" tenga
 * sentido); aquí se compara una propuesta EXTERNA contra el mercado ya
 * existente, así que 1 solo prestador de referencia ya es información útil.
 *
 * El archivo subido NUNCA se persiste — se procesa en memoria y se descarta;
 * no se escribe ninguna tabla nueva (a diferencia del Módulo 5 — Simulador
 * de Escenarios, planificado con tablas propias de seguimiento de rondas).
 */

import { pool } from "@/lib/db";
import { resolverValorFinal } from "@/lib/negociacion/formato";
import { dedupMejorPrecio } from "@/lib/negociacion/comparativo";
import { construirFilaEvaluacion, construirResumenEvaluacion, type PrestadorMercadoPropuesta } from "@/lib/negociacion/analisis-propuesta";
import { parsearArchivoPropuesta } from "@/lib/negociacion/analisis-propuesta-parser";
import { obtenerInfoMunicipio } from "@/app/actions/comparativo-actions";
import { clasificarCodigos } from "@/app/actions/historico-prestador-actions";
import { CONTRATOS_EXCLUIDOS_MIGRACION, CONFIG_TIPO_TARIFARIO, TAMANO_MAXIMO_ARCHIVO_BYTES } from "@/lib/negociacion/constantes";
import { UMBRALES_SEMAFORO_DEFECTO } from "@/types/comparativo";
import type { TipoComparativo, ReferenciaVariacion, UmbralesSemaforo } from "@/types/comparativo";
import type { FilaEvaluacionPropuesta, OpcionMunicipioPropuesta, ResultadoAnalisisPropuesta, TipoCodigoPropuesta } from "@/types/analisis-propuesta";
import type { ReferenciaMercadoEps } from "@/types/precio-referencia-eps";

const SOURCE = "analisis-propuesta";

interface FilaCruda {
  ips: number;
  razonSocial: string;
  nit: string;
  numeroContrato: string;
  consecutivoContrato: number;
  codigoTarifa: string;
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
    codigoTarifa: r.codigo_tarifa,
    valorFinal: resolverValorFinal({ valor, valorBase, valorPactado, porcentajeTarifa }),
  };
}

// -----------------------------------------------------------------------
// Municipios disponibles — cualquiera con al menos 1 contrato vigente (no
// exige 2+ prestadores como getOpcionesMunicipios del Módulo 2: aquí basta
// con que exista un tarifario contratado para poder comparar contra él, sin
// importar el tipo de código que traiga el archivo del usuario).
// -----------------------------------------------------------------------

export async function getOpcionesMunicipiosPropuesta(): Promise<OpcionMunicipioPropuesta[]> {
  const sql = `
    SELECT
      munA.municipio AS municipio_codigo,
      munA.descripcion AS municipio_nombre,
      depA.descripcion AS departamento_nombre,
      COUNT(DISTINCT c.consecutivo_contrato) AS cantidad_contratos
    FROM administrativo.ct_ips_contrato c
    JOIN administrativo.tb_municipio munA ON munA.municipio = c.municipio_administracion
    JOIN administrativo.tb_municipio depA ON depA.municipio = munA.departamento
    WHERE c.sw_activo = 1
      AND c.fecha_anula IS NULL
      AND c.numero_contrato != ALL($1)
      AND c.fecha_inicio <= CURRENT_DATE AND c.fecha_terminacion >= CURRENT_DATE
    GROUP BY munA.municipio, munA.descripcion, depA.descripcion
    ORDER BY depA.descripcion ASC, munA.descripcion ASC
  `;
  const result = await pool.query(sql, [CONTRATOS_EXCLUIDOS_MIGRACION], `${SOURCE}/opciones-municipio`);
  const rows: any[] = result?.rows ?? [];
  return rows.map((r) => ({
    municipioCodigo: r.municipio_codigo,
    municipioNombre: r.municipio_nombre,
    departamentoNombre: r.departamento_nombre,
    cantidadContratosVigentes: Number(r.cantidad_contratos),
  }));
}

/**
 * Trae, para UN municipio y UN tipo de tarifario, los prestadores que YA
 * tienen contratado alguno de los `codigos` pedidos — acotado por
 * `d.codigo_tarifa = ANY($3)`, no el tarifario completo del municipio (a
 * diferencia de `construirGruposMunicipio` del Módulo 2), porque aquí solo
 * interesan los códigos puntuales del archivo subido.
 */
async function obtenerPrestadoresPorCodigos(
  municipioCodigo: string,
  tipo: TipoComparativo,
  codigos: string[]
): Promise<Map<string, PrestadorMercadoPropuesta[]>> {
  const resultado = new Map<string, PrestadorMercadoPropuesta[]>();
  if (codigos.length === 0) return resultado;

  const cfg = CONFIG_TIPO_TARIFARIO[tipo];
  const sql = `
    SELECT
      c.ips, ips.razon_social, ips.nit, c.numero_contrato, c.consecutivo_contrato,
      d.codigo_tarifa, d.valor, d.valor_servicio, d.valor_base, d.valor_pactado, d.porcentaje_tarifa
    FROM administrativo.ct_ips_contrato c
    JOIN administrativo.ct_ips ips ON ips.ips = c.ips
    JOIN administrativo.tb_tarifario_propio_detalle d ON d.consecutivo_tarifa = c.${cfg.columnaTarifario}
    WHERE c.municipio_administracion = $2
      AND c.sw_activo = 1
      AND c.fecha_anula IS NULL
      AND c.numero_contrato != ALL($1)
      AND c.fecha_inicio <= CURRENT_DATE AND c.fecha_terminacion >= CURRENT_DATE
      AND COALESCE(d.sw_paquete, 0) = 0
      AND COALESCE(d.sw_activo, 1) = 1
      AND d.codigo_tarifa = ANY($3)
  `;
  const result = await pool.query(sql, [CONTRATOS_EXCLUIDOS_MIGRACION, municipioCodigo, codigos], `${SOURCE}/prestadores-${tipo}`);
  const rows: any[] = result?.rows ?? [];

  // Mismo criterio que el Módulo 2: valorFinal <= 0 es un ítem de contrato
  // capitado sin tarifa por evento, no un precio real comparable (ver
  // KnowledgeBase/04-BaseDatos/Tablas.md#Módulo 2 (Comparativo)).
  const crudas = rows.map(mapFilaCruda).filter((f) => f.valorFinal > 0);
  const deduplicadas = dedupMejorPrecio(crudas);

  for (const fila of deduplicadas) {
    const lista = resultado.get(fila.codigoTarifa) ?? [];
    lista.push({
      ips: fila.ips,
      razonSocial: fila.razonSocial,
      nit: fila.nit,
      numeroContrato: fila.numeroContrato,
      consecutivoContrato: fila.consecutivoContrato,
      valorFinal: fila.valorFinal,
    });
    resultado.set(fila.codigoTarifa, lista);
  }
  return resultado;
}

/**
 * Trae, para UN municipio, los precios que OTRAS EPS reportaron para
 * alguno de los `codigos` pedidos — tabla
 * `negociacion_contratacion_precio_referencia_eps`, alimentada por el
 * analista vía el módulo "Precios de Referencia EPS" (ver
 * src/app/actions/precio-referencia-eps-actions.ts). A diferencia de
 * `obtenerPrestadoresPorCodigos` (contratos propios de Dusakawi), esta
 * tabla no distingue tipo de tarifario — el cruce es directo por
 * `codigo = ANY($2)`, sin necesidad de clasificar contra tb_cup/
 * tb_medicamento/tb_insumo (la descripción ya viene dada en la carga).
 *
 * Si la tabla aún no existe en la BD (migración 002 no aplicada todavía,
 * ver KnowledgeBase/04-BaseDatos/Tablas.md), esta consulta falla — se
 * captura el error y se devuelve un mapa vacío para no romper el resto del
 * análisis: las referencias de mercado EPS son un complemento opcional, no
 * un requisito del módulo.
 */
async function obtenerReferenciasMercadoEps(municipioCodigo: string, codigos: string[]): Promise<Map<string, ReferenciaMercadoEps[]>> {
  const resultado = new Map<string, ReferenciaMercadoEps[]>();
  if (codigos.length === 0) return resultado;

  const sql = `
    SELECT nit_entidad, nombre_entidad, codigo, precio
    FROM administrativo.negociacion_contratacion_precio_referencia_eps
    WHERE municipio_codigo = $1 AND codigo = ANY($2)
  `;
  try {
    const result = await pool.query(sql, [municipioCodigo, codigos], `${SOURCE}/referencias-mercado-eps`);
    const rows: any[] = result?.rows ?? [];
    for (const r of rows) {
      const lista = resultado.get(r.codigo) ?? [];
      lista.push({ nitEntidad: r.nit_entidad, nombreEntidad: r.nombre_entidad, precio: Number(r.precio) });
      resultado.set(r.codigo, lista);
    }
  } catch (error) {
    console.warn("[analisis-propuesta] No fue posible consultar precios de referencia EPS (¿migración 002 aplicada?):", error);
  }
  return resultado;
}

/**
 * Punto de entrada único: parsea el archivo subido y evalúa cada código
 * contra el mercado del municipio elegido. Reutilizada tanto por la UI
 * (resultado en pantalla) como por `/api/export/analisis-propuesta` (mismo
 * cálculo exacto para que el archivo descargado coincida con lo que el
 * analista está viendo, mismo criterio que el resto del proyecto — ver
 * KnowledgeBase/05-ReglasNegocio/Contratación.md, sección de exportación del
 * Módulo 2).
 */
export async function evaluarPropuestaPrestador(formData: FormData): Promise<ResultadoAnalisisPropuesta | { error: string }> {
  const archivo = formData.get("archivo");
  const municipioCodigo = String(formData.get("municipioCodigo") ?? "").trim();
  const referencia = (String(formData.get("referencia") ?? "promedio") as ReferenciaVariacion) || "promedio";
  const alertaPct = Number(formData.get("alertaPct") ?? UMBRALES_SEMAFORO_DEFECTO.alertaPct);
  const criticoPct = Number(formData.get("criticoPct") ?? UMBRALES_SEMAFORO_DEFECTO.criticoPct);
  const umbrales: UmbralesSemaforo = {
    alertaPct: Number.isFinite(alertaPct) ? alertaPct : UMBRALES_SEMAFORO_DEFECTO.alertaPct,
    criticoPct: Number.isFinite(criticoPct) ? criticoPct : UMBRALES_SEMAFORO_DEFECTO.criticoPct,
  };

  if (!(archivo instanceof File) || archivo.size === 0) {
    return { error: "Debe adjuntar un archivo (.csv, .txt o .xlsx) con las columnas Código y Precio Ofertado." };
  }
  if (archivo.size > TAMANO_MAXIMO_ARCHIVO_BYTES) {
    return { error: `El archivo supera el tamaño máximo permitido (${TAMANO_MAXIMO_ARCHIVO_BYTES / (1024 * 1024)} MB).` };
  }
  if (!municipioCodigo) {
    return { error: "Debe elegir el municipio donde se presta el servicio/medicamento/insumo ofertado." };
  }

  const infoMunicipio = await obtenerInfoMunicipio(municipioCodigo);
  if (!infoMunicipio) {
    return { error: "Municipio no reconocido." };
  }

  const buffer = Buffer.from(await archivo.arrayBuffer());
  const parseo = await parsearArchivoPropuesta(buffer, archivo.name);
  if ("error" in parseo) {
    return { error: parseo.error };
  }
  const { filas: filasCargadas, errores: erroresParseo } = parseo;

  const codigosUnicos = Array.from(new Set(filasCargadas.map((f) => f.codigo)));
  const clasificacion = await clasificarCodigos(codigosUnicos);

  const codigosPorTipo: Record<TipoComparativo, string[]> = { servicios: [], medicamentos: [], insumos: [] };
  for (const codigo of codigosUnicos) {
    const clasif = clasificacion.get(codigo);
    if (clasif && clasif.tipo !== "otros") {
      codigosPorTipo[clasif.tipo].push(codigo);
    }
  }

  const [prestadoresServicios, prestadoresMedicamentos, prestadoresInsumos, referenciasMercadoEps] = await Promise.all([
    obtenerPrestadoresPorCodigos(municipioCodigo, "servicios", codigosPorTipo.servicios),
    obtenerPrestadoresPorCodigos(municipioCodigo, "medicamentos", codigosPorTipo.medicamentos),
    obtenerPrestadoresPorCodigos(municipioCodigo, "insumos", codigosPorTipo.insumos),
    obtenerReferenciasMercadoEps(municipioCodigo, codigosUnicos),
  ]);

  const mapaPrestadoresPorCodigo = new Map([...prestadoresServicios, ...prestadoresMedicamentos, ...prestadoresInsumos]);

  const filasEvaluadas: FilaEvaluacionPropuesta[] = filasCargadas.map((filaCargada) => {
    const clasif = clasificacion.get(filaCargada.codigo);
    const tipo: TipoCodigoPropuesta = clasif && clasif.tipo !== "otros" ? clasif.tipo : "noEncontrado";
    const descripcion = clasif?.descripcion ?? filaCargada.codigo;
    const prestadoresMercado = mapaPrestadoresPorCodigo.get(filaCargada.codigo) ?? [];
    const referenciasEps = referenciasMercadoEps.get(filaCargada.codigo) ?? [];
    return construirFilaEvaluacion(filaCargada, tipo, descripcion, prestadoresMercado, referencia, umbrales, referenciasEps);
  });

  return {
    nombreArchivo: archivo.name,
    municipioCodigo,
    municipioNombre: infoMunicipio.municipioNombre,
    departamentoNombre: infoMunicipio.departamentoNombre,
    referencia,
    umbrales,
    filas: filasEvaluadas,
    erroresParseo,
    resumen: construirResumenEvaluacion(filasEvaluadas),
    fechaAnalisis: new Date().toISOString(),
  };
}
