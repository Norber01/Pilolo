// Height field generation + terrain mesh. getHeight() is used for all ground collision.
import * as THREE from 'three';
import { WORLD } from '../config.js';
import { createNoise2D, fbm, ridged } from './noise.js';
import { REGIONS, regionWeights, dominantRegion } from './regions.js';
import { smoothstep, clamp } from './rng.js';

const nA = createNoise2D(WORLD.seed + 1);
const nB = createNoise2D(WORLD.seed + 2);
const nC = createNoise2D(WORLD.seed + 3);

function regionHeight(i, x, z) {
  switch (REGIONS[i].id) {
    case 'camp':
      return 3 + fbm(nA, x / 300, z / 300, 3) * 3;
    case 'savanna': {
      const outcrop = Math.max(0, nC(x / 85, z / 85) - 0.62) * 55;
      return 4 + fbm(nA, x / 420, z / 420, 4) * 9 + outcrop;
    }
    case 'forest':
      return 10 + fbm(nB, x / 260, z / 260, 5) * 26;
    case 'highlands':
      return 18 + ridged(nB, x / 380 + 7, z / 380 - 3, 5) * 130 - 30;
    case 'swamp':
      return WORLD.waterLevel + fbm(nC, x / 90, z / 90, 4) * 3.2 - 0.4;
    default:
      return 0;
  }
}

export class Terrain {
  constructor() {
    const { size, segments } = WORLD;
    this.size = size;
    this.half = size / 2;
    this.segments = segments;
    this.step = size / segments;
    const n = segments + 1;
    this.heights = new Float32Array(n * n);
    this.regionIdx = new Uint8Array(n * n);
    this.weights = new Float32Array(n * n * REGIONS.length);

    const w = new Float32Array(REGIONS.length);
    for (let iz = 0; iz < n; iz++) {
      for (let ix = 0; ix < n; ix++) {
        const x = -this.half + ix * this.step;
        const z = -this.half + iz * this.step;
        regionWeights(x, z, w);
        let h = 0;
        for (let r = 0; r < REGIONS.length; r++) if (w[r] > 0.002) h += w[r] * regionHeight(r, x, z);
        // Mountain wall around the edge of the map.
        const edge = Math.max(Math.abs(x), Math.abs(z)) / this.half;
        h += Math.pow(smoothstep(0.86, 1.0, edge), 1.4) * 170;
        // Flatten the camp so everyone spawns on even ground.
        const camp = smoothstep(60, 20, Math.hypot(x, z));
        h = h * (1 - camp) + 3.2 * camp;
        const k = iz * n + ix;
        this.heights[k] = h;
        this.regionIdx[k] = dominantRegion(w);
        this.weights.set(w, k * REGIONS.length);
      }
    }
  }

  getHeight(x, z) {
    const n = this.segments + 1;
    const fx = clamp((x + this.half) / this.step, 0, this.segments - 0.0001);
    const fz = clamp((z + this.half) / this.step, 0, this.segments - 0.0001);
    const ix = Math.floor(fx), iz = Math.floor(fz);
    const tx = fx - ix, tz = fz - iz;
    const h = this.heights;
    const a = h[iz * n + ix], b = h[iz * n + ix + 1];
    const c = h[(iz + 1) * n + ix], d = h[(iz + 1) * n + ix + 1];
    // Match the triangle split used by PlaneGeometry so feet sit exactly on the mesh.
    if (tx + tz < 1) return a + (b - a) * tx + (c - a) * tz;
    return d + (c - d) * (1 - tx) + (b - d) * (1 - tz);
  }

  slope(x, z) {
    const e = 1.5;
    const dx = this.getHeight(x + e, z) - this.getHeight(x - e, z);
    const dz = this.getHeight(x, z + e) - this.getHeight(x, z - e);
    return Math.hypot(dx, dz) / (2 * e);
  }

  regionAt(x, z) {
    const n = this.segments + 1;
    const ix = Math.round(clamp((x + this.half) / this.step, 0, this.segments));
    const iz = Math.round(clamp((z + this.half) / this.step, 0, this.segments));
    return this.regionIdx[iz * n + ix];
  }

  weightsAt(x, z, out) {
    const n = this.segments + 1;
    const ix = Math.round(clamp((x + this.half) / this.step, 0, this.segments));
    const iz = Math.round(clamp((z + this.half) / this.step, 0, this.segments));
    const k = (iz * n + ix) * REGIONS.length;
    for (let r = 0; r < REGIONS.length; r++) out[r] = this.weights[k + r];
    return out;
  }

  buildMesh(detailTexture) {
    const { size, segments } = this;
    const geo = new THREE.PlaneGeometry(size, size, segments, segments);
    geo.rotateX(-Math.PI / 2);
    const pos = geo.attributes.position;
    const n = segments + 1;
    const colors = new Float32Array(pos.count * 3);
    const tmp = new THREE.Color();
    const c1 = new THREE.Color();
    const rock = new THREE.Color(0x7a746a);
    const snow = new THREE.Color(0xf2f4f7);
    const mud = new THREE.Color(0x5a4a33);
    const sand = new THREE.Color(0xb9a77a);
    const palettes = REGIONS.map((r) => r.ground.map((g) => new THREE.Color(g)));

    for (let i = 0; i < pos.count; i++) {
      const ix = i % n, iz = Math.floor(i / n);
      const x = pos.getX(i), z = pos.getZ(i);
      const h = this.heights[iz * n + ix];
      pos.setY(i, h);
      const k = (iz * n + ix) * REGIONS.length;
      const v = nA(x / 35, z / 35) * 0.5 + 0.5;
      tmp.setRGB(0, 0, 0);
      for (let r = 0; r < REGIONS.length; r++) {
        const wgt = this.weights[k + r];
        if (wgt < 0.002) continue;
        c1.copy(palettes[r][0]).lerp(palettes[r][1], v);
        tmp.r += c1.r * wgt; tmp.g += c1.g * wgt; tmp.b += c1.b * wgt;
      }
      const s = this.slope(x, z);
      tmp.lerp(rock, smoothstep(0.55, 1.0, s));
      if (h < WORLD.waterLevel + 0.8) tmp.lerp(this.regionIdx[iz * n + ix] === 4 ? mud : sand, smoothstep(WORLD.waterLevel + 0.8, WORLD.waterLevel - 0.2, h) * 0.8);
      tmp.lerp(snow, smoothstep(78, 95, h + nB(x / 20, z / 20) * 6) * (1 - smoothstep(0.9, 1.3, s) * 0.5));
      const shade = 0.88 + nC(x / 9, z / 9) * 0.12;
      colors[i * 3] = tmp.r * shade;
      colors[i * 3 + 1] = tmp.g * shade;
      colors[i * 3 + 2] = tmp.b * shade;
    }
    geo.setAttribute('color', new THREE.BufferAttribute(colors, 3));
    geo.computeVertexNormals();
    const mat = new THREE.MeshStandardMaterial({
      vertexColors: true,
      roughness: 0.96,
      metalness: 0,
      map: detailTexture,
    });
    const mesh = new THREE.Mesh(geo, mat);
    mesh.receiveShadow = true;
    mesh.name = 'terrain';
    return mesh;
  }
}
