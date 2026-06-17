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

export async function getCloudSession() {
  const cloud = getCloudClient();
  if (!cloud) {
    return null;
  }

  const backup = readSessionBackup();
  if (isCurrentSessionBackup(backup)) {
    withCloudTimeout(cloud.auth.setSession(backup), "Restaurar la sesion")
      .then(({ data, error }) => {
        if (!error) {
          persistSessionBackup(data.session);
        }
      })
      .catch(() => {});
    return backup;
  }

  let lastError;
  for (let attempt = 0; attempt < 2; attempt += 1) {
    try {
      const { data, error } = await withCloudTimeout(cloud.auth.getSession(), "Comprobar la sesion");
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
      const { data: restored, error: restoreError } = await withCloudTimeout(
        cloud.auth.setSession(backup),
        "Restaurar la sesion"
      );
      if (restoreError) {
        throw restoreError;
      }
      persistSessionBackup(restored.session);
      return restored.session;
    } catch (error) {
      lastError = error;
      if (attempt === 0) {
        await new Promise((resolve) => setTimeout(resolve, SESSION_RETRY_DELAY_MS));
      }
    }
  }
  throw lastError;
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
    throw new Error("La libreria de nube no esta disponible.");
  }
  const { data, error } = await withCloudTimeout(cloud.auth.signInWithPassword({ email, password }), "Iniciar sesion");
  if (error) {
    throw error;
  }
  persistSessionBackup(data.session);
  return data.session;
}

export async function signUpToCloud(email, password) {
  const cloud = getCloudClient();
  if (!cloud) {
    throw new Error("La libreria de nube no esta disponible.");
  }
  const { data, error } = await withCloudTimeout(cloud.auth.signUp({ email, password }), "Crear la cuenta");
  if (error) {
    throw error;
  }
  persistSessionBackup(data.session);
  return data.session;
}

export async function signOutFromCloud() {
  const cloud = getCloudClient();
  if (!cloud) {
    return;
  }
  const { error } = await withCloudTimeout(cloud.auth.signOut(), "Cerrar la sesion");
  if (error) {
    throw error;
  }
  clearSessionBackup();
}

export async function loadCloudState() {
  const cloud = getCloudClient();
  const session = await getCloudSession();
  if (!cloud || !session) {
    return null;
  }

  const { data, error } = await withCloudTimeout(
    cloud
      .from("finance_app_state")
      .select("app_state, updated_at")
      .eq("user_id", session.user.id)
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
  const session = await getCloudSession();
  if (!cloud || !session) {
    return null;
  }

  const updatedAt = new Date().toISOString();
  const { data, error } = await withCloudTimeout(
    cloud
      .from("finance_app_state")
      .upsert({
        user_id: session.user.id,
        app_state: appState,
        updated_at: updatedAt
      })
      .select("updated_at")
      .single(),
    "Guardar los datos"
  );

  if (error) {
    throw error;
  }
  return data;
}
