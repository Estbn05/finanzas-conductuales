const config = window.FINANZAS_SYNC_CONFIG || {};
const CLOUD_TIMEOUT_MS = 10_000;
const SESSION_RETRY_DELAY_MS = 350;
const SESSION_BACKUP_KEY = "finanzas-conductuales:cloud-session:v1";
let client;

function withCloudTimeout(promise, operation) {
  let timer;
  const timeout = new Promise((_, reject) => {
    timer = setTimeout(() => reject(new Error(`${operation} tardo demasiado. Revisa internet e intenta de nuevo.`)), CLOUD_TIMEOUT_MS);
  });
  return Promise.race([promise, timeout]).finally(() => clearTimeout(timer));
}

function readSessionBackup() {
  try {
    const saved = JSON.parse(localStorage.getItem(SESSION_BACKUP_KEY) || "null");
    if (!saved?.access_token || !saved?.refresh_token) {
      return null;
    }
    return saved;
  } catch {
    return null;
  }
}

function isCurrentSessionBackup(session) {
  if (!session?.user || !session.access_token || !session.refresh_token) {
    return false;
  }
  const expiresAt = Number(session.expires_at || 0);
  return !expiresAt || expiresAt * 1000 > Date.now() + 60_000;
}

function persistSessionBackup(session) {
  if (!session?.access_token || !session?.refresh_token) {
    return;
  }
  try {
    localStorage.setItem(
      SESSION_BACKUP_KEY,
      JSON.stringify({
        access_token: session.access_token,
        expires_at: session.expires_at,
        expires_in: session.expires_in,
        refresh_token: session.refresh_token,
        token_type: session.token_type,
        user: session.user
      })
    );
  } catch {}
}

function clearSessionBackup() {
  try {
    localStorage.removeItem(SESSION_BACKUP_KEY);
  } catch {}
}

async function restoreCloudSession(cloud, backup) {
  const { data, error } = await withCloudTimeout(cloud.auth.setSession(backup), "Restaurar la sesión");
  if (error) {
    throw error;
  }
  persistSessionBackup(data.session);
  return data.session;
}

async function getStoredCloudSession(cloud, backup) {
  let lastError;
  for (let attempt = 0; attempt < 2; attempt += 1) {
    try {
      const { data, error } = await withCloudTimeout(cloud.auth.getSession(), "Comprobar la sesión");
      if (error) {
        throw error;
      }
      if (data.session) {
        persistSessionBackup(data.session);
        return data.session;
      }

      if (!backup) {
        return null;
      }
      return await restoreCloudSession(cloud, backup);
    } catch (error) {
      lastError = error;
      if (attempt === 0) {
        await new Promise((resolve) => setTimeout(resolve, SESSION_RETRY_DELAY_MS));
      }
    }
  }
  throw lastError;
}

export function clearStoredCloudSession() {
  clearSessionBackup();
}

export function isCloudConfigured() {
  return Boolean(config.supabaseUrl && config.supabaseAnonKey);
}

export function isCloudLibraryLoaded() {
  return Boolean(window.supabase?.createClient);
}

export function getCloudClient() {
  if (!isCloudConfigured() || !isCloudLibraryLoaded()) {
    return null;
  }

  if (!client) {
    client = window.supabase.createClient(config.supabaseUrl, config.supabaseAnonKey, {
      auth: {
        autoRefreshToken: true,
        detectSessionInUrl: true,
        lock: window.supabase.processLock,
        lockAcquireTimeout: 4_000,
        persistSession: true
      }
    });
  }

  return client;
}

// A network/timeout failure here doesn't mean the user signed out — it means we
// couldn't reach Supabase to confirm either way. A genuine auth rejection (revoked
// session, bad refresh token) comes back as a different error shape from Supabase and
// does NOT match this, so it still propagates and correctly shows the sign-in screen.
function isNetworkError(error) {
  const message = String(error?.message || error || "").toLowerCase();
  return message.includes("fetch") || message.includes("tardo demasiado") || message.includes("network");
}

export async function getCloudSession() {
  const cloud = getCloudClient();
  if (!cloud) {
    return null;
  }

  const backup = readSessionBackup();
  if (isCurrentSessionBackup(backup)) {
    restoreCloudSession(cloud, backup)
      .catch(() => {});
    return backup;
  }

  try {
    return await getStoredCloudSession(cloud, backup);
  } catch (error) {
    // Treating "can't reach Supabase" as "signed out" would lock the user out of their
    // own local data over a connectivity hiccup (see shouldShowAuthGate() in app.js).
    // If we have a backup at all, hand it back optimistically — autoRefreshToken and
    // onAuthStateChange pick up the real session once connectivity returns.
    if (backup && isNetworkError(error)) {
      return backup;
    }
    throw error;
  }
}

export function onCloudAuthChange(callback) {
  const cloud = getCloudClient();
  if (!cloud) {
    return () => {};
  }
  const { data } = cloud.auth.onAuthStateChange((event, session) => {
    if (session) {
      persistSessionBackup(session);
    }
    setTimeout(() => callback(session, event), 0);
  });
  return () => data.subscription.unsubscribe();
}

export async function signInToCloud(email, password) {
  const cloud = getCloudClient();
  if (!cloud) {
    throw new Error("La librería de nube no está disponible.");
  }
  const { data, error } = await withCloudTimeout(cloud.auth.signInWithPassword({ email, password }), "Iniciar sesión");
  if (error) {
    throw error;
  }
  persistSessionBackup(data.session);
  return data.session;
}

// Envia el correo de "restablecer contraseña". El link de ese correo lleva a una
// pagina web propia (reset-password.html, fuera de la app) porque completar el
// cambio requiere una sesion de recuperacion temporal que Supabase entrega via la URL
// del correo — no algo que la app movil pueda interceptar sin deep linking.
export async function requestPasswordReset(email) {
  const cloud = getCloudClient();
  if (!cloud) {
    throw new Error("La librería de nube no está disponible.");
  }
  const { error } = await withCloudTimeout(
    cloud.auth.resetPasswordForEmail(email, {
      redirectTo: "https://estbn05.github.io/finanzas-conductuales/reset-password.html"
    }),
    "Enviar el enlace de restablecimiento"
  );
  if (error) {
    throw error;
  }
}

export async function signUpToCloud(email, password) {
  const cloud = getCloudClient();
  if (!cloud) {
    throw new Error("La librería de nube no está disponible.");
  }
  const { data, error } = await withCloudTimeout(cloud.auth.signUp({ email, password }), "Crear la cuenta");
  if (error) {
    throw error;
  }
  persistSessionBackup(data.session);
  // Supabase deliberately does NOT return an error when the email is already
  // registered: that would let anyone enumerate which accounts exist. Instead it
  // returns a placeholder user whose identities array is empty, which is the only
  // reliable way to tell "cuenta nueva" apart from "ese correo ya existe".
  const alreadyRegistered =
    Boolean(data.user) && Array.isArray(data.user.identities) && data.user.identities.length === 0;
  return {
    session: data.session,
    alreadyRegistered,
    needsConfirmation: !data.session && !alreadyRegistered
  };
}

export async function signOutFromCloud() {
  const cloud = getCloudClient();
  if (!cloud) {
    return;
  }
  const { error } = await withCloudTimeout(cloud.auth.signOut(), "Cerrar la sesión");
  if (error) {
    throw error;
  }
  clearSessionBackup();
}

export async function loadCloudState() {
  const cloud = getCloudClient();
  const userId = await getCloudUserIdForRequest(cloud);
  if (!cloud || !userId) {
    return null;
  }

  const { data, error } = await withCloudTimeout(
    cloud
      .from("finance_app_state")
      .select("app_state, updated_at")
      .eq("user_id", userId)
      .maybeSingle(),
    "Descargar los datos"
  );

  if (error) {
    throw error;
  }
  return data;
}

export async function saveCloudState(appState) {
  const cloud = getCloudClient();
  const userId = await getCloudUserIdForRequest(cloud);
  if (!cloud || !userId) {
    return null;
  }

  const updatedAt = new Date().toISOString();
  const { data, error } = await withCloudTimeout(
    cloud
      .from("finance_app_state")
      .upsert({
        user_id: userId,
        app_state: appState,
        updated_at: updatedAt
      }, { onConflict: "user_id" })
      .select("updated_at")
      .single(),
    "Guardar los datos"
  );

  if (error) {
    throw error;
  }
  return data;
}

export async function deleteCloudAppState() {
  const cloud = getCloudClient();
  const userId = await getCloudUserIdForRequest(cloud);
  if (!cloud || !userId) {
    return;
  }

  const { error } = await withCloudTimeout(
    cloud.from("finance_app_state").delete().eq("user_id", userId),
    "Eliminar tus datos"
  );

  if (error) {
    throw error;
  }
}

// Borra la cuenta de autenticación (correo + contraseña) además de los datos,
// llamando a la Edge Function `delete-account`, que corre en el servidor con la clave
// service_role. El cliente no puede borrar un usuario de auth por sí mismo: la anon
// key no tiene permisos para eso (y tenerla sería un hueco de seguridad). Devuelve
// true si la función confirmó el borrado; false si la función no está desplegada
// todavía (para que el llamador pueda al menos borrar los datos y cerrar sesión).
export async function deleteCloudAccount() {
  const cloud = getCloudClient();
  if (!cloud || !isCloudConfigured()) {
    return false;
  }

  const session = await getCloudSessionForRequest(cloud);
  const accessToken = session?.access_token;
  if (!accessToken) {
    throw new Error("No hay una sesión activa para eliminar la cuenta.");
  }

  const endpoint = `${config.supabaseUrl.replace(/\/+$/, "")}/functions/v1/delete-account`;
  let response;
  try {
    response = await withCloudTimeout(
      fetch(endpoint, {
        method: "POST",
        headers: {
          Authorization: `Bearer ${accessToken}`,
          apikey: config.supabaseAnonKey,
          "Content-Type": "application/json"
        }
      }),
      "Eliminar la cuenta"
    );
  } catch (error) {
    throw new Error(`No pude contactar el servidor para eliminar la cuenta: ${error.message}`);
  }

  // 404 = la Edge Function aún no está desplegada. No es un error del usuario; se lo
  // reporta al llamador para que haga el borrado parcial (datos) y avise.
  if (response.status === 404) {
    return false;
  }

  let payload = null;
  try {
    payload = await response.json();
  } catch {}

  if (!response.ok || !payload?.ok) {
    throw new Error(payload?.error || `El servidor respondió ${response.status} al eliminar la cuenta.`);
  }

  clearSessionBackup();
  return true;
}

async function getCloudUserIdForRequest(cloud) {
  if (!cloud) {
    return "";
  }

  const session = await getCloudSessionForRequest(cloud);
  if (!session) {
    return "";
  }

  if (cloud.auth.getUser) {
    try {
      const { data, error } = await withCloudTimeout(cloud.auth.getUser(), "Comprobar el usuario activo");
      if (error) {
        throw error;
      }
      if (data?.user?.id) {
        return data.user.id;
      }
    } catch (error) {
      if (!session?.user?.id) {
        throw error;
      }
    }
  }

  return session?.user?.id || "";
}

async function getCloudSessionForRequest(cloud) {
  const backup = readSessionBackup();
  if (isCurrentSessionBackup(backup)) {
    try {
      return await restoreCloudSession(cloud, backup);
    } catch {}
  }

  return getStoredCloudSession(cloud, backup);
}
