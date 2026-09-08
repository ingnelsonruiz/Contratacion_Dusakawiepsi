---
name: Stack_y_Arquitectura
description: Stack tecnológico, arquitectura general, patrones de implementación y decisiones de diseño
ultima_actualizacion: 2026-09-08
---

# 🏗️ Stack y Arquitectura

## Stack Tecnológico

| Capa | Tecnología | Versión |
|---|---|---|
| Framework | Next.js (App Router) | 15.2.8 |
| UI | React | 18.3.1 |
| Lenguaje | TypeScript | ^5, `strict: true` |
| Estilos | Tailwind CSS | 3.4.1 |
| Componentes | Shadcn UI (Radix) | badge, button, card, input, label, select nativo, table, tabs Radix |
| Exportación Excel | `exceljs` | 4.4.0 |
| Base de datos | PostgreSQL 14.19 | Vía proxy HTTP, **sin ORM** |
| Ejecución scripts | `tsx` | 4.19.2 |
| Runtime | Node.js | 20 |
| Puerto dev | 9010 | `next dev -p 9010` |

> ⚠️ **Stack planificado (no instalado):** Recharts (visualización), jsPDF+autotable (PDF).  
> ⚠️ **recharts** — carpeta `node_modules/recharts` está corrupta (sin `package.json`). No importar hasta limpiar manualmente.

---

## Arquitectura General

```
Next.js 15 App Router
├── app/
│   ├── (auth)/login/          → Login con Server Action
│   ├── tarifarios/            → Módulo 1
│   ├── comparativo/           → Módulo 2 + Dashboard Riesgo
│   ├── historico-prestador/   → Módulo 3
│   ├── consumo-frecuencia/    → Módulo 4
│   ├── perfil-prestador/      → Módulo extra
│   ├── top-impacto/           → Módulo extra
│   ├── analisis-propuesta/    → Módulo extra
│   ├── precio-referencia-eps/ → Módulo extra
│   └── dashboard/             → Placeholder Módulo 7
├── src/
│   ├── lib/
│   │   ├── db.ts              → Pool PostgreSQL + proxy HTTP + retry
│   │   ├── auth.ts            → tieneRolMinimo(), getSession()
│   │   └── negociacion/       → Lógica de negocio pura (funciones testeables)
│   │       ├── comparativo.ts
│   │       ├── rips-dedup.ts  → sqlFacturasCanonicas / joinFacturaCanonica
│   │       └── ...
│   └── components/            → Componentes UI reutilizables
└── db/
    └── migrations/
        ├── 001_negociacion_contratacion_usuario.sql   ⚠️ NO aplicada
        └── 002_precio_referencia_eps.sql              ⚠️ NO aplicada
```

---

## Capa de Datos — `db.ts`

- Modo dual: `pg` pool directo (local) o proxy HTTP (`PROXY_URL`) para Vercel/cloud.
- **Errores reintentables** registrados: `"terminated"`, `"socket"`, `"ECONNRESET"`, `"other side closed"`, código `UND_ERR_SOCKET`.
- **Sin ORM** — SQL puro con parámetros posicionales (`$1, $2…`). Nunca interpolación de valores.

---

## Autenticación

- Cookie de sesión con `isLoggedIn: true` en JSON.
- Hash de contraseña: **SHA-256 hex sin salt** (mismo patrón que `administrativo.usuarios_tarifario`).
- `tieneRolMinimo(session, rolMinimo)` implementada en `src/lib/auth.ts`.

> ⚠️ **Middleware superficial** — solo verifica existencia de cookie y `isLoggedIn: true`. NO valida firma criptográfica ni re-consulta la BD.  
> ⚠️ `tieneRolMinimo()` usada SOLO en botón "Aplicar migración" del módulo Precio Referencia EPS. El resto de rutas no distingue roles.

---

## Patrones Críticos de Implementación

### 1. Filtro de tablas RIPS (obligatorio)

**NUNCA** filtrar `rips_ap`/`rips_am`/`rips_at` directamente por fecha o prestador. Siempre vía `consecutivo_rips` desde `rips_af`:

```sql
-- Paso 1: filtrar rips_af (tabla chica, 10.2M filas)
WITH facturas_periodo AS (
  SELECT DISTINCT ON (consecutivo_rips) consecutivo_rips, codigo_prestador
  FROM rips_af
  WHERE codigo_prestador = $1
    AND fecha_factura BETWEEN $2 AND $3
  ORDER BY consecutivo_rips
)
-- Paso 2: usar la lista como filtro contra tablas grandes
SELECT ... FROM rips_ap ap
WHERE ap.consecutivo_rips = ANY(ARRAY(SELECT consecutivo_rips FROM facturas_periodo))
```

> **Por qué `= ANY(ARRAY(subquery))`?** — `IN (subquery)` hace que el planificador use `Merge Semi Join + Parallel Seq Scan` sobre 171M filas (~42 segundos). Con `= ANY(ARRAY(...))` usa `Index Scan` (~1.7-2s). No son equivalentes para este planificador.

### 2. Deduplicación de `rips_af` (obligatorio)

`consecutivo_rips` en `rips_af` NO es único. Verificado: `consecutivo_rips = 720812` aparece en **951 filas distintas**. Siempre usar:

```sql
SELECT DISTINCT ON (consecutivo_rips) consecutivo_rips, codigo_prestador
FROM rips_af WHERE ...
ORDER BY consecutivo_rips
```

Helper compartido: `src/lib/negociacion/rips-dedup.ts` → `sqlFacturasCanonicas` / `joinFacturaCanonica`.

### 3. Municipio de agrupación = contrato, no prestador

Para agrupar por ubicación usar `ct_ips_contrato.municipio_administracion` (municipio del contrato), **NO** `ct_ips.municipio` (municipio de sede del prestador — difiere en el 33% de contratos vigentes: 91 de 279).

### 4. Columnas de código real en tablas RIPS

| Tabla | Columna de código real | Columna INCORRECTA |
|---|---|---|
| `rips_ap` | `codigo_procedimiento` | — |
| `rips_am` | `codigo_medicamento` | — |
| `rips_at` | `codigo_servicio` | `codigo_tarifario` (siempre NULL) |

### 5. FKs corruptas en `tb_tarifario_propio_detalle`

| FK | Estado real | Solución |
|---|---|---|
| `consecutivo_cup` | NULL en 100% de filas | Cruzar `d.codigo_tarifa` contra `tb_cup.codigo_interno` |
| `consecutivo_medicamento` | Poblada pero INCORRECTA (1 valor para 977K filas) | Cruzar `d.codigo_tarifa` contra `tb_medicamento.codigo_interno` |
| `consecutivo_insumo` | NULL en 100% de filas | Cruzar `d.codigo_tarifa` contra `tb_insumo.codigo_interno` |

### 6. Descripción de insumos — doble catálogo

El 4.3% de códigos en `rips_at` son CUPS de estancia (ej. `108A01` = UCI neonatal), no insumos reales. Representan el **73% del valor total** facturado bajo "insumos". Siempre usar doble JOIN con COALESCE:

```sql
LEFT JOIN tb_insumo ins ON ins.codigo_interno = at2.codigo_servicio
LEFT JOIN tb_cup cup_bkp ON cup_bkp.codigo_interno = at2.codigo_servicio
COALESCE(ins.descripcion, cup_bkp.nombre, at2.codigo_servicio) AS descripcion
```

### 7. Consultas secuenciales (no `Promise.all`) para tablas RIPS grandes

`Promise.all` con 3 consultas pesadas simultáneas sobre el mismo proxy satura la conexión (`TypeError: terminated`). Ejecutar secuencialmente.

---

## Principios No Negociables

1. Solo lectura sobre `rips_*`, `ct_*`, `tb_*`. Escritura solo en `negociacion_contratacion_*`.
2. Nunca `SELECT *` sobre `rips_ap/am/at` sin filtro de período.
3. Parámetros posicionales siempre (`$1, $2…`), nunca interpolación de valores en SQL.
4. Todo umbral de negocio (variación %, ahorro mínimo) es configurable, no hardcodeado.
5. Todo cálculo estadístico/financiero va en `src/lib/negociacion/` — nunca inline en un `.tsx`.
6. Auditoría de todo cambio de escenario y toda exportación.
