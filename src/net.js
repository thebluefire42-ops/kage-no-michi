// Online co-op transport: WebRTC peer-to-peer via PeerJS (loaded from a CDN in index.html).
// The host registers as `kage-michi-v1-<KEY>`; the joiner connects to that id.
// Messages are small objects { t: type, ...payload } over one reliable data channel.

const PREFIX = 'kage-michi-v1-';
const ALPHABET = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789'; // no 0/O, 1/I/L
const CONNECT_TIMEOUT = 12000;

export function makeKey() {
  let k = '';
  for (let i = 0; i < 6; i++) k += ALPHABET[Math.floor(Math.random() * ALPHABET.length)];
  return k;
}

// accepts a bare key or a pasted invite link
export function parseKey(text) {
  if (!text) return '';
  const m = String(text).match(/[?&]join=([A-Za-z0-9]+)/);
  const raw = (m ? m[1] : text).toUpperCase().replace(/[^A-Z0-9]/g, '');
  return raw.slice(0, 6);
}

export function inviteLink(key) {
  const u = new URL(location.href);
  u.search = ''; u.hash = '';
  u.searchParams.set('join', key);
  return u.toString();
}

class Net {
  constructor() {
    this.peer = null; this.conn = null;
    this.role = null;          // 'host' | 'client' | null
    this.key = '';
    this.status = 'idle';      // idle | starting | waiting | connecting | connected | error | closed
    this.error = '';
    this.handlers = {};
    this.timer = null;
  }

  get available() { return typeof window.Peer === 'function'; }
  get connected() { return this.status === 'connected' && this.conn && this.conn.open; }

  on(type, fn) { (this.handlers[type] || (this.handlers[type] = [])).push(fn); }
  off(type) { delete this.handlers[type]; }
  emit(type, msg) { for (const fn of this.handlers[type] || []) fn(msg); }

  setStatus(s, err = '') { this.status = s; this.error = err; this.emit('status', { status: s, error: err }); }

  host() {
    this.close();
    if (!this.available) { this.setStatus('error', 'Online play needs an internet connection (PeerJS failed to load).'); return; }
    this.role = 'host';
    this.key = makeKey();
    this.setStatus('starting');
    const peer = new window.Peer(PREFIX + this.key, { debug: 0 });
    this.peer = peer;
    peer.on('open', () => this.setStatus('waiting'));
    peer.on('connection', (conn) => {
      if (this.conn && this.conn.open) { conn.on('open', () => { conn.send({ t: 'full' }); setTimeout(() => conn.close(), 300); }); return; }
      this.attach(conn);
    });
    peer.on('error', (e) => {
      if (e.type === 'unavailable-id') { this.host(); return; } // key collision: pick another
      if (this.status !== 'connected') this.setStatus('error', friendlyError(e));
    });
    peer.on('disconnected', () => { if (this.status === 'waiting') peer.reconnect(); });
  }

  join(key) {
    this.close();
    if (!this.available) { this.setStatus('error', 'Online play needs an internet connection (PeerJS failed to load).'); return; }
    this.role = 'client';
    this.key = key;
    this.setStatus('connecting');
    const peer = new window.Peer({ debug: 0 });
    this.peer = peer;
    peer.on('open', () => {
      const conn = peer.connect(PREFIX + key, { reliable: true });
      this.attach(conn);
    });
    peer.on('error', (e) => { if (this.status !== 'connected') this.setStatus('error', e.type === 'peer-unavailable' ? `No game found for key ${key}.` : friendlyError(e)); });
    this.timer = setTimeout(() => { if (this.status === 'connecting') { this.setStatus('error', 'Could not connect. Check the key, or try again.'); } }, CONNECT_TIMEOUT);
  }

  attach(conn) {
    this.conn = conn;
    conn.on('open', () => { clearTimeout(this.timer); this.setStatus('connected'); this.emit('connected', {}); });
    conn.on('data', (msg) => {
      if (!msg || !msg.t) return;
      if (msg.t === 'full') { this.setStatus('error', 'That game is already full.'); return; }
      this.emit(msg.t, msg);
    });
    conn.on('close', () => { const was = this.status; this.conn = null; if (was === 'connected') { this.setStatus(this.role === 'host' ? 'waiting' : 'closed', 'Your partner disconnected.'); this.emit('disconnect', {}); } });
    conn.on('error', () => {});
  }

  send(t, payload = {}) {
    if (!this.connected) return;
    try { this.conn.send({ t, ...payload }); } catch (e) { /* channel closing */ }
  }

  close() {
    clearTimeout(this.timer);
    try { if (this.conn) this.conn.close(); } catch (e) { /* ignore */ }
    try { if (this.peer) this.peer.destroy(); } catch (e) { /* ignore */ }
    this.peer = null; this.conn = null; this.role = null; this.key = '';
    this.status = 'idle'; this.error = '';
  }
}

function friendlyError(e) {
  switch (e && e.type) {
    case 'network': case 'server-error': case 'socket-error': case 'socket-closed': return 'Could not reach the connection service. Check your internet connection.';
    case 'browser-incompatible': return 'This browser does not support online play.';
    default: return `Connection problem (${(e && e.type) || 'unknown'}).`;
  }
}

export const net = new Net();
