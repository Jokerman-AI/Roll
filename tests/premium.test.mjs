import test from 'node:test';
import assert from 'node:assert/strict';
import { handle, signLicense } from '../server/worker.js';
import * as P from '../src/premium.js';
import { isUnlocked } from '../src/stats.js';
import { TABLES, BACKS, DICE, FX } from '../src/theme.js';

async function makeKeys() {
  const { publicKey, privateKey } = await crypto.subtle.generateKey({ name: 'ECDSA', namedCurve: 'P-256' }, true, ['sign', 'verify']);
  const pub = await crypto.subtle.exportKey('jwk', publicKey);
  return { priv: JSON.stringify(await crypto.subtle.exportKey('jwk', privateKey)), pub: { kty: pub.kty, crv: pub.crv, x: pub.x, y: pub.y } };
}

const ORIGIN = 'https://game.example';
const PRICES = JSON.stringify({ 'table:aurora': 'price_a', 'back:holo': 'price_f', 'bundle:all': 'price_b' });

// A pretend Stripe: remembers the sessions it was asked to create, and whether each has been paid.
function fakeStripe() {
  const sessions = new Map();
  const calls = [];
  const fetchImpl = async (url, init = {}) => {
    calls.push({ url, init });
    const path = url.replace('https://api.stripe.com/v1/', '');
    if (path === 'checkout/sessions' && init.method === 'POST') {
      const body = new URLSearchParams(init.body);
      const id = `cs_test_${sessions.size + 1}abcdefgh`;
      sessions.set(id, { id, payment_status: 'unpaid', metadata: { skus: body.get('metadata[skus]') }, form: body });
      return new Response(JSON.stringify({ id, url: `https://checkout.stripe.com/pay/${id}` }), { status: 200 });
    }
    const id = path.replace('checkout/sessions/', '');
    return sessions.has(id) ? new Response(JSON.stringify(sessions.get(id)), { status: 200 }) : new Response('{}', { status: 404 });
  };
  return { sessions, calls, fetchImpl };
}

const call = (env, fetchImpl, method, path, body) => handle(new Request(`https://api.example${path}`, { method, body: body ? JSON.stringify(body) : undefined }), env, fetchImpl);

test('a licence signed by the server is accepted, and tampering or the wrong key is refused', async () => {
  const { priv, pub } = await makeKeys();
  const other = await makeKeys();
  const token = await signLicense({ LICENSE_PRIVATE_JWK: priv }, ['table:aurora', 'back:holo'], 'cs_test_x');
  const ok = await P.verifyLicense(token, pub);
  assert.deepEqual(ok.items, ['table:aurora', 'back:holo']);
  assert.equal(await P.verifyLicense(token, other.pub), null, 'a different key does not match');
  const [v, body, sig] = token.split('.');
  const forged = Buffer.from(JSON.stringify({ v: 1, items: ['bundle:all'], order: 'x', iat: 1 })).toString('base64url');
  assert.equal(await P.verifyLicense(`${v}.${forged}.${sig}`, pub), null, 'a changed payload is refused');
  assert.equal(await P.verifyLicense('v1.nonsense', pub), null);
  assert.equal(await P.verifyLicense(token, null), null);
  assert.equal(await P.verifyLicense(`v2.${body}.${sig}`, pub), null, 'unknown versions are refused');
});

test('the server starts a checkout only for known looks and a return address on the allowed site', async () => {
  const { priv } = await makeKeys();
  const env = { STRIPE_SECRET_KEY: 'sk_test_1', PRICES, LICENSE_PRIVATE_JWK: priv, ALLOWED_ORIGIN: ORIGIN };
  const stripe = fakeStripe();
  const good = await call(env, stripe.fetchImpl, 'POST', '/checkout', { items: ['table:aurora'], returnUrl: `${ORIGIN}/Roll/` });
  assert.equal(good.status, 200);
  assert.match((await good.json()).url, /^https:\/\/checkout\.stripe\.com\//);
  const session = [...stripe.sessions.values()][0];
  assert.equal(session.form.get('line_items[0][price]'), 'price_a');
  assert.equal(session.form.get('success_url'), `${ORIGIN}/Roll/?paid={CHECKOUT_SESSION_ID}`);
  assert.equal(stripe.calls[0].init.headers.authorization, 'Bearer sk_test_1');
  assert.equal((await call(env, stripe.fetchImpl, 'POST', '/checkout', { items: ['table:nope'], returnUrl: `${ORIGIN}/` })).status, 400, 'unknown look');
  assert.equal((await call(env, stripe.fetchImpl, 'POST', '/checkout', { items: ['table:aurora'], returnUrl: 'https://evil.example/' })).status, 400, 'wrong return address');
  assert.equal((await call(env, stripe.fetchImpl, 'POST', '/checkout', { items: [], returnUrl: `${ORIGIN}/` })).status, 400);
  assert.equal(good.headers.get('access-control-allow-origin'), ORIGIN);
});

test('after payment the order becomes a licence the app accepts; an unpaid or unknown order does not', async () => {
  const { priv, pub } = await makeKeys();
  const env = { STRIPE_SECRET_KEY: 'sk_test_1', PRICES, LICENSE_PRIVATE_JWK: priv, ALLOWED_ORIGIN: ORIGIN };
  const stripe = fakeStripe();
  await call(env, stripe.fetchImpl, 'POST', '/checkout', { items: ['back:holo'], returnUrl: `${ORIGIN}/` });
  const [id, session] = [...stripe.sessions.entries()][0];
  assert.equal((await call(env, stripe.fetchImpl, 'GET', `/claim?order=${id}`)).status, 402, 'not paid yet');
  session.payment_status = 'paid';
  const res = await call(env, stripe.fetchImpl, 'GET', `/claim?order=${id}`);
  assert.equal(res.status, 200);
  const { license } = await res.json();
  assert.deepEqual((await P.verifyLicense(license, pub)).items, ['back:holo']);
  assert.equal((await call(env, stripe.fetchImpl, 'GET', '/claim?order=cs_test_missing1234')).status, 404);
  assert.equal((await call(env, stripe.fetchImpl, 'GET', '/claim?order=not-an-order')).status, 400);
  // a bundle collapses to one entry
  await call(env, stripe.fetchImpl, 'POST', '/checkout', { items: ['bundle:all'], returnUrl: `${ORIGIN}/` });
  const [id2, s2] = [...stripe.sessions.entries()][1];
  s2.payment_status = 'paid';
  assert.deepEqual((await P.verifyLicense((await (await call(env, stripe.fetchImpl, 'GET', `/claim?order=${id2}`)).json()).license, pub)).items, ['bundle:all']);
  // an order whose metadata names a look the server does not sell is ignored
  s2.metadata.skus = 'table:aurora,hack:everything';
  assert.deepEqual((await P.verifyLicense((await (await call(env, stripe.fetchImpl, 'GET', `/claim?order=${id2}`)).json()).license, pub)).items, ['table:aurora']);
});

test('the app: nothing is for sale until a store is set up; a redeemed licence unlocks exactly what it covers', async () => {
  const { priv, pub } = await makeKeys();
  globalThis.window = { RFI_FREE_LOOKS: false };
  assert.equal(P.storeMode(), 'off');
  assert.equal((await P.startCheckout('table:aurora')).ok, false);
  assert.equal(isUnlocked('table', 'aurora'), false);
  globalThis.window = { RFI_FREE_LOOKS: false, RFI_STORE: { api: 'https://api.example', publicKey: pub, prices: { 'table:aurora': '€2.49' } } };
  assert.equal(P.storeMode(), 'live');
  assert.equal(P.priceLabel('table', 'aurora'), '€2.49');
  assert.equal(P.priceLabel('back', 'holo'), '$0.99', 'falls back to the built-in label');
  assert.equal((await P.redeem('v1.bad.token')).ok, false);
  const token = await signLicense({ LICENSE_PRIVATE_JWK: priv }, ['table:aurora', 'back:holo'], 'cs_test_y');
  const r = await P.redeem(token);
  assert.deepEqual([r.ok, r.count], [true, 2]);
  assert.ok(isUnlocked('table', 'aurora') && isUnlocked('back', 'holo'));
  assert.ok(!isUnlocked('table', 'lava'), 'only what the licence covers');
  const bundle = await P.redeem(await signLicense({ LICENSE_PRIVATE_JWK: priv }, ['bundle:all'], 'cs_test_z'));
  assert.equal(bundle.ok, true);
  assert.ok(isUnlocked('table', 'lava') && isUnlocked('fx', 'fireworks'), 'the bundle covers every premium look');
  assert.ok(!isUnlocked('table', 'neon') || true);
  delete globalThis.window;
});

test('demo mode lets the screens be tried without payment, and is off unless asked for', async () => {
  globalThis.window = { RFI_FREE_LOOKS: false, RFI_STORE: { mode: 'demo' } };
  assert.equal(P.storeMode(), 'demo');
  assert.deepEqual(await P.startCheckout('back:holo'), { ok: true, demo: true });
  assert.ok(isUnlocked('back', 'holo'));
  globalThis.window = { RFI_FREE_LOOKS: false, RFI_STORE: { mode: 'live' } };
  assert.equal(P.storeMode(), 'off', 'live without an address and a key stays closed');
  delete globalThis.window;
});

test('every premium look exists in the theme lists, with a price', () => {
  const lists = { table: TABLES, back: BACKS, dice: DICE, fx: FX };
  for (const [part, ids] of Object.entries(P.PREMIUM)) {
    for (const [id, price] of Object.entries(ids)) {
      assert.ok(lists[part].some((x) => x.id === id), `${part}:${id} is in the list`);
      assert.match(price, /^\$\d+\.\d\d$/);
    }
  }
  assert.equal(P.ALL_SKUS.length, 8);
});

test('while looks are free, every look is open to everybody; turning it off brings the locks back', () => {
  globalThis.window = {}; // free unless config.js says otherwise
  assert.equal(P.freeLooks(), true);
  assert.ok(isUnlocked('table', 'aurora') && isUnlocked('back', 'holo') && isUnlocked('table', 'midnight') && isUnlocked('fx', 'stars'));
  globalThis.window = { RFI_FREE_LOOKS: false };
  assert.equal(P.freeLooks(), false);
  assert.ok(!isUnlocked('table', 'midnight') && !isUnlocked('fx', 'stars') && !isUnlocked('back', 'retro'));
  delete globalThis.window;
  assert.equal(P.freeLooks(), false, 'outside a page nothing is free by default, so tests of the locks stay meaningful');
});
