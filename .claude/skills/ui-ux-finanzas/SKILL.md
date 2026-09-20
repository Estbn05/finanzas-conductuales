---
name: ui-ux-finanzas
description: Guia de principios de UI/UX para la app "Finanzas Conductuales" (presupuesto personal conductual, PWA mobile-first en espanol de Colombia), basada en el brief completo en docs/UI-UX-BRIEF.md. Usa esta skill SIEMPRE que se pida crear, cambiar, rediseñar, mejorar, estilizar o revisar cualquier parte visual o de experiencia de la app: pantallas completas (Inicio, Plan, Ahorro, Movimientos, Datos, onboarding, login), componentes individuales (botones, tarjetas, formularios, bottom sheets, navegacion), copy o textos de interfaz, paleta de color, tipografia, animaciones, estados vacios/error/carga, o accesibilidad. Tambien aplica a pedidos que no mencionan "UI/UX" explicitamente pero son visuales, como "mejora el boton de registrar gasto", "la pantalla de Inicio se ve muy cargada", "cambia los colores", o un rediseño amplio que toque muchas pantallas a la vez.
---

# UI/UX de Finanzas Conductuales

Esta app ya tiene un brief de producto y UX completo en [docs/UI-UX-BRIEF.md](../../../docs/UI-UX-BRIEF.md), escrito despues de auditar el estado actual de la app. Antes de tocar cualquier pantalla o componente, lee ese archivo — o al menos la seccion relevante segun la tabla de abajo. No reinventes decisiones de producto que el brief ya resolvio (nombres de conceptos, jerarquia de informacion, tono).

## Por que importa seguir el brief y no solo "verse bonito"

El objetivo de la app no es impresionar visualmente sino reducir la ansiedad financiera del usuario. Un rediseño que se vea moderno pero rompa la jerarquia de informacion (por ejemplo, hacer protagonista el gasto total en vez del dinero libre) o introduzca lenguaje culposo iria directamente en contra del proposito del producto, aunque el resultado sea esteticamente superior. Por eso cada decision visual debe poder justificarse con uno de los principios de la seccion 4 del brief, no solo con gusto personal.

## Principios innegociables (resumen rapido)

Estos son los cinco filtros que debe pasar cualquier cambio visual, incluso si el brief no cubre el caso exacto:

1. **La cifra protagonista es "dinero libre del periodo"**, nunca el gasto total, el ingreso, ni una puntuacion abstracta.
2. **Lenguaje cotidiano, no contable.** "Libre", "Reservado", "Usado" — no "saldo neto" ni jerga financiera.
3. **El ahorro orienta, no ordena.** Cualquier UI de ahorro debe dejar claro que no mueve dinero ni garantiza resultados.
4. **Corregir es facil y no tiene culpa.** Excesos y errores se comunican como informacion util, nunca como fracaso. El color nunca es la unica señal de estado (acompañar con texto/icono).
5. **Mobile-first, una tarea por pantalla.** Registrar un gasto debe sentirse comodo con una mano en menos de 20 segundos. Evitar dashboards saturados con multiples llamadas a la accion del mismo peso.

Si un cambio propuesto choca con alguno de estos, señalalo al usuario en vez de aplicarlo en silencio.

## Si vas a mostrar mockups o direcciones visuales antes de tocar codigo

Cuando el pedido es explorar opciones antes de implementar (por ejemplo "muestrame 3 direcciones para elegir" o un rediseño donde el usuario quiere ver alternativas primero), no inventes un sistema visual nuevo desde cero por defecto. Esta app ya tiene una identidad visual real e implementada con bastante nivel de produccion (degradados, sombras suaves, chips, tarjetas con acento de color, boton primario con degradado diagonal y brillo radial) — un mockup plano, sin sombras ni degradados, con hairlines finas al estilo "boceto minimalista", se siente como un paso atras aunque la jerarquia de informacion sea correcta. Ya paso una vez: tres conceptos bien fundamentados en el brief fueron rechazados en bloque porque no se veian "producidos" al nivel de la app real.

Antes de dibujar cualquier mockup:

1. Extrae los tokens reales de `styles.css` (colores, gradientes, sombras, radios, familia tipografica) en vez de asumirlos. El archivo es grande (miles de lineas) y puede tener bloques `:root` viejos sin usar de iteraciones anteriores — no confies en el primer bloque que encuentres. Si hay una app corriendo (`npm start`, puerto 4173 por defecto), la forma mas confiable de saber que token gana la cascada es abrir la app en el navegador e inspeccionar `getComputedStyle(document.documentElement)` para los custom properties (`--paper`, `--teal`, `--ink`, `--shadow`, etc.), y tambien revisar `getComputedStyle` de un `h1`/`body` para la tipografia real.
2. Si una pantalla especifica esta detras de login (como Inicio, que requiere sesion de Supabase), no inicies sesion real para verla — leer el codigo (funcion de render en `app.js` + las reglas CSS de esas clases exactas) es suficiente para reconstruir el markup y estilos reales sin credenciales.
3. Construye los mockups reutilizando esos valores reales (mismo fondo con degradado radial + textura de lineas, mismas sombras `--ds-shadow-xs/sm/md`, mismo radio de esquina, mismo boton primario con degradado) en vez de una paleta o tratamiento inventado. La variacion entre opciones deberia venir de la jerarquia/estructura (que se muestra, que se agrupa, que se colapsa), no de reinventar el lenguaje visual — eso ya esta resuelto y aprobado en produccion.
4. Esta bien señalar huecos reales entre el codigo y el brief (por ejemplo, si el brief pide texto ademas de color para estados y el codigo actual solo usa color) y proponer cerrarlos, pero dejalo explicito como una mejora puntual, no como parte de "la direccion visual".
5. Si el usuario pide explicitamente explorar algo radicalmente distinto a la identidad actual, ahi si vale la pena divergir — pero por defecto, parte de lo real.

## Donde buscar en el brief segun la tarea

| Si la tarea es... | Lee esta seccion del brief |
| --- | --- |
| Rediseñar una pantalla especifica (Inicio, Plan, Ahorro, Movimientos, Datos, login, onboarding) | 9. Detalle por pantalla — tiene "contenido vigente" y "diseño recomendado" por pantalla |
| Decidir que palabra usar (categoria vs campo vs sobre, libre vs total real, etc.) | 5. Modelo mental y objetos principales |
| Navegacion, arquitectura de informacion, que va en cada tab | 6. Arquitectura de informacion recomendada |
| Un flujo completo (registrar gasto, onboarding, dinero extra, ahorro) | 7. Flujos principales |
| Color, tipografia, tono visual, componentes clave, animaciones | 12. Direccion visual recomendada |
| Estados vacios, de error, de carga, de categoria (saludable/atencion/critico/excedido) | 11. Estados que necesitan diseño explicito |
| Reglas de negocio que la UI debe respetar (limites, conversion de frecuencia, etc.) | 10. Reglas de negocio que el diseño debe comunicar |
| Priorizar que atacar primero en un rediseño amplio | 13. Problemas y oportunidades detectados |
| Saber que evitar activamente | 14. Lo que no debe hacer el rediseño |

## Si el pedido es un rediseño amplio ("cambiar todo lo visual")

Cuando el usuario pida tocar muchas pantallas o toda la identidad visual a la vez:

1. Empieza por la seccion 13 (prioridad alta) del brief para ordenar el trabajo — no ataques las seis pantallas a la vez sin plan.
2. Antes de escribir codigo, resuelve las decisiones de vocabulario pendientes (seccion 5: "categoria" vs "campo" vs "sobre") una sola vez y aplica el termino elegido consistentemente en todas las pantallas. Cambiar el vocabulario a mitad de camino genera inconsistencia peor que la que habia antes.
3. Verifica cada pantalla nueva contra la seccion 16 (preguntas que el diseño debe ayudar a resolver) y la seccion 17 (criterio de exito) antes de darla por terminada.
4. Los flujos de negocio (seccion 10) no deben cambiar de comportamiento durante un rediseño puramente visual — si un cambio visual obliga a alterar una regla de negocio, confirmalo explicitamente con el usuario primero.
5. Si el rediseño termina cambiando una decision de producto que el brief documenta (por ejemplo, elegir "sobre" en vez de "categoria", o mover Movimientos a la barra inferior), actualiza `docs/UI-UX-BRIEF.md` para que siga siendo la fuente de verdad — un brief desactualizado es peor que no tener brief.

## Que hacer si el brief no cubre el caso

El brief es exhaustivo pero no infinito. Si aparece un componente o pantalla nueva que no esta documentado, usa los cinco principios innegociables de arriba como guia, y comentale al usuario que es una decision nueva no cubierta por el brief para que la confirme — no la inventes en silencio como si fuera parte del documento existente.
