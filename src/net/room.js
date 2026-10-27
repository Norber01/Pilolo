// Room + game-phase logic shared by every client.
//
// Data layout (Realtime Database):
// rooms/{CODE}/meta            { createdAt }
// rooms/{CODE}/state           { phase, round, diceRound, contenders, rolls, hiderId, startsAt, endsAt, winner, foundBy, reason, scores }
// rooms/{CODE}/searched/{bush} true  (bushes the seekers already checked this round)
// rooms/{CODE}/players/{uid}   { name, color, joinedAt, roll, hidden, s }
//
// There is no game server: any client may advance the phase, always through a transaction so
// two clients can never both apply the same transition.
import { GAME } from '../config.js';
import { PLAYER_COLORS } from '../entities/character.js';

const CODE_CHARS = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789';
export const makeCode = () => Array.from({ length: 5 }, () => CODE_CHARS[Math.floor(Math.random() * CODE_CHARS.length)]).join('');
const r2 = (v) => Math.round(v * 100) / 100;
const BOT_NAMES = ['🤖 Zuri', '🤖 Juma', '🤖 Nala', '🤖 Tano'];

export class Room {
  constructor(backend, { minPlayers = GAME.minPlayers } = {}) {
    this.b = backend;
    this.uid = backend.uid;
    this.minPlayers = minPlayers;
    this.data = null;
    this.listeners = new Set();
    this.code = null;
  }

  get base() { return `rooms/${this.code}`; }
  get state() { return this.data?.state || { phase: 'lobby', round: 0 }; }
  get players() {
    const p = this.data?.players || {};
    return Object.entries(p).map(([id, v]) => ({ id, ...v })).sort((a, b) => a.joinedAt - b.joinedAt);
  }
  get humans() { return this.players.filter((p) => !p.bot); }
  get hostId() { return this.humans[0]?.id; }
  get myBots() { return this.players.filter((p) => p.bot === this.uid); }
  get isHost() { return this.hostId === this.uid; }
  get me() { return this.data?.players?.[this.uid]; }
  player(id) { return this.data?.players?.[id]; }
  onChange(fn) { this.listeners.add(fn); return () => this.listeners.delete(fn); }

  async create(name) {
    let code;
    for (let i = 0; i < 10; i++) {
      code = makeCode();
      if (!(await this.b.get(`rooms/${code}/meta`))) break;
    }
    this.code = code;
    await this.b.set(this.base, {
      meta: { createdAt: this.b.now() },
      state: { phase: 'lobby', round: 0 },
    });
    await this.enter(name, []);
    return code;
  }

  async join(code, name) {
    code = code.trim().toUpperCase();
    const room = await this.b.get(`rooms/${code}`);
    if (!room || !room.meta) throw new Error(`Room ${code} does not exist.`);
    const others = Object.entries(room.players || {}).filter(([id]) => id !== this.uid);
    if (others.length >= GAME.maxPlayers) throw new Error(`Room ${code} is full (${GAME.maxPlayers} players max).`);
    this.code = code;
    await this.enter(name, others.map(([, p]) => p.color));
    return code;
  }

  async enter(name, usedColors) {
    const color = PLAYER_COLORS.find((c) => !usedColors.includes(c)) || PLAYER_COLORS[0];
    const path = `${this.base}/players/${this.uid}`;
    await this.b.set(path, { name: name.slice(0, 16), color, joinedAt: this.b.now() });
    await this.b.onDisconnectRemove(path);
    this.unsub = this.b.subscribe(this.base, (v) => {
      this.data = v;
      for (const fn of this.listeners) fn(this);
    });
  }

  async leave() {
    if (!this.code) return;
    this.unsub?.();
    const alone = this.humans.length <= 1;
    if (!alone) for (const bot of this.myBots) await this.b.remove(`${this.base}/players/${bot.id}`);
    await this.b.remove(alone ? this.base : `${this.base}/players/${this.uid}`);
    this.code = null;
    this.data = null;
  }

  // ---- actions --------------------------------------------------------------

  sendPose(s, id = this.uid) {
    if (!this.code) return;
    this.b.set(`${this.base}/players/${id}/s`, {
      x: r2(s.x), y: r2(s.y), z: r2(s.z), h: r2(s.h), v: r2(s.v), a: s.a ? 1 : 0, c: s.c ? 1 : 0, hp: Math.round(s.hp),
    });
  }

  async startGame(settings = {}) {
    const ids = this.players.map((p) => p.id);
    if (ids.length < this.minPlayers) return;
    await this.b.remove(`${this.base}/searched`);
    await this.tx((cur) => {
      if (cur.phase !== 'lobby' && cur.phase !== 'ended') return undefined;
      return {
        phase: 'dice', round: (cur.round || 0) + 1, diceRound: 1,
        contenders: Object.fromEntries(ids.map((id) => [id, true])),
        scores: cur.scores || {},
        hideSeconds: settings.hideSeconds || GAME.hideSeconds,
        seekSeconds: settings.seekSeconds || GAME.seekSeconds,
      };
    });
  }

  async backToLobby() {
    await this.tx((cur) => ({ phase: 'lobby', round: cur.round || 0, scores: cur.scores || {} }));
  }

  roll(id = this.uid) {
    const st = this.state;
    const v = 1 + Math.floor(Math.random() * 6);
    this.b.set(`${this.base}/players/${id}/roll`, { v, r: st.diceRound, g: st.round });
    return v;
  }

  hide(bushId, id = this.uid) {
    this.b.set(`${this.base}/players/${id}/hidden`, { b: bushId, g: this.state.round });
  }
  unhide(id = this.uid) { this.b.remove(`${this.base}/players/${id}/hidden`); }

  // ---- bots: computer players simulated by the client that added them --------
  async addBot() {
    const players = this.players;
    if (players.length >= GAME.maxPlayers) throw new Error(`The room is full (${GAME.maxPlayers} players max).`);
    const used = players.map((p) => p.name);
    const name = BOT_NAMES.find((n) => !used.includes(n)) || `Bot ${players.length}`;
    const id = 'bot-' + Math.random().toString(36).slice(2, 8);
    const color = PLAYER_COLORS.find((c) => !players.some((p) => p.color === c)) || PLAYER_COLORS[3];
    const path = `${this.base}/players/${id}`;
    await this.b.set(path, { name, color, joinedAt: this.b.now(), bot: this.uid });
    // If the owner's device drops, its bots leave with it.
    await this.b.onDisconnectRemove(path);
  }

  removeBot(id) {
    if (this.player(id)?.bot === this.uid) this.b.remove(`${this.base}/players/${id}`);
  }
  markSearched(bushId) { this.b.set(`${this.base}/searched/${bushId}`, true); }

  /** Bush id the hider is currently in, or null. */
  hiddenBush(id) {
    const h = this.player(id)?.hidden;
    return h && h.g === this.state.round ? h.b : null;
  }

  async found(byUid) {
    const now = this.b.now();
    await this.tx((cur) => {
      if (cur.phase !== 'seeking') return undefined;
      const scores = { ...(cur.scores || {}) };
      scores[byUid] = (scores[byUid] || 0) + 1;
      return { ...cur, phase: 'ended', winner: 'seekers', foundBy: byUid, endedAt: now, scores };
    });
  }

  /** Called ~4x per second by every client; advances the game when its conditions are met. */
  tick() {
    const st = this.state;
    if (!this.data || this.busy) return;
    const now = this.b.now();
    const present = this.players.map((p) => p.id);

    if (st.phase === 'dice') {
      let contenders = Object.keys(st.contenders || {}).filter((id) => present.includes(id));
      if (contenders.length === 0) contenders = present;
      const rolls = {};
      for (const id of contenders) {
        const r = this.player(id)?.roll;
        if (r && r.r === st.diceRound && r.g === st.round) rolls[id] = r.v;
      }
      if (Object.keys(rolls).length === contenders.length && contenders.length > 0) {
        const max = Math.max(...Object.values(rolls));
        const top = contenders.filter((id) => rolls[id] === max);
        this.tx((cur) => {
          if (cur.phase !== 'dice' || cur.diceRound !== st.diceRound || cur.round !== st.round) return undefined;
          const history = [...(cur.history || []), rolls];
          if (top.length > 1) {
            return { ...cur, diceRound: cur.diceRound + 1, contenders: Object.fromEntries(top.map((id) => [id, true])), history };
          }
          const startsAt = now + 4500;
          return { ...cur, phase: 'hiding', hiderId: top[0], history, startsAt, endsAt: startsAt + (cur.hideSeconds || GAME.hideSeconds) * 1000 };
        });
      }
      return;
    }

    if (st.phase === 'hiding' || st.phase === 'seeking') {
      if (!present.includes(st.hiderId)) return this.end('none', 'The hider left the game.');
      if (present.length < Math.min(2, this.minPlayers)) return this.end('none', 'Not enough players left.');
      if (now < st.endsAt) return;
      if (st.phase === 'hiding') {
        this.tx((cur) => {
          if (cur.phase !== 'hiding' || cur.round !== st.round) return undefined;
          return { ...cur, phase: 'seeking', startsAt: now, endsAt: now + (cur.seekSeconds || GAME.seekSeconds) * 1000 };
        });
      } else {
        this.end('hider', 'Time ran out — nobody found the hider!');
      }
    }
  }

  end(winner, reason) {
    const st = this.state;
    const now = this.b.now();
    this.tx((cur) => {
      if ((cur.phase !== 'hiding' && cur.phase !== 'seeking') || cur.round !== st.round) return undefined;
      const scores = { ...(cur.scores || {}) };
      if (winner === 'hider') scores[cur.hiderId] = (scores[cur.hiderId] || 0) + 1;
      return { ...cur, phase: 'ended', winner, reason, endedAt: now, scores };
    });
  }

  async tx(fn) {
    this.busy = true;
    try {
      // Firebase may call us with null before it has the server value; returning null then
      // makes it retry with the real data.
      return await this.b.transaction(`${this.base}/state`, (cur) => (cur == null ? null : fn(cur)));
    } catch (e) {
      console.warn('transaction failed', e);
    } finally {
      this.busy = false;
    }
  }
}
