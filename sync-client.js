const config = window.FINANZAS_SYNC_CONFIG || {};
let client;

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
  const { data, error } = await cloud.auth.getSession();
  if (error) {
    throw error;
  }
  return data.session;
}

export function onCloudAuthChange(callback) {
  const cloud = getCloudClient();
  if (!cloud) {
    return () => {};
  }
  const { data } = cloud.auth.onAuthStateChange((_event, session) => callback(session));
  return () => data.subscription.unsubscribe();
}

export async function signInToCloud(email, password) {
  const cloud = getCloudClient();
  if (!cloud) {
    throw new Error("La libreria de nube no esta disponible.");
  }
  const { data, error } = await cloud.auth.signInWithPassword({ email, password });
  if (error) {
    throw error;
  }
  return data.session;
}

export async function signUpToCloud(email, password) {
  const cloud = getCloudClient();
  if (!cloud) {
    throw new Error("La libreria de nube no esta disponible.");
  }
  const { data, error } = await cloud.auth.signUp({ email, password });
  if (error) {
    throw error;
  }
  return data.session;
}

export async function signOutFromCloud() {
  const cloud = getCloudClient();
  if (!cloud) {
    return;
  }
  const { error } = await cloud.auth.signOut();
  if (error) {
    throw error;
  }
}

export async function loadCloudState() {
  const cloud = getCloudClient();
  const session = await getCloudSession();
  if (!cloud || !session) {
    return null;
  }

  const { data, error } = await cloud
    .from("finance_app_state")
    .select("app_state, updated_at")
    .eq("user_id", session.user.id)
    .maybeSingle();

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
  const { data, error } = await cloud
    .from("finance_app_state")
    .upsert({
      user_id: session.user.id,
      app_state: appState,
      updated_at: updatedAt
    })
    .select("updated_at")
    .single();

  if (error) {
    throw error;
  }
  return data;
}
