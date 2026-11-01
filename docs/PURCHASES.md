# Selling premium looks

Rollick's Shop has two kinds of looks:

- **Coin looks**: earned by playing and bought with coins. No real money, nothing to set up.
- **Premium looks** (animated skins and effects): bought with real money. This needs a payment provider and a small
  server, because a web page cannot safely take payments or prove that someone paid. This guide sets that up with
  **Stripe** (payments) and **Cloudflare Workers** (the small server). Both have free ways to start.

**While looks are free** (`window.RFI_FREE_LOOKS` is on, which is the default), none of this applies: every look is open and the Shop is a gallery. Set it to `false` in `config.js` when you are ready to charge.

Until you finish these steps, premium looks show "Coming soon" and nothing can be bought. The app and the server code
are done and tested; the accounts and keys are yours to create.

## How it works

1. A player taps **Buy** on a look. The app asks your server to start a Stripe Checkout page and sends the player there.
2. The player pays on Stripe's own page. Card details never touch Rollick or your server.
3. Stripe sends the player back to the game with an order number in the address (`?paid=cs_...`).
4. The app hands the order number to your server, which asks Stripe "was this paid?". If yes, it returns a **licence**:
   a short code signed with your private key.
5. The app checks the signature with your public key (built into `config.js`) and unlocks the look. The licence is kept on
   the device, and re-checked every time the app opens. A made-up licence fails the check.
6. **Restore a purchase** (in the Shop) lets a player paste a licence code to get their looks back on another device.

## What you need to do

### 1. Make a Stripe account
- Sign up at stripe.com. Stay in **test mode** (a switch in the dashboard) until everything works.
- In **Product catalogue**, create one product per look, each with a **one-time price**. The ids are:

  | Looks | Ids |
  |---|---|
  | Tables | `table:aurora`, `table:starfield`, `table:lava` |
  | Deck backs | `back:holo`, `back:circuit`, `back:ember` |
  | Win effects | `fx:fireworks`, `fx:goldrain` |
  | Everything pack | `bundle:all` |

- Copy each price's id (it starts with `price_`). Suggested prices are in `src/premium.js`; the price you set in Stripe
  is the one that is charged.
- Find your **secret key** (`sk_test_...`) under Developers, API keys. Keep it secret.

### 2. Make the signing keys
```
node tools/make-license-keys.mjs
```
It prints a **private** key (for the server, secret) and a **public** key (for `config.js`, safe to publish).

### 3. Put the server online (Cloudflare Workers)
- Make a free Cloudflare account and create a Worker. Paste in `server/worker.js`.
- Under the Worker's settings, add these as **secrets / variables** (never put them in git or in `config.js`):
  - `STRIPE_SECRET_KEY`: your `sk_test_...` key
  - `PRICES`: a JSON object like `{"table:aurora":"price_123","back:holo":"price_456","bundle:all":"price_789"}`
  - `LICENSE_PRIVATE_JWK`: the private key from step 2
  - `ALLOWED_ORIGIN`: where the game lives, e.g. `https://jokerman-ai.github.io`
- Note the Worker's address, e.g. `https://rollick-store.yourname.workers.dev`.

### 4. Turn the store on in the game
In `config.js`, remove the `//` from the `window.RFI_STORE = { ... }` block and fill in `api` and `publicKey`.
Commit and deploy. The Shop's premium buttons now say **Buy**.

### 5. Test, then go live
- Pay with Stripe's test card `4242 4242 4242 4242` (any future date, any CVC). The look should unlock when you return.
- Try **Restore a purchase** with the code from another browser.
- When happy, switch Stripe to live mode, swap in the live secret key and live price ids, and re-test with a real
  small purchase (you can refund it in Stripe).

## Things to decide and check before charging real money

- **Terms, refunds and privacy.** Add your refund policy and business details to the in-app terms. The terms in the
  app are a starting point and are not legal advice; have them checked before you sell.
- **Tax.** Selling digital goods can carry sales tax or VAT. Stripe Tax can calculate it; check what applies to you.
- **Age.** If children may play, check the rules for selling to minors where you operate.
- **App stores.** If you later wrap Rollick as an App Store or Google Play app, Apple and Google generally require
  digital goods (like these looks) to be sold through *their* purchase systems, not Stripe. The server here would need
  to verify their receipts instead. A web page or home-screen app is not affected.
- **Refunds and licences.** A refunded purchase is not taken back automatically: licences work offline and cannot be
  revoked. For cosmetic looks that is usually acceptable. If it matters, add an expiry to licences or a check at claim time.
- **Sharing.** A licence code can be passed to someone else. Again, usually acceptable for cosmetics.
- **Keys.** If the private signing key ever leaks, anyone could make licences. Make a new pair, update the server and
  `config.js`, and old licences stop working (people can restore from Stripe's receipts by contacting you).

## Trying the screens without paying

Set `window.RFI_STORE = { mode: 'demo' }` in `config.js`. Every premium button becomes **Try it** and switches the look
on for free on that device. This is only for trying things out: never leave it on for the live site.
