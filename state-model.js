import { FREE_CATEGORY_ID, JOB_CADENCES } from "./finance-core.js?v=1.1.18";

// Huella de la plantilla "estudiante" que versiones viejas metian en el plan de todo
// usuario nuevo. Ya no se crea nunca: esto sobrevive SOLO como patron de deteccion
// para limpiarla de instalaciones antiguas que todavia la arrastren (ver migrateState
// y clearTemplateBudget). No usar ninguno de estos valores como default de nada.
export const LEGACY_TEMPLATE_BUDGET_JOBS = [
  { id: "gas", name: "Gasolina moto", amount: 30_000, cadence: "weekly" },
  { id: "dates", name: "Salidas con novia", amount: 45_000, cadence: "monthly" },
  { id: "gifts", name: "Regalos para novia", amount: 20_000, cadence: "monthly" },
  { id: "university", name: "Universidad y comida", amount: 25_000, cadence: "monthly" },
  { id: "flex", name: "Imprevistos", amount: 9_000, cadence: "monthly" }
];

export const JOB_CADENCE_VALUES = Object.keys(JOB_CADENCES);

export const DEFAULT_REMINDER_TIME = "20:00";

export const DIAGNOSIS_SECTIONS = {
  plan: {
    icon: "plan",
    title: "Plan básico",
    subtitle: "Ingreso y frecuencia del periodo",
    fields: ["name", "incomeCadence", "incomeType", "incomeAmount", "periodStart", "volatility", "committedExpenses", "payday"]
  },
  balances: {
    icon: "wallet",
    title: "Saldos",
    subtitle: "Dinero disponible hoy",
    fields: ["account", "cash", "emergencySavings"]
  }
};

export function cleanText(value, fallback) {
  const text = String(value || "").trim().replace(/\s+/g, " ");
  return text || fallback;
}

export function cleanDate(value, fallback) {
  return /^\d{4}-\d{2}-\d{2}$/.test(String(value || "")) ? String(value) : fallback;
}

function parseNumberText(value) {
  const text = String(value ?? "").trim();
  if (!text) {
    return Number.NaN;
  }
  const clean = text.replace(/\s/g, "").replace(/[^\d,.-]/g, "");
  if (!clean || clean === "-" || clean === "." || clean === ",") {
    return Number.NaN;
  }
  if (/^-?\d{1,3}(\.\d{3})+(,\d+)?$/.test(clean)) {
    return Number(clean.replace(/\./g, "").replace(",", "."));
  }
  if (/^-?\d{1,3}(,\d{3})+(\.\d+)?$/.test(clean)) {
    return Number(clean.replace(/,/g, ""));
  }
  return Number(clean.replace(",", "."));
}

export function numberFrom(value) {
  const number = parseNumberText(value);
  return Math.max(0, Number.isFinite(number) ? number : 0);
}

export function numberValue(value) {
  const text = String(value ?? "").trim();
  if (!text) {
    return null;
  }
  const number = parseNumberText(text);
  return Number.isFinite(number) ? number : null;
}

export function clamp(value, min, max) {
  return Math.min(max, Math.max(min, Number(value) || 0));
}

export function uid(prefix) {
  return `${prefix}-${Math.random().toString(36).slice(2, 9)}`;
}

export function merchantKey(value) {
  return cleanText(value, "")
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-z0-9]+/g, " ")
    .trim()
    .replace(/\s+/g, " ");
}

export function normalizeLocation(value) {
  return value === "cash" ? "cash" : "account";
}

export function normalizeEventCategory(value) {
  const category = String(value || "");
  return category || FREE_CATEGORY_ID;
}

export function normalizeReminderTime(value) {
  const text = String(value || "").trim();
  return /^([01]\d|2[0-3]):[0-5]\d$/.test(text) ? text : DEFAULT_REMINDER_TIME;
}

export function normalizePayday(value) {
  const day = Number(value);
  if (!Number.isFinite(day) || day <= 0) {
    return 0;
  }
  return clamp(day, 1, 28);
}

export function normalizePredictionStatus(status) {
  return ["empty", "learning", "healthy", "tight", "risk", "over_reserved"].includes(status) ? status : "healthy";
}

// Antes esta funcion tenia un mapa de montos por defecto indexado por los ids de la
// plantilla "estudiante" (gas, dates, gifts, university, flex). Corria sobre TODAS las
// categorias en cada migracion, y como uniqueCategoryId() convierte el nombre en slug,
// una categoria que el usuario llamara "Gas" recibia el id `gas` y podia heredar
// $30.000 semanales que nunca escribio.
export function normalizeBudgetJobs(jobs) {
  return jobs.map((job) => ({
    ...job,
    amount: Number(job.amount ?? job.budget ?? 0),
    cadence: JOB_CADENCE_VALUES.includes(job.cadence) ? job.cadence : "monthly",
    updated_at: job.updated_at || ""
  }));
}

export function normalizeTransactions(transactions, today) {
  return transactions.map((transaction) => ({
    ...transaction,
    id: transaction.id || uid("tx"),
    date: cleanDate(transaction.date, today),
    merchant: cleanText(transaction.merchant, "Compra"),
    description: cleanText(transaction.description, ""),
    amount: Number(transaction.amount || 0),
    category: transaction.category || "",
    labeled: Boolean(transaction.category || transaction.labeled),
    budgeted: Boolean(transaction.budgeted),
    oneOff: Boolean(transaction.oneOff || transaction.excludeFromPrediction),
    source: normalizeLocation(transaction.source),
    calendarEventId: transaction.calendarEventId || "",
    updated_at: transaction.updated_at || transaction.createdAt || transaction.date || ""
  }));
}

export function normalizePeriodClosures(closures) {
  return closures
    .map((closure) => ({
      id: closure.id || `${closure.windowStart || closure.start}:${closure.windowEnd || closure.end}`,
      windowStart: cleanDate(closure.windowStart || closure.start, ""),
      windowEnd: cleanDate(closure.windowEnd || closure.end, ""),
      closedAt: closure.closedAt || closure.updated_at || "",
      income: Number(closure.income || 0),
      reserved: Number(closure.reserved || 0),
      spent: Number(closure.spent || 0),
      freeRemaining: Number(closure.freeFinal ?? closure.freeRemaining ?? 0),
      freeFinal: Number(closure.freeFinal ?? closure.freeRemaining ?? 0),
      projectedEndFree: Number(closure.projectedEndFree || 0),
      dailyRate: Number(closure.dailyRate || 0),
      confidence: ["empty", "learning", "normal"].includes(closure.confidence) ? closure.confidence : "normal",
      categoryOverspent: Number(closure.categoryOverspent || 0),
      exceededCategories: Array.isArray(closure.exceededCategories)
        ? closure.exceededCategories
            .map((category) => ({
              id: category.id || "",
              name: cleanText(category.name, "Categoría"),
              budget: Number(category.budget || 0),
              spent: Number(category.spent || 0),
              over: Number(category.over || 0)
            }))
            .filter((category) => category.name && category.over > 0)
        : [],
      idealPeriodSavings: Number(closure.idealPeriodSavings || 0),
      possiblePeriodSavings: Number(closure.possiblePeriodSavings || 0),
      suggestedPeriodSavings: Number(closure.suggestedPeriodSavings || 0),
      savingsCapacityGap: Number(closure.savingsCapacityGap || 0),
      adjustments: Array.isArray(closure.adjustments)
        ? closure.adjustments.map((item) => cleanText(item, "")).filter(Boolean).slice(0, 5)
        : [],
      transactionCount: Number(closure.transactionCount || 0),
      incomeCount: Number(closure.incomeCount || 0),
      status: normalizePredictionStatus(closure.status)
    }))
    .filter((closure) => closure.windowStart && closure.windowEnd)
    .slice(0, 12);
}

export function buildMerchantRulesFromTransactions(transactions = []) {
  const rules = new Map();
  transactions.forEach((transaction) => {
    const key = merchantKey(transaction.merchant);
    const category = transaction.category || "";
    if (key.length < 3 || !category || category === FREE_CATEGORY_ID) {
      return;
    }
    const existing = rules.get(key);
    const updatedAt = transaction.updated_at || transaction.createdAt || transaction.date || "";
    if (!existing) {
      rules.set(key, {
        id: uid("rule"),
        merchant: cleanText(transaction.merchant, "Comercio"),
        key,
        category,
        source: normalizeLocation(transaction.source),
        count: 1,
        lastUsedAt: updatedAt,
        updated_at: updatedAt
      });
      return;
    }
    existing.count += 1;
    if (String(updatedAt).localeCompare(String(existing.lastUsedAt || "")) >= 0) {
      existing.category = category;
      existing.source = normalizeLocation(transaction.source);
      existing.lastUsedAt = updatedAt;
      existing.updated_at = updatedAt;
    }
  });
  return [...rules.values()];
}

export function normalizeMerchantRules(rules, transactions = []) {
  const normalized = rules
    .map((rule) => {
      const merchant = cleanText(rule.merchant || rule.name, "");
      const key = merchantKey(rule.key || merchant);
      return {
        id: rule.id || uid("rule"),
        merchant,
        key,
        category: rule.category || "",
        source: normalizeLocation(rule.source),
        count: Number(rule.count || 1),
        lastUsedAt: rule.lastUsedAt || rule.updated_at || "",
        updated_at: rule.updated_at || rule.lastUsedAt || ""
      };
    })
    .filter((rule) => rule.key.length >= 3 && rule.category);

  const byKey = new Map(normalized.map((rule) => [rule.key, rule]));
  buildMerchantRulesFromTransactions(transactions).forEach((rule) => {
    if (!byKey.has(rule.key)) {
      byKey.set(rule.key, rule);
    }
  });

  return [...byKey.values()]
    .sort((a, b) => String(b.lastUsedAt || b.updated_at || "").localeCompare(String(a.lastUsedAt || a.updated_at || "")) || Number(b.count || 0) - Number(a.count || 0))
    .slice(0, 30);
}

export function filterMerchantRulesForJobs(rules, jobs) {
  const validCategories = new Set((jobs || []).map((job) => job.id));
  return (rules || []).filter((rule) => validCategories.has(rule.category));
}

export function normalizeCalendarEvents(events, today) {
  return events.map((event) => ({
    id: event.id || uid("event"),
    title: cleanText(event.title || event.name, "Plan especial"),
    date: cleanDate(event.date, today),
    amount: Number(event.amount || event.estimatedAmount || 0),
    category: normalizeEventCategory(event.category),
    notes: cleanText(event.notes || event.description, ""),
    spent: Boolean(event.spent),
    transactionId: event.transactionId || "",
    updated_at: event.updated_at || event.date || ""
  }));
}

export function normalizeDailyReminder(reminder = {}) {
  return {
    enabled: Boolean(reminder.enabled),
    time: normalizeReminderTime(reminder.time),
    lastShownDate: cleanDate(reminder.lastShownDate, ""),
    updated_at: reminder.updated_at || ""
  };
}

export function isTemplateBudgetJobs(jobs) {
  return Boolean(jobs?.length) && jobs.every((job) => {
    const template = LEGACY_TEMPLATE_BUDGET_JOBS.find((item) => item.id === job.id);
    if (!template) {
      return false;
    }
    const amount = Number(job.amount ?? job.budget ?? 0);
    const cadence = job.cadence || template.cadence;
    return cleanText(job.name, "") === template.name && amount === template.amount && cadence === template.cadence;
  });
}

// `target` is required (not defaulted to a module-level state) so this stays a pure
// mutator: callers decide what it mutates, whether that's a state object mid-migration
// or the live app state.
export function clearTemplateBudget(target) {
  const templateIds = new Set(LEGACY_TEMPLATE_BUDGET_JOBS.map((job) => job.id));
  target.budgetJobs = [];
  target.cooldowns = (target.cooldowns || []).filter((cooldown) => !templateIds.has(cooldown.category));
  target.merchantRules = (target.merchantRules || []).filter((rule) => !templateIds.has(rule.category));
  (target.transactions || []).forEach((transaction) => {
    if (templateIds.has(transaction.category)) {
      transaction.category = "";
      transaction.labeled = false;
    }
  });
  target.meta = { ...(target.meta || {}), budgetPreset: "" };
}

export function normalizeBudgetExtras(extras, today) {
  return extras.map((extra) => ({
    id: extra.id || uid("extra"),
    source: cleanText(extra.source || extra.name, "Dinero extra"),
    amount: Number(extra.amount || 0),
    date: cleanDate(extra.date, today),
    location: normalizeLocation(extra.location),
    allocation: extra.allocation || null,
    updated_at: extra.updated_at || extra.date || ""
  }));
}

export function normalizeLiquidity(liquidity) {
  return {
    account: numberFrom(liquidity?.account),
    cash: numberFrom(liquidity?.cash),
    initialized: Boolean(liquidity?.initialized),
    updated_at: liquidity?.updated_at || ""
  };
}

export function createDefaultState(today, defaultView) {
  const now = new Date().toISOString();
  const monthStart = `${String(today).slice(0, 7)}-01`;

  return {
    activeView: defaultView,
    showDiagnosis: false,
    diagnosisSection: "plan",
    lastAlert: "Registra cada gasto en menos de un minuto. Usa Editar mi plan para ajustar tus números reales.",
    updated_at: now,
    meta: {
      updatedAt: now,
      updated_at: now,
      cloudUpdatedAt: "",
      cloudUserEmail: "",
      budgetPreset: ""
    },
    profile: {
      completed: false,
      name: "Tu plan",
      currency: "COP",
      // Un perfil nuevo no sabe nada del usuario todavia. Cadencia y tipo de ingreso
      // van vacios a proposito: el onboarding no debe preseleccionar una respuesta por
      // el, y su validacion exige elegir. Antes este bloque describia a una persona
      // concreta (un estudiante con ingreso semestral de $1.750.000) y esos numeros
      // aparecian ya escritos en el formulario del primer usuario que abriera la app.
      incomeAmount: 0,
      monthlyIncome: 0,
      semesterIncome: 0,
      periodStart: monthStart,
      semesterStart: monthStart,
      incomeCadence: "",
      incomeType: "",
      volatility: "medium",
      committedExpenses: 0,
      emergencySavings: 0,
      payday: 0,
      updated_at: now
    },
    settings: {
      monthlyRaisePct: 8,
      escalationPct: 50,
      // Empty means "follow the system". Forcing "light" here made the app fight the
      // prefers-color-scheme rules on a phone set to dark mode.
      theme: "",
      updated_at: now
    },
    budgetExtras: [],
    calendarEvents: [],
    dailyReminder: {
      enabled: false,
      time: DEFAULT_REMINDER_TIME,
      lastShownDate: "",
      updated_at: now
    },
    liquidity: {
      account: 0,
      cash: 0,
      initialized: false,
      updated_at: now
    },
    periodIncomeStatus: null,
    periodIncomeApplied: [],
    budgetJobs: [],
    transactions: [],
    cooldowns: [],
    periodClosures: [],
    merchantRules: [],
    checkins: [],
    wins: []
  };
}

export function migrateState(savedState, today, defaultView) {
  const defaults = createDefaultState(today, defaultView);
  const migrated = {
    ...defaults,
    activeView: savedState.activeView || defaults.activeView,
    showDiagnosis: Boolean(savedState.showDiagnosis),
    diagnosisSection: DIAGNOSIS_SECTIONS[savedState.diagnosisSection] ? savedState.diagnosisSection : defaults.diagnosisSection,
    lastAlert: savedState.lastAlert || defaults.lastAlert,
    updated_at: savedState.updated_at || defaults.updated_at,
    meta: { ...defaults.meta, ...(savedState.meta || {}) },
    profile: { ...defaults.profile, ...(savedState.profile || {}) },
    settings: {
      monthlyRaisePct: Number(savedState.settings?.monthlyRaisePct ?? defaults.settings.monthlyRaisePct),
      escalationPct: Number(savedState.settings?.escalationPct ?? defaults.settings.escalationPct),
      theme:
        savedState.settings?.theme === "dark" || savedState.settings?.theme === "light"
          ? savedState.settings.theme
          : defaults.settings.theme,
      updated_at: savedState.settings?.updated_at || defaults.settings.updated_at
    },
    transactions: normalizeTransactions(savedState.transactions || defaults.transactions, today),
    budgetExtras: normalizeBudgetExtras(savedState.budgetExtras || defaults.budgetExtras, today),
    calendarEvents: normalizeCalendarEvents(savedState.calendarEvents || defaults.calendarEvents, today),
    dailyReminder: normalizeDailyReminder(savedState.dailyReminder || defaults.dailyReminder),
    liquidity: normalizeLiquidity(savedState.liquidity || defaults.liquidity),
    periodIncomeStatus: savedState.periodIncomeStatus || null,
    periodIncomeApplied: Array.isArray(savedState.periodIncomeApplied) ? savedState.periodIncomeApplied : [],
    cooldowns: savedState.cooldowns || defaults.cooldowns,
    periodClosures: normalizePeriodClosures(savedState.periodClosures || defaults.periodClosures),
    merchantRules: normalizeMerchantRules(savedState.merchantRules || defaults.merchantRules, savedState.transactions || defaults.transactions),
    checkins: savedState.checkins || defaults.checkins,
    wins: savedState.wins || defaults.wins
  };
  migrated.profile.incomeAmount = migrated.profile.incomeAmount ?? migrated.profile.semesterIncome ?? migrated.profile.monthlyIncome ?? defaults.profile.incomeAmount;
  migrated.profile.periodStart = migrated.profile.periodStart || migrated.profile.semesterStart || defaults.profile.periodStart;
  migrated.profile.semesterStart = migrated.profile.semesterStart || migrated.profile.periodStart;
  migrated.profile.payday = normalizePayday(migrated.profile.payday ?? defaults.profile.payday);
  migrated.budgetJobs = normalizeBudgetJobs(savedState.budgetJobs || defaults.budgetJobs);
  migrated.merchantRules = filterMerchantRulesForJobs(migrated.merchantRules, migrated.budgetJobs);
  if (migrated.profile.completed && migrated.meta.budgetPreset !== "student" && isTemplateBudgetJobs(migrated.budgetJobs)) {
    clearTemplateBudget(migrated);
    migrated.lastAlert = "Quité las categorías de ejemplo que traía una versión vieja. Crea solo las que de verdad usas.";
  }
  return migrated;
}

// True when a state payload holds anything the user would lose if it were overwritten.
export function hasMeaningfulLocalData(payload) {
  return Boolean(
    payload?.profile?.completed ||
      payload?.liquidity?.initialized ||
      payload?.transactions?.length ||
      payload?.budgetExtras?.length ||
      payload?.calendarEvents?.length ||
      payload?.dailyReminder?.enabled ||
      payload?.budgetJobs?.length ||
      payload?.wins?.length
  );
}

function timestampValue(value) {
  const time = Date.parse(value || "");
  return Number.isFinite(time) ? time : 0;
}

// ¿El registro remoto cambió en el SERVIDOR desde la última vez que sincronizamos?
// Compara la marca `updated_at` del servidor contra la última marca del servidor que
// guardamos (localState.meta.cloudUpdatedAt). Ambas vienen del reloj del servidor, así
// que no las afecta el desfase con el reloj del teléfono. Antes se comparaba la marca
// del dispositivo contra la del servidor, y como el servidor suele ir unos segundos
// adelante, un cambio local recién hecho parecía "más viejo" y un pull lo borraba.
export function remoteChangedSinceLastSync(localState, remote) {
  return timestampValue(remote?.updated_at) > timestampValue(localState?.meta?.cloudUpdatedAt);
}

// What to do right after sign-in / app start, given the local state and the cloud row
// (`remote` is null when this account has no row yet). Returns one of:
//   "first-upload"        no cloud row: create it from local
//   "upload-remote-empty" cloud row has nothing worth keeping: local wins
//   "download"            cloud changed since our last sync, or we have nothing local
//   "upload"              cloud unchanged since our last sync: local edits win
//   "in-sync"             neither side has meaningful data
// Local data is only ever overwritten on "download".
export function decideLoginSync(localState, remote) {
  if (!remote?.app_state) {
    return "first-upload";
  }
  const localHasData = hasMeaningfulLocalData(localState);
  const remoteHasData = hasMeaningfulLocalData(remote.app_state);
  if (localHasData && !remoteHasData) {
    return "upload-remote-empty";
  }
  if (remoteHasData && (remoteChangedSinceLastSync(localState, remote) || !localHasData)) {
    return "download";
  }
  return localHasData ? "upload" : "in-sync";
}

// What to do when pushing a local edit. Only yields to the cloud if it really changed on
// the server since our last sync (another device); otherwise the local edit wins.
export function decidePushSync(localState, remote) {
  return remote?.app_state &&
    hasMeaningfulLocalData(remote.app_state) &&
    remoteChangedSinceLastSync(localState, remote)
    ? "download"
    : "upload";
}
