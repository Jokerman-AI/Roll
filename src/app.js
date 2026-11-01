import * as E from './engine.js';
import { aiNextAction } from './ai.js';

const modeLabel = (m) => (m === 'extreme' ? 'Rollick Extreme' : 'Rollick');
const modeBlurb = (m, target) => (m === 'extreme'
  ? `Power cards, bonus rolls, chaos rounds and a turn timer. First to ${target}.`
  : `Roll the dice, fill the cards, be first to ${target}.`);
const TURN_MS = 60000; // Extreme: time for one turn
const levelLabel = (l) => (E.LEVEL_NAMES.includes(l) ? l : 'normal').replace(/^./, (c) => c.toUpperCase());
import { dbStore, p2pStore, checkConnection } from './transport.js';
import { checkFallback, DEFAULT_BROKERS, lobbyList, lobbyAnnouncer } from './relay.js';
import { sfx, soundPrefs, setSound, setHaptics, canVibrate } from './sound.js';
import { theme, TABLES, BACKS, DICE, setTheme } from './theme.js';
import { stats, isUnlocked, requirementText, recordGame } from './stats.js';
import { installReporter, errorLog, clearErrors, buildReport, VERSION } from './report.js';
import {
  PALETTE, INK, BRUSHES, STAMPS, AVATAR_SIZE, REACTIONS, cpuName, freeColor, safeAvatar, makeSketch, paintCanvas, pointOn, strokeSegment, stampAt, clearSketch, loadAvatar, exportAvatar,
} from './profile.js';

const MAX_PLAYERS = E.MAX_PLAYERS;
const CPU_DELAY = window.RFI_CPU_DELAY ?? 700;
const PIPS = { 1: [4], 2: [0, 8], 3: [0, 4, 8], 4: [0, 2, 6, 8], 5: [0, 2, 4, 6, 8], 6: [0, 2, 3, 5, 6, 8] };
const reducedMotion = () => window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;

const app = document.getElementById('app');
const toastEl = Object.assign(document.createElement('div'), { className: 'toast', hidden: true });
toastEl.setAttribute('role', 'status');
document.body.appendChild(toastEl);

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const store = {
  get: (k) => { try { return localStorage.getItem(k); } catch { return null; } },
  set: (k, v) => { try { localStorage.setItem(k, v); } catch { /* storage unavailable */ } },
};

// Online play: the host page's shared database when present, otherwise peer-to-peer.
const net = { store: null, uid: null, ref: null, unsub: null, room: null, mySeat: -1, q: Promise.resolve(), busy: false };

const profile = {
  name: store.get('rfi-name') || 'Player',
  color: Number.isInteger(+store.get('rfi-color')) && store.get('rfi-color') !== null ? +store.get('rfi-color') % PALETTE.length : 0,
  avatar: safeAvatar(store.get('rfi-avatar') || ''),
};
const saveProfile = () => { store.set('rfi-name', profile.name); store.set('rfi-color', String(profile.color)); store.set('rfi-avatar', profile.avatar); };

const ui = {
  screen: 'setup', // setup | online | lobby | game
  online: false,
  joinCode: '',
  mode: store.get('rfi-mode') === 'extreme' ? 'extreme' : 'classic', // classic | extreme
  settings: loadSettings(), // { target, dice }: what a new game plays to, and the dice each player owns
  power: null, // the power card being played: { kind, rolled? }
  turnEnds: 0, // Extreme: when the current turn runs out
  tut: null, // the guided first game: { step }
  reportNote: '', // what the person typed in Report a problem
  recorded: '', // the game whose result is already in the stats
  newUnlocks: [], // looks the last game unlocked
  react: false, // the emoji picker is open
  rooms: { state: 'idle', list: [] }, // the public room list on the online screen
  netTest: '', // result of the connection check on the online screen
  onlineError: '', // why the last create/join failed, shown on the online screen
  setup: [
    { name: 'You', cpu: false, me: true, color: profile.color, avatar: profile.avatar }, // `me` marks the row that is saved as your profile
    { name: cpuName(['You']), cpu: true, level: 'normal', color: freeColor([profile.color], 1), avatar: '' },
  ],
  cfg: [], // players of the local game in progress
  game: null,
  selected: null,
  rolling: false,
  fx: [],
  hint: null, // {rolled, card} or {button}
  peek: null, // {card, slot, id}: the who-has-this-die popover, kept while that card is on the table
  undo: [], // game states before this turn's placements
  conn: 'online',
  modal: null,
  ed: null, // icon / colour editor
};
let timer = 0;
let toastTimer = 0;
let rollTimer = 0;
let rollClock = 0;
let hintTimer = 0;
let peekTimer = 0;

const esc = (s) => String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const wins = (name) => `${esc(name)} ${name.trim().toLowerCase() === 'you' ? 'win' : 'wins'}!`;
const isHost = () => net.room?.hostUid === net.uid;

/* ---------- players' looks ---------- */

const seats = () => (ui.online ? net.room?.seats : ui.cfg) || [];
const swatch = (p, i) => PALETTE[Number.isInteger(p?.color) ? ((p.color % PALETTE.length) + PALETTE.length) % PALETTE.length : i % PALETTE.length];
const hexOf = (i) => swatch(seats()[i], i).hex;
const diceVars = (p, i) => { const c = swatch(p, i); return `--c:${c.hex};--pc:${c.pip};--pip:${c.pip}`; };

function avatarHtml(p, i, size) {
  const c = swatch(p, i);
  const img = safeAvatar(p?.avatar);
  const inner = img ? `<img src="${img}" alt="">` : `<b style="color:${c.pip}">${esc((p?.name || '?').trim().charAt(0).toUpperCase() || '?')}</b>`;
  return `<span class="av${img ? ' pic' : ''}" style="--s:${size}px;--c:${c.hex}">${inner}</span>`;
}

function die(face, cls = '', attrs = '', tag = 'div') {
  const pips = Array.from({ length: 9 }, (_, i) => `<i${PIPS[face].includes(i) ? ' class="on"' : ''}></i>`).join('');
  return `<${tag} class="die ${cls}" aria-label="${face}" ${attrs}>${pips}</${tag}>`;
}

function setFace(el, face) {
  el.querySelectorAll('i').forEach((pip, k) => pip.classList.toggle('on', PIPS[face].includes(k)));
  el.setAttribute('aria-label', String(face));
}

/* ---------- rendering ---------- */

function render() {
  app.innerHTML = ({ setup: setupView, online: onlineView, lobby: lobbyView, game: gameView }[ui.screen])() + connBanner() + modalView() + peekView() + reactView();
  const cv = document.getElementById('avcv');
  if (cv && ui.ed) paintCanvas(cv, ui.ed.sk);
  positionPeek();
  watchRooms();
}

function connBanner() {
  if (!ui.online || ui.conn === 'online') return '';
  return ui.conn === 'lost'
    ? '<div class="conn lost" role="alert">Connection lost. <button data-act="retryConn">Retry</button></div>'
    : '<div class="conn" role="status">Reconnecting…</div>';
}

const KINDS = [['human', 'Human'], ['easy', 'Easy'], ['normal', 'Normal'], ['hard', 'Hard']];
const kindOf = (p) => (p.cpu ? (E.LEVEL_NAMES.includes(p.level) ? p.level : 'normal') : 'human');

const LOGO = `<svg class="logo" viewBox="0 0 120 120" aria-hidden="true">
  <g transform="rotate(-14 42 44)"><rect x="12" y="14" width="56" height="56" rx="13" fill="#fff8e7"/><g fill="#e5484d"><circle cx="27" cy="29" r="5.5"/><circle cx="53" cy="55" r="5.5"/><circle cx="40" cy="42" r="5.5"/></g></g>
  <g transform="rotate(12 80 80)"><rect x="52" y="52" width="56" height="56" rx="13" fill="#3b82f6"/><g fill="#fff"><circle cx="67" cy="67" r="5.5"/><circle cx="93" cy="67" r="5.5"/><circle cx="67" cy="93" r="5.5"/><circle cx="93" cy="93" r="5.5"/></g></g>
</svg>`;

/** What a new game plays to, and how many dice each player owns; kept on the device. */
function loadSettings() {
  let saved = {};
  try { saved = JSON.parse(store.get('rfi-settings')) || {}; } catch { /* nothing saved */ }
  return E.cleanSettings(saved);
}

/** The two choices as sliding switches. `act` is the action to run with data-k=value. */
function settingsPanel(current, act, enabled) {
  const row = (label, key, values) => `<div class="setrow"><span>${label}</span>
    <div class="seg" role="group" aria-label="${label}" style="grid-template-columns:repeat(${values.length},1fr)">
      ${values.map((v) => `<button class="${current[key] === v ? 'on' : ''}" data-act="${act}" data-key="${key}" data-v="${v}" aria-pressed="${current[key] === v}" ${enabled ? '' : 'disabled'}>${v}</button>`).join('')}
    </div></div>`;
  return `<section class="panel settings" aria-label="Game settings">
    <h2>Game settings</h2>
    ${row('Play to', 'target', E.SETTINGS.targets)}
    ${row('Dice each', 'dice', E.SETTINGS.dice)}
  </section>`;
}

/** Two games in one app: the original, and the one with power cards. */
function modePicker(enabled) {
  return `<div class="modes" role="group" aria-label="Game">
    ${E.MODES.map((m) => `<button class="${ui.mode === m ? 'on' : ''}" data-act="setMode" data-m="${m}" aria-pressed="${ui.mode === m}" ${enabled ? '' : 'disabled'}>${m === 'extreme' ? '⚡ ' : ''}${modeLabel(m)}</button>`).join('')}
  </div>`;
}

/** Small line icons for the buttons along the bottom of the start screen. */
const ICONS = {
  help: '<circle cx="12" cy="12" r="9"/><path d="M9.6 9.4a2.5 2.5 0 1 1 3.5 2.3c-.8.4-1.1.9-1.1 1.8"/><circle cx="12" cy="17" r=".6" fill="currentColor"/>',
  cap: '<path d="M2.5 9.5 12 5l9.5 4.5L12 14 2.5 9.5Z"/><path d="M6.5 11.7v4.2c0 1.3 2.5 2.6 5.5 2.6s5.5-1.3 5.5-2.6v-4.2"/><path d="M21.5 9.5v5"/>',
  palette: '<path d="M12 3a9 9 0 1 0 0 18c1.2 0 1.8-.8 1.8-1.7 0-1.2-1-1.4-1-2.5 0-1 .8-1.6 1.9-1.6H17a4 4 0 0 0 4-4C21 6.7 17 3 12 3Z"/><circle cx="7.5" cy="11" r="1.1" fill="currentColor"/><circle cx="10.5" cy="7.2" r="1.1" fill="currentColor"/><circle cx="15.2" cy="7.5" r="1.1" fill="currentColor"/>',
  soundOn: '<path d="M4 9.5v5h3.5L12.5 19V5L7.5 9.5H4Z"/><path d="M16 9a4.2 4.2 0 0 1 0 6"/><path d="M18.6 6.5a8 8 0 0 1 0 11"/>',
  soundOff: '<path d="M4 9.5v5h3.5L12.5 19V5L7.5 9.5H4Z"/><path d="m16.5 9.5 5 5"/><path d="m21.5 9.5-5 5"/>',
  info: '<circle cx="12" cy="12" r="9"/><path d="M12 11v5.5"/><circle cx="12" cy="7.8" r=".6" fill="currentColor"/>',
};
const iconBtn = (act, icon, label) => `<button class="iconbtn" data-act="${act}" aria-label="${label}" title="${label}"><svg viewBox="0 0 24 24" width="24" height="24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${ICONS[icon]}</svg></button>`;

function setupView() {
  const rows = ui.setup.map((p, i) => `
    <div class="prow">
      <button class="avbtn" data-act="editPlayer" data-i="${i}" aria-label="Customize ${esc(p.name)}">${avatarHtml(p, i, 48)}</button>
      <div class="pmain">
        <input data-name="${i}" value="${esc(p.name)}" maxlength="12" aria-label="Player ${i + 1} name">
        <div class="seg" role="group" aria-label="${esc(p.name)} is">
          ${KINDS.map(([k, label]) => `<button class="${kindOf(p) === k ? 'on' : ''}" data-act="setKind" data-i="${i}" data-k="${k}" aria-pressed="${kindOf(p) === k}">${label}</button>`).join('')}
        </div>
      </div>
      ${ui.setup.length > 2 ? `<button class="x" data-act="removePlayer" data-i="${i}" aria-label="Remove ${esc(p.name)}">✕</button>` : ''}
    </div>`).join('');
  const saved = net.store && savedSession();
  return `
    <div class="setup">
      <header class="hero">${LOGO}<h1>Rollick</h1><p class="tag">${modeBlurb(ui.mode, ui.settings.target)}</p></header>
      ${store.get('rfi-tutorial') ? '' : '<button class="btn learn" data-act="startTutorial">🎓 New here? Learn to play in a minute</button>'}
      ${modePicker(true)}
      ${saved ? `<button class="btn resume" data-act="resume">Return to room ${esc(saved.code)}</button>` : ''}
      <section class="panel" aria-label="Players">
        <h2>Players</h2>
        ${rows}
        ${ui.setup.length < MAX_PLAYERS ? '<button class="add" data-act="addPlayer">+ Add player</button>' : ''}
      </section>
      ${settingsPanel(ui.settings, 'setSetting', true)}
      <button class="btn primary big" data-act="start">Start game</button>
      ${net.store ? '<button class="btn" data-act="goOnline">Play online with friends</button>' : ''}
      <nav class="iconbar" aria-label="More">
        ${iconBtn('rules', 'help', 'How to play')}
        ${iconBtn('startTutorial', 'cap', 'Tutorial')}
        ${iconBtn('themes', 'palette', 'Themes')}
        ${iconBtn('toggleSound', soundPrefs.sound ? 'soundOn' : 'soundOff', soundPrefs.sound ? 'Sound on' : 'Sound off')}
        ${iconBtn('about', 'info', 'About and terms')}
      </nav>
    </div>`;
}

/* ---------- the public room list ---------- */

function roomsHtml() {
  const { state, list } = ui.rooms;
  if (state === 'down') return '<p class="tag">Could not reach the room list. You can still join with a code.</p>';
  if (state !== 'ready') return '<p class="tag">Looking for open rooms…</p>';
  if (!list.length) return '<p class="tag">No open rooms right now. Make one and switch on <b>Public room</b> to let others find it.</p>';
  return list.slice(0, 20).map((r) => `<div class="rrow"><span class="rm" aria-hidden="true">${r.mode === 'extreme' ? '⚡' : '🎲'}</span>
    <div class="rinfo"><b>${esc(r.host)}</b><small>${modeLabel(r.mode)} · ${r.n}/${r.max} players</small></div>
    <button class="btn small" data-act="joinListed" data-code="${r.code}" ${net.busy ? 'disabled' : ''}>Join</button></div>`).join('');
}

const paintRooms = () => { const el = document.getElementById('rooms'); if (el) el.innerHTML = roomsHtml(); };

/** Watch the list only while the online screen is showing. */
function watchRooms() {
  const want = ui.screen === 'online' && net.store?.kind === 'p2p';
  if (want && !net.list) {
    ui.rooms = { state: 'connecting', list: [] };
    net.list = lobbyList(window.RFI_RELAY_BROKERS ?? DEFAULT_BROKERS, (list) => { ui.rooms.list = list; paintRooms(); }, (up) => { ui.rooms.state = up ? 'ready' : 'down'; paintRooms(); });
  } else if (!want && net.list) {
    net.list.close();
    net.list = null;
  }
}

/** A host who made the room public keeps it on the list, as long as it is in the lobby with a free seat. */
function syncDirectory(room) {
  const open = isHost() && net.store?.kind === 'p2p' && room?.public && room.status === 'lobby' && room.seats.length < MAX_PLAYERS;
  if (open) {
    net.dir ||= lobbyAnnouncer(window.RFI_RELAY_BROKERS ?? DEFAULT_BROKERS);
    const me = room.seats.find((p) => p.uid === room.hostUid);
    net.dir.announce({ code: room.code, host: me?.name || 'Player', mode: room.mode === 'extreme' ? 'extreme' : 'classic', n: room.seats.length, max: MAX_PLAYERS });
  } else if (net.dir) {
    net.dir.withdraw();
  }
}

/* ---------- emoji ---------- */

/** Reactions need a live online game, a seat at the table and a connection that can carry them. */
const canReact = () => ui.online && ui.screen === 'game' && net.mySeat >= 0 && typeof net.ref?.react === 'function';

function reactView() {
  if (!ui.react || !canReact()) return '';
  return `<div class="reactbar" role="dialog" aria-label="Send an emoji">${REACTIONS.map((e) => `<button data-act="sendReact" data-e="${e}" aria-label="Send ${e}">${e}</button>`).join('')}<button class="x" data-act="closeReact" aria-label="Close">✕</button></div>`;
}

/** An emoji floats up from the sender's name for a moment. */
function showReaction(seat, emoji) {
  if (ui.screen !== 'game' || !REACTIONS.includes(emoji)) return;
  const chip = app.querySelector(`.chip[data-p="${seat}"]`);
  if (!chip) return;
  const r = chip.getBoundingClientRect();
  const bubble = Object.assign(document.createElement('div'), { className: 'rbubble', textContent: emoji });
  bubble.style.left = `${r.left + r.width / 2}px`;
  bubble.style.top = `${r.bottom - 6}px`;
  document.body.appendChild(bubble);
  setTimeout(() => bubble.remove(), 1900);
  sfx.react();
}

function onlineView() {
  return `
    <div class="setup">
      <header class="hero">${LOGO}<h1>Play online</h1><p class="tag">Make a room and share the code, or join a friend's.</p></header>
      <section class="panel" aria-label="You">
        <h2>You</h2>
        <div class="prow">
          <button class="avbtn" data-act="editProfile" aria-label="Customize your player">${avatarHtml(profile, 0, 48)}</button>
          <div class="pmain"><input id="myname" value="${esc(profile.name)}" maxlength="12" placeholder="Your name" aria-label="Your name"></div>
        </div>
      </section>
      ${ui.onlineError ? `<p class="notice" role="alert">${esc(ui.onlineError)}</p>` : ''}
      <button class="btn primary big" data-act="createRoom" ${net.busy ? 'disabled' : ''}>${net.busy ? 'Connecting…' : 'Create room'}</button>
      <section class="panel" aria-label="Join a room">
        <h2>Join a room</h2>
        <div class="joinrow">
          <input id="joincode" class="codein" value="${esc(ui.joinCode)}" maxlength="4" placeholder="CODE" autocapitalize="characters" autocomplete="off" aria-label="Room code">
          <button class="btn" data-act="joinRoom" ${net.busy ? 'disabled' : ''}>Join</button>
        </div>
      </section>
      ${net.store?.kind === 'p2p' ? `<section class="panel" aria-label="Open rooms">
        <h2>Open rooms</h2>
        <div id="rooms">${roomsHtml()}</div>
      </section>` : ''}
      ${net.store?.kind === 'p2p' ? `<div class="nettest">
        <button class="btn" data-act="testNet" ${ui.netTest === 'running' ? 'disabled' : ''}>${ui.netTest === 'running' ? 'Checking…' : 'Test my connection'}</button>
        ${ui.netTest && ui.netTest !== 'running' ? `<p class="notice ${ui.netTest.startsWith('Good') ? 'ok' : ''}">${esc(ui.netTest)}</p>` : ''}
      </div>` : ''}
      <nav class="links"><button data-act="toSetup">Back</button></nav>
    </div>`;
}

function lobbyView() {
  const room = net.room;
  if (!room) return '<div class="setup"><p class="tag">Connecting…</p></div>';
  const host = isHost();
  const rows = room.seats.map((p, i) => {
    const cpu = p.cpu;
    const tags = [i === net.mySeat ? 'You' : '', p.uid === room.hostUid ? 'Host' : ''].filter(Boolean).map((t) => `<small class="tagpill">${t}</small>`).join('');
    const kind = cpu ? (E.LEVEL_NAMES.includes(p.level) ? p.level : 'normal') : '';
    return `
    <div class="prow">
      ${i === net.mySeat
        ? `<button class="avbtn" data-act="editMe" aria-label="Customize your player">${avatarHtml(p, i, 48)}</button>`
        : avatarHtml(p, i, 48)}
      <div class="pmain">
        <div class="pname">${esc(p.name)} ${tags}</div>
        ${cpu && host
          ? `<div class="seg three" role="group" aria-label="${esc(p.name)} difficulty">${E.LEVEL_NAMES.map((k) => `<button class="${kind === k ? 'on' : ''}" data-act="setSeatLevel" data-i="${i}" data-k="${k}" aria-pressed="${kind === k}">${levelLabel(k)}</button>`).join('')}</div>`
          : `<div class="pmeta">${cpu ? `CPU · ${levelLabel(p.level)}` : i === net.mySeat ? 'Tap your face to change icon and colour' : 'Player'}</div>`}
      </div>
      ${host && cpu ? `<button class="x" data-act="removeSeat" data-i="${i}" aria-label="Remove ${esc(p.name)}">✕</button>` : ''}
      ${host && !cpu && p.uid !== room.hostUid ? `<button class="x" data-act="kickSeat" data-i="${i}" aria-label="Remove ${esc(p.name)} from the room" title="Remove from the room">✕</button>` : ''}
    </div>`;
  }).join('');
  return `
    <div class="setup">
      <header class="hero">${LOGO}<p class="tag">Room code</p><h1 class="code">${esc(room.code)}</h1></header>
      ${host ? modePicker(true).replace(/data-act="setMode"/g, 'data-act="setRoomMode"') : `<p class="tag center">Game: <b>${modeLabel(room.mode)}</b></p>`}
      <div class="invitebar"><button class="btn" data-act="invite">Invite friends</button>${canShowQr() ? '<button class="btn" data-act="showQr" aria-label="Show QR code" title="Show QR code">▦ QR</button>' : ''}</div>
      ${host && net.store?.kind === 'p2p' ? `<button class="btn togglerow ${room.public ? 'on' : ''}" data-act="togglePublic" aria-pressed="${!!room.public}">
        <span>🌐 Public room</span><small>${room.public ? 'Anyone can find and join this room from the Open rooms list' : 'Only people with the code can join'}</small></button>` : ''}
      ${host ? settingsPanel(E.cleanSettings(room.settings || ui.settings), 'setRoomSetting', true) : `<p class="tag center">Play to <b>${E.cleanSettings(room.settings).target}</b> · <b>${E.cleanSettings(room.settings).dice}</b> dice each</p>`}
      <section class="panel" aria-label="Players">
        <h2>Players · ${room.seats.length} of ${MAX_PLAYERS}</h2>
        ${rows}
        ${host && room.seats.length < MAX_PLAYERS ? '<button class="add" data-act="addSeatCpu">+ Add CPU player</button>' : ''}
      </section>
      ${host
        ? `<button class="btn primary big" data-act="startOnline" ${room.seats.length < 2 ? 'disabled' : ''}>${room.seats.length < 2 ? 'Waiting for players…' : 'Start game'}</button>`
        : '<p class="tag center">Waiting for the host to start…</p>'}
      <nav class="links"><button data-act="toSetup">Leave room</button></nav>
    </div>`;
}

const turnFraction = () => Math.max(0, Math.min(1, (ui.turnEnds - Date.now()) / TURN_MS)).toFixed(3);

/** What just happened with the power cards and chaos rules, in a sentence. */
function eventsText(s) {
  const who = (p) => s.players[p].name;
  return (Array.isArray(s.events) ? s.events : []).map((e) => {
    const pw = E.POWERS[e?.kind] || { icon: '', name: 'a card' };
    if (!s.players[e?.player] && e?.type !== 'chaos') return '';
    if (e.type === 'lucky') return `${who(e.player)} rolled three of a kind and won ${pw.icon} ${pw.name}!`;
    if (e.type === 'earned') return `${who(e.player)} earned ${pw.icon} ${pw.name}.`;
    if (e.type === 'power') return `${who(e.player)} played ${pw.icon} ${pw.name}${e.target !== undefined ? ` on ${who(e.target)}` : ''}.`;
    if (e.type === 'skipped') return `${who(e.player)} misses a turn.`;
    if (e.type === 'chaos') return e.kind === 'double' ? '⚡ Double points this round!' : '⚡ Chaos! Every die goes home.';
    return '';
  }).filter(Boolean).join(' ');
}

/** The power-card sheet: your cards, and the little steps to play one. */
function powersView() {
  const s = ui.game;
  const holder = ui.online ? net.mySeat : s.current;
  if (!s || s.mode !== 'extreme' || holder < 0) return '';
  const hand = Array.isArray(s.players[holder].powers) ? s.players[holder].powers.filter((k) => E.POWERS[k]) : [];
  const myTurn = canAct() && s.phase === 'placing' && holder === s.current;
  const pw = ui.power;
  const close = '<button class="btn primary" data-act="closeModal">Close</button>';
  let body;
  if (pw && (pw.kind === 'reroll' || (pw.kind === 'set' && pw.rolled === undefined))) {
    body = `<h2>${E.POWERS[pw.kind].icon} ${E.POWERS[pw.kind].name}</h2><p>Pick a die.</p>
      <div class="pickrow">${s.rolled.map((f, i) => die(f, 'owned', `style="${diceVars(seats()[holder], holder)}" data-act="powerDie" data-i="${i}" role="button" tabindex="0"`)).join('')}</div>
      <button class="btn" data-act="powerBack">Back</button>`;
  } else if (pw?.kind === 'set') {
    body = `<h2>${E.POWERS.set.icon} ${E.POWERS.set.name}</h2><p>Turn the ${s.rolled[pw.rolled]} into…</p>
      <div class="pickrow">${[1, 2, 3, 4, 5, 6].filter((f) => f !== s.rolled[pw.rolled]).map((f) => die(f, 'owned', `style="${diceVars(seats()[holder], holder)}" data-act="powerFace" data-f="${f}" role="button" tabindex="0"`)).join('')}</div>
      <button class="btn" data-act="powerBack">Back</button>`;
  } else if (pw?.kind === 'knock') {
    const rows = [];
    s.cards.forEach((c, ci) => s.players.forEach((pl, p) => {
      if (p !== holder && c.placed[p].length) rows.push(`<button class="btn target" data-act="powerKnock" data-card="${ci}" data-p="${p}">${avatarHtml(seats()[p], p, 26)}<span>${esc(pl.name)}: ${c.placed[p].length} on the ${c.points}-point card</span></button>`);
    }));
    body = `<h2>${E.POWERS.knock.icon} ${E.POWERS.knock.name}</h2><p>Remove one die from a rival.</p>${rows.join('') || '<p class="none">Nobody has dice on a card.</p>'}<button class="btn" data-act="powerBack">Back</button>`;
  } else {
    const list = hand.length
      ? hand.map((k) => {
        const info = E.POWERS[k];
        const ok = myTurn && (k === 'bonus' || k === 'skip' ? !E.powerProblem(s, k) : E.powerMoves(s).some((m) => m.kind === k));
        return `<div class="pcard"><span class="pi">${info.icon}</span><div><b>${info.name}</b><small>${info.text}</small></div><button class="btn small" data-act="playPower" data-k="${k}" ${ok ? '' : 'disabled'}>Play</button></div>`;
      }).join('')
      : '<p class="none">You have no power cards. Claim a card worth 7 or more points, or roll three of a kind, to win one.</p>';
    const others = s.players.map((pl, p) => ({ pl, p })).filter(({ p }) => p !== holder && s.players[p].powers.length)
      .map(({ pl, p }) => `<div class="orow">${avatarHtml(seats()[p], p, 22)}<span>${esc(pl.name)}</span><b>⚡ ${pl.powers.length}</b></div>`).join('');
    body = `<h2>⚡ Power cards</h2>
      ${myTurn ? '<p class="tag">Play cards during your turn, after you roll.</p>' : '<p class="tag">You can play these on your own turn, after you roll.</p>'}
      ${list}
      ${others ? `<div class="sum"><div class="sumh">Rivals hold</div>${others}</div>` : ''}${close}`;
  }
  return `<div class="modal"><div class="sheet powers">${body}</div></div>`;
}

/** Pick the table colour, the back of the deck and the dice. Changes show straight away. */
function themesView() {
  const opt = (part, id, label, preview) => {
    const open = isUnlocked(part, id);
    return `<button class="opt ${theme[part] === id ? 'on' : ''} ${open ? '' : 'locked'}" data-act="setTheme" data-part="${part}" data-id="${id}" aria-pressed="${theme[part] === id}" ${open ? '' : `aria-label="${label}, locked. ${requirementText(part, id)}"`}>
      ${preview}<span>${label}</span>${open ? '' : `<small class="need">🔒 ${requirementText(part, id)}</small>`}</button>`;
  };
  return `<div class="modal"><div class="sheet themes"><h2>🎨 Themes</h2>
    <p class="statline">${stats.games} games · ${stats.wins} wins · best streak ${stats.bestStreak} · ${stats.claims} cards claimed</p>
    <h3>Table</h3><div class="opts">${TABLES.map((x) => opt('table', x.id, x.name, `<span class="tb" data-tb="${x.id}"></span>`)).join('')}</div>
    <h3>Deck back</h3><div class="opts">${BACKS.map((x) => opt('back', x.id, x.name, `<span class="bk" data-bk="${x.id}"></span>`)).join('')}</div>
    <h3>Dice</h3><div class="opts">${DICE.map((x) => opt('dice', x.id, x.name, `<span class="dpv" data-ds="${x.id}">${die(5, '')}</span>`)).join('')}</div>
    <p class="tag">Play games to unlock more looks.</p>
    <button class="btn primary" data-act="closeModal">Done</button></div></div>`;
}

function statusText(s) {
  const cur = s.players[s.current];
  const deck = s.deck.length ? ` <small>· ${s.deck.length} cards left</small>` : '';
  if (s.phase === 'over') return wins(s.players[s.winner].name);
  if (ui.rolling) return `${esc(cur.name)} rolls…`;
  if (cur.cpu) return `${esc(cur.name)} is thinking…${deck}`;
  if (ui.online && s.current !== net.mySeat) return (net.mySeat < 0 ? `Watching ${esc(cur.name)}…` : `${esc(cur.name)} is playing…`) + deck;
  if (s.phase === 'start') {
    return (E.handSize(s, s.current) === 0 ? 'All your dice are on cards. Take them back.' : `${esc(cur.name)}: roll your ${E.handSize(s, s.current)} dice`) + deck;
  }
  if (!s.rolled.length) return 'All dice placed';
  if (!E.legalMoves(s).length) return 'No matches this time';
  return ui.selected === null ? 'Tap a die, then the card it fits' : 'Tap a highlighted card';
}

/** A staggered pile of the cards a player has claimed, with their points showing. */
function pileHtml(pile = []) {
  if (!pile.length) return '<span class="pile blank" aria-hidden="true"></span>';
  const shown = pile.slice(-6);
  const more = pile.length - shown.length;
  return `<span class="pile" aria-label="${pile.length} cards claimed">${more ? `<em>+${more}</em>` : ''}${shown.map((pts, k) => `<i data-tier="${tierOf(pts)}" style="--n:${k}">${pts}</i>`).join('')}</span>`;
}

const tierOf = (points) => (points >= 13 ? 4 : points >= 9 ? 3 : points >= 5 ? 2 : 1);

/** A die on a card takes the colour of whoever covers it; several players split it into slices. */
const ownedClass = (owners) => (owners.length === 0 ? 'ghost' : owners.length === 1 ? 'owned' : 'owned shared');
function ownedStyle(owners, s) {
  if (!owners.length) return '';
  const seat = (p) => swatch(seats()[p], p);
  if (owners.length === 1) return `--c:${seat(owners[0]).hex};--pc:${seat(owners[0]).pip}`;
  const shown = owners.slice(0, 4); // a die is only so big
  const step = 100 / shown.length;
  const slices = shown.map((p, k) => `${seat(p).hex} ${(k * step).toFixed(1)}% ${((k + 1) * step).toFixed(1)}%`).join(', ');
  return `--c:${seat(shown[0]).hex};--bg:conic-gradient(${slices});--pc:#fff`;
}

/** For each die a card needs, the players covering it, in seat order. */
function slotOwners(s, card) {
  const used = new Map(); // per player, how many of each face already counted
  return card.need.map((face) => s.players.map((_, p) => p).filter((p) => {
    const key = `${p}:${face}`;
    const c = used.get(key) || 0;
    const has = card.placed[p].filter((f) => f === face).length;
    used.set(key, c + 1);
    return has > c;
  }));
}

const nameList = (s, ps) => ps.map((p) => s.players[p].name).join(', ');

function cardView(s, card, ci) {
  const accepts = ui.selected !== null && E.canPlace(s, ui.selected, ci);
  const n = card.need.length;
  // [dice per row, die size in % of card width]; sized so the block fits between the two corner numbers.
  const [cols, dz] = { 1: [1, 50], 2: [2, 40], 3: [3, 26], 4: [2, 40], 5: [3, 26] }[n] || [3, 24];
  const per = slotOwners(s, card);
  const slots = card.need.map((face, si) => {
    const owners = per[si];
    const peeked = ui.peek && ui.peek.card === ci && ui.peek.slot === si ? ' peeked' : '';
    const who = owners.length ? `covered by ${nameList(s, owners)}` : 'not covered yet';
    const badge = owners.length > 1 ? `<span class="badge" aria-hidden="true">${owners.length}</span>` : '';
    return `<button type="button" class="slot${peeked}" data-act="peek" data-card="${ci}" data-slot="${si}" data-o="${owners.length}" aria-label="Die ${face}, ${esc(who)}">
      <span class="dwrap">${die(face, ownedClass(owners), `style="${ownedStyle(owners, s)}"`)}${badge}</span></button>`;
  }).join('');
  return `<div class="gcard ${accepts ? 'accepts' : ''} ${ui.hint?.card === ci ? 'hinted' : ''}" data-tier="${tierOf(card.points)}" data-act="pickCard" data-card="${ci}" role="group" aria-label="${card.points} point card">
    <div class="corner tl"><b>${card.points}</b></div>
    <div class="face" style="--fc:${cols};--dz:${dz}">${slots}</div>
    <div class="corner br"><b>${card.points}</b></div>
  </div>`;
}

function gameView() {
  const s = ui.game;
  const human = isMine(s);
  const mine = seats()[s.current];
  const chips = s.players.map((p, i) => `
    <div class="chip ${i === s.current && s.phase !== 'over' ? 'active' : ''}" data-p="${i}" style="--c:${hexOf(i)}" ${canReact() ? 'data-act="reactMenu" role="button" tabindex="0" aria-label="Send an emoji"' : ''}>
      ${avatarHtml(seats()[i], i, 28)}
      <span class="meta"><span class="n">${esc(p.name)}${ui.online && i === net.mySeat ? ' (you)' : ''}</span><span class="s"><b class="num">${p.score}</b><small> / ${E.targetOf(s)}</small></span></span>
      ${pileHtml(p.pile)}
    </div>`).join('');

  let tray;
  let live = 0; // dice shown in the tray; the rest of the six are on cards
  if (s.phase === 'placing') {
    tray = s.rolled.map((f, i) => {
      const fx = ui.fx[i] || { delay: 0, dur: 0, dx: 0, rot: 0 };
      const spinning = ui.rolling && fx.dur > 0;
      const style = `${diceVars(mine, s.current)};--d:${fx.delay}ms;--dur:${fx.dur}ms;--dx:${fx.dx}px;--rot:${fx.rot}deg`;
      const face = spinning ? 1 + Math.floor(Math.random() * 6) : f;
      return die(face, `owned ${spinning ? 'rolling' : ''} ${ui.selected === i ? 'sel' : ''} ${ui.hint?.rolled === i ? 'hinted' : ''}`,
        `style="${style}" data-i="${i}" ${human && !ui.rolling ? `data-act="pickRolled" role="button" tabindex="0"` : 'aria-disabled="true"'}`);
    }).join('');
    live = s.rolled.length;
  } else {
    live = E.handSize(s, s.current);
    tray = Array.from({ length: live }, () => die(1, 'owned hand', `style="${diceVars(mine, s.current)}"`)).join('').replace(/aria-label="1"/g, 'aria-label="die in hand"');
  }
  // Always six places, so the tray (and with it the whole table) never changes height from turn to turn.
  tray += Array.from({ length: Math.max(0, E.diceOf(s) - live) }, () => `<div class="die empty" aria-label="die on a card">${'<i></i>'.repeat(9)}</div>`).join('');
  const onCards = E.diceOf(s) - E.handSize(s, s.current);
  const canTakeBack = human && s.phase === 'start' && onCards > 0;
  const mustTakeBack = canTakeBack && onCards === E.diceOf(s);
  const canRoll = human && s.phase === 'start' && E.handSize(s, s.current) > 0;
  const canEnd = human && s.phase === 'placing' && !ui.rolling;
  const noMoves = canEnd && !E.legalMoves(s).length;
  const extreme = s.mode === 'extreme';
  const holder = ui.online ? net.mySeat : s.current; // whose power cards the bolt button shows
  const held = extreme && holder >= 0 && Array.isArray(s.players[holder].powers) ? s.players[holder].powers.length : 0;
  const timed = extreme && human && s.phase !== 'over';

  return `
    <div class="game">
    <div class="table">
    <div class="score" data-rows="${Math.ceil(s.players.length / 4) > 1 ? 2 : 1}" style="--per:${Math.ceil(s.players.length / Math.ceil(s.players.length / 4))}">${chips}</div>
    ${ui.tut ? coachView() : `<div class="status"><span>${statusText(s)}</span></div>`}
    <div class="cards"><div class="cardgrid" data-n="${s.cards.length}">${s.cards.map((c, i) => cardView(s, c, i)).join('')}<div class="deckback ${extreme && s.chaos?.kind === 'double' ? 'x2on' : ''}" data-bk="${theme.back}" aria-hidden="true"><b>${s.deck.length}</b><span>left</span>${extreme && s.chaos?.kind === 'double' ? '<em class="x2">×2</em>' : ''}</div></div></div>
    </div>
    <div class="tray">
      ${timed ? `<div class="turnbar" style="--p:${turnFraction()}" aria-hidden="true"><i></i></div>` : ''}
      <div class="dice">${tray}</div>
      <div class="actions">
        ${s.phase === 'start' ? `
          <button class="btn primary ${canRoll ? 'pulse' : ''} ${ui.hint?.button === 'roll' ? 'hinted' : ''}" data-act="roll" ${canRoll ? '' : 'disabled'}>Roll</button>
          <button class="btn ${mustTakeBack ? 'primary pulse' : ''} ${ui.hint?.button === 'takeback' ? 'hinted' : ''}" data-act="takeBack" ${canTakeBack ? '' : 'disabled'} aria-label="Take back all your dice and roll all six">Take back<small>&amp; roll all</small></button>`
          : `<button class="btn ${noMoves ? 'primary pulse' : ''} ${ui.hint?.button === 'end' ? 'hinted' : ''}" data-act="end" ${canEnd ? '' : 'disabled'}>End turn</button>
          ${human && ui.undo.length ? '<button class="btn icon" data-act="undo" aria-label="Undo last placement" title="Undo">↶</button>' : ''}`}
        ${extreme ? `<button class="btn icon bolt" data-act="powers" aria-label="Power cards (${held})" title="Power cards" ${holder >= 0 ? '' : 'disabled'}>⚡${held ? `<span class="count">${held}</span>` : ''}</button>` : ''}
        <button class="btn icon" data-act="hint" aria-label="Hint" title="Hint" ${human && !ui.rolling ? '' : 'disabled'}>💡</button>
        <button class="btn icon" data-act="menu" aria-label="Menu">☰</button>
      </div>
    </div>
    </div>`;
}

/** Who covers the tapped die, and how far along each player is on this card. It follows the live game. */
function peekView() {
  const pk = ui.peek;
  const s = ui.game;
  const card = pk && s?.cards[pk.card];
  if (!card || card.id !== pk.id) { ui.peek = null; return ''; } // the card was claimed or replaced
  const owners = slotOwners(s, card)[pk.slot] || [];
  const face = card.need[pk.slot];
  const row = (p, extra = '') => `<div class="orow">${avatarHtml(seats()[p], p, 26)}<span>${esc(s.players[p].name)}${ui.online && p === net.mySeat ? ' <small>(you)</small>' : ''}</span>${extra}</div>`;
  const who = owners.length ? owners.map((p) => row(p)).join('') : '<div class="none">Nobody has this die yet.</div>';
  const total = card.need.length;
  const progress = s.players.map((pl, p) => ({ p, n: card.placed[p].length })).filter((x) => x.n > 0).sort((a, b) => b.n - a.n);
  const sum = progress.length
    ? `<div class="sum"><div class="sumh">On this card</div>${progress.map((x) => row(x.p, `<b>${x.n}/${total}</b>`)).join('')}</div>`
    : '';
  return `<div class="peek" role="dialog" aria-label="Who has this die">
    <h3>${die(face, 'ghost', 'style="--size:22px"')}<span>${card.points}-point card</span></h3>${who}${sum}</div>`;
}

/** Anchor the popover under (or above) the die it is about, wherever the layout has put it. */
function positionPeek() {
  const pop = app.querySelector('.peek');
  const slot = ui.peek && app.querySelector(`.slot[data-card="${ui.peek.card}"][data-slot="${ui.peek.slot}"]`);
  if (!pop || !slot) return;
  const r = slot.getBoundingClientRect();
  const width = Math.min(260, window.innerWidth - 16);
  const left = Math.max(8, Math.min(window.innerWidth - width - 8, r.left + r.width / 2 - width / 2));
  const room = window.innerHeight - (r.bottom + 8);
  pop.style.width = `${width}px`;
  pop.style.left = `${left}px`;
  if (room >= pop.offsetHeight || room >= r.top - 8) pop.style.top = `${r.bottom + 8}px`;
  else { pop.style.top = `${r.top - 8}px`; pop.style.transform = 'translateY(-100%)'; }
}

function editorView() {
  const ed = ui.ed;
  const taken = new Set(editorTaken());
  const ink = INK.map((hex) => `<button class="ink ${!ed.sk.erase && !ed.sk.stamp && ed.sk.ink === hex ? 'on' : ''}" style="--c:${hex}" data-act="ink" data-c="${hex}" aria-label="Ink ${hex}"></button>`).join('')
    + `<button class="ink eraser ${ed.sk.erase ? 'on' : ''}" data-act="eraser" aria-label="Eraser">⌫</button>`;
  const brushes = BRUSHES.map((w) => `<button class="brush ${ed.sk.width === w ? 'on' : ''}" data-act="brush" data-w="${w}" aria-label="Brush size ${w}"><i style="--w:${w}px"></i></button>`).join('');
  const stamps = STAMPS.map((g) => `<button class="stamp ${ed.sk.stamp === g ? 'on' : ''}" data-act="stamp" data-g="${g}" aria-label="Stamp ${g}">${g}</button>`).join('');
  const colors = PALETTE.map((c, i) => `<button class="swatch ${ed.color === i ? 'on' : ''}" style="--c:${c.hex}" data-act="pickColor" data-i="${i}" ${taken.has(i) ? 'disabled' : ''} aria-label="${c.name} dice${taken.has(i) ? ' (taken)' : ''}"></button>`).join('');
  return `<div class="modal"><div class="sheet editor"><h2>Your player</h2>
    <p class="note">Draw your icon with your finger. Your dice colour becomes its ring.</p>
    <div class="avwrap"><canvas id="avcv" width="${AVATAR_SIZE}" height="${AVATAR_SIZE}" aria-label="Drawing area"></canvas></div>
    <div class="tools">${ink}</div>
    <div class="tools"><span class="brushes">${brushes}</span><button class="btn small" data-act="clearArt">Clear</button></div>
    <p class="note">Or press a stamp. The size buttons change stamps too.</p>
    <div class="tools stamps">${stamps}</div>
    <p class="note">Dice colour. Each player needs a different one.</p>
    <div class="tools">${colors}</div>
    <div class="row2"><button class="btn" data-act="closeEditor">Cancel</button><button class="btn primary" data-act="saveEditor">Save</button></div>
  </div></div>`;
}

const lookName = ({ part, id }) => `${({ table: TABLES, back: BACKS, dice: DICE }[part].find((x) => x.id === id) || { name: id }).name} ${({ table: 'table', back: 'deck back', dice: 'dice' })[part]}`;
const unlockedLine = () => (ui.newUnlocks.length ? `<p class="unlock">🔓 Unlocked: ${ui.newUnlocks.map(lookName).join(', ')}. See 🎨 Themes.</p>` : '');

/** What the app was doing, without anything personal: for a problem report. */
const reportContext = () => ({
  Screen: ui.screen,
  Game: ui.game ? `${ui.game.mode}, ${ui.game.players.length} players, to ${E.targetOf(ui.game)}, ${E.diceOf(ui.game)} dice, phase ${ui.game.phase}` : 'none',
  Online: ui.online ? `${net.store?.kind || '?'} (${ui.conn})` : 'no',
});

function reportView() {
  const text = buildReport(ui.reportNote, reportContext());
  const mail = typeof window.RFI_FEEDBACK_EMAIL === 'string' && window.RFI_FEEDBACK_EMAIL.includes('@');
  const n = errorLog().length;
  return `<div class="modal"><div class="sheet report"><h2>Report a problem</h2>
    <p class="tag">Tell us what happened. The report holds your device and browser, what the app was doing, and the ${n} recent error${n === 1 ? '' : 's'} it noted. No names, room codes or drawings. Nothing is sent until you choose how.</p>
    <textarea id="reportnote" rows="3" maxlength="1000" placeholder="What went wrong? What were you doing?" aria-label="What happened">${esc(ui.reportNote)}</textarea>
    <details><summary>See the report</summary><pre>${esc(text)}</pre></details>
    ${navigator.share ? '<button class="btn primary" data-act="reportShare">Share…</button>' : ''}
    <button class="btn ${navigator.share ? '' : 'primary'}" data-act="reportCopy">Copy report</button>
    ${mail ? '<button class="btn" data-act="reportMail">Email it</button>' : ''}
    ${n ? '<button class="btn" data-act="reportClear">Clear the error log</button>' : ''}
    <button class="btn" data-act="about">Back</button></div></div>`;
}

/** The room as a QR code: a friend points their camera at it and the app opens with the code filled in. */
const canShowQr = () => net.store?.kind === 'p2p' && typeof window.qrcode === 'function' && !!net.room?.code;

function qrView() {
  if (!canShowQr()) return '';
  const code = net.room.code;
  const url = `${location.origin}${location.pathname}#${code}`;
  let svg = '';
  try {
    const q = window.qrcode(0, 'M'); // the smallest size that holds the address, with some error correction
    q.addData(url);
    q.make();
    svg = q.createSvgTag({ cellSize: 6, margin: 3, scalable: true });
  } catch { return ''; }
  return `<div class="modal"><div class="sheet qr"><h2>Scan to join</h2>
    <div class="qrbox" role="img" aria-label="QR code for room ${esc(code)}">${svg}</div>
    <p class="qrcode">${esc(code)}</p>
    <p class="tag">Point a phone's camera at this. It opens Rollick with the room code filled in.</p>
    <button class="btn primary" data-act="closeModal">Done</button></div></div>`;
}

function modalView() {
  if (ui.ed) return editorView();
  if (ui.screen === 'game' && ui.game?.phase === 'over') {
    const s = ui.game;
    const scores = s.players.map((p, i) => `<div class="srow">${avatarHtml(seats()[i], i, 24)}<span>${esc(p.name)}</span><b>${p.score}</b></div>`).join('');
    return `<div class="modal"><div class="sheet winner">
      <div class="trophy">${avatarHtml(seats()[s.winner], s.winner, 72)}</div><div class="big">${wins(s.players[s.winner].name)}</div><div class="scores">${scores}</div>
      ${unlockedLine()}
      ${ui.online && !isHost() ? '<p>Waiting for the host to start a rematch…</p>' : '<button class="btn primary" data-act="rematch">Play again</button>'}
      ${ui.online && isHost() ? '<button class="btn" data-act="toLobby">Back to lobby</button>' : ''}
      <button class="btn" data-act="toSetup">${ui.online ? 'Leave room' : 'Main menu'}</button></div></div>`;
  }
  if (ui.modal === 'rules') {
    return `<div class="modal" data-act="closeModal"><div class="sheet"><h2>How to play</h2>
      <p>Be the first to score <b>${ui.game ? E.targetOf(ui.game) : ui.settings.target} points</b> (rooms can change this). Cards are worth 2–15 points, and the harder a card is to finish, the more it's worth.</p>
      <ol>
        <li><b>Roll.</b> Roll all the dice in your hand (you own ${ui.game ? E.diceOf(ui.game) : ui.settings.dice}), once per turn.</li>
        <li><b>Place.</b> Tap a die, then a card that shows that number. Each die matches one picture on one card. Once placed, a die can't move. You may choose not to place a die; unplaced dice stay in your hand.</li>
        <li><b>Claim.</b> Cover every picture on a card with <i>your own</i> dice to score it. All dice on a scored card go back to their owners, and a new card is flipped. Leftover dice from your roll may go on the new card.</li>
        <li><b>Take Back:</b> at the start of your turn, before rolling, you may take back <b>all</b> your dice from the cards and roll all six.</li>
      </ol>
      <p>A die on a card is filled with the colour of the player covering it. If two or more players cover the same number, the die is split into slices of their colours and a number shows how many. <b>Tap any die on a card</b> to see who has it and how far along each player is on that card. Other players' dice can't score cards for you, but they can beat you to them!</p>
      <p>Play starts with a two-dice roll-off; 5+ players use two sets (60 cards) and four face-up cards.</p>
      <h3>⚡ Rollick Extreme</h3>
      <p>The same game with extra rules:</p>
      <ul>
        <li><b>Power cards.</b> Everyone starts with one and can hold three. Win another by claiming a card worth 7+ points or by rolling three of a kind. Play them on your turn after rolling: 🔄 Re-roll a die, 🎯 Set a die to any number, 💥 Knock a rival's die off a card, ⭐ Bonus +${E.BONUS_POINTS} on your next claim, ⏭️ Skip the next player.</li>
        <li><b>Chaos rounds.</b> Each new round can bring double points, or send every die back home.</li>
        <li><b>Turn timer.</b> You have a minute per turn. If it runs out, your turn is played for you.</li>
      </ul>
      <button class="btn primary" data-act="closeModal">Got it</button></div></div>`;
  }
  if (ui.modal === 'about') {
    return `<div class="modal"><div class="sheet legal"><h2>About Rollick</h2>
      <p>Rollick is an independent dice-and-cards game with its own card deck, art and rules. It is not affiliated with, or endorsed by, any other game or publisher.</p>
      <h3>Terms of use</h3>
      <ul>
        <li>Rollick is provided as is, for fun, with no warranty. We are not liable for lost games, dropped connections or any other loss from using it.</li>
        <li>Player names and drawn icons are shown to everyone in your game. Keep them kind and legal: no hateful, sexual, harassing or infringing content, and no impersonating others. Anyone who breaks this may be asked to leave by the room host.</li>
        <li>You are responsible for what you draw and type. Do not use anyone else's artwork or trademarks.</li>
        <li>Don't try to cheat, disrupt other players' games or attack the service.</li>
        <li>Public rooms can be joined by anyone who sees them. Hosts can remove players from their room, and you can leave at any time. Emoji and names are visible to everyone in the room, so keep them friendly.</li>
        <li>These terms may change. Continuing to use Rollick means you accept them.</li>
      </ul>
      <h3>Privacy</h3>
      <ul>
        <li>Rollick has no accounts, ads or analytics. Your name, icon, colour and settings are saved only on your device.</li>
        <li>Online games connect players directly (peer to peer) when they can. Your name, icon and moves are sent to the other players in your room. A signalling server and relay servers help devices find each other, and they can see network addresses and connection details while you play. The host also keeps a connection open to free public message servers, so players whose network blocks direct connections can still join. When that backup route is used, moves pass through those servers. Anyone who knows your room code could see that traffic, so don't share the code publicly and don't put private information in your name or icon. Opening the Play online screen connects to those servers to show the Open rooms list. If you switch on <b>Public room</b>, the room code, your name, the game and the player count are published on those servers so other people can find the room; switch it off and the listing is removed.</li>
        <li>If something breaks, Rollick keeps a short log of error messages on your device. Nothing is sent anywhere unless you choose Share, Copy or Email in <b>Report a problem</b>, and reports never include names, room codes or drawings.</li>
        <li>Clear the site data or remove the app to delete everything stored on your device.</li>
      </ul>
      <h3>Open-source notices</h3>
      <p>Online play uses <b>PeerJS</b> 1.5.4, released under the MIT licence. Copyright (c) 2015 Michelle Bu and Eric Zhang.</p>
      <p><small>Permission is hereby granted, free of charge, to any person obtaining a copy of this software and associated documentation files (the "Software"), to deal in the Software without restriction, including without limitation the rights to use, copy, modify, merge, publish, distribute, sublicense, and/or sell copies of the Software, and to permit persons to whom the Software is furnished to do so, subject to the following conditions: The above copyright notice and this permission notice shall be included in all copies or substantial portions of the Software. THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY, FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM, OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE SOFTWARE.</small></p>
      <p>Emoji stamps use your device's own emoji font.</p>
      <button class="btn" data-act="reportOpen">Report a problem</button>
      <button class="btn primary" data-act="closeModal">Close</button></div></div>`;
  }
  if (ui.modal === 'report') return reportView();
  if (ui.modal === 'qr') return qrView();
  if (ui.modal === 'powers') return powersView();
  if (ui.modal === 'themes') return themesView();
  if (ui.modal === 'menu') {
    return `<div class="modal" data-act="closeModal"><div class="sheet"><h2>Menu</h2>
      <button class="btn" data-act="rules">How to play</button>
      <button class="btn" data-act="about">About &amp; terms</button>
      ${canReact() ? '<button class="btn" data-act="reactMenu">😀 Send an emoji</button>' : ''}
      <button class="btn" data-act="themes">🎨 Themes</button>
      <button class="btn" data-act="toggleSound">${soundPrefs.sound ? '🔊 Sound: on' : '🔇 Sound: off'}</button>
      ${canVibrate() ? `<button class="btn" data-act="toggleHaptics">${soundPrefs.haptics ? '📳 Vibration: on' : '📴 Vibration: off'}</button>` : ''}
      ${ui.online && isHost() ? '<button class="btn" data-act="toLobby">Back to lobby</button>' : ''}
      ${ui.online && isHost() && ui.game?.phase !== 'over' && ui.game.current !== net.mySeat ? '<button class="btn" data-act="skipTurn">Skip current player</button>' : ''}
      ${ui.online ? '' : '<button class="btn" data-act="rematch">Restart game</button>'}
      <button class="btn" data-act="toSetup">${ui.online ? 'Leave room' : 'Main menu'}</button>
      <button class="btn primary" data-act="closeModal">Resume</button></div></div>`;
  }
  return '';
}

/* ---------- icon and colour editor ---------- */

/** Dice colours other players already use, for the editor being shown. */
function editorTaken() {
  const ed = ui.ed;
  if (ed.target === 'setup') return ui.setup.filter((_, i) => i !== ed.i).map((p) => p.color);
  if (ed.target === 'seat') return (net.room?.seats || []).filter((_, i) => i !== net.mySeat).map((p) => p.color);
  return [];
}

function openEditor(target, i, current) {
  const sk = makeSketch();
  ui.ed = { target, i, color: current.color, sk };
  loadAvatar(sk, current.avatar, () => { const cv = document.getElementById('avcv'); if (cv) paintCanvas(cv, sk); }, PALETTE[current.color % PALETTE.length].hex);
  render();
}

let stroke = null;
app.addEventListener('pointerdown', (e) => {
  if (e.target.id !== 'avcv' || !ui.ed) return;
  e.preventDefault();
  e.target.setPointerCapture?.(e.pointerId);
  if (ui.ed.sk.stamp) {
    stampAt(ui.ed.sk, pointOn(e.target, e));
    paintCanvas(e.target, ui.ed.sk);
    return;
  }
  stroke = pointOn(e.target, e);
  strokeSegment(ui.ed.sk, stroke, stroke);
  paintCanvas(e.target, ui.ed.sk);
});
app.addEventListener('pointermove', (e) => {
  if (!stroke || e.target.id !== 'avcv' || !ui.ed) return;
  const next = pointOn(e.target, e);
  strokeSegment(ui.ed.sk, stroke, next);
  stroke = next;
  paintCanvas(e.target, ui.ed.sk);
});
const endStroke = () => { stroke = null; };
app.addEventListener('pointerup', endStroke);
app.addEventListener('pointercancel', endStroke);

async function saveEditor() {
  const ed = ui.ed;
  const look = { color: ed.color, avatar: exportAvatar(ed.sk) };
  ui.ed = null;
  if (ed.target === 'setup') {
    Object.assign(ui.setup[ed.i], look);
    if (ui.setup[ed.i].me) { Object.assign(profile, look); saveProfile(); }
  } else if (ed.target === 'profile') {
    Object.assign(profile, look);
    saveProfile();
  } else if (ed.target === 'seat') {
    Object.assign(profile, look);
    saveProfile();
    await mutateRoom((room) => {
      const me = room.seats.find((p) => p.uid === net.uid);
      if (!me) return null;
      if (room.seats.some((p) => p !== me && p.color === look.color)) { say('That colour was just taken'); return null; }
      Object.assign(me, look);
      return room;
    });
  }
  render();
}

/* ---------- flow ---------- */

function say(text, ms = 1800) {
  toastEl.textContent = text;
  // Sit on the status line, which says much the same thing, so the toast never covers the dice or cards.
  const st = document.querySelector('.status');
  if (st) {
    const r = st.getBoundingClientRect();
    toastEl.style.top = `${Math.max(8, r.top - 8)}px`;
    toastEl.style.minWidth = `${Math.min(r.width, window.innerWidth - 16)}px`;
    toastEl.style.left = `${r.left + r.width / 2}px`;
  } else {
    toastEl.style.top = '80px';
    toastEl.style.left = '50%';
    toastEl.style.minWidth = '';
  }
  toastEl.hidden = false;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => { toastEl.hidden = true; }, ms);
}

const isMine = (s) => s.phase !== 'over' && (ui.online ? s.current === net.mySeat : !s.players[s.current].cpu);
const canAct = () => !!ui.game && !ui.rolling && ui.conn === 'online' && isMine(ui.game);

/** Start the tumbling animation: each die lands at its own time, faces cycling until then. */
/** Count a finished game for the stats, and note any looks it unlocked. Not for the tutorial or spectators. */
function countGame(g) {
  if (ui.tut || ui.recorded === g.gid) return;
  const me = ui.online ? net.mySeat : ui.cfg.findIndex((p) => p.me && !p.cpu); // your own row, unless you made it a computer player
  if (me < 0 || !g.players[me]) return;
  ui.recorded = g.gid;
  ui.newUnlocks = recordGame({ won: g.winner === me, claims: (g.players[me].pile || []).length, score: g.players[me].score, mode: g.mode, online: ui.online });
}

function startRoll(count) {
  sfx.roll(count);
  const quick = reducedMotion();
  ui.fx = Array.from({ length: count }, (_, i) => ({
    delay: quick ? 0 : i * 70 + Math.floor(Math.random() * 110),
    dur: quick ? 0 : 650 + Math.floor(Math.random() * 350),
    dx: Math.floor(Math.random() * 120) - 60,
    rot: (Math.random() < 0.5 ? -1 : 1) * (720 + 360 * Math.floor(Math.random() * 2)),
  }));
  const total = quick ? 150 : Math.max(...ui.fx.map((f) => f.delay + f.dur)) + 80;
  ui.rolling = true;
  clearInterval(rollClock);
  clearTimeout(rollTimer);
  const t0 = performance.now();
  if (!quick) {
    rollClock = setInterval(() => {
      const now = performance.now() - t0;
      document.querySelectorAll('.dice .die.rolling').forEach((el) => {
        const fx = ui.fx[+el.dataset.i];
        if (!fx) return;
        if (now >= fx.delay + fx.dur) { setFace(el, ui.game.rolled[+el.dataset.i]); el.classList.remove('rolling'); } else if (now >= fx.delay) setFace(el, 1 + Math.floor(Math.random() * 6));
      });
    }, 75);
  }
  rollTimer = setTimeout(() => {
    clearInterval(rollClock);
    ui.rolling = false;
    navigator.vibrate?.(12);
    render();
    settle();
  }, total);
}

/** Apply a game state, whether it came from this device or the network. */
function receive(next) {
  const prev = ui.game;
  if (prev && prev.gid === next.gid && next.rev <= prev.rev) return; // duplicate or stale
  const sameGame = !!prev && prev.gid === next.gid;
  if (!sameGame) ui.newUnlocks = [];
  ui.game = next;
  ui.selected = null;
  ui.hint = null;
  if (!sameGame || next.current !== prev.current || next.phase !== 'placing') ui.undo = [];
  if (!sameGame || next.current !== prev.current) ui.turnEnds = Date.now() + TURN_MS;
  if (ui.modal === 'powers' && (!sameGame || next.current !== prev.current || next.phase !== 'placing')) { ui.modal = null; ui.power = null; }
  const happened = sameGame && prev.rev !== next.rev ? eventsText(next) : '';

  // Remember the claimed card on screen before it is re-rendered away, so it can fly to its owner.
  let flight = null;
  if (next.lastClaim && sameGame && prev.rev !== next.rev) {
    const c = next.lastClaim;
    say(`${next.players[c.player].name} claimed ${c.points} points!${happened ? ` ${happened}` : ''}`, happened ? 3200 : 1800);
    const gone = prev.cards.findIndex((card) => !next.cards.some((n) => n.id === card.id));
    const el = gone >= 0 ? app.querySelector(`.gcard[data-card="${gone}"]`) : null;
    if (el && !reducedMotion()) flight = { html: el.outerHTML, rect: el.getBoundingClientRect(), player: c.player, from: prev.players[c.player].score, to: next.players[c.player].score };
  }
  if (happened && !next.lastClaim) say(happened, 3200);
  if (sameGame && prev.phase === 'start' && next.phase === 'placing') startRoll(next.rolled.length);
  const justWon = sameGame && next.phase === 'over' && prev.phase !== 'over';
  if (sameGame && prev.rev !== next.rev) {
    if (next.lastClaim) sfx.claim();
    else if ((next.events || []).some((e) => e.type === 'power' || e.type === 'chaos' || e.type === 'lucky')) sfx.power();
    if (next.current !== prev.current && next.phase !== 'over' && isMine(next) && !next.players[next.current].cpu && !justWon) setTimeout(sfx.turn, 400);
  }
  render();
  if (flight) flyCard(flight);
  if (justWon) {
    confetti(next.winner);
    setTimeout(sfx.win, 300);
    countGame(next);
    if (ui.newUnlocks.length) render(); // the winner screen shows what was just unlocked
  }
  settle();
  tutAfterState(next);
}

/** The claimed card shrinks into its owner's scoreboard chip while the score counts up. */
function flyCard({ html, rect, player, from, to }) {
  const chip = app.querySelector(`.chip[data-p="${player}"]`);
  const num = chip?.querySelector('.num');
  if (!chip || !num) return;
  const target = chip.getBoundingClientRect();
  const ghost = document.createElement('div');
  ghost.className = 'fly';
  ghost.style.cssText = `left:${rect.left}px;top:${rect.top}px;width:${rect.width}px;height:${rect.height}px`;
  ghost.innerHTML = html;
  document.body.appendChild(ghost);
  num.textContent = String(from);
  const dx = target.left + target.width / 2 - (rect.left + rect.width / 2);
  const dy = target.top + target.height / 2 - (rect.top + rect.height / 2);
  const anim = ghost.animate(
    [{ transform: 'translate(0, 0) scale(1) rotate(0deg)', opacity: 1 }, { transform: 'translate(0, -14px) scale(1.08) rotate(-3deg)', opacity: 1, offset: 0.2 }, { transform: `translate(${dx}px, ${dy}px) scale(.12) rotate(8deg)`, opacity: 0.25 }],
    { duration: 700, easing: 'cubic-bezier(.45, 0, .55, 1)', fill: 'forwards' },
  );
  anim.onfinish = () => {
    ghost.remove();
    chip.classList.add('bump');
    const t0 = performance.now();
    const tick = (now) => {
      const k = Math.min(1, (now - t0) / 550);
      const cur = chip.querySelector('.num');
      if (cur) cur.textContent = String(Math.round(from + (to - from) * k));
      if (k < 1) requestAnimationFrame(tick);
    };
    requestAnimationFrame(tick);
    setTimeout(() => chip.classList.remove('bump'), 700);
  };
}

/** Confetti in the winner's colour and the rest of the palette. */
function confetti(winner) {
  if (reducedMotion()) return;
  const layer = document.createElement('div');
  layer.className = 'confetti';
  const colors = [hexOf(winner), hexOf(winner), ...PALETTE.map((c) => c.hex)];
  layer.innerHTML = Array.from({ length: 80 }, () => {
    const c = colors[Math.floor(Math.random() * colors.length)];
    const style = `left:${Math.random() * 100}%;background:${c};--dx:${Math.round(Math.random() * 160 - 80)}px;--spin:${Math.round(Math.random() * 900 - 450)}deg;animation-delay:${Math.round(Math.random() * 700)}ms;animation-duration:${2200 + Math.round(Math.random() * 1800)}ms`;
    return `<i style="${style}"></i>`;
  }).join('');
  document.body.appendChild(layer);
  setTimeout(() => layer.remove(), 5000);
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
  } else if (!ui.tut && isMine(s) && s.phase === 'placing' && (!s.rolled.length || !E.legalMoves(s).length)) { // (the tutorial waits for you to tap End turn)
    if (s.rolled.length) say('No matching cards. Turn passes.');
    timer = setTimeout(() => { if (ui.game === s) commit(E.endTurn(s)); }, ui.undo.length ? 2000 : 1300);
  }
}

/** A person's placement: kept so it can be undone, unless it claimed a card (which draws a new one). */
function placeDie(rolled, card) {
  sfx.place();
  const before = ui.game;
  const next = E.place(before, rolled, card);
  if (next.lastClaim) ui.undo = [];
  else ui.undo = [...ui.undo, before];
  commit(next);
}

function undoPlacement() {
  if (!canAct() || ui.game.phase !== 'placing' || !ui.undo.length) return;
  clearTimeout(timer);
  const previous = structuredClone(ui.undo[ui.undo.length - 1]);
  ui.undo = ui.undo.slice(0, -1);
  previous.lastClaim = null;
  commit(previous);
}

function showHint() {
  if (!canAct()) return;
  const s = ui.game;
  clearTimeout(hintTimer);
  if (s.phase === 'start') {
    const a = aiNextAction(s, { level: 'hard' }); // the best advice available, and the same every time
    ui.hint = { button: a.type === 'takeback' ? 'takeback' : 'roll' };
    say(a.type === 'takeback' ? 'Hint: take back your dice and roll all six' : `Hint: roll your ${E.handSize(s, s.current)} dice`, 3500);
  } else {
    const a = aiNextAction(s, { level: 'hard' });
    if (a.type === 'power') {
      const pw = E.POWERS[a.kind];
      say(`Hint: play ${pw.icon} ${pw.name}`, 3500);
      return;
    }
    if (a.type !== 'place') {
      say(E.legalMoves(s).length ? 'Hint: placing more dice would not help. End your turn.' : 'Hint: nothing fits. End your turn.', 3500);
      return;
    }
    ui.hint = { rolled: a.rolled, card: a.card };
    say(`Hint: put the ${s.rolled[a.rolled]} on the ${s.cards[a.card].points}-point card`, 3500);
  }
  render();
  hintTimer = setTimeout(() => { ui.hint = null; render(); }, 4000);
}

/** Play a power card for the person at this device, then close the sheet. */
function doPower(kind, args) {
  if (!canAct()) return;
  try {
    const next = E.usePower(ui.game, kind, args);
    ui.modal = null;
    ui.power = null;
    commit(next);
  } catch (e) {
    sfx.error();
    say(e.message);
  }
}

/** Extreme: a turn that runs out is played for you: roll if you have not, otherwise end it. */
function turnClock() {
  const s = ui.game;
  if (ui.screen !== 'game' || !s || s.mode !== 'extreme' || s.phase === 'over' || !isMine(s) || s.players[s.current].cpu) return;
  const bar = app.querySelector('.turnbar');
  if (bar) { bar.style.setProperty('--p', turnFraction()); bar.classList.toggle('low', ui.turnEnds - Date.now() < 10000); }
  if (Date.now() < ui.turnEnds || !canAct()) return;
  ui.modal = null;
  ui.power = null;
  ui.turnEnds = Date.now() + TURN_MS; // in case the move cannot be sent right now
  say('Out of time!');
  if (s.phase === 'start') { if (E.handSize(s, s.current) > 0) doRoll(); else doTakeBack(); } else { clearTimeout(timer); commit(E.endTurn(s)); }
}
setInterval(turnClock, 500);

function doRoll() { commit(E.roll(ui.game, ui.tut ? E.scriptedRng(E.TUTORIAL_ROLL) : Math.random)); }
function doTakeBack() { commit(E.roll(E.takeBack(ui.game))); }

function cpuStep() {
  const s = ui.game;
  if (!s || s.phase === 'over' || !s.players[s.current].cpu) return;
  const a = aiNextAction(s, { level: s.players[s.current].level });
  if (a.type === 'takeback') commit(E.takeBack(s));
  else if (a.type === 'roll') doRoll();
  else if (a.type === 'place') commit(E.place(s, a.rolled, a.card));
  else if (a.type === 'power') commit(E.usePower(s, a.kind, a));
  else commit(E.endTurn(s));
}

function freshGame(configs, mode = 'classic', settings = {}) {
  const g = E.newGame(configs, Math.random, { mode, target: settings.target, dice: settings.dice });
  g.rev = 0;
  g.gid = Math.random().toString(36).slice(2);
  return g;
}

/* ---------- the tutorial ---------- */

// Each step is a tip and what it waits for: a tap on Next, or a move in the game. `faces` are the dice it lets you
// place; `done` says when the step is over.
const TUT = [
  { text: 'Welcome! In Rollick you roll dice and place them on cards. Finish cards to score, and be first to 40 points.', next: true },
  { text: 'Each card shows the dice it needs. The points are in its corner: harder cards are worth more.', next: true },
  { text: 'Tap <b>Roll</b> to roll your six dice.', expect: 'roll', done: (s) => s.phase === 'placing' },
  { text: 'You rolled a 3, and the <b>2-point card</b> needs a 3. Tap the 3.', faces: [3], done: (s) => s.players[0].score >= 2 },
  { text: 'Card finished! The 4-point card needs two 5s. Tap a 5, then the other 5.', faces: [5], done: (s) => s.players[0].score >= 6 },
  { text: 'Now the 3-point card: it needs a 2 and a 6. Tap each of them.', faces: [2, 6], done: (s) => s.players[0].score >= 9 },
  { text: 'Nothing needs the 1, so it stays in your hand. Tap <b>End turn</b>.', expect: 'end', done: (s) => s.current !== 0 },
  { text: 'Now Coach takes a turn…', auto: true, done: (s) => s.current === 0 && s.phase === 'start' },
  { text: 'Your dice stay on cards until the card is finished. Each turn you roll only the dice in your hand. <b>Take back</b> returns all your dice so you can roll all six.', next: true },
  { text: 'Tap a die on a card to see who else is covering it. A number badge means several players share it. The 💡 gives a hint.', next: true },
  { text: 'You are ready! <b>Rollick Extreme</b> adds power cards, chaos rounds and a turn timer. Try it when you like.', next: true, last: true },
];
const TUT_ACTS = new Set(['roll', 'takeBack', 'end', 'pickRolled', 'pickCard', 'undo', 'hint', 'powers']);

/** What to point at right now: the Roll button, the die and card to use, or End turn. */
function tutHint(s) {
  const step = TUT[ui.tut?.step];
  if (!step || s.phase === 'over') return null;
  if (step.expect === 'roll') return { button: 'roll' };
  if (step.expect === 'end') return { button: 'end' };
  if (step.faces && s.phase === 'placing') {
    const r = s.rolled.findIndex((f) => step.faces.includes(f));
    const c = r < 0 ? -1 : s.cards.findIndex((_, ci) => E.canPlace(s, r, ci));
    if (r >= 0 && c >= 0) return { rolled: r, card: c };
  }
  return null;
}

function coachView() {
  const n = ui.tut.step;
  const step = TUT[n];
  return `<div class="coach" role="status" aria-live="polite">
    <div class="ctext"><small>Tutorial · ${n + 1} of ${TUT.length}</small><span>${step.text}</span></div>
    <div class="cbtns">${step.next ? `<button class="btn primary small" data-act="tutNext">${step.last ? 'Finish' : 'Next'}</button>` : ''}${step.last ? '' : '<button class="linkbtn" data-act="tutSkip">Skip</button>'}</div>
  </div>`;
}

/** May this tap do something right now? While teaching, only the move the tip asks for. */
function tutAllows(act, data) {
  const step = TUT[ui.tut.step];
  if (step.next || step.auto) return false;
  if (act === 'roll') return step.expect === 'roll';
  if (act === 'end') return step.expect === 'end';
  if (act === 'pickRolled') return !!step.faces?.includes(ui.game.rolled[+data.i]);
  if (act === 'pickCard') return !!step.faces;
  return false;
}

function tutNudge() {
  sfx.error(); // the tip shakes; no toast, which would sit on top of it
  const box = app.querySelector('.coach');
  if (box) { box.classList.remove('nudge'); void box.offsetWidth; box.classList.add('nudge'); }
}

/** After every move: move to the next tip when this one is done, and point at what comes next. */
function tutAfterState(s) {
  if (!ui.tut) return;
  const step = TUT[ui.tut.step];
  if (step.done?.(s)) ui.tut.step++;
  ui.hint = tutHint(s);
  render();
}

function startTutorial() {
  clearTimeout(timer);
  ui.online = false;
  ui.game = null;
  ui.undo = [];
  ui.cfg = [
    { name: 'You', cpu: false, color: profile.color, avatar: profile.avatar },
    { name: 'Coach', cpu: true, level: 'easy', color: freeColor([profile.color], 1), avatar: '' },
  ];
  ui.tut = { step: 0 };
  keepAwake(true);
  const g = E.tutorialGame();
  g.rev = 0;
  g.gid = `tutorial-${Math.random().toString(36).slice(2)}`;
  ui.screen = 'game';
  ui.rolling = false;
  ui.modal = null;
  receive(g);
}

function endTutorial(done) {
  ui.tut = null;
  ui.hint = null;
  store.set('rfi-tutorial', '1');
  clearTimeout(timer);
  keepAwake(false);
  ui.screen = 'setup';
  ui.game = null;
  ui.rolling = false;
  ui.modal = null;
  render();
  if (done) say('Well done! Pick players and start a game.', 3200);
}

function startGame() {
  ui.tut = null;
  ui.newUnlocks = [];
  clearTimeout(timer);
  ui.online = false;
  ui.game = null;
  ui.cfg = ui.setup.map((p) => ({ ...p }));
  keepAwake(true);
  const g = freshGame(ui.cfg, ui.mode, ui.settings);
  ui.screen = 'game';
  ui.rolling = false;
  ui.modal = null;
  receive(g);
  say(`${g.players[g.current].name} goes first (rolled ${g.firstRoll})`, 2500);
}

/* ---------- online rooms ---------- */

const CODE_CHARS = 'ABCDEFGHJKLMNPQRSTUVWXYZ';
const newCode = () => Array.from({ length: 4 }, () => CODE_CHARS[Math.floor(Math.random() * CODE_CHARS.length)]).join('');

function savedSession() {
  try { return JSON.parse(localStorage.getItem('rfi-session')); } catch { return null; }
}
const saveSession = (code, host) => store.set('rfi-session', JSON.stringify({ code, host }));

function localUid() {
  let id = store.get('rfi-uid');
  if (!id) { id = `p_${Math.random().toString(36).slice(2)}${Date.now().toString(36)}`; store.set('rfi-uid', id); }
  return id;
}

/* Keep the screen on while playing, so a locked phone does not cut the connection. */
const awake = { lock: null, want: false };
async function keepAwake(on) {
  awake.want = on;
  try {
    if (on && !awake.lock && !document.hidden) {
      awake.lock = await navigator.wakeLock?.request('screen');
      awake.lock?.addEventListener('release', () => { awake.lock = null; });
    } else if (!on && awake.lock) {
      await awake.lock.release();
      awake.lock = null;
    }
  } catch { /* not supported or refused */ }
}
document.addEventListener('visibilitychange', () => { if (!document.hidden && awake.want) keepAwake(true); });

async function initNet() {
  try {
    if (window.claude?.use) {
      const [db, user] = await Promise.all([window.claude.use('db'), window.claude.use('user')]);
      const uid = user ? await user.id() : null;
      if (db && uid) { net.store = dbStore(db); net.uid = uid; }
    } else if (window.Peer) {
      net.uid = localUid();
      net.store = p2pStore(window.Peer, window.RFI_PEER_OPTIONS, net.uid, window.RFI_ICE_SERVERS, window.RFI_RELAY_BROKERS);
    }
  } catch { /* online play unavailable */ }
  const m = /^#([A-Za-z]{4})$/.exec(location.hash);
  if (net.store && m && ui.screen === 'setup') { ui.joinCode = m[1].toUpperCase(); ui.screen = 'online'; }
  render();
}

function attach(ref) {
  net.unsub?.();
  net.ref?.close?.();
  net.ref = ref;
  net.room = null;
  net.q = Promise.resolve();
  ui.conn = 'online';
  net.offStatus?.();
  net.offStatus = ref.onStatus?.((state) => {
    if (state === ui.conn) return;
    ui.conn = state;
    if (state === 'online') say('Back online', 1500);
    render();
    if (state === 'online') settle();
  });
  net.offReact?.();
  net.offReact = ref.onReact?.(showReaction);
  net.unsub = ref.onSnapshot(onRoom, (e) => {
    if (e?.code === 'lost') return; // the banner offers Retry
    if (e?.code === 'closed') { say('The host ended the room'); leaveRoom(); return; }
    say('Lost connection to the room');
    leaveRoom();
  });
  keepAwake(true);
}

function onRoom(snap) {
  if (!snap.exists) { if (ui.online) { say('Room closed'); leaveRoom(); } return; }
  const room = snap.data();
  net.room = room;
  net.mySeat = room.seats.findIndex((p) => p.uid === net.uid);
  if (net.seated && net.mySeat < 0) { say('The host removed you from the room', 3000); leaveRoom(); return; }
  net.seated = net.mySeat >= 0;
  ui.online = true;
  ui.react = ui.react && room.status !== 'lobby';
  syncDirectory(room);
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
  net.offReact?.();
  net.offReact = null;
  net.dir?.close();
  net.dir = null;
  net.seated = false;
  ui.react = false;
  net.offStatus?.();
  net.offStatus = null;
  net.ref?.close?.();
  net.ref = null;
  ui.conn = 'online';
  keepAwake(false);
  store.set('rfi-session', '');
  net.room = null;
  net.mySeat = -1;
  ui.online = false;
  ui.game = null;
  ui.rolling = false;
  ui.modal = null;
  ui.ed = null;
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

const myName = () => (profile.name.trim() || 'Player').slice(0, 12);
const mySeatData = (taken) => ({ name: myName(), cpu: false, color: freeColor(taken, profile.color), avatar: profile.avatar });

const failText = (e) => (e.message === 'removed' ? 'The host removed you from this room.'
  : e.message === 'notfound' ? 'No room with that code. Check it with your friend, and make sure they are still on the lobby screen.'
  : e.message === 'timeout' ? 'Could not reach that room. Check the code, and that both phones are online. The host must keep Rollick open.'
  : e.message === 'network' ? 'Could not reach the connection service. Check your internet, turn off any VPN or content blocker, and try again.'
  : e.message === 'taken' ? 'Could not find a free room code. Try again.'
  : 'Could not connect. Try again.');

async function createRoom() {
  ui.onlineError = '';
  net.busy = true; render();
  try {
    let ref;
    let code;
    for (let i = 0; i < 6 && !ref; i++) {
      code = newCode();
      try { ref = await net.store.host(code); } catch (e) { if (e.message !== 'taken') throw e; }
    }
    if (!ref) throw new Error('taken');
    attach(ref);
    saveSession(code, true);
    await pushRoom({ code, hostUid: net.uid, status: 'lobby', mode: ui.mode, settings: { ...ui.settings }, seats: [{ uid: net.uid, ...mySeatData([]) }], game: null, createdAt: Date.now() });
  } catch (e) { leaveRoom(); ui.screen = 'online'; ui.onlineError = net.store.kind === 'db' ? 'Could not create a room. The page needs to be shared with you as an editor.' : failText(e); }
  net.busy = false; render();
}

async function enterRoom(code, { host = false } = {}) {
  const ref = host ? await net.store.host(code, { resume: true }) : await net.store.join(code);
  attach(ref);
  if (!host) {
    await mutateRoom((room) => {
      if (room.seats.some((p) => p.uid === net.uid)) return null; // rejoining
      if (room.status !== 'lobby' || room.seats.length >= MAX_PLAYERS) return null; // watch only
      room.seats.push({ uid: net.uid, ...mySeatData(room.seats.map((p) => p.color)) });
      return room;
    });
    const seated = (await net.ref.get()).data()?.seats?.some((p) => p.uid === net.uid);
    if (!seated) say('You can watch, but the room is full or the game has started.', 3500);
  }
  saveSession(code, host);
}

async function joinRoom() {
  const code = ui.joinCode.trim().toUpperCase();
  ui.onlineError = '';
  if (code.length !== 4) { ui.onlineError = 'Enter the 4-letter room code.'; render(); return; }
  net.busy = true; render();
  try { await enterRoom(code); } catch (e) { leaveRoom(); ui.screen = 'online'; ui.onlineError = net.store.kind === 'db' ? 'Could not join. The page needs to be shared with you as an editor.' : failText(e); }
  net.busy = false; render();
}

async function resumeRoom() {
  const s = savedSession();
  if (!s) return;
  net.busy = true; render();
  try {
    // A host who just reloaded may find the old connection still registered for a short while; keep trying.
    for (let attempt = 0; ; attempt++) {
      try { await enterRoom(s.code, { host: s.host }); break; } catch (e) {
        if (!(s.host && e.message === 'taken' && attempt < 8)) throw e;
        if (attempt === 0) say('Reconnecting to your room…', 4000);
        await sleep(4000);
      }
    }
  } catch (e) { leaveRoom(); say(e.message === 'taken' ? 'Your old connection is still closing. Try again in a moment.' : failText(e)); }
  net.busy = false; render();
}

async function invite() {
  const code = net.room?.code;
  const url = `${location.origin}${location.pathname}#${code}`;
  const text = `Join my Rollick game: room ${code}`;
  const inFrame = net.store?.kind === 'db'; // the claude.ai page's own address is not a link friends can use
  try {
    if (navigator.share) { await navigator.share(inFrame ? { title: 'Rollick', text } : { title: 'Rollick', text, url }); return; }
    await navigator.clipboard.writeText(inFrame ? text : `${text}\n${url}`);
    say('Invite copied');
  } catch { say(`Tell friends room code ${code}`); }
}

async function startOnline() {
  await mutateRoom((room) => {
    if (room.hostUid !== net.uid || room.seats.length < 2) return null;
    room.game = freshGame(room.seats, room.mode, room.settings);
    room.status = 'playing';
    return room;
  });
}

const actions = {
  setKind: ({ i, k }) => {
    const p = ui.setup[i];
    p.cpu = k !== 'human';
    if (p.cpu) p.level = k;
    render();
  },
  setSeatLevel: ({ i, k }) => mutateRoom((room) => {
    if (room.hostUid !== net.uid || !room.seats[i]?.cpu || !E.LEVEL_NAMES.includes(k)) return null;
    room.seats[i].level = k;
    return room;
  }),
  addPlayer: () => {
    const color = freeColor(ui.setup.map((p) => p.color), null);
    ui.setup.push({ name: cpuName(ui.setup.map((p) => p.name)), cpu: true, level: 'normal', color, avatar: '' });
    render();
  },
  removePlayer: ({ i }) => { ui.setup.splice(i, 1); render(); },
  editPlayer: ({ i }) => openEditor('setup', +i, ui.setup[i]),
  editProfile: () => openEditor('profile', 0, profile),
  editMe: () => { if (net.mySeat >= 0) openEditor('seat', net.mySeat, net.room.seats[net.mySeat]); },
  ink: ({ c }) => { ui.ed.sk.ink = c; ui.ed.sk.erase = false; ui.ed.sk.stamp = null; render(); },
  eraser: () => { ui.ed.sk.erase = true; ui.ed.sk.stamp = null; render(); },
  stamp: ({ g }) => { ui.ed.sk.stamp = g; ui.ed.sk.erase = false; render(); },
  brush: ({ w }) => { ui.ed.sk.width = +w; render(); },
  clearArt: () => { clearSketch(ui.ed.sk); render(); },
  pickColor: ({ i }) => { ui.ed.color = +i; render(); },
  saveEditor,
  closeEditor: () => { ui.ed = null; render(); },
  start: startGame,
  rematch: () => (ui.online ? startOnline() : startGame()),
  goOnline: () => { ui.screen = 'online'; render(); },
  createRoom,
  joinRoom,
  resume: resumeRoom,
  invite,
  startOnline,
  addSeatCpu: () => mutateRoom((room) => {
    if (room.hostUid !== net.uid || room.seats.length >= MAX_PLAYERS) return null;
    room.seats.push({ uid: null, name: cpuName(room.seats.map((p) => p.name)), cpu: true, level: 'normal', color: freeColor(room.seats.map((p) => p.color), null), avatar: '' });
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
  powers: () => { if (ui.game?.mode === 'extreme') { ui.power = null; ui.modal = 'powers'; render(); } },
  playPower: ({ k }) => {
    if (!canAct() || ui.game.phase !== 'placing') return;
    if (k === 'bonus' || k === 'skip') { doPower(k, {}); return; }
    ui.power = { kind: k };
    render();
  },
  powerBack: () => { ui.power = null; render(); },
  powerDie: ({ i }) => {
    if (!ui.power) return;
    if (ui.power.kind === 'reroll') { doPower('reroll', { rolled: +i }); return; }
    ui.power = { kind: 'set', rolled: +i };
    render();
  },
  powerFace: ({ f }) => { if (ui.power?.kind === 'set') doPower('set', { rolled: ui.power.rolled, face: +f }); },
  powerKnock: ({ card, p }) => doPower('knock', { card: +card, player: +p }),
  startTutorial,
  tutNext: () => {
    if (!ui.tut) return;
    if (TUT[ui.tut.step].last) { endTutorial(true); return; }
    ui.tut.step++;
    ui.hint = tutHint(ui.game);
    render();
  },
  tutSkip: () => endTutorial(false),
  themes: () => { ui.modal = 'themes'; render(); },
  setTheme: ({ part, id }) => {
    if (setTheme(part, id)) { sfx.tap(); render(); return; }
    sfx.error();
    say(`🔒 ${requirementText(part, id)} to unlock this`, 2600);
  },
  reactMenu: () => { if (canReact()) { ui.modal = null; ui.react = !ui.react; render(); } },
  closeReact: () => { ui.react = false; render(); },
  sendReact: ({ e }) => {
    ui.react = false;
    render();
    if (REACTIONS.includes(e) && canReact()) net.ref.react(e);
  },
  toggleSound: () => { setSound(!soundPrefs.sound); if (soundPrefs.sound) sfx.react(); render(); },
  toggleHaptics: () => { setHaptics(!soundPrefs.haptics); sfx.tap(); render(); },
  toLobby: () => { if (!ui.online || !isHost()) return; ui.modal = null; mutateRoom((room) => { room.status = 'lobby'; room.game = null; return room; }); },
  togglePublic: () => mutateRoom((room) => {
    if (room.hostUid !== net.uid || room.status !== 'lobby') return null;
    room.public = !room.public;
    return room;
  }),
  kickSeat: ({ i }) => mutateRoom((room) => {
    const seat = room.seats[+i];
    if (room.hostUid !== net.uid || !seat || seat.cpu || seat.uid === room.hostUid) return null;
    room.banned = [...(room.banned || []), seat.uid].slice(-30);
    room.seats.splice(+i, 1);
    return room;
  }),
  joinListed: ({ code }) => { if (/^[A-Z]{4}$/.test(code)) { ui.joinCode = code; joinRoom(); } },
  setSetting: ({ key, v }) => {
    const value = +v;
    if (!(key === 'target' ? E.SETTINGS.targets : key === 'dice' ? E.SETTINGS.dice : []).includes(value)) return;
    ui.settings = { ...ui.settings, [key]: value };
    store.set('rfi-settings', JSON.stringify(ui.settings));
    render();
  },
  setRoomSetting: ({ key, v }) => mutateRoom((room) => {
    const value = +v;
    if (room.hostUid !== net.uid || room.status !== 'lobby' || !(key === 'target' ? E.SETTINGS.targets : key === 'dice' ? E.SETTINGS.dice : []).includes(value)) return null;
    room.settings = { ...(room.settings || ui.settings), [key]: value };
    ui.settings = { ...room.settings };
    store.set('rfi-settings', JSON.stringify(ui.settings));
    return room;
  }),
  showQr: () => { if (canShowQr()) { ui.modal = 'qr'; render(); } },
  reportOpen: () => { ui.modal = 'report'; render(); },
  reportShare: async () => {
    try { await navigator.share({ title: 'Rollick problem report', text: buildReport(ui.reportNote, reportContext()) }); } catch { /* cancelled */ }
  },
  reportCopy: async () => {
    const text = buildReport(ui.reportNote, reportContext());
    try { await navigator.clipboard.writeText(text); say('Report copied. Paste it into a message.', 2600); } catch {
      const box = Object.assign(document.createElement('textarea'), { value: text });
      document.body.appendChild(box); box.select();
      let ok = false; try { ok = document.execCommand('copy'); } catch { /* not allowed */ }
      box.remove();
      say(ok ? 'Report copied. Paste it into a message.' : 'Could not copy. Open “See the report” and copy it by hand.', 3000);
    }
  },
  reportMail: () => {
    const body = buildReport(ui.reportNote, reportContext());
    location.href = `mailto:${window.RFI_FEEDBACK_EMAIL}?subject=${encodeURIComponent(`Rollick problem report (${VERSION})`)}&body=${encodeURIComponent(body.slice(0, 1800))}`;
  },
  reportClear: () => { clearErrors(); say('Error log cleared', 1500); render(); },
  setMode: ({ m }) => { if (!E.MODES.includes(m)) return; ui.mode = m; store.set('rfi-mode', m); render(); },
  setRoomMode: ({ m }) => mutateRoom((room) => {
    if (room.hostUid !== net.uid || !E.MODES.includes(m) || room.status !== 'lobby') return null;
    room.mode = m;
    ui.mode = m;
    store.set('rfi-mode', m);
    return room;
  }),
  toSetup: () => { ui.tut = null; ui.hint = null; if (ui.online || net.unsub) { leaveRoom(); return; } keepAwake(false); clearTimeout(timer); ui.screen = 'setup'; ui.modal = null; ui.game = null; ui.rolling = false; render(); },
  testNet: async () => {
    ui.netTest = 'running'; render();
    const [r, backup] = await Promise.all([checkConnection(window.RFI_ICE_SERVERS), checkFallback(window.RFI_RELAY_BROKERS ?? DEFAULT_BROKERS)]);
    ui.netTest = r?.relay ? 'Good: a relay server is reachable, so friends on other networks should be able to connect.'
      : backup ? 'Good: direct connections are limited here, but the backup route is reachable, so friends on other networks can still connect.'
      : !r ? 'This browser cannot make direct connections, and the backup route is unreachable. Try Safari or Chrome, and turn off any VPN.'
      : r.srflx ? 'Limited: your phone can reach the internet but no relay or backup route answered. Friends on other networks may not be able to connect. Try another network and turn off any VPN or content blocker.'
      : 'Blocked: this network is stopping online connections. Try another network, such as cellular, and turn off any VPN or content blocker.';
    render();
  },
  rules: () => { ui.modal = 'rules'; render(); },
  about: () => { ui.modal = 'about'; render(); },
  menu: () => { ui.modal = 'menu'; render(); },
  closeModal: () => { ui.modal = null; ui.power = null; render(); },
  roll: () => { if (canAct() && ui.game.phase === 'start' && E.handSize(ui.game, ui.game.current) > 0) doRoll(); },
  end: () => { if (canAct() && ui.game.phase === 'placing') { clearTimeout(timer); commit(E.endTurn(ui.game)); } },
  takeBack: () => { if (canAct() && ui.game.phase === 'start') doTakeBack(); },
  peek: ({ card, slot }, el) => {
    // With a die selected, tapping a die on a card places it as before; otherwise show who covers it.
    if (canAct() && ui.selected !== null && E.canPlace(ui.game, ui.selected, +card)) { placeDie(ui.selected, +card); return; }
    const same = ui.peek && ui.peek.card === +card && ui.peek.slot === +slot;
    clearTimeout(peekTimer);
    if (same) ui.peek = null;
    else {
      ui.peek = { card: +card, slot: +slot, id: ui.game.cards[+card]?.id };
      peekTimer = setTimeout(() => { ui.peek = null; render(); }, 8000);
    }
    render();
  },
  hint: showHint,
  undo: undoPlacement,
  retryConn: () => net.ref?.retry?.(),
  pickRolled: ({ i }) => {
    if (!canAct() || ui.game.phase !== 'placing') return;
    const idx = +i;
    const targets = ui.game.cards.map((_, c) => c).filter((c) => E.canPlace(ui.game, idx, c));
    if (!targets.length) { sfx.error(); say('No card needs that number'); return; }
    if (targets.length === 1) { placeDie(idx, targets[0]); return; }
    ui.selected = ui.selected === idx ? null : idx;
    render();
  },
  pickCard: ({ card }) => {
    if (canAct() && ui.selected !== null && E.canPlace(ui.game, ui.selected, +card)) placeDie(ui.selected, +card);
  },
};

app.addEventListener('click', (e) => {
  if (ui.peek && !e.target.closest('.peek') && !e.target.closest('[data-act="peek"]')) { ui.peek = null; clearTimeout(peekTimer); render(); }
  const el = e.target.closest('[data-act]');
  if (!el || (el.classList.contains('modal') && e.target !== el)) return;
  if (ui.tut && TUT_ACTS.has(el.dataset.act) && !tutAllows(el.dataset.act, el.dataset)) { tutNudge(); return; }
  actions[el.dataset.act]?.({ ...el.dataset }, el);
});
app.addEventListener('input', (e) => {
  if (e.target.id === 'myname') { profile.name = e.target.value; saveProfile(); return; }
  if (e.target.id === 'reportnote') {
    ui.reportNote = e.target.value;
    const pre = app.querySelector('.sheet.report pre');
    if (pre) pre.textContent = buildReport(ui.reportNote, reportContext()); // keep the preview current without redrawing the box being typed in
    return;
  }
  if (e.target.id === 'joincode') { ui.joinCode = e.target.value.toUpperCase(); return; }
  const i = e.target.dataset?.name;
  if (i !== undefined) {
    ui.setup[i].name = e.target.value.trim() || `Player ${+i + 1}`;
    if (ui.setup[i].me) { profile.name = ui.setup[i].name; saveProfile(); }
  }
});

render();
let warned = false;
installReporter(() => {
  if (warned) return; // one nudge per visit is enough
  warned = true;
  try { say('Something went wrong. Open ⓘ, then Report a problem.', 4500); } catch { /* the screen is not ready */ }
});
initNet();

if ('serviceWorker' in navigator && location.protocol.startsWith('http')) {
  navigator.serviceWorker.register('sw.js', { updateViaCache: 'none' }).catch(() => {});
}

// The dice in the tray are plain elements acting as buttons; let the keyboard use them too.
document.addEventListener('keydown', (e) => {
  if ((e.key === 'Enter' || e.key === ' ') && e.target?.matches?.('[data-act][role="button"]')) { e.preventDefault(); e.target.click(); }
});
