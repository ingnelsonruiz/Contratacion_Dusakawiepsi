"use server";

import { pool } from "@/lib/db";
import { createSession, destroySession, sha256Hex, type Rol } from "@/lib/auth";

export interface LoginResult {
  success: boolean;
  error?: string;
}

/**
 * Autentica contra administrativo.negociacion_contratacion_usuario.
 * No usa NextAuth/Supabase Auth (decisión de arquitectura, ver docs/ARQUITECTURA.md
 * sección 7): cookie de sesión propia + tabla de usuarios con hash SHA-256.
 */
export async function loginAction(username: string, password: string): Promise<LoginResult> {
  const usuario = username?.trim();
  if (!usuario || !password) {
    return { success: false, error: "Usuario y clave son obligatorios." };
  }

  const passwordHash = sha256Hex(password);

  let rows: any[];
  try {
    const result = await pool.query(
      `SELECT id, username, nombre_completo, rol, activo
       FROM administrativo.negociacion_contratacion_usuario
       WHERE username = $1 AND password_hash = $2`,
      [usuario, passwordHash],
      "auth/login"
    );
    rows = result?.rows ?? [];
  } catch (error: any) {
    console.error("[auth] Error consultando negociacion_contratacion_usuario:", error);
    return {
      success: false,
      error:
        "No fue posible validar las credenciales (la tabla de usuarios aún no existe o el proxy no está disponible). Verifique que la migración 001 haya sido aplicada.",
    };
  }

  const user = rows[0];
  if (!user) {
    return { success: false, error: "Usuario o clave incorrectos." };
  }
  if (Number(user.activo) !== 1) {
    return { success: false, error: "El usuario existe pero está inactivo. Contacte al administrador." };
  }

  await createSession({
    isLoggedIn: true,
    userId: Number(user.id),
    username: user.username,
    nombreCompleto: user.nombre_completo,
    rol: user.rol as Rol,
  });

  // Auditoría mínima de acceso (no bloqueante: si falla, no impide el login).
  try {
    await pool.query(
      `UPDATE administrativo.negociacion_contratacion_usuario SET ultimo_login = now() WHERE id = $1`,
      [user.id],
      "auth/ultimo-login"
    );
  } catch (error) {
    console.warn("[auth] No se pudo actualizar ultimo_login:", error);
  }

  return { success: true };
}

export async function logoutAction(): Promise<void> {
  await destroySession();
}
