---
name: Tareas_Pendientes
description: Migraciones pendientes, mejoras de seguridad, módulos sin construir y deuda técnica
ultima_actualizacion: 2026-09-08
---

# ✅ Tareas Pendientes

---

## 🔴 Crítico — Migraciones BD sin aplicar

| Migración | Estado | Acción requerida |
|---|---|---|
| `db/migrations/001_negociacion_contratacion_usuario.sql` | ❌ NO aplicada | Ejecutar en DBeaver/psql antes de usar el sistema de login |
| `db/migrations/002_precio_referencia_eps.sql` | ❌ NO aplicada por defecto | Ejecutar manualmente O usar botón "Aplicar migración" (rol `admin`) en la UI |

> Sin la migración `001`, el sistema de usuarios no funciona. Sin la `002`, la carga de archivos en `/precio-referencia-eps` falla con error de tabla inexistente.

---

## 🔴 Seguridad — Pendientes

| Item | Prioridad | Descripción |
|---|---|---|
| Migrar a `bcrypt`/`argon2` | Alta | Hash SHA-256 sin sal vulnerable a rainbow tables. Mantener compatibilidad con hashes existentes durante la migración. |
| Rate limiting en `loginAction` | Alta | No hay bloqueo tras intentos fallidos. Implementar por IP/usuario. |
| Validación criptográfica en middleware | Media | Actualmente solo verifica `isLoggedIn: true` en JSON. Agregar validación de firma. |
| Tabla `negociacion_contratacion_log_auditoria` | Media | Registrar cada login/logout. DDL no escrito. |
| Expiración explícita en cookie de sesión | Baja | Middleware podría validar expiración. |

---

## 🟡 Deuda Técnica — Pendientes

### `recharts` — directorio corrupto
- **Problema:** `node_modules/recharts` sin `package.json` propio, bloqueada por file locks.
- **Acción:** Antes de reintentar instalación, limpiar manualmente la carpeta: `rm -rf node_modules/recharts && npm install recharts`
- **Workaround actual:** Gráficos con HTML/CSS puro (`<div>` con ancho en %) o SVG propio.

### `comparativo-client.tsx` — archivo de alto riesgo
- **Problema:** Historial de corrupción por bytes NUL al editar.
- **Acción:** Continuar aislando nueva funcionalidad en archivos separados (patrón `dashboard-riesgo-tab.tsx`). No agregar más código a este archivo.

### Roles — `tieneRolMinimo()` sin uso real
- **Problema:** `tieneRolMinimo()` existe pero solo se usa en el botón de migración EPS. El resto de rutas no distingue roles más allá de "autenticado o no".
- **Acción:** Auditar cada Server Action y Route Handler para agregar verificación de rol mínimo donde corresponda.

---

## 🟡 Módulos sin Construir

### Módulo 5 — Simulador de Escenarios (`/simulador`)
Proyectar impacto económico de una tarifa propuesta contra el consumo real histórico. Requiere tablas `negociacion_contratacion_escenario` y `negociacion_contratacion_escenario_detalle` (sin DDL escrito).

### Módulo 6 — Benchmark de Mercado Externo
Ingesta batch de datos SISMED / datos.gov.co como referencia de precios de mercado. Diferida a propósito — depende de disponibilidad y formato estable de la fuente externa. Tabla planificada: `negociacion_contratacion_benchmark_mercado`.

### Módulo 7 — Dashboard Ejecutivo (`/dashboard`)
Actualmente solo un placeholder visual. KPIs ejecutivos de alto nivel del proceso de negociación. Requiere `negociacion_contratacion_indicador_cache` para no recalcular en cada carga. Decisión de arquitectura pendiente sobre gestión de estado de filtros.

### Módulo 8 — Administración
Gestión de usuarios, roles, auditoría de acciones, configuración de umbrales. Solo existe la tabla `negociacion_contratacion_usuario` (con DDL escrito pero no aplicado).

---

## 🟡 ETL — No implementado

- **`/api/etl/*`** — Route Handler no existe.
- **`src/lib/matching-prestador.ts`** — estrategia documentada, no implementada.
- **`negociacion_contratacion_consumo_agregado`** — tabla planificada para pre-agregar `rips_ap/am/at` y eliminar la restricción de 92 días en Módulo 4.

---

## 🟢 Índices Recomendados (no creados)

| Tabla | Índice sugerido | Motivo |
|---|---|---|
| `negociacion_contratacion_snapshot_tarifario` | `(codigo, fecha_snapshot)` | Consultas históricas por código |
| `negociacion_contratacion_consumo_agregado` | `(prestador, codigo, periodo)` | Filtros principales del ETL |
| `negociacion_contratacion_indicador_cache` | `(nombre_indicador)` UNIQUE | Lookup de KPIs por nombre |
| `negociacion_contratacion_log_auditoria` | `(usuario_id, fecha)` | Consultas de auditoría por usuario y período |

---

## 🟢 Notas para TI/ARYUWIS (fuera del alcance de este proyecto)

1. **Proceso de recarga de RIPS:** El proceso de carga de ARYUWIS reinserta lotes completos sin limpiar/reemplazar cargas anteriores del mismo prestador. Las copias duplicadas siguen existiendo físicamente en `rips_af`/`rips_ap`/`rips_ac`/`rips_am`/`rips_at`. El helper `rips-dedup.ts` compensa esto en las consultas, pero la causa raíz está en el proceso de carga.

2. **Filtro de `consecutivo_contrato` en RIPS:** Actualmente el módulo `/top-impacto` suma toda la actividad RIPS del prestador en el período, sin filtrar por contrato específico. Para reconciliación exacta contrato-por-contrato: filtrar `rips_af.consecutivo_contrato = $1` directamente (requiere verificar que ese campo esté poblado en la BD).

---

## 🟢 Decisión de Arquitectura Pendiente

No hay ADR registrado sobre cómo manejar el estado de filtros interactivos (fechas, prestador, código) en los dashboards de las fases siguientes. Candidato a decisión antes de iniciar Módulos 5–8.
