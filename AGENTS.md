# AGENTS.md

Guia para agentes Codex que trabajen en este repositorio.

## Proyecto

Finanzas Conductuales es una PWA de finanzas personales hecha con HTML, CSS y JavaScript vanilla. Tambien se empaqueta como app Android con Capacitor.

La app se publica en GitHub Pages y usa Supabase para autenticacion/sincronizacion. La clave anon/publishable en `sync-config.js` es publica por diseno; la seguridad depende de las politicas RLS en `docs/supabase-schema.sql`.

## Instalacion

```powershell
npm.cmd install
```

No agregues dependencias nuevas salvo que sean realmente necesarias y esten alineadas con la simplicidad del proyecto.

## Desarrollo local

```powershell
npm.cmd start
```

Abre:

```text
http://127.0.0.1:4173
```

El servidor local es importante para probar service worker/PWA. Abrir `index.html` directo puede servir para una revision rapida, pero no valida todo.

## Checks y tests

Comandos principales:

```powershell
npm.cmd run check
npm.cmd test
npm.cmd run verify
```

`npm.cmd run verify` ejecuta sintaxis y tests. Debe pasar antes de considerar terminado cualquier cambio de codigo.

## Build PWA y Android

Para sincronizar assets moviles:

```powershell
npm.cmd run build:mobile
```

Para sincronizar Capacitor:

```powershell
npm.cmd run android:sync
```

Para generar APK debug:

```powershell
npm.cmd run android:apk
```

APK esperado:

```text
C:\Users\yefry\Documents\finanzas\android\app\build\outputs\apk\debug\app-debug.apk
```

Si el cambio afecta `app.js`, `styles.css`, `index.html`, service worker, manifest o comportamiento visible, normalmente tambien debe correrse `npm.cmd run android:apk` para que `www/` y `android/app/src/main/assets/public/` queden sincronizados.

## Versionado de assets/cache

Cuando cambies JS/CSS/HTML que deba reflejarse en PWA o APK, sube el sufijo de version en:

- `index.html` (`APP_VERSION` y referencias de assets).
- `service-worker.js` (`CACHE_NAME` y `APP_SHELL`).
- `manifest.webmanifest` (iconos con `?v=`).
- imports versionados en `app.js`.
- `tests/pwa.test.mjs` (`ASSET_VERSION`).

Despues ejecuta:

```powershell
npm.cmd run verify
npm.cmd run android:apk
```

Esto evita que el telefono siga usando cache viejo.

## Convenciones de codigo

- Mantener JavaScript vanilla ES modules; no introducir framework frontend.
- Mantener tests con `node:test`.
- Preservar el estilo actual: funciones pequenas, renderizado con template strings y estado central en `app.js`.
- Preferir texto UI en espanol simple, corto y accionable.
- Mantener ASCII en codigo y textos nuevos salvo que el archivo ya use o necesite caracteres especiales.
- Usar `formatMoney`, `formatCompactMoney`, `todayKey`, `cleanDate`, `escapeHtml` y `escapeAttr` en vez de duplicar logica.
- Las reglas financieras centrales deben vivir en `finance-core.js` cuando sean calculos puros compartibles/testeables.
- La UI debe ser mobile-first: probar al menos un viewport tipo telefono cuando el cambio sea visual.
- No crear landing pages ni secciones explicativas pesadas dentro de la app; priorizar acciones y datos utiles.

## Convenciones de pruebas

- Cambios de calculos financieros: agregar/actualizar tests en `tests/finance-core.test.mjs`.
- Cambios de PWA, shell, navegacion, cache o presencia de UI: actualizar `tests/pwa.test.mjs`.
- Cambios de sincronizacion/autenticacion: actualizar `tests/sync-client.test.mjs`.
- Para UI visible, ademas de `npm.cmd run verify`, hacer una prueba renderizada con navegador cuando sea posible.
- Si el Browser integrado falla por permisos de Windows, usar Playwright + Microsoft Edge como fallback y reportar la razon.

## Definicion de terminado

Un cambio esta terminado cuando:

- La funcionalidad pedida esta implementada de extremo a extremo.
- `npm.cmd run verify` pasa.
- Si afecta PWA/APK, `npm.cmd run android:apk` pasa.
- Si afecta UI, se probo en un viewport movil y no hay errores relevantes de consola.
- Si se publica, el commit esta en `main` y GitHub Pages sirve la version nueva.
- No quedaron servidores locales, procesos de prueba ni carpetas temporales nuevas.
- El resumen final menciona pruebas ejecutadas, APK si aplica y cualquier riesgo no cubierto.

## Cosas que Codex debe evitar

- No borrar ni modificar cambios del usuario que no sean parte de la tarea.
- No tocar carpetas no rastreadas como `.codex-remote-attachments/`, `.qa-edge-profile*/`, `.real-login-cycle-test/` o `.session-backup-test/` salvo pedido explicito.
- No limpiar `docs/UI-UX-BRIEF.md` u otros untracked sin permiso.
- No hacer `git reset --hard`, `git checkout --` ni operaciones destructivas sin autorizacion explicita.
- No editar archivos generados en `www/` o `android/app/src/main/assets/public/` manualmente; usar scripts de build/sync.
- No introducir dependencias, frameworks, bundlers o herramientas pesadas si una solucion local es suficiente.
- No romper el flujo offline/PWA: cualquier cambio de cache debe preservar fallback de navegacion.
- No exponer datos privados de cuentas, sesiones o backups en logs, screenshots o respuestas.
- No asumir que el deploy de GitHub Pages es inmediato; verificar y, si hace falta, esperar y reintentar.
