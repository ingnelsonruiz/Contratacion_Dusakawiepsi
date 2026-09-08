/**
 * migrate-and-seed.mjs
 * Aplica la migración 001 y crea el usuario admin inicial.
 * Requiere Node.js >= 18 (fetch nativo).
 *
 * Uso desde PowerShell/CMD en la raíz del proyecto:
 *   node scripts/migrate-and-seed.mjs
 *
 * Variables de entorno opcionales (si no se definen usa los valores por defecto):
 *   PROXY_URL      - URL del proxy (default: https://pg-proxy.onrender.com/query)
 *   PROXY_API_KEY  - API key del proxy (default: dusakawi-proxy-2024-clave-secreta)
 *   ADMIN_USERNAME - usuario admin a crear (default: admin)
 *   ADMIN_PASSWORD - contraseña del admin (OBLIGATORIO o usa el prompt)
 */

import { createHash } from "crypto";
import { createInterface } from "readline";

const PROXY_URL     = process.env.PROXY_URL     || "https://pg-proxy.onrender.com/query";
const PROXY_API_KEY = process.env.PROXY_API_KEY || "dusakawi-proxy-2024-clave-secreta";
const ADMIN_USER    = process.env.ADMIN_USERNAME || "admin";

function sha256(text) {
  return createHash("sha256").update(text, "utf8").digest("hex");
}

async function proxyQuery(sql, params = [], source = "migrate-and-seed") {
  const res = await fetch(PROXY_URL, {
    method: "POST",
    headers: { "Content-Type": "application/json", "x-api-key": PROXY_API_KEY },
    body: JSON.stringify({ sql, params, source }),
    signal: AbortSignal.timeout(60000),
  });
  const text = await res.text();
  if (!res.ok) throw new Error(`Proxy error ${res.status}: ${text.substring(0, 300)}`);
  return JSON.parse(text);
}

async function askPassword() {
  const rl = createInterface({ input: process.stdin, output: process.stdout });
  return new Promise((resolve) => {
    rl.question("Contraseña para el usuario admin: ", (ans) => {
      rl.close();
      resolve(ans.trim());
    });
  });
}

async function main() {
  // ── 1. Migración 001 ──────────────────────────────────────────────────────
  console.log("\n[1/2] Aplicando migración 001 (negociacion_contratacion_usuario)...");
  await proxyQuery(`
    BEGIN;

    CREATE TABLE IF NOT EXISTS administrativo.negociacion_contratacion_usuario (
        id                BIGSERIAL PRIMARY KEY,
        username          VARCHAR(100) NOT NULL UNIQUE,
        nombre_completo   VARCHAR(200) NOT NULL,
        password_hash     VARCHAR(64)  NOT NULL,
        rol               VARCHAR(20)  NOT NULL DEFAULT 'analista',
        activo            SMALLINT     NOT NULL DEFAULT 1,
        usuario_grabado   VARCHAR(100),
        fecha_grabado     TIMESTAMP    NOT NULL DEFAULT now(),
        ultimo_login      TIMESTAMP,
        CONSTRAINT chk_negociacion_contratacion_usuario_rol
            CHECK (rol IN ('analista', 'jefe_contratacion', 'admin')),
        CONSTRAINT chk_negociacion_contratacion_usuario_activo
            CHECK (activo IN (0, 1))
    );

    CREATE INDEX IF NOT EXISTS idx_negociacion_contratacion_usuario_activo
        ON administrativo.negociacion_contratacion_usuario (activo);

    COMMENT ON TABLE administrativo.negociacion_contratacion_usuario IS
        'Usuarios del Sistema de Inteligencia de Precios para Negociación de Contratos.';

    COMMIT;
  `, [], "migration-001");
  console.log("    ✓ Tabla creada (o ya existía — IF NOT EXISTS es idempotente).");

  // ── 2. Crear usuario admin ────────────────────────────────────────────────
  let password = process.env.ADMIN_PASSWORD || "";
  if (!password) {
    password = await askPassword();
  }
  if (!password) {
    console.error("ERROR: Se requiere una contraseña para el usuario admin.");
    process.exit(1);
  }

  const passwordHash = sha256(password);

  console.log(`\n[2/2] Creando/actualizando usuario admin '${ADMIN_USER}'...`);
  await proxyQuery(
    `INSERT INTO administrativo.negociacion_contratacion_usuario
        (username, nombre_completo, password_hash, rol, activo, usuario_grabado)
     VALUES ($1, $2, $3, 'admin', 1, 'migrate-and-seed')
     ON CONFLICT (username) DO UPDATE SET
        password_hash = EXCLUDED.password_hash,
        rol = 'admin',
        activo = 1,
        usuario_grabado = 'migrate-and-seed'`,
    [ADMIN_USER, "Administrador SIE", passwordHash],
    "seed-admin"
  );
  console.log(`    ✓ Usuario '${ADMIN_USER}' con rol 'admin' listo.`);

  console.log("\n✅ Migración y seed completados. Ya puedes hacer login en la app.");
}

main().catch((err) => {
  console.error("\n❌ Error:", err.message || err);
  process.exit(1);
});
