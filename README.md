# Rollick

A mobile-first, installable (PWA) version of the dice game Rollick: roll dice, place them on the
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

## Tutorial and themes

- **Tutorial:** a guided first game on a prepared table (start screen: *Learn to play*, or *Tutorial* in the links). Tips tell you what to tap, highlight the die and card to use, and only let you make the move being taught.
- **Themes:** table colour, deck back and dice style (start screen or Menu: *Themes*). Saved on the device and applied straight away.

## 3D dice and your own design

The dice in your tray are real 3D cubes (CSS 3D, no library): they tumble end over end, land with the rolled number facing you, and are shaded for a light from the top left. Themes has a **3D dice** switch (off gives the flat dice) and Calm table stops the motion. The animated looks have richer effects: Fire (flames and rising embers), Ice (frost and glints), Prism (rainbow sheen and shifting edges), Neon glow (a pulsing tube), plus new **Solid gold**, **Obsidian**, **Galaxy** and **Lightning**.

**Studio quality.** On devices that can draw WebGL, the tray dice are rendered with a real 3D engine (three.js): bevelled bodies, reflections, pips pressed into the faces, soft shadows, and per-look materials and particles (molten flames and embers for Fire, frosted glass for Ice, thin-film rainbow for Prism, polished metal for Solid gold, and so on). The page keeps invisible dice for taps and screen readers; there is a **Studio quality** switch in Themes, and devices without WebGL fall back to the CSS cubes. The engine lives in `tools/dice3d/dice3d.js` and is built into `vendor/dice3d.js` (`tools/build-dice3d.mjs`).

**Design your own die** (Themes, then the button) lets you pick the finish, pip shape, pip colour, corners, glow and sparkle, with a turning preview. It is saved on the device (`rfi-customdie`) as the "Your design" look and is always free.

## Settings, unlocks and problem reports

- **Game settings:** choose what a game plays to (20, 30, 40 or 60) and how many dice each player owns (4 to 8), on the start screen or, for the host, in an online lobby. With four dice, cards that need five are left out of the deck.
- **Unlockable looks:** playing, winning and claiming cards (counted on the device only) unlock more table colours, deck backs and dice styles. The 🎨 Themes sheet shows what each one needs.
- **Report a problem:** in About & terms. The app keeps a short log of error messages on the device; a report (device, what the app was doing, recent errors, and what you type) can be shared or copied, and emailed if `RFI_FEEDBACK_EMAIL` is set in `config.js`. Reports never include names, room codes or drawings, and nothing is sent automatically.

## Online extras

- **Emoji:** in an online game, tap a player's name (or Menu, then Send an emoji) to send one of eight emoji; everyone sees it float up from your name.
- **Back to lobby / Play again:** the host can restart with the same players, or go back to the lobby to change the game, add computer players or remove someone.
- **Public rooms:** the host can switch on *Public room* in the lobby. The room then shows in everyone's **Open rooms** list on the Play online screen (only while it is in the lobby with a free seat). The list is passed through the same free public message servers as the backup route, so it needs no server of your own. Hosts can remove players.
- **Sound and vibration:** sound effects are made on the spot with Web Audio (no files); both can be switched off from the menu. Vibration works on Android browsers; iPhones do not allow it from web pages.

## Rollick Extreme

Pick **Rollick Extreme** on the start screen (or in an online lobby, as host) for the same game with extra rules:

- **Power cards.** Everyone starts with one and can hold three. Claim a card worth 7+ points, or roll three of a kind, to win another. Played on your own turn after rolling: Re-roll a die, Set a die to any number, Knock a rival's die off a card, Bonus +3 on your next claim, or Skip the next player.
- **Chaos rounds.** A new round can bring double points, or send every die back to its owner.
- **Turn timer.** A minute per turn; when it runs out the turn is played for you.
- Computer players use power cards too, at their own difficulty.

The rules live in `src/engine.js` (`newGame(..., { mode: 'extreme' })`, `usePower`, `powerMoves`); the classic game is unchanged.

## Computer players

The computer only uses what every player can see. It budgets its dice like a sensible player: it won't spend its
last free dice on a card it can't finish, because then it would have nothing to roll next turn, and it concentrates
on cards that are close to done. At the top strength it also plays out the next few turns many times to choose
where to put a die, whether to place it at all or keep it free to roll again, when to use Take Back, when a rival is
about to finish a card, and it always takes a card that wins.

There are three strengths in `src/ai.js`: **easy**, **normal** (the default) and **hard**. Against the original
simple bot (which spent every die it could, and started 1 turn in 10 with nothing to roll) they win about 68%, 77%
and 94% of two-player games. The hint button always uses the hard player's advice. To measure them:

    node tools/bench-ai.mjs 300 easy,normal,hard

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
- `tools/build-single.mjs`: bundles everything into `dist/rollick.html` for single-page hosts
