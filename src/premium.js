// Premium looks: skins and effects that are paid for with real money.
//
// Paying happens on a hosted checkout page run by a payment provider (see docs/PURCHASES.md), never in the app, so
// card details never touch this code. After a payment, a small server hands back a signed licence. The app checks the
// signature with a public key, so a made-up licence is rejected, and keeps the licence on the device.
// Nothing here works until a store is set up in config.js (window.RFI_STORE); until then premium looks show "Coming soon".

/** The premium looks and the price shown for each. The price that is actually charged is set at the payment provider. */
export const PREMIUM = {
  table: { aurora: '$1.99', starfield: '$1.99', lava: '$1.49' },
  back: { holo: '$0.99', circuit: '$0.99', ember: '$0.99' },
  dice: { fire: '$1.99', ice: '$1.99', prism: '$1.99', neonglow: '$1.49' },
  fx: { fireworks: '$1.49', goldrain: '$1.49' },
};
export const skuOf = (part, id) => `${part}:${id}`;
export const isPremium = (part, id) => !!PREMIUM[part]?.[id];
export const ALL_SKUS = Object.entries(PREMIUM).flatMap(([part, ids]) => Object.keys(ids).map((id) => skuOf(part, id)));
/** Buying everything at once. */
export const BUNDLE = { sku: 'bundle:all', name: 'Everything pack', price: '$9.99' };

const KEY = 'rfi-licenses';
const store = () => (typeof window !== 'undefined' && window.RFI_STORE && typeof window.RFI_STORE === 'object' ? window.RFI_STORE : {});
const read = () => { try { const v = JSON.parse(localStorage.getItem(KEY)); return Array.isArray(v) ? v.filter((t) => typeof t === 'string').slice(-20) : []; } catch { return []; } };
const write = (list) => { try { localStorage.setItem(KEY, JSON.stringify(list)); } catch { /* storage unavailable */ } };

/** What the store is set up to do. 'demo' unlocks things for free, for trying the screens out only. */
export const storeMode = () => {
  const s = store();
  if (s.mode === 'demo') return 'demo';
  return typeof s.api === 'string' && s.api.startsWith('https://') && s.publicKey ? 'live' : 'off';
};
export const priceLabel = (part, id) => store().prices?.[skuOf(part, id)] || PREMIUM[part]?.[id] || '';
export const bundleLabel = () => store().prices?.[BUNDLE.sku] || BUNDLE.price;

/* ---- licences ---- */

const licensed = new Set(); // what the verified licences on this device cover
const verified = []; // the licences that passed the check this visit, so only good codes are offered for copying
const b64 = (text) => Uint8Array.from(atob(text.replace(/-/g, '+').replace(/_/g, '/')), (c) => c.charCodeAt(0));

/** The payload of a licence if its signature is good, otherwise null. A licence looks like v1.<payload>.<signature>. */
export async function verifyLicense(token, publicKey) {
  try {
    const [v, body, sig] = String(token).split('.');
    if (v !== 'v1' || !body || !sig || !publicKey) return null;
    const key = await crypto.subtle.importKey('jwk', publicKey, { name: 'ECDSA', namedCurve: 'P-256' }, false, ['verify']);
    const ok = await crypto.subtle.verify({ name: 'ECDSA', hash: 'SHA-256' }, key, b64(sig), new TextEncoder().encode(`${v}.${body}`));
    if (!ok) return null;
    const payload = JSON.parse(new TextDecoder().decode(b64(body)));
    return payload && Array.isArray(payload.items) ? payload : null;
  } catch { return null; }
}

const addItems = (items) => { for (const sku of items) if (typeof sku === 'string') licensed.add(sku); };

/** Check the licences kept on this device, in the background at start-up. Returns how many looks they cover. */
export async function loadLicenses() {
  const mode = storeMode();
  if (mode === 'demo') { read().filter((t) => t.startsWith('demo:')).forEach((t) => licensed.add(t.slice(5))); return licensed.size; }
  if (mode !== 'live') return 0;
  for (const token of read()) {
    const payload = await verifyLicense(token, store().publicKey);
    if (payload) { addItems(payload.items); if (!verified.includes(token)) verified.push(token); }
  }
  return licensed.size;
}

/** Is this premium look paid for on this device? */
export const hasBundle = () => licensed.has('bundle:all');
export const isLicensed = (part, id) => licensed.has(skuOf(part, id)) || hasBundle();

/** Add a licence (from a payment or pasted in to restore). Returns { ok, count } or { ok: false, why }. */
export async function redeem(token) {
  const text = String(token || '').trim();
  const payload = await verifyLicense(text, store().publicKey);
  if (!payload) return { ok: false, why: 'That code is not valid' };
  const kept = read();
  if (!kept.includes(text)) write([...kept, text]);
  addItems(payload.items);
  if (!verified.includes(text)) verified.push(text);
  return { ok: true, count: payload.items.length };
}

/** The licences on this device, so they can be copied to another one. */
export const savedLicenses = () => verified.slice();

/* ---- buying ---- */

/** Go to the checkout page for a look (or the bundle). In demo mode it is simply switched on. */
export async function startCheckout(sku) {
  const mode = storeMode();
  if (mode === 'demo') { licensed.add(sku); write([...read(), `demo:${sku}`]); return { ok: true, demo: true }; }
  if (mode !== 'live') return { ok: false, why: 'The store is not open yet' };
  try {
    const res = await fetch(`${store().api}/checkout`, {
      method: 'POST', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ items: [sku], returnUrl: `${location.origin}${location.pathname}` }),
    });
    const data = await res.json();
    if (!res.ok || typeof data.url !== 'string' || !data.url.startsWith('https://')) return { ok: false, why: data.error || 'Could not start the checkout' };
    location.href = data.url;
    return { ok: true, redirected: true };
  } catch { return { ok: false, why: 'Could not reach the store. Check your connection.' }; }
}

/** Coming back from the checkout page: swap the order for a licence. Returns the same shape as redeem. */
export async function claimOrder(orderId) {
  if (storeMode() !== 'live' || !/^[A-Za-z0-9_]{8,200}$/.test(orderId)) return { ok: false, why: 'Nothing to claim' };
  try {
    const res = await fetch(`${store().api}/claim?order=${encodeURIComponent(orderId)}`);
    const data = await res.json();
    if (!res.ok || typeof data.license !== 'string') return { ok: false, why: data.error || 'That payment has not gone through yet' };
    return redeem(data.license);
  } catch { return { ok: false, why: 'Could not reach the store. Check your connection.' }; }
}
