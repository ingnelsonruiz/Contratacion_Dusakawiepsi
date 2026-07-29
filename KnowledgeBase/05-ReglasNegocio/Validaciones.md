---
tags: [reglas-negocio, validaciones]
---

# Validaciones

## Validaciones implementadas hoy

### Login (`loginAction`, `src/app/actions/auth-actions.ts`)

| Validación | Regla | Dónde ocurre |
|---|---|---|
| Usuario y clave obligatorios | `!usuario \|\| !password` → error | Servidor (Server Action) |
| Usuario `trim()` | Se recorta espacios antes de comparar | Servidor |
| Credenciales correctas | `password_hash = sha256Hex(password)` debe coincidir en BD | Servidor + consulta SQL |
| Usuario activo | `activo = 1` en `negociacion_contratacion_usuario` | Servidor |

### Cliente (HTML nativo)

`LoginForm` usa atributos `required` en los `<Input>` de usuario y clave — validación mínima de UX antes de invocar la Server Action. **No hay validación de esquema (`zod`) en el cliente todavía**, pese a que `zod` y `react-hook-form` están instalados como dependencias.

### Rol (`CHECK` constraint en BD)

```sql
CONSTRAINT chk_negociacion_contratacion_usuario_rol
    CHECK (rol IN ('analista', 'jefe_contratacion', 'admin'))
CONSTRAINT chk_negociacion_contratacion_usuario_activo
    CHECK (activo IN (0, 1))
```

Estas restricciones garantizan a nivel de base de datos que no se inserten roles o valores de `activo` fuera del dominio válido.

## Validaciones de negocio planificadas (no implementadas)

| Validación | Módulo | Fuente |
|---|---|---|
| Todo umbral de variación de tarifa (%) debe ser configurable, no hardcodeado | Módulo 4 | [[Contratación]] |
| Nunca `SELECT *` sobre `rips_ap/am/at` sin filtro de período | Transversal (ETL) | [[Objetivos#Principios no negociables]] |
| Parámetros posicionales siempre en SQL (nunca interpolación de string) | Transversal | Ya aplicado en `loginAction`/`db.ts`, a mantener en todo código nuevo |
| Toda función de cálculo estadístico/financiero debe ser pura y testeable en `src/lib/negociacion/` | Módulos 1-5 | [[Patrones#Lógica de negocio pura, separada de la UI]] |

## Validaciones de infraestructura

`src/lib/db.ts` valida la forma de la respuesta del proxy (JSON vs. HTML de error, código HTTP, tiempo transcurrido) para decidir si reintentar o fallar — ver [[Middleware]] y [[Problemas Comunes]].

## Ver también
- [[Contratación]]
- [[Autorizaciones]]
- [[RCV]]
- [[Autenticación]]
