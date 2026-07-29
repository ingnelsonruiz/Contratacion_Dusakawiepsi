"use server";

/**
 * Server Actions de "Perfil Competitivo del Prestador" — nueva tarjeta
 * independiente del dashboard (pedida por el usuario 2026-07-29). Ver
 * src/types/perfil-prestador.ts para el objetivo de negocio completo.
 *
 * Solo lectura. Reutiliza `construirGruposTodosMunicipios` (ya construida
 * para el Dashboard Analítico de Riesgo) para traer TODO el tarifario de un
 * tipo a través de todos los municipios — sin filtrar por `ips` en la
 * consulta (ver advertencia en dashboard-riesgo-actions.ts: filtrar ahí
 * rompería la comparación contra pares). El filtrado a UN prestador ocurre
 * después, en construirPerfilPrestador (src/lib/negociacion/perfil-prestador.ts).
 *
 * La lista de prestadores para el selector reutiliza tal cual
 * `getOpcionesPrestadoresRiesgo` (dashboard-riesgo-actions.ts) — mismo
 * criterio (prestadores con contrato vigente y tarifario activo de ese tipo),
 * no se duplica esa consulta aquí.
 */

import { pool } from "@/lib/db";
import { construirGruposTodosMunicipios } from "@/app/actions/dashboard-riesgo-actions";
import { construirPerfilPrestador } from "@/lib/negociacion/perfil-prestador";
import type { TipoComparativo, ReferenciaVariacion, UmbralesSemaforo } from "@/types/comparativo";
import type { ResultadoPerfilPrestador } from "@/types/perfil-prestador";

const SOURCE = "perfil-prestador";

export async function getPerfilPrestador(
  ips: number,
  tipo: TipoComparativo,
  referencia: ReferenciaVariacion,
  umbrales: UmbralesSemaforo
): Promise<ResultadoPerfilPrestador> {
  const infoResult = await pool.query(
    `SELECT razon_social, nit FROM administrativo.ct_ips WHERE ips = $1 LIMIT 1`,
    [ips],
    `${SOURCE}/info-prestador`
  );
  const info = infoResult?.rows?.[0];
  const razonSocial = info?.razon_social ?? "Prestador";
  const nit = info?.nit ?? "";

  // Sin filtro de `ips` — se necesitan TODOS los prestadores del municipio
  // para poder comparar a este contra sus pares reales (ver comentario en
  // construirGruposTodosMunicipios).
  const grupos = await construirGruposTodosMunicipios(tipo, {});

  return construirPerfilPrestador(ips, tipo, razonSocial, nit, grupos, referencia, umbrales);
}
