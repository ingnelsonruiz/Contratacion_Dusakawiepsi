---
name: HOME
description: Índice principal y mapa de navegación del proyecto Contratacion_dusakawiepi
ultima_actualizacion: 2026-09-08
---

# 🏠 HOME — Sistema de Inteligencia de Precios para Negociación de Contratos

> **Proyecto:** Contratacion_dusakawiepi — DUSAKAWI EPSI  
> **Propósito:** Análisis, comparación y generación de información estratégica sobre tarifas CUPS, CUM, medicamentos e insumos para negociar contratos con la red prestadora.  
> **No es:** sistema de facturación ni de autorizaciones.

---

## 🗺️ Mapa de la Base de Conocimiento

| Archivo | Contenido |
|---|---|
| `HOME.md` | Este archivo — índice y estado general |
| `Stack_y_Arquitectura.md` | Tecnologías, patrones, decisiones de diseño |
| `Estado_y_Roadmap.md` | Fases completadas, módulos activos, pendientes |
| `Schema_Base_de_Datos.md` | Tablas, columnas, relaciones, índices |
| `Reglas_de_Negocio.md` | Reglas por módulo, fórmulas, umbrales |
| `Convenciones_y_Reglas_Criticas.md` | Reglas que NUNCA se pueden romper |
| `Bugs_y_Correcciones.md` | 22 bugs documentados con correcciones |
| `Modulos_y_API.md` | Rutas, Server Actions, Route Handlers |
| `Tareas_Pendientes.md` | Migraciones, mejoras, módulos sin construir |
| `Log_de_Sesiones.md` | Historial de sesiones de trabajo |

---

## 📊 Estado General del Proyecto (2026-08-02)

### Módulos en producción ✅
- `/tarifarios` — Módulo 1: Tarifario Vigente e Histórico
- `/comparativo` — Módulo 2: Comparativo entre Prestadores + Dashboard Analítico de Riesgo
- `/historico-prestador` — Módulo 3 MVP: Comparativo Histórico del Prestador
- `/consumo-frecuencia` — Módulo 4 MVP: Consumo y Frecuencia real (RIPS)
- `/perfil-prestador` — Perfil Competitivo del Prestador (extra, no planeado)
- `/top-impacto` — Análisis de Códigos de Mayor Impacto Económico (extra)
- `/analisis-propuesta` — Análisis de Propuesta del Prestador (extra)
- `/precio-referencia-eps` — Precios de Referencia de Otras EPS (extra)

### Módulos sin construir ⏳
- Módulo 5 — Simulador de Escenarios
- Módulo 6 — Benchmark de Mercado Externo
- Módulo 7 — Dashboard Ejecutivo (solo placeholder visual en `/dashboard`)
- Módulo 8 — Administración

---

## ⚠️ Pendientes Críticos

1. **Migración BD no aplicada** — `001_negociacion_contratacion_usuario.sql` (tabla de usuarios) y `002_precio_referencia_eps.sql` no han sido ejecutadas en la BD real.
2. **Seguridad** — Hash SHA-256 sin sal, sin rate limiting en login, middleware sin validación criptográfica de firma.
3. **recharts corrupto** — carpeta `node_modules/recharts` parcial, no usar hasta limpiar.

---

## 🔗 Relación con el Ecosistema

- Proyecto **independiente** (repo, deploy y código propio) que apunta a la misma BD física `base_sie_dusakawi`.
- **Solo lectura** sobre tablas `rips_*`, `ct_*`, `tb_*`.
- **Escritura exclusiva** en tablas `negociacion_contratacion_*`.
