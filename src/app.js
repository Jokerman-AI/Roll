import * as E from './engine.js';
import { aiNextAction } from './ai.js';

const COLORS = ['#e5484d', '#3b82f6', '#2fb36d', '#f5a524', '#a855f7', '#14b8a6', '#ec4899', '#cbd5e1'];
const MAX_PLAYERS = E.MAX_PLAYERS;
const CPU_DELAY = 700;
const ROLL_MS = 650;
const PIPS = { 1: [4], 2: [0, 8], 3: [0, 4, 8], 4: [0, 2, 6, 8], 5: [0, 2, 4, 6, 8], 6: [0, 2, 3, 5, 6, 8] };

const app = document.getElementById('app');
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const store = {
  get: (k) => { try { return localStorage.getItem(k); } catch { return null; } },
  set: (k, v) => { try { localStorage.setItem(k, v); } catch { /* storage unavailable */ } },
};

// Online play uses the host page's shared database when it exists (null elsewhere).
const net = { db: null, uid: null, ref: null, unsub: null, room: null, mySeat: -1, q: Promise.resolve(), busy: false };
const ui = {
  screen: 'setup', // setup | online | lobby | game
  online: false,
  name: store.get('rfi-name') || 'Player',
  joinCode: '',
  setup: [{ name: 'You', cpu: false }, { name: 'Robo', cpu: true }],
  game: null,
  selected: null,
  rolling: false,
  toast: '',
  modal: null,
};
let timer = 0;
let toastTimer = 0;

const esc = (s) => s.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const wins = (name) => `${esc(name)} ${name.trim().toLowerCase() === 'you' ? 'win' : 'wins'}!`;
const isHost = () => net.room?.hostUid === net.uid;
const color = (p) => COLORS[p % COLORS.length];

function die(face, cls = '', attrs = '', tag = 'div') {
  const pips = Array.from({ length: 9 }, (_, i) => `<i${PIPS[face].includes(i) ? ' class="on"' : ''}></i>`).join('');
  return `<${tag} class="die ${cls}" aria-label="${face}" ${attrs}>${pips}</${tag}>`;
}

/* ---------- rendering ---------- */

function render() {
  app.innerHTML = ({ setup: setupView, online: onlineView, lobby: lobbyView, game: gameView }[ui.screen])() + modalView() + (ui.toast ? `<div class="toast">${esc(ui.toast)}</div>` : '');
}

function setupView() {
  const rows = ui.setup.map((p, i) => `
    <div class="prow">
      <span class="dot" style="background:${color(i)}"></span>
      <input data-name="${i}" value="${esc(p.name)}" maxlength="12" aria-label="Player ${i + 1} name">
      <button class="btn" data-act="toggleCpu" data-i="${i}">${p.cpu ? 'CPU' : 'Human'}</button>
      ${ui.setup.length > 2 ? `<button class="btn" data-act="removePlayer" data-i="${i}" aria-label="Remove">✕</button>` : ''}
    </div>`).join('');
  return `
    <div class="setup">
      <div><h1>🎲 Roll for It</h1><p class="tag">Roll dice, match the cards, race to ${E.TARGET_SCORE} points.</p></div>
      ${rows}
      ${ui.setup.length < MAX_PLAYERS ? '<button class="btn" data-act="addPlayer">+ Add player</button>' : ''}
      <button class="btn primary" data-act="start">Start game</button>
      ${net.db ? '<button class="btn" data-act="goOnline">Play online with friends</button>' : ''}
      <button class="btn" data-act="rules">How to play</button>
    </div>`;
}

function onlineView() {
  return `
    <div class="setup">
      <div><h1>Play online</h1><p class="tag">Create a room and send friends the code, or enter theirs.</p></div>
      <div class="prow"><input id="myname" value="${esc(ui.name)}" maxlength="12" placeholder="Your name" aria-label="Your name"></div>
      <button class="btn primary" data-act="createRoom" ${net.busy ? 'disabled' : ''}>Create room</button>
      <div class="prow">
        <input id="joincode" value="${esc(ui.joinCode)}" maxlength="4" placeholder="Room code" autocapitalize="characters" autocomplete="off" aria-label="Room code" style="text-transform:uppercase;letter-spacing:.2em">
        <button class="btn" data-act="joinRoom" ${net.busy ? 'disabled' : ''}>Join</button>
      </div>
      <button class="btn" data-act="toSetup">Back</button>
    </div>`;
}

function lobbyView() {
  const room = net.room;
  if (!room) return '<div class="setup"><p class="tag">Connecting…</p></div>';
  const rows = room.seats.map((p, i) => `
    <div class="prow">
      <span class="dot" style="background:${color(i)}"></span>
      <span style="flex:1">${esc(p.name)}${i === net.mySeat ? ' <small>(you)</small>' : ''}${p.cpu ? ' <small>CPU</small>' : ''}${p.uid === room.hostUid ? ' <small>host</small>' : ''}</span>
      ${isHost() && p.cpu ? `<button class="btn" data-act="removeSeat" data-i="${i}" aria-label="Remove">✕</button>` : ''}
    </div>`).join('');
  return `
    <div class="setup">
      <div><h1>Room <span class="code">${esc(room.code)}</span></h1><p class="tag">Friends join with this code. ${room.seats.length} of ${MAX_PLAYERS} seats taken.</p></div>
      ${rows}
      ${isHost() ? `
        ${room.seats.length < MAX_PLAYERS ? '<button class="btn" data-act="addSeatCpu">+ Add CPU player</button>' : ''}
        <button class="btn primary" data-act="startOnline" ${room.seats.length < 2 ? 'disabled' : ''}>Start game</button>`
        : '<p class="tag">Waiting for the host to start…</p>'}
      <button class="btn" data-act="toSetup">Leave room</button>
    </div>`;
}

function statusText(s) {
  const cur = s.players[s.current];
  if (s.phase === 'over') return wins(s.players[s.winner].name);
  if (ui.rolling) return `${esc(cur.name)} rolls…`;
  if (cur.cpu) return `${esc(cur.name)} is thinking…`;
  if (ui.online && s.current !== net.mySeat) return net.mySeat < 0 ? `Watching ${esc(cur.name)}…` : `${esc(cur.name)} is playing…`;
  if (s.phase === 'start') {
    return E.handSize(s, s.current) === 0 ? 'All your dice are on cards — take them back to roll' : `${esc(cur.name)}: roll your ${E.handSize(s, s.current)} dice`;
  }
  if (!s.rolled.length) return 'All dice placed';
  if (!E.legalMoves(s).length) return 'No matches this time';
  return ui.selected === null ? 'Tap a die, then the card it fits' : 'Tap a highlighted card';
}

function cardView(s, card, ci) {
  const accepts = ui.selected !== null && E.canPlace(s, ui.selected, ci);
  const used = new Map(); // per player, how many of each face already counted
  const slots = card.need.map((face) => {
    const owners = s.players.map((_, p) => p).filter((p) => {
      const key = `${p}:${face}`;
      const n = used.get(key) || 0;
      const has = card.placed[p].filter((f) => f === face).length;
      used.set(key, n + 1);
      return has > n;
    });
    const mine = owners.includes(s.current);
    const others = owners.filter((p) => p !== s.current);
    const dots = others.map((p) => `<i style="--c:${color(p)}"></i>`).join('');
    return `<div class="slot ${mine ? 'mine' : ''}">
      ${die(face, mine ? 'mine' : 'ghost', mine ? `style="--c:${color(s.current)}"` : '')}
      <span class="dots">${dots}</span></div>`;
  }).join('');
  return `<div class="gcard ${accepts ? 'accepts' : ''}" data-act="pickCard" data-card="${ci}" role="group">
    <div class="pts">${card.points}<small>PTS</small></div><div class="slots">${slots}</div></div>`;
}

function gameView() {
  const s = ui.game;
  const human = isMine(s);
  const chips = s.players.map((p, i) => `
    <div class="chip ${i === s.current && s.phase !== 'over' ? 'active' : ''}" style="--c:${color(i)}">
      <span class="n">${esc(p.name)}${ui.online && i === net.mySeat ? ' (you)' : ''}</span><span class="s">${p.score}<small> / ${E.TARGET_SCORE}</small></span>
    </div>`).join('');

  let tray;
  if (s.phase === 'placing') {
    tray = s.rolled.map((f, i) => die(f, `${ui.rolling ? 'rolling' : ''} ${ui.selected === i ? 'sel' : ''}`,
      human && !ui.rolling ? `data-act="pickRolled" data-i="${i}"` : 'disabled', 'button')).join('')
      || '<span class="hint">—</span>';
  } else {
    const n = E.handSize(s, s.current);
    tray = n ? Array.from({ length: n }, () => die(1, 'ghost')).join('').replace(/aria-label="1"/g, 'aria-label="die in hand"') : '<span class="hint">No dice in hand</span>';
  }
  const onCards = E.DICE_PER_PLAYER - E.handSize(s, s.current);
  const canTakeBack = human && s.phase === 'start' && onCards > 0;
  const mustTakeBack = canTakeBack && onCards === E.DICE_PER_PLAYER;
  const canRoll = human && s.phase === 'start' && E.handSize(s, s.current) > 0;
  const canEnd = human && s.phase === 'placing' && !ui.rolling;
  const noMoves = canEnd && !E.legalMoves(s).length;

  return `
    <div class="score">${chips}</div>
    <div class="status">${statusText(s)}</div>
    <div class="cards">${s.cards.map((c, i) => cardView(s, c, i)).join('')}</div>
    <div class="tray">
      <div class="dice">${tray}</div>
      <div class="actions">
        <button class="btn primary ${canRoll ? 'pulse' : ''}" data-act="roll" ${canRoll ? '' : 'disabled'}>Roll</button>
        ${s.phase === 'start' ? `<button class="btn ${mustTakeBack ? 'primary pulse' : ''}" data-act="takeBack" ${canTakeBack ? '' : 'disabled'}>Take back &amp; roll all</button>` : `<button class="btn ${noMoves ? 'primary pulse' : ''}" data-act="end" ${canEnd ? '' : 'disabled'}>End turn</button>`}
        <button class="btn" data-act="menu" style="flex:0 0 auto" aria-label="Menu">☰</button>
      </div>
    </div>`;
}

function modalView() {
  if (ui.screen === 'game' && ui.game?.phase === 'over') {
    const s = ui.game;
    const scores = s.players.map((p) => `<div>${esc(p.name)}: <b>${p.score}</b></div>`).join('');
    return `<div class="modal"><div class="sheet winner">
      <div>🏆</div><div class="big">${wins(s.players[s.winner].name)}</div>${scores}
      ${ui.online && !isHost() ? '<p>Waiting for the host to start a rematch…</p>' : '<button class="btn primary" data-act="rematch">Rematch</button>'}
      <button class="btn" data-act="toSetup">${ui.online ? 'Leave room' : 'Main menu'}</button></div></div>`;
  }
  if (ui.modal === 'rules') {
    return `<div class="modal" data-act="closeModal"><div class="sheet"><h2>How to play</h2>
      <p>Be the first to score <b>${E.TARGET_SCORE} points</b>. Cards are worth 2–15 points.</p>
      <ol>
        <li><b>Roll for it!</b> Roll all the dice in your hand (you own ${E.DICE_PER_PLAYER}), once per turn.</li>
        <li><b>Match it!</b> Tap a die, then a card that shows that number. Each die matches one picture on one card. Once placed, a die can't move. You may choose not to place a die; unplaced dice stay in your hand.</li>
        <li><b>Score it!</b> Cover every picture on a card with <i>your own</i> dice to score it. All dice on a scored card go back to their owners, and a new card is flipped. Leftover dice from your roll may go on the new card.</li>
        <li><b>Take Back:</b> at the start of your turn, before rolling, you may take back <b>all</b> your dice from the cards and roll all six.</li>
      </ol>
      <p>Coloured dots under a number show which opponents already cover it. Other players' dice can't score cards for you, but they can beat you to them!</p>
      <p>Play starts with a two-dice roll-off; 5+ players use two sets (60 cards) and four face-up cards.</p>
      <button class="btn primary" data-act="closeModal">Got it</button></div></div>`;
  }
  if (ui.modal === 'menu') {
    return `<div class="modal" data-act="closeModal"><div class="sheet"><h2>Menu</h2>
      <button class="btn" data-act="rules">How to play</button>
      ${ui.online && isHost() && ui.game?.phase !== 'over' && ui.game.current !== net.mySeat ? '<button class="btn" data-act="skipTurn">Skip current player</button>' : ''}
      ${ui.online ? '' : '<button class="btn" data-act="rematch">Restart game</button>'}
      <button class="btn" data-act="toSetup">${ui.online ? 'Leave room' : 'Main menu'}</button>
      <button class="btn primary" data-act="closeModal">Resume</button></div></div>`;
  }
  return '';
}

/* ---------- flow ---------- */

function say(text, ms = 1800) {
  ui.toast = text;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => { ui.toast = ''; render(); }, ms);
}

const isMine = (s) => s.phase !== 'over' && (ui.online ? s.current === net.mySeat : !s.players[s.current].cpu);
const canAct = () => !!ui.game && !ui.rolling && isMine(ui.game);
let rollTimer = 0;

/** Apply a game state, whether it came from this device or the network. */
function receive(next) {
  const prev = ui.game;
  if (prev && prev.gid === next.gid && next.rev <= prev.rev) return; // duplicate or stale
  ui.game = next;
  ui.selected = null;
  if (next.lastClaim && prev?.rev !== next.rev) {
    const c = next.lastClaim;
    say(`${next.players[c.player].name} claimed ${c.points} points!`);
  }
  if (prev && prev.gid === next.gid && prev.phase === 'start' && next.phase === 'placing') {
    ui.rolling = true;
    clearTimeout(rollTimer);
    rollTimer = setTimeout(() => { ui.rolling = false; render(); settle(); }, ROLL_MS);
  }
  render();
  settle();
}

/** A move made on this device: show it now and, online, share it. */
function commit(next) {
  next.rev = (ui.game?.rev ?? 0) + 1;
  next.gid = ui.game?.gid;
  receive(next);
  if (ui.online) pushRoom({ ...net.room, game: next, status: next.phase === 'over' ? 'over' : 'playing' });
}

function pushRoom(data) {
  net.room = data;
  net.q = net.q.then(() => net.ref.set(data)).catch(() => say('Could not sync. Check your connection.'));
  return net.q;
}

function settle() {
  clearTimeout(timer);
  const s = ui.game;
  if (!s || s.phase === 'over' || ui.rolling) return;
  if (s.players[s.current].cpu) {
    if (!ui.online || isHost()) timer = setTimeout(cpuStep, CPU_DELAY);
  } else if (isMine(s) && s.phase === 'placing' && (!s.rolled.length || !E.legalMoves(s).length)) {
    if (s.rolled.length) say('No matching cards — turn passes');
    timer = setTimeout(() => { if (ui.game === s) commit(E.endTurn(s)); }, 1300);
  }
}

function doRoll() { commit(E.roll(ui.game)); }
function doTakeBack() { commit(E.roll(E.takeBack(ui.game))); }

function cpuStep() {
  const s = ui.game;
  if (!s || s.phase === 'over' || !s.players[s.current].cpu) return;
  const a = aiNextAction(s);
  if (a.type === 'takeback') commit(E.takeBack(s));
  else if (a.type === 'roll') doRoll();
  else if (a.type === 'place') commit(E.place(s, a.rolled, a.card));
  else commit(E.endTurn(s));
}

function freshGame(configs) {
  const g = E.newGame(configs);
  g.rev = 0;
  g.gid = Math.random().toString(36).slice(2);
  return g;
}

function startGame() {
  clearTimeout(timer);
  ui.online = false;
  ui.game = null;
  const g = freshGame(ui.setup);
  ui.screen = 'game';
  ui.rolling = false;
  ui.modal = null;
  receive(g);
  say(`${g.players[g.current].name} goes first (rolled ${g.firstRoll})`, 2500);
}

/* ---------- online rooms ---------- */

const CODE_CHARS = 'ABCDEFGHJKLMNPQRSTUVWXYZ';
const newCode = () => Array.from({ length: 4 }, () => CODE_CHARS[Math.floor(Math.random() * CODE_CHARS.length)]).join('');

async function initNet() {
  const claude = window.claude;
  if (!claude?.use) return;
  try {
    const [db, user] = await Promise.all([claude.use('db'), claude.use('user')]);
    const uid = user ? await user.id() : null;
    if (db && uid) { net.db = db; net.uid = uid; render(); }
  } catch { /* online play unavailable */ }
}

function watchRoom(code) {
  net.unsub?.();
  net.ref = net.db.collection('rooms').doc(code);
  net.room = null;
  net.q = Promise.resolve();
  net.unsub = net.ref.onSnapshot(onRoom, () => { say('Lost connection to the room'); leaveRoom(); });
}

function onRoom(snap) {
  if (!snap.exists) { if (ui.online) { say('Room closed'); leaveRoom(); } return; }
  const room = snap.data();
  net.room = room;
  net.mySeat = room.seats.findIndex((p) => p.uid === net.uid);
  ui.online = true;
  if (room.status === 'lobby') {
    clearTimeout(timer);
    ui.game = null;
    ui.screen = 'lobby';
    ui.modal = null;
    render();
  } else {
    ui.screen = 'game';
    receive(room.game);
  }
}

function leaveRoom() {
  clearTimeout(timer);
  net.unsub?.();
  net.unsub = null;
  net.room = null;
  net.mySeat = -1;
  ui.online = false;
  ui.game = null;
  ui.rolling = false;
  ui.modal = null;
  ui.screen = 'setup';
  render();
}

/** Read-modify-write on the room, serialised across players with a short lease. */
async function mutateRoom(fn) {
  for (let i = 0; i < 8; i++) {
    const lease = await net.ref.acquire({ holder: net.uid, ttlMs: 1000 });
    if (lease.acquired) {
      const snap = await net.ref.get();
      if (!snap.exists) return;
      const next = fn(structuredClone(snap.data()));
      if (next) await pushRoom(next);
      return;
    }
    await sleep(300 + Math.random() * 300);
  }
  say('The room is busy. Try again.');
}

const myName = () => (ui.name.trim() || 'Player').slice(0, 12);

async function createRoom() {
  net.busy = true; render();
  try {
    let code;
    for (let i = 0; i < 5; i++) {
      code = newCode();
      if (!(await net.db.collection('rooms').doc(code).get()).exists) break;
    }
    watchRoom(code);
    await pushRoom({ code, hostUid: net.uid, status: 'lobby', seats: [{ uid: net.uid, name: myName(), cpu: false }], game: null, createdAt: Date.now() });
  } catch { leaveRoom(); ui.screen = 'online'; say('Could not create a room. The page needs to be shared with you as an editor.'); }
  net.busy = false; render();
}

async function joinRoom() {
  const code = ui.joinCode.trim().toUpperCase();
  if (code.length !== 4) { say('Enter the 4-letter room code'); return; }
  net.busy = true; render();
  try {
    if (!(await net.db.collection('rooms').doc(code).get()).exists) { say('No room with that code'); net.busy = false; render(); return; }
    watchRoom(code);
    await mutateRoom((room) => {
      if (room.seats.some((p) => p.uid === net.uid)) return null; // rejoining
      if (room.status !== 'lobby' || room.seats.length >= MAX_PLAYERS) return null; // watch only
      room.seats.push({ uid: net.uid, name: myName(), cpu: false });
      return room;
    });
  } catch { leaveRoom(); ui.screen = 'online'; say('Could not join. The page needs to be shared with you as an editor.'); }
  net.busy = false; render();
}

async function startOnline() {
  await mutateRoom((room) => {
    if (room.hostUid !== net.uid || room.seats.length < 2) return null;
    room.game = freshGame(room.seats);
    room.status = 'playing';
    return room;
  });
}

const actions = {
  toggleCpu: ({ i }) => { ui.setup[i].cpu = !ui.setup[i].cpu; render(); },
  addPlayer: () => { ui.setup.push({ name: `Player ${ui.setup.length + 1}`, cpu: true }); render(); },
  removePlayer: ({ i }) => { ui.setup.splice(i, 1); render(); },
  start: startGame,
  rematch: () => (ui.online ? startOnline() : startGame()),
  goOnline: () => { ui.screen = 'online'; render(); },
  createRoom,
  joinRoom,
  startOnline,
  addSeatCpu: () => mutateRoom((room) => {
    if (room.hostUid !== net.uid || room.seats.length >= MAX_PLAYERS) return null;
    const n = room.seats.filter((p) => p.cpu).length + 1;
    room.seats.push({ uid: null, name: `Robo ${n}`, cpu: true });
    return room;
  }),
  removeSeat: ({ i }) => mutateRoom((room) => {
    if (room.hostUid !== net.uid || !room.seats[i]?.cpu) return null;
    room.seats.splice(i, 1);
    return room;
  }),
  skipTurn: () => {
    const g = structuredClone(ui.game);
    g.rolled = [];
    g.phase = 'start';
    g.current = (g.current + 1) % g.players.length;
    ui.modal = null;
    commit(g);
  },
  toSetup: () => { if (ui.online || net.unsub) { leaveRoom(); return; } clearTimeout(timer); ui.screen = 'setup'; ui.modal = null; ui.game = null; ui.rolling = false; render(); },
  rules: () => { ui.modal = 'rules'; render(); },
  menu: () => { ui.modal = 'menu'; render(); },
  closeModal: () => { ui.modal = null; render(); },
  roll: () => { if (canAct() && ui.game.phase === 'start' && E.handSize(ui.game, ui.game.current) > 0) doRoll(); },
  end: () => { if (canAct() && ui.game.phase === 'placing') { clearTimeout(timer); commit(E.endTurn(ui.game)); } },
  takeBack: () => { if (canAct() && ui.game.phase === 'start') doTakeBack(); },
  pickRolled: ({ i }) => {
    if (!canAct() || ui.game.phase !== 'placing') return;
    const idx = +i;
    const targets = ui.game.cards.map((_, c) => c).filter((c) => E.canPlace(ui.game, idx, c));
    if (!targets.length) { say('No card needs that number'); return; }
    if (targets.length === 1) { commit(E.place(ui.game, idx, targets[0])); return; }
    ui.selected = ui.selected === idx ? null : idx;
    render();
  },
  pickCard: ({ card }) => {
    if (canAct() && ui.selected !== null && E.canPlace(ui.game, ui.selected, +card)) commit(E.place(ui.game, ui.selected, +card));
  },
};

app.addEventListener('click', (e) => {
  const el = e.target.closest('[data-act]');
  if (!el || (el.classList.contains('modal') && e.target !== el)) return;
  // Slots sit inside cards; the slot's own action wins over the card's.
  actions[el.dataset.act]?.({ ...el.dataset });
});
app.addEventListener('input', (e) => {
  if (e.target.id === 'myname') { ui.name = e.target.value; store.set('rfi-name', ui.name); return; }
  if (e.target.id === 'joincode') { ui.joinCode = e.target.value.toUpperCase(); return; }
  const i = e.target.dataset?.name;
  if (i !== undefined) ui.setup[i].name = e.target.value.trim() || `Player ${+i + 1}`;
});

render();
initNet();

if ('serviceWorker' in navigator && location.protocol.startsWith('http')) {
  navigator.serviceWorker.register('sw.js').catch(() => {});
}
