// Fallback connection for players whose networks block direct phone-to-phone links.
//
// Game messages are passed through free public MQTT brokers over secure websockets (ports 443 and
// 8884/8084, which mobile networks allow). It is a tiny publish/subscribe client: no accounts and no
// library. The bus talks to several brokers at once and drops duplicate messages, so one broker being
// down does not matter. Anything sent this way is visible to whoever knows the room code, so it is the
// backup route, used only when a direct connection cannot be made.

export const ROOT = 'rollick-v1';
export const DEFAULT_BROKERS = [
  'wss://broker.emqx.io:8084/mqtt',
  'wss://broker.hivemq.com:8884/mqtt',
  'wss://mqtt.eclipseprojects.io/mqtt',
];

const enc = new TextEncoder();
const dec = new TextDecoder();
const rand = () => Math.random().toString(36).slice(2, 10) + Date.now().toString(36);

const str = (s) => { const b = enc.encode(s); return [b.length >> 8, b.length & 255, ...b]; };
function lengthBytes(n) {
  const out = [];
  do { let b = n % 128; n = Math.floor(n / 128); if (n > 0) b |= 128; out.push(b); } while (n > 0);
  return out;
}
function packet(type, flags, body) {
  const head = [(type << 4) | flags, ...lengthBytes(body.length)];
  const out = new Uint8Array(head.length + body.length);
  out.set(head);
  out.set(body, head.length);
  return out;
}
const join = (a, b) => { const out = new Uint8Array(a.length + b.length); out.set(a); out.set(b, a.length); return out; };

/** One broker connection. Reconnects by itself and resubscribes. */
function mqttClient(url, onMessage) {
  let ws = null;
  let timer = 0;
  let ping = 0;
  let tries = 0;
  let nextId = 1;
  let buf = new Uint8Array(0);
  const topics = new Set();
  const client = { open: false };
  let closed = false;

  const send = (bytes) => { try { if (ws?.readyState === 1) ws.send(bytes); } catch { /* socket closing */ } };
  const subscribe = (topic) => send(packet(8, 2, [nextId >> 8, nextId++ & 255, ...str(topic), 0]));

  function drain() {
    for (;;) {
      if (buf.length < 2) return;
      let len = 0;
      let mult = 1;
      let i = 1;
      let more = true;
      while (more) {
        if (i >= buf.length) return; // length not complete yet
        const b = buf[i++];
        len += (b & 127) * mult;
        mult *= 128;
        more = (b & 128) !== 0;
      }
      if (buf.length < i + len) return; // packet not complete yet
      const type = buf[0] >> 4;
      const body = buf.slice(i, i + len);
      buf = buf.slice(i + len);
      if (type === 2) { // CONNACK
        if (body[1] === 0) {
          client.open = true;
          tries = 0;
          topics.forEach(subscribe);
          clearInterval(ping);
          ping = setInterval(() => send(new Uint8Array([0xc0, 0])), 15000);
        }
      } else if (type === 3) { // PUBLISH
        const tl = (body[0] << 8) | body[1];
        const topic = dec.decode(body.slice(2, 2 + tl));
        onMessage(topic, body.slice(2 + tl)); // we only subscribe at QoS 0, so there is no packet id
      }
    }
  }

  function begin() {
    if (closed) return;
    let sock;
    try { sock = new WebSocket(url, 'mqtt'); } catch { retry(); return; }
    ws = sock;
    sock.binaryType = 'arraybuffer';
    buf = new Uint8Array(0);
    sock.onopen = () => send(packet(1, 0, [...str('MQTT'), 4, 2, 0, 30, ...str(`rl${rand()}`)]));
    sock.onmessage = (e) => { buf = join(buf, new Uint8Array(e.data)); drain(); };
    const gone = () => {
      if (ws !== sock) return;
      client.open = false;
      clearInterval(ping);
      retry();
    };
    sock.onclose = gone;
    sock.onerror = gone;
  }
  function retry() {
    if (closed) return;
    clearTimeout(timer);
    timer = setTimeout(begin, Math.min(1000 * 2 ** tries++, 15000));
  }
  begin();

  return {
    client,
    subscribe(topic) { topics.add(topic); if (client.open) subscribe(topic); },
    publish(topic, bytes) { if (client.open) send(packet(3, 0, [...str(topic), ...bytes])); },
    close() { closed = true; clearTimeout(timer); clearInterval(ping); try { ws?.close(); } catch { /* closed */ } },
  };
}

/** Several brokers behaving as one: subscribe(topic, cb), publish(topic, object), ready(ms). */
export function relayBus(urls = DEFAULT_BROKERS) {
  const subs = new Map();
  const seen = new Set();
  const order = [];
  const clients = urls.map((url) => mqttClient(url, (topic, bytes) => {
    let msg;
    try { msg = JSON.parse(dec.decode(bytes)); } catch { return; }
    if (!msg || typeof msg !== 'object') return;
    if (msg._m) {
      if (seen.has(msg._m)) return; // the same message arrives from every broker
      seen.add(msg._m);
      order.push(msg._m);
      if (order.length > 400) seen.delete(order.shift());
    }
    subs.get(topic)?.forEach((cb) => cb(msg));
  }));
  return {
    get alive() { return clients.some((c) => c.client.open); },
    subscribe(topic, cb) {
      if (!subs.has(topic)) { subs.set(topic, new Set()); clients.forEach((c) => c.subscribe(topic)); }
      subs.get(topic).add(cb);
    },
    publish(topic, obj) {
      const bytes = enc.encode(JSON.stringify({ ...obj, _m: rand() }));
      clients.forEach((c) => c.publish(topic, bytes));
    },
    /** Resolves true as soon as any broker is connected, or false after `ms`. */
    ready(ms = 6000) {
      return new Promise((resolve) => {
        const t0 = Date.now();
        const look = () => {
          if (clients.some((c) => c.client.open)) resolve(true);
          else if (Date.now() - t0 > ms) resolve(false);
          else setTimeout(look, 100);
        };
        look();
      });
    },
    close() { clients.forEach((c) => c.close()); },
  };
}

/** Can this network reach any fallback broker? */
export async function checkFallback(urls = DEFAULT_BROKERS, ms = 6000) {
  const bus = relayBus(urls);
  const ok = await bus.ready(ms);
  bus.close();
  return ok;
}
