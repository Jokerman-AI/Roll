// Room transports. Both expose the same small "room store" shape to the game:
//   host(code, {resume}) -> ref     create a room (throws 'taken' if the code is in use)
//   join(code)           -> ref     connect to a room (throws 'notfound')
// and a ref has get(), set(room), acquire(), onSnapshot(next, error), close().
// A snapshot is { exists, data() } where data() is the whole room document.

import { freeColor, safeAvatar } from './profile.js';
import { relayBus, ROOT, DEFAULT_BROKERS } from './relay.js';

const PEER_PREFIX = 'rollick-';
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
  // Wrap the platform's document reference instead of adding to it, which it may not allow.
  const wrap = (ref) => ({
    get: () => ref.get(),
    set: (data) => ref.set(data),
    acquire: (options) => ref.acquire(options),
    onSnapshot: (next, error) => ref.onSnapshot(next, error),
    close() {},
  });
  return {
    kind: 'db',
    async host(code, { resume = false } = {}) {
      const ref = doc(code);
      if (!resume && (await ref.get()).exists) throw new Error('taken');
      return wrap(ref);
    },
    async join(code) {
      const ref = doc(code);
      if (!(await ref.get()).exists) throw new Error('notfound');
      return wrap(ref);
    },
  };
}

// PeerJS ships with a STUN server and a free shared TURN relay; these are repeated here so that your
// own relay (set in config.js as RFI_ICE_SERVERS) is added on top of them rather than replacing them.
// Players on different networks need a relay when their routers block direct links, and mobile networks often
// only let TCP/443 through, so each relay is offered over UDP, TCP and TLS. The public relays are free and
// best effort; a relay of your own (RFI_ICE_SERVERS) is the dependable fix.
export const DEFAULT_ICE = [
  { urls: ['stun:stun.l.google.com:19302', 'stun:stun1.l.google.com:19302', 'stun:global.stun.twilio.com:3478'] },
  {
    urls: ['turn:eu-0.turn.peerjs.com:3478', 'turn:us-0.turn.peerjs.com:3478', 'turn:eu-0.turn.peerjs.com:3478?transport=tcp', 'turn:us-0.turn.peerjs.com:3478?transport=tcp'],
    username: 'peerjs', credential: 'peerjsp',
  },
  {
    urls: ['turn:openrelay.metered.ca:80', 'turn:openrelay.metered.ca:80?transport=tcp', 'turn:openrelay.metered.ca:443', 'turns:openrelay.metered.ca:443?transport=tcp'],
    username: 'openrelayproject', credential: 'openrelayproject',
  },
];

/**
 * Asks this phone's network what it can do: which kinds of connection candidates it can gather.
 * `relay` means a relay server is reachable, which is what links players on different networks.
 */
export function checkConnection(extraIce, ms = 7000) {
  return new Promise((resolve) => {
    const found = { host: 0, srflx: 0, relay: 0 };
    let pc;
    try { pc = new RTCPeerConnection({ iceServers: [...DEFAULT_ICE, ...(Array.isArray(extraIce) ? extraIce : [])] }); } catch { resolve(null); return; }
    const done = () => { clearTimeout(timer); try { pc.close(); } catch { /* closed */ } resolve(found); };
    const timer = setTimeout(done, ms);
    pc.onicecandidate = (e) => {
      if (!e.candidate) { done(); return; }
      const type = / typ (\w+)/.exec(e.candidate.candidate)?.[1];
      if (type in found) { found[type]++; if (found.relay) done(); }
    };
    pc.createDataChannel('probe');
    pc.createOffer().then((o) => pc.setLocalDescription(o)).catch(done);
  });
}

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

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const seatsKey = (room) => JSON.stringify(room?.seats ?? []);
const hashOf = (text) => { let h = 5381; for (let i = 0; i < text.length; i++) h = ((h * 33) ^ text.charCodeAt(i)) >>> 0; return h; };

/**
 * Rooms held in the host's browser. Phones connect directly over WebRTC (PeerJS) and, as a backup for
 * networks that block that, through public message brokers (see relay.js). The host listens on both.
 */
export function p2pStore(Peer, options, uid, extraIce, brokers = DEFAULT_BROKERS) {
  const peerOptions = withIce(options, extraIce);
  const useRelay = Array.isArray(brokers) && brokers.length > 0;

  // Resolves once the signalling server has accepted us. A blocked or overloaded server can leave this
  // hanging, so give up after a while instead of leaving the screen waiting forever.
  const open = (peer) => new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(Object.assign(new Error('timeout'), { type: 'timeout' })), 12000);
    peer.on('open', (id) => { clearTimeout(timer); resolve(id); });
    peer.on('error', (e) => { clearTimeout(timer); reject(Object.assign(new Error(e.type), { type: e.type })); });
  });

  return {
    kind: 'p2p',

    async host(code, { resume = false } = {}) {
      let room = resume ? tryStorage(() => JSON.parse(localStorage.getItem(keyOf(code)))) : null;
      if (resume && !room) throw new Error('notfound');
      const home = `${ROOT}/${code}`;
      const bus = useRelay ? relayBus(brokers) : null;

      // The direct route. If the signalling server is down we can still host over the backup route.
      let peer = null;
      try {
        peer = new Peer(PEER_PREFIX + code, peerOptions);
        await open(peer);
      } catch (e) {
        peer?.destroy();
        peer = null;
        if (e.type === 'unavailable-id') { bus?.close(); throw new Error('taken'); }
        if (!bus) throw new Error('network');
      }
      if (bus) {
        const up = await bus.ready(peer ? 1500 : 8000);
        if (!peer && !up) { bus.close(); throw new Error('network'); }
        if (!resume && up) { // is another room already using this code?
          let clash = false;
          bus.subscribe(`${home}/w`, (m) => { if (m.t === 'taken') clash = true; });
          bus.publish(`${home}/g`, { t: 'whois' });
          await sleep(1200);
          if (clash) { peer?.destroy(); bus.close(); throw new Error('taken'); }
        }
      }

      const subs = new Set();
      const status = statusFeed();
      const conns = new Map(); // connection -> player uid
      const broadcast = () => {
        const key = seatsKey(room);
        const direct = new Set([...conns].filter(([c]) => !c.relay && c.open).map(([, u]) => u)); // guests already reached directly
        for (const conn of [...conns.keys()]) {
          if (conn.relay && Date.now() - conn.last > 90000) { conns.delete(conn); continue; }
          if (!conn.open || (conn.relay && direct.has(conns.get(conn)))) continue;
          // over the backup route, only resend the seats (which carry the icons) when they changed
          if (conn.relay && room.game && conn.seats === key) conn.send({ t: 'game', game: room.game, status: room.status });
          else { conn.send({ t: 'room', room }); conn.seats = key; }
        }
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
        if (msg.t === 'hello') { conn.send({ t: 'room', room }); conn.seats = seatsKey(room); return; }
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
        conn.seats = seatsKey(room);
      };

      if (peer) {
        peer.on('connection', (conn) => {
          conns.set(conn, conn.metadata?.uid ?? null);
          conn.on('data', (msg) => onGuestMessage(conn, msg));
          conn.on('close', () => conns.delete(conn));
        });
      }

      // Guests on the backup route: each one has its own reply topic, and says who they are in every message.
      const relayConns = new Map(); // uid -> pseudo connection
      if (bus) {
        bus.subscribe(`${home}/g`, (msg) => {
          if (msg.t === 'whois') { if (room) bus.publish(`${home}/w`, { t: 'taken' }); return; }
          const from = typeof msg.uid === 'string' ? msg.uid.slice(0, 80) : '';
          if (!from) return;
          if (msg.t === 'bye') { const c = relayConns.get(from); if (c) { conns.delete(c); relayConns.delete(from); } return; }
          let conn = relayConns.get(from);
          if (!conn) {
            conn = { relay: true, open: true, last: Date.now(), seats: '', send: (m) => bus.publish(`${home}/h/${from}`, m) };
            relayConns.set(from, conn);
          }
          conns.set(conn, from);
          conn.last = Date.now();
          // a guest that already holds the current seats only needs the game
          if (msg.t === 'hello' && room?.game && msg.have === hashOf(seatsKey(room))) { conn.seats = seatsKey(room); conn.send({ t: 'game', game: room.game, status: room.status }); return; }
          onGuestMessage(conn, msg);
        });
      }

      // A locked or backgrounded phone drops its link to the signalling server; get it back.
      let regain = 0;
      const regainSignal = () => {
        if (!peer || peer.destroyed || !peer.disconnected) return;
        if (!bus?.alive) status.set('reconnecting');
        try { peer.reconnect(); } catch { /* not ready yet; the timer tries again */ }
        clearTimeout(regain);
        regain = setTimeout(regainSignal, 3000);
      };
      peer?.on('disconnected', regainSignal);
      peer?.on('open', () => { clearTimeout(regain); status.set('online'); });
      const onVisible = () => { if (!document.hidden) regainSignal(); };
      document.addEventListener('visibilitychange', onVisible);

      return {
        async get() { return snapshotOf(room); },
        async set(next) { publish(JSON.parse(JSON.stringify(next))); },
        async acquire() { return { acquired: true }; },
        onSnapshot(next) { subs.add(next); next(snapshotOf(room)); return () => subs.delete(next); },
        onStatus: status.on,
        retry: regainSignal,
        close() {
          clearTimeout(regain);
          document.removeEventListener('visibilitychange', onVisible);
          for (const conn of conns.keys()) if (conn.open) conn.send({ t: 'bye' }); // so guests leave at once
          tryStorage(() => localStorage.removeItem(keyOf(code)));
          setTimeout(() => { peer?.destroy(); bus?.close(); }, 400);
        },
      };
    },

    async join(code) {
      const home = `${ROOT}/${code}`;
      const bus = useRelay ? relayBus(brokers) : null;
      let peer = null;
      try { peer = new Peer(undefined, peerOptions); await open(peer); } catch { peer?.destroy(); peer = null; if (!bus) throw new Error('network'); }

      let room = null; // the last room we were sent; kept while reconnecting
      let fresh = true; // the next room message is the first on a new connection
      let conn = null;
      let closed = false;
      let lastSeen = Date.now();
      let relayLast = 0; // when the backup route last heard from the host
      const subs = new Set();
      const errors = new Set();
      const status = statusFeed();
      const relayOk = () => !!bus && Date.now() - relayLast < 45000;
      const notify = () => subs.forEach((cb) => cb(snapshotOf(room)));

      // Direct route.
      let latest = null; // the newest connection attempt; anything from an older one is ignored
      const connect = () => new Promise((resolve, reject) => {
        if (!peer) { reject(new Error('network')); return; }
        const c = peer.connect(PEER_PREFIX + code, { metadata: { uid }, reliable: true });
        latest = c;
        const timer = setTimeout(() => reject(new Error('timeout')), 15000); // slow networks can take a while
        const onPeerError = (e) => { if (e.type === 'peer-unavailable') { clearTimeout(timer); reject(new Error('notfound')); } };
        peer.on('error', onPeerError);
        c.on('open', () => c.send({ t: 'hello' }));
        c.on('data', (msg) => {
          if (c !== latest) return;
          lastSeen = Date.now();
          if (msg.t === 'bye') { closed = true; errors.forEach((cb) => cb({ code: 'closed' })); return; }
          if (msg.t !== 'room') return;
          clearTimeout(timer);
          peer.off('error', onPeerError);
          room = msg.room;
          if (fresh || !conn) { fresh = false; conn = c; status.set('online'); resolve(); }
          notify();
        });
        c.on('close', () => { if (!closed && conn === c) reconnect(); });
      });

      // Backup route: say hello until the host answers, then keep saying it as a heartbeat.
      let helloTimer = 0;
      let raceDone = false;
      const hello = () => bus.publish(`${home}/g`, { t: 'hello', uid, have: room ? hashOf(seatsKey(room)) : 0 });
      const relayFirst = () => new Promise((resolve, reject) => {
        let first = true;
        const timer = setTimeout(() => reject(new Error('timeout')), 8000);
        bus.subscribe(`${home}/h/${uid}`, (msg) => {
          relayLast = Date.now();
          if (msg.t === 'bye') { closed = true; errors.forEach((cb) => cb({ code: 'closed' })); return; }
          if (msg.t === 'room') room = msg.room;
          else if (msg.t === 'game' && room) room = { ...room, game: msg.game, status: msg.status };
          else if (msg.t === 'game') { hello(); return; } // we missed the seats: ask for everything
          else return;
          if (first) { first = false; clearTimeout(timer); fresh = false; status.set('online'); resolve(); }
          notify();
        });
        bus.ready(8000).then((up) => {
          if (!up) { clearTimeout(timer); reject(new Error('network')); return; }
          hello();
          if (!raceDone) helloTimer = setInterval(() => { if (!room || Date.now() - relayLast > 4000) hello(); }, 2000);
        });
      });

      // Keeps trying for about two minutes, since the host may only have locked their phone for a moment.
      let retrying = false;
      async function reconnect() {
        if (retrying || closed) return;
        retrying = true;
        if (!relayOk()) status.set('reconnecting');
        for (let i = 0; i < 30 && !closed; i++) {
          await sleep(Math.min(1500 + i * 500, 5000));
          try {
            if (peer?.disconnected) peer.reconnect();
            fresh = true; // the first message after reconnecting replaces our connection
            await connect();
            retrying = false;
            return;
          } catch { /* try again */ }
          if (relayOk()) status.set('online');
        }
        retrying = false;
        if (relayOk()) return;
        status.set('lost');
        errors.forEach((cb) => cb({ code: 'lost' }));
      }

      // Take whichever route answers first. A wrong code is only reported once the backup route has had its say.
      const direct = connect().catch(async (e) => { if (e.message === 'notfound') await sleep(3000); throw e; });
      const backup = bus ? relayFirst() : Promise.reject(new Error('network'));
      try {
        await Promise.any([direct, backup]);
      } catch (all) {
        const errs = all.errors || [];
        peer?.destroy();
        bus?.close();
        clearInterval(helloTimer);
        throw errs.find((e) => e.message === 'notfound') || errs.find((e) => e.message === 'timeout') || errs[0] || new Error('network');
      }
      raceDone = true;
      backup.catch(() => {}); // the loser may still fail later; that is fine
      direct.catch(() => {});

      // A phone that was backgrounded can keep a dead link open; ping so it is noticed, and recheck on wake-up.
      const beat = setInterval(() => {
        if (closed || retrying || !conn) return;
        if (Date.now() - lastSeen > 25000) { conn.close(); return; }
        if (conn.open) conn.send({ t: 'ping' });
      }, 8000);
      const onVisible = () => {
        if (document.hidden || closed || retrying) return;
        if (!conn?.open || Date.now() - lastSeen > 25000) { try { conn?.close(); } catch { /* already closed */ } if (conn) reconnect(); }
        if (bus) hello();
      };
      document.addEventListener('visibilitychange', onVisible);
      if (bus) { clearInterval(helloTimer); helloTimer = setInterval(hello, 20000); }

      return {
        async get() { return snapshotOf(room); },
        async set(next) {
          // A move only needs the game; everything else (seats, icons) is the host's to keep.
          const sent = next.game ? { game: next.game, status: next.status } : next;
          if (conn?.open) { conn.send({ t: 'set', room: JSON.parse(JSON.stringify(sent)) }); return; }
          if (bus?.alive) { bus.publish(`${home}/g`, { t: 'set', uid, room: JSON.parse(JSON.stringify(sent)) }); return; }
          throw new Error('offline');
        },
        async acquire() { return { acquired: true }; },
        onSnapshot(next, error) { subs.add(next); if (error) errors.add(error); next(snapshotOf(room)); return () => { subs.delete(next); errors.delete(error); }; },
        onStatus: status.on,
        retry: () => { try { conn?.close(); } catch { /* already closed */ } retrying = false; if (peer) reconnect(); else if (bus) hello(); },
        close() {
          closed = true;
          clearInterval(beat);
          clearInterval(helloTimer);
          document.removeEventListener('visibilitychange', onVisible);
          if (bus) bus.publish(`${home}/g`, { t: 'bye', uid });
          setTimeout(() => { peer?.destroy(); bus?.close(); }, 300);
        },
      };
    },
  };
}
