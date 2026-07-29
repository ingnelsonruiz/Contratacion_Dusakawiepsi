/**
 * Declaración ambiental para los imports profundos de lucide-react
 * (`lucide-react/icons/<kebab-case>`), usados en TODO el proyecto en vez de
 * `import { X } from "lucide-react"` — ver next.config.ts para el porqué
 * (evita el conflicto de doble optimización que causaba
 * "__webpack_require__.n is not a function").
 *
 * lucide-react@0.475.0 declara en su package.json que cada subpath
 * `./icons/*` tiene tipos en `dist/icons/*.d.ts`, pero esos archivos NO
 * existen realmente en el paquete instalado (verificado: la carpeta
 * `dist/icons/` no existe, solo `dist/esm/icons/*.js` sin `.d.ts` al lado).
 * Sin esta declaración, TypeScript reporta TS7016 en los ~30 imports de
 * íconos del proyecto (no rompe el build por `ignoreBuildErrors: true`, pero
 * sí el tipado en el editor). Se declara el módulo comodín una sola vez aquí
 * en vez de silenciar el error por archivo.
 */
declare module "lucide-react/icons/*" {
  import type { ForwardRefExoticComponent, RefAttributes, SVGProps } from "react";

  export interface LucideProps extends Omit<SVGProps<SVGSVGElement>, "ref"> {
    size?: string | number;
    absoluteStrokeWidth?: boolean;
  }

  type LucideIcon = ForwardRefExoticComponent<LucideProps & RefAttributes<SVGSVGElement>>;

  const Icon: LucideIcon;
  export default Icon;
}
