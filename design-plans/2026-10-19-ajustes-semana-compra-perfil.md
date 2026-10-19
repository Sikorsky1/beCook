# Ajustes de Semana, Compra y Perfil (2026-10-19)

Pedido de Sergio en el hilo «Ajustes de Semana, Compra y Perfil» («aplica tu recomendación» en las
dudas). Toca tres componentes compartidos de alto riesgo; este documento deja constancia del cambio.

## Componentes compartidos

- `src/components/layout/StickyPageHeader.tsx`: `title` pasa a ser opcional. Sin título, la barra
  fija no muestra el punto naranja ni el nombre (Semana: solo queda la fecha grande del h1 y las
  flechas). Las demás pantallas no cambian.
- `src/components/ui/CategoryPill.tsx` (solo lo usa Despensa): la categoría seleccionada pasa de
  tinta (negro) a `accent-strong` con texto blanco y `shadow-pop`, el mismo naranja del día de hoy
  en Semana.
- `src/components/session/SyncStatus.tsx`: el estado «Guardado en tu cuenta» deja de verse en
  Semana, Compra, Despensa y Perfil (también en el onboarding). Se mantiene como texto solo para
  lectores de pantalla; los demás estados (guardando, pendiente, error) siguen visibles.

## Resto (sin componentes compartidos)

- Semana: «Volver a hoy» con el estilo de «Volver a Semana» de Crear menú (enlace discreto con
  chevron hacia hoy); «Tu semana tiene» sin «¿Por qué?».
- Crear menú: panel de pegar con solo «Escribe o pega tu menú», cuadro y «Subir PDF o foto»;
  sin textos grises bajo desayunos, en «Se creará para…» ni junto a «Descartar propuesta»; la
  propuesta sin «Generado para…» ni «Tu semana tiene»; «Otra idea» centrada; el resumen
  «14 platos · 7 días» queda solo para lectores de pantalla.
- Ficha del plato: sin «Revisa siempre el etiquetado» ni «Receta sin revisar por un profesional»,
  ingredientes con mayúscula inicial, título sin anillo de foco, barra superior fija con «Cambiar
  plato» (flechas en círculo) y «Cerrar» (X); los botones de abajo se mantienen.
- Compra: fechas y comensales («19–25 oct · 2 comensales»), sin «Parte de la lista…», «Para:» con
  dos platos como máximo y «…», «Para desayunos y meriendas» también en listas guardadas antes.
- Despensa: «Añadir productos que sueles tener».
- Perfil: días de entreno L–D, «Cardio» tercero, sin «Datos corporales».
