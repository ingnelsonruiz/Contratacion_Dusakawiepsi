---
name: Bugs_y_Correcciones
description: 22 bugs documentados con síntoma, causa raíz, magnitud y corrección aplicada
ultima_actualizacion: 2026-09-08
---

# 🐛 Bugs y Correcciones (22 documentados)

---

## Bug 1 — `consecutivo_cup` siempre NULL en `tb_tarifario_propio_detalle`
**Estado:** ✅ Corregido  
**Síntoma:** No era posible distinguir "Procedimiento real" de "Otro" usando la FK.  
**Causa:** `d.consecutivo_cup` nunca está poblada (0/114.226 filas verificadas a nivel de toda la tabla). No es un problema de un contrato puntual.  
**Corrección:** Módulo 1 cruza `d.codigo_tarifa` contra `tb_cup.codigo_interno` (índice único `tb_cup_idx_unico`). 81.086 de 114.226 filas (71%) son recuperables así.

---

## Bug 2 — `consecutivo_medicamento` peor que NULL: apunta al registro INCORRECTO
**Estado:** ✅ Corregido  
**Síntoma:** Contrato `20001_132EV`, 1.570 filas con códigos y precios distintos tenían **todas** `consecutivo_medicamento = 124550` (LOSARTAN 50mg) — la UI mostraba "LOSARTAN" repetido 1.559 veces.  
**Magnitud:** De 977.315 filas en tarifarios de medicamentos, solo **1** tenía la FK coincidiendo con su propio código.  
**Corrección:** Medicamentos resuelve el maestro cruzando `d.codigo_tarifa` contra `tb_medicamento.codigo_interno`.

---

## Bug 3 — `consecutivo_insumo` siempre NULL
**Estado:** ✅ Corregido  
**Magnitud:** 23.000/23.000 filas verificadas sin FK.  
**Corrección:** Cruzar `d.codigo_tarifa` contra `tb_insumo.codigo_interno` (77% recuperable a escala de BD completa).

---

## Bug 4 — Semáforo no distinguía DIRECCIÓN — falsos "críticos" para prestadores baratos
**Estado:** ✅ Corregido  
**Síntoma:** Código 839601, mediana $24.801 en Valledupar. Un prestador con $17.800 (**28,23% más barato**) salía en rojo "Crítico" — igual que uno con $385.000 (**1.452% más caro**).  
**Corrección:** `NivelSemaforo` pasó de 3 a 5 valores: `"ok" | "alerta" | "critico"` (cobra MÁS) y `"favorable" | "muyFavorable"` (cobra MENOS).

---

## Bug 5 — Filtro de semáforo no filtraba prestadores dentro del código
**Estado:** ✅ Corregido  
**Síntoma:** El usuario filtró "Favorable" y seguían apareciendo prestadores "Crítico" dentro del mismo código.  
**Corrección:** Además de filtrar qué códigos se muestran, se recorta el array `prestadores` de cada código a solo los que están en el/los estado(s) elegidos.

---

## Bug 6 — Amplitud % siempre dividía por Promedio aunque la referencia fuera Mediana
**Estado:** ✅ Corregido  
**Síntoma:** Al verificar el cálculo a mano con Mediana como referencia, el número no cuadraba.  
**Corrección:** `calcularEstadisticas()` devuelve `amplitudPctPromedio` y `amplitudPctMediana`. Nuevo helper `amplitudSegunReferencia(fila, referencia)` es la única fuente de verdad.

---

## Bug 7 — `rips_af.consecutivo_rips` NO es único — KPI inflado hasta 951x
**Estado:** ✅ Corregido  
**Síntoma/Magnitud:** `consecutivo_rips = 720812` aparece en **951 filas distintas** de `rips_af`. Un KPI se infló de $11.260.116.450 reales a $7.483.119.066.500 mostrados.  
**Causa:** `JOIN facturas_periodo fp ON fp.consecutivo_rips = ap.consecutivo_rips` sin deduplicar.  
**Corrección:** `DISTINCT ON (consecutivo_rips)` antes de cualquier JOIN hacia `rips_af`. Helper: `rips-dedup.ts`.

---

## Bug 8 — Contratos capitados generan falsos "críticos" por valores en cero
**Estado:** ✅ Corregido  
**Síntoma:** Prestador con `valorFinal = 0` (capitado) vs. otro con $38.000 (por evento) — comparar infla artificialmente la amplitud.  
**Corrección:** Se descartan filas con `valorFinal <= 0` antes de agrupar/calcular estadísticas. Si quedan menos de 2 prestadores con precio real, el código no se muestra.

---

## Bug 9 — Municipio de agrupación del Módulo 2 era del PRESTADOR, no del CONTRATO
**Estado:** ✅ Corregido (2026-07-30)  
**Síntoma:** GYO MEDICAL I.P.S. S.A.S. mostraba "Municipios: 1 — Riohacha", pero sus contratos están en Maicao y San Juan Del Cesar.  
**Magnitud:** Afectó al 33% de contratos vigentes (91 de 279).  
**Causa:** Se usaba `ct_ips.municipio` (sede) en vez de `ct_ips_contrato.municipio_administracion` (contrato).  
**Corrección:** Las 4 consultas de agrupación del Módulo 2 ahora usan `c.municipio_administracion`.

---

## Bug 10 — `rips_at.codigo_tarifario` siempre NULL — el código real va en `codigo_servicio`
**Estado:** ✅ Corregido  
**Síntoma:** VITALSALUD DEL CESAR SAS, febrero 2026 — "Insumo" salía sin código ni descripción, agregando 19.303 unidades y $349.775.074 en un grupo `NULL`.  
**Verificación:** TABLESAMPLE SYSTEM(2) sobre ~1.2M filas: 0 filas con `codigo_tarifario` poblado, 100% con `codigo_servicio` poblado.  
**Corrección:** `obtenerConsumoInsumos()` ahora agrupa y cruza por `at2.codigo_servicio`.

---

## Bug 11 — Códigos de "insumos" que son CUPS de estancia — sin descripción
**Estado:** ✅ Corregido  
**Síntoma:** Códigos `108A01`, `107M01`, `106M01` aparecían sin descripción (mostraban "108A01 — 108A01").  
**Magnitud:** 354 códigos (4,3%) resuelven ÚNICAMENTE en `tb_cup` y representan **$49.329.517.821 de $67.523.703.878 (73% del total facturado bajo "insumos")**.  
**Corrección:** `LEFT JOIN` de respaldo contra `tb_cup` con `COALESCE(ins.descripcion, cup_bkp.nombre, codigo)`.

---

## Bug 12 — Facturas duplicadas en múltiples lotes — inflación hasta 13x
**Estado:** ✅ Corregido (2026-07-30)  
**Síntoma:** Factura `MV06370` mostraba $850.000 / 10 unidades vs. $170.000 / 2 unidades reales en ARYUWIS (5x de diferencia). `rips_af` tenía 5 filas para esa factura.  
**Magnitud EPS-completa 2026:** 235.178 filas vs. 186.108 facturas distintas. Inflación $16.165.439.260 (7,4%). Hasta 13x en casos puntuales.  
**Criterio de deduplicación:** Entre copias, elegir la que tenga `fecha_radica IS NOT NULL`. Si ninguna, incluir 1 arbitraria (desempate por `consecutivo_rips`).  
**Corrección:** Helper `src/lib/negociacion/rips-dedup.ts` (`sqlFacturasCanonicas`/`joinFacturaCanonica`). Aplicado en `top-impacto-actions.ts`, `consumo-frecuencia-actions.ts`, `movimiento-rips-actions.ts`.

---

## Bug 13 — `TypeError: terminated` en Top Impacto Económico
**Estado:** ✅ Corregido  
**Causa:** `getTopImpacto` lanzaba 3 consultas pesadas con `Promise.all` — la concurrencia saturó el proxy y cerró la conexión.  
**Corrección:**  
1. Ejecución **secuencial** en vez de `Promise.all`.  
2. CTE materializada (`WITH facturas_periodo AS MATERIALIZED`).  
3. `db.ts` ampliado: errores reintentables incluyen `"terminated"`, `"socket"`, `"ECONNRESET"`, `"other side closed"`, `UND_ERR_SOCKET`.

---

## Bug 14 — Drill-down de Top Impacto recalculaba consultas pesadas que no usaba
**Estado:** ✅ Corregido  
**Síntoma:** Drill-down Nivel 2 con `ips` fijo ejecutaba igualmente las sub-consultas de "top prestadores"/"top municipios" (que no se muestran).  
**Corrección:** Llamar con `opciones = { soloPorCodigo: true }` para saltarse esas 2 consultas redundantes.

---

## Bug 15 — Códigos de prestador "huérfanos" — 7.9% del valor invisible en Top Impacto
**Estado:** ✅ Corregido  
**Síntoma:** 62% del valor de CLINICA MEDICOS S.A. desaparecía del ranking silenciosamente con INNER JOIN.  
**Magnitud:** $4.651.600.354 de $58.560.654.810 (7,9%) de `rips_ap` 2026 sin fila en `ct_ips`.  
**Corrección:** `LEFT JOIN` en vez de `JOIN`. Rows sin match etiquetadas `"Código no registrado: <codigo>"`.

---

## Bug 16 — Error 413 en "Movimientos RIPS" — array de `consecutivo_rips` superaba límite del proxy
**Estado:** ✅ Corregido  
**Causa:** Lista de `consecutivo_rips` resuelta en Node y enviada como parámetro HTTP — superó el límite de payload del proxy.  
**Corrección:** Las 2 consultas fusionadas en UNA sola con el filtro de `rips_af` como subconsulta. El array nunca sale de Postgres. Usando `= ANY(ARRAY(subquery))`.

---

## Bug 17 — `recharts` corrupto al instalar con `npm run dev` corriendo
**Estado:** ⚠️ Pendiente de limpiar  
**Síntoma:** Carpeta `node_modules/recharts` sin `package.json` propio. `package.json` del proyecto **no llegó a modificarse**.  
**Workaround:** Gráficos con HTML/CSS puro (barras `<div>`) o SVG propio (`GraficoPuntos` en `historico-prestador-client.tsx`).  
**Para resolver:** Limpiar manualmente la carpeta corrupta antes de reintentar `npm install recharts`.

---

## Bug 18 — `comparativo-client.tsx` — corrupción por bytes NUL al editar
**Estado:** ⚠️ Riesgo activo  
**Descripción:** Archivo grande con historial de corrupción por bytes NUL.  
**Workaround:** El Dashboard de Riesgo fue aislado en `dashboard-riesgo-tab.tsx` para no crecer dentro del mismo componente.

---

## Bug 19 — `lucide-react` — bug con `modularizeImports` de Next.js
**Estado:** ⚠️ Workaround activo  
**Descripción:** Bug conocido con la optimización automática de Next.js.  
**Workaround:** Ver `modularizeImports` en `next.config.ts` — forzar import explícito.

---

## Bug 20 — Middleware sin validación criptográfica de firma
**Estado:** ⚠️ Pendiente  
**Descripción:** El middleware solo verifica que la cookie exista y contenga `isLoggedIn: true` en JSON. NO valida la firma ni re-consulta la BD. Validación de forma, no de autenticidad.

---

## Bug 21 — Hash SHA-256 sin sal — vulnerable a rainbow tables
**Estado:** ⚠️ Pendiente (decisión de arquitectura)  
**Descripción:** Mismo patrón que `administrativo.usuarios_tarifario` del ecosistema — consistencia interna pero sin estándar criptográfico más fuerte.  
**Mejora planificada:** Migrar a `bcrypt`/`argon2` con sal, manteniendo compatibilidad con hashes SHA-256 existentes.

---

## Bug 22 — Sin rate limiting en `loginAction`
**Estado:** ⚠️ Pendiente  
**Descripción:** No hay rate limiting ni bloqueo tras intentos fallidos.  
**Mejora planificada:** Rate limiting por IP/usuario.
