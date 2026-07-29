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

### Corrección de precisión — Amplitud % según "Comparar contra" (2026-07-29)

El usuario preguntó cómo se calculaba el indicador "Amplitud" de la vista Comparativo por municipio y, al intentar verificarlo a mano con los datos visibles en pantalla (Mínimo, Máximo, Mediana — cuando "Comparar contra" = Mediana), el número no le cuadraba. Causa raíz: `amplitudPct` (`(máximo - mínimo) / promedio * 100`, en `src/lib/negociacion/comparativo.ts`) **siempre** dividía por el Promedio, sin importar qué referencia tuviera seleccionada el usuario — y el Promedio ni siquiera se muestra en pantalla cuando la referencia activa es Mediana, así que no había forma de verificar el cálculo manualmente.

Se verificó primero con datos reales de producción (código 970101, Valledupar, 8 prestadores: mínimo $21.511, máximo $660.000, mediana $55.895, promedio $146.938) que la fórmula documentada sí correspondía exactamente al 434,53% mostrado, confirmando que el bug era de **transparencia** (dato oculto), no de cálculo incorrecto.

**Fix**: `calcularEstadisticas()` ahora devuelve **ambas** variantes — `amplitudPctPromedio` y `amplitudPctMediana` — igual criterio que ya existía por prestador (`variacionPctPromedio`/`variacionPctMediana`). Nuevo helper `amplitudSegunReferencia(fila, referencia)` es la única fuente de verdad para elegir cuál mostrar/ordenar/exportar según el selector "Comparar contra" de la UI. Se actualizó:
- El tipo `FilaComparativoCodigo` (`amplitudPct` → `amplitudPctPromedio` + `amplitudPctMediana`).
- Las 3 funciones que ordenan grupos por amplitud en `comparativo-actions.ts` (`getComparativoPorMunicipio`, `getComparativoMunicipioCompleto`, `getComparativoPorCodigo` — esta última ganó un parámetro `referencia` nuevo, antes no lo recibía).
- La celda "Amplitud" en `comparativo-client.tsx` y la hoja "Resumen por código" del export (`/api/export/comparativo`), que ahora además exporta ambas variantes como columnas separadas para que quien abra el Excel pueda verificar sin ambigüedad cuál se usó en pantalla.

### Menú emergente de Amplitud + formato sin decimales (mismo día)

Pedido de seguimiento inmediato: la celda de Amplitud ahora se muestra **sin decimales** (`formatearPorcentaje(valor, 0)` — se agregó un parámetro opcional `decimales` a `formatearPorcentaje()` en `src/lib/negociacion/formato.ts`, por defecto 2, sin romper ningún otro uso existente de la función en el proyecto), y un **doble clic** sobre el valor abre un menú emergente (`ModalDetalleAmplitud` en `comparativo-client.tsx`) con la fórmula completa, los 4 datos base (mínimo/máximo/promedio/mediana), el cálculo paso a paso con los números reales de esa fila, cuánto daría con la otra referencia, y la lista de precios por prestador que sustenta el mínimo/máximo. El usuario pidió explícitamente **menú emergente, no tooltip** (hover) — se implementó como overlay propio (`position: fixed` + fondo oscuro + tarjeta centrada) en vez de instalar un componente Dialog de terceros (`@radix-ui/react-dialog` no está instalado en el proyecto — mismo criterio de evitar dependencias nuevas ya aplicado con `recharts`, ver 09-Errores). El encabezado de la columna Amplitud lleva un subtítulo pequeño ("doble clic = cómo se calcula") como pista visual persistente, en vez de un `title` nativo (que sería un tooltip).

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

## Reglas implementadas — Módulo 4 (Consumo y Frecuencia) ✅ MVP

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

## Dashboard Analítico de Competitividad y Riesgo Contractual (Fase A) — nueva pestaña del Módulo 2

### Origen y alcance decidido (2026-07-29)

El usuario pidió un dashboard ejecutivo completo de 12 secciones (KPIs, ranking de riesgo, score 0-100, heatmap, boxplot, detección de outliers IQR/Z-score, ahorro potencial, Top 20, segmentadores por especialidad/grupo CUPS/grupo CUM/complejidad/familia de insumos/año, indicadores estadísticos avanzados, narrativa automática) como pestaña nueva del Módulo 2, ubicada inmediatamente después de "Comparativo por municipio". Antes de escribir código se verificó viabilidad contra el esquema real y se resolvió el alcance con el usuario vía `AskUserQuestion` (mismo criterio ya usado para Módulos 3 y 4):

1. **Fase de construcción**: Fase A (KPIs, ranking de riesgo, score, Top 20, ahorro potencial, narrativa, filtros básicos) — sin boxplot/outliers/indicadores estadísticos avanzados (Fase B, no implementada) ni las partes de esquema no verificado (Fase C).
2. **Heatmap**: por Municipio solamente (no Municipio × Prestador) — el módulo compara precios **siempre dentro del mismo municipio** (regla ya documentada arriba, para no mezclar variabilidad por ubicación con variabilidad por negociación); un heatmap municipio×prestador cruzaría prestadores de municipios distintos entre sí, contradiciendo esa regla. El heatmap implementado agrega `% de tarifas críticas` y `amplitud promedio` por municipio.
3. **Segmentadores adicionales**: investigar y agregar los que sí existen en la BD, omitir "Familia de insumos" (sin columna equivalente).

### Hallazgo de esquema — qué segmentadores adicionales son viables (verificado con datos reales antes de construir, no asumido)

| Segmentador pedido | Columna candidata | Resultado de la verificación | ¿Se implementó? |
|---|---|---|---|
| Tipo de contrato | `ct_ips_contrato.tipo_contrato` → `tb_tipo_contrato.descripcion` | Viable — valores reales en uso entre contratos vigentes: Capitado (165), Evento (106), PGP (9) | ✅ Sí |
| Nivel de complejidad | `ct_ips.nivel_complejidad` (smallint 0-3) | Viable — sin tabla de catálogo en la BD, se usa la clasificación estándar del sistema de salud colombiano (0=Sin definir, 1=Baja, 2=Media, 3=Alta) | ✅ Sí |
| Especialidad | `tb_cup.consecutivo_especialidad_nt` → `tb_especialidad_nt_cup` | `consecutivo_especialidad_nt` está `NULL` en 10.674 de 10.675 filas de `tb_cup` (>99,9%) | ❌ No — el dato no existe en la práctica |
| Grupo CUPS | `tb_cup.consecutivo_grupo_nt` → `tb_grupo_nt_cup` | `consecutivo_grupo_nt` está `NULL` en el 100% de `tb_cup` (0 de 10.675) | ❌ No |
| Grupo CUPS (alterno) | `tb_cup.grupo` (smallint, sí poblado 100%) | 10.626 de 10.675 filas (99,5%) tienen el mismo valor (1) — no discrimina nada útil | ❌ No |
| Grupo CUM | `tb_medicamento.grupo_medicamento` → `tb_grupo_medicamento.descripcion` | El 100% de `tb_medicamento` (71.141 filas) tiene el mismo valor: descripción "No Aplica" — columna poblada pero sin variabilidad real | ❌ No |
| Familia de insumos | — | `tb_insumo` no tiene columna equivalente (solo `tipo_insumo`, sin verificar qué cataloga) | ❌ No — no hay columna candidata |
| Año | Derivable de `ct_ips_contrato.fecha_inicio` | Viable en principio, pero no agregado en Fase A por no ser parte del recorte acordado | ⏳ Diferido |

Este hallazgo se comparte porque es reutilizable: si en el futuro se pide "por especialidad" o "por grupo CUPS/CUM" en cualquier otro módulo de este proyecto, la respuesta ya verificada es que esos campos existen en la BD pero **no contienen información real discriminante** — no es un problema de la query, es un dato no diligenciado en el maestro de ARYUWIS.

### Arquitectura de datos — agregación cruzada de municipios, NO una fuente nueva

- `src/types/dashboard-riesgo.ts` — tipos (`KpisDashboardRiesgo`, `FilaRankingRiesgo`, `FilaHeatmapMunicipio`, `FilaDistribucionEstado`, `FilaTopCritico`, `AhorroPotencial`, `ResultadoDashboardRiesgo`).
- `src/lib/negociacion/dashboard-riesgo.ts` — funciones puras (`construirDashboardRiesgo`, `calcularScoreRiesgo`, `clasificarNivelRiesgo`). Reutiliza `clasificarSemaforo`/`amplitudSegunReferencia` de `comparativo.ts` — nunca reclasifica semáforo con una regla propia.
- `src/app/actions/dashboard-riesgo-actions.ts` — `getDashboardRiesgoContractual(tipo, filtros)`, `getOpcionesTipoContrato()`, `getOpcionesNivelComplejidad()`, `getOpcionesPrestadoresRiesgo(tipo)`. La query base es la MISMA de `getComparativoPorCodigo` (comparativo-actions.ts) pero **sin filtro de municipio** — trae el tarifario completo de un tipo a través de toda la red, agrupa por (municipio, código) igual que el resto del módulo, aplica `dedupMejorPrecio` (con una clave temporal `municipio__código` para no pisar el mismo código de un prestador entre 2 municipios distintos — se restaura antes de agrupar) y descarta grupos con <2 prestadores, exactamente igual criterio que en el resto del Módulo 2.
- `src/components/comparativo/dashboard-riesgo-tab.tsx` — componente de UI **separado** de `comparativo-client.tsx` (que ya es grande y tiene historial de corrupción por bytes NUL al editarlo, ver 09-Errores) para aislar el riesgo de edición; `comparativo-client.tsx` solo gana la `TabsTrigger`/`TabsContent` para montarlo.
- Sin librería de gráficos de terceros (recharts ya falló al instalar en este entorno) — ranking y distribución de estados son barras horizontales con `<div>`+Tailwind (ancho=%), heatmap es una grilla de tarjetas con color de fondo interpolado por CSS (`colorHeatmap()`), no un heatmap SVG real.

### Metodología del Score de Riesgo (0-100) — HEURÍSTICO de priorización, no un modelo estadístico validado

`calcularScoreRiesgo()` combina 4 componentes (cada uno capado en 100) con pesos fijos, documentados aquí para que cualquier ajuste futuro sea deliberado:

```
componenteCriticas   = min(100, %críticas del prestador × 2)
componenteAlertas    = min(100, %alertas del prestador × 1.5)
componenteDesviacion = min(100, promedio de |variación%| absoluta de sus apariciones)
componenteAmplitud   = min(100, amplitud % promedio de los grupos donde participa)

score = round(0.40×criticas + 0.20×alertas + 0.25×desviación + 0.15×amplitud)
```

Cortes: `<25` 🟢 Bajo · `25–49` 🟡 Medio · `50–74` 🟠 Alto · `≥75` 🔴 Muy Alto. El ranking se ordena por **costo potencial adicional** (suma de sobrecostos en apariciones crítico/alerta), no por el score — es la métrica más accionable para priorizar negociación, el score es un resumen complementario.

> [!warning] "Costo potencial adicional" y "Ahorro potencial" son estimados POR UNIDAD TARIFADA, no proyectados por volumen real de servicios prestados — este dashboard vive sobre el tarifario contratado (miles de filas), no sobre RIPS reales facturados (eso es el Módulo 4, Consumo y Frecuencia). Cruzar ambos para un ahorro proyectado por volumen real es trabajo de una fase futura, no de este MVP.

### Ahorro potencial — solo sobre tarifas críticas

Pedido explícito del usuario: *"si todas las tarifas críticas fueran negociadas al valor de la mediana"*. Se calcula únicamente sobre apariciones clasificadas `crítico` (nunca `alerta`, aunque el costo potencial adicional del ranking sí incluye ambas) — `ahorro = valorFinal − valorReferencia` (mediana o promedio, según "Comparar contra"), sumado por prestador y por municipio.

### Ajuste de seguimiento (mismo día, 2026-07-29) — menú emergente de doble clic en cada KPI

Pedido inmediato del usuario tras ver el dashboard: *"es bueno saber cómo se calculan los KPI... y que yo pueda dar doble clic y que me lleve a esa información que genera ese KPI"*. Mismo patrón ya usado para "Amplitud" en el Módulo 2 (menú emergente propio, no tooltip de hover).

**Corrección del mismo día, inmediatamente después de la primera versión**: la primera implementación mostraba solo la fórmula y una descripción textual de cómo se calcula cada KPI (`explicacionKpi()`, texto puro). El usuario corrigió explícitamente: *"el doble clic no me refiero a esa información que me das es los datos de donde me lo traes, la fuente, que el analista pueda ir a ver que datos generaron eso, los procedimientos, los valores, no la descripción del KPI como tal"*. Es decir: el doble clic debe llevar al **dato fuente real** (códigos, prestadores, valores concretos), no a un texto explicativo. Se reemplazó por completo el enfoque:

- **Las 10 tarjetas KPI ejecutivas** ahora tienen doble clic → `ModalInfo` con una línea corta de contexto (`formulaCortaKpi()`) y, como contenido principal, `TablaFuenteKpi` (`dashboard-riesgo-tab.tsx`): una tabla real con las filas concretas que generan ese número, tomada de datos ya calculados en el servidor:
  - "Prestadores"/"Municipios" → filas de `resultado.ranking`/`resultado.heatmap`.
  - "Códigos comparables", "Valor promedio de mercado", "Variabilidad promedio" → filas de `resultado.detalleGrupos` (un grupo municipio+código con min/máx/promedio/mediana/amplitud), ordenadas según el KPI (por amplitud, por promedio, o por código).
  - "Tarifas críticas/alerta/OK/favorables/muy favorables" y "% negociación crítica" → filas de `resultado.detallePorNivel[nivel]` (apariciones código+prestador+municipio individuales con su valor, referencia y diferencia), acotadas a las 200 de mayor variación por nivel (`TOP_ENTRADAS_POR_NIVEL` en `dashboard-riesgo.ts`, vía `construirDetallePorNivel()`) para no inflar el payload.
  - Todo renderizado con `TablaGenerica` (tabla con encabezado fijo y scroll), sin recalcular nada en el cliente.
  - Se extendió el modelo de datos en `src/types/dashboard-riesgo.ts`: `FilaEntradaDetalle`, `FilaDetalleGrupo`, `DetallePorNivel` (nuevos), y `ResultadoDashboardRiesgo` ganó `detallePorNivel`/`detalleGrupos`.
- **Cada fila del ranking de riesgo** tiene doble clic → modal con el desglose completo del score: los 4 componentes (críticas/alertas/desviación/amplitud) con su fórmula y valor real, el score final con su nivel, la fórmula y valor del costo potencial adicional, y una tabla con los códigos que más aportan al sobrecosto de ESE prestador — esta parte ya mostraba dato real desde la primera versión y no necesitó corrección.
- Para poder mostrar esta última tabla sin recalcular nada en el cliente, `FilaRankingRiesgo` (`src/types/dashboard-riesgo.ts`) ganó campos nuevos: `componenteCriticas/Alertas/Desviacion/Amplitud`, `pctAlerta`, `amplitudPromedio`, `cantidadSobrecostos` y `detalleSobrecostos: FilaDetalleSobrecosto[]` (las hasta 25 apariciones crítico/alerta con mayor diferencia absoluta de ese prestador — acotado con `TOP_SOBRECOSTOS_POR_PRESTADOR` en `dashboard-riesgo.ts` para no inflar el payload en prestadores con cientos/miles de códigos críticos; `cantidadSobrecostos` conserva el total real aunque se hayan recortado las filas mostradas).
- `calcularScoreRiesgo()` se refactorizó en `calcularComponentesRiesgo()` (devuelve los 4 componentes + el score) — `calcularScoreRiesgo()` se conserva como wrapper delgado para no romper nada que ya lo usara.

### Fuera de alcance de esta Fase A (Fase B/C, no implementadas)

- Boxplot por procedimiento (mínimo/Q1/mediana/Q3/máximo/valor del prestador) y marcado de outliers.
- Detección estadística de outliers vía IQR, Z-score o desviación estándar.
- Indicadores estadísticos avanzados: moda, coeficiente de variación, percentiles 25/50/75, rango intercuartílico como medida independiente de la amplitud.
- Segmentadores por Especialidad/Grupo CUPS/Grupo CUM/Familia de insumos (ver tabla de hallazgo arriba) y por Año.
- Exportación a Excel/PDF de este dashboard específico (los demás módulos sí exportan; este queda pendiente para cuando se defina el layout final de las 12 secciones).

## Perfil Competitivo del Prestador — nueva tarjeta independiente del dashboard (2026-07-29)

Pedido explícito del usuario tras ver "Comparativo entre Prestadores" y "Comparativo Histórico del Prestador": *"necesito una tarjeta que analice un prestador en sí contra prestadores del mismo municipio... que se pueda realizar análisis sobre un solo prestador... necesito una tarjeta aparte"*. Confirmado por `AskUserQuestion`: contenido completo (KPIs + tabla detallada + export) y alcance de todos los municipios donde opera el prestador a la vez (no uno por uno).

### Qué es y qué NO es

Complementa a "Comparativo Histórico del Prestador" (Módulo 3, dimensión **temporal**: cómo cambió la tarifa de ESTE prestador entre 2025 y hoy) con la dimensión de **pares**: cómo se compara ESTE prestador HOY contra los demás prestadores del mismo municipio, código por código. No es una fuente de datos nueva ni una consulta nueva: reutiliza tal cual la infraestructura ya construida para el Dashboard Analítico de Riesgo (Fase A, sección anterior de este documento).

- Componente: `src/components/perfil-prestador/perfil-prestador-client.tsx`. Página: `/perfil-prestador` (`src/app/(protegido)/perfil-prestador/page.tsx`). Tarjeta nueva en el dashboard principal (`src/app/(protegido)/dashboard/page.tsx`).
- Tipos: `src/types/perfil-prestador.ts`. Helper puro: `src/lib/negociacion/perfil-prestador.ts` (`construirPerfilPrestador`). Server Action: `src/app/actions/perfil-prestador-actions.ts` (`getPerfilPrestador`).

### Por qué requiere elegir "Tipo de tarifario" primero (a diferencia de Módulo 3)

Se evaluó fusionar servicios+medicamentos+insumos en una sola vista (como hace Módulo 3, que mezcla los 4 tipos con una columna "Tipo"), pero se descartó por **costo de la consulta**: `construirGruposTodosMunicipios` (reutilizada del Dashboard de Riesgo) ya recorre TODO el tarifario de un tipo a través de todos los municipios — es la misma consulta que ya necesitó una barra de progreso por su duración. Triplicarla (una vez por tipo) para fusionar resultados habría sido un riesgo de rendimiento no justificado. Se mantiene el mismo patrón que "Comparativo entre Prestadores"/Dashboard de Riesgo: selector de Tipo de tarifario primero, luego selector de prestador (cuyas opciones dependen del tipo — un prestador puede no tener contrato de un tipo dado).

### Cómo se calcula — reutilización, no duplicación

`construirPerfilPrestador(ips, tipo, razonSocial, nit, grupos, referencia, umbrales)`:

1. Llama a `construirDashboardRiesgo()` (ya existente) con los mismos `grupos` — esto calcula el ranking de riesgo de **todos** los prestadores del tipo a la vez (mismo costo que ya paga el Dashboard de Riesgo).
2. Extrae de `dashboard.ranking` la fila (`FilaRankingRiesgo`) de este `ips` específico → es el "resumen ejecutivo" (score, % crítico/alerta, costo potencial adicional, municipios donde opera). Si el prestador no aparece en el ranking (nunca tuvo 2+ prestadores en el mismo municipio para ese tipo), `resumen` es `null` y la UI muestra un mensaje explicando por qué no hay comparación posible, en vez de una tabla vacía.
3. Calcula también la posición (`indiceEnRanking + 1`) y el total de prestadores en el ranking — fuente de la tarjeta "Posición en el ranking".
4. Llama a `aplanarEntradas()` (exportada de `dashboard-riesgo.ts` para esta reutilización) y filtra a las apariciones de este `ips` — a diferencia de `detalleSobrecostos` del ranking (que se acota a los 25 mayores sobrecostos porque ahí conviven TODOS los prestadores), aquí se devuelven **todos** los códigos de este prestador sin recortar, porque el payload ya está naturalmente acotado a un solo prestador.

**Advertencia crítica documentada en el código** (`construirGruposTodosMunicipios`, `dashboard-riesgo-actions.ts`): la consulta de grupos **nunca** debe llamarse con el filtro `ips` puesto para este módulo — eso dejaría grupos de 1 solo prestador (sin pares), y el filtro `filas.length < 2` de la propia función los descartaría todos. El filtrado a un prestador específico ocurre **después**, sobre los grupos ya completos (con todos sus pares), exactamente igual a como ya lo hace el Dashboard de Riesgo.

### Metodología de comparación — igual que el resto del Módulo 2

Cada código se compara contra el promedio/mediana del grupo completo, que **incluye** al propio prestador (no se excluye para calcular "contra sus pares") — mismo criterio ya usado en todo el Módulo 2 (`variacionPctPromedio`/`variacionPctMediana` en `PrestadorValorComparativo`). No se introdujo una metodología nueva de "comparación contra pares excluyendo al propio prestador".

### UI — ajustes de seguimiento el mismo día (feedback inmediato del usuario tras ver la primera versión)

1. **Acordeón por código** (`FilaCodigoPerfilRow`, mismo patrón que `FilaHistoricoExpandible` de Módulo 3): clic en la fila expande una segunda fila mostrando **todos** los prestadores del grupo (código+municipio), ordenados de menor a mayor valor, con el propio prestador resaltado (`esEstePrestador`). Requirió agregar `prestadoresGrupo: PrestadorGrupoPerfil[]` a `FilaCodigoPerfil` — se puebla directamente desde `e.grupo.prestadores` (ya disponible en `FilaComparativoCodigo`, no requiere una consulta nueva).
2. **Tooltips explicativos** (`InfoTooltip`, ícono "i" con atributo `title` nativo — sin dependencia nueva) en "Score de riesgo" y "Posición en el ranking": el usuario pidió explícitamente un tooltip aquí, a diferencia del menú emergente de doble clic ya usado para Amplitud/KPIs del Dashboard de Riesgo (esas son "fuente de datos", este es "qué significa el número").
3. **Doble clic en "Posición en el ranking" → modal con el ranking completo** (`ModalOverlay` + `TablaRankingCompleto`, mismo patrón de overlay ya usado en `dashboard-riesgo-tab.tsx`): muestra `resultado.rankingCompleto` (el `dashboard.ranking` completo, expuesto tal cual en `ResultadoPerfilPrestador` — no se recalcula nada, ya se había calculado en el paso 1 de `construirPerfilPrestador`), resaltando la fila de este prestador.
4. **Columna Descripción se veía cortada**: la primera versión usaba `truncate` (ellipsis a una sola línea) en una columna de 260px — el texto real de las descripciones de procedimientos suele ser más largo. Se quitó `truncate` y se cambió a `whitespace-normal break-words` con `min-w-[260px] max-w-[420px]`, para que el texto envuelva en varias líneas y se lea completo sin depender de pasar el mouse.
5. **Número de contrato visible, tanto del prestador analizado como de sus pares** (pedido inmediato: "para ubicar rápidamente su número de contrato"): `PrestadorValorComparativo` ya traía `numeroContrato` (mismo dato usado en Módulos 1/2/3), solo hacía falta exponerlo en este módulo. Se agregó `numeroContratoPrestador` a `FilaCodigoPerfil` (buscando la fila de este `ips` dentro de `e.grupo.prestadores`, sin consulta nueva) y `numeroContrato` a cada `PrestadorGrupoPerfil` del acordeón. La fila principal muestra el contrato del prestador bajo su valor (mismo patrón "valor + contrato apilados" de Módulo 3); el acordeón muestra el contrato de cada par; el export Excel/CSV agrega una columna "Contrato del prestador" y otra "Otros prestadores del grupo" con razón social · NIT · contrato · valor de cada uno, para poder ubicar cualquier tarifa en ARYUWIS sin volver a consultar la BD.
6. **Tarjeta "Contrato(s) analizado(s)"** en el resumen ejecutivo (grid ampliado a 5 columnas): un prestador puede tener varios contratos vigentes a la vez (distintos municipios o períodos) — pedido explícito: "los prestadores pueden tener varios número de contrato". Se deriva client-side de `resultado.codigos` (dedup de `numeroContratoPrestador`), sin consulta nueva.
7. **Botón "Ver movimientos RIPS" por prestador del acordeón** (pedido: *"necesito saber cuántos procedimientos de esos ha radicado cada prestador y su número de factura... para mirar movimientos de ese código... debes traerlo de los RIPS... cuando traigas medicamentos el archivo de RIPS es otro"*) — ver subsección siguiente.

### Movimientos RIPS por código+prestador — nuevo botón bajo demanda (2026-07-29)

Cada tarjeta de prestador dentro del acordeón de "Perfil Competitivo del Prestador" tiene ahora un botón "Ver movimientos RIPS" que abre un modal con: total de facturas, total de unidades, total facturado, y el detalle factura por factura (número, fecha, unidades, valor) — para que el analista pueda ir a auditar directamente en ARYUWIS/RIPS el movimiento real de ese código para ese prestador específico.

- **Archivos nuevos**: `src/types/movimiento-rips.ts`, `src/app/actions/movimiento-rips-actions.ts` (`getMovimientoRipsCodigo(ips, codigoTarifa, tipo)`).
- **Bajo demanda, no automático**: la consulta solo se dispara al hacer clic en el botón de un prestador específico (no se calcula para los 4-N prestadores del acordeón a la vez) — evita pagar el costo de esta consulta cuando el analista no la necesita.
- **Reutiliza el patrón de rendimiento ya validado en Módulo 4 (Consumo y Frecuencia)**: primero se filtra `rips_af` por `codigo_prestador` (Seq Scan sin índice por prestador, pero dentro de límites razonables — verificado con `EXPLAIN ANALYZE`: ~1.2-1.5s incluso para un prestador con 14.458 facturas históricas) para obtener la lista de `consecutivo_rips` válidos (`fecha_anula IS NULL`), y desde ahí se resuelve `rips_ap`/`rips_am`/`rips_at` filtrando por `consecutivo_rips = ANY(...)` (índice real en las 3 tablas: `rips_ap_idx_rips`, `rips_am_idx_rips`, `rips_at_idx_rips`) **más** el código específico. Tiempo total medido: ~3s — aceptable para una consulta bajo demanda con spinner, no para una carga automática.
- **Acotado a la vigencia del contrato (no todo el histórico) — ajuste del mismo día**: ver subsección "Filtro de fecha por vigencia del contrato" más abajo.
- **Tabla RIPS correcta según el tipo — verificado contra el esquema real antes de escribir código** (pedido explícito del usuario: "cuando traigas medicamentos el archivo de RIPS es otro"):
  - `servicios` → `rips_ap` (`codigo_procedimiento`). Esta tabla **no tiene columna de cantidad** — cada fila es un evento/unidad, así que "unidades" = `COUNT(*)` (mismo criterio ya usado en `obtenerConsumoServicios` de Módulo 4). `rips_ap` sí trae `numero_factura` y `codigo_prestador` propios (no hace falta joinear con `rips_af` para esos datos, solo para resolver la lista de `consecutivo_rips` válidos).
  - `medicamentos` → `rips_am` (`codigo_medicamento`), unidades = `SUM(numero_unidades)`.
  - `insumos` → `rips_at` (`codigo_servicio`, **no** `codigo_tarifario` — mismo hallazgo ya documentado en Módulo 4: `codigo_tarifario` está SIEMPRE en NULL), unidades = `SUM(cantidad)`.
- **Resolución del prestador**: se busca `codigo_prestador` en `ct_ips` a partir del `ips` ya conocido (el mismo `ips` que trae cada `PrestadorGrupoPerfil` del acordeón) — sin pedirle al usuario el NIT ni el código de prestador.
- **Acotado a 500 facturas mostradas** (`LIMITE_FACTURAS_MOSTRADAS` en `movimiento-rips-actions.ts`, ordenadas por fecha descendente — se muestran las más recientes): los totales (cantidad/valor) siempre se calculan sobre el conjunto COMPLETO antes de acotar, solo la lista de filas mostradas se recorta, con un aviso visible si se truncó. Mismo criterio ya usado en `TOP_ENTRADAS_POR_NIVEL`/`TOP_SOBRECOSTOS_POR_PRESTADOR` del Dashboard de Riesgo.

### Corrección de rendimiento y error 413 (mismo día, tras primera prueba en pantalla)

La primera versión resolvía la lista de `consecutivo_rips` del prestador en Node (primera consulta) y la volvía a enviar como parámetro — un array de miles/decenas de miles de bigints — en una SEGUNDA consulta HTTP al proxy. Para un prestador con muchas facturas históricas, ese array serializado a JSON superó el límite de tamaño de payload del proxy: `Error: El servicio proxy de base de datos no está disponible (413)`. El usuario también reportó que la consulta "se demora mucho".

**Fix**: se fusionaron las 2 consultas en UNA sola por tabla, con el filtro de `rips_af` como subconsulta — el array de `consecutivo_rips` nunca sale de Postgres. **Detalle crítico verificado con `EXPLAIN ANALYZE`** (no es intercambiable, se probó explícitamente): `consecutivo_rips IN (subquery)` hizo que el planificador de Postgres eligiera un `Merge Semi Join` con `Parallel Seq Scan` sobre las 171M filas de `rips_ap` — **42 segundos** para un código de alto volumen (medicamento/procedimiento con >300K apariciones totales en la tabla). Cambiando a `consecutivo_rips = ANY(ARRAY(subquery))` (misma semántica, sintaxis distinta) el planificador usa `Index Scan` sobre `rips_ap_idx_rips`/`rips_am_idx_rips`/`rips_at_idx_rips` — **~1.7-2s**, mismo resultado. Verificado en las 3 tablas (`rips_ap`, `rips_am` con el código de medicamento de mayor volumen del prestador de prueba: 59.874 filas). **Regla para el futuro**: en este proyecto, para filtrar por un conjunto de IDs ya resuelto en una subconsulta sobre una tabla RIPS grande sin índice por el otro criterio, usar siempre `= ANY(ARRAY(subquery))`, nunca `IN (subquery)` — no son equivalentes en la práctica para el planificador de esta base de datos.

### Filtro de fecha por vigencia del contrato, no histórico completo (mismo día, ajuste posterior al fix de 413)

Pedido del usuario tras ver el primer resultado (histórico completo, sin filtro de fecha): *"que las facturas sean 2026... que sean acordes con el contrato... pero que sean 2026"*. Se descartó hardcodear `WHERE fecha >= '2026-01-01'` — se rompería en cuanto cambie la vigencia del contrato en años futuros. En su lugar, `obtenerVigenciaContrato(ips)` (nueva función en `movimiento-rips-actions.ts`) calcula el rango real:

```sql
SELECT MIN(fecha_inicio) AS fecha_inicio, MAX(fecha_terminacion) AS fecha_terminacion
FROM administrativo.ct_ips_contrato c
WHERE c.ips = $1 AND c.sw_activo = 1 AND c.fecha_anula IS NULL
  AND c.numero_contrato != ALL($2)  -- CONTRATOS_EXCLUIDOS_MIGRACION
  AND c.fecha_inicio <= CURRENT_DATE AND c.fecha_terminacion >= CURRENT_DATE
```

Mismo criterio de "contrato vigente hoy" ya usado en `construirGruposTodosMunicipios` (dashboard-riesgo) y en `getOpcionesPrestadoresConsumo` (Módulo 4). Verificado contra la BD real para el prestador de prueba (CLINICA MEDICOS S.A., ips 803378): devuelve `2026-01-01` a `2026-12-31` — coincide con lo pedido ("2026") sin que el año esté escrito en ningún lado del código.

El rango resultante se pasa a las 3 funciones `obtenerMovimiento*` como parámetro opcional y se agrega `AND <columna_fecha> BETWEEN $n AND $n+1` (helper `construirFiltroFecha`, columna distinta por tipo: `fecha_procedimiento`/`fecha_dispensacion`/`fecha_atencion`, igual que en el resto de esta sección). **Caso borde manejado explícitamente**: si el prestador no tiene ningún contrato vigente HOY (`obtenerVigenciaContrato` devuelve `null`), se omite el filtro de fecha y se muestra el histórico completo — se prefirió no ocultar información a un analista solo porque el contrato ya venció, en vez de devolver "0 movimientos" de forma engañosa.

### Verificación de datos (2026-07-29, antes de construir)

Se probaron directamente contra la BD real (solo lectura) las 4 consultas de opciones que alimentan la pantalla (municipios, tipo de contrato, nivel de complejidad, prestadores) — todas devuelven filas correctamente. El caso reportado inicialmente por el usuario ("no me muestra municipios para cargar el dashboard") no era un bug: el dropdown se veía vacío porque el componente aún estaba en el estado de carga inicial (la pantalla "Calculando dashboard…" sin indicador de progreso hacía parecer que estaba trabado) — resuelto agregando la barra de progreso simulada (ver sección del Dashboard de Riesgo, "Ajuste de seguimiento — barra de progreso").

## Ver también
- [[Validaciones]]
- [[Arquitectura General]]
- [[Objetivos]]
- [[Tablas]]
- [[API]]
