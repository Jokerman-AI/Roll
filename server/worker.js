// The purchase server for Rollick's premium looks. It runs on Cloudflare Workers (free plan is plenty) and does two jobs:
//   POST /checkout   start a Stripe Checkout page for a look and return its address
//   GET  /claim      after the payment, swap the paid order for a signed licence the app can check offline
//
// It holds the only secrets (the Stripe key and the licence signing key). The app never sees either.
// Setup steps are in docs/PURCHASES.md.
//
// Settings, set in Cloudflare (never in the app or in git):
//   STRIPE_SECRET_KEY     your Stripe secret key (sk_test_... while testing)
//   PRICES                JSON: { "table:aurora": "price_...", ..., "bundle:all": "price_..." }
//   LICENSE_PRIVATE_JWK   the private signing key from tools/make-license-keys.mjs
//   ALLOWED_ORIGIN        the address of the game, e.g. https://jokerman-ai.github.io

const enc = new TextEncoder();
const b64url = (bytes) => btoa(String.fromCharCode(...new Uint8Array(bytes))).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
const text64 = (str) => b64url(enc.encode(str));

const json = (env, status, body) => new Response(JSON.stringify(body), {
  status,
  headers: { 'content-type': 'application/json', 'access-control-allow-origin': env.ALLOWED_ORIGIN || '', 'access-control-allow-methods': 'GET, POST, OPTIONS', 'access-control-allow-headers': 'content-type', vary: 'origin' },
});

const prices = (env) => { try { return JSON.parse(env.PRICES || '{}'); } catch { return {}; } };

/** Sign a licence: v1.<payload>.<signature>, which the app checks with the matching public key. */
export async function signLicense(env, items, order) {
  const body = text64(JSON.stringify({ v: 1, items, order, iat: Math.floor(Date.now() / 1000) }));
  const key = await crypto.subtle.importKey('jwk', JSON.parse(env.LICENSE_PRIVATE_JWK), { name: 'ECDSA', namedCurve: 'P-256' }, false, ['sign']);
  const sig = await crypto.subtle.sign({ name: 'ECDSA', hash: 'SHA-256' }, key, enc.encode(`v1.${body}`));
  return `v1.${body}.${b64url(sig)}`;
}

const stripe = (env, fetchImpl, path, init = {}) => fetchImpl(`https://api.stripe.com/v1/${path}`, { ...init, headers: { authorization: `Bearer ${env.STRIPE_SECRET_KEY}`, ...(init.headers || {}) } });

async function checkout(request, env, fetchImpl) {
  let data;
  try { data = await request.json(); } catch { return json(env, 400, { error: 'Bad request' }); }
  const table = prices(env);
  const items = Array.isArray(data.items) ? [...new Set(data.items)].slice(0, 3) : [];
  if (!items.length || !items.every((sku) => typeof sku === 'string' && table[sku])) return json(env, 400, { error: 'Unknown item' });
  const origin = env.ALLOWED_ORIGIN || '';
  if (!origin || typeof data.returnUrl !== 'string' || !data.returnUrl.startsWith(origin)) return json(env, 400, { error: 'Bad return address' });
  const form = new URLSearchParams({
    mode: 'payment',
    success_url: `${data.returnUrl}?paid={CHECKOUT_SESSION_ID}`,
    cancel_url: data.returnUrl,
    'metadata[skus]': items.join(','),
  });
  items.forEach((sku, i) => { form.set(`line_items[${i}][price]`, table[sku]); form.set(`line_items[${i}][quantity]`, '1'); });
  const res = await stripe(env, fetchImpl, 'checkout/sessions', { method: 'POST', headers: { 'content-type': 'application/x-www-form-urlencoded' }, body: form });
  const session = await res.json();
  if (!res.ok || !session.url) return json(env, 502, { error: 'The payment page could not be started' });
  return json(env, 200, { url: session.url });
}

async function claim(url, env, fetchImpl) {
  const order = url.searchParams.get('order') || '';
  if (!/^cs_[A-Za-z0-9_]{8,200}$/.test(order)) return json(env, 400, { error: 'Bad order' });
  const res = await stripe(env, fetchImpl, `checkout/sessions/${order}`);
  if (!res.ok) return json(env, 404, { error: 'Order not found' });
  const session = await res.json();
  if (session.payment_status !== 'paid') return json(env, 402, { error: 'That payment has not gone through yet' });
  const table = prices(env);
  let items = String(session.metadata?.skus || '').split(',').filter((sku) => table[sku]);
  if (!items.length) return json(env, 404, { error: 'Nothing to unlock' });
  if (items.includes('bundle:all')) items = ['bundle:all'];
  return json(env, 200, { license: await signLicense(env, items, order) });
}

/** The whole server, with the network call as a parameter so it can be tested without Stripe. */
export async function handle(request, env, fetchImpl = fetch) {
  const url = new URL(request.url);
  if (request.method === 'OPTIONS') return json(env, 204, {});
  try {
    if (request.method === 'POST' && url.pathname === '/checkout') return await checkout(request, env, fetchImpl);
    if (request.method === 'GET' && url.pathname === '/claim') return await claim(url, env, fetchImpl);
    return json(env, 404, { error: 'Not found' });
  } catch {
    return json(env, 500, { error: 'Something went wrong' });
  }
}

export default { fetch: (request, env) => handle(request, env) };
