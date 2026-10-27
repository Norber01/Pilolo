// A computer player. It lives in the room like anyone else (players/{botId}), but its moves are
// simulated by the device that added it. The bot plays fair: as a seeker it never peeks at the
// hider's bush, it only uses the same map hints a human seeker gets.
import * as THREE from 'three';
import { GAME, PLAYER, WORLD, NET, SPAWN } from '../config.js';

const SEARCH_SECONDS = 1.3;

export class Bot {
  constructor(id, game) {
    this.id = id;
    this.game = game;
    this.room = game.room;
    this.pos = new THREE.Vector3();
    this.heading = 0;
    this.speed = 0;
    this.hp = PLAYER.maxHealth;
    this.dead = 0;
    this.hidden = null;
    this.phaseKey = '';
    this.goal = null;        // { x, z, bush?, run }
    this.wait = 0;           // seconds to stand still
    this.searching = null;   // { bush, t }
    this.rollAt = 0;
    this.stuck = { t: 0, x: 0, z: 0, dodge: 0, dir: 0 };
    this.sendTimer = 0;
    this.lastHit = -99;
    this.spawn();
  }

  get st() { return this.room.state; }
  get isHider() { return this.st.hiderId === this.id; }

  spawn() {
    const idx = Math.max(0, this.room.players.findIndex((p) => p.id === this.id));
    const a = idx * ((Math.PI * 2) / 3) + 0.4;
    this.pos.set(SPAWN.x + Math.cos(a) * 4, 0, SPAWN.z + Math.sin(a) * 4);
    this.pos.y = this.game.terrain.getHeight(this.pos.x, this.pos.z);
    this.heading = Math.atan2(-Math.cos(a), -Math.sin(a));
    this.goal = null;
  }

  enterPhase(phase) {
    this.goal = null;
    this.searching = null;
    this.wait = 0;
    if (phase === 'dice') {
      this.spawn();
      this.unhide();
      this.hp = PLAYER.maxHealth;
      this.dead = 0;
      this.rollAt = 0;
    }
    if (phase === 'hiding') this.spawn();
    if (phase === 'lobby' || phase === 'ended') this.unhide();
  }

  unhide() {
    if (this.hidden == null) return;
    this.hidden = null;
    this.room.unhide(this.id);
  }

  onHit(animal) {
    const t = performance.now() / 1000;
    if (this.dead > 0 || t - this.lastHit < 0.8) return;
    this.lastHit = t;
    this.hp -= animal.sp.damage;
    // Run away from the attacker.
    const dx = this.pos.x - animal.pos.x, dz = this.pos.z - animal.pos.z, d = Math.hypot(dx, dz) || 1;
    this.flee = { x: this.pos.x + (dx / d) * 40, z: this.pos.z + (dz / d) * 40, t: 4 };
    this.searching = null;
    if (this.hp <= 0) { this.dead = GAME.respawnSeconds; this.goal = null; }
  }

  update(dt, now) {
    const st = this.st;
    const key = `${st.phase}:${st.round}`;
    if (key !== this.phaseKey) { this.phaseKey = key; this.enterPhase(st.phase); }

    if (this.dead > 0) {
      this.dead -= dt;
      if (this.dead <= 0) { this.spawn(); this.hp = PLAYER.maxHealth; }
    } else if (performance.now() / 1000 - this.lastHit > 6) {
      this.hp = Math.min(PLAYER.maxHealth, this.hp + dt * 3);
    }

    let move = null; // { x, z, run }
    switch (st.phase) {
      case 'dice': this.doDice(now); break;
      case 'hiding':
        if (this.isHider && now >= st.startsAt) move = this.doHide(now);
        break;
      case 'seeking':
        move = this.isHider ? this.doHiderWait() : this.doSeek(dt, now);
        break;
      default:
        move = this.doIdle(dt);
    }
    if (this.dead > 0 || this.hidden != null) move = null;
    this.step(dt, move);
    this.send(dt, now);
  }

  // ---- behaviours -------------------------------------------------------------
  doDice(now) {
    const st = this.st;
    if (!st.contenders?.[this.id]) return;
    const r = this.room.player(this.id)?.roll;
    if (r && r.r === st.diceRound && r.g === st.round) return;
    if (!this.rollAt) this.rollAt = now + 900 + Math.random() * 1400; // "thinking"
    if (now >= this.rollAt) { this.rollAt = 0; this.room.roll(this.id); }
  }

  doIdle(dt) {
    // Mill around camp while waiting.
    if (this.wait > 0) { this.wait -= dt; return null; }
    if (!this.goal || this.dist(this.goal) < 1.5) {
      if (this.goal) { this.goal = null; this.wait = 2 + Math.random() * 4; return null; }
      const a = Math.random() * Math.PI * 2, r = 4 + Math.random() * 14;
      this.goal = { x: SPAWN.x + Math.cos(a) * r, z: SPAWN.z + Math.sin(a) * r, run: false };
    }
    return this.goal;
  }

  doHide(now) {
    const st = this.st;
    const veg = this.game.veg;
    if (this.hidden != null) return null;
    const left = (st.endsAt - now) / 1000;
    if (!this.goal) {
      // Pick a random bush we can comfortably reach in the time we have.
      const reach = Math.min(PLAYER.sprint * left * 0.55, 600);
      const a0 = Math.random() * Math.PI * 2;
      let best = null;
      for (let i = 0; i < 40 && !best; i++) {
        const a = a0 + i * 0.4, r = reach * (0.35 + Math.random() * 0.6);
        best = veg.nearestBush(SPAWN.x + Math.cos(a) * r, SPAWN.z + Math.sin(a) * r, 30);
      }
      best ||= veg.nearestBush(this.pos.x, this.pos.z, 200);
      this.goal = best ? { x: best.x, z: best.z, bush: best, run: true } : null;
    }
    const g = this.goal;
    // Out of time? Dive into whatever is closest.
    const close = left < 4 ? veg.nearestBush(this.pos.x, this.pos.z, 25) : null;
    const target = g && this.dist(g) < 1.6 ? g.bush : close && this.dist(close) < 1.6 ? close : null;
    if (target) {
      this.hidden = target.id;
      this.pos.set(target.x, this.game.terrain.getHeight(target.x, target.z), target.z);
      this.room.hide(target.id, this.id);
      return null;
    }
    return close && (!g || this.dist(close) < this.dist(g)) ? { x: close.x, z: close.z, run: true } : g;
  }

  doHiderWait() {
    if (this.hidden != null) return null;
    // Got caught in the open somehow: find the nearest bush.
    const b = this.game.veg.nearestBush(this.pos.x, this.pos.z, 60);
    if (b && this.dist(b) < 1.6) {
      this.hidden = b.id;
      this.room.hide(b.id, this.id);
      return null;
    }
    return b ? { x: b.x, z: b.z, run: true } : null;
  }

  doSeek(dt, now) {
    const st = this.st;
    const game = this.game;
    if (this.flee) {
      this.flee.t -= dt;
      if (this.flee.t > 0) return { x: this.flee.x, z: this.flee.z, run: true };
      this.flee = null;
    }
    // A hider standing in the open is fair game.
    if (game.room.hiddenBush(st.hiderId) == null) {
      const hp = game.hiderPosition();
      if (hp && this.dist(hp) < 18) {
        if (this.dist(hp) < GAME.tagRange) { this.room.found(this.id); return null; }
        return { x: hp.x, z: hp.z, run: true };
      }
    }
    if (this.searching) {
      this.searching.t += dt;
      if (this.searching.t < SEARCH_SECONDS) return null;
      const bush = this.searching.bush;
      this.searching = null;
      this.goal = null;
      if (this.room.hiddenBush(st.hiderId) === bush.id) this.room.found(this.id);
      else { this.room.markSearched(bush.id); game.veg.markSearched(bush.id); }
      this.wait = 0.3;
      return null;
    }
    if (this.wait > 0) { this.wait -= dt; return null; }
    const searched = this.room.data.searched || {};
    if (this.goal?.bush && searched[this.goal.bush.id]) this.goal = null;
    if (!this.goal) this.goal = this.pickBush(now, searched);
    if (!this.goal) return null;
    if (this.dist(this.goal) < GAME.searchRange - 1.2) {
      this.searching = { bush: this.goal.bush, t: 0 };
      return null;
    }
    return this.goal;
  }

  /** Nearest unsearched bush, preferring the current map hint once there is one. */
  pickBush(now, searched) {
    const veg = this.game.veg;
    const hint = this.game.hintFor(now);
    if (!hint) {
      // Before the first hint, sweep outward from camp in this bot's own direction.
      this.sweep ??= Math.random() * Math.PI * 2;
      this.sweepR = Math.max(this.sweepR || 30, this.dist({ x: SPAWN.x, z: SPAWN.z }));
    }
    const inHint = (b) => !hint || Math.hypot(b.x - hint.x, b.z - hint.z) < hint.r;
    let best = null, bd = Infinity;
    // Search near ourselves first (inside the hint), then widen.
    for (const rad of [40, 90, 180, 400]) {
      for (const b of veg.bushGrid.query(this.pos.x, this.pos.z, rad, [])) {
        if (searched[b.id] || !inHint(b)) continue;
        const d = Math.hypot(b.x - this.pos.x, b.z - this.pos.z);
        if (d < bd) { bd = d; best = b; }
      }
      if (best) break;
    }
    if (!best && hint) best = veg.nearestBush(hint.x, hint.z, hint.r); // walk into the hint area
    if (!best) {
      // Head out in our sweep direction and look there.
      this.sweepR += 40;
      const x = SPAWN.x + Math.cos(this.sweep) * this.sweepR, z = SPAWN.z + Math.sin(this.sweep) * this.sweepR;
      best = veg.nearestBush(x, z, 60);
      this.sweep += 0.5;
    }
    return best ? { x: best.x, z: best.z, bush: best, run: !!hint || bd > 25 } : null;
  }

  // ---- movement --------------------------------------------------------------
  dist(p) { return Math.hypot(p.x - this.pos.x, p.z - this.pos.z); }

  step(dt, move) {
    const t = this.game.terrain;
    let want = 0;
    if (move && this.dist(move) > 0.4) {
      let dir = Math.atan2(move.x - this.pos.x, move.z - this.pos.z);
      // Unstick: if we barely moved for a while, sidestep around the obstacle.
      const s = this.stuck;
      s.t += dt;
      if (s.t > 1.2) {
        if (Math.hypot(this.pos.x - s.x, this.pos.z - s.z) < 0.6) { s.dodge = 1; s.dir = Math.random() < 0.5 ? 1.4 : -1.4; }
        s.t = 0; s.x = this.pos.x; s.z = this.pos.z;
      }
      if (s.dodge > 0) { s.dodge -= dt; dir += s.dir; }
      let d = dir - this.heading; d = Math.atan2(Math.sin(d), Math.cos(d));
      this.heading += d * Math.min(1, dt * 8);
      want = move.run ? PLAYER.sprint * 0.92 : PLAYER.walk;
      if (WORLD.waterLevel - t.getHeight(this.pos.x, this.pos.z) > 0.3) want *= 0.55;
    }
    this.speed += (want - this.speed) * Math.min(1, dt * 6);
    this.pos.x += Math.sin(this.heading) * this.speed * dt;
    this.pos.z += Math.cos(this.heading) * this.speed * dt;
    this.game.veg.resolveCollisions(this.pos, PLAYER.radius, this.pos.y);
    const lim = t.half * 0.9;
    this.pos.x = THREE.MathUtils.clamp(this.pos.x, -lim, lim);
    this.pos.z = THREE.MathUtils.clamp(this.pos.z, -lim, lim);
    const ground = t.getHeight(this.pos.x, this.pos.z);
    this.pos.y = WORLD.waterLevel - ground > 1.1 ? WORLD.waterLevel - 1.25 : ground;
  }

  send(dt, now) {
    this.sendTimer += dt;
    if (this.sendTimer < 1 / NET.sendHz) return;
    this.sendTimer = 0;
    const moving = this.speed > 0.1;
    const same = this.wasHidden === this.hidden && Math.round(this.hp) === this.lastHp && moving === this.wasMoving;
    if (!moving && same && now - this.lastSent < 2500) return;
    this.lastSent = now;
    this.wasMoving = moving;
    this.wasHidden = this.hidden;
    this.lastHp = Math.round(this.hp);
    this.room.sendPose({
      x: this.pos.x, y: this.pos.y, z: this.pos.z, h: this.heading, v: this.speed, a: false,
      c: this.hidden != null, hp: this.dead > 0 ? 0 : this.hp,
    }, this.id);
  }
}
