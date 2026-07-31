// src/middleware.ts
import { NextResponse } from 'next/server';
import type { NextRequest } from 'next/server';

const SESSION_COOKIE = 'negociacion_contratacion_session';

export async function middleware(request: NextRequest) {
  const sessionCookie = request.cookies.get(SESSION_COOKIE)?.value;
  let isLoggedIn = false;

  if (sessionCookie) {
    try {
      const session = JSON.parse(sessionCookie);
      if (session?.isLoggedIn) {
        isLoggedIn = true;
      }
    } catch {
      isLoggedIn = false;
    }
  }

  if (!isLoggedIn) {
    const loginUrl = new URL('/login', request.url);
    loginUrl.searchParams.set('callbackUrl', request.nextUrl.pathname);
    return NextResponse.redirect(loginUrl);
  }

  return NextResponse.next();
}

// Protege todo excepto login, raíz pública, api y estáticos.
export const config = {
  matcher: [
    '/dashboard/:path*',
    '/tarifarios/:path*',
    '/comparativo/:path*',
    '/analisis-propuesta/:path*',
    '/precio-referencia-eps/:path*',
    '/consumo/:path*',
    '/sobrecostos/:path*',
    '/simulador/:path*',
    '/benchmark/:path*',
    '/admin/:path*',
  ],
};
