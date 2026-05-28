# Finanzas Conductuales

Aplicacion personal de finanzas basada en economia conductual. El objetivo no es solo mostrar saldos, sino convertir el manejo del dinero en un sistema de pequenas acciones repetibles: monitoreo diario, automatizacion de ahorro, reduccion de deuda por victorias pequenas y alertas visuales de gasto.

![Vista principal de Finanzas Conductuales](docs/screenshot-desktop.png)

## Por que este proyecto suma al portafolio

- Traduce un PRD con investigacion conductual a una experiencia de producto funcional.
- Usa arquitectura frontend sin dependencias externas, ideal para GitHub Pages.
- Incluye persistencia local, importacion/exportacion JSON, PWA basica y diseno responsive.
- Muestra decisiones de UX orientadas a cambio de comportamiento, no solo CRUD.

## Funcionalidades principales

- **Mis datos:** ingreso, gastos comprometidos, ahorro disponible, deuda, ansiedad financiera, confianza y patrones de dinero.
- **Registrar como pantalla principal:** la app abre en el registro de gastos para que el habito diario sea inmediato.
- **Menu vertical desplegable:** guarda Plan, Deudas, Ahorro, Inicio, Datos, nube y avisos sin ocupar la pantalla principal.
- **Barra de dinero disponible:** queda fija en el encabezado y no tapa el contenido.
- **Registro primero:** el formulario para guardar un gasto aparece antes de los resumenes por categoria.
- **Inicio accionable:** muestra el siguiente paso: poner datos reales, clasificar gastos, cerrar la revision, ahorrar o pagar deuda.
- **Contexto estudiante becado:** permite modelar ingreso semestral, gasolina semanal de moto, salidas con pareja, regalos, gastos de universidad e imprevistos.
- **Presupuesto 1/3:** divide ingreso en deuda, ahorro y gastos; ajusta ahorro precautorio si el ingreso es variable.
- **Zero-based budgeting:** cada categoria de gasto recibe un trabajo especifico.
- **Buffer de emergencia:** meta base equivalente a US$2.000, con barrido automatico sugerido el dia 5.
- **Deudas por pasos pequenos:** ordena deudas por saldo para priorizar cierres y aumentar autoeficacia.
- **Exposicion gradual:** si la ansiedad o evitacion financiera es alta, oculta el total de deuda y muestra solo el siguiente paso.
- **Pausa de 24 horas:** detiene compras grandes no presupuestadas antes de registrarlas.
- **Alertas de agotamiento:** barras por categoria cambian de verde a amarillo y rojo.
- **Victorias de proceso:** celebra consistencia, no solo montos.

## Stack

- HTML, CSS y JavaScript vanilla.
- `localStorage` para persistencia personal.
- Service worker y manifest para comportamiento PWA.
- Tests con `node:test`, sin framework externo.
- Servidor local minimo en Node.js para desarrollo.

## Personalizacion real incluida

La app incluye un preset personal para un estudiante becado:

- Beca semestral: `$1.750.000`.
- Meses a cubrir: `6`.
- Ingreso mensual equivalente: cerca de `$291.667`.
- Moto: gasolina semanal de `$30.000`, convertida a presupuesto mensual.
- Categorias iniciales: gasolina moto, salidas con novia, regalos para novia, universidad/comida e imprevistos.

La documentacion conductual base se conserva, pero el motor financiero ahora adapta la regla general al contexto de ingreso semestral: primero divide el dinero por meses, protege gastos fijos semanales y luego reparte ahorro/flexible.

## Ejecutar localmente

```bash
npm run check
npm test
npm start
```

Luego abre:

```text
http://127.0.0.1:4173
```

Tambien puedes abrir `index.html` directamente, aunque el service worker requiere servidor local.

## PWA y movil

La app incluye manifest, service worker, iconos PNG/SVG, soporte iOS con `apple-touch-icon` y cache offline de los archivos principales. Para instalarla en movil debe servirse por HTTPS; GitHub Pages cumple ese requisito.

En Android/Chrome: abre la demo publicada y elige "Instalar app" o "Agregar a pantalla principal".

En iPhone/Safari: abre la demo, toca compartir y luego "Agregar a pantalla de inicio".

## Sincronizacion entre dispositivos

La app funciona offline primero con `localStorage`. Para compartir datos entre computador y celular, incluye una capa opcional de Supabase:

- Primer inicio de sesion en un dispositivo: si no hay nube, sube el plan local automaticamente.
- Inicio de sesion en otro dispositivo: si ya hay nube, la descarga automaticamente.
- Cada cambio posterior se sube solo, sin presionar "descargar nube".

Configuracion:

1. Crea un proyecto en Supabase.
2. En el SQL editor, ejecuta [docs/supabase-schema.sql](docs/supabase-schema.sql).
3. En Authentication, habilita Email/Password.
4. Copia `Project URL` y la `anon public key` o `publishable key`.
5. Edita `sync-config.js`:

```js
window.FINANZAS_SYNC_CONFIG = {
  supabaseUrl: "https://TU_PROYECTO.supabase.co",
  supabaseAnonKey: "TU_ANON_O_PUBLISHABLE_KEY"
};
```

La anon key o publishable key de Supabase es publica por diseno; la seguridad la controlan las politicas RLS del archivo SQL.

## Publicacion en GitHub Pages

Este repositorio incluye `.github/workflows/pages.yml`. Cuando el proyecto se suba a GitHub y Pages este configurado con **GitHub Actions** como fuente, cada push a `main` o `master` ejecutara tests y publicara la demo.

## Mapa PRD a producto

| Requisito conductual | Implementacion |
| --- | --- |
| Monitoreo financiero diario | Ritual de etiquetado y streak |
| Pain of paying sintetico | Alertas visuales de agotamiento por categoria |
| Power of defaults | Auto-buffer activado por defecto |
| Save More Tomorrow | Escalador de ahorro ante aumentos futuros |
| 1/3 Rule | Motor de presupuesto deuda/ahorro/gastos |
| Zero-based budgeting | Trabajos de dinero dentro del tercio de gastos |
| Debt Snowball | Orden por deuda mas pequena y registro de pagos |
| Evitar Ostrich Effect | Modo de exposicion gradual para alta ansiedad |
| Relapse response | Reencuadre cuando una categoria se excede |

## Roadmap

- Graficas historicas por mes.
- Modo multi-moneda.
- Integracion opcional con CSV bancario.
- Pruebas automatizadas de reglas financieras.
- Exportacion de reporte mensual en PDF.

## Nota de privacidad

Esta version no envia datos a servidores. Toda la informacion se guarda en el navegador del usuario y puede exportarse o reiniciarse desde la pantalla de perfil.
