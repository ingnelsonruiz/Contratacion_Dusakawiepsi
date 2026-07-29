---
tags: [arquitectura, adr, decisiones]
---

# Decisiones de Arquitectura (ADR)

Registro de decisiones confirmadas, formato ligero (contexto → decisión → consecuencia). Fuente: `docs/ARQUITECTURA.md` §2.2 y §7.

## ADR-001 — Compartir la base de datos física con `Proyecto_Dusakawi`

- **Contexto**: los datos maestros de precios (tarifarios, contratos, prestadores) y de consumo real (RIPS) ya existen en `base_sie_dusakawi`. Duplicarlos generaría desincronización.
- **Decisión**: `Contratacion_dusakawiepi` es una aplicación 100% independiente (repo, deploy, código propio) que **apunta a la misma BD física**, esquema `administrativo`.
- **Consecuencia**: la independencia del proyecto vive a nivel de código, no de datos. Todas las tablas que este proyecto escribe llevan el prefijo obligatorio `negociacion_contratacion_`. Ver [[Tablas]].

## ADR-002 — Autenticación propia, sin NextAuth/Supabase Auth

- **Contexto**: se necesita un sistema de usuarios independiente de ARYUWIS, con roles propios del Área de Contratación.
- **Decisión**: cookie de sesión propia (mismo patrón middleware que `Proyecto_Dusakawi`) + tabla `negociacion_contratacion_usuario` con hash SHA-256, sin librerías de autenticación de terceros.
- **Consecuencia**: control total del flujo de login/sesión, consistencia con el resto del ecosistema; a cambio, el equipo asume la responsabilidad de mantener la seguridad de sesión (expiración, hash, cookies) sin las garantías out-of-the-box de una librería especializada.

## ADR-003 — Ubicación de tablas nuevas: esquema `administrativo`, prefijo `negociacion_contratacion_`

- **Contexto**: se requiere que las tablas nuevas convivan claramente con el resto del esquema SIE sin riesgo de colisión de nombres ni ambigüedad de propiedad.
- **Decisión**: todas las tablas de este proyecto viven en el esquema `administrativo` (el mismo del ecosistema) con el prefijo `negociacion_contratacion_`.
- **Consecuencia**: fácil de auditar qué tablas pertenecen a este proyecto; requiere disciplina de nomenclatura en cada migración nueva.

## ADR-004 — ETL propio de pre-agregación en vez de consulta en vivo

- **Contexto**: `rips_ap/am/at` suman ~320M de filas sin índice adecuado para este caso de uso; consultarlas en vivo por cada carga de dashboard no escala.
- **Decisión**: proceso ETL batch que pre-agrega hacia `negociacion_contratacion_consumo_agregado`, con refresco diario (cron nocturno).
- **Consecuencia**: los dashboards leen datos agregados (rápido), pero con hasta 24h de desfase respecto al RIPS más reciente. La consulta en vivo queda reservada solo para drill-down puntual de una factura específica.

## ADR-005 — Frecuencia de refresco ETL: diaria (cron nocturno)

- **Contexto**: se necesita balancear frescura de datos contra costo de cómputo sobre tablas de cientos de millones de filas.
- **Decisión**: refresco diario nocturno para `negociacion_contratacion_consumo_agregado` y `negociacion_contratacion_snapshot_tarifario`.
- **Consecuencia**: es la cadencia por defecto; puede ajustarse por tabla si el Área de Contratación lo requiere, ya que el diseño contempla botón manual de "Actualizar" además del cron.

## ADR-006 — Alcance de Benchmark de Mercado Externo diferido a Fase 6

- **Contexto**: ingerir SISMED/datos.gov.co u otras fuentes externas es una pieza no crítica para el núcleo del sistema (Módulos 1-5).
- **Decisión**: fuera del alcance inicial; se aborda después de validar el núcleo con el Área de Contratación.
- **Consecuencia**: el Módulo 6 no bloquea la entrega de valor de las fases 0-5.

## ADR-007 — No reutilizar el scraping en vivo de SISMED

- **Contexto**: el componente legado (`clicsalud-price-search.tsx`) consultaba la API pública SISMED en vivo en cada búsqueda.
- **Decisión**: si se requiere benchmark de mercado externo, debe **ingerirse a una tabla propia** (`negociacion_contratacion_benchmark_mercado`) por carga batch, nunca consultarse en vivo por request de usuario.
- **Consecuencia**: más control de disponibilidad/latencia del dashboard; requiere un proceso de ingesta batch a construir en Fase 6.

## Ver también
- [[Arquitectura General]]
- [[Patrones]]
- [[Tablas]]
