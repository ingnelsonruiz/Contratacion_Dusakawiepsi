---
tags: [arquitectura, diagramas, mermaid]
---

# Diagramas

Índice central de todos los diagramas Mermaid de la base de conocimiento. Cada diagrama vive en el documento más relevante a su tema; aquí se referencian para navegación rápida.

## Arquitectura general del ecosistema

Ver [[Visión General#Relación con el ecosistema Dusakawi]] — relación entre `Proyecto_Dusakawi`, `Contratacion_dusakawiepi` y `base_sie_dusakawi`.

## Flujo ETL (planificado)

Ver [[Arquitectura General#3. Estrategia ETL]] — secuencia cron → lectura RIPS → matching → agregación → snapshot → cache.

## Flujo de reintentos del proxy de base de datos

Ver [[Patrones#Proxy HTTP en vez de conexión directa a PostgreSQL]] — distinción cold start vs. timeout de query pesada.

## Flujo de autenticación (login)

Ver [[Flujo Login]] — diagrama de secuencia completo cliente → Server Action → BD → cookie.

## Navegación entre rutas protegidas

```mermaid
graph TD
    Root["/ (landing pública)"] --> Login["/login"]
    Login -->|loginAction exitoso| Dashboard["/dashboard"]
    Middleware{{"middleware.ts<br/>valida cookie de sesión"}}
    Middleware -.protege.-> Dashboard
    Middleware -.protege.-> Tarifarios["/tarifarios (planificado)"]
    Middleware -.protege.-> Comparativo["/comparativo (planificado)"]
    Middleware -.protege.-> Consumo["/consumo (planificado)"]
    Middleware -.protege.-> Sobrecostos["/sobrecostos (planificado)"]
    Middleware -.protege.-> Simulador["/simulador (planificado)"]
    Middleware -.protege.-> Benchmark["/benchmark (planificado)"]
    Middleware -.protege.-> Admin["/admin (planificado)"]

    Dashboard -->|logoutAction| Login

    style Dashboard fill:#2d5,stroke:#333
    style Login fill:#2d5,stroke:#333
    style Root fill:#2d5,stroke:#333
```

> [!note]
> Solo `/`, `/login` y `/dashboard` existen hoy en código. El resto de rutas están en el `matcher` de `middleware.ts` (ya protegidas de antemano) pero sus páginas aún no se han construido.

## Diagrama Entidad-Relación (parcial + planificado)

Ver [[Modelo ER]] para el diagrama completo con las 11 tablas del esquema `negociacion_contratacion_*`.

## Casos de uso por rol

```mermaid
graph LR
    Analista((Analista de<br/>Contratación))
    Jefe((Jefe de<br/>Contratación))
    Admin((Administrador))

    Analista --> UC1[Consultar tarifarios]
    Analista --> UC2[Ver comparativos]
    Analista --> UC3[Ver consumo/frecuencia]

    Jefe --> UC1
    Jefe --> UC2
    Jefe --> UC3
    Jefe --> UC4[Simular escenarios]
    Jefe --> UC5[Ver dashboard ejecutivo]

    Admin --> UC1
    Admin --> UC2
    Admin --> UC3
    Admin --> UC4
    Admin --> UC5
    Admin --> UC6[Gestionar usuarios]
    Admin --> UC7[Ver auditoría]
    Admin --> UC8[Excluir datos atípicos]
```

> [!warning]
> Este diagrama refleja la **jerarquía de roles diseñada** (`tieneRolMinimo()` en `src/lib/auth.ts`: `analista < jefe_contratacion < admin`). Los casos de uso UC1-UC8 corresponden a los módulos planificados; ninguno tiene UI implementada todavía salvo el login/logout.

## Ver también
- [[Arquitectura General]]
- [[Modelo ER]]
- [[Flujo Login]]
