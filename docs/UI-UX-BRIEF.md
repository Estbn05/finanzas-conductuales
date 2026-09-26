# Brief UI/UX: Finanzas Conductuales

## 1. Resumen del producto

**Finanzas Conductuales** es una aplicacion personal de presupuesto que busca responder una pregunta sencilla:

> ¿Cuanto dinero puedo gastar con tranquilidad durante este periodo?

No pretende ser una app contable compleja ni una copia del banco. Su propuesta es reducir la ansiedad y la carga mental al convertir el manejo del dinero en pocas acciones repetibles:

1. Definir cuanto dinero hay para el periodo.
2. Separar dinero para usos habituales.
3. Registrar cada gasto rapidamente.
4. Ver cuanto queda libre y como avanzan los limites.
5. Recibir recomendaciones de ahorro sin que la app mueva dinero.

La experiencia debe sentirse **clara, calmada, privada y sin culpa**. El usuario no deberia necesitar conocimientos financieros para entenderla.

## 2. Estado actual que debe tomarse como referencia

La aplicacion actual es una PWA mobile-first en espanol de Colombia y usa COP como moneda. Requiere cuenta e inicio de sesion, mantiene una copia local y sincroniza silenciosamente con Supabase.

La navegacion vigente es:

- **Inicio**
- **Plan**
- **Ahorro**
- **Movimientos**
- **Datos**
- **Registrar gasto**, como accion global y prominente

Las capturas actuales de `docs/screenshot-mobile.png` y `docs/screenshot-desktop.png` muestran una version anterior. Incluyen una seccion de deudas que ya no existe y una arquitectura de escritorio que ya no representa fielmente el producto.

La pantalla de Inicio vigente es deliberadamente minima: muestra el dinero libre, su distribucion entre cuenta y efectivo, y el consumo de las categorias del periodo. En el codigo quedan conceptos conductuales de una version anterior que no estan visibles actualmente en Inicio; se describen al final como oportunidades, no como superficie vigente.

## 3. Usuario principal

### Perfil base

Una persona joven que administra su dinero manualmente y necesita saber cuanto puede gastar sin comprometer obligaciones futuras. Puede recibir ingresos semanales, quincenales, mensuales, semestrales o anuales.

Puede ser estudiante becado, trabajador con salario fijo, freelance o alguien con ingresos variables.

### Contexto y tensiones

- No siempre piensa en meses; piensa en el periodo en que recibe dinero.
- Tiene dinero repartido entre cuenta bancaria y efectivo.
- Quiere separar dinero para gasolina, comida, salidas, regalos, ahorro u otros usos personales.
- Puede olvidar gastos pequeños o clasificarlos tarde.
- Le preocupa quedarse sin dinero antes de recibir nuevamente.
- Las apps financieras complejas pueden aumentar su ansiedad.
- Necesita orientación, pero no quiere que una app tome decisiones por ella.

### Trabajo principal por resolver

> Cuando recibo dinero y voy gastando durante el periodo, quiero saber cuanto sigue realmente disponible para gastos nuevos, para decidir con tranquilidad y no usar dinero que ya tenia otro proposito.

## 4. Principios de experiencia

### 4.1. Mostrar primero lo accionable

La cifra protagonista debe ser **dinero libre del periodo**, no el ingreso total, el gasto historico ni una puntuacion abstracta.

### 4.2. Hablar como una persona, no como un contador

Usar lenguaje cotidiano:

- "Libre para nuevos gastos"
- "Reservado"
- "Usado"
- "Pagado con cuenta"
- "Pagado en efectivo"

Evitar terminologia innecesariamente tecnica.

### 4.3. Orientar sin ordenar

El ahorro es una recomendacion. La interfaz debe dejar claro que:

- no mueve dinero;
- no modifica saldos;
- no garantiza resultados;
- el usuario conserva la decision.

### 4.4. Corregir sin castigar

Registrar, eliminar, reclasificar o deshacer debe ser facil. Los excesos deben tratarse como informacion para ajustar el plan, nunca como fracaso personal.

### 4.5. Reducir carga mental

Cada pantalla debe tener un objetivo principal. Evitar tableros llenos de metricas, graficas decorativas o multiples llamadas a la accion con el mismo peso.

### 4.6. Diseñar primero para movil

Registrar un gasto debe funcionar comodamente con una mano y en pocos segundos. La aplicacion es instalable como PWA y su orientacion principal es vertical.

## 5. Modelo mental y objetos principales

| Concepto | Significado para el usuario |
| --- | --- |
| Presupuesto base | Dinero que recibe normalmente en un periodo |
| Periodo | Semana, quincena, mes, semestre o año actual |
| Dinero extra | Regalo, bono, ayuda o venta que solo aumenta el periodo correspondiente |
| Campo o categoria | Proposito al que el usuario reserva dinero, por ejemplo gasolina o ahorro |
| Reservado | Suma destinada a campos antes de gastar |
| Gasto | Movimiento registrado que reduce la liquidez y el dinero libre |
| Libre | Dinero disponible para gastos nuevos despues de considerar reservas y gastos |
| Cuenta y efectivo | Lugares reales donde esta el dinero disponible |
| Total real | Cuenta + efectivo |
| Ahorro sugerido | Recomendacion calculada, no movimiento real |

Una consideracion importante de lenguaje: actualmente la app usa tanto **campo** como **categoria** para conceptos muy cercanos. El diseño deberia elegir un termino principal y usarlo consistentemente. "Categoria" es mas familiar; "sobre" o "bolsillo" puede comunicar mejor la idea de reserva, pero debe validarse con usuarios.

**Decision tomada (jul 2026):** para la *accion* de reservar se adopto el verbo cotidiano **"apartar dinero"**, no el sustantivo. El objeto sigue llamandose categoria; lo que cambio es como se le pide al usuario que la cree. El detonante fue hacer la app usable para adultos mayores: "aparte plata para los remedios" es el modelo mental de sobres que esa generacion ya usa, mientras que "crear una categoria con nombre, monto y frecuencia" es una abstraccion de software. Convive con el formulario completo, que queda para reservas que se repiten.

## 6. Arquitectura de informacion recomendada

### Navegacion principal en movil

1. **Inicio:** estado actual y limites.
2. **Plan:** crear y administrar categorias, presupuesto y dinero extra.
3. **Registrar:** accion central, siempre accesible.
4. **Movimientos:** historial y correcciones.
5. **Menu:** Ahorro, Gastos planeados y Datos, mas el estado de la copia en la nube.

Decisiones tomadas (sept. 2026):

- **Movimientos** tiene acceso directo en la barra inferior.
- En movil el menu no repite lo que ya esta en la barra inferior (Inicio, Plan, Movimientos, Registrar); en escritorio, donde el menu es la navegacion, si aparecen. Sin numeros 01-07: iconos.
- **Progreso** y el cierre de periodo se abren desde Plan ("Periodos anteriores", "Resumen del periodo") y mantienen marcada la pestaña Plan.
- **Datos** reune la configuracion: Apariencia y Recordatorio diario (bloque "Ajustes"), PIN, copias, cuenta (Cerrar sesion, Eliminar cuenta) y la politica de privacidad.
- El antiguo "Calendario financiero" se llama **Gastos planeados**: el calendario de gastos del dia a dia vive en Movimientos.

### Navegacion en escritorio

En pantallas anchas conviene mantener visible una barra lateral compacta con las secciones principales y conservar el contenido en una columna legible. El patron actual de drawer oculto y navegacion inferior puede sentirse excesivamente movil en escritorio.

## 7. Flujos principales

### Flujo A: Acceso y primera configuracion

1. La aplicacion comprueba si existe una sesion.
2. Si no existe, el usuario crea una cuenta o inicia sesion con correo y contraseña.
3. Un usuario nuevo completa tres pasos:
   - cuanto recibe y cada cuanto;
   - cuanto tiene en cuenta y efectivo;
   - para que suele separar dinero.
4. La aplicacion muestra el dinero libre resultante.
5. Una guia corta (7 pasos) recorre Inicio: la pantalla se oscurece y solo queda iluminada la parte que se explica (dinero libre, Registrar, Apartar dinero, Lo que vas usando, Plan, Movimientos, Menu). Se puede saltar en cualquier momento, sale una sola vez (tambien en otros dispositivos de la misma cuenta) y se repite desde Datos > Ajustes. Tono: que hace cada cosa, sin culpa ("si te pasas no pasa nada").

**Objetivo UX:** lograr el primer valor rapidamente sin pedir desde el comienzo datos psicologicos o financieros avanzados.

### Flujo B: Consulta diaria

1. El usuario abre la aplicacion.
2. Ve inmediatamente:
   - dinero libre del periodo;
   - dinero en cuenta;
   - dinero en efectivo;
   - total real;
   - categorias mas consumidas.
3. Decide si puede gastar o necesita revisar el plan.

**Objetivo UX:** entender la situacion en menos de cinco segundos.

### Flujo C: Registrar un gasto

1. El usuario toca Registrar o el boton flotante.
2. Indica comercio, descripcion opcional, categoria, origen del dinero y monto.
3. La app valida que exista suficiente dinero en cuenta o efectivo.
4. El gasto reduce el saldo correspondiente y el dinero libre.
5. Aparece una confirmacion con opcion de deshacer.

**Objetivo UX:** completar el registro con la menor friccion posible, idealmente en menos de 20 segundos.

### Flujo D: Crear y ajustar el plan

1. El usuario ve la distribucion del presupuesto entre reservado, gastado y libre.
2. Crea categorias con nombre, monto y frecuencia.
3. La app convierte automaticamente frecuencias distintas al periodo actual.
4. Impide reservar mas dinero del que queda libre.
5. Permite eliminar categorias; sus gastos vuelven a quedar sin clasificar.

**Objetivo UX:** que el usuario entienda el efecto de cada reserva antes de guardarla.

### Flujo E: Recibir dinero extra

1. El usuario registra origen, monto, fecha y lugar donde entro el dinero.
2. Antes de sumarlo, la app propone separar un porcentaje para ahorro.
3. El usuario puede aceptar la distribucion o dejar todo libre.
4. El dinero extra solo afecta el periodo al que pertenece.

**Objetivo UX:** aprovechar un momento favorable sin imponer ahorro.

### Flujo F: Consultar la recomendacion de ahorro

1. El usuario abre Ahorro.
2. Ve cuanto seria razonable apartar en el periodo.
3. Entiende como se calculo y si la recomendacion cabe en el dinero libre.
4. Puede simular destinar parte de un aumento futuro al ahorro.

**Objetivo UX:** dar una recomendacion transparente, comprensible y claramente orientativa.

### Flujo G: Revisar y corregir movimientos

1. El usuario abre Movimientos.
2. Ordena por mas recientes o por mayor monto.
3. Revisa comercio, descripcion, categoria, origen, fecha y monto.
4. Elimina un gasto incorrecto y la app devuelve el dinero al lugar correspondiente.

**Objetivo UX:** transmitir que los errores se pueden corregir sin miedo.

### Flujo H: Editar datos personales y financieros

1. El usuario abre Datos.
2. Consulta su cuenta, orientacion mensual y perfil conductual.
3. Edita presupuesto, periodo, liquidez, gastos comprometidos, ahorro actual, tipo de ingreso y respuestas conductuales.
4. Guarda el plan y todas las recomendaciones se recalculan.

**Objetivo UX:** separar claramente datos esenciales de configuracion avanzada.

## 8. Historias de usuario

### Acceso y confianza

- Como usuario nuevo, quiero crear una cuenta antes de ingresar datos financieros para poder recuperarlos y usarlos en varios dispositivos.
- Como usuario recurrente, quiero entrar y encontrar automaticamente mi informacion mas reciente.
- Como usuario sin conexion estable, quiero seguir viendo mi copia local mientras la sincronizacion se recupera.
- Como usuario, quiero cerrar sesion y retirar mis datos locales del dispositivo compartido.

### Presupuesto y liquidez

- Como usuario, quiero definir mi presupuesto segun la frecuencia real con la que recibo dinero.
- Como usuario, quiero indicar cuanto dinero tengo en cuenta y cuanto en efectivo para no confundir disponibilidad teorica con dinero real.
- Como usuario, quiero ver cuanto dinero sigue libre para decidir si puedo hacer un gasto nuevo.
- Como usuario, quiero crear categorias con frecuencias distintas para que la app reserve la cantidad correcta en mi periodo.
- Como usuario, quiero que la app me impida reservar mas dinero del disponible.

### Registro y correccion

- Como usuario, quiero registrar un gasto desde cualquier pantalla.
- Como usuario, quiero elegir si pague con cuenta o efectivo para mantener saldos reales.
- Como usuario, quiero ver como cambia una categoria despues de registrar un gasto.
- Como usuario, quiero deshacer inmediatamente un gasto registrado por error.
- Como usuario, quiero eliminar un movimiento antiguo incorrecto y recuperar su monto.

### Dinero extra y ahorro

- Como usuario, quiero sumar dinero extraordinario sin cambiar mi presupuesto recurrente.
- Como usuario, quiero decidir cuanto dinero extra separar para ahorro antes de gastarlo.
- Como usuario, quiero recibir una sugerencia de ahorro que considere mis ingresos, gastos comprometidos y volatilidad.
- Como usuario, quiero entender por que la recomendacion de ahorro es esa.
- Como usuario, quiero simular un aumento futuro sin alterar mi plan actual.

### Comprension emocional

- Como usuario ansioso por el dinero, quiero una interfaz calmada que me muestre el siguiente paso sin juzgarme.
- Como usuario que excedio una categoria, quiero saber que ajustar y cuanto queda, no recibir mensajes de culpa.
- Como usuario, quiero que las alertas usen texto y color para entenderlas incluso si no distingo bien los colores.

## 9. Detalle por pantalla

### 9.1. Comprobacion de sesion

**Contenido actual:** mensaje de espera mientras se restaura la sesion.

**Diseño recomendado:**

- Mostrar marca, mensaje breve y un indicador de progreso sutil.
- Evitar una pantalla visualmente identica a un error.
- Si tarda demasiado, explicar que se puede requerir iniciar sesion nuevamente.

### 9.2. Crear cuenta / iniciar sesion

**Contenido actual:** correo, contraseña, Crear cuenta e Iniciar sesion.

**Diseño recomendado:**

- Separar claramente los dos modos mediante pestañas o un enlace secundario.
- Mantener una sola accion primaria visible a la vez.
- Explicar en una frase por que se necesita cuenta: sincronizacion y recuperacion.
- Mostrar estados de cargando, credenciales invalidas, confirmacion de correo y falta de conexion.

### 9.3. Onboarding de tres pasos

**Paso 1:** frecuencia e ingreso por periodo.  
**Paso 2:** cuenta y efectivo; inicialmente deben sumar el presupuesto.  
**Paso 3:** categorias habituales opcionales.

**Diseño recomendado:**

- Incluir una vista previa persistente de "Te quedarian X libres".
- Explicar con un ejemplo la diferencia entre presupuesto y saldo real.
- Permitir omitir categorias y crearlas despues.
- Evitar pedir el perfil conductual avanzado en este flujo inicial.
- Cerrar con un momento claro de valor: "Este es tu dinero libre".

### 9.4. Inicio

**Contenido vigente:**

- Dinero libre del periodo como cifra protagonista.
- Bajo la cifra, la resta que la explica: "Tienes" (cuenta + efectivo − tarjeta) − "Reservado" (lo que aun queda por gastar en cada categoria, desplegable para ver en que) = "Libre". Con ingreso variable: presupuesto del periodo − reservado − gastado fuera de categorias = libre.
- Lista corta de categorias, ordenadas por porcentaje usado.
- Acceso a editar limites.

**Diseño recomendado:**

- Mantener esta pantalla muy compacta.
- Añadir una frase de contexto temporal: "Periodo del 1 al 30 de junio".
- ~~Mostrar la diferencia entre "libre" y "total real" con ayuda contextual.~~ Resuelto (sept. 2026): la tarjeta muestra la resta completa en vez de esconder la explicacion detras de un enlace; asi no hay que recordar que se aparto.
- Dar un estado vacio accionable cuando no hay categorias.
- No convertir Inicio en un dashboard de todas las funciones.

### 9.5. Registro rapido

**Contenido vigente:** bottom sheet con comercio, descripcion opcional, categoria, cuenta/efectivo y monto.

**Diseño recomendado:**

- Dar mayor jerarquia al monto; probablemente debe ser el primer dato o el foco principal.
- Recordar la ultima fuente y categorias frecuentes para acelerar registros repetidos.
- Hacer visibles los saldos disponibles de Cuenta y Efectivo al elegir fuente.
- Mostrar el efecto antes de confirmar: "Despues quedan X libres".
- Mantener Deshacer como confirmacion posterior.
- Evitar duplicar simultaneamente FAB y accion Registrar en navegacion si generan ruido.

### 9.6. Plan

**Contenido vigente:**

- Anillo con reservado, gastado y libre.
- Formulario para sumar dinero extra.
- Formulario para crear categorias.
- Lista de categorias con gasto, limite, frecuencia y accion de eliminar.

**Diseño recomendado:**

- Separar visualmente tres tareas: entender, agregar dinero y administrar categorias.
- Convertir "Crear categoria" en accion progresiva, no formulario siempre abierto.
- Ofrecer dos caminos para reservar, no uno: **"Apartar dinero"** (solo cuanto y para que, una vez en este periodo) como camino principal, y **"Apartar cada semana o mes"** (el formulario con frecuencia) para lo recurrente. El primero tambien esta disponible desde Inicio.
- Mostrar el impacto de una categoria antes de agregarla.
- Explicar la conversion de frecuencia, por ejemplo: "$30.000 semanal = $130.000 en este mes".
- Tratar "sobreasignado" y "gasto fuera del presupuesto" como estados distintos.
- Pedir confirmacion explicita al eliminar una categoria con movimientos asociados.

### 9.7. Ahorro

**Contenido vigente:**

- Recomendacion para el periodo.
- Meta ideal, ahorro ya reservado, libre despues de la sugerencia y momento sugerido.
- Explicacion del calculo.
- Fondo de referencia.
- Simulacion de aumento futuro.
- Proyeccion orientativa.

**Diseño recomendado:**

- Empezar con una unica respuesta: "Podrias apartar X".
- Mostrar un acordeon "Como se calculo" para reducir densidad inicial.
- Diferenciar con mucha claridad recomendacion, dinero reservado y ahorro real informado.
- Añadir etiquetas de confianza como "orientativo" y "no mueve dinero" cerca de la cifra, no solo en parrafos.
- Evitar que las proyecciones parezcan promesas.

### 9.8. Movimientos

**Contenido vigente:** historial del periodo, orden por fecha o monto y eliminacion.

**Diseño recomendado:**

- Agrupar por dia y mostrar monto con mayor jerarquia.
- Añadir filtros por categoria y fuente cuando aumente el volumen.
- Permitir editar o reclasificar, no solo eliminar.
- Usar confirmacion no destructiva y explicar que el saldo sera devuelto.
- Diseñar estado vacio con acceso directo a Registrar.

### 9.9. Datos

**Contenido vigente:**

- Cuenta y cierre de sesion.
- Resumen de ansiedad, autoeficacia y patron dominante.
- Patrones de dinero.
- Orientacion mensual.
- Victorias o avances.
- Modal extenso para editar todos los datos.

**Diseño recomendado:**

- Dividir la edicion en secciones o pantallas: Plan basico, Saldos, Recomendacion y Perfil conductual.
- No presentar todo como un formulario largo dentro de un modal.
- Explicar por que se pregunta ansiedad, confianza y patrones, y como afectan la experiencia.
- Hacer opcional el perfil conductual.
- Separar visualmente "Cerrar sesion" de las acciones normales.

## 10. Reglas de negocio que el diseño debe comunicar

- Todos los gastos reducen el dinero libre, incluso si pertenecen a una categoria reservada.
- Una categoria puede ser semanal, quincenal, mensual, semestral, anual o una vez por periodo.
- La app convierte el monto de una categoria a la duracion del periodo activo.
- Se permiten maximo diez categorias para mantener claridad.
- La app no permite crear una categoria que reserve mas dinero del libre.
- Cuenta y efectivo representan liquidez real; un gasto no puede superar el saldo de la fuente elegida.
- El dinero extra solo suma al periodo correspondiente a su fecha.
- El ahorro sugerido depende del tipo de ingreso, volatilidad, gastos comprometidos, reservas y fondo de referencia.
- Para ingresos variables, la tasa sugerida es mas precautoria.
- El ahorro sugerido nunca debe superar lo que realmente cabe en el plan.
- Un gasto se puede eliminar y su monto vuelve a la fuente con la que fue pagado.
- El cierre de sesion intenta guardar en nube y luego limpia la informacion local.

## 11. Estados que necesitan diseño explicito

### Estados globales

- Comprobando sesion.
- Sin sesion.
- Sin conexion o sincronizacion lenta.
- Sincronizacion recuperada.
- Guardado exitoso.
- Error de guardado.
- Sesion cerrandose.

### Estados del presupuesto

- Sin datos iniciales.
- Sin categorias.
- Presupuesto equilibrado.
- Dinero libre disponible.
- Presupuesto completamente reservado.
- Sobreasignado.
- Gasto fuera del presupuesto.

### Estados de categoria

- Saludable: hasta 65% usado.
- Atencion: mas de 65%.
- Critico: mas de 90%.
- Excedido: mas de 100%.

El color nunca debe ser la unica señal. Incluir texto, icono o cambio de etiqueta.

### Estados de formularios

- Vacio.
- En edicion.
- Validacion en contexto.
- Enviando.
- Exito con opcion de deshacer.
- Error recuperable.
- Accion destructiva con confirmacion.

### Estados de datos

- Periodo sin movimientos.
- Movimiento sin categoria.
- Dinero extra de otro periodo.
- Liquidez insuficiente en cuenta.
- Liquidez insuficiente en efectivo.
- Recomendacion de ahorro que cabe.
- Meta de ahorro que no cabe completamente.

## 12. Direccion visual recomendada

### Personalidad

La aplicacion deberia sentirse como una libreta financiera serena y precisa, no como una plataforma bancaria corporativa ni como un juego.

Palabras guia:

- calma;
- claridad;
- control personal;
- cercania;
- progreso;
- honestidad.

### Color

La base actual verde/teal es apropiada porque comunica estabilidad sin sentirse bancaria en exceso. Se recomienda:

- usar fondos neutros y superficies limpias;
- reservar verde para acciones y estado saludable;
- usar ambar para atencion;
- usar coral/rojo solo para estados que realmente requieren accion;
- comprobar contraste en claro y oscuro;
- acompañar siempre color con texto o iconografia.

### Tipografia y numeros

- Los montos deben ser el principal recurso jerarquico.
- Usar numeros tabulares para que saldos y listas sean faciles de comparar.
- Reducir el uso de mayusculas pequeñas en etiquetas si afecta legibilidad.
- Mantener textos explicativos breves y cercanos a la decision que ayudan a tomar.

### Componentes clave

- Resumen de dinero libre.
- Selector claro de periodo.
- Tarjeta o fila de categoria con limite, usado, restante y estado.
- Bottom sheet de registro.
- Mensaje con accion Deshacer.
- Distribucion reservado/gastado/libre.
- Estado vacio con siguiente paso.
- Ayuda contextual breve.
- Dialogo de confirmacion para acciones destructivas.

### Movimiento y feedback

- Animaciones cortas para cambios de saldo y barras.
- Confirmaciones discretas, nunca celebraciones exageradas.
- Vibracion opcional en movil al registrar o deshacer.
- Respetar `prefers-reduced-motion`.

## 13. Problemas y oportunidades detectados

### Prioridad alta

1. **Actualizar la fuente visual de verdad.** Las capturas y partes del README representan una version anterior con Deudas.
2. **Unificar vocabulario.** Se mezclan campo, categoria, presupuesto, reservado, libre y saldo real sin una explicacion central.
3. **Simplificar Datos.** El formulario avanzado es demasiado largo y mezcla datos esenciales con preguntas conductuales.
4. ~~**Aclarar libre frente a total real.**~~ Resuelto: ver 9.4.
5. **Diseñar escritorio como escritorio.** En pantallas anchas conviene una navegacion lateral persistente.
6. **Hacer visible la correccion.** Movimientos permite eliminar, pero deberia permitir editar y reclasificar.

### Prioridad media

1. Mostrar cuanto queda despues de registrar un gasto.
2. Dar contexto de fechas del periodo en Inicio.
3. Hacer progresiva la creacion de categorias y el ingreso de dinero extra.
4. Explicar mejor las conversiones de frecuencia.
5. Añadir filtros cuando el historial crezca.
6. Diseñar estados claros de sincronizacion sin llenar la interfaz de indicadores tecnicos.

### Oportunidades futuras a validar

La logica conserva ideas conductuales que hoy no forman parte visible del Inicio minimo:

- revision diaria y clasificacion de gastos;
- pausa de 24 horas para compras grandes no presupuestadas;
- victorias de proceso;
- mensajes de ajuste sin culpa;
- orientacion segun patrones de dinero.

Antes de devolverlas a la interfaz, conviene validar si ayudan al usuario principal o si aumentan complejidad. Pueden funcionar mejor como una seccion opcional de acompañamiento que como tarjetas permanentes del Inicio.

### Gastos mayores que el saldo

Registrar un gasto nunca se bloquea por saldo: la app anota lo que ya paso, no autoriza
compras. Un sobregiro, plata prestada o un saldo desactualizado son reales, y negarse a
anotarlos empujaba a falsear el monto. El saldo de Cuenta o Efectivo puede quedar en
negativo; el aviso va en el snackbar de siempre, sin rojo, con la forma de corregirlo en
Datos. Lo que si sigue validando el dinero libre son las decisiones (reservar, apartar).

### Tarjeta de credito como forma de pago

Distinto de la seccion de Deudas que se elimino (ver 13): no es una pantalla de
prestamos ni un plan de pago. Es una tercera fuente al registrar un gasto, junto a
Cuenta y Efectivo. Un gasto con tarjeta no baja el saldo de la cuenta: sube lo que
debes, y el "total real" resta eso, asi el dinero libre baja al gastar, que es lo cierto.
Pagar el extracto mueve plata de la cuenta a la tarjeta sin crear un gasto nuevo, porque
contarlo dos veces seria el error facil. Un ingreso nunca puede caer en la tarjeta.

En la interfaz: una pastilla mas en "Pagado con", una fila en los saldos de Inicio que
solo aparece cuando debes algo, y en Datos la fila fija con "Registrar pago de tarjeta".

## 14. Lo que no debe hacer el rediseño

- No convertir Inicio en un dashboard saturado.
- No presentar ahorro sugerido como dinero ya ahorrado.
- No usar culpa, puntuaciones moralizantes o lenguaje de fracaso.
- No ocultar las consecuencias de eliminar una categoria, gasto o dinero extra.
- No depender solo del color para comunicar riesgo.
- No obligar al usuario a completar el perfil conductual para usar el presupuesto.
- No priorizar graficas historicas antes de resolver registro, comprension y correccion.

## 15. Entregables sugeridos para el diseñador

1. Mapa de arquitectura de informacion para movil y escritorio.
2. Flujo de acceso y onboarding.
3. Flujo de registro rapido con exito, error y deshacer.
4. Wireframes de Inicio, Plan, Ahorro, Movimientos y Datos.
5. Estados vacios, advertencias, errores y acciones destructivas.
6. Sistema de componentes y tokens para temas claro y oscuro.
7. Prototipo navegable mobile-first.
8. Variante de escritorio con navegacion persistente.
9. Guia de contenido: vocabulario, tono y mensajes criticos.
10. Prueba de usabilidad centrada en tres tareas:
    - entender cuanto se puede gastar;
    - registrar y corregir un gasto;
    - crear una categoria semanal dentro de un presupuesto mensual o semestral.

## 16. Preguntas que el diseño debe ayudar a resolver

- ¿El usuario entiende "dinero libre" sin confundirlo con el total que tiene en cuenta y efectivo?
- ¿Categoria, campo, sobre o bolsillo es el mejor nombre para el dinero reservado?
- ¿Movimientos debe estar siempre en la navegacion inferior?
- ¿Registrar necesita FAB, opcion central en la barra inferior o ambos?
- ¿Cuanta explicacion necesita el usuario para confiar en la recomendacion de ahorro?
- ¿El perfil conductual aporta valor suficiente para ocupar una seccion visible?
- ¿La pausa de 24 horas ayuda o interrumpe?
- ¿Que informacion necesita estar en Inicio y que debe quedar bajo demanda?
- ¿Como se comunica una sincronizacion silenciosa sin generar incertidumbre?
- ¿La experiencia transmite acompañamiento sin parecer infantil o moralizante?

## 17. Criterio de exito del rediseño

El rediseño funciona si una persona nueva puede:

1. configurar su periodo sin ayuda;
2. explicar con sus palabras la diferencia entre libre, reservado y total real;
3. registrar un gasto correctamente en menos de 20 segundos;
4. corregir un error sin miedo;
5. saber cual es su siguiente accion sin recorrer varias pantallas;
6. entender que la recomendacion de ahorro orienta, pero no mueve su dinero.
