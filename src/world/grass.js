// A field of grass tufts that follows the camera, so the ground looks lush without millions of blades.
import * as THREE from 'three';
import { WORLD } from '../config.js';
import { REGIONS } from './regions.js';
import { hash2 } from './rng.js';
import { foliageMaterial } from './materials.js';

function tuftGeometry() {
  const pos = [], col = [];
  const blades = 7;
  for (let b = 0; b < blades; b++) {
    const a = (b / blades) * Math.PI * 2 + b * 0.7;
    const r = 0.12 + (b % 3) * 0.08;
    const bx = Math.cos(a) * r, bz = Math.sin(a) * r;
    const h = 0.28 + ((b * 37) % 10) / 34;
    const lean = 0.12;
    const w = 0.035;
    const px = -Math.sin(a) * w, pz = Math.cos(a) * w;
    // Two triangles per blade, tip leaning outward.
    const tip = [bx + Math.cos(a) * lean, h, bz + Math.sin(a) * lean];
    pos.push(bx - px, 0, bz - pz, bx + px, 0, bz + pz, ...tip);
    pos.push(bx + px, 0, bz + pz, bx - px, 0, bz - pz, ...tip);
    for (let k = 0; k < 2; k++) col.push(0.4, 0.4, 0.4, 0.4, 0.4, 0.4, 0.85, 0.85, 0.8);
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('color', new THREE.Float32BufferAttribute(col, 3));
  const nrm = [];
  for (let i = 0; i < pos.length; i += 3) nrm.push(0, 1, 0); // light like the ground underneath
  g.setAttribute('normal', new THREE.Float32BufferAttribute(nrm, 3));
  return g;
}

export class GrassField {
  constructor(terrain, scene, { count = 6000, radius = 42 } = {}) {
    this.terrain = terrain;
    this.radius = radius;
    this.count = count;
    this.spacing = Math.sqrt((Math.PI * radius * radius) / count);
    const mat = foliageMaterial({ sway: 0.5, roughness: 1 });
    mat.side = THREE.DoubleSide;
    this.mesh = new THREE.InstancedMesh(tuftGeometry(), mat, count);
    this.mesh.frustumCulled = false;
    this.mesh.receiveShadow = true;
    scene.add(this.mesh);
    this.colors = REGIONS.map((r) => new THREE.Color(r.grass));
    this.heightScale = { camp: 1, savanna: 1.5, forest: 0.9, highlands: 0.6, swamp: 1.3 };
    this.last = new THREE.Vector2(1e9, 1e9);
    this.w = new Float32Array(REGIONS.length);
  }

  update(center) {
    if (Math.hypot(center.x - this.last.x, center.z - this.last.y) < this.spacing * 4) return;
    this.last.set(center.x, center.z);
    const t = this.terrain, s = this.spacing, r = this.radius;
    const m4 = new THREE.Matrix4(), q = new THREE.Quaternion(), sc = new THREE.Vector3(), p = new THREE.Vector3();
    const up = new THREE.Vector3(0, 1, 0);
    const c = new THREE.Color();
    let i = 0;
    const x0 = Math.floor((center.x - r) / s), x1 = Math.floor((center.x + r) / s);
    const z0 = Math.floor((center.z - r) / s), z1 = Math.floor((center.z + r) / s);
    for (let gx = x0; gx <= x1 && i < this.count; gx++) {
      for (let gz = z0; gz <= z1 && i < this.count; gz++) {
        const x = (gx + hash2(gx, gz, 21)) * s, z = (gz + hash2(gx, gz, 22)) * s;
        const d = Math.hypot(x - center.x, z - center.z);
        if (d > r) continue;
        const h = t.getHeight(x, z);
        if (h < WORLD.waterLevel + 0.1 || h > 84) continue;
        const reg = t.regionAt(x, z);
        if (reg === 3 && hash2(gx, gz, 23) > 0.5) continue; // patchy highland grass
        t.weightsAt(x, z, this.w);
        c.setRGB(0, 0, 0);
        for (let k = 0; k < this.w.length; k++) {
          c.r += this.colors[k].r * this.w[k]; c.g += this.colors[k].g * this.w[k]; c.b += this.colors[k].b * this.w[k];
        }
        const v = 0.8 + hash2(gx, gz, 24) * 0.4;
        c.multiplyScalar(v);
        const hs = this.heightScale[REGIONS[reg].id] * (0.7 + hash2(gx, gz, 25) * 0.7) * (1 - Math.max(0, (d - r * 0.75) / (r * 0.25)) * 0.8);
        q.setFromAxisAngle(up, hash2(gx, gz, 26) * 6.28);
        sc.set(1, hs, 1);
        p.set(x, h - 0.05, z);
        m4.compose(p, q, sc);
        this.mesh.setMatrixAt(i, m4);
        this.mesh.setColorAt(i, c);
        i++;
      }
    }
    this.mesh.count = i;
    this.mesh.instanceMatrix.needsUpdate = true;
    if (this.mesh.instanceColor) this.mesh.instanceColor.needsUpdate = true;
  }
}
