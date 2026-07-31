---
tags: [errores, problemas-conocidos, deuda-tecnica]
---

# Problemas Comunes

## 1. `PROXY_API_KEY` con valor por defecto hardcodeado

- **Dónde**: `src/lib/db.ts`, línea del fallback `const PROXY_API_KEY = process.env.PROXY_API_KEY || "dusakawi-proxy-2024-clave-secreta";`.
- **Riesgo**: si un ambiente de producción no define explícitamente `PROXY_API_KEY`, usará esta clave de desarrollo, que además queda visible en el historial del repositorio.
- **Mitigación recomendada**: ver [[Soluciones#1. Eliminar el fallback hardcodeado de PROXY_API_KEY]].

## 2. Migración de base de datos no aplicada

- **Dónde**: `db/migrations/001_negociacion_contratacion_usuario.sql`.
- **Síntoma**: `loginAction` fallará con "No fue posible validar las credenciales (la tabla de usuarios aún no existe...)" hasta que se aplique manualmente.
- **Causa**: el conector de solo lectura usado para análisis no puede ejecutar DDL/DML de escritura; el entorno de scaffold no tenía salida de red hacia el proxy.
- **Mitigación**: ver [[Flujo Migración]] y [[Soluciones#2. Aplicar la migración pendiente]].

## 3. Hash de contraseña sin sal (SHA-256 puro)

- **Dónde**: `sha256Hex()` en `src/lib/auth.ts`.
- **Riesgo**: sin sal, hashes idénticos para contraseñas idénticas son vulnerables a ataques de tabla arcoíris (rainbow table) si la BD se filtra.
- **Por qué existe así**: consistencia deliberada con `administrativo.usuarios_tarifario` del resto del ecosistema.
- **Mitigación**: ver [[Soluciones#3. Migrar a un hash con sal]].

## 4. Sin rate limiting en login

- **Dónde**: `loginAction` en `src/app/actions/auth-actions.ts`.
- **Riesgo**: un atacante puede intentar credenciales indefinidamente sin bloqueo ni retardo.
- **Mitigación**: ver [[Soluciones#4. Rate limiting de login]].

## 5. Timeout de proxy incompatible con serverless

- **Dónde**: `PROXY_TIMEOUT_MS = 90000` en `src/lib/db.ts`, vs. límites de funciones serverless en Vercel (ver [[Vercel]]).
- **Riesgo**: si se despliega en un plan con timeout de función < 90s, cualquier query de agregación pesada fallará antes de que el proxy responda.
- **Mitigación**: ver [[Soluciones#5. Ajustar timeouts según el plan de hosting]].

### 5b. Caso real confirmado: Top Impacto (`/top-impacto`) congelado en 92%

- **Síntoma reportado por el usuario (2026-07-31)**: con filtros `tipo="Todos"` + municipio (Valledupar) + "Todos los contratos" (sin prestador que acote), la barra de progreso simulada quedaba congelada indefinidamente en "Armando los gráficos de mayor impacto… (92%)". Cita textual: *"se quedo aca no avanza"*.
- **Por qué es exactamente el riesgo #5**: `getTopImpacto()` corre 3 queries de agregación SECUENCIALES sobre RIPS completos (ver problema #13 y la nota de arquitectura 2026-07-29 en `top-impacto-actions.ts` sobre por qué no se paralelizan) — es el caso más pesado del módulo, el que más probablemente supera el timeout de función serverless antes de que `PROXY_TIMEOUT_MS` (90s) siquiera se cumpla. `consultar()` en `top-impacto-client.tsx` solo tenía `try/finally` (sin `catch`), así que si la función serverless muere sin que la promesa del cliente se resuelva NI se rechace, no había ningún camino de código que apagara la barra — quedaba girando para siempre, sin mensaje.
- **Fix aplicado (2026-07-31)**, en dos partes complementarias — ver [[Soluciones#5. Ajustar timeouts según el plan de hosting]] para el detalle de código:
  1. `export const maxDuration = 120` agregado a `src/app/(protegido)/top-impacto/page.tsx`, pidiéndole a Vercel más margen de ejecución para las Server Actions invocadas desde esa página (Next.js/Vercel recorta este valor automáticamente si el plan contratado no lo permite; no rompe nada declararlo).
  2. Aviso de seguridad del lado del cliente en `consultar()` (`top-impacto-client.tsx`): un `setTimeout` de 100s que, si la consulta real no resolvió antes, libera la UI igual y muestra un banner de error accionable (sugiere acotar el `tipo` o elegir un prestador puntual), en vez de dejar la barra congelada sin explicación. Se agregó también un `catch` real (antes no existía) para errores que sí llegan a rechazar la promesa.
- **Limitación honesta**: este sandbox no tiene salida de red hacia `pg-proxy.onrender.com` (confirmado con `curl` → `HTTP_CODE:000`), así que el fix no pudo reproducirse ni confirmarse en vivo — es la mitigación del riesgo ya documentado, no una causa raíz 100% verificada contra el entorno real de producción. Si el problema persiste tras este fix, el siguiente paso es confirmar en el dashboard de Vercel el límite de duración de función del plan contratado (ver [[Vercel]]).

## 6. Mensaje de error ambiguo en login

- **Dónde**: `loginAction`, catch de consulta SQL.
- **Síntoma**: el mismo mensaje cubre "la tabla no existe" y "el proxy no está disponible" — dos causas raíz distintas con el mismo texto.
- **Mitigación**: ver [[Soluciones#6. Diferenciar errores de tabla inexistente vs. proxy caído]].

## 7. Validación de middleware es solo de forma, no de autenticidad

- **Dónde**: `src/middleware.ts` — solo verifica `JSON.parse(cookie).isLoggedIn === true`.
- **Riesgo**: la cookie no está firmada criptográficamente; en teoría, cualquiera que pueda escribir cookies en el navegador (ej. una extensión maliciosa) podría falsificar `isLoggedIn: true`. En la práctica, la cookie es `httpOnly` (no accesible desde JS del navegador) lo que mitiga XSS, pero no sustituye una firma (JWT/HMAC).
- **Mitigación**: ver [[Soluciones#7. Firmar o validar la cookie de sesión contra el servidor]].

## 8. `tb_tarifario_propio_detalle.consecutivo_cup` siempre en NULL

- **Dónde**: BD ARYUWIS, tabla `tb_tarifario_propio_detalle` (todo tarifario de tipo servicio).
- **Síntoma**: si se filtra `consecutivo_cup IS NOT NULL` para detectar Procedimientos reales, el resultado es 0 filas aunque el tarifario tenga miles de CUPS reales.
- **Causa**: ARYUWIS nunca resuelve esa FK al cargar/migrar estos tarifarios (verificado contra 114.226 filas en toda la BD, no solo un contrato).
- **Mitigación**: ver [[Soluciones#8. Clasificar Procedimientos por código, no por la FK consecutivo_cup]] y el detalle completo en [[Tablas#Módulo 1 (Tarifario) — detalle real de tb_tarifario_propio_detalle]].

## 8b. `consecutivo_medicamento`/`consecutivo_insumo` tampoco confiables

- **Dónde**: `tb_tarifario_propio_detalle`, tarifarios de tipo medicamento/insumo.
- **Síntoma real reportado**: en el contrato vencido `20001_132EV`, la pestaña Medicamentos mostraba "LOSARTAN 50mg" repetido ~1.559 veces con precios distintos (screenshot del usuario, 2026-07-28).
- **Causa**: `consecutivo_medicamento` casi nunca coincide con el código real de la fila — está poblada pero apunta a **un solo registro equivocado** compartido por miles de filas de códigos distintos (verificado: 1 de 977.315 filas en toda la BD tenía la FK correcta). `consecutivo_insumo` es **siempre NULL**, igual que `consecutivo_cup` (problema #8).
- **Mitigación**: ver [[Soluciones#8. Clasificar Procedimientos por código, no por la FK consecutivo_cup]] (mismo patrón, aplicado también a medicamentos/insumos) y [[Tablas]].

## 9. `__webpack_require__.n is not a function` en `/login` (Next.js dev) — RECURRENTE, 5 apariciones hasta resolverse de raíz

- **Dónde**: compilación de desarrollo (`npm run dev`), en cualquier página que importe `lucide-react` (se vio primero en `src/app/login/login-form.tsx`, pero la causa afectaba a los 14 archivos del proyecto que importaban de `lucide-react`).
- **Síntoma**: error de runtime al renderizar la página, reproducible en cada reinicio de `npm run dev`. Se reportó **5 veces** con el mismo stack trace: el primer diagnóstico (caché de webpack corrupta) y el segundo (agregar `modularizeImports` para forzar el import explícito por ícono) NO lo resolvieron — el error seguía volviendo.
- **Causa real (encontrada 2026-07-28, verificada)**: Next.js 15 optimiza automáticamente los imports de `lucide-react` vía `experimental.optimizePackageImports`, **habilitado por defecto para este paquete sin necesidad de configurarlo**. El fix anterior (agregar `modularizeImports` manual para el mismo paquete) NO reemplazaba esa optimización automática — ambas convivían y se aplicaban **a la vez** sobre el mismo import, produciendo una interop CJS/ESM rota (exactamente `__webpack_require__.n is not a function`). Por eso el error sobrevivía incluso con `.next`/`node_modules` limpios: nunca fue un problema de caché, sino un conflicto entre dos transformaciones de webpack activas simultáneamente sobre el mismo paquete.
- **Mitigación definitiva**: ver [[Soluciones#9. Eliminar el barrel import de lucide-react — imports profundos oficiales, sin modularizeImports]].

## 10. Caché persistente de webpack (`.next/cache/webpack`) sobrevive a reinicios de `npm run dev`

- **Dónde**: `.next/cache/webpack/*` — Next.js la reutiliza a propósito entre reinicios para arrancar más rápido.
- **Síntoma**: un error de compilación puntual (p. ej. al agregar una dependencia nueva) se repite idéntico en cada `npm run dev` posterior, aunque el código ya esté corregido, porque el reinicio normal no limpia esa caché en disco.
- **Mitigación**: ver [[Soluciones#10. Desactivar la caché de webpack en modo dev]].

## 11. `A "use server" file can only export async functions, found object`

- **Dónde**: `src/app/actions/tarifario-actions.ts` (tenía `export const CONTRATOS_EXCLUIDOS_MIGRACION = [...]` al lado de las Server Actions).
- **Síntoma**: error de runtime en cualquier página que dependa (directa o indirectamente) de ese archivo, apenas se agrega un segundo archivo `"use server"` que importa esa constante (en este caso `comparativo-actions.ts` importando `CONTRATOS_EXCLUIDOS_MIGRACION` desde `tarifario-actions.ts`).
- **Causa**: un archivo con la directiva `"use server"` en la cabecera SOLO puede exportar funciones `async` — cualquier otra cosa exportada (constante, array, objeto, clase) rompe el build en runtime. `export interface`/`export type` SÍ están permitidos porque se borran en compilación (no son un valor en runtime). Mismo patrón de bug ya documentado en `Proyecto_Dusakawi` (`CLAUDE.md` sección 13, `TABLA_PROGRAMAS_PBS` en `consolidado-actions.ts`) — recurrencia del mismo error de arquitectura en un proyecto distinto.
- **Mitigación**: ver [[Soluciones#11. Mover constantes compartidas fuera de los archivos "use server"]].

## 12. `npm install recharts` queda en estado parcial/corrupto en el sandbox

- **Dónde**: cualquier `npm install <paquete>` ejecutado desde el sandbox de Claude mientras el usuario tiene `npm run dev` corriendo localmente sobre la misma carpeta mapeada.
- **Síntoma**: el paquete queda a medias en `node_modules/<paquete>` (en el caso real, `node_modules/recharts` con las carpetas `es6/`, `lib/`, `umd/` pero **sin `package.json` propio** — un paquete npm real siempre lo trae). `package.json` del proyecto **no llega a modificarse** (el `npm install` nunca completa). Intentar `rm -rf` esa carpeta parcial falla con `Operation not permitted` — mismo síntoma que el problema conocido de no poder borrar `.next` mientras el dev server local tiene los archivos abiertos.
- **Causa probable**: el mismo lock de archivos del sistema operativo del usuario (antivirus/OneDrive/editor con la carpeta abierta) que ya afecta el borrado de `.next`, aplicado esta vez a una instalación de paquete en curso — el proceso de red se corta o se congela a medio extraer el tarball.
- **Mitigación aplicada**: no se insistió con reintentar el `npm install`. Se construyó la funcionalidad que requería el paquete (un gráfico de líneas) con un componente SVG propio, sin dependencia nueva — ver [[Contratación#Sin gráfico de terceros (recharts) — SVG propio]]. Como `package.json` nunca se modificó, la carpeta parcial es inofensiva mientras ningún archivo importe `"recharts"`.
- **Si se necesita instalar un paquete nuevo de verdad**: pedir al usuario que detenga `npm run dev` antes, igual que ya se pide para poder borrar `.next`, y si una instalación anterior quedó a medias, que borre manualmente esa carpeta parcial en `node_modules/` antes de reintentar.

## 13. `rips_af.consecutivo_rips` no es único — usarlo como condición de `JOIN` sin deduplicar causa fanout (inflación de valores)

- **Dónde**: `src/app/actions/top-impacto-actions.ts` (`construirFragmentoFacturas`), pero la regla aplica a cualquier query futura de cualquier módulo que necesite un `JOIN` de vuelta hacia `rips_af`.
- **Síntoma real reportado**: módulo "Top Impacto Económico" mostrando un KPI de "Valor total radicado" de $8.765.742.161.989 (8.76 billones) y un código individual ("S50008", transporte intermunicipal) con $7.483.119.066.500 — ~85% del gasto total de la EPS en un solo código, cifra imposible. El usuario lo notó de inmediato: "después de un rato me arroja información poco real, me parecía más real la primera".
- **Causa**: se asumía (patrón usado en todo el proyecto) que `consecutivo_rips` identifica una factura única. Verificado que es falso — se comporta como un identificador de **lote/radicación** compartido por muchas facturas del mismo prestador el mismo día (caso real: `consecutivo_rips = 720812` con 951 filas distintas de `rips_af`, 951 facturas diferentes, mismo `codigo_prestador`). Un `JOIN facturas_periodo fp ON fp.consecutivo_rips = <alias>.consecutivo_rips` contra una CTE de `rips_af` sin deduplicar multiplica cada línea de detalle por la cantidad de facturas del lote (hasta 951x en el caso verificado).
- **Mitigación**: `SELECT DISTINCT ON (consecutivo_rips) ... ORDER BY consecutivo_rips` en la CTE antes de usarla como lado de un `JOIN`. Usar `consecutivo_rips` solo como **filtro** (`WHERE consecutivo_rips = ANY(...)`) sigue siendo seguro — no multiplica filas; el problema es exclusivo de usarlo como condición de `JOIN`. Ver diagnóstico completo, cifras verificadas y el fix en [[Tablas#🔴 Hallazgo crítico verificado (2026-07-29) — rips_af.consecutivo_rips NO es único, no es un ID de factura]] y en [[Contratación#🔴 Bug crítico introducido por la mejora anterior, corregido el mismo día: `rips_af.consecutivo_rips` NO es único]].

## Ver también
- [[Soluciones]]
- [[Autenticación]]
- [[Middleware]]
- [[Tablas]]
