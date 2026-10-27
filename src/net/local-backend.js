// Offline stand-in for Firebase: a tiny in-memory database synced between browser tabs
// on the same computer with BroadcastChannel. Lets you test multiplayer with zero setup.

const clone = (v) => (v === undefined ? null : structuredClone(v));
const split = (p) => p.split('/').filter(Boolean);

export class LocalBackend {
  constructor() {
    this.kind = 'local';
    this.tree = {};
    this.subs = new Set();
    this.disconnect = new Set();
    this.channel = new BroadcastChannel('hide-seek-wildlands');
    this.channel.onmessage = (e) => this.onMessage(e.data);
  }

  async init() {
    this.uid = 'local-' + Math.random().toString(36).slice(2, 10);
    this.channel.postMessage({ type: 'hello', from: this.uid });
    // Give other tabs a moment to send us their copy of the data.
    await new Promise((r) => setTimeout(r, 250));
    const bye = () => {
      for (const p of this.disconnect) this.write(p, null, true);
    };
    window.addEventListener('pagehide', bye);
    window.addEventListener('beforeunload', bye);
    return this.uid;
  }

  onMessage(msg) {
    if (msg.type === 'hello') this.channel.postMessage({ type: 'snapshot', to: msg.from, tree: this.tree });
    else if (msg.type === 'snapshot' && msg.to === this.uid && Object.keys(this.tree).length === 0) {
      this.tree = msg.tree || {};
      this.notify('');
    } else if (msg.type === 'write') this.write(msg.path, msg.value, false);
  }

  now() { return Date.now(); }

  read(path) {
    let node = this.tree;
    for (const k of split(path)) {
      if (node == null || typeof node !== 'object') return null;
      node = node[k];
    }
    return node === undefined ? null : node;
  }

  write(path, value, broadcast) {
    const keys = split(path);
    if (keys.length === 0) { this.tree = clone(value) || {}; }
    else {
      let node = this.tree;
      for (let i = 0; i < keys.length - 1; i++) {
        if (node[keys[i]] == null || typeof node[keys[i]] !== 'object') {
          if (value === null) return this.after(path, broadcast, value);
          node[keys[i]] = {};
        }
        node = node[keys[i]];
      }
      const last = keys[keys.length - 1];
      if (value === null) delete node[last];
      else node[last] = clone(value);
      // Like Firebase, empty parents disappear.
      this.prune(keys);
    }
    this.after(path, broadcast, value);
  }

  prune(keys) {
    for (let d = keys.length - 1; d >= 1; d--) {
      const parent = d === 1 ? this.tree : this.read(keys.slice(0, d - 1).join('/'));
      const node = parent?.[keys[d - 1]];
      if (node && typeof node === 'object' && Object.keys(node).length === 0) delete parent[keys[d - 1]];
      else break;
    }
  }

  after(path, broadcast, value) {
    if (broadcast) this.channel.postMessage({ type: 'write', path, value: clone(value) });
    this.notify(path);
  }

  notify(path) {
    const p = split(path).join('/');
    for (const s of this.subs) {
      if (p === '' || s.path === '' || p.startsWith(s.path + '/') || s.path.startsWith(p + '/') || p === s.path) {
        s.cb(clone(this.read(s.path)));
      }
    }
  }

  async get(path) { return clone(this.read(path)); }
  async set(path, value) { this.write(path, value, true); }
  async update(path, obj) {
    for (const [k, v] of Object.entries(obj)) this.write(path + '/' + k, v, true);
  }
  async remove(path) { this.write(path, null, true); }
  subscribe(path, cb) {
    const s = { path: split(path).join('/'), cb };
    this.subs.add(s);
    queueMicrotask(() => cb(clone(this.read(s.path))));
    return () => this.subs.delete(s);
  }
  async transaction(path, fn) {
    const next = fn(clone(this.read(path)));
    if (next === undefined) return { committed: false, value: this.read(path) };
    this.write(path, next, true);
    return { committed: true, value: clone(next) };
  }
  async onDisconnectRemove(path) { this.disconnect.add(path); }
}
