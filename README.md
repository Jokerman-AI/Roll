# Roll for It

A mobile-first, installable (PWA) version of the dice game *Roll for It*: roll dice, place them on the
cards that need them, claim cards, and be first to 40 points. Play pass-and-play with friends or against CPU
opponents (2–4 players). Works offline once loaded. This is an independent implementation with its own
card deck and art.

## Run

No build step. Serve the folder over HTTP and open it on your phone or desktop:

    python3 -m http.server 8000     # then visit http://localhost:8000

On a phone, use "Add to Home Screen" to install it as an app.

## Test

    node --test tests/engine.test.mjs

## Layout

- `src/engine.js` – pure rules (deck, rolling, placing, claiming, win check)
- `src/ai.js` – CPU opponent
- `src/app.js`, `src/style.css` – UI
- `sw.js`, `manifest.webmanifest`, `icons/` – PWA shell
