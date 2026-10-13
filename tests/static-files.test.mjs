// Checks on files that are configuration rather than behavior: the web manifest, the
// Android project, the service worker's cache list, index.html's startup script and the
// stylesheet. Reading the file IS the right test for these (there is nothing to run in
// Node). What the app does is tested by booting it: see the *-smoke.test.mjs files.
import assert from "node:assert/strict";
import { readFile, stat } from "node:fs/promises";
import test from "node:test";
import { VERSIONED_FILES } from "../scripts/bump-version.mjs";

const read = (path) => readFile(new URL(`../${path}`, import.meta.url), "utf8");
const JAVA = "android/app/src/main/java/com/estbn05/finanzasconductuales";

// Single source of truth; `npm run bump` rewrites every copy.
const { version: ASSET_VERSION, dependencies } = JSON.parse(await read("package.json"));

// Every local module the app loads, following imports from app.js.
async function localModules() {
  const found = new Set();
  const pending = ["app.js"];
  while (pending.length) {
    const file = pending.pop();
    if (found.has(file)) continue;
    found.add(file);
    const source = await read(file);
    for (const match of source.matchAll(/from "\.\/([\w-]+\.js)\?v=/g)) {
      pending.push(match[1]);
    }
  }
  return [...found];
}

test("every hard-coded version matches package.json (use `npm run bump`)", async () => {
  const versionLike = /(?:\?v=|APP_VERSION = "|\$\{CACHE_PREFIX\})(\d+\.\d+\.\d+)/g;
  for (const file of VERSIONED_FILES) {
    const found = [...(await read(file)).matchAll(versionLike)].map((match) => match[1]);
    assert.ok(found.length > 0, `${file} has no version reference`);
    assert.deepEqual([...new Set(found)], [ASSET_VERSION], `${file} is out of sync`);
  }
  // A module with a versioned import that bump does not rewrite would drift silently.
  for (const file of await localModules()) {
    if ((await read(file)).includes("?v=")) {
      assert.ok(VERSIONED_FILES.includes(file), `${file} has ?v= imports but is not in VERSIONED_FILES`);
    }
  }
});

// Regression: extracting state-model.js out of app.js left it out of the mobile build and
// the service worker, so the APK shipped an app.js whose import 404'd and never booted.
test("every module the app imports ships in the APK and is cached for offline use", async () => {
  const buildScript = await read("scripts/build-mobile.mjs");
  const worker = await read("service-worker.js");
  const modules = await localModules();
  assert.ok(modules.includes("movements.js") && modules.includes("state-model.js"));
  for (const file of modules) {
    assert.ok(buildScript.includes(`"${file}"`), `${file} is missing from build-mobile.mjs`);
    assert.ok(worker.includes(`"${file}?v=${ASSET_VERSION}"`), `${file} is missing from the service worker's APP_SHELL`);
  }
  // The font is requested without a version query, so that exact URL must be cached.
  assert.ok(worker.includes('"assets/fonts/manrope-latin-var.woff2"'));
  // Navigations fall back to the cached shell offline; the worker never unregisters itself.
  assert.ok(worker.includes('request.mode === "navigate"'));
  assert.equal(worker.includes("registration.unregister()"), false);
});

test("manifest has mobile install metadata and required PNG icons", async () => {
  const manifest = JSON.parse(await read("manifest.webmanifest"));
  const iconSizes = manifest.icons.map((icon) => icon.sizes);
  assert.equal(manifest.display, "standalone");
  assert.equal(manifest.start_url, "./");
  assert.equal(manifest.orientation, "portrait-primary");
  assert.ok(iconSizes.includes("192x192"));
  assert.ok(iconSizes.includes("512x512"));
});

test("Android declares the plugins and permissions the app relies on", async () => {
  const manifest = await read("android/app/src/main/AndroidManifest.xml");
  const mainActivity = await read(`${JAVA}/MainActivity.java`);
  const buildGradle = await read("android/app/build.gradle");

  for (const plugin of ["@capacitor/app", "@capacitor/filesystem", "@capacitor/share", "@capacitor/local-notifications"]) {
    assert.ok(dependencies[plugin], `${plugin} is not installed`);
  }
  assert.ok(manifest.includes("android.permission.POST_NOTIFICATIONS"));

  // The two in-house plugins must be registered or window.Capacitor.Plugins lacks them.
  assert.ok(mainActivity.includes("registerPlugin(WidgetBridgePlugin.class);"));
  assert.ok(mainActivity.includes("registerPlugin(BiometricAuthPlugin.class);"));
  assert.ok((await read(`${JAVA}/WidgetBridgePlugin.java`)).includes('@CapacitorPlugin(name = "WidgetBridge")'));
  assert.ok((await read(`${JAVA}/BiometricAuthPlugin.java`)).includes('@CapacitorPlugin(name = "BiometricAuth")'));
  assert.ok(manifest.includes("android.permission.USE_BIOMETRIC"));
  assert.ok(buildGradle.includes("androidx.biometric:biometric"));
  assert.ok(manifest.includes('android:name=".FreeMoneyWidgetProvider"'));
});

// allowBackup="true" would let Android's Auto Backup upload localStorage (including the
// Supabase refresh token) to the user's Google Drive, outside any control the PIN has; on
// Android 12+ device-to-device transfer ignores it and follows dataExtractionRules.
test("Android backups and device transfers never copy the app's data", async () => {
  const manifest = await read("android/app/src/main/AndroidManifest.xml");
  assert.ok(manifest.includes('android:allowBackup="false"'));
  assert.ok(manifest.includes('android:dataExtractionRules="@xml/data_extraction_rules"'));
  const rules = await read("android/app/src/main/res/xml/data_extraction_rules.xml");
  for (const section of ["cloud-backup", "device-transfer"]) {
    const body = rules.slice(rules.indexOf(`<${section}>`), rules.indexOf(`</${section}>`));
    for (const domain of ["root", "database", "sharedpref", "file", "external"]) {
      assert.ok(body.includes(`<exclude domain="${domain}" />`), `${section} must exclude ${domain}`);
    }
  }
});

// The widget's "+" opens finanzasconductuales://registrar-gasto. The manifest, the widget
// and app.js each spell it out; if one drifts, the button just opens the app's home.
// (What app.js does with the URL is tested in app-native-smoke.test.mjs.)
test("the widget's quick-add link is spelled the same in the manifest, the widget and app.js", async () => {
  const manifest = await read("android/app/src/main/AndroidManifest.xml");
  const provider = await read(`${JAVA}/FreeMoneyWidgetProvider.java`);
  const app = await read("app.js");
  assert.ok(manifest.includes('android:scheme="finanzasconductuales"'));
  assert.ok(manifest.includes('android:host="registrar-gasto"'));
  assert.ok(provider.includes('QUICK_ADD_URI = "finanzasconductuales://registrar-gasto"'));
  assert.ok(app.includes('const WIDGET_QUICK_ADD_HOST = "registrar-gasto";'));
  // Info area and "+" need separate PendingIntents or they collapse into one tap target.
  assert.ok(provider.includes("setOnClickPendingIntent(R.id.widget_info, openIntent)"));
  assert.ok(provider.includes("setOnClickPendingIntent(R.id.widget_quick_add, quickAddPendingIntent)"));
});

test("index.html starts the app from local files and recovers on its own", async () => {
  const html = await read("index.html");
  // Supabase is vendored: a CDN would break the first offline launch.
  assert.ok(html.includes("loadScript(`vendor/supabase-2.108.1.min.js?v=${APP_VERSION}`)"));
  assert.equal(html.includes("cdn.jsdelivr.net"), false);
  assert.ok(html.includes("await import(`./app.js?v=${APP_VERSION}`)"));
  // A failed start retries once by itself instead of offering buttons that did not help.
  assert.ok(html.includes('const retryKey = "finanzas-startup-retry"'));
  assert.equal(html.includes('onclick="window.location.reload()"'), false);
  // index.html paints before app.js loads, so it resolves "follow the phone" itself.
  assert.ok(html.includes("prefers-color-scheme: dark"));
});

test("the brand typeface really ships, and comes first in every font stack", async () => {
  const styles = await read("styles.css");
  const font = await stat(new URL("../assets/fonts/manrope-latin-var.woff2", import.meta.url));
  assert.ok(font.size > 5000);
  assert.ok(styles.includes('url("assets/fonts/manrope-latin-var.woff2") format("woff2")'));
  assert.ok(styles.includes("font-weight: 400 800"));
  const stacks = styles.match(/font-family:[^;]*Inter[^;]*;/g) || [];
  assert.ok(stacks.length > 0);
  stacks.forEach((stack) => assert.ok(stack.includes('"Manrope"'), stack));
});

// Layout rules jsdom cannot evaluate (it does no layout). Each guards a bug that shipped.
test("styles keep touch targets, disabled buttons and long amounts usable", async () => {
  const styles = await read("styles.css");
  // The close button on every sheet was 34px, under the 44px minimum touch target.
  const iconButton = styles.slice(styles.lastIndexOf(".icon-btn {"), styles.indexOf(".icon-btn.muted"));
  assert.ok(iconButton.includes("width: 44px;") && iconButton.includes("height: 44px;"));
  // A disabled primary button kept its live green gradient, so taps silently did nothing.
  assert.match(styles, /\.btn\.primary:disabled[\s\S]{0,200}background: #d7dad6/);
  // Long formatted amounts must wrap instead of pushing the screen sideways.
  for (const selector of [".onboarding-preview strong {", ".conversion-box strong {"]) {
    const start = styles.indexOf(selector);
    const rule = styles.slice(start, styles.indexOf("}", start));
    assert.ok(rule.includes("overflow-wrap: anywhere") && rule.includes("min-width: 0"), selector);
  }
});
