---
tags: [reglas-negocio, contratacion, tarifas]
---

# Reglas de Negocio — Contratación

## Propósito
Este es el dominio central del proyecto: reglas que gobiernan cómo se analizan y comparan las tarifas contratadas con la red prestadora para apoyar la negociación de contratos.

## Reglas ya validadas (heredadas del componente legado, a reutilizar)

Documentadas en `docs/ARQUITECTURA.md` §1.1 como "conocimiento de dominio ya validado, no lógica descartable":

| Regla | Descripción | Estado en este proyecto |
|---|---|---|
| **Cálculo estadístico de comparación** | Media y mediana por código (CUPS/CUM/insumo) | ✅ Implementado, Módulo 2 — siempre dentro del mismo municipio (ver más abajo) |
| **Deduplicación por mejor precio** | Cuando hay múltiples tarifas para el mismo `NIT + código`, se toma el mejor precio | ✅ Implementado, Módulo 2 |
| **Semáforo de variación porcentual** | Clasifica la variación de tarifa: **±1% = OK**, **1–10% = alerta**, **>10% = crítico** | ✅ Implementado, Módulo 2 — umbrales **configurables** en la propia UI (ver [[Validaciones]]) |
| **Cruce contra consumo real** | Se cruza la tarifa contra RIPS AP/AM para estimar impacto financiero y ahorro potencial | ⏳ Planificado, Módulo 4 |
| **Matching prestador↔RIPS** | 4 estrategias de fallback (código habilitación → NIT → NIT sin últimos 3 dígitos → NIT sin ceros) | ⏳ Planificado, ver [[Patrones#Matching prestador↔RIPS]] |

> [!important] Inconsistencia detectada en el sistema legado, a corregir
> El componente original usaba umbrales **inconsistentes**: 10% en un módulo, ±5 COP absolutos en otro. La nueva arquitectura exige que **todo umbral sea configurable** y expresado en el mismo tipo de unidad (porcentaje) salvo que el negocio pida explícitamente lo contrario.

## Regla de independencia de datos vs. aplicación

- Los tarifarios, contratos y RIPS **viven en `base_sie_dusakawi`** y no se duplican.
- La independencia de este proyecto respecto a `Proyecto_Dusakawi` es de **código y despliegue**, no de datos.
- Toda tabla que este proyecto escribe usa el prefijo `negociacion_contratacion_`.

Ver contexto completo en [[Decisiones ADR#ADR-001]].

## Snapshots versionados en vez de "foto congelada"

Regla de diseño explícita: la comparación histórica de tarifas **no puede ser una carga manual puntual** (como el "2025 vs 2026" del sistema legado). Debe generarse por **snapshots periódicos reales** (`negociacion_contratacion_snapshot_tarifario`), permitiendo series temporales año tras año. Ver [[Tablas#negociacion_contratacion_snapshot_tarifario]].

## Estado de implementación

> [!warning]
> Las reglas de la tabla anterior (comparación estadística, semáforo, matching RIPS) siguen sin código — pertenecen a los Módulos 2-4, todavía no iniciados. Lo que sí está implementado y en producción es el **Módulo 1 — Tarifario Vigente e Histórico** (`/tarifarios`), con las reglas nuevas documentadas abajo.

## Reglas implementadas — Módulo 1 (Tarifario Vigente e Histórico) ✅

### Vigencia de un contrato es por fecha, no por el código `estado`

`ct_ips_contrato.estado` (smallint) **no tiene una tabla maestra confiable** que traduzca sus códigos a un significado de negocio (se descartó `temp_ct_ips_estado_contrato_csv`, un snapshot de migración cuyos valores no coinciden con los códigos reales actuales). Verificado con datos reales: `estado=8` es el más común (2.148 contratos) pero casi ninguno vigente por fecha; `estado=3` (278 contratos) están **todos** vigentes por fecha; `estado=10` (265) ninguno vigente.

**Regla adoptada**: la vigencia se calcula exclusivamente por fecha, independiente del código de estado:

```ts
// src/lib/negociacion/formato.ts
function esContratoVigente(fechaInicio, fechaTerminacion) {
  const hoy = new Date();
  return new Date(fechaInicio) <= hoy && new Date(fechaTerminacion) >= hoy;
}
```

El filtro "Vigencia" del listado `/tarifarios` (vigente/vencido/todos) usa esta misma regla vía SQL (`fecha_inicio <= CURRENT_DATE AND fecha_terminacion >= CURRENT_DATE`). El código `estado` se sigue mostrando en la UI ("Estado N") solo como dato informativo, sin mapear a una etiqueta de negocio inventada.

> [!info] Alcance temporal operativo
> El equipo de Contratación trabaja con contratos **desde 2025 hasta la fecha actual**. No hay un filtro de año explícito en `/tarifarios` — el filtro de vigencia por fecha ya cubre el caso de uso real sin necesidad de acotar por año.

### Resolución del valor final

`tb_tarifario_propio_detalle` trae hasta 4 columnas de valor (`valor`/`valor_servicio`, `valor_base`, `valor_pactado`, `valor_regulado`) y no todas están pobladas para todo tipo de contrato (verificado: contratos capitados antiguos solo usan `valor`/`valor_servicio`, con `valor_base`/`valor_pactado` en 0). Prioridad de resolución (`resolverValorFinal()` en `src/lib/negociacion/formato.ts`):

1. `valor_pactado` si es > 0 (ya es el valor negociado final).
2. `valor_base * (1 + porcentaje_tarifa/100)` si `valor_base` > 0 y hay % negociado.
3. `valor_base` si es > 0 sin porcentaje (0% de variación sobre el manual).
4. `valor` (columna general) como último recurso.

### Clasificación de Procedimientos vs. Otros

Ver el hallazgo completo de por qué **no se usa la FK `consecutivo_cup`** en [[Tablas#Módulo 1 (Tarifario) — detalle real de tb_tarifario_propio_detalle]]. Regla final, dentro del tarifario de tipo "servicio" de un contrato:

- **Procedimientos**: `codigo_tarifa` coincide con `tb_cup.codigo_interno` (join, no FK) y `sw_paquete = 0`.
- **Otros**: no hay coincidencia en `tb_cup` (ítems negociados sin CUPS estándar — ej. medicina tradicional indígena, consultas de especialidad con sufijo `-CT`), y `sw_paquete = 0`.
- **Paquetes**: `sw_paquete = 1`, cruzando los 3 tarifarios del contrato (servicios+medicamentos+insumos) con el origen etiquetado.
- **Medicamentos** e **Insumos** son tarifarios *distintos* del contrato (no vienen del mismo `consecutivo_tarifa` que Procedimientos/Otros).

> [!danger] Corrección 2026-07-28 — `consecutivo_medicamento`/`consecutivo_insumo` tampoco son confiables
> Se asumió inicialmente que estas 2 FKs sí eran confiables (a diferencia de `consecutivo_cup`). Un caso real reportado por el usuario lo desmintió: el contrato vencido `20001_132EV` mostraba el medicamento "LOSARTAN" repetido 1.559 veces con precios distintos en la pestaña Medicamentos. Verificado: `consecutivo_medicamento` estaba poblada pero **apuntando al mismo registro incorrecto** en el 99,9% de los casos (a escala de toda la BD: solo 1 de 977.315 filas coincidía). `consecutivo_insumo` resultó **siempre NULL**, igual que `consecutivo_cup`. **Fix aplicado**: Medicamentos e Insumos ahora también resuelven el maestro cruzando `d.codigo_tarifa` contra `tb_medicamento.codigo_interno` / `tb_insumo.codigo_interno`, exactamente como Procedimientos — ver detalle completo en [[Tablas#Módulo 1 (Tarifario) — detalle real de tb_tarifario_propio_detalle]].

### Pestañas siempre visibles vs. condicionales

Procedimientos, Medicamentos e Insumos son las 3 pestañas **fijas** del módulo — siempre se muestran (incluso con 0 registros, con mensaje explícito de "este contrato no tiene tarifario de X cargado en ARYUWIS"), porque ocultarlas se confundía con un error del sistema. Paquetes y Otros sí son condicionales ("si existen"/"si aplica") porque no todo contrato tiene paquetes negociados ni ítems sin CUPS.

## Reglas implementadas — Módulo 2 (Comparativo entre Prestadores) ✅

### La comparación es SIEMPRE dentro del mismo municipio

Pedido explícito del usuario (2026-07-28): comparar tarifas de un mismo código entre prestadores de municipios distintos mezcla dos efectos — la variabilidad legítima "por ubicación" (el contrato se ofertó/negoció distinto según dónde está el prestador) con la variabilidad real "por negociación" (la que sí interesa detectar para tomar decisiones). Por eso el Módulo 2 nunca agrupa ni compara entre municipios: toda estadística (mínimo/máximo/promedio/mediana/semáforo) se calcula dentro de un mismo `ct_ips.municipio`.

Dos formas de llegar a la comparación (ambas implementadas, ver [[Tablas#Módulo 2 (Comparativo)]]):
1. **Por municipio**: se elige un municipio y se listan todos los códigos que tienen ≥2 prestadores vigentes en ese municipio, ordenados por mayor variabilidad primero.
2. **Por código**: se busca un código puntual y se muestra, agrupado por municipio, en cuáles municipios ese código tiene ≥2 prestadores comparables.

### Solo se muestran municipios/códigos donde la comparación es posible

Un municipio con un solo prestador, o un código que en un municipio solo tiene un prestador, no se muestra — no hay nada que comparar. Esto se decide con `HAVING COUNT(DISTINCT c.ips) >= 2` en SQL (para la lista de municipios) y con un filtro equivalente en JS después de agrupar (para la lista de códigos).

### Deduplicación por mejor precio (heredada del componente legado, reimplementada)

Si el mismo prestador (mismo `ips`) tiene más de una fila para el mismo código (ej. varios contratos vigentes al mismo tiempo, o líneas repetidas dentro del mismo tarifario), se toma el valor **más bajo** como su precio real para ese código antes de calcular cualquier estadística — `dedupMejorPrecio()` en `src/lib/negociacion/comparativo.ts`.

### Exclusión de valores en cero (contratos capitados)

Ver hallazgo completo en [[Tablas#Módulo 2 (Comparativo)]]: un `valorFinal` de 0 no es un dato faltante, es un ítem de un contrato capitado que no se tarifa por evento. Se descarta ANTES de calcular estadísticas — de lo contrario, comparar $0 contra un valor real infla artificialmente la "amplitud" del grupo y genera falsos "críticos" en el semáforo.

### Semáforo de variación porcentual — umbrales configurables, no hardcodeados

Corrigiendo la inconsistencia ya detectada en el sistema legado (ver sección "Reglas ya validadas" arriba): `clasificarSemaforo()` recibe los umbrales como parámetro (`UmbralesSemaforo { alertaPct, criticoPct }`, por defecto `{1, 10}`). La UI de `/comparativo` expone un panel para ajustar ambos valores en tiempo real — cambiar el umbral reclasifica los datos ya cargados sin volver a consultar la base de datos (el cálculo de variación % ya viene resuelto desde el servidor; solo la clasificación se recalcula en cliente).

> [!danger] Corrección 2026-07-28 — el semáforo debe distinguir DIRECCIÓN, no solo magnitud
> Reportado por el usuario con un caso real: código 839601, mediana $24.801 en Valledupar. Un prestador con $17.800 (**28,23% más barato** que la mediana) salía en rojo "Crítico" — el mismo color/urgencia que otro prestador con $385.000 (**1.452% más caro**). Esto confunde dos cosas opuestas: un prestador mucho más barato NO es un riesgo a vigilar de la misma forma que uno mucho más caro (desde la perspectiva de Dusakawi como pagador, más barato es favorable, no crítico).
>
> **Fix**: `clasificarSemaforo()` ahora usa el signo de la variación además de la magnitud. `NivelSemaforo` pasó de 3 a 5 valores: `"ok" | "alerta" | "critico"` (el prestador cobra MÁS que la referencia — sí es un riesgo de sobrecosto a vigilar) y `"favorable" | "muyFavorable"` (cobra MENOS — se muestra en tono azul, no rojo, porque no es un riesgo). Los umbrales (`alertaPct`/`criticoPct`) siguen siendo los mismos números para ambas direcciones; solo cambia la etiqueta/color según el signo. Ver `src/lib/negociacion/comparativo.ts` y `src/types/comparativo.ts`.

### Filtro por estado de semáforo (multi-selección)

Pedido por el usuario 2026-07-28 tras revisar Valledupar con miles de códigos: un menú desplegable ("Filtro" en la barra de herramientas de ambas pestañas) permite elegir uno o varios de los 5 estados (`OK`, `Alerta`, `Crítico`, `Favorable`, `Muy favorable`) y ver solo los códigos que tienen **al menos un prestador** en alguno de esos estados. En la pestaña "Comparativo por municipio" el filtro se aplica **en el servidor, antes de paginar** (`getComparativoPorMunicipio` recibe `umbrales`, `referencia` y `estadosFiltro`) — si se aplicara solo sobre la página ya traída al cliente, se perderían coincidencias en el resto de códigos del municipio que el usuario no ha visto todavía. En la pestaña "Buscar código" el filtro es 100% cliente (`useMemo`) porque esa vista ya trae todo el resultado sin paginar.

> [!danger] Corrección 2026-07-28 (mismo día) — filtrar el código no bastaba, había que filtrar también sus prestadores
> Primera implementación: un código se mostraba si AL MENOS 1 prestador coincidía con el filtro, pero al desplegarlo seguían apareciendo TODOS sus prestadores (incluidos los de estados no seleccionados). Reportado por el usuario: filtró "Favorable" y le seguían saliendo prestadores "Crítico" y "Muy favorable" dentro del mismo código. **Fix**: además de filtrar qué códigos se muestran, se recorta el array `prestadores` de cada código a solo los que están en el/los estado(s) elegidos (`grupos.map(g => ({...g, prestadores: g.prestadores.filter(coincide)}))` en el servidor, mismo patrón en el `useMemo` del cliente para "Buscar código"). La columna "Prestadores" pasa a reflejar el conteo FILTRADO (consistente con lo que se ve al desplegar); mínimo/máximo/promedio/mediana/amplitud se dejan calculados sobre el grupo COMPLETO a propósito, sin filtrar — son el contexto real de mercado del municipio, no deben cambiar solo porque el usuario decidió mirar un subconjunto de prestadores.

### Media y mediana — el usuario elige la referencia

Se calculan ambas (`calcularEstadisticas()` en `src/lib/negociacion/comparativo.ts`) y se muestran en la tabla. **Corrección 2026-07-28**: inicialmente el semáforo usaba siempre el promedio como referencia fija; se cambió a un selector en la UI ("Comparar contra: Promedio/Mediana") porque el promedio es sensible a valores atípicos — un solo prestador muy caro/barato desplaza el promedio de todo el grupo y hace que los demás prestadores (que en realidad están cerca entre sí) parezcan todos "anómalos". La mediana no tiene ese problema. Ambas variaciones (`variacionPctPromedio`, `variacionPctMediana`) se calculan siempre en el servidor por cada prestador — cambiar la referencia en la UI es instantáneo, sin volver a consultar la base de datos.

### Exportación — "Informe completo" para el analista de contratación

Pedido por el usuario 2026-07-28: *"que me exporte un Excel con los datos de todo un informe completo para análisis por parte de un analista de contratación"*. Implementado como Route Handler `src/app/api/export/comparativo/route.ts` (GET), igual convención que el Módulo 1 (exportación binaria fuera de Server Actions — ver [[Arquitectura General]] §2.1).

Botones "Informe Excel" / "CSV" en ambas pestañas de `ComparativoClient` (`src/components/comparativo/comparativo-client.tsx`), construyendo la URL con **exactamente** los mismos filtros que el usuario tiene activos en pantalla en ese momento (`tipo`, `municipio`/`busqueda`, `referencia`, `umbrales.alertaPct/criticoPct`, `estadosFiltro`) — el archivo descargado siempre coincide con lo que se está viendo, nunca con un estado distinto.

**Formato Excel (3 hojas, vía `crearLibroExcel()` + `agregarHojaExcel()` de `src/lib/negociacion/exportar.ts`)**:
1. **Parámetros** — con qué filtros/umbrales/referencia se generó el reporte, y cuándo (para que el analista sepa si el archivo sigue vigente).
2. **Resumen por código** — una fila por código (departamento, municipio, código, descripción, cantidad de prestadores, mínimo, máximo, promedio, mediana, amplitud %).
3. **Detalle por prestador** — una fila por prestador+código (incluye NIT, contrato, valor, variación % vs. promedio Y vs. mediana, y el estado de semáforo ya en texto) — pensada para que el analista arme sus propias tablas dinámicas en Excel.

**Formato CSV**: solo la hoja de detalle por prestador (mismo criterio `;` + BOM UTF-8 que el resto del ecosistema, ver `construirCsv()`).

**Reutilización, sin duplicar reglas de negocio**: el endpoint NUNCA recalcula filtros o clasificación por su cuenta.
- Modo "municipio" llama a `getComparativoMunicipioCompleto()` (variante de `getComparativoPorMunicipio` que devuelve TODO el resultado ya filtrado/ordenado, sin paginar — pensada solo para exportación).
- Modo "código" llama a `getComparativoPorCodigo()` y luego aplica `filtrarYRecortarPorEstados()`, la misma función que usa la UI.
- La etiqueta de cada estado de semáforo en la columna "Estado semáforo" viene de `etiquetaNivelSemaforo()` (`src/lib/negociacion/comparativo.ts`) — única fuente de verdad compartida entre la UI y el export, para que nunca queden desincronizadas.

**Refactor de soporte que hizo posible esto sin duplicar código**:
- `construirGruposMunicipio()` (privada en `comparativo-actions.ts`) extrae el fetch+agregación cruda (sin filtrar/ordenar/paginar), reutilizada tanto por `getComparativoPorMunicipio` (pagina) como por `getComparativoMunicipioCompleto` (no pagina).
- `pageSize` de `getComparativoPorMunicipio` dejó de estar topado a 200 fijo — ahora el tope es `LIMITE_FILAS_EXPORTACION` (20.000), permitiendo que la exportación reutilice la misma función pidiendo "una sola página" del tamaño del límite completo, en vez de bifurcar la lógica de filtro/orden en dos lugares.
- `exportar.ts` ganó `crearLibroExcel()` (workbook vacío) + `agregarHojaExcel()` (agrega una hoja a un workbook ya existente) para poder construir el libro de 3 hojas sin reescribir la lógica de columnas/formato/autofiltro que ya existía en `construirLibroExcel()` (Módulo 1, 1 sola hoja).

## Reglas implementadas — Módulo 3 (Comparativo Histórico del Prestador) ✅ MVP

### Origen y decisiones de alcance (2026-07-28)

El usuario pidió un módulo grande (10 sub-funcionalidades: selección de prestador, comparativo por código, variación, gráfica, tabla exportable, KPIs, comparación entre contratos, ranking Top 20, observaciones automáticas en texto, dashboard ejecutivo), describiéndolo como si debiera "tomar como referencia la misma lógica utilizada actualmente para cargar el histórico de tarifas desde Google Sheets".

Investigación previa a construir cualquier cosa (evitó un antipatrón ya documentado):
- Esa lógica de Google Sheets **no existe en este proyecto** — vive en `Proyecto_Dusakawi` (legado), sin autenticación (fetch público a `docs.google.com/.../gviz/tq?tqx=out:csv`), y este proyecto la documenta explícitamente como antipatrón a evitar (ver [[APIs Externas#Integración legada]]).
- Sin embargo, esa integración legada **sí alimentó una tabla real en la MISMA base de datos** que este proyecto ya consulta (`base_sie_dusakawi`, esquema `administrativo`, mismo proxy — ver `src/lib/db.ts`): `administrativo.historico_tarifas_2025`. Verificado 2026-07-28 vía MCP Postgres: 308.228 filas, 111 prestadores, 145 contratos, poblada en una sola carga el 2026-05-19 (no fue vía Sheets sino un Excel local subido desde `Proyecto_Dusakawi`, pero el dato en sí es real y utilizable). Los 111 NIT y los 145 números de contrato coinciden 100% con `ct_ips`/`ct_ips_contrato` (join real, no aproximado).
- **No existe una serie temporal real multi-año** — es una foto congelada de un solo corte ("2025"). Decisión tomada con el usuario: el comparativo es de **2 puntos** (foto 2025 vs. valor **vigente hoy** en ARYUWIS, mismo `resolverValorFinal()` de Módulos 1/2), no una línea de 3+ años como sugería el ejemplo original del pedido. Si en el futuro se implementa el ETL de snapshots versionados (`negociacion_contratacion_snapshot_tarifario`, ver [[Arquitectura General]]), los tipos ya están diseñados para aceptar N puntos sin romper la UI (`PuntoHistorico[]` en `src/types/historico-prestador.ts`).
- **Alcance MVP** (decidido con el usuario): selección de prestador + tabla comparativa + variación % + gráfico + KPIs básicos. Quedan para una 2ª iteración: ranking Top 20 de incrementos/disminuciones, comparación contrato-contra-contrato (tarifas nuevas/eliminadas/modificadas) y observaciones automáticas en texto (se decidió que serían por reglas de negocio/umbrales, no IA generativa, cuando se construyan).

### Reutilización del semáforo del Módulo 2 — misma semántica, otra referencia

`clasificarSemaforo()`, `etiquetaNivelSemaforo()` y `calcularVariacionPct()` (`src/lib/negociacion/comparativo.ts`) se reutilizan **sin modificar**: un aumento de tarifa respecto a la foto 2025 es un riesgo de sobrecosto a vigilar (alerta/crítico, rojo/ámbar); una disminución es favorable para Dusakawi como pagador (favorable/muy favorable, azul). Antes comparaba contra otros prestadores del mismo municipio; aquí compara al prestador contra **su propio histórico** — la lógica de clasificación es idéntica, solo cambia qué es "la referencia". `FiltroEstadosSemaforo`/`colorSemaforo`/`ESTADOS_SEMAFORO` también se extrajeron de `comparativo-client.tsx` a `src/components/comparativo/semaforo-ui.tsx` para reutilizarlos tal cual en este módulo.

### Códigos "nuevos" y "eliminados" — no se fuerza una comparación donde no la hay

Un código puede existir solo en la foto 2025 (ya no está vigente hoy — contrato vencido, código retirado del tarifario) o solo en el vigente (negociado después de 2025, no estaba en esa foto). En ambos casos **no se calcula variación ni semáforo** (`variacionPct`/`nivel` quedan en `null`) — comparar un valor real contra la ausencia de dato produciría una variación falsa del ±100%/∞%. Se muestran aparte en la tabla ("Solo 2025" / "Nuevo") y se cuentan en los KPIs (`cantidadNuevos`, `cantidadEliminados`), pero **no entran en los totales monetarios** (`valorTotal2025`, `valorTotalVigente`, incremento acumulado) — sumar un código de un solo lado distorsionaría el incremento acumulado con algo que en realidad es una alta/baja de catálogo, no una negociación de precio.

### Clasificación de tipo (servicios/medicamentos/insumos/otros) — mismo hallazgo del Módulo 1

`administrativo.historico_tarifas_2025` no distingue tipo de tarifario por columna — se clasifica cruzando `codigo_tarifa` contra `tb_cup`/`tb_medicamento`/`tb_insumo.codigo_interno` (mismo hallazgo de FK no confiable documentado en el Módulo 1 — nunca por `consecutivo_cup`/`_medicamento`/`_insumo`). Prioridad si un código calzara en más de un maestro (no observado en la práctica): servicios > medicamentos > insumos > otros. Implementado en `clasificarCodigos()` (`historico-prestador-actions.ts`) con una sola query `UNNEST(...)` + 3 `LEFT JOIN`, en vez de repetir la clasificación por separado para el lado 2025 y el lado vigente.

### Deduplicación por mejor precio — reutilizada tal cual

Un mismo prestador puede tener el mismo código repetido en la foto 2025 (más de un contrato histórico) o en el vigente (más de un contrato activo simultáneo) — se reutiliza `dedupMejorPrecio()` del Módulo 2 sin modificar, pasando `ips: 0` constante (el campo no aplica aquí, ya que todo es del mismo prestador) para que la deduplicación efectiva sea por `codigoTarifa` solamente, tomando el valor más bajo.

### Corrección de UX (2026-07-28, mismo día) — un solo indicador de % y orden configurable

El usuario pidió simplificar el panel de KPIs: quitar las 2 tarjetas de valor total en pesos ("Valor total 2025"/"Valor total vigente", redundantes con el % ya calculado) y dejar un único indicador grande y claro del **porcentaje total** de variación del prestador, además de poder **ordenar la tabla por variación de mayor a menor y viceversa**.

- KPIs: la tarjeta "Incremento acumulado" se reemplazó por una tarjeta destacada de ancho completo ("Variación total del prestador"), con el % en tamaño grande como dato principal y el detalle en pesos como subtítulo secundario — antes era al revés (el $ era el dato principal y el % el subtítulo).
- Orden: se agregó un selector "Variación: mayor a menor / menor a mayor" (`ordenVariacion` en `historico-prestador-client.tsx`) que ordena por `variacionPct` **con signo** (no por magnitud absoluta) — "mayor a menor" pone primero los aumentos más grandes, "menor a mayor" pone primero las disminuciones más grandes. Los códigos sin variación calculable (nuevos/eliminados) siempre quedan al final, en cualquier dirección. Este orden es 100% cliente (`useMemo`, ya con todos los datos cargados) — no requiere volver a consultar la BD, a diferencia del orden inicial por `amplitudPct` que sí se calcula en el servidor en el Módulo 2.

### Sin gráfico de terceros (recharts) — SVG propio

Se intentó instalar `recharts` para el gráfico de evolución y el `npm install` quedó en un estado parcial/corrupto en el entorno de esta sesión (carpeta `node_modules/recharts` sin `package.json` propio, bloqueada para borrar por locks de archivo — mismo síntoma que el borrado de `.next` documentado en 09-Errores). `package.json` del proyecto **no llegó a modificarse**, así que es inofensivo mientras no se importe `"recharts"` en código — no se hizo. Se optó por un componente SVG propio y minúsculo (`GraficoPuntos` en `historico-prestador-client.tsx`), consistente con el resto del proyecto (`FiltroEstadosSemaforo` tampoco usa una librería de terceros). Si se quiere reintentar `recharts` en el futuro, limpiar antes manualmente esa carpeta parcial.

### Corrección de UX (2026-07-29) — se quita el indicador de % único, tarjetas como segmentadores, tabla sin scroll horizontal

Un día después de la corrección anterior, el usuario pidió 3 ajustes más sobre el mismo módulo:

1. **Quitar la tarjeta "Variación total del prestador"** (el indicador de % grande agregado el 2026-07-28) — el desglose de subieron/bajaron/quedaron igual que ya trae la tarjeta "Códigos comparados" es suficiente, no hace falta un tercer indicador.
2. **Tarjetas como segmentadores**: "Códigos comparados", "Códigos nuevos" y "Códigos eliminados" pasaron de ser solo informativas a ser **clicables** — al hacer clic filtran la tabla de abajo (estado `filtroSegmento` en `historico-prestador-client.tsx`: `"todos" | "comparados" | "nuevos" | "eliminados"`, con `alternarSegmento()` que hace clic-de-nuevo-para-desactivar). La clasificación usa los mismos campos que ya existían, sin tocar el backend: "comparado" = `valor2025 !== null && valorVigente !== null`; "nuevo" = `valor2025 === null` (solo vigente hoy); "eliminado" = `valorVigente === null` (solo estaba en la foto 2025). El componente `TarjetaKpi` ahora acepta `onClick`/`activo` opcionales — si no se pasan, se comporta exactamente igual que antes (KPI puramente informativo), así que no afecta otras pantallas que puedan reusarlo en el futuro. El export Excel/CSV (`/api/export/historico-prestador`) también acepta el mismo `segmento` como query param, para que lo descargado coincida con lo que el analista está viendo filtrado en pantalla.
3. **Desplazamiento horizontal de la tabla** — con las columnas de contrato agregadas el 2026-07-28 (sección anterior) la tabla llegó a 11 columnas y requería scroll horizontal, lo que el usuario reportó como pérdida de foco ("cuando hay desplazamiento horizontal se pierde el enfoque de la información"). Se redujo a **8 columnas** fusionando, dentro de la misma celda (valor arriba, dato secundario debajo en texto pequeño gris), 3 pares que antes eran columnas separadas: Valor 2025 + Contrato 2025 → una celda; Valor vigente + Contrato vigente → una celda; Variación % + Variación $ → una celda (con el % como dato principal en negrita, igual criterio ya usado en el indicador que se quitó en el punto 1, y el $ como subtítulo). No se perdió ningún dato, solo se cambió cómo se agrupa visualmente — el detalle expandible (clic en la fila) no cambió.

### Ajuste de seguimiento (mismo día, 2026-07-29) — sub-segmentador subieron/bajaron/igual y paginación de 100

Inmediatamente después de lo anterior, 2 pedidos más sobre la misma pantalla:

1. **Sub-segmentador dentro de "Códigos comparados"**: los 3 conteos que se mostraban como texto plano ("1032 subieron · 259 bajaron · 2754 igual") ahora son 3 botones clicables dentro de la misma tarjeta. Nuevo estado `filtroDireccion: "todos" | "subieron" | "bajaron" | "igual"` en `historico-prestador-client.tsx`, clasificado por el signo de `variacionAbsoluta` (mismo criterio que ya usa `calcularKpisHistoricoPrestador` para esos 3 conteos — no se inventó una regla nueva). Como subieron/bajaron/igual solo tienen sentido dentro de "comparados" (nuevos/eliminados no tienen `variacionAbsoluta`), elegir una dirección fija automáticamente `filtroSegmento = "comparados"`; los botones usan `stopPropagation()` para no disparar también el toggle de la tarjeta completa. El export Excel/CSV acepta el mismo filtro vía query param `direccion` (`subieron`|`bajaron`|`igual`).
2. **Paginación**: `PAGE_SIZE` subió de 25 a **100** filas por página — el usuario la consideró muy corta para revisar miles de códigos.



### Origen — 4ª tarjeta del dashboard, activada 2026-07-28

La tarjeta "Consumo y Frecuencia" ("Consumo real facturado (RIPS) agregado por prestador, código y período") estaba marcada "Próximamente". A diferencia de los Módulos 1/2/3 (que viven sobre el **tarifario contratado**, tablas de miles de filas), este módulo consulta directamente los **RIPS reales facturados** — tablas de decenas/cientos de millones de filas.

### Hallazgo crítico de rendimiento (verificado 2026-07-28 con `EXPLAIN ANALYZE`, antes de escribir una sola línea de código)

| Tabla | Filas (`pg_class.reltuples`) | Índice por fecha | Índice por prestador |
|---|--:|:-:|:-:|
| `rips_af` (encabezado factura) | 10,2M | No | No (solo `codigo_prestador` sin índice) |
| `rips_ap` (procedimientos) | 171M | No | No |
| `rips_am` (medicamentos) | 77,7M | No | No |
| `rips_at` (insumos) | 57,2M | No | No |
| `rips_ac` (consultas) | 44,5M | No | No |
| `rips_ah` (hospitalizaciones) | 733K | No | No |

Ninguna de las tablas de detalle tiene índice utilizable por fecha ni por prestador — **todas** solo indexan `consecutivo_rips` (FK hacia `rips_af`) y `numero_factura`. Filtrar `rips_af` por `codigo_prestador` + `fecha_servicio_rips` de un mes específico es un `Parallel Seq Scan` completo sobre 10,2M filas — medido en **~6.5-8.5 segundos** contra la BD real (prestador de prueba: CLINICA MEDICOS S.A., junio 2026, 137 facturas encontradas). Filtrar `rips_ap`/`rips_am`/`rips_at` directamente por fecha sería inviable (cientos de millones de filas sin índice, garantizado timeout del proxy de 90s).

### Decisiones de alcance tomadas con el usuario (2026-07-28)

Dado el hallazgo anterior, se acotó el alcance ANTES de construir, para no entregar una funcionalidad que se cuelgue en producción:
1. **Tipos incluidos**: solo Servicios (CUPS) + Medicamentos (CUM) + Insumos — mismo alcance que Módulos 1/2/3. Consultas (`rips_ac`) y Hospitalizaciones (`rips_ah`) quedan para una futura iteración.
2. **Período**: un **mes específico** a la vez (selector Mes/Año), nunca un rango libre — un rango abierto sobre tablas de cientos de millones de filas sin índice de fecha es la receta exacta para un timeout.
3. **Vista**: por prestador (como el Módulo 3), no un ranking de todos los prestadores a la vez — agregar sobre TODOS los prestadores en una sola consulta multiplicaría el costo del Seq Scan sin ninguna ganancia (ya es caro para uno solo).

### Estrategia de consulta — filtrar la tabla chica primero, saltar a las grandes por índice real

`src/app/actions/consumo-frecuencia-actions.ts`:
1. `obtenerFacturasDelMes(codigoPrestador, mes, anio)` — UNA sola consulta contra `rips_af` (la tabla MÁS PEQUEÑA de las RIPS) con `fecha_servicio_rips` acotada al mes exacto (`>= inicio AND < fin`, nunca abierta) y `fecha_anula IS NULL`. Devuelve la lista de `consecutivo_rips` de ese prestador en ese mes — típicamente un puñado a unos pocos miles de facturas, nunca "todas las facturas de la BD".
2. Esa lista (ya acotada) se usa como `WHERE consecutivo_rips = ANY($1)` contra `rips_ap`/`rips_am`/`rips_at` — esa columna SÍ está indexada en las 3 tablas grandes, así que la resolución es por Index Scan (confirmado con `EXPLAIN ANALYZE`: ~100ms para 137 facturas → 4547 filas de procedimientos), no un escaneo completo.
3. Las 3 consultas de detalle corren en paralelo (`Promise.all`) ya que son independientes entre sí.

**Nunca** se filtra `rips_ap`/`rips_am`/`rips_at` directamente por fecha o por prestador — siempre se llega a ellas a través de la lista de `consecutivo_rips` ya resuelta desde `rips_af`.

### Columnas reales de cantidad/valor por tipo (verificadas contra el esquema, no asumidas)

| Tipo | Tabla | Código | Cantidad | Valor |
|---|---|---|---|---|
| Servicios | `rips_ap` | `codigo_procedimiento` | `COUNT(*)` (1 fila = 1 evento, no hay columna de cantidad) | `SUM(valor_procedimiento)` |
| Medicamentos | `rips_am` | `codigo_medicamento` | `SUM(numero_unidades)` | `SUM(valor_total_medicamento)` |
| Insumos | `rips_at` | `codigo_tarifario` | `SUM(cantidad)` (única de las 3 con columna de cantidad propia) | `SUM(valor_total_material)` |

Clasificación/descripción del código: mismo patrón ya validado en Módulos 1/2/3 — `LEFT JOIN` contra `tb_cup`/`tb_medicamento`/`tb_insumo` por `codigo_interno` (nunca por FK). Para medicamentos, si el código no cruza contra `tb_medicamento` (maestro incompleto), se usa como respaldo el propio `rips_am.nombre_medicamento` (el RIPS trae su propio nombre declarado) — evita mostrar solo el código pelado cuando el maestro no lo tiene.

### KPIs y orden por defecto

`calcularKpisConsumoPrestador()` (`src/lib/negociacion/consumo-frecuencia.ts`): valor total facturado, cantidad de facturas del mes (viene de `rips_af`, no se puede derivar de las filas por código), cantidad de códigos distintos, y el desglose servicios/medicamentos/insumos. Orden por defecto: valor total facturado de mayor a menor (igual criterio que "qué se está consumiendo más" para un analista) — el usuario puede alternar a menor a mayor, o por cantidad en vez de valor, sin volver a consultar la BD (ya está todo cargado en memoria para el prestador+mes elegido).

> [!danger] Corrección 2026-07-28 (mismo día) — `rips_at.codigo_tarifario` está SIEMPRE en NULL, el código real va en `codigo_servicio`
> Reportado por el usuario con un caso real: prestador VITALSALUD DEL CESAR SAS, febrero 2026 — la fila de "Insumo" salía sin código ni descripción, agregando de golpe 19.303 unidades y $349.775.074 (todos los insumos del mes cayendo en un solo grupo `NULL`). Verificado con `TABLESAMPLE SYSTEM (2)` sobre ~1,2M filas de `rips_at`: **0 filas** tienen `codigo_tarifario` poblado, **100%** tienen `codigo_servicio` poblado. El nombre de la columna es engañoso (no es "el código del tarifario contratado", es simplemente un campo que en la práctica no se usa). **Fix**: `obtenerConsumoInsumos()` (`src/app/actions/consumo-frecuencia-actions.ts`) ahora agrupa y cruza por `at2.codigo_servicio`, igual que se cruza `tb_insumo.codigo_interno` — mismo patrón de "cruzar siempre por el código real, nunca asumir el nombre de columna sin verificar contra la BD" ya aplicado repetidas veces en este proyecto (ver FK `consecutivo_cup`/`consecutivo_medicamento`/`consecutivo_insumo` rotas en Módulo 1).

### Fuera de alcance de este MVP (documentado para no reconstruir el análisis)

- Comparar el consumo facturado contra el valor **contratado** (detectar sobrefacturación/subfacturación) — eso es el objetivo de la tarjeta "Sobrecostos y Ahorro" (Próximamente), un módulo distinto, no una extensión de este.
- Serie temporal de varios meses en una sola vista (hoy es un mes a la vez) — posible en una 2ª iteración si se valida que el rendimiento de un mes es aceptable en producción real (no solo en el sandbox de desarrollo).
- Ranking de todos los prestadores a la vez.

## Ver también
- [[Validaciones]]
- [[Arquitectura General]]
- [[Objetivos]]
- [[Tablas]]
- [[API]]
