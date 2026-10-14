# Rediseño Motion Primitives (rama `motionPrimitives`)

Pedido por Sergio el 2026-10-14: rediseño completo con las herramientas de
[ibelick/motion-primitives](https://github.com/ibelick/motion-primitives), paleta equilibrada y
cercana a la actual, ajustes de UX con criterio. Solo Preview (becook-preview); nada a producción.

## Discrepancia con AGENTS.md (señalada)

AGENTS.md pide plan aprobado antes de tocar `globals.css`, `src/components/ui/*`, navegación y
layouts, y prohíbe dependencias nuevas. El encargo explícito de Sergio («rediseña por completo»,
«usa motion-primitives») lo exige: se añade `motion@12.43.0` (única dependencia de los componentes)
y se tocan esos ficheros en esta rama. Este documento es el plan para revisarlo antes de cualquier merge.

## Componentes copiados (registro oficial, `src/components/motion-primitives/`)

animated-background, animated-group, animated-number, border-trail, scroll-progress,
text-effect, text-shimmer, transition-panel. Ajustes propios marcados con «beCook:»: colores con
tokens (sin hex), `motion.create` fuera del render (React Compiler), AnimatedBackground controlado
por la ruta y ScrollProgress oculto arriba del todo.

## Qué cambia

- Paleta: se conservan los anclajes probados (fondo `#fff6ed`, CTA `#b8532a`, avisos `#8a4e2a`,
  acento `#e0703c`); se afinan tinta, superficies, bordes y oliva, y se añaden `--ink`, `--glow` y
  sombras en capas (`--shadow-card`, `--shadow-float`, `--shadow-pop`). Fondo con dos halos suaves.
- Tipografía: Fraunces (serif) para títulos de página y sección; Geist para el resto.
- Navegación inferior: dock con píldora de tinta que se desliza (AnimatedBackground).
- Compra/Despensa: pestañas segmentadas con indicador deslizante; contadores que ruedan
  (AnimatedNumber) con barra de progreso; secciones que entran escalonadas; cambio de categoría de
  la despensa con TransitionPanel.
- Cabecera fija: punto de marca, título de página con TextEffect y progreso de lectura.
- Semana: tarjeta de «Hoy» destacada, días con entrada escalonada, estado vacío rediseñado.
- Crear menú: tarjeta principal destacada; propuesta con entrada escalonada; progreso de la IA con
  TextShimmer y BorderTrail.
- Perfil, onboarding y pantallas de cuenta: secciones escalonadas, barra de pasos animada.

## Accesibilidad

`MotionConfig reducedMotion="user"`: con «reducir movimiento» solo quedan cambios de opacidad.
Textos animados con copia `sr-only` (TextEffect) o `aria-hidden` + texto equivalente (contadores).
Sin transformaciones en ancestros de barras fijas. Se mantienen los 44 px, 12 px mínimos y foco.
