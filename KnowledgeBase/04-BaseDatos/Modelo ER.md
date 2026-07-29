---
tags: [base-datos, modelo-er, postgresql]
---

# Modelo ER

> [!info] Alcance
> Diagrama entidad-relación combinando: **(a)** la única tabla implementada (`negociacion_contratacion_usuario`), **(b)** las 10 tablas planificadas en `docs/ARQUITECTURA.md` §3.2, y **(c)** las tablas SIE existentes que se consultan de solo lectura (§3.1). Las tablas planificadas se marcan explícitamente — no representan un esquema aplicado en la BD.

## Diagrama completo

```mermaid
erDiagram
    negociacion_contratacion_usuario ||--o{ negociacion_contratacion_escenario : "crea (usuario_grabado)"
    negociacion_contratacion_usuario ||--o{ negociacion_contratacion_log_auditoria : "genera"

    negociacion_contratacion_escenario ||--|{ negociacion_contratacion_escenario_detalle : "contiene"
    negociacion_contratacion_escenario ||--o{ negociacion_contratacion_ronda_negociacion : "tiene rondas"

    negociacion_contratacion_snapshot_tarifario }o--|| ct_ips_contrato : "referencia (solo lectura)"
    negociacion_contratacion_consumo_agregado }o--|| ct_ips : "referencia (solo lectura)"
    negociacion_contratacion_escenario_detalle }o--|| negociacion_contratacion_snapshot_tarifario : "compara contra"
    negociacion_contratacion_escenario_detalle }o--|| negociacion_contratacion_consumo_agregado : "proyecta contra"

    negociacion_contratacion_exclusion_calidad }o--|| negociacion_contratacion_consumo_agregado : "excluye registros de"
    negociacion_contratacion_indicador_cache }o--|| negociacion_contratacion_consumo_agregado : "resume"
    negociacion_contratacion_indicador_cache }o--|| negociacion_contratacion_snapshot_tarifario : "resume"

    negociacion_contratacion_usuario {
        bigserial id PK
        varchar_100 username UK
        varchar_200 nombre_completo
        varchar_64 password_hash
        varchar_20 rol
        smallint activo
        varchar_100 usuario_grabado
        timestamp fecha_grabado
        timestamp ultimo_login
    }

    negociacion_contratacion_snapshot_tarifario {
        bigserial id PK
        date fecha_snapshot
        text codigo
        text tipo_tarifa
        numeric valor
        text nota
    }

    negociacion_contratacion_consumo_agregado {
        bigserial id PK
        text prestador
        text codigo
        text periodo
        text tipo
        numeric unidades
        numeric valor_total
        numeric valor_unitario_promedio
        numeric valor_unitario_mediana
    }

    negociacion_contratacion_benchmark_mercado {
        bigserial id PK
        text codigo
        text fuente
        numeric valor_referencia
        date fecha_carga
    }

    negociacion_contratacion_escenario {
        bigserial id PK
        text prestador_objetivo
        bigint usuario_id FK
        timestamp fecha
        text estado
        numeric meta_ahorro
    }

    negociacion_contratacion_escenario_detalle {
        bigserial id PK
        bigint escenario_id FK
        text codigo
        numeric tarifa_actual
        numeric tarifa_propuesta
        numeric consumo_proyectado
        numeric impacto_estimado
    }

    negociacion_contratacion_ronda_negociacion {
        bigserial id PK
        bigint escenario_id FK
        int numero_ronda
        text oferta
        timestamp fecha
    }

    negociacion_contratacion_exclusion_calidad {
        bigserial id PK
        text tabla_origen
        text criterio
        text usuario_grabado
        timestamp fecha_grabado
    }

    negociacion_contratacion_log_auditoria {
        bigserial id PK
        bigint usuario_id FK
        text accion
        text detalle
        timestamp fecha
    }

    negociacion_contratacion_indicador_cache {
        bigserial id PK
        text nombre_indicador
        jsonb valor
        timestamp fecha_calculo
    }
```

> [!warning] Nivel de detalle de columnas
> Las columnas de `negociacion_contratacion_usuario` son exactas (tomadas de la migración SQL aplicada). Las columnas del resto de tablas son **una interpretación razonable del rol descrito en `docs/ARQUITECTURA.md` §3.2** — ninguna de esas tablas tiene DDL escrito todavía. Antes de generar una migración real, el equipo de base de datos debe definir tipos y restricciones exactas.

## Tablas SIE existentes referenciadas (solo lectura, fuera de este esquema nuevo)

`ct_ips_contrato`, `ct_ips`, `tb_tarifario_propio_encabezado`, `tb_tarifario_propio_detalle`, `tb_cup`, `tb_medicamento`, `tb_insumo`, `tb_concepto_nota_tecnica`, `rips_ap`, `rips_am`, `rips_at`, `rips_resumen`, `rips_af`, `log_sc_factura_pago_detallado`. Ver detalle de uso en [[Tablas#Tablas SIE existentes]].

## Ver también
- [[Tablas]]
- [[Relaciones]]
- [[Índices]]
- [[Procedimientos]]
