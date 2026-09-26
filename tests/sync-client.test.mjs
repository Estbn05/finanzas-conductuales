import assert from "node:assert/strict";
import test from "node:test";

function createStorage(initial = {}) {
  const values = new Map(Object.entries(initial));
  return {
    getItem(key) {
      return values.has(key) ? values.get(key) : null;
    },
    removeItem(key) {
      values.delete(key);
    },
    setItem(key, value) {
      values.set(key, String(value));
    }
  };
}

function installCloudMock(cloud, storage) {
  globalThis.localStorage = storage;
  globalThis.window = {
    FINANZAS_SYNC_CONFIG: {
      supabaseUrl: "https://example.supabase.co",
      supabaseAnonKey: "test-key"
    },
    supabase: {
      createClient: () => cloud,
      processLock: async (_name, _timeout, callback) => callback()
    }
  };
}

test("restores a cloud session from the explicit backup when Supabase storage is empty", async () => {
  const backupKey = "finanzas-conductuales:cloud-session:v1";
  const backup = { access_token: "saved-access", refresh_token: "saved-refresh" };
  const restoredSession = { ...backup, user: { id: "user-1", email: "saved@example.com" } };
  const storage = createStorage({ [backupKey]: JSON.stringify(backup) });
  const cloud = {
    auth: {
      getSession: async () => ({ data: { session: null }, error: null }),
      setSession: async (tokens) => ({ data: { session: { ...restoredSession, ...tokens } }, error: null })
    }
  };
  installCloudMock(cloud, storage);

  const syncClient = await import(`../sync-client.js?restore-test=${Date.now()}`);
  const session = await syncClient.getCloudSession();

  assert.equal(session.user.email, "saved@example.com");
  assert.deepEqual(JSON.parse(storage.getItem(backupKey)), restoredSession);
});

test("returns a current saved session immediately while Supabase reconnects", async () => {
  const backupKey = "finanzas-conductuales:cloud-session:v1";
  const backup = {
    access_token: "offline-access",
    expires_at: Math.floor(Date.now() / 1000) + 3600,
    refresh_token: "offline-refresh",
    user: { id: "user-offline", email: "offline@example.com" }
  };
  const storage = createStorage({ [backupKey]: JSON.stringify(backup) });
  let releaseSetSession;
  const cloud = {
    auth: {
      setSession: () => new Promise((resolve) => {
        releaseSetSession = () => resolve({ data: { session: backup }, error: null });
      })
    }
  };
  installCloudMock(cloud, storage);

  const syncClient = await import(`../sync-client.js?offline-test=${Date.now()}`);
  const session = await syncClient.getCloudSession();

  assert.equal(session.user.email, "offline@example.com");
  releaseSetSession();
});

test("returns the stale backup instead of throwing when the session check fails due to network issues", async () => {
  const backupKey = "finanzas-conductuales:cloud-session:v1";
  const backup = {
    access_token: "stale-access",
    expires_at: Math.floor(Date.now() / 1000) - 3600,
    refresh_token: "stale-refresh",
    user: { id: "user-stale", email: "stale@example.com" }
  };
  const storage = createStorage({ [backupKey]: JSON.stringify(backup) });
  const cloud = {
    auth: {
      getSession: async () => {
        throw new TypeError("Failed to fetch");
      }
    }
  };
  installCloudMock(cloud, storage);

  const syncClient = await import(`../sync-client.js?network-fallback-test=${Date.now()}`);
  const session = await syncClient.getCloudSession();

  assert.equal(session.user.email, "stale@example.com");
});

test("does not fall back to the backup when Supabase confirms the session is really invalid", async () => {
  const backupKey = "finanzas-conductuales:cloud-session:v1";
  const backup = {
    access_token: "stale-access",
    expires_at: Math.floor(Date.now() / 1000) - 3600,
    refresh_token: "stale-refresh",
    user: { id: "user-stale", email: "stale@example.com" }
  };
  const storage = createStorage({ [backupKey]: JSON.stringify(backup) });
  const cloud = {
    auth: {
      getSession: async () => ({ data: { session: null }, error: null }),
      setSession: async () => ({
        data: { session: null },
        error: { message: "Invalid Refresh Token: Refresh Token Not Found" }
      })
    }
  };
  installCloudMock(cloud, storage);

  const syncClient = await import(`../sync-client.js?real-signout-test=${Date.now()}`);

  await assert.rejects(
    () => syncClient.getCloudSession(),
    (error) => error.message === "Invalid Refresh Token: Refresh Token Not Found"
  );
});

test("sign in persists the backup and explicit sign out removes it", async () => {
  const backupKey = "finanzas-conductuales:cloud-session:v1";
  const session = {
    access_token: "login-access",
    refresh_token: "login-refresh",
    user: { id: "user-2", email: "login@example.com" }
  };
  const storage = createStorage();
  const cloud = {
    auth: {
      signInWithPassword: async () => ({ data: { session }, error: null }),
      signOut: async () => ({ error: null })
    }
  };
  installCloudMock(cloud, storage);

  const syncClient = await import(`../sync-client.js?signin-test=${Date.now()}`);
  await syncClient.signInToCloud("login@example.com", "password");
  assert.deepEqual(JSON.parse(storage.getItem(backupKey)), {
    access_token: "login-access",
    refresh_token: "login-refresh",
    user: { id: "user-2", email: "login@example.com" }
  });

  await syncClient.signOutFromCloud();
  assert.equal(storage.getItem(backupKey), null);
});

test("stored cloud session can be cleared without a network round trip", async () => {
  const backupKey = "finanzas-conductuales:cloud-session:v1";
  const storage = createStorage({
    [backupKey]: JSON.stringify({
      access_token: "saved",
      refresh_token: "refresh",
      user: { id: "user-3", email: "clear@example.com" }
    })
  });
  installCloudMock({ auth: {} }, storage);

  const syncClient = await import(`../sync-client.js?clear-test=${Date.now()}`);
  syncClient.clearStoredCloudSession();

  assert.equal(storage.getItem(backupKey), null);
});

test("cloud saves use the authenticated Supabase user after restoring a backup session", async () => {
  const backupKey = "finanzas-conductuales:cloud-session:v1";
  const backup = {
    access_token: "saved-access",
    expires_at: Math.floor(Date.now() / 1000) + 3600,
    refresh_token: "saved-refresh",
    user: { id: "stale-user", email: "saved@example.com" }
  };
  const storage = createStorage({ [backupKey]: JSON.stringify(backup) });
  let savedRow;
  const liveSession = {
    ...backup,
    user: { id: "live-user", email: "saved@example.com" }
  };
  const cloud = {
    auth: {
      getUser: async () => ({ data: { user: liveSession.user }, error: null }),
      setSession: async () => ({ data: { session: liveSession }, error: null })
    },
    from(table) {
      assert.equal(table, "finance_app_state");
      return {
        upsert(row, options) {
          savedRow = row;
          assert.deepEqual(options, { onConflict: "user_id" });
          return {
            select(columns) {
              assert.equal(columns, "updated_at");
              return {
                single: async () => ({ data: { updated_at: "2026-06-18T00:00:00.000Z" }, error: null })
              };
            }
          };
        }
      };
    }
  };
  installCloudMock(cloud, storage);

  const syncClient = await import(`../sync-client.js?save-user-test=${Date.now()}`);
  const result = await syncClient.saveCloudState({ profile: { completed: true } });

  assert.equal(savedRow.user_id, "live-user");
  assert.deepEqual(savedRow.app_state, { profile: { completed: true } });
  assert.equal(result.updated_at, "2026-06-18T00:00:00.000Z");
});

// Compare-and-swap: a save that read version X only lands if the row is still X, so two
// devices can never silently overwrite each other.
test("a save against an expected version is conditional, and a lost race is reported", async () => {
  const session = {
    access_token: "a",
    expires_at: Math.floor(Date.now() / 1000) + 3600,
    refresh_token: "r",
    user: { id: "cas-user", email: "cas@example.com" }
  };
  const storage = createStorage({ "finanzas-conductuales:cloud-session:v1": JSON.stringify(session) });
  let rowVersion = "2026-09-20T10:00:00.000Z";
  const filters = [];
  const cloud = {
    auth: {
      getUser: async () => ({ data: { user: session.user }, error: null }),
      setSession: async () => ({ data: { session }, error: null })
    },
    from() {
      return {
        update(row) {
          const query = {
            eq(column, value) {
              filters.push([column, value]);
              return query;
            },
            select() {
              return {
                maybeSingle: async () => {
                  const expected = filters.find(([column]) => column === "updated_at")?.[1];
                  if (expected !== rowVersion) return { data: null, error: null };
                  rowVersion = row.updated_at;
                  return { data: { updated_at: row.updated_at }, error: null };
                }
              };
            }
          };
          return query;
        }
      };
    }
  };
  installCloudMock(cloud, storage);
  const syncClient = await import(`../sync-client.js?cas-test=${Date.now()}`);

  const saved = await syncClient.saveCloudState({ n: 1 }, "2026-09-20T10:00:00.000Z");
  assert.equal(saved.updated_at, rowVersion);
  assert.deepEqual(filters.slice(0, 2), [["user_id", "cas-user"], ["updated_at", "2026-09-20T10:00:00.000Z"]]);

  filters.length = 0;
  await assert.rejects(() => syncClient.saveCloudState({ n: 2 }, "2026-09-20T10:00:00.000Z"), syncClient.CloudConflictError);
});
