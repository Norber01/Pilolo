// The playable game: local player physics, remote players, phases, hiding/searching, HUD.
import * as THREE from 'three';
import { GAME, PLAYER, WORLD, NET, SPAWN } from '../config.js';
import { Character } from '../entities/character.js';
import { REGIONS } from '../world/regions.js';
import { mulberry32 } from '../world/rng.js';
import { $, show, setHTML, toast, banner, fmtTime, esc, DiceView } from '../ui/ui.js';

export class Game {
  constructor({ scene, camera, world, wildlife, controls, cam, minimap }) {
    Object.assign(this, { scene, camera, world, wildlife, controls, cam, minimap });
    this.terrain = world.terrain;
    this.veg = world.vegetation;
    this.room = null;
    this.remotes = new Map();
    this.dice = new DiceView();
    this.phaseKey = '';
    this.sendTimer = 0;
    this.lastSent = null;
    this.tickTimer = 0;
    this.hint = null;
    this.hintIndex = 0;
    this.region = -1;
    this.search = null;
    this.flash = 0;
  }

  // ---- room lifecycle --------------------------------------------------------
  setRoom(room) {
    this.room = room;
    const me = room.me;
    this.me = {
      pos: new THREE.Vector3(), vel: new THREE.Vector3(), heading: 0, onGround: true,
      hp: PLAYER.maxHealth, dead: 0, lastHit: -99, hidden: null, speed: 0,
      char: new Character({ color: me.color, name: '' }),
    };
    this.scene.add(this.me.char.root);
    this.teleportToSpawn();
    this.cam.first = true;
    this.unsub = room.onChange(() => this.onRoomData());
    this.onRoomData();
  }

  clearRoom() {
    this.unsub?.();
    for (const r of this.remotes.values()) this.scene.remove(r.char.root);
    this.remotes.clear();
    if (this.me) this.scene.remove(this.me.char.root);
    this.me = null;
    this.room = null;
    this.phaseKey = '';
    this.dice.reset();
    this.veg.clearSearched();
    for (const id of ['lobby', 'dice', 'end', 'blind', 'hud']) show(id, false);
  }

  teleportToSpawn() {
    const idx = Math.max(0, this.room.players.findIndex((p) => p.id === this.room.uid));
    const a = idx * ((Math.PI * 2) / 3) + 0.4;
    this.me.pos.set(SPAWN.x + Math.cos(a) * 4, 0, SPAWN.z + Math.sin(a) * 4);
    this.me.pos.y = this.terrain.getHeight(this.me.pos.x, this.me.pos.z);
    this.me.vel.set(0, 0, 0);
    this.me.heading = Math.atan2(-Math.cos(a), -Math.sin(a));
    this.cam.yaw = this.me.heading + Math.PI;
  }

  get phase() { return this.room?.state.phase || 'lobby'; }
  get isHider() { return this.room?.state.hiderId === this.room?.uid; }
  get inRound() { return this.phase === 'hiding' || this.phase === 'seeking'; }
  role(id = this.room.uid) {
    if (!this.inRound) return 'free';
    return id === this.room.state.hiderId ? 'hider' : 'seeker';
  }

  onRoomData() {
    const room = this.room;
    if (!room || !room.data) return;
    if (!room.me) { toast('You left the room.'); return; }
    const st = room.state;
    const key = `${st.phase}:${st.round}`;
    if (key !== this.phaseKey) {
      this.phaseKey = key;
      this.enterPhase(st.phase);
    }
    // Remote players
    const seen = new Set();
    for (const p of room.players) {
      if (p.id === room.uid) continue;
      seen.add(p.id);
      let r = this.remotes.get(p.id);
      if (!r) {
        r = { char: new Character({ color: p.color, name: p.name }), pos: new THREE.Vector3(), heading: 0, s: null, init: false };
        this.remotes.set(p.id, r);
        this.scene.add(r.char.root);
        if (this.phaseKey) toast(`${p.name} joined`);
      }
      r.name = p.name; r.color = p.color;
      if (p.s) {
        r.s = p.s;
        if (!r.init) { r.pos.set(p.s.x, p.s.y, p.s.z); r.heading = p.s.h; r.init = true; }
      }
    }
    for (const [id, r] of this.remotes) {
      if (!seen.has(id)) {
        this.scene.remove(r.char.root);
        this.remotes.delete(id);
        toast(`${r.name} left`);
      }
    }
    // Shared list of searched bushes.
    const searched = room.data.searched || {};
    for (const id of Object.keys(searched)) this.veg.markSearched(+id);

    this.renderLobby();
    if (st.phase === 'dice' || (st.phase === 'hiding' && room.b.now() < st.startsAt)) this.renderDice();
    if (st.phase === 'ended') this.renderEnd();
  }

  enterPhase(phase) {
    const room = this.room;
    const st = room.state;
    show('lobby', phase === 'lobby');
    show('end', phase === 'ended');
    show('hud', true);
    this.search = null;
    this.hint = null;
    this.hintIndex = 0;
    if (phase === 'lobby') {
      this.veg.clearSearched();
      this.leaveBush(false);
    }
    if (phase === 'dice') {
      this.veg.clearSearched();
      this.leaveBush(false);
      this.teleportToSpawn();
      this.dice.reset();
      this.me.hp = PLAYER.maxHealth;
      show('dice', true);
      $('dice-title').textContent = `Round ${st.round}: roll the dice!`;
      this.controls.releasePointer();
    }
    if (phase === 'hiding') {
      const hider = room.player(st.hiderId);
      $('dice-title').textContent = `${hider?.name || '?'} rolled highest and will HIDE!`;
      $('dice-msg').textContent = this.isHider ? 'Run and find a bush! Press E / tap Hide when you are next to one.' : 'Seekers: close your eyes…';
      show('btn-roll', false);
      this.teleportToSpawn();
    }
    if (phase === 'seeking') {
      show('dice', false);
      show('blind', false);
      toast(this.isHider ? 'The seekers are coming! Stay still… or move to a better bush.' : 'GO! Find the hider. Animals will hunt you — the hider is safe from them.', 4000);
    }
    if (phase === 'ended') {
      show('dice', false);
      show('blind', false);
      this.leaveBush(false);
      this.controls.releasePointer();
    }
  }

  renderLobby() {
    const room = this.room;
    $('lobby-code').textContent = room.code;
    const scores = room.state.scores || {};
    setHTML('lobby-players', room.players.map((p) =>
      `<li><span class="dot" style="background:${esc(p.color)}"></span>${esc(p.name)}${p.id === room.hostId ? ' <em>host</em>' : ''}${p.id === room.uid ? ' <em>you</em>' : ''}<span class="score">${scores[p.id] || 0}</span></li>`).join(''));
    const enough = room.players.length >= room.minPlayers;
    show('btn-start', room.isHost);
    show('host-opts', room.isHost);
    $('btn-start').disabled = !enough;
    $('lobby-hint').textContent = !enough
      ? `Waiting for friends… share the code (${room.players.length}/${GAME.maxPlayers}).`
      : room.isHost ? 'Everyone here? Press Start!' : 'Waiting for the host to start…';
  }

  renderDice() {
    const room = this.room;
    const st = room.state;
    const contenders = new Set(Object.keys(st.contenders || {}));
    const rolls = {};
    if (st.phase === 'dice') {
      for (const p of room.players) {
        const r = p.roll;
        if (r && r.r === st.diceRound && r.g === st.round) rolls[p.id] = r.v;
      }
    } else {
      Object.assign(rolls, (st.history || []).at(-1) || {});
    }
    this.dice.render(room.players, rolls, contenders);
    if (st.phase === 'dice') {
      const mine = contenders.has(room.uid) && !rolls[room.uid];
      show('btn-roll', mine);
      const waiting = room.players.filter((p) => contenders.has(p.id) && !rolls[p.id]).map((p) => p.name);
      let msg = waiting.length ? `Waiting for: ${waiting.join(', ')}` : 'Resolving…';
      if (st.diceRound > 1) msg = `Tie! Re-roll between the tied players. ${msg}`;
      if (!contenders.has(room.uid)) msg = `You are out this round. ${msg}`;
      $('dice-msg').textContent = msg;
    }
  }

  renderEnd() {
    const room = this.room;
    const st = room.state;
    const hider = room.player(st.hiderId);
    const finder = room.player(st.foundBy);
    let title, sub;
    if (st.winner === 'seekers') {
      title = this.isHider ? 'You were found!' : 'Seekers win!';
      sub = `${finder?.name || 'A seeker'} found ${hider?.name || 'the hider'}.`;
    } else if (st.winner === 'hider') {
      title = this.isHider ? 'You win! Perfect hiding spot.' : `${hider?.name || 'The hider'} wins!`;
      sub = st.reason || '';
    } else {
      title = 'Round cancelled';
      sub = st.reason || '';
    }
    $('end-title').textContent = title;
    $('end-sub').textContent = sub;
    const scores = st.scores || {};
    setHTML('end-scores', room.players
      .slice().sort((a, b) => (scores[b.id] || 0) - (scores[a.id] || 0))
      .map((p) => `<li><span class="dot" style="background:${esc(p.color)}"></span>${esc(p.name)}<span class="score">${scores[p.id] || 0}</span></li>`).join(''));
    show('btn-again', room.isHost);
    show('btn-to-lobby', room.isHost);
    $('end-wait').textContent = room.isHost ? '' : 'Waiting for the host…';
  }

  // ---- interactions ---------------------------------------------------------
  enterBush(bush) {
    this.me.hidden = bush.id;
    this.me.pos.set(bush.x, this.terrain.getHeight(bush.x, bush.z), bush.z);
    this.me.vel.set(0, 0, 0);
    this.room.hide(bush.id);
    toast('You are hidden. Animals ignore you — just stay quiet!');
  }

  leaveBush(notify = true) {
    if (!this.me || this.me.hidden == null) return;
    this.me.hidden = null;
    const f = this.cam.forward;
    this.me.pos.x -= f.x * 1.8; this.me.pos.z -= f.z * 1.8;
    this.room.unhide();
    if (notify) toast('You left the bush — seekers can see you now!');
  }

  hiderPosition() {
    const st = this.room.state;
    const bush = this.room.hiddenBush(st.hiderId);
    if (bush != null) return this.veg.bushes[bush];
    if (st.hiderId === this.room.uid) return this.me.pos;
    return this.remotes.get(st.hiderId)?.pos || null;
  }

  canMove() {
    const st = this.room.state;
    const now = this.room.b.now();
    if (this.me.dead > 0) return false;
    switch (st.phase) {
      case 'dice': return false;
      case 'hiding': return this.isHider && now >= st.startsAt && this.me.hidden == null;
      case 'seeking': return this.me.hidden == null;
      default: return true;
    }
  }

  /** Figures out what the action button would do right now. */
  currentAction() {
    const st = this.room.state;
    const now = this.room.b.now();
    const role = this.role();
    const p = this.me.pos;
    if (this.me.dead > 0) return null;
    if (role === 'hider' && (st.phase === 'seeking' || now >= st.startsAt)) {
      if (this.me.hidden != null) return { label: 'Leave bush', short: 'Leave', run: () => this.leaveBush() };
      const bush = this.veg.nearestBush(p.x, p.z, GAME.hideRange);
      if (bush) return { label: 'Hide in this bush', short: 'Hide', run: () => this.enterBush(bush) };
    }
    if (role === 'seeker' && st.phase === 'seeking') {
      if (this.room.hiddenBush(st.hiderId) == null) {
        const hp = this.remotes.get(st.hiderId)?.pos;
        if (hp && hp.distanceTo(p) < GAME.tagRange) return { label: 'TAG the hider!', short: 'Tag!', run: () => this.room.found(this.room.uid) };
      }
      const bush = this.veg.nearestBush(p.x, p.z, GAME.searchRange);
      if (bush) {
        return {
          label: bush.searched ? 'Search this bush again' : 'Search this bush', short: 'Search',
          run: () => { this.search = { bush, t: 0 }; },
        };
      }
    }
    return null;
  }

  updateSearch(dt) {
    const s = this.search;
    if (!s) { show('search-bar', false); return; }
    if (this.phase !== 'seeking' || Math.hypot(this.me.pos.x - s.bush.x, this.me.pos.z - s.bush.z) > GAME.searchRange + 1) {
      this.search = null;
      return;
    }
    s.t += dt;
    show('search-bar', true);
    $('search-fill').style.width = `${Math.min(100, (s.t / GAME.searchTime) * 100)}%`;
    if (s.t >= GAME.searchTime) {
      this.search = null;
      show('search-bar', false);
      if (this.room.hiddenBush(this.room.state.hiderId) === s.bush.id) {
        this.room.found(this.room.uid);
      } else {
        this.room.markSearched(s.bush.id);
        this.veg.markSearched(s.bush.id);
        toast('Nothing here…', 1400);
      }
    }
  }

  onAnimalHit(animal) {
    const me = this.me;
    const t = performance.now() / 1000;
    if (me.dead > 0 || t - me.lastHit < 0.8 || me.hidden != null) return;
    me.lastHit = t;
    me.hp -= animal.sp.damage;
    const dx = me.pos.x - animal.pos.x, dz = me.pos.z - animal.pos.z;
    const d = Math.hypot(dx, dz) || 1;
    me.vel.set((dx / d) * 9, 5, (dz / d) * 9);
    me.onGround = false;
    this.flash = 1;
    navigator.vibrate?.(120);
    if (me.hp <= 0) {
      me.dead = GAME.respawnSeconds;
      this.search = null;
      toast(`You were mauled by a ${animal.sp.name.toLowerCase()}! Back to camp…`, 3500);
    } else {
      toast(`A ${animal.sp.name.toLowerCase()} attacked you! Run!`, 1800);
    }
  }

  // ---- per frame --------------------------------------------------------------
  update(dt) {
    if (!this.room || !this.me || !this.room.data) return;
    const room = this.room;
    const st = room.state;
    const now = room.b.now();
    const me = this.me;
    const input = this.controls.read();
    this.cam.input(input.lookX, input.lookY, input.zoom);

    // Advance the shared game state (any client can do it, transactions keep it safe).
    this.tickTimer += dt;
    if (this.tickTimer > 0.25) { this.tickTimer = 0; room.tick(); }

    // Death / respawn
    if (me.dead > 0) {
      me.dead -= dt;
      if (me.dead <= 0) { this.teleportToSpawn(); me.hp = PLAYER.maxHealth; toast('Back at camp. Watch out for the wildlife!'); }
    } else if (performance.now() / 1000 - me.lastHit > 6) {
      me.hp = Math.min(PLAYER.maxHealth, me.hp + dt * 3);
    }

    // Movement
    this.stepPlayer(dt, this.canMove() ? input : { x: 0, y: 0, sprint: false, jump: false });

    // Action button
    const action = this.currentAction();
    if (input.action && action) action.run();
    $('prompt').textContent = action ? `${this.controls.isTouch ? '' : '[E] '}${action.label}` : '';
    show('prompt', !!action);
    $('btn-action').textContent = action ? action.short : '';
    $('btn-action').classList.toggle('hidden', !action);
    this.updateSearch(dt);

    // Remote players: smooth towards their latest pose.
    const k = 1 - Math.exp(-dt * 10);
    for (const [id, r] of this.remotes) {
      const s = r.s;
      if (!s) { r.char.root.visible = false; continue; }
      r.pos.x += (s.x - r.pos.x) * k; r.pos.y += (s.y - r.pos.y) * k; r.pos.z += (s.z - r.pos.z) * k;
      if (r.pos.distanceToSquared(new THREE.Vector3(s.x, s.y, s.z)) > 400) r.pos.set(s.x, s.y, s.z);
      let dh = s.h - r.heading; dh = Math.atan2(Math.sin(dh), Math.cos(dh));
      r.heading += dh * k;
      const hiddenFromMe = this.inRound && id === st.hiderId && room.hiddenBush(id) != null;
      r.char.root.visible = !hiddenFromMe;
      r.char.root.position.copy(r.pos);
      r.char.root.rotation.y = r.heading;
      r.char.animate(dt, s.v, !!s.a, !!s.c);
    }

    // Wildlife: only seekers (and everyone outside a round) are prey. Never the hider.
    const targets = [];
    if (st.phase !== 'hiding' && st.phase !== 'dice') {
      if (!(this.inRound && this.isHider) && me.dead <= 0) targets.push({ id: room.uid, pos: me.pos, isLocal: true, alive: true });
      for (const [id, r] of this.remotes) {
        if (!r.s || (this.inRound && id === st.hiderId) || r.s.hp <= 0) continue;
        targets.push({ id, pos: r.pos, isLocal: false, alive: true });
      }
    }
    this.wildlife.update(dt, targets, this.camera.position, (a) => this.onAnimalHit(a));

    // Camera
    const focus = new THREE.Vector3(me.pos.x, me.pos.y + 1.55 - me.char.crouch * 0.6, me.pos.z);
    this.cam.update(dt, focus);
    this.world.update(dt, this.camera, me.pos);

    // Network
    this.sendTimer += dt;
    if (this.sendTimer >= 1 / NET.sendHz) {
      this.sendTimer = 0;
      const pose = { x: me.pos.x, y: me.pos.y, z: me.pos.z, h: me.heading, v: me.speed, a: !me.onGround, c: me.hidden != null, hp: me.dead > 0 ? 0 : me.hp };
      const l = this.lastSent;
      const changed = !l || Math.abs(l.x - pose.x) + Math.abs(l.z - pose.z) + Math.abs(l.y - pose.y) > 0.02 || Math.abs(l.h - pose.h) > 0.02 || l.c !== pose.c || l.a !== pose.a || Math.round(l.hp) !== Math.round(pose.hp) || (l.v > 0.1) !== (pose.v > 0.1);
      if (changed || now - (l?.t || 0) > 3000) {
        room.sendPose(pose);
        this.lastSent = { ...pose, t: now };
      }
    }

    this.updateHud(dt, now);
  }

  stepPlayer(dt, input) {
    const me = this.me;
    const t = this.terrain;
    const f = this.cam.forward, r = this.cam.right;
    let mx = f.x * input.y + r.x * input.x;
    let mz = f.z * input.y + r.z * input.x;
    const len = Math.hypot(mx, mz);
    const ground = t.getHeight(me.pos.x, me.pos.z);
    const depth = WORLD.waterLevel - ground;
    const swimming = depth > 1.1;
    let speed = input.sprint ? PLAYER.sprint : PLAYER.walk;
    if (depth > 0.3) speed *= swimming ? 0.45 : 0.65;
    if (len > 0.01) {
      mx /= Math.max(1, len); mz /= Math.max(1, len);
      const want = Math.atan2(mx, mz);
      let d = want - me.heading; d = Math.atan2(Math.sin(d), Math.cos(d));
      me.heading += d * Math.min(1, dt * 12);
    }
    const accel = me.onGround || swimming ? 12 : 2.5;
    me.vel.x += (mx * speed - me.vel.x) * Math.min(1, dt * accel);
    me.vel.z += (mz * speed - me.vel.z) * Math.min(1, dt * accel);

    if (input.jump && me.onGround && !swimming) { me.vel.y = PLAYER.jump; me.onGround = false; }
    me.vel.y -= PLAYER.gravity * dt;

    const ox = me.pos.x, oz = me.pos.z;
    me.pos.x += me.vel.x * dt;
    me.pos.z += me.vel.z * dt;
    // Too steep to climb? Slide back.
    const nh = t.getHeight(me.pos.x, me.pos.z);
    if (nh - ground > 0 && t.slope(me.pos.x, me.pos.z) > 1.3) { me.pos.x = ox; me.pos.z = oz; }
    this.veg.resolveCollisions(me.pos, PLAYER.radius, me.pos.y);
    const lim = t.half * 0.9;
    me.pos.x = THREE.MathUtils.clamp(me.pos.x, -lim, lim);
    me.pos.z = THREE.MathUtils.clamp(me.pos.z, -lim, lim);

    me.pos.y += me.vel.y * dt;
    const floor = swimming ? Math.max(t.getHeight(me.pos.x, me.pos.z), WORLD.waterLevel - 1.25) : t.getHeight(me.pos.x, me.pos.z);
    if (me.pos.y <= floor) { me.pos.y = floor; me.vel.y = Math.max(0, me.vel.y); me.onGround = true; }
    else if (me.pos.y > floor + 0.3) me.onGround = false;
    if (me.onGround && me.vel.y <= 0) me.pos.y = floor; // stick to slopes when walking down

    me.speed = Math.hypot(me.vel.x, me.vel.z);
    const c = me.char;
    c.root.position.copy(me.pos);
    c.root.rotation.y = me.heading;
    c.root.visible = me.dead <= 0;
    c.animate(dt, me.speed, !me.onGround && !swimming, me.hidden != null);
  }

  updateHud(dt, now) {
    const room = this.room;
    const st = room.state;
    const me = this.me;
    const role = this.role();
    let phaseText = '', timer = '';
    if (st.phase === 'lobby') phaseText = 'Lobby — explore while you wait';
    if (st.phase === 'dice') phaseText = 'Rolling dice…';
    if (st.phase === 'hiding') { phaseText = this.isHider ? 'HIDE! Find a bush' : 'Hider is hiding…'; timer = fmtTime((st.endsAt - Math.max(now, st.startsAt)) / 1000); }
    if (st.phase === 'seeking') { phaseText = this.isHider ? 'Stay hidden!' : 'SEEK! Search the bushes'; timer = fmtTime((st.endsAt - now) / 1000); }
    if (st.phase === 'ended') phaseText = 'Round over';
    $('phase').textContent = phaseText;
    $('timer').textContent = timer;
    $('role').textContent = role === 'free' ? '' : role === 'hider' ? 'HIDER' : 'SEEKER';
    $('role').className = role;

    // Dice reveal finished => close the overlay.
    if (st.phase === 'hiding' && now >= st.startsAt) show('dice', false);
    else if (st.phase === 'hiding') show('dice', true);

    // Seekers are blindfolded while the hider hides.
    const blind = st.phase === 'hiding' && !this.isHider && now >= st.startsAt;
    show('blind', blind);
    if (blind) $('blind-time').textContent = fmtTime((st.endsAt - now) / 1000);

    // Health
    const hp = Math.max(0, me.hp) / PLAYER.maxHealth;
    $('health-fill').style.width = `${hp * 100}%`;
    $('health-fill').style.background = hp > 0.5 ? '#5fd35f' : hp > 0.25 ? '#f2c14e' : '#e4572e';
    show('health', !(this.inRound && this.isHider));

    // Damage flash + danger vignette
    this.flash = Math.max(0, this.flash - dt * 2);
    const threat = !(this.inRound && this.isHider) && this.wildlife.nearestThreat(me.pos, 35);
    $('vignette').style.opacity = Math.max(this.flash, threat ? 0.45 : 0, me.dead > 0 ? 0.8 : 0);
    const threatText = threat ? `⚠ A ${threat.sp.name.toLowerCase()} is hunting you!` : '';
    if ($('threat').textContent !== threatText) $('threat').textContent = threatText;

    // Hider gets a heads-up when a seeker is close.
    let near = '';
    if (this.inRound && this.isHider && st.phase === 'seeking') {
      let nd = Infinity;
      for (const r of this.remotes.values()) if (r.s) nd = Math.min(nd, r.pos.distanceTo(me.pos));
      if (nd < 12) near = '👣 A seeker is very close…';
      else if (nd < 30) near = '👣 Footsteps nearby…';
    }
    $('near').textContent = near;

    // Region banner
    const reg = this.terrain.regionAt(me.pos.x, me.pos.z);
    if (reg !== this.region) {
      if (this.region !== -1) banner(REGIONS[reg].name);
      this.region = reg;
    }

    // Seeker map hints: a circle that contains the hider, shrinking over time.
    let hint = null;
    if (role === 'seeker' && st.phase === 'seeking') {
      const k = Math.floor((now - st.startsAt) / 1000 / GAME.hintEvery);
      if (k >= 1) {
        if (k !== this.hintIndex || !this.hint) {
          const hp = this.hiderPosition();
          if (hp) {
            const radius = GAME.hintRadii[Math.min(k - 1, GAME.hintRadii.length - 1)];
            const rnd = mulberry32(st.round * 1000 + k);
            const a = rnd() * Math.PI * 2, d = rnd() * radius * 0.65;
            this.hint = { x: hp.x + Math.cos(a) * d, z: hp.z + Math.sin(a) * d, r: radius };
            this.hintIndex = k;
            toast('📍 New hint on the map: the hider is inside the yellow circle.', 3500);
          }
        }
        hint = this.hint;
      }
    }

    // Minimap marks
    this.mapTimer = (this.mapTimer || 0) + dt;
    if (this.mapTimer > 0.2) {
      this.mapTimer = 0;
      const marks = [];
      for (const [id, r] of this.remotes) {
        if (!r.s) continue;
        if (this.inRound && id === st.hiderId) continue; // never reveal the hider on the map
        marks.push({ x: r.pos.x, z: r.pos.z, color: r.color });
      }
      marks.push({ x: me.pos.x, z: me.pos.z, color: room.me?.color || '#fff', self: true, heading: me.heading });
      this.minimap.draw(marks, hint);
    }
  }
}
