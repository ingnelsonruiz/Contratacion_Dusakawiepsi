---
tags: [proyecto, objetivos]
---

# Objetivos

# Índice
- [[#Objetivo general]]
- [[#Objetivos específicos por módulo]]
- [[#Principios no negociables]]

## Objetivo general

Dar al Área de Contratación de DUSAKAWI EPSI información objetiva, trazable y basada en datos reales de consumo para **negociar mejores tarifas** con la red prestadora, reemplazando el análisis manual en Excel y el componente hardcodeado anterior.

## Objetivos específicos por módulo

Cada módulo (ver [[Arquitectura General]] §4) cubre un objetivo puntual del área:

| Objetivo de negocio | Módulo que lo cubre | Estado |
|---|---|---|
| Analizar tarifas históricas | [[Arquitectura General#Módulo 1 — Tarifario Vigente e Histórico\|Módulo 1: Tarifario]] | ✅ |
| Comparar negociaciones entre prestadores | [[Arquitectura General#Módulo 2 — Comparativo entre Prestadores\|Módulo 2: Comparativo]] | ✅ |
| Comparar comportamiento de CUPS/CUM y medicamentos | Módulo 2: Comparativo | ✅ |
| Priorizar prestadores por riesgo/sobrecosto contractual | Dashboard Analítico de Riesgo Contractual (pestaña del Módulo 2) | ✅ |
| Comparar la tarifa vigente de un prestador contra su propio histórico | Módulo 3: Comparativo Histórico del Prestador (MVP) | ✅ |
| Analizar consumos y frecuencias | [[Arquitectura General#Módulo 3 — Consumo y Frecuencia\|Módulo 4: Consumo y Frecuencia]] (renumerado — ver [[Roadmap]]) | ✅ MVP |
| Analizar a un prestador puntual contra sus pares del mismo municipio | Perfil Competitivo del Prestador (módulo nuevo, no contemplado originalmente) | ✅ |
| Priorizar códigos por impacto económico a nivel EPS-completa | Análisis de Códigos de Mayor Impacto Económico (módulo nuevo) | ✅ |
| Evaluar la propuesta de tarifas de un prestador nuevo/renegociando | Análisis de Propuesta del Prestador (módulo nuevo) | ✅ |
| Tener referencia de lo que pagan otras EPS por un código+municipio | Precios de Referencia de Otras EPS (módulo nuevo) | ✅ |
| Detectar sobrecostos y oportunidades de ahorro | [[Arquitectura General#Módulo 4 — Sobrecostos y Ahorro\|Módulo Sobrecostos y Ahorro]] | ⏳ No iniciado |
| Simular escenarios de negociación | [[Arquitectura General#Módulo 5 — Simulador de Escenarios\|Módulo 5: Simulador]] | ⏳ No iniciado |
| Tener referencia objetiva de mercado externo (ingesta batch pública) | [[Arquitectura General#Módulo 6 — Benchmark de Mercado Externo\|Módulo 6: Benchmark]] | ⏳ No iniciado (diferido a propósito) |
| Apoyar la decisión pre-negociación con indicadores | [[Arquitectura General#Módulo 7 — Dashboard Ejecutivo\|Módulo 7: Dashboard Ejecutivo]] | ⏳ Placeholder visual |
| Gobernanza: usuarios, auditoría, calidad de datos | [[Arquitectura General#Módulo 8 — Administración\|Módulo 8: Administración]] | ⏳ No iniciado |

> [!note] Actualizado 2026-08-02
> El equipo construyó 4 objetivos de negocio que no estaban en la lista original (filas "módulo nuevo" arriba), a pedido directo del usuario tras ver los módulos 1-3 en uso. Ver el detalle día a día de cada uno en [[Contratación]] y el estado consolidado en [[Roadmap]].

## Principios no negociables

> [!important] Aplican a cada fase de construcción
> - Solo lectura sobre las tablas SIE existentes (`rips_*`, `ct_*`, `tb_*`). Toda escritura ocurre exclusivamente en tablas `negociacion_contratacion_*`.
> - Nunca `SELECT *` sobre `rips_ap/am/at` sin filtro de período.
> - Parámetros posicionales siempre (`$1, $2…`), nunca interpolación de valores en SQL.
> - Todo umbral de negocio (variación %, ahorro mínimo) es configurable, no hardcodeado.
> - Todo cálculo estadístico/financiero es una función pura y testeable en `src/lib/negociacion/` — nunca inline en un componente `.tsx`.
> - Auditoría de todo cambio de escenario y toda exportación.

Ver detalle ampliado en [[Arquitectura General#6. Principios no negociables]] y reglas de negocio en [[Validaciones]].

## Documentos relacionados
- [[Visión General]]
- [[Roadmap]]
- [[Contratación]]
