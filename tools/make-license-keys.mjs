// Makes the signing keys for premium licences. Run once: node tools/make-license-keys.mjs
//   - the PRIVATE key goes into the purchase server (LICENSE_PRIVATE_JWK). Keep it secret and never commit it.
//   - the PUBLIC key goes into config.js (RFI_STORE.publicKey). It is safe to publish.
const { publicKey, privateKey } = await crypto.subtle.generateKey({ name: 'ECDSA', namedCurve: 'P-256' }, true, ['sign', 'verify']);
const pub = await crypto.subtle.exportKey('jwk', publicKey);
const priv = await crypto.subtle.exportKey('jwk', privateKey);
console.log('--- PRIVATE key: set this as LICENSE_PRIVATE_JWK on the server. Keep it secret. ---');
console.log(JSON.stringify(priv));
console.log('\n--- PUBLIC key: put this in config.js as RFI_STORE.publicKey ---');
console.log(JSON.stringify({ kty: pub.kty, crv: pub.crv, x: pub.x, y: pub.y }));
