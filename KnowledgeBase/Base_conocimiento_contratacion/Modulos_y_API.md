---
name: Modulos_y_API
description: Rutas, Server Actions, Route Handlers y estructura de cada módulo del sistema
ultima_actualizacion: 2026-09-08
---

# 🔌 Módulos y API

---

## Estructura de Rutas

```
app/
├── (auth)/
│   └── login/          → Server Action: loginAction()
├── tarifarios/         → Módulo 1
├── comparativo/        → Módulo 2 + Dashboard Riesgo
├── historico-prestador/→ Módulo 3
├── consumo-frecuencia/ → Módulo 4
├── perfil-prestador/   → Módulo extra
├── top-impacto/        → Módulo extra
├── analisis-propuesta/ → Módulo extra
├── precio-referencia-eps/ → Módulo extra
└── dashboard/          → Placeholder Módulo 7
```

---

## Autenticación

### `loginAction()` — Server Action
- Recibe `username` + `password`
- Hash SHA-256 del password → busca en `negociacion_contratacion_usuario`
- Crea cookie de sesión con `{ isLoggedIn: true, username, rol, nombre }`
- ⚠️ Sin rate limiting

### Middleware
- Verifica existencia de cookie y `isLoggedIn: true` en JSON
- ⚠️ Sin validación criptográfica de firma ni re-consulta a BD
- Redirige a `/login` si no autenticado

### `tieneRolMinimo(session, rolMinimo)` — `src/lib/auth.ts`
| Rol | Nivel |
|---|---|
| `analista` | 0 |
| `jefe_contratacion` | 1 |
| `admin` | 2 |
Solo usada actualmente en botón "Aplicar migración" de `/precio-referencia-eps`.

---

## Módulo 1 — Tarifarios (`/tarifarios`)

### Server Actions / Route Handlers
- `obtenerPrestadoresConContrato()` — lista prestadores con contrato vigente
- `obtenerContratosPrestador(ips)` — contratos del prestador, clasificados por vigencia
- `obtenerDetalleContrato(consecutivoContrato)` — detalle del tarifario con `resolverValorFinal()`

### Lógica clave
- `resolverValorFinal(detalle)` — cascada: `valor_pactado` → `valor_base * (1 + %)` → `valor_base` → `valor`
- Clasificación por tipo: cruza `codigo_tarifa` vs `tb_cup.codigo_interno` (JOIN, no FK) y `sw_paquete`

---

## Módulo 2 — Comparativo + Dashboard de Riesgo (`/comparativo`)

### Server Actions
- `obtenerMunicipiosComparativos()` — municipios donde hay ≥2 prestadores
- `obtenerComparativoPorMunicipio(municipio, codigo?)` — núcleo del módulo
- `obtenerDashboardRiesgo(municipio?)` — KPIs de riesgo y score

### Archivos clave
- `src/lib/negociacion/comparativo.ts` — `dedupMejorPrecio()`, `calcularEstadisticas()`, `amplitudSegunReferencia()`
- `app/comparativo/comparativo-client.tsx` — ⚠️ archivo de alto riesgo de edición
- `app/comparativo/dashboard-riesgo-tab.tsx` — Dashboard de Riesgo (aislado)

### Consultas SQL críticas
Todas usan `c.municipio_administracion` (no `ct_ips.municipio`) para agrupar.

---

## Módulo 3 — Histórico del Prestador (`/historico-prestador`)

### Server Actions
- `obtenerHistoricoTarifas(consecutivoContrato)` — compara tarifario vigente vs `historico_tarifas_2025`

### Archivos clave
- `app/historico-prestador/historico-prestador-client.tsx` — incluye `GraficoPuntos` (SVG propio, no recharts)

---

## Módulo 4 — Consumo y Frecuencia (`/consumo-frecuencia`)

### Server Actions
- `obtenerConsumoFrecuencia(ips, desde, hasta, tipo?)` — consumo RIPS real por prestador

### Restricciones
- `MAX_DIAS_RANGO_CONSUMO = 92` días
- Consultas secuenciales (no `Promise.all`)
- Filtro siempre vía `rips_af` → `consecutivo_rips` → tablas grandes

### Archivos clave
- `consumo-frecuencia-actions.ts` — usa `rips-dedup.ts` para deduplicar

---

## Módulo Top Impacto Económico (`/top-impacto`)

### Server Actions
- `getTopImpacto(params, opciones?)` — análisis de códigos de mayor impacto
  - `opciones.soloPorCodigo = true` — evita sub-consultas de top-prestadores/top-municipios en drill-down

### Archivos clave
- `top-impacto-actions.ts` — secuencial, CTE materializada, `rips-dedup.ts`

---

## Módulo Perfil Competitivo (`/perfil-prestador`)

### Server Actions
- `obtenerPerfilPrestador(ips)` — contratos, municipios, tipos de servicio, posición relativa

---

## Módulo Análisis de Propuesta (`/analisis-propuesta`)

### Server Actions
- `analizarPropuesta(archivo, consecutivoContrato)` — comparación temporal (no persiste)
- `obtenerReferenciasMercadoEps(codigos, municipio)` — integración defensiva: captura error si la tabla no existe

### Comportamiento
- El archivo subido es **temporal** — nunca persiste en BD
- Si `negociacion_contratacion_precio_referencia_eps` no existe, el análisis continúa sin esa referencia

---

## Módulo Precios de Referencia EPS (`/precio-referencia-eps`)

### Server Actions / Route Handlers
- `cargarArchivoReferenciaEps(archivo, nit, nombre, municipio)` — parsea, resuelve municipio, hace upsert
- `aplicarMigracionPrecioReferenciaEps()` — crea la tabla si no existe (requiere rol `admin`)
- `obtenerReferenciasPorMunicipio(municipio)` — consulta precios cargados

### Resolución de municipio
Texto libre → código DANE. Si ambiguo o no encontrado → fila reportada en `municipiosNoResueltos`, no cargada.

---

## Helper Compartido — `src/lib/negociacion/rips-dedup.ts`

```ts
// Genera CTE para deduplicar facturas de rips_af
export function sqlFacturasCanonicas(alias = 'facturas_canonicas'): string
// Genera JOIN hacia esa CTE
export function joinFacturaCanonica(alias = 'facturas_canonicas'): string
```

Criterio de deduplicación:
1. Entre copias de la misma `numero_factura` del mismo `codigo_prestador`, elegir la que tenga `fecha_radica IS NOT NULL`
2. Si ninguna tiene `fecha_radica`, usar la de menor `consecutivo_rips` (desempate determinístico)

---

## Capa de BD — `src/lib/db.ts`

- Modo dual: `pg` pool (local) o proxy HTTP (`PROXY_URL`) para producción
- Errores reintentables: `"terminated"`, `"socket"`, `"ECONNRESET"`, `"other side closed"`, `UND_ERR_SOCKET`
- Nunca interpolación de valores — siempre `query(sql, [param1, param2])`
