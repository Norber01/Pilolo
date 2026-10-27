// Wild predators. They hunt seekers only — the hider is never attacked.
// Every client runs the same deterministic AI from the same synced player positions,
// so no extra network traffic is needed. Damage is only applied by the victim's own client.
import * as THREE from 'three';
import { WORLD } from '../config.js';
import { REGIONS } from '../world/regions.js';
import { mulberry32 } from '../world/rng.js';

export const SPECIES = {
  lion:  { name: 'Lion', color: 0xb98a4e, belly: 0xd8b27a, len: 1.9, h: 1.0, leg: 0.62, walk: 2.2, run: 9.6, aggro: 30, leash: 140, damage: 30, mane: 0x5e3b1e },
  wolf:  { name: 'Wolf', color: 0x77746f, belly: 0xb3ada3, len: 1.4, h: 0.75, leg: 0.5, walk: 2.6, run: 9.9, aggro: 26, leash: 120, damage: 18, snout: true, ears: true },
  bear:  { name: 'Bear', color: 0x4a3324, belly: 0x5c4130, len: 1.9, h: 1.25, leg: 0.6, walk: 1.6, run: 8.6, aggro: 22, leash: 90, damage: 40, ears: true, bulky: true },
  croc:  { name: 'Crocodile', color: 0x3f4b2a, belly: 0x8a8a5a, len: 3.2, h: 0.45, leg: 0.22, walk: 1.0, run: 7.5, aggro: 14, leash: 50, damage: 35, croc: true },
};

function mat(c, r = 0.85) { return new THREE.MeshStandardMaterial({ color: c, roughness: r }); }
function shadowed(m) { m.castShadow = true; return m; }

function buildModel(sp) {
  const root = new THREE.Group();
  const body = new THREE.Group();
  root.add(body);
  const fur = mat(sp.color), belly = mat(sp.belly);
  const bodyR = sp.h * (sp.bulky ? 0.42 : 0.33);
  const torso = shadowed(new THREE.Mesh(new THREE.CapsuleGeometry(bodyR, sp.len * 0.65, 6, 14), fur));
  torso.rotation.x = Math.PI / 2;
  torso.scale.set(sp.croc ? 1.5 : 1, 1, sp.croc ? 0.55 : 1);
  torso.position.y = sp.leg + bodyR * 0.8;
  body.add(torso);
  const under = new THREE.Mesh(new THREE.CapsuleGeometry(bodyR * 0.8, sp.len * 0.5, 4, 10), belly);
  under.rotation.x = Math.PI / 2;
  under.position.y = torso.position.y - bodyR * 0.3;
  under.scale.set(sp.croc ? 1.4 : 0.9, 1, 0.6);
  body.add(under);

  const neck = new THREE.Group();
  neck.position.set(0, torso.position.y + bodyR * (sp.croc ? 0 : 0.4), sp.len * 0.5);
  body.add(neck);
  const headR = sp.h * (sp.croc ? 0.16 : 0.24);
  const head = shadowed(new THREE.Mesh(new THREE.SphereGeometry(headR, 16, 12), fur));
  head.scale.set(1, sp.croc ? 0.6 : 0.95, sp.croc ? 2.2 : 1.15);
  head.position.z = headR * (sp.croc ? 1.8 : 0.6);
  neck.add(head);
  if (!sp.croc) {
    const snout = shadowed(new THREE.Mesh(new THREE.ConeGeometry(headR * 0.5, headR * 1.3, 10), belly));
    snout.rotation.x = Math.PI / 2;
    snout.position.set(0, -headR * 0.2, headR * 1.5);
    neck.add(snout);
  }
  if (sp.mane) {
    const mane = shadowed(new THREE.Mesh(new THREE.IcosahedronGeometry(headR * 1.55, 1), mat(sp.mane, 1)));
    mane.position.z = -headR * 0.1;
    mane.scale.set(1, 1.05, 0.8);
    neck.add(mane);
  }
  if (sp.ears) {
    for (const s of [-1, 1]) {
      const ear = new THREE.Mesh(new THREE.ConeGeometry(headR * 0.3, headR * 0.6, 6), fur);
      ear.position.set(s * headR * 0.55, headR * 0.85, headR * 0.3);
      neck.add(ear);
    }
  }
  const eyeMat = new THREE.MeshStandardMaterial({ color: 0x111111, roughness: 0.2, emissive: 0x221100 });
  for (const s of [-1, 1]) {
    const eye = new THREE.Mesh(new THREE.SphereGeometry(headR * 0.12, 8, 6), eyeMat);
    eye.position.set(s * headR * 0.45, headR * 0.3, headR * (sp.croc ? 1.2 : 1.35));
    neck.add(eye);
  }

  const tail = new THREE.Group();
  tail.position.set(0, torso.position.y, -sp.len * 0.5);
  body.add(tail);
  const tailLen = sp.croc ? sp.len * 0.8 : sp.len * 0.45;
  const tg = new THREE.ConeGeometry(sp.croc ? bodyR * 0.9 : 0.05, tailLen, 8);
  tg.rotateX(-Math.PI / 2);
  tg.translate(0, 0, -tailLen / 2);
  const tailMesh = shadowed(new THREE.Mesh(tg, fur));
  if (!sp.croc) tailMesh.rotation.x = 0.6;
  else tailMesh.scale.set(1.3, 0.5, 1);
  tail.add(tailMesh);

  const legs = [];
  const lx = bodyR * (sp.croc ? 1.4 : 0.6), lz = sp.len * 0.36;
  for (const [x, z] of [[lx, lz], [-lx, lz], [lx, -lz], [-lx, -lz]]) {
    const hip = new THREE.Group();
    hip.position.set(x, sp.leg, z);
    const lg = new THREE.CapsuleGeometry(sp.h * (sp.bulky ? 0.12 : 0.08), sp.leg * 0.8, 4, 8);
    lg.translate(0, -sp.leg / 2, 0);
    const leg = shadowed(new THREE.Mesh(lg, fur));
    if (sp.croc) { hip.rotation.z = Math.sign(x) * 0.9; }
    hip.add(leg);
    body.add(hip);
    legs.push(hip);
  }
  return { root, body, legs, tail, neck };
}

export class Animal {
  constructor(species, region, home, seed) {
    this.sp = SPECIES[species];
    this.species = species;
    this.region = region;
    this.home = home.clone();
    this.pos = home.clone();
    this.heading = 0;
    this.rand = mulberry32(seed);
    this.state = 'wander';
    this.target = home.clone();
    this.speed = 0;
    this.cooldown = 0;
    this.pause = 0;
    this.prey = null;
    this.model = buildModel(this.sp);
    this.model.root.scale.setScalar(0.9 + this.rand() * 0.25);
    this.phase = this.rand() * 10;
    this.pickWander();
  }

  pickWander() {
    const a = this.rand() * Math.PI * 2, r = 10 + this.rand() * this.sp.leash * 0.6;
    this.target.set(this.home.x + Math.cos(a) * r, 0, this.home.z + Math.sin(a) * r);
    this.pause = this.rand() < 0.4 ? 2 + this.rand() * 5 : 0;
  }
}

export class Wildlife {
  constructor(world, scene) {
    this.world = world;
    this.scene = scene;
    this.animals = [];
    const t = world.terrain;
    const rand = mulberry32(WORLD.seed + 500);
    let seed = 1;
    REGIONS.forEach((reg, ri) => {
      if (!reg.animal) return;
      let placed = 0, tries = 0;
      while (placed < reg.animalCount && tries++ < 4000) {
        const x = (rand() - 0.5) * t.size * 0.85, z = (rand() - 0.5) * t.size * 0.85;
        if (t.regionAt(x, z) !== ri || Math.hypot(x, z) < 180) continue;
        const h = t.getHeight(x, z);
        if (reg.animal !== 'croc' && h < WORLD.waterLevel + 0.3) continue;
        if (reg.animal === 'croc' && h > WORLD.waterLevel + 1.5) continue;
        const a = new Animal(reg.animal, ri, new THREE.Vector3(x, h, z), seed++);
        this.animals.push(a);
        scene.add(a.model.root);
        placed++;
      }
    });
  }

  /**
   * targets: [{ id, pos: Vector3, isLocal, alive }] — seekers only. The hider is never passed in.
   * onHit(animal) is called when the local player gets bitten.
   */
  update(dt, targets, camPos, onHit) {
    const t = this.world.terrain;
    const veg = this.world.vegetation;
    for (const a of this.animals) {
      const sp = a.sp;
      a.cooldown = Math.max(0, a.cooldown - dt);
      const homeDist = Math.hypot(a.pos.x - a.home.x, a.pos.z - a.home.z);

      // Choose prey: nearest seeker in aggro range (and not too far from home).
      let prey = null, pd = sp.aggro;
      if (a.state !== 'return') {
        for (const p of targets) {
          if (!p.alive) continue;
          const d = Math.hypot(p.pos.x - a.pos.x, p.pos.z - a.pos.z);
          if (d < (a.prey === p.id ? sp.aggro * 1.6 : sp.aggro) && d < pd) { pd = d; prey = p; }
        }
      }
      if (homeDist > sp.leash) { a.state = 'return'; prey = null; }
      if (a.state === 'return' && homeDist < sp.leash * 0.4) a.state = 'wander';
      a.prey = prey ? prey.id : null;
      if (prey && a.state !== 'return') a.state = a.cooldown > 0 ? 'recover' : 'chase';
      else if (a.state === 'chase' || a.state === 'recover') a.state = 'wander';

      let tx, tz, speed;
      if (a.state === 'chase') {
        tx = prey.pos.x; tz = prey.pos.z; speed = sp.run;
        if (pd < 1.7 + sp.len * 0.4) {
          a.cooldown = 2.2;
          if (prey.isLocal) onHit(a);
        }
      } else if (a.state === 'recover') {
        // Back off after a bite so players get a chance to escape.
        tx = a.pos.x - (prey.pos.x - a.pos.x); tz = a.pos.z - (prey.pos.z - a.pos.z); speed = sp.walk * 1.5;
      } else if (a.state === 'return') {
        tx = a.home.x; tz = a.home.z; speed = sp.walk * 2;
      } else {
        if (a.pause > 0) { a.pause -= dt; tx = a.pos.x; tz = a.pos.z; speed = 0; }
        else {
          tx = a.target.x; tz = a.target.z; speed = sp.walk;
          if (Math.hypot(tx - a.pos.x, tz - a.pos.z) < 2) a.pickWander();
        }
      }

      const dx = tx - a.pos.x, dz = tz - a.pos.z;
      const d = Math.hypot(dx, dz);
      a.speed += ((d > 0.5 ? speed : 0) - a.speed) * Math.min(1, dt * 3);
      if (d > 0.3) {
        const want = Math.atan2(dx, dz);
        let diff = want - a.heading;
        diff = Math.atan2(Math.sin(diff), Math.cos(diff));
        a.heading += diff * Math.min(1, dt * (a.state === 'chase' ? 6 : 2.5));
      }
      a.pos.x += Math.sin(a.heading) * a.speed * dt;
      a.pos.z += Math.cos(a.heading) * a.speed * dt;
      const h = t.getHeight(a.pos.x, a.pos.z);
      // Land animals avoid deep water, crocs avoid dry land far from water.
      if ((sp.croc && h > WORLD.waterLevel + 2.5) || (!sp.croc && h < WORLD.waterLevel - 0.3)) {
        a.pos.x -= Math.sin(a.heading) * a.speed * dt * 2;
        a.pos.z -= Math.cos(a.heading) * a.speed * dt * 2;
        if (a.state === 'wander') a.pickWander();
      }
      veg.resolveCollisions(a.pos, sp.len * 0.3, a.pos.y);
      a.pos.y = t.getHeight(a.pos.x, a.pos.z);

      // Only animate/draw animals near the camera.
      const cd = Math.hypot(a.pos.x - camPos.x, a.pos.z - camPos.z);
      const visible = cd < this.world.viewDistance * 0.8;
      const m = a.model;
      m.root.visible = visible;
      if (!visible) continue;
      m.root.position.set(a.pos.x, sp.croc ? Math.max(a.pos.y, WORLD.waterLevel - 0.25) : a.pos.y, a.pos.z);
      m.root.rotation.y = a.heading;
      a.phase += dt * (2 + a.speed * 1.4);
      const sw = Math.min(1, a.speed / 3) * (sp.croc ? 0.5 : 0.7);
      const s = Math.sin(a.phase);
      m.legs[0].rotation.x = s * sw; m.legs[3].rotation.x = s * sw;
      m.legs[1].rotation.x = -s * sw; m.legs[2].rotation.x = -s * sw;
      m.tail.rotation.y = Math.sin(a.phase * 0.5) * (sp.croc ? 0.25 : 0.4);
      m.body.position.y = Math.abs(Math.cos(a.phase)) * 0.06 * Math.min(1, a.speed / 5);
      m.neck.rotation.x = a.state === 'chase' ? 0.15 : Math.sin(a.phase * 0.2) * 0.1;
    }
  }

  nearestThreat(pos, range) {
    let best = null, bd = range;
    for (const a of this.animals) {
      if (a.state !== 'chase') continue;
      const d = Math.hypot(a.pos.x - pos.x, a.pos.z - pos.z);
      if (d < bd) { bd = d; best = a; }
    }
    return best;
  }
}
