---
tags: [deployment, docker]
---

# Docker

## Estado actual

> [!warning]
> **No existe `Dockerfile` ni `docker-compose.yml` en el repositorio.** El proyecto se ejecuta hoy directamente con Node.js 20 (`engines.node: "20"` en `package.json`) vía `npm run dev` / `npm run build` / `npm run start`.

## Si se decide containerizar

Al no usar ORM ni dependencias nativas complejas, un `Dockerfile` estándar multi-stage para Next.js 15 sería suficiente:

```dockerfile
# Ejemplo de referencia — no existe en el repo, no ha sido validado
FROM node:20-slim AS deps
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci

FROM node:20-slim AS builder
WORKDIR /app
COPY --from=deps /app/node_modules ./node_modules
COPY . .
RUN npm run build

FROM node:20-slim AS runner
WORKDIR /app
ENV NODE_ENV=production
COPY --from=builder /app/.next ./.next
COPY --from=builder /app/node_modules ./node_modules
COPY --from=builder /app/package.json ./package.json
EXPOSE 9010
CMD ["npm", "start"]
```

> [!important]
> Este `Dockerfile` es una **propuesta de referencia de este documento**, no código validado del proyecto. Antes de usarlo en producción, el equipo debe confirmar variables de entorno (ver [[Variables]]) y probar el build.

## Ver también
- [[Render]]
- [[Vercel]]
- [[Variables]]
