/**
 * Crea (o actualiza) el primer usuario administrador de
 * administrativo.negociacion_contratacion_usuario.
 *
 * Uso:
 *   1. Definir ADMIN_USERNAME y ADMIN_PASSWORD en .env.local (o exportarlas
 *      en la shell) junto con PROXY_URL/PROXY_API_KEY.
 *   2. npm run seed:admin
 *
 * La clave nunca se guarda en texto plano: solo se usa en memoria para
 * calcular el hash SHA-256 que se inserta en la BD (mismo patrón que
 * administrativo.usuarios_tarifario en Proyecto_Dusakawi).
 *
 * Requiere que la migración 001 (negociacion_contratacion_usuario) ya
 * exista en la BD — ver db/migrations/001_negociacion_contratacion_usuario.sql.
 */
import "dotenv/config";
import { pool } from "../src/lib/db";
import { sha256Hex } from "../src/lib/auth";

async function main() {
  const username = process.env.ADMIN_USERNAME;
  const password = process.env.ADMIN_PASSWORD;

  if (!username || !password) {
    console.error("Defina ADMIN_USERNAME y ADMIN_PASSWORD (ver .env.example) antes de ejecutar este script.");
    process.exit(1);
  }

  const passwordHash = sha256Hex(password);

  await pool.query(
    `INSERT INTO administrativo.negociacion_contratacion_usuario
       (username, nombre_completo, password_hash, rol, activo, usuario_grabado)
     VALUES ($1, $2, $3, 'admin', 1, 'seed-script')
     ON CONFLICT (username) DO UPDATE SET
       password_hash = EXCLUDED.password_hash,
       rol = 'admin',
       activo = 1`,
    [username, "Administrador", passwordHash],
    "seed-admin"
  );

  console.log(`Usuario admin '${username}' creado/actualizado correctamente.`);
  process.exit(0);
}

main().catch((error) => {
  console.error("Error creando el usuario admin:", error);
  process.exit(1);
});
