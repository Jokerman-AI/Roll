// Optional settings, loaded before the game starts.
//
// Online play connects phones directly and falls back to a shared free relay (PeerJS's) on networks
// that block direct connections. If friends on some network can't connect, add your own relay here.
// For example, a free TURN account from Cloudflare Calls or Metered gives you values like these:
//
// window.RFI_ICE_SERVERS = [
//   { urls: 'turn:YOUR-TURN-HOST:3478', username: 'YOUR-USERNAME', credential: 'YOUR-PASSWORD' },
// ];
//
// Free options for a relay of your own: a Metered.ca account (free tier) or Cloudflare Calls TURN.
// Paste the urls, username and credential they give you into RFI_ICE_SERVERS above and uncomment it.

// Where "Report a problem" can email reports to. Leave it out and people can still Share or Copy a report.
// window.RFI_FEEDBACK_EMAIL = 'you@example.com';

// The premium Shop. Premium looks are paid for with real money, so they need a payment provider and a small server
// (see docs/PURCHASES.md and server/worker.js). Until you fill this in, premium looks show "Coming soon".
//
// window.RFI_STORE = {
//   api: 'https://rollick-store.YOURNAME.workers.dev',          // the address of your purchase server
//   publicKey: { kty: 'EC', crv: 'P-256', x: '...', y: '...' }, // printed by: node tools/make-license-keys.mjs
//   prices: { 'table:aurora': '$1.99' },                        // optional: change the prices shown (what is charged is set at Stripe)
// };
//
// To click through the Shop screens without paying anything (for trying them out only, never for the live site):
// window.RFI_STORE = { mode: 'demo' };
