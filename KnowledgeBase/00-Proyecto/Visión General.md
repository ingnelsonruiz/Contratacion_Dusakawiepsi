---
tags: [proyecto, vision, dusakawi, contratacion]
---

# Visión General

> [!info] Resumen
> **Contratacion_dusakawiepi** es el *Sistema de Inteligencia de Precios para Negociación de Contratos* del Área de Contratación de **DUSAKAWI EPSI**. Analiza, compara y genera información estratégica sobre tarifas CUPS, CUM, medicamentos e insumos usados para negociar contratos con la red prestadora.

## Qué es

Una plataforma de Business Intelligence enfocada en un único dominio: **el precio y el consumo asociados a los contratos con prestadores de salud**. No es un sistema de facturación ni de autorizaciones — consume datos ya existentes de esos procesos (RIPS, tarifarios, contratos) para producir análisis que apoyan la negociación.

## De dónde viene

Existía previamente un componente de "Gestión de Inteligencia de Precios" embebido como una pestaña dentro del *Módulo de Analítica de Datos* del ecosistema `Proyecto_Dusakawi`. Ese componente:

- Tenía lógica de negocio valiosa (comparación estadística, semáforo de variación, matching prestador↔RIPS) mezclada con **3.348 líneas** de un solo archivo `.tsx`.
- Usaba un login hardcodeado de 2 usuarios en `sessionStorage` — no apto para operar como sistema independiente.
- Dependía de cargas manuales de Excel/Google Sheets para tener una comparación "2025 vs 2026", que en realidad era una foto congelada, no una serie histórica real.

Este proyecto nace para **rescatar el conocimiento de negocio validado** (fórmulas de ahorro, semáforos, estrategias de matching) y reconstruirlo como una aplicación propia, con arquitectura limpia y series temporales reales.

## Relación con el ecosistema Dusakawi

```mermaid
graph LR
    subgraph Ecosistema_SIE["Ecosistema SIE — base_sie_dusakawi"]
        BD[(base_sie_dusakawi<br/>esquema administrativo)]
    end

    PD["Proyecto_Dusakawi<br/>(app existente, puerto 9002)"] -->|lee/escribe tablas propias| BD
    CD["Contratacion_dusakawiepi<br/>(este proyecto, puerto 9010)"] -->|solo lectura: rips_*, ct_*, tb_*| BD
    CD -->|lectura/escritura: negociacion_contratacion_*| BD

    style CD fill:#2d5,stroke:#333,stroke-width:2px
```

Es un **proyecto de aplicación independiente** (repositorio, deploy y código separados), pero comparte la misma base de datos física porque los datos maestros (tarifarios, contratos, RIPS) no deben duplicarse. Ver el detalle de esta decisión en [[Decisiones ADR]].

## Estado actual

> [!warning] Actualizado 2026-08-02 — 4 módulos originales + 4 módulos nuevos en producción
> Fase 0 (Fundación) + **Módulo 1** (`/tarifarios`) + **Módulo 2** (`/comparativo`, con el Dashboard Analítico de Riesgo Contractual) + **Módulo 3 MVP** (`/historico-prestador`) + **Módulo 4 MVP** (`/consumo-frecuencia`) están completados y en producción, consultando ARYUWIS/RIPS en vivo (sin el ETL de pre-agregación originalmente planificado). Además, el equipo construyó **4 módulos que no estaban en los 8 originales**: Perfil Competitivo del Prestador (`/perfil-prestador`), Análisis de Códigos de Mayor Impacto Económico (`/top-impacto`), Análisis de Propuesta del Prestador (`/analisis-propuesta`) y Precios de Referencia de Otras EPS (`/precio-referencia-eps`). **Quedan sin implementar**: Módulo 5 (Simulador), Módulo 6 (Benchmark externo, diferido a propósito) y Módulo 8 (Administración); el Módulo 7 (Dashboard Ejecutivo) sigue siendo un placeholder visual. Ver [[Roadmap]], [[Pendientes]] y [[Contratación]] (esta última con el detalle día a día de cada hito, es la fuente más actualizada).

## Documentos relacionados

- [[Objetivos]]
- [[Roadmap]]
- [[Arquitectura General]]
- [[Glosario]]
