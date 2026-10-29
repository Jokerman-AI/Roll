import * as E from './engine.js';
import { aiNextAction } from './ai.js';

const COLORS = ['#e5484d', '#3b82f6', '#2fb36d', '#f5a524', '#a855f7', '#14b8a6', '#ec4899', '#cbd5e1'];
const MAX_PLAYERS = E.MAX_PLAYERS;
const CPU_DELAY = 700;
const ROLL_MS = 650;
const PIPS = { 1: [4], 2: [0, 8], 3: [0, 4, 8], 4: [0, 2, 6, 8], 5: [0, 2, 4, 6, 8], 6: [0, 2, 3, 5, 6, 8] };

const app = document.getElementById('app');
const ui = {
  screen: 'setup',
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
const color = (p) => COLORS[p % COLORS.length];

function die(face, cls = '', attrs = '', tag = 'div') {
  const pips = Array.from({ length: 9 }, (_, i) => `<i${PIPS[face].includes(i) ? ' class="on"' : ''}></i>`).join('');
  return `<${tag} class="die ${cls}" aria-label="${face}" ${attrs}>${pips}</${tag}>`;
}

/* ---------- rendering ---------- */

function render() {
  app.innerHTML = (ui.screen === 'setup' ? setupView() : gameView()) + modalView() + (ui.toast ? `<div class="toast">${esc(ui.toast)}</div>` : '');
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
      <button class="btn" data-act="rules">How to play</button>
    </div>`;
}

function statusText(s) {
  const cur = s.players[s.current];
  if (s.phase === 'over') return wins(s.players[s.winner].name);
  if (ui.rolling) return `${esc(cur.name)} rolls…`;
  if (cur.cpu) return `${esc(cur.name)} is thinking…`;
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
  const human = !s.players[s.current].cpu && s.phase !== 'over';
  const chips = s.players.map((p, i) => `
    <div class="chip ${i === s.current && s.phase !== 'over' ? 'active' : ''}" style="--c:${color(i)}">
      <span class="n">${esc(p.name)}</span><span class="s">${p.score}<small> / ${E.TARGET_SCORE}</small></span>
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
      <button class="btn primary" data-act="rematch">Rematch</button>
      <button class="btn" data-act="toSetup">Main menu</button></div></div>`;
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
      <button class="btn" data-act="rematch">Restart game</button>
      <button class="btn" data-act="toSetup">Main menu</button>
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

function commit(next) {
  ui.game = next;
  ui.selected = null;
  if (next.lastClaim) {
    const c = next.lastClaim;
    say(`${next.players[c.player].name} claimed ${c.points} points!`);
  }
  render();
  settle();
}

function settle() {
  clearTimeout(timer);
  const s = ui.game;
  if (!s || s.phase === 'over' || ui.rolling) return;
  if (s.players[s.current].cpu) {
    timer = setTimeout(cpuStep, CPU_DELAY);
  } else if (s.phase === 'placing' && (!s.rolled.length || !E.legalMoves(s).length)) {
    if (s.rolled.length) say('No matching cards — turn passes');
    timer = setTimeout(() => commit(E.endTurn(ui.game)), 1300);
  }
}

function doRoll() {
  ui.game = E.roll(ui.game);
  ui.rolling = true;
  render();
  timer = setTimeout(() => { ui.rolling = false; render(); settle(); }, ROLL_MS);
}

function doTakeBack() {
  ui.game = E.takeBack(ui.game);
  doRoll();
}

function cpuStep() {
  const s = ui.game;
  if (!s || s.phase === 'over' || !s.players[s.current].cpu) return;
  const a = aiNextAction(s);
  if (a.type === 'takeback') { ui.game = E.takeBack(s); render(); timer = setTimeout(cpuStep, CPU_DELAY); }
  else if (a.type === 'roll') doRoll();
  else if (a.type === 'place') commit(E.place(s, a.rolled, a.card));
  else commit(E.endTurn(s));
}

function startGame() {
  clearTimeout(timer);
  ui.game = E.newGame(ui.setup);
  ui.screen = 'game';
  ui.selected = null;
  ui.rolling = false;
  ui.modal = null;
  const first = ui.game.players[ui.game.current];
  say(`${first.name} goes first (rolled ${ui.game.firstRoll})`, 2500);
  settle();
}

const humanTurn = () => ui.game && !ui.game.players[ui.game.current].cpu && ui.game.phase !== 'over' && !ui.rolling;

const actions = {
  toggleCpu: ({ i }) => { ui.setup[i].cpu = !ui.setup[i].cpu; render(); },
  addPlayer: () => { ui.setup.push({ name: `Player ${ui.setup.length + 1}`, cpu: true }); render(); },
  removePlayer: ({ i }) => { ui.setup.splice(i, 1); render(); },
  start: startGame,
  rematch: startGame,
  toSetup: () => { clearTimeout(timer); ui.screen = 'setup'; ui.modal = null; ui.game = null; ui.rolling = false; render(); },
  rules: () => { ui.modal = 'rules'; render(); },
  menu: () => { ui.modal = 'menu'; render(); },
  closeModal: () => { ui.modal = null; render(); },
  roll: () => { if (humanTurn() && ui.game.phase === 'start' && E.handSize(ui.game, ui.game.current) > 0) doRoll(); },
  end: () => { if (humanTurn() && ui.game.phase === 'placing') { clearTimeout(timer); commit(E.endTurn(ui.game)); } },
  takeBack: () => { if (humanTurn() && ui.game.phase === 'start') doTakeBack(); },
  pickRolled: ({ i }) => {
    if (!humanTurn() || ui.game.phase !== 'placing') return;
    const idx = +i;
    const targets = ui.game.cards.map((_, c) => c).filter((c) => E.canPlace(ui.game, idx, c));
    if (!targets.length) { say('No card needs that number'); return; }
    if (targets.length === 1) { commit(E.place(ui.game, idx, targets[0])); return; }
    ui.selected = ui.selected === idx ? null : idx;
    render();
  },
  pickCard: ({ card }) => {
    if (humanTurn() && ui.selected !== null && E.canPlace(ui.game, ui.selected, +card)) commit(E.place(ui.game, ui.selected, +card));
  },
};

app.addEventListener('click', (e) => {
  const el = e.target.closest('[data-act]');
  if (!el || (el.classList.contains('modal') && e.target !== el)) return;
  // Slots sit inside cards; the slot's own action wins over the card's.
  actions[el.dataset.act]?.({ ...el.dataset });
});
app.addEventListener('input', (e) => {
  const i = e.target.dataset?.name;
  if (i !== undefined) ui.setup[i].name = e.target.value.trim() || `Player ${+i + 1}`;
});

render();

if ('serviceWorker' in navigator && location.protocol.startsWith('http')) {
  navigator.serviceWorker.register('sw.js').catch(() => {});
}
