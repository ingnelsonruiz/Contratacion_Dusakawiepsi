import { cookies } from "next/headers";
import crypto from "node:crypto";

export const SESSION_COOKIE = "negociacion_contratacion_session";

export type Rol = "analista" | "jefe_contratacion" | "admin";

export interface Session {
  isLoggedIn: true;
  userId: number;
  username: string;
  nombreCompleto: string;
  rol: Rol;
}

/** Hash SHA-256 en hex — mismo patrón que administrativo.usuarios_tarifario (Proyecto_Dusakawi). */
export function sha256Hex(input: string): string {
  return crypto.createHash("sha256").update(input, "utf8").digest("hex");
}

const SESSION_MAX_AGE_SECONDS = 8 * 60 * 60; // 8 horas — jornada laboral

export async function createSession(session: Session): Promise<void> {
  const store = await cookies();
  store.set(SESSION_COOKIE, JSON.stringify(session), {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax",
    path: "/",
    maxAge: SESSION_MAX_AGE_SECONDS,
  });
}

export async function destroySession(): Promise<void> {
  const store = await cookies();
  store.delete(SESSION_COOKIE);
}

export async function getSession(): Promise<Session | null> {
  const store = await cookies();
  const raw = store.get(SESSION_COOKIE)?.value;
  if (!raw) return null;
  try {
    const parsed = JSON.parse(raw);
    if (parsed?.isLoggedIn) return parsed as Session;
    return null;
  } catch {
    return null;
  }
}

/** Jerarquía simple de roles para autorizar acciones administrativas. */
export function tieneRolMinimo(session: Session | null, rolMinimo: Rol): boolean {
  if (!session) return false;
  const orden: Rol[] = ["analista", "jefe_contratacion", "admin"];
  return orden.indexOf(session.rol) >= orden.indexOf(rolMinimo);
}
