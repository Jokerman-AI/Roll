// Room transports. Both expose the same small "room store" shape to the game:
//   host(code, {resume}) -> ref     create a room (throws 'taken' if the code is in use)
//   join(code)           -> ref     connect to a room (throws 'notfound')
// and a ref has get(), set(room), acquire(), onSnapshot(next, error), close().
// A snapshot is { exists, data() } where data() is the whole room document.

const PEER_PREFIX = 'rollforit-';
const MAX_SEATS = 8;
const keyOf = (code) => `rfi-room-${code}`;

function tryStorage(fn) {
  try { return fn(); } catch { return null; }
}

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

/** Rooms held in the host's browser, reached over WebRTC through PeerJS. */
export function p2pStore(Peer, options, uid) {
  const open = (peer) => new Promise((resolve, reject) => {
    peer.on('open', resolve);
    peer.on('error', (e) => reject(Object.assign(new Error(e.type), { type: e.type })));
  });

  return {
    kind: 'p2p',

    async host(code, { resume = false } = {}) {
      let room = resume ? tryStorage(() => JSON.parse(localStorage.getItem(keyOf(code)))) : null;
      if (resume && !room) throw new Error('notfound');
      const peer = new Peer(PEER_PREFIX + code, options);
      try { await open(peer); } catch (e) { peer.destroy(); throw new Error(e.type === 'unavailable-id' ? 'taken' : 'network'); }

      const subs = new Set();
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
        if (msg.t === 'hello') { conn.send({ t: 'room', room }); return; }
        if (msg.t !== 'set' || !msg.room) return;
        if (room.status === 'lobby') {
          const mine = msg.room.seats?.find((p) => p.uid === sender);
          if (mine && !room.seats.some((p) => p.uid === sender) && room.seats.length < MAX_SEATS) {
            publish({ ...room, seats: [...room.seats, { uid: sender, name: String(mine.name).slice(0, 12), cpu: false }] });
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
      peer.on('disconnected', () => peer.reconnect());

      return {
        async get() { return snapshotOf(room); },
        async set(next) { publish(JSON.parse(JSON.stringify(next))); },
        async acquire() { return { acquired: true }; },
        onSnapshot(next) { subs.add(next); next(snapshotOf(room)); return () => subs.delete(next); },
        close() { peer.destroy(); },
      };
    },

    async join(code) {
      const peer = new Peer(undefined, options);
      try { await open(peer); } catch { peer.destroy(); throw new Error('network'); }

      let room = null;
      let conn = null;
      let closed = false;
      const subs = new Set();
      const errors = new Set();

      const connect = () => new Promise((resolve, reject) => {
        const c = peer.connect(PEER_PREFIX + code, { metadata: { uid }, reliable: true });
        const timer = setTimeout(() => reject(new Error('notfound')), 8000);
        const onPeerError = (e) => { if (e.type === 'peer-unavailable') { clearTimeout(timer); reject(new Error('notfound')); } };
        peer.on('error', onPeerError);
        c.on('open', () => c.send({ t: 'hello' }));
        c.on('data', (msg) => {
          if (msg.t !== 'room') return;
          clearTimeout(timer);
          peer.off('error', onPeerError);
          const first = room === null;
          room = msg.room;
          if (first) { conn = c; resolve(); }
          subs.forEach((cb) => cb(snapshotOf(room)));
        });
        c.on('close', () => { if (!closed && conn === c) reconnect(); });
      });

      let retrying = false;
      async function reconnect() {
        if (retrying) return;
        retrying = true;
        for (let i = 0; i < 8 && !closed; i++) {
          await new Promise((r) => setTimeout(r, 1500));
          try {
            if (peer.disconnected) peer.reconnect();
            room = null; // so the first message after reconnecting is treated as fresh
            await connect();
            retrying = false;
            return;
          } catch { /* try again */ }
        }
        retrying = false;
        errors.forEach((cb) => cb({ code: 'lost' }));
      }

      await connect().catch((e) => { peer.destroy(); throw e; });

      return {
        async get() { return snapshotOf(room); },
        async set(next) { if (conn?.open) conn.send({ t: 'set', room: JSON.parse(JSON.stringify(next)) }); },
        async acquire() { return { acquired: true }; },
        onSnapshot(next, error) { subs.add(next); if (error) errors.add(error); next(snapshotOf(room)); return () => { subs.delete(next); errors.delete(error); }; },
        close() { closed = true; peer.destroy(); },
      };
    },
  };
}
