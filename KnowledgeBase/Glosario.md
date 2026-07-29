---
tags: [glosario, referencia]
---

# Glosario

## Términos de dominio (salud / Dusakawi)

| Término | Significado |
|---|---|
| **EPSI** | Entidad Promotora de Salud Indígena — naturaleza jurídica de DUSAKAWI |
| **RIPS** | Registro Individual de Prestación de Servicios de Salud — reporte estándar colombiano del detalle de atenciones prestadas |
| **rips_ap** | RIPS de procedimientos (Atención de Procedimientos) |
| **rips_am** | RIPS de medicamentos (Atención de Medicamentos) |
| **rips_at** | RIPS de insumos/otros servicios (Atención de oTros) |
| **rips_af** | RIPS de afiliación/facturación (Atención de Facturación) |
| **CUPS** | Clasificación Única de Procedimientos en Salud — códigos estándar de procedimientos médicos |
| **CUM** | Código Único de Medicamentos |
| **NIT** | Número de Identificación Tributaria — identificador fiscal usado para el matching prestador↔RIPS |
| **IPS** | Institución Prestadora de Salud (prestador de la red) |
| **Código de habilitación** | Identificador oficial de habilitación de una IPS ante el sistema de salud, usado como primera estrategia de matching |
| **Glosa** | Descuento o rechazo (parcial o total) aplicado a una factura por la entidad pagadora |
| **SISMED** | Sistema de Información de Precios de Medicamentos — fuente pública de referencia de precios (API externa) |
| **ARYUWIS** | Sistema/módulo del ecosistema Dusakawi dueño de `usuarios_tarifario` — gestión de tarifarios, independiente de este proyecto |

## Términos técnicos del proyecto

| Término | Significado |
|---|---|
| **Snapshot de tarifario** | Corte congelado y versionado del tarifario contratado vigente en una fecha específica, usado para construir series temporales reales (ver [[Tablas]]) |
| **Semáforo de variación** | Regla de negocio que clasifica una diferencia de tarifa en OK (±1%), alerta (1-10%) o crítico (>10%) — ver [[Contratación]] |
| **Matching prestador↔RIPS** | Proceso de 4 estrategias en cascada para identificar de forma confiable a qué prestador corresponde un registro RIPS (ver [[Patrones]]) |
| **ETL** | Extract-Transform-Load — proceso batch de pre-agregación de RIPS hacia tablas propias (ver [[Procedimientos]]) |
| **Escenario de negociación** | Simulación guardada de una propuesta de tarifa y su impacto proyectado (Módulo 5, planificado) |
| **Ronda de negociación** | Cada oferta/contraoferta dentro de un escenario, con trazabilidad histórica |
| **Cold start** | Arranque en frío de un servicio tras inactividad (aplica al proxy en Render — ver [[Render]]) |
| **Server Action** | Función de servidor invocable directamente desde un componente React en Next.js, sin necesidad de un endpoint HTTP explícito |
| **Route Handler** | Endpoint HTTP explícito (`route.ts`) en el App Router de Next.js, usado para exportaciones binarias, integraciones externas o el ETL |
| **Proxy de BD** | Servicio intermedio (`pg-proxy.onrender.com`) que expone PostgreSQL vía HTTP para sortear restricciones de IP dinámica del hosting de la app |

## Roles del sistema

| Rol | Descripción |
|---|---|
| **analista** | Analista de Contratación — nivel base de acceso |
| **jefe_contratacion** | Jefe de Contratación — nivel intermedio |
| **admin** | Administrador — nivel máximo, gestión de usuarios y auditoría |

## Ver también
- [[Visión General]]
- [[Contratación]]
- [[Tablas]]
