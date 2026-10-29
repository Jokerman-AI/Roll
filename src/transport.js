// Room transports. Both expose the same small "room store" shape to the game:
//   host(code, {resume}) -> ref     create a room (throws 'taken' if the code is in use)
//   join(code)           -> ref     connect to a room (throws 'notfound')
// and a ref has get(), set(room), acquire(), onSnapshot(next, error), close().
// A snapshot is { exists, data() } where data() is the whole room document.

import { freeColor, safeAvatar } from './profile.js';

const PEER_PREFIX = 'rollforit-';
const MAX_SEATS = 8;
const keyOf = (code) => `rfi-room-${code}`;

function tryStorage(fn) {
  try { return fn(); } catch { return null; }
}

const cleanName = (n) => (String(n ?? '').trim() || 'Player').slice(0, 12);

function snapshotOf(room) {
  return { id: 'room', exists: room !== null, data: () => room ?? undefined, metadata: {} };
}

/** Rooms kept in the host page's shared database (the claude.ai artifact). */
export function dbStore(db) {
  const doc = (code) => db.collection('rooms').doc(code);
  return {
    kind: 'db',
    async host(code, { resume = false } = {}) {
      const ref = doc(code);
      if (!resume && (await ref.get()).exists) throw new Error('taken');
      return Object.assign(ref, { close() {} });
    },
    async join(code) {
      const ref = doc(code);
      if (!(await ref.get()).exists) throw new Error('notfound');
      return Object.assign(ref, { close() {} });
    },
  };
}

// PeerJS ships with a STUN server and a free shared TURN relay; these are repeated here so that your
// own relay (set in config.js as RFI_ICE_SERVERS) is added on top of them rather than replacing them.
const DEFAULT_ICE = [
  { urls: 'stun:stun.l.google.com:19302' },
  { urls: ['turn:eu-0.turn.peerjs.com:3478', 'turn:us-0.turn.peerjs.com:3478'], username: 'peerjs', credential: 'peerjsp' },
];

function withIce(options, extra) {
  const custom = Array.isArray(extra) ? extra : [];
  return { ...options, config: { ...options?.config, iceServers: options?.config?.iceServers ?? [...DEFAULT_ICE, ...custom] } };
}

/** Small helper: a status value (online / reconnecting / lost) that listeners can follow. */
function statusFeed() {
  const subs = new Set();
  let value = 'online';
  return {
    set(next) { if (next !== value) { value = next; subs.forEach((cb) => cb(value)); } },
    on(cb) { subs.add(cb); cb(value); return () => subs.delete(cb); },
  };
}

/** Rooms held in the host's browser, reached over WebRTC through PeerJS. */
export function p2pStore(Peer, options, uid, extraIce) {
  const peerOptions = withIce(options, extraIce);
  const open = (peer) => new Promise((resolve, reject) => {
    peer.on('open', resolve);
    peer.on('error', (e) => reject(Object.assign(new Error(e.type), { type: e.type })));
  });

  return {
    kind: 'p2p',

    async host(code, { resume = false } = {}) {
      let room = resume ? tryStorage(() => JSON.parse(localStorage.getItem(keyOf(code)))) : null;
      if (resume && !room) throw new Error('notfound');
      const peer = new Peer(PEER_PREFIX + code, peerOptions);
      try { await open(peer); } catch (e) { peer.destroy(); throw new Error(e.type === 'unavailable-id' ? 'taken' : 'network'); }

      const subs = new Set();
      const status = statusFeed();
      const conns = new Map(); // peer connection -> player uid
      const broadcast = () => {
        for (const conn of conns.keys()) if (conn.open) conn.send({ t: 'room', room });
        subs.forEach((cb) => cb(snapshotOf(room)));
      };
      const publish = (next) => {
        room = next;
        tryStorage(() => localStorage.setItem(keyOf(code), JSON.stringify(room)));
        broadcast();
      };

      // Guests can only ask to join the lobby, or make the move it is their turn to make.
      const onGuestMessage = (conn, msg) => {
        const sender = conns.get(conn);
        if (!room || !sender) return;
        if (msg.t === 'ping') { conn.send({ t: 'pong' }); return; }
        if (msg.t === 'hello') { conn.send({ t: 'room', room }); return; }
        if (msg.t !== 'set' || !msg.room) return;
        if (room.status === 'lobby') {
          // In the lobby a guest may only add or update their own seat.
          const mine = msg.room.seats?.find((p) => p.uid === sender);
          const at = room.seats.findIndex((p) => p.uid === sender);
          if (mine && at >= 0) {
            const others = room.seats.filter((_, i) => i !== at).map((p) => p.color);
            const look = { name: cleanName(mine.name), color: freeColor(others, mine.color), avatar: safeAvatar(mine.avatar) };
            publish({ ...room, seats: room.seats.map((p, i) => (i === at ? { ...p, ...look } : p)) });
            return;
          }
          if (mine && room.seats.length < MAX_SEATS) {
            const look = { name: cleanName(mine.name), color: freeColor(room.seats.map((p) => p.color), mine.color), avatar: safeAvatar(mine.avatar) };
            publish({ ...room, seats: [...room.seats, { uid: sender, cpu: false, ...look }] });
            return;
          }
        } else if (room.game && msg.room.game) {
          const mover = room.seats[room.game.current]?.uid;
          const g = msg.room.game;
          if (mover === sender && g.gid === room.game.gid && g.rev > room.game.rev) {
            publish({ ...room, game: g, status: g.phase === 'over' ? 'over' : 'playing' });
            return;
          }
        }
        conn.send({ t: 'room', room }); // refused: resync the sender
      };

      peer.on('connection', (conn) => {
        conns.set(conn, conn.metadata?.uid ?? null);
        conn.on('data', (msg) => onGuestMessage(conn, msg));
        conn.on('close', () => conns.delete(conn));
      });

      // A locked or backgrounded phone drops its link to the signalling server; get it back.
      let regain = 0;
      const regainSignal = () => {
        if (peer.destroyed || !peer.disconnected) return;
        status.set('reconnecting');
        try { peer.reconnect(); } catch { /* not ready yet; the timer tries again */ }
        clearTimeout(regain);
        regain = setTimeout(regainSignal, 3000);
      };
      peer.on('disconnected', regainSignal);
      peer.on('open', () => { clearTimeout(regain); status.set('online'); });
      const onVisible = () => { if (!document.hidden) regainSignal(); };
      document.addEventListener('visibilitychange', onVisible);

      return {
        async get() { return snapshotOf(room); },
        async set(next) { publish(JSON.parse(JSON.stringify(next))); },
        async acquire() { return { acquired: true }; },
        onSnapshot(next) { subs.add(next); next(snapshotOf(room)); return () => subs.delete(next); },
        onStatus: status.on,
        retry: regainSignal,
        close() { clearTimeout(regain); document.removeEventListener('visibilitychange', onVisible); peer.destroy(); },
      };
    },

    async join(code) {
      const peer = new Peer(undefined, peerOptions);
      try { await open(peer); } catch { peer.destroy(); throw new Error('network'); }

      let room = null;
      let conn = null;
      let closed = false;
      let lastSeen = Date.now();
      const subs = new Set();
      const errors = new Set();
      const status = statusFeed();

      const connect = () => new Promise((resolve, reject) => {
        const c = peer.connect(PEER_PREFIX + code, { metadata: { uid }, reliable: true });
        const timer = setTimeout(() => reject(new Error('notfound')), 8000);
        const onPeerError = (e) => { if (e.type === 'peer-unavailable') { clearTimeout(timer); reject(new Error('notfound')); } };
        peer.on('error', onPeerError);
        c.on('open', () => c.send({ t: 'hello' }));
        c.on('data', (msg) => {
          lastSeen = Date.now();
          if (msg.t !== 'room') return;
          clearTimeout(timer);
          peer.off('error', onPeerError);
          const first = room === null;
          room = msg.room;
          if (first) { conn = c; status.set('online'); resolve(); }
          subs.forEach((cb) => cb(snapshotOf(room)));
        });
        c.on('close', () => { if (!closed && conn === c) reconnect(); });
      });

      // Keeps trying for about two minutes, since the host may only have locked their phone for a moment.
      let retrying = false;
      async function reconnect() {
        if (retrying || closed) return;
        retrying = true;
        status.set('reconnecting');
        for (let i = 0; i < 30 && !closed; i++) {
          await new Promise((r) => setTimeout(r, Math.min(1500 + i * 500, 5000)));
          try {
            if (peer.disconnected) peer.reconnect();
            room = null; // so the first message after reconnecting is treated as fresh
            await connect();
            retrying = false;
            return;
          } catch { /* try again */ }
        }
        retrying = false;
        status.set('lost');
        errors.forEach((cb) => cb({ code: 'lost' }));
      }

      await connect().catch((e) => { peer.destroy(); throw e; });

      // A phone that was backgrounded can keep a dead link open; ping so it is noticed, and recheck on wake-up.
      const beat = setInterval(() => {
        if (closed || retrying || !conn) return;
        if (Date.now() - lastSeen > 25000) { conn.close(); return; }
        if (conn.open) conn.send({ t: 'ping' });
      }, 8000);
      const onVisible = () => {
        if (document.hidden || closed || retrying) return;
        if (!conn?.open || Date.now() - lastSeen > 25000) { try { conn?.close(); } catch { /* already closed */ } reconnect(); }
      };
      document.addEventListener('visibilitychange', onVisible);

      return {
        async get() { return snapshotOf(room); },
        async set(next) {
          if (!conn?.open) throw new Error('offline');
          // A move only needs the game; everything else (seats, icons) is the host's to keep.
          const sent = next.game ? { game: next.game, status: next.status } : next;
          conn.send({ t: 'set', room: JSON.parse(JSON.stringify(sent)) });
        },
        async acquire() { return { acquired: true }; },
        onSnapshot(next, error) { subs.add(next); if (error) errors.add(error); next(snapshotOf(room)); return () => { subs.delete(next); errors.delete(error); }; },
        onStatus: status.on,
        retry: () => { try { conn?.close(); } catch { /* already closed */ } retrying = false; reconnect(); },
        close() { closed = true; clearInterval(beat); document.removeEventListener('visibilitychange', onVisible); peer.destroy(); },
      };
    },
  };
}
