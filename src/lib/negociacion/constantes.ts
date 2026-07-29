/**
 * Constantes compartidas entre Server Actions de "use server".
 *
 * Por qué existe este archivo: un archivo con `"use server"` en la cabecera
 * SOLO puede exportar funciones async — exportar una constante (aunque sea
 * un array de solo lectura) desde ahí rompe el build con:
 *   Error: A "use server" file can only export async functions, found object.
 * (mismo bug ya documentado para Proyecto_Dusakawi en
 * consolidado-actions.ts/TABLA_PROGRAMAS_PBS — ver CLAUDE.md sección 13).
 *
 * Se descubrió aquí al exportar `CONTRATOS_EXCLUIDOS_MIGRACION` directamente
 * desde `tarifario-actions.ts` (que sí tiene "use server") para reutilizarla
 * en `comparativo-actions.ts` — la constante se mueve a este archivo sin
 * directiva, y ambos Server Actions la importan desde aquí.
 */

/**
 * Contratos "semilla" de migración (no son negociaciones reales con un
 * prestador) que el usuario pidió ocultar de la aplicación el 2026-07-28,
 * dejándolos intactos en la BD (esto es solo un filtro de presentación, no
 * un borrado — el acceso a ARYUWIS aquí es de solo lectura de todos modos).
 * Ambos pertenecen al mismo `ips` (807829, "Asociación de Cabildos Indígenas
 * del Cesar y La Guajira"), con vigencia 2020-2030 y `consecutivo_contrato`
 * muy bajo (50000009/50000010) — consistente con datos de arranque/migración
 * del sistema, no contratos operativos de la red prestadora.
 */
export const CONTRATOS_EXCLUIDOS_MIGRACION = ["0-KS-0", "1-KS-20001"];

/**
 * Config de columnas/tablas maestras por tipo de tarifario — mismo patrón
 * usado primero en comparativo-actions.ts (definido localmente ahí) y
 * reutilizado aquí para el nuevo módulo de Histórico del Prestador, sin
 * tocar el original para no arriesgar una regresión en el Módulo 2 ya
 * verificado. El cruce SIEMPRE es por código (d.codigo_tarifa contra
 * <maestro>.codigo_interno) — la FK consecutivo_cup/_medicamento/_insumo no
 * es confiable (ver CLAUDE.md del proyecto legado, sección 13, y
 * KnowledgeBase/05-ReglasNegocio/Contratación.md).
 */
export interface ConfigTipoTarifario {
  columnaTarifario: "consecutivo_tarifario_servicio" | "consecutivo_tarifario_medicamento" | "consecutivo_tarifario_insumo";
  tablaMaestro: string;
  aliasMaestro: string;
}

export const CONFIG_TIPO_TARIFARIO: Record<"servicios" | "medicamentos" | "insumos", ConfigTipoTarifario> = {
  servicios: {
    columnaTarifario: "consecutivo_tarifario_servicio",
    tablaMaestro: "administrativo.tb_cup",
    aliasMaestro: "mtr",
  },
  medicamentos: {
    columnaTarifario: "consecutivo_tarifario_medicamento",
    tablaMaestro: "administrativo.tb_medicamento",
    aliasMaestro: "mtr",
  },
  insumos: {
    columnaTarifario: "consecutivo_tarifario_insumo",
    tablaMaestro: "administrativo.tb_insumo",
    aliasMaestro: "mtr",
  },
};
