/**
 * Función pura de "Perfil Competitivo del Prestador" — sin dependencias de
 * Next.js/BD, mismo principio de arquitectura que comparativo.ts y
 * dashboard-riesgo.ts. Ver src/types/perfil-prestador.ts para el objetivo de
 * negocio completo.
 *
 * Reutiliza `construirDashboardRiesgo` (calcula el ranking de TODOS los
 * prestadores, del cual se extrae solo la fila de este uno) y `aplanarEntradas`
 * (para reconstruir la lista COMPLETA de códigos de este prestador, sin el
 * recorte a Top 25 que sí aplica `detalleSobrecostos` del ranking).
 */

import { construirDashboardRiesgo, aplanarEntradas } from "@/lib/negociacion/dashboard-riesgo";
import type { FilaComparativoCodigo, ReferenciaVariacion, UmbralesSemaforo, TipoComparativo } from "@/types/comparativo";
import type { FilaCodigoPerfil, ResultadoPerfilPrestador } from "@/types/perfil-prestador";

export function construirPerfilPrestador(
  ips: number,
  tipo: TipoComparativo,
  razonSocial: string,
  nit: string,
  grupos: FilaComparativoCodigo[],
  referencia: ReferenciaVariacion,
  umbrales: UmbralesSemaforo
): ResultadoPerfilPrestador {
  const dashboard = construirDashboardRiesgo(tipo, grupos, referencia, umbrales);

  const indiceEnRanking = dashboard.ranking.findIndex((r) => r.ips === ips);
  const resumen = indiceEnRanking >= 0 ? dashboard.ranking[indiceEnRanking] : null;
  const posicionRanking = indiceEnRanking >= 0 ? indiceEnRanking + 1 : 0;

  const entradas = aplanarEntradas(grupos, referencia, umbrales);
  const codigos: FilaCodigoPerfil[] = entradas
    .filter((e) => e.ips === ips)
    .map((e): FilaCodigoPerfil => {
      // `e.grupo.prestadores` trae numeroContrato por prestador (mismo dato
      // ya usado en Módulos 1/2/3) — se busca aquí la fila de ESTE prestador
      // dentro de su propio grupo para exponer de qué contrato sale su
      // valor, sin tener que consultar la BD de nuevo.
      const filaPropia = e.grupo.prestadores.find((p) => p.ips === ips);
      return {
        codigoTarifa: e.grupo.codigoTarifa,
        descripcion: e.grupo.descripcion,
        municipioNombre: e.grupo.municipioNombre,
        cantidadPrestadoresGrupo: e.grupo.cantidadPrestadores,
        valorPrestador: e.valorFinal,
        numeroContratoPrestador: filaPropia?.numeroContrato ?? null,
        minimo: e.grupo.minimo,
        maximo: e.grupo.maximo,
        promedio: e.grupo.promedio,
        mediana: e.grupo.mediana,
        valorReferencia: e.valorReferencia,
        variacionPct: e.variacion,
        nivel: e.nivel,
        // Grupo completo (incluyendo a este prestador) — fuente del acordeón
        // "otros prestadores con los que se compara" en la UI, ahora con el
        // número de contrato de cada uno (pedido 2026-07-29: "para ubicar
        // rápidamente su número de contrato").
        prestadoresGrupo: [...e.grupo.prestadores]
          .sort((a, b) => a.valorFinal - b.valorFinal)
          .map((p) => ({
            ips: p.ips,
            razonSocial: p.razonSocial,
            nit: p.nit,
            valorFinal: p.valorFinal,
            esEstePrestador: p.ips === ips,
            numeroContrato: p.numeroContrato,
          })),
      };
    })
    .sort((a, b) => Math.abs(b.variacionPct) - Math.abs(a.variacionPct));

  return {
    tipo,
    ips,
    razonSocial,
    nit,
    resumen,
    posicionRanking,
    totalPrestadoresRanking: dashboard.ranking.length,
    rankingCompleto: dashboard.ranking,
    codigos,
  };
}
