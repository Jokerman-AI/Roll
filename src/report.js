// Problem reports. Errors are noted on this device only; nothing is sent anywhere unless the person chooses to
// share, copy or email a report themselves. Reports never include names, room codes or drawings.

export const VERSION = '2026.11';
const KEY = 'rfi-errors';
const KEEP = 10;

const read = () => { try { return JSON.parse(localStorage.getItem(KEY)) || []; } catch { return []; } };
const write = (list) => { try { localStorage.setItem(KEY, JSON.stringify(list)); } catch { /* storage unavailable */ } };

let log = read().filter((e) => e && typeof e.msg === 'string').slice(-KEEP);

/** Noise that is not about Rollick: browser quirks and scripts from elsewhere. */
const ignorable = (msg, file) => /ResizeObserver|Script error|Non-Error promise rejection/i.test(msg)
  || (file && (/^(chrome|moz|safari|webkit)-?(extension|web-extension)?:/i.test(file) || (/^https?:/i.test(file) && !file.startsWith(location.origin) && file !== location.href)));

function note(msg, where, onError) {
  const text = String(msg ?? 'unknown error').slice(0, 200);
  const last = log[log.length - 1];
  if (last && last.msg === text && last.where === where) { last.n = (last.n || 1) + 1; } else { log.push({ t: Date.now(), msg: text, where, n: 1 }); }
  log = log.slice(-KEEP);
  write(log);
  onError?.(text);
}

/** Start noting errors. onError runs when a new one is noted, so the app can say so. */
export function installReporter(onError) {
  window.addEventListener('error', (e) => {
    if (ignorable(e.message, e.filename)) return;
    note(e.message, `${String(e.filename || '').split('/').pop()}:${e.lineno || 0}`, onError);
  });
  window.addEventListener('unhandledrejection', (e) => {
    const msg = e.reason?.message ?? e.reason;
    if (ignorable(String(msg))) return;
    note(msg, 'promise', onError);
  });
}

export const errorLog = () => log.slice();
export function clearErrors() { log = []; write(log); }

/** The report text: what the person wrote, what the app was doing, and the recent errors. */
export function buildReport(note, context = {}) {
  const lines = [
    `Rollick problem report (version ${VERSION})`,
    `Time: ${new Date().toISOString()}`,
    `Device: ${navigator.userAgent}`,
    `Screen: ${innerWidth}x${innerHeight} at ${devicePixelRatio}x, ${navigator.language}`,
    ...Object.entries(context).map(([k, v]) => `${k}: ${v}`),
    '',
    `What happened: ${String(note || '').trim().slice(0, 1000) || '(not written)'}`,
    '',
    `Recent errors (${log.length}):`,
    ...(log.length ? log.map((e) => `- ${new Date(e.t).toISOString()} ${e.msg} [${e.where}]${e.n > 1 ? ` x${e.n}` : ''}`) : ['(none)']),
  ];
  return lines.join('\n');
}
