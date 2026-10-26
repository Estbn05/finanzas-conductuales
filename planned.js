// Planned expenses ("Gastos planeados", state.calendarEvents), including the ones that
// repeat: rent, subscriptions, the gym. A repeating one is a single record whose `date`
// is always the next time it is due; registering or skipping it moves `date` forward and
// keeps a short `history` so either can be undone. Pure: tested in
// tests/planned.test.mjs.

export const REPEATS = ["", "weekly", "monthly"];

export function normalizeRepeat(value) {
  return REPEATS.includes(value) ? value : "";
}

// Date keys are "YYYY-MM-DD"; arithmetic at UTC noon so no timezone moves a day.
function toDate(key) {
  return new Date(`${String(key).slice(0, 10)}T12:00:00Z`);
}

function toKey(date) {
  return date.toISOString().slice(0, 10);
}

function daysInMonth(year, monthIndex) {
  return new Date(Date.UTC(year, monthIndex + 1, 0)).getUTCDate();
}

// The date after `key` for a repeating plan, or "" for a one-off. Monthly plans keep their
// original day (anchorDay): one set for the 31st falls on the 30th in November and on the
// 31st again in December, instead of drifting to the 30th forever.
export function nextOccurrence(key, repeat, anchorDay) {
  const date = toDate(key);
  if (repeat === "weekly") {
    date.setUTCDate(date.getUTCDate() + 7);
    return toKey(date);
  }
  if (repeat === "monthly") {
    const year = date.getUTCFullYear() + (date.getUTCMonth() === 11 ? 1 : 0);
    const month = (date.getUTCMonth() + 1) % 12;
    const day = Math.min(Number(anchorDay) || date.getUTCDate(), daysInMonth(year, month));
    return toKey(new Date(Date.UTC(year, month, day, 12)));
  }
  return "";
}

// Every date a pending plan falls on within [start, end], both included.
export function occurrencesBetween(event, start, end) {
  if (!event || event.spent || !event.date) return [];
  const repeat = normalizeRepeat(event.repeat);
  const dates = [];
  let key = String(event.date).slice(0, 10);
  for (let guard = 0; key && key <= end && guard < 120; guard += 1) {
    if (key >= start) dates.push(key);
    if (!repeat) break;
    key = nextOccurrence(key, repeat, event.anchorDay);
  }
  return dates;
}

// What the plans are expected to cost in [start, end], counting each repetition.
export function plannedTotal(events = [], start, end) {
  return events.reduce((sum, event) => sum + occurrencesBetween(event, start, end).length * Number(event.amount || 0), 0);
}

// Plans whose date has come (today or earlier) and are not done, oldest first: what Inicio
// offers to register.
export function duePlans(events = [], today) {
  return events
    .filter((event) => !event.spent && event.date && String(event.date).slice(0, 10) <= today)
    .sort((a, b) => String(a.date).localeCompare(String(b.date)) || String(a.title).localeCompare(String(b.title)));
}

const HISTORY_LIMIT = 12;

function advance(event, entry, now) {
  return {
    ...event,
    date: nextOccurrence(event.date, normalizeRepeat(event.repeat), event.anchorDay),
    history: [...(event.history || []), entry].slice(-HISTORY_LIMIT),
    updated_at: now
  };
}

// The plan was paid (an expense recorded for it): a repeating one moves to its next date,
// a one-off is done.
export function registerOccurrence(event, transactionId, now = new Date().toISOString()) {
  if (normalizeRepeat(event.repeat)) {
    return advance(event, { date: event.date, transactionId }, now);
  }
  return { ...event, spent: true, skipped: false, transactionId, updated_at: now };
}

// Not this time (the gym month you did not pay): no expense, the plan moves on.
export function skipOccurrence(event, now = new Date().toISOString()) {
  if (normalizeRepeat(event.repeat)) {
    return advance(event, { date: event.date, skipped: true }, now);
  }
  return { ...event, spent: true, skipped: true, transactionId: "", updated_at: now };
}

// Back to how it was before the last register/skip. With a transactionId (its expense was
// deleted), only that occurrence is undone: if it was not the last one, the plan keeps its
// date and just forgets it.
export function undoOccurrence(event, transactionId = "", now = new Date().toISOString()) {
  if (!normalizeRepeat(event.repeat)) {
    return { ...event, spent: false, skipped: false, transactionId: "", updated_at: now };
  }
  const history = [...(event.history || [])];
  const index = transactionId ? history.map((entry) => entry.transactionId).lastIndexOf(transactionId) : history.length - 1;
  if (index < 0) return event;
  const [entry] = history.splice(index, 1);
  const wasLast = index === history.length;
  return { ...event, date: wasLast ? entry.date : event.date, history, updated_at: now };
}
