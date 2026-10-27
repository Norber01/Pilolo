// Places trees, bushes and rocks across all regions, grouped into chunks with 2 levels of detail.
import * as THREE from 'three';
import { WORLD } from '../config.js';
import { REGIONS } from './regions.js';
import { createNoise2D } from './noise.js';
import { hash2, mulberry32 } from './rng.js';
import { buildPine, buildOak, buildAcacia, buildSwampTree, buildBush, buildRock } from './models.js';
import { foliageMaterial, solidMaterial } from './materials.js';

const BUILDERS = { pine: buildPine, oak: buildOak, acacia: buildAcacia, swamp: buildSwampTree, bush: buildBush, rock: buildRock };
const LOD_DISTANCE = 170;

/** Uniform grid used for fast "what is near me" queries. */
export class SpatialGrid {
  constructor(cell = 20) {
    this.cell = cell;
    this.map = new Map();
  }
  key(ix, iz) { return ix * 100003 + iz; }
  add(item) {
    const k = this.key(Math.floor(item.x / this.cell), Math.floor(item.z / this.cell));
    let arr = this.map.get(k);
    if (!arr) this.map.set(k, (arr = []));
    arr.push(item);
  }
  query(x, z, r, out = []) {
    out.length = 0;
    const c = this.cell;
    const x0 = Math.floor((x - r) / c), x1 = Math.floor((x + r) / c);
    const z0 = Math.floor((z - r) / c), z1 = Math.floor((z + r) / c);
    for (let ix = x0; ix <= x1; ix++) {
      for (let iz = z0; iz <= z1; iz++) {
        const arr = this.map.get(this.key(ix, iz));
        if (arr) for (const it of arr) out.push(it);
      }
    }
    return out;
  }
}

export class Vegetation {
  constructor(terrain, scene) {
    this.terrain = terrain;
    this.scene = scene;
    this.colliders = new SpatialGrid(20);
    this.bushGrid = new SpatialGrid(20);
    this.bushes = []; // index = bush id, shared by every client
    this.chunks = [];
    this.materials = {
      leaves: foliageMaterial({ sway: 0.05 }),
      bushLeaves: foliageMaterial({ sway: 0.12 }),
      wood: solidMaterial({ roughness: 0.95 }),
    };
    this.models = {};
    for (const [k, b] of Object.entries(BUILDERS)) this.models[k] = [b(false), b(true)];
    this.place();
    this.buildChunks();
  }

  place() {
    const t = this.terrain;
    const half = t.half;
    const density = createNoise2D(WORLD.seed + 77);
    const w = new Float32Array(REGIONS.length);
    const items = [];
    const pickRegion = (x, z, r) => {
      t.weightsAt(x, z, w);
      let acc = 0;
      for (let i = 0; i < w.length; i++) { acc += w[i]; if (r <= acc) return i; }
      return w.length - 1;
    };
    const valid = (x, z, minH = WORLD.waterLevel + 0.25) => {
      const edge = Math.max(Math.abs(x), Math.abs(z)) / half;
      if (edge > 0.9) return false;
      if (Math.hypot(x, z) < 22) return false;
      const h = t.getHeight(x, z);
      if (h < minH) return false;
      if (t.slope(x, z) > 0.85) return false;
      return true;
    };

    // Trees + rocks on a jittered grid.
    const tStep = 9;
    for (let gx = -half; gx < half; gx += tStep) {
      for (let gz = -half; gz < half; gz += tStep) {
        const ix = Math.round(gx / tStep), iz = Math.round(gz / tStep);
        const x = gx + hash2(ix, iz, 1) * tStep, z = gz + hash2(ix, iz, 2) * tStep;
        const reg = REGIONS[pickRegion(x, z, hash2(ix, iz, 3))];
        const patch = density(x / 160, z / 160) * 0.5 + 0.5; // forests come in clumps
        const roll = hash2(ix, iz, 4);
        let acc = 0;
        for (const [type, d] of Object.entries(reg.trees)) {
          acc += d * 0.42 * (0.35 + patch * 1.3);
          if (roll < acc) {
            if (!valid(x, z, type === 'swamp' ? WORLD.waterLevel - 0.4 : undefined)) break;
            items.push({ type, x, z, s: 0.8 + hash2(ix, iz, 5) * 0.55, ry: hash2(ix, iz, 6) * Math.PI * 2 });
            break;
          }
        }
        if (roll >= acc && hash2(ix, iz, 7) < reg.rockDensity * 0.18 && valid(x, z)) {
          items.push({ type: 'rock', x, z, s: 0.6 + Math.pow(hash2(ix, iz, 8), 2) * 2.6, ry: hash2(ix, iz, 9) * 6.28 });
        }
      }
    }

    // Bushes: the hiding spots. Kept on their own grid so ids are stable.
    const bStep = 16;
    for (let gx = -half; gx < half; gx += bStep) {
      for (let gz = -half; gz < half; gz += bStep) {
        const ix = Math.round(gx / bStep), iz = Math.round(gz / bStep);
        const x = gx + hash2(ix, iz, 11) * bStep, z = gz + hash2(ix, iz, 12) * bStep;
        const reg = REGIONS[pickRegion(x, z, hash2(ix, iz, 13))];
        if (hash2(ix, iz, 14) > reg.bushDensity * 0.75) continue;
        if (!valid(x, z)) continue;
        items.push({ type: 'bush', x, z, s: 0.95 + hash2(ix, iz, 15) * 0.35, ry: hash2(ix, iz, 16) * 6.28, region: reg });
      }
    }
    // A few bushes around camp so the first round is easy to learn.
    const rand = mulberry32(WORLD.seed);
    for (let i = 0; i < 10; i++) {
      const a = (i / 10) * Math.PI * 2 + rand() * 0.3, r = 30 + rand() * 25;
      items.push({ type: 'bush', x: Math.cos(a) * r, z: Math.sin(a) * r, s: 1.1, ry: rand() * 6.28, region: REGIONS[0] });
    }
    this.items = items;
  }

  buildChunks() {
    const t = this.terrain;
    const cs = WORLD.chunkSize;
    const n = Math.ceil(t.size / cs);
    const grid = new Map();
    const tint = new THREE.Color();
    for (const it of this.items) {
      it.y = t.getHeight(it.x, it.z);
      const cx = Math.min(n - 1, Math.floor((it.x + t.half) / cs));
      const cz = Math.min(n - 1, Math.floor((it.z + t.half) / cs));
      const key = cx * n + cz;
      let ch = grid.get(key);
      if (!ch) grid.set(key, (ch = { cx, cz, byType: {} }));
      (ch.byType[it.type] ||= []).push(it);
      if (it.type === 'bush') {
        it.id = this.bushes.length;
        this.bushes.push(it);
        this.bushGrid.add(it);
      } else {
        const model = this.models[it.type][0];
        const r = it.type === 'rock' ? it.s * 1.05 : model.trunkRadius * it.s;
        this.colliders.add({ x: it.x, z: it.z, y0: it.y, r, h: it.type === 'rock' ? it.s * 0.9 : 99 });
      }
    }

    const m4 = new THREE.Matrix4(), q = new THREE.Quaternion(), sc = new THREE.Vector3(), p = new THREE.Vector3();
    const up = new THREE.Vector3(0, 1, 0);
    for (const ch of grid.values()) {
      const center = new THREE.Vector3((ch.cx + 0.5) * cs - t.half, 0, (ch.cz + 0.5) * cs - t.half);
      center.y = t.getHeight(center.x, center.z);
      const lods = [new THREE.Group(), new THREE.Group()];
      for (const [type, list] of Object.entries(ch.byType)) {
        for (let lod = 0; lod < 2; lod++) {
          const model = this.models[type][lod];
          const parts = [];
          if (model.wood) parts.push([model.wood, this.materials.wood]);
          if (model.leaves) parts.push([model.leaves, type === 'bush' ? this.materials.bushLeaves : this.materials.leaves]);
          for (const [geo, mat] of parts) {
            const mesh = new THREE.InstancedMesh(geo, mat, list.length);
            list.forEach((it, i) => {
              q.setFromAxisAngle(up, it.ry);
              sc.setScalar(it.s);
              if (type === 'rock') sc.set(it.s * (0.8 + hash2(i, 1) * 0.6), it.s * (0.6 + hash2(i, 2) * 0.6), it.s);
              p.set(it.x, it.y - (type === 'rock' ? 0.3 * it.s : 0.05), it.z);
              m4.compose(p, q, sc);
              mesh.setMatrixAt(i, m4);
              const v = 0.85 + hash2(Math.floor(it.x), Math.floor(it.z), 3) * 0.3;
              const regTint = it.region && it.region.id === 'savanna' ? 0.15 : 0;
              tint.setRGB(v + regTint, v + regTint * 0.6, v * (1 - regTint));
              mesh.setColorAt(i, tint);
              if (type === 'bush' && geo === model.leaves) {
                (it.refs ||= []).push([mesh, i]);
                it.tint = tint.clone();
              }
            });
            mesh.instanceMatrix.needsUpdate = true;
            if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true;
            mesh.computeBoundingSphere();
            mesh.castShadow = lod === 0 && type !== 'rock';
            mesh.receiveShadow = true;
            lods[lod].add(mesh);
          }
        }
      }
      lods[1].visible = false;
      this.scene.add(lods[0], lods[1]);
      this.chunks.push({ center, lods });
    }
  }

  /** Distance culling + LOD swap. Call every few frames. */
  update(camPos, viewDistance) {
    const cs = WORLD.chunkSize;
    for (const ch of this.chunks) {
      const d = Math.hypot(ch.center.x - camPos.x, ch.center.z - camPos.z) - cs * 0.7;
      const near = d < LOD_DISTANCE;
      ch.lods[0].visible = near;
      ch.lods[1].visible = !near && d < viewDistance;
    }
  }

  nearestBush(x, z, maxDist) {
    let best = null, bd = maxDist;
    for (const b of this.bushGrid.query(x, z, maxDist, this._tmp || (this._tmp = []))) {
      const d = Math.hypot(b.x - x, b.z - z);
      if (d < bd) { bd = d; best = b; }
    }
    return best;
  }

  /** Darken a bush so seekers can see it has already been searched. */
  markSearched(id) {
    const b = this.bushes[id];
    if (!b || b.searched) return;
    b.searched = true;
    const c = new THREE.Color(0.55, 0.42, 0.3);
    for (const [mesh, i] of b.refs) {
      mesh.setColorAt(i, c);
      mesh.instanceColor.needsUpdate = true;
    }
  }

  clearSearched() {
    for (const b of this.bushes) {
      if (!b.searched) continue;
      b.searched = false;
      for (const [mesh, i] of b.refs) { mesh.setColorAt(i, b.tint); mesh.instanceColor.needsUpdate = true; }
    }
  }

  /** Push a circle (player/animal) out of trunks and rocks. */
  resolveCollisions(pos, radius, footY) {
    for (const c of this.colliders.query(pos.x, pos.z, radius + 4, this._tmp2 || (this._tmp2 = []))) {
      if (footY > c.y0 + c.h) continue;
      const dx = pos.x - c.x, dz = pos.z - c.z;
      const d = Math.hypot(dx, dz);
      const min = radius + c.r;
      if (d < min && d > 1e-4) {
        pos.x = c.x + (dx / d) * min;
        pos.z = c.z + (dz / d) * min;
      }
    }
  }
}
