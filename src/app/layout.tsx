import type { Metadata } from 'next';
import './globals.css';

export const metadata: Metadata = {
  title: 'Inteligencia de Precios · Contratación DUSAKAWI EPSI',
  description: 'Plataforma de inteligencia de precios para negociación de contratos con la red prestadora.',
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="es" suppressHydrationWarning>
      {/* suppressHydrationWarning: extensiones de navegador (Grammarly, etc.) inyectan
          atributos data-gr-* en <body> antes de que React hidrate, lo que dispara un
          falso positivo de hydration mismatch. No es un error real del árbol. */}
      <body className="antialiased" suppressHydrationWarning>{children}</body>
    </html>
  );
}
