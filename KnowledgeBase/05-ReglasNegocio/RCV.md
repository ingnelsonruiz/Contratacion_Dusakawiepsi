---
tags: [reglas-negocio, rcv, calidad-datos]
---

# RCV — Reglas de Calidad y Validación de Datos

> [!note] Nota de alcance
> El nombre "RCV" en la plantilla de esta base de conocimiento suele referirse a procesos de Registro/Confirmación/Verificación en otros dominios de salud. **En este proyecto no existe ese proceso** — lo más cercano funcionalmente es el control de **calidad de datos sobre tarifas y consumo** que alimenta los módulos de análisis. Este documento cubre esa función equivalente.

## Control de calidad de datos planificado

Tabla `negociacion_contratacion_exclusion_calidad` (ver [[Tablas]]): evolución namespaced de la "matriz de errores" (`tarifas_excluidas_auditoria`) del sistema legado.

- **Propósito**: excluir registros atípicos del cálculo estadístico **sin tocar el dato de origen** (las tablas SIE son de solo lectura, nunca se modifican ni se "corrigen" directamente).
- **Ejemplo de caso de uso**: un valor de tarifa claramente erróneo (ej. captura manual con un cero de más) no debe distorsionar la media/mediana del semáforo de variación, pero tampoco debe borrarse ni editarse en `tb_tarifario_propio_detalle`.

## Verificación de matching prestador↔RIPS

El proceso de matching (ver [[Patrones#Matching prestador↔RIPS]]) es en sí mismo una forma de verificación de calidad: como no existe una llave única limpia entre el maestro de prestadores y los RIPS, se prueban 4 estrategias en cascada hasta encontrar una coincidencia confiable.

## Auditoría como mecanismo de trazabilidad

Tabla `negociacion_contratacion_log_auditoria` (planificada): registra quién exportó qué, quién cambió un escenario de negociación. No es "verificación" de datos en sí, pero cumple el rol de trazabilidad exigido por tratarse de información estratégica sensible.

## Estado de implementación

> [!warning]
> Ninguna de estas piezas está implementada — son diseño documentado en `docs/ARQUITECTURA.md` §3.2, a construirse de forma transversal desde la Fase 1 en adelante (ver [[Roadmap]]).

## Ver también
- [[Validaciones]]
- [[Tablas]]
- [[Roadmap]]
