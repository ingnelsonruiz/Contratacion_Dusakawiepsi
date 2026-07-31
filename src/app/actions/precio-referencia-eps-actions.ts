"use server";

/**
 * Server Actions del módulo "Precios de Referencia EPS" (pedido por el
 * usuario 2026-07-31): una tabla propia (ver
 * administrativo.negociacion_contratacion_precio_referencia_eps,
 * db/migrations/002_precio_referencia_eps.sql), alimentada por el analista
 * vía archivo (CSV/TXT/XLSX), con precios que OTRAS EPS pagan a prestadores
 * por código en un municipio dado — para (1) administrarla directamente
 * (cargar/ver/depurar) y (2) alimentar el módulo "Análisis de Propuesta
 * Prestador" con una referencia de mercado adicional (ver
 * `obtenerReferenciasMercadoEps` en analisis-propuesta-actions.ts).
 *
 * A diferencia del resto de módulos del proyecto (100% solo lectura contra
 * las tablas SIE), este SÍ escribe — es el primer módulo de este proyecto
 * que persiste datos cargados por el usuario. El archivo subido en sí NUNCA
 * se guarda, solo las filas ya parseadas/validadas.
 *
 * Resolución de municipio: el archivo trae el nombre del municipio como
 * texto libre (ej. "Valledupar "), pero la dimensión de cruce real siempre
 * debe ser el código DANE (mismo criterio ya documentado para
 * `municipio_administracion` en KnowledgeBase/04-BaseDatos/Tablas.md) — se
 * resuelve contra el catálogo completo de `tb_municipio` (códigos de 5
 * dígitos = municipio real, ver `obtenerCatalogoMunicipios`), tolerante a
 * acentos/mayúsculas/espacios. Si el nombre es ambiguo (existe en más de un
 * departamento) o no se encuentra, esa fila NO se carga — se reporta en
 * `municipiosNoResueltos` para que el analista la corrija manualmente en
 * vez de adivinar un departamento al azar.
 */

import { pool } from "@/lib/db";
import { getSession, tieneRolMinimo } from "@/lib/auth";
import { parsearArchivoPrecioReferencia } from "@/lib/negociacion/precio-referencia-eps-parser";
import { normalizarTextoConEspacios } from "@/lib/negociacion/archivo-tabular";
import { TAMANO_MAXIMO_ARCHIVO_BYTES } from "@/lib/negociacion/constantes";
import type {
  FiltrosPrecioReferenciaEps,
  FilaPrecioReferenciaEps,
  MunicipioCatalogo,
  ResultadoCargaPrecioReferencia,
  ResultadoListadoPrecioReferenciaEps,
} from "@/types/precio-referencia-eps";

const SOURCE = "precio-referencia-eps";
const TABLA = "administrativo.negociacion_contratacion_precio_referencia_eps";
/** Filas por sentencia INSERT en la carga masiva — mantiene el conteo de parámetros muy por debajo del límite de Postgres (65535) con margen amplio. */
const TAMANO_LOTE_UPSERT = 300;

// -----------------------------------------------------------------------
// Aplicación de la migración 002 desde la propia UI (botón "Aplicar
// migración" en /precio-referencia-eps) — evita depender de que alguien
// entre con psql/DBeaver para que el módulo funcione. Mismo DDL que
// db/migrations/002_precio_referencia_eps.sql, EXACTO (si se edita uno, se
// debe editar el otro) partido en sentencias individuales: el proxy HTTP
// (`src/lib/db.ts`) reenvía `sql`+`params` a Postgres, y con params (aunque
// sea un arreglo vacío) muchos drivers usan el protocolo "extended query",
// que solo admite UNA sentencia por llamada — por eso no se manda el script
// completo con BEGIN/COMMIT de un tiro, se ejecuta sentencia por sentencia
// (cada una ya es idempotente por sí misma vía IF NOT EXISTS, así que
// reintentar tras un fallo parcial es seguro).
// -----------------------------------------------------------------------

const SENTENCIAS_MIGRACION_PRECIO_REFERENCIA_EPS: { etiqueta: string; sql: string }[] = [
  {
    etiqueta: "Crear tabla negociacion_contratacion_precio_referencia_eps",
    sql: `
      CREATE TABLE IF NOT EXISTS administrativo.negociacion_contratacion_precio_referencia_eps (
          id                  BIGSERIAL PRIMARY KEY,
          nit_entidad         VARCHAR(20)   NOT NULL,
          nombre_entidad      VARCHAR(200)  NOT NULL,
          municipio_codigo    VARCHAR(10)   NOT NULL,
          municipio_nombre    VARCHAR(150)  NOT NULL,
          codigo              VARCHAR(50)   NOT NULL,
          descripcion         TEXT          NOT NULL,
          precio              NUMERIC(14,2) NOT NULL,
          usuario_grabado     VARCHAR(100),
          fecha_grabado       TIMESTAMP     NOT NULL DEFAULT now(),
          fecha_actualizado   TIMESTAMP     NOT NULL DEFAULT now(),
          CONSTRAINT chk_negociacion_contratacion_precio_referencia_eps_precio
              CHECK (precio > 0),
          CONSTRAINT uq_negociacion_contratacion_precio_referencia_eps
              UNIQUE (nit_entidad, municipio_codigo, codigo)
      )
    `,
  },
  {
    etiqueta: "Crear índice por municipio_codigo + codigo",
    sql: `
      CREATE INDEX IF NOT EXISTS idx_negociacion_contratacion_precio_ref_eps_municipio_codigo
          ON administrativo.negociacion_contratacion_precio_referencia_eps (municipio_codigo, codigo)
    `,
  },
  {
    etiqueta: "Crear índice por nit_entidad",
    sql: `
      CREATE INDEX IF NOT EXISTS idx_negociacion_contratacion_precio_ref_eps_entidad
          ON administrativo.negociacion_contratacion_precio_referencia_eps (nit_entidad)
    `,
  },
  {
    etiqueta: "Agregar comentario descriptivo de la tabla",
    sql: `
      COMMENT ON TABLE administrativo.negociacion_contratacion_precio_referencia_eps IS
          'Precios de referencia que OTRAS EPS pagan a prestadores por código (CUPS/CUM/insumo), cargados manualmente por el analista de Contratación vía archivo. Usado como referencia adicional de mercado en el módulo "Análisis de Propuesta Prestador" — no se mezcla con la mediana/promedio de la red propia de Dusakawi, se muestra y exporta por separado.'
    `,
  },
];

interface PasoMigracion {
  etiqueta: string;
  ok: boolean;
  error?: string;
}

interface ResultadoAplicarMigracion {
  ok: boolean;
  pasos: PasoMigracion[];
}

/** Consulta liviana (`information_schema`) para saber si la tabla ya existe, sin depender de que una carga/listado falle primero. */
export async function verificarTablaPrecioReferenciaEps(): Promise<{ existe: boolean }> {
  const sql = `
    SELECT 1 FROM information_schema.tables
    WHERE table_schema = 'administrativo' AND table_name = 'negociacion_contratacion_precio_referencia_eps'
    LIMIT 1
  `;
  try {
    const result = await pool.query(sql, [], `${SOURCE}/verificar-tabla`);
    return { existe: (result?.rows?.length ?? 0) > 0 };
  } catch {
    // Degradación defensiva, mismo criterio que obtenerReferenciasMercadoEps
    // en analisis-propuesta-actions.ts: si ni siquiera se puede consultar el
    // catálogo, se asume que no existe en vez de reventar la pantalla.
    return { existe: false };
  }
}

/**
 * Ejecuta la migración 002 (crear la tabla + índices + comentario) contra la
 * BD real, sentencia por sentencia. Restringido a rol `admin` — es un cambio
 * de esquema, no una operación de negocio normal, así que se exige el rol
 * más alto de la jerarquía (`tieneRolMinimo`, src/lib/auth.ts) en vez de
 * dejarla disponible para cualquier analista.
 */
export async function aplicarMigracionPrecioReferenciaEps(): Promise<ResultadoAplicarMigracion | { error: string }> {
  const session = await getSession();
  if (!tieneRolMinimo(session, "admin")) {
    return { error: "Solo un usuario con rol 'admin' puede aplicar esta migración." };
  }

  const pasos: PasoMigracion[] = [];
  for (const paso of SENTENCIAS_MIGRACION_PRECIO_REFERENCIA_EPS) {
    try {
      await pool.query(paso.sql, [], `${SOURCE}/aplicar-migracion`);
      pasos.push({ etiqueta: paso.etiqueta, ok: true });
    } catch (error: any) {
      pasos.push({ etiqueta: paso.etiqueta, ok: false, error: error?.message ?? String(error) });
    }
  }

  return { ok: pasos.every((p) => p.ok), pasos };
}

// -----------------------------------------------------------------------
// Catálogo de municipios (DANE) — usado tanto para resolver el texto libre
// del archivo como para el filtro de municipio de la pantalla de consulta.
// -----------------------------------------------------------------------

let cacheCatalogoMunicipios: MunicipioCatalogo[] | null = null;

/**
 * Todos los municipios reales de `tb_municipio` (código DANE de 5 dígitos —
 * los códigos de 2 dígitos son el departamento auto-referenciado, ver
 * KnowledgeBase/04-BaseDatos/Tablas.md#Módulo 2). Se cachea en memoria del
 * proceso (catálogo estático, no cambia en caliente) para no repetir la
 * consulta en cada carga/consulta del módulo.
 */
export async function obtenerCatalogoMunicipios(): Promise<MunicipioCatalogo[]> {
  if (cacheCatalogoMunicipios) return cacheCatalogoMunicipios;
  const sql = `
    SELECT munA.municipio AS municipio_codigo, munA.descripcion AS municipio_nombre, depA.descripcion AS departamento_nombre
    FROM administrativo.tb_municipio munA
    JOIN administrativo.tb_municipio depA ON depA.municipio = munA.departamento
    WHERE LENGTH(munA.municipio) = 5
    ORDER BY depA.descripcion ASC, munA.descripcion ASC
  `;
  const result = await pool.query(sql, [], `${SOURCE}/catalogo-municipios`);
  const rows: any[] = result?.rows ?? [];
  cacheCatalogoMunicipios = rows.map((r) => ({
    municipioCodigo: r.municipio_codigo,
    municipioNombre: r.municipio_nombre,
    departamentoNombre: r.departamento_nombre,
  }));
  return cacheCatalogoMunicipios;
}

interface ResolucionMunicipio {
  encontrado?: MunicipioCatalogo;
  motivo?: string;
}

/** Resuelve un texto libre de municipio contra el catálogo DANE — exacto tras normalizar (sin tildes/mayúsculas/espacios extra); ambiguo o no encontrado se reporta explícitamente, nunca se adivina. */
function resolverMunicipioPorNombre(texto: string, catalogo: MunicipioCatalogo[], indice: Map<string, MunicipioCatalogo[]>): ResolucionMunicipio {
  const clave = normalizarTextoConEspacios(texto);
  const candidatos = indice.get(clave) ?? [];
  if (candidatos.length === 1) return { encontrado: candidatos[0] };
  if (candidatos.length === 0) {
    return { motivo: `Municipio "${texto.trim()}" no encontrado en el catálogo DANE.` };
  }
  const departamentos = candidatos.map((c) => c.departamentoNombre).join(", ");
  return {
    motivo: `Municipio "${texto.trim()}" es ambiguo — existe en más de un departamento (${departamentos}). Especifique el departamento en el archivo (ej. "Armenia (Quindío)") o cárguelo por separado.`,
  };
}

function construirIndiceMunicipios(catalogo: MunicipioCatalogo[]): Map<string, MunicipioCatalogo[]> {
  const indice = new Map<string, MunicipioCatalogo[]>();
  for (const m of catalogo) {
    const clave = normalizarTextoConEspacios(m.municipioNombre);
    const lista = indice.get(clave) ?? [];
    lista.push(m);
    indice.set(clave, lista);
  }
  return indice;
}

// -----------------------------------------------------------------------
// Carga de archivo (parseo + resolución de municipio + UPSERT)
// -----------------------------------------------------------------------

export async function cargarPreciosReferenciaEps(formData: FormData): Promise<ResultadoCargaPrecioReferencia | { error: string }> {
  const archivo = formData.get("archivo");
  if (!(archivo instanceof File) || archivo.size === 0) {
    return { error: "Debe adjuntar un archivo (.csv, .txt o .xlsx) con las columnas Nit_prestador, Prestador, Municipio, Codigo, Descripcion y Precio." };
  }
  if (archivo.size > TAMANO_MAXIMO_ARCHIVO_BYTES) {
    return { error: `El archivo supera el tamaño máximo permitido (${TAMANO_MAXIMO_ARCHIVO_BYTES / (1024 * 1024)} MB).` };
  }

  const buffer = Buffer.from(await archivo.arrayBuffer());
  const parseo = await parsearArchivoPrecioReferencia(buffer, archivo.name);
  if ("error" in parseo) return { error: parseo.error };
  const { filas: filasCargadas, errores } = parseo;

  const catalogo = await obtenerCatalogoMunicipios();
  const indiceMunicipios = construirIndiceMunicipios(catalogo);

  const session = await getSession();
  const usuarioGrabado = session?.username ?? "desconocido";

  const filasParaCargar: {
    nitEntidad: string;
    nombreEntidad: string;
    municipioCodigo: string;
    municipioNombre: string;
    codigo: string;
    descripcion: string;
    precio: number;
  }[] = [];

  const noResueltosPorTexto = new Map<string, { filas: number[]; motivo: string }>();

  for (const fila of filasCargadas) {
    const resolucion = resolverMunicipioPorNombre(fila.municipioTexto, catalogo, indiceMunicipios);
    if (!resolucion.encontrado) {
      const clave = fila.municipioTexto.trim();
      const existente = noResueltosPorTexto.get(clave);
      if (existente) {
        existente.filas.push(fila.filaOriginal);
      } else {
        noResueltosPorTexto.set(clave, { filas: [fila.filaOriginal], motivo: resolucion.motivo! });
      }
      continue;
    }
    filasParaCargar.push({
      nitEntidad: fila.nitEntidad,
      nombreEntidad: fila.nombreEntidad,
      municipioCodigo: resolucion.encontrado.municipioCodigo,
      municipioNombre: fila.municipioTexto.trim(),
      codigo: fila.codigo,
      descripcion: fila.descripcion,
      precio: fila.precio,
    });
  }

  let insertados = 0;
  let actualizados = 0;

  for (let i = 0; i < filasParaCargar.length; i += TAMANO_LOTE_UPSERT) {
    const lote = filasParaCargar.slice(i, i + TAMANO_LOTE_UPSERT);
    const valoresSql: string[] = [];
    const params: any[] = [];
    lote.forEach((fila, idx) => {
      const base = idx * 8;
      valoresSql.push(`($${base + 1}, $${base + 2}, $${base + 3}, $${base + 4}, $${base + 5}, $${base + 6}, $${base + 7}, $${base + 8})`);
      params.push(
        fila.nitEntidad,
        fila.nombreEntidad,
        fila.municipioCodigo,
        fila.municipioNombre,
        fila.codigo,
        fila.descripcion,
        fila.precio,
        usuarioGrabado
      );
    });

    const sql = `
      INSERT INTO ${TABLA}
        (nit_entidad, nombre_entidad, municipio_codigo, municipio_nombre, codigo, descripcion, precio, usuario_grabado)
      VALUES ${valoresSql.join(", ")}
      ON CONFLICT (nit_entidad, municipio_codigo, codigo) DO UPDATE SET
        nombre_entidad = EXCLUDED.nombre_entidad,
        municipio_nombre = EXCLUDED.municipio_nombre,
        descripcion = EXCLUDED.descripcion,
        precio = EXCLUDED.precio,
        usuario_grabado = EXCLUDED.usuario_grabado,
        fecha_actualizado = now()
      RETURNING (xmax = 0) AS insertado
    `;
    const result = await pool.query(sql, params, `${SOURCE}/upsert`);
    const rows: any[] = result?.rows ?? [];
    for (const r of rows) {
      if (r.insertado === true || r.insertado === "t" || r.insertado === 1) insertados++;
      else actualizados++;
    }
  }

  return {
    nombreArchivo: archivo.name,
    totalFilasArchivo: filasCargadas.length + errores.length,
    insertados,
    actualizados,
    errores,
    municipiosNoResueltos: Array.from(noResueltosPorTexto.entries()).map(([texto, v]) => ({ texto, filas: v.filas, motivo: v.motivo })),
    fechaCarga: new Date().toISOString(),
  };
}

// -----------------------------------------------------------------------
// Consulta / administración
// -----------------------------------------------------------------------

export async function listarPreciosReferenciaEps(filtros: FiltrosPrecioReferenciaEps): Promise<ResultadoListadoPrecioReferenciaEps> {
  const condiciones: string[] = [];
  const params: any[] = [];

  if (filtros.municipioCodigo) {
    params.push(filtros.municipioCodigo);
    condiciones.push(`p.municipio_codigo = $${params.length}`);
  }
  if (filtros.entidadTexto?.trim()) {
    params.push(`%${filtros.entidadTexto.trim()}%`);
    condiciones.push(`(p.nombre_entidad ILIKE $${params.length} OR p.nit_entidad ILIKE $${params.length})`);
  }
  if (filtros.codigoTexto?.trim()) {
    params.push(`%${filtros.codigoTexto.trim()}%`);
    condiciones.push(`(p.codigo ILIKE $${params.length} OR p.descripcion ILIKE $${params.length})`);
  }

  const where = condiciones.length > 0 ? `WHERE ${condiciones.join(" AND ")}` : "";
  const pagina = Math.max(1, filtros.pagina);
  const tamanoPagina = Math.min(200, Math.max(1, filtros.tamanoPagina));
  const offset = (pagina - 1) * tamanoPagina;

  params.push(tamanoPagina, offset);
  const sql = `
    SELECT
      p.id, p.nit_entidad, p.nombre_entidad, p.municipio_codigo, p.municipio_nombre,
      depA.descripcion AS departamento_nombre, p.codigo, p.descripcion, p.precio, p.fecha_actualizado,
      COUNT(*) OVER() AS total_count
    FROM ${TABLA} p
    LEFT JOIN administrativo.tb_municipio munA ON munA.municipio = p.municipio_codigo
    LEFT JOIN administrativo.tb_municipio depA ON depA.municipio = munA.departamento
    ${where}
    ORDER BY p.fecha_actualizado DESC, p.id DESC
    LIMIT $${params.length - 1} OFFSET $${params.length}
  `;
  const result = await pool.query(sql, params, `${SOURCE}/listar`);
  const rows: any[] = result?.rows ?? [];

  const filas: FilaPrecioReferenciaEps[] = rows.map((r) => ({
    id: Number(r.id),
    nitEntidad: r.nit_entidad,
    nombreEntidad: r.nombre_entidad,
    municipioCodigo: r.municipio_codigo,
    municipioNombre: r.municipio_nombre,
    departamentoNombre: r.departamento_nombre ?? "—",
    codigo: r.codigo,
    descripcion: r.descripcion,
    precio: Number(r.precio),
    fechaActualizado: r.fecha_actualizado,
  }));

  return { filas, total: rows.length > 0 ? Number(rows[0].total_count) : 0 };
}

export async function eliminarPrecioReferenciaEps(id: number): Promise<{ ok: true } | { error: string }> {
  if (!Number.isFinite(id) || id <= 0) return { error: "Identificador inválido." };
  await pool.query(`DELETE FROM ${TABLA} WHERE id = $1`, [id], `${SOURCE}/eliminar`);
  return { ok: true };
}

/** Borrado masivo por EPS+municipio — para depurar/reemplazar limpiamente una carga anterior antes de subir una versión corregida. */
export async function eliminarPreciosReferenciaEpsPorEntidadMunicipio(
  nitEntidad: string,
  municipioCodigo: string
): Promise<{ eliminados: number } | { error: string }> {
  if (!nitEntidad.trim() || !municipioCodigo.trim()) {
    return { error: "Debe indicar la EPS y el municipio a eliminar." };
  }
  const result = await pool.query(
    `DELETE FROM ${TABLA} WHERE nit_entidad = $1 AND municipio_codigo = $2 RETURNING id`,
    [nitEntidad.trim(), municipioCodigo.trim()],
    `${SOURCE}/eliminar-lote`
  );
  const rows: any[] = result?.rows ?? [];
  return { eliminados: rows.length };
}
