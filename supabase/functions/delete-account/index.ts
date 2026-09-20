// Supabase Edge Function: delete-account
//
// Borra DE VERDAD la cuenta del usuario que la invoca: su usuario de autenticación
// (correo + contraseña) y, por el `on delete cascade` de finance_app_state, también
// todos sus datos. El cliente NO puede hacer esto por sí mismo porque requiere la
// clave service_role (admin), que jamás debe vivir dentro de la app: si estuviera
// ahí, cualquiera podría borrar la cuenta de cualquier otro. Por eso corre aquí, en
// el servidor, y solo puede borrar al usuario dueño del token con el que se llama.
//
// Despliegue: Supabase inyecta automáticamente SUPABASE_URL y
// SUPABASE_SERVICE_ROLE_KEY en el entorno de las Edge Functions, así que en la mayoría
// de los casos basta con desplegar la función — sin configurar secretos. Se deja
// SERVICE_ROLE_KEY como respaldo por si prefieres inyectarla tú manualmente.
//
// Se despliega con verify_jwt activado (por defecto): Supabase valida el JWT del
// usuario antes de ejecutar, así que un token inválido nunca llega hasta aquí.

import { createClient } from "https://esm.sh/@supabase/supabase-js@2.108.1";

const CORS_HEADERS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS"
};

function jsonResponse(body: unknown, status: number) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...CORS_HEADERS, "Content-Type": "application/json" }
  });
}

Deno.serve(async (request) => {
  if (request.method === "OPTIONS") {
    return new Response("ok", { headers: CORS_HEADERS });
  }

  if (request.method !== "POST") {
    return jsonResponse({ error: "Method not allowed" }, 405);
  }

  const supabaseUrl = Deno.env.get("SUPABASE_URL");
  const serviceRoleKey =
    Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") || Deno.env.get("SERVICE_ROLE_KEY");
  if (!supabaseUrl || !serviceRoleKey) {
    return jsonResponse({ error: "Función mal configurada: falta la clave service_role." }, 500);
  }

  const authHeader = request.headers.get("Authorization") || "";
  const token = authHeader.replace(/^Bearer\s+/i, "").trim();
  if (!token) {
    return jsonResponse({ error: "Falta el token de sesión." }, 401);
  }

  const admin = createClient(supabaseUrl, serviceRoleKey, {
    auth: { autoRefreshToken: false, persistSession: false }
  });

  // Resolver el usuario a partir de SU PROPIO token. Nunca confiamos en un id que
  // venga en el cuerpo del request: solo se puede borrar a quien presenta el token.
  const { data: userData, error: userError } = await admin.auth.getUser(token);
  if (userError || !userData?.user?.id) {
    return jsonResponse({ error: "Sesión inválida o expirada." }, 401);
  }

  const userId = userData.user.id;

  // Borrado explícito de los datos por si la tabla no tuviera el on delete cascade;
  // es idempotente y barato. El borrado del usuario de auth es el paso crítico.
  await admin.from("finance_app_state").delete().eq("user_id", userId);

  const { error: deleteError } = await admin.auth.admin.deleteUser(userId);
  if (deleteError) {
    return jsonResponse({ error: `No se pudo eliminar la cuenta: ${deleteError.message}` }, 500);
  }

  return jsonResponse({ ok: true }, 200);
});
