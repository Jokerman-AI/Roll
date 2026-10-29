# Roll for It

A mobile-first, installable (PWA) version of the dice game *Roll for It*: roll dice, place them on the
cards that need them, claim cards, and be first to 40 points. Play pass-and-play, against CPU
opponents, or online with friends (2–8 players). Works offline once loaded. This is an independent
implementation with its own card deck and art.

## Play online with friends

Open the game, choose **Play online with friends**, and create a room. Friends open the same link and
enter the 4-letter code (or tap the invite link). There are no accounts. The host's phone acts as the
server (peer-to-peer over WebRTC via PeerJS), so the host needs to keep the page open. A player who
reloads can use **Return to room** on the start screen.

Phones connect directly when they can and fall back to PeerJS's free shared relay on networks that block
direct connections. If someone still can't connect, add your own relay in `config.js` (a free TURN account
from Cloudflare Calls or Metered works); the game uses it as well as the defaults.

The screen is kept awake while you play so a locked phone does not drop the room. If the connection does
drop, a banner shows "Reconnecting…" and the game rejoins by itself, including when the host's phone wakes
up again. Moves are paused until it is back.

## Cards, dice and players

- Cards look like playing cards: the points are the corner index, the frame colour shows how hard the
  card is, and the gold ones are the five-of-a-kind jackpots. The deck of 30 runs from 2 points (one die)
  to 15 (five of a kind). Points follow how long a card takes to finish (simulated), so the hard ones pay more.
- Dice tumble and land one by one when rolled (reduced-motion settings skip the animation).
- A die on a card takes the colour of the player covering it. When several players cover the same number it
  splits into slices of their colours with a small count badge, and tapping any die lists who has it and each
  player's progress on the card.
- Each scored card goes into a staggered pile next to the player's score, with its points showing. A claimed
  card flies to its owner and the score counts up; the winner gets confetti.
- The 💡 button highlights the best move (the die and the card, or whether to roll or take back), and ↶ undoes
  your last placement until you end your turn (a placement that claims a card can't be undone).
- Each player draws their own icon and chooses their dice colour; every player in a game has a different colour.
  Your icon and colour are remembered on your device.

## Good to know

- **Browsers:** the layout needs a recent browser: Safari 16.4 or newer (iOS 16.4+), Chrome or Edge 105+.
- **Fair play:** each player's browser runs the game, and the host only checks that moves come from the player
  whose turn it is. It is built for friends; a determined player could cheat, and room codes are short and not secret.
- **Hosting a room:** if the host leaves, the room ends; if the host only reloads, "Return to room" picks the game up again.

## Screens

The layout adapts to small phones, large phones, tablets, landscape, notches, and dual-screen devices
(Surface Duo): side by side it puts the cards on one screen and the controls on the other, and in
laptop posture the table sits above the hinge and the dice below.

## Run locally

No build step. Serve the folder over HTTP and open it on your phone or desktop:

    python3 -m http.server 8000     # then visit http://localhost:8000

## Put it online (GitHub Pages)

1. Merge this branch into `main`.
2. In the repo settings, open **Pages** and set the source to **GitHub Actions**.
3. The workflow in `.github/workflows/pages.yml` publishes the site and prints its address. Share that
   link. On a phone, "Add to Home Screen" installs it as an app.

Any static host (Netlify Drop, Cloudflare Pages) also works: upload `index.html`, `manifest.webmanifest`,
`sw.js`, `src/`, `icons/` and `vendor/`.

## Test

    node --test tests/engine.test.mjs

## Layout

- `src/engine.js`: pure rules (deck, rolling, placing, claiming, win check)
- `src/ai.js`: CPU opponent
- `src/transport.js`: room back ends (peer-to-peer, or the shared database on claude.ai)
- `src/profile.js`: dice colours, emoji stamps and the icon drawing surface
- `config.js`: optional settings, such as your own relay servers
- `src/app.js`, `src/style.css`: UI
- `sw.js`, `manifest.webmanifest`, `icons/`: PWA shell
- `vendor/peerjs.min.js`: PeerJS 1.5.4 (MIT)
- `tools/build-single.mjs`: bundles everything into `dist/roll-for-it.html` for single-page hosts
