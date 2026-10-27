// Procedural humanoid with a simple walk/run/jump/crouch animation.
import * as THREE from 'three';
import { makeLabelTexture } from '../world/textures.js';

export const PLAYER_COLORS = ['#e4572e', '#2e86e4', '#f2c14e', '#8e5ce4'];

function limb(len, r, mat) {
  const g = new THREE.CapsuleGeometry(r, len - r * 2, 4, 10);
  g.translate(0, -len / 2, 0);
  const m = new THREE.Mesh(g, mat);
  m.castShadow = true;
  return m;
}

export class Character {
  constructor({ color = '#e4572e', name = '' } = {}) {
    const skin = new THREE.MeshStandardMaterial({ color: 0xc89070, roughness: 0.7 });
    const shirt = new THREE.MeshStandardMaterial({ color, roughness: 0.8 });
    const pants = new THREE.MeshStandardMaterial({ color: 0x3b3f4a, roughness: 0.9 });
    const boots = new THREE.MeshStandardMaterial({ color: 0x2a211a, roughness: 0.8 });
    const pack = new THREE.MeshStandardMaterial({ color: 0x5b4a33, roughness: 0.9 });

    this.root = new THREE.Group();
    this.body = new THREE.Group(); // bobs/leans
    this.root.add(this.body);

    const hips = new THREE.Group();
    hips.position.y = 0.95;
    this.body.add(hips);
    this.hips = hips;

    const torso = new THREE.Mesh(new THREE.CapsuleGeometry(0.22, 0.42, 4, 12), shirt);
    torso.position.y = 0.36;
    torso.scale.set(1.15, 1, 0.8);
    torso.castShadow = true;
    hips.add(torso);
    const bag = new THREE.Mesh(new THREE.BoxGeometry(0.34, 0.42, 0.18), pack);
    bag.position.set(0, 0.4, -0.22);
    bag.castShadow = true;
    hips.add(bag);

    const head = new THREE.Mesh(new THREE.SphereGeometry(0.16, 20, 16), skin);
    head.position.y = 0.86;
    head.castShadow = true;
    hips.add(head);
    const hat = new THREE.Mesh(new THREE.CylinderGeometry(0.13, 0.17, 0.12, 16), shirt);
    hat.position.y = 0.98;
    const brim = new THREE.Mesh(new THREE.CylinderGeometry(0.27, 0.27, 0.02, 20), shirt);
    brim.position.y = 0.93;
    hips.add(hat, brim);

    const mkArm = (side) => {
      const sh = new THREE.Group();
      sh.position.set(0.3 * side, 0.6, 0);
      const upper = limb(0.32, 0.065, shirt);
      const elbow = new THREE.Group();
      elbow.position.y = -0.3;
      const lower = limb(0.3, 0.055, skin);
      elbow.add(lower);
      upper.add(elbow);
      sh.add(upper);
      hips.add(sh);
      return { sh, elbow };
    };
    const mkLeg = (side) => {
      const hip = new THREE.Group();
      hip.position.set(0.11 * side, 0, 0);
      const upper = limb(0.46, 0.085, pants);
      const knee = new THREE.Group();
      knee.position.y = -0.44;
      const lower = limb(0.46, 0.075, pants);
      const boot = new THREE.Mesh(new THREE.BoxGeometry(0.13, 0.1, 0.24), boots);
      boot.position.set(0, -0.44, 0.05);
      boot.castShadow = true;
      lower.add(boot);
      knee.add(lower);
      upper.add(knee);
      hip.add(upper);
      hips.add(hip);
      return { hip, knee };
    };
    this.armL = mkArm(1); this.armR = mkArm(-1);
    this.legL = mkLeg(1); this.legR = mkLeg(-1);

    if (name) {
      const tex = makeLabelTexture(name, color);
      const sprite = new THREE.Sprite(new THREE.SpriteMaterial({ map: tex, depthTest: false, transparent: true }));
      sprite.scale.set(1.6, 0.4, 1);
      sprite.position.y = 2.3;
      sprite.renderOrder = 10;
      this.root.add(sprite);
      this.label = sprite;
    }
    this.phase = 0;
    this.crouch = 0;
  }

  /** speed in m/s, airborne bool, crouching bool (hiding in a bush). */
  animate(dt, speed, airborne, crouching) {
    const run = Math.min(speed / 10, 1);
    this.phase += dt * (3 + speed * 1.15);
    const s = Math.sin(this.phase);
    const swing = speed > 0.3 ? 0.35 + run * 0.6 : 0;
    this.crouch += ((crouching ? 1 : 0) - this.crouch) * Math.min(1, dt * 8);
    const c = this.crouch;

    this.legL.hip.rotation.x = s * swing - c * 1.4;
    this.legR.hip.rotation.x = -s * swing - c * 1.4;
    this.legL.knee.rotation.x = Math.max(0, -s) * swing * 1.2 + c * 2.2;
    this.legR.knee.rotation.x = Math.max(0, s) * swing * 1.2 + c * 2.2;
    this.armL.sh.rotation.x = -s * swing * 0.9 - c * 0.6;
    this.armR.sh.rotation.x = s * swing * 0.9 - c * 0.6;
    this.armL.elbow.rotation.x = -0.3 - run * 0.9;
    this.armR.elbow.rotation.x = -0.3 - run * 0.9;
    this.armL.sh.rotation.z = 0.08;
    this.armR.sh.rotation.z = -0.08;

    if (airborne) {
      this.legL.hip.rotation.x = -0.6; this.legL.knee.rotation.x = 1.0;
      this.legR.hip.rotation.x = 0.2; this.legR.knee.rotation.x = 0.4;
      this.armL.sh.rotation.z = 0.7; this.armR.sh.rotation.z = -0.7;
    }
    this.hips.position.y = 0.95 - c * 0.48 + (speed > 0.3 && !airborne ? Math.abs(Math.cos(this.phase)) * 0.05 * (0.5 + run) : 0);
    this.hips.rotation.x = run * 0.2 + c * 0.35;
  }
}
