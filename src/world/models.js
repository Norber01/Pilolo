// Procedural low/high detail models for trees, bushes and rocks (vertex coloured, merged).
import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { createNoise2D } from './noise.js';
import { mulberry32 } from './rng.js';

const noise = createNoise2D(4242);

function prep(geo, color, { jitter = 0, colorJitter = 0.08, seed = 1, normals = 'keep' } = {}) {
  const g = geo.index ? geo.toNonIndexed() : geo;
  g.deleteAttribute('uv');
  const pos = g.attributes.position;
  if (jitter > 0) {
    // Displacement depends only on the vertex position, so shared corners stay welded.
    for (let i = 0; i < pos.count; i++) {
      const x = pos.getX(i), y = pos.getY(i), z = pos.getZ(i);
      const k = 1 + noise(x * 1.7 + seed * 13.1, z * 1.7 + y * 1.3) * jitter;
      pos.setXYZ(i, x * k, y * (1 + (k - 1) * 0.6), z * k);
    }
  }
  const c = new THREE.Color(color);
  const cols = new Float32Array(pos.count * 3);
  const rand = mulberry32(seed * 7919);
  for (let i = 0; i < pos.count; i += 3) {
    const v = 1 + (rand() - 0.5) * 2 * colorJitter;
    for (let k = 0; k < 3; k++) {
      // Slightly darker underneath: cheap ambient occlusion.
      const y = pos.getY(i + k);
      const ao = THREE.MathUtils.clamp(0.75 + y * 0.12, 0.7, 1.08);
      cols[(i + k) * 3] = c.r * v * ao;
      cols[(i + k) * 3 + 1] = c.g * v * ao;
      cols[(i + k) * 3 + 2] = c.b * v * ao;
    }
  }
  g.setAttribute('color', new THREE.BufferAttribute(cols, 3));
  if (normals === 'flat') {
    g.computeVertexNormals();
  } else if (normals === 'radial') {
    // Soft, rounded lighting for foliage clumps.
    const nrm = new Float32Array(pos.count * 3);
    const v = new THREE.Vector3();
    for (let i = 0; i < pos.count; i++) {
      v.fromBufferAttribute(pos, i).normalize();
      nrm[i * 3] = v.x; nrm[i * 3 + 1] = v.y; nrm[i * 3 + 2] = v.z;
    }
    g.setAttribute('normal', new THREE.BufferAttribute(nrm, 3));
  }
  return g;
}

function blob(r, detail, color, x, y, z, sx = 1, sy = 1, sz = 1, seed = 1, jitter = 0.22) {
  const g = new THREE.IcosahedronGeometry(r, detail);
  g.scale(sx, sy, sz);
  const p = prep(g, color, { jitter, seed, normals: 'radial' });
  p.translate(x, y, z);
  return p;
}

function trunk(h, r0, r1, color, seg, x = 0, z = 0, tiltX = 0, tiltZ = 0) {
  const g = new THREE.CylinderGeometry(r1, r0, h, seg, 1, true);
  g.translate(0, h / 2, 0);
  g.rotateX(tiltX);
  g.rotateZ(tiltZ);
  g.translate(x, 0, z);
  return prep(g, color, { colorJitter: 0.05 });
}

function merged(parts) {
  const g = mergeGeometries(parts, false);
  g.computeBoundingSphere();
  return g;
}

// Each builder returns { wood, leaves } geometries (separate materials so leaves can sway).
export function buildPine(lod) {
  const seg = lod ? 5 : 8;
  const wood = merged([trunk(3.2, 0.32, 0.18, 0x5b4330, seg)]);
  const parts = [];
  const tiers = lod ? 3 : 4;
  for (let i = 0; i < tiers; i++) {
    const r = 2.6 - i * 0.55;
    const h = 3.4 - i * 0.35;
    const g = new THREE.ConeGeometry(r, h, lod ? 6 : 10, lod ? 1 : 3);
    g.translate(0, 2.2 + i * 1.9 + h / 2, 0);
    parts.push(prep(g, i % 2 ? 0x2c4a26 : 0x335a2b, { jitter: lod ? 0 : 0.12, seed: i + 3 }));
  }
  return { wood, leaves: merged(parts), trunkRadius: 0.35 };
}

export function buildOak(lod) {
  const d = lod ? 0 : 1;
  const wood = merged([
    trunk(3.4, 0.42, 0.26, 0x5e4a36, lod ? 5 : 8),
    trunk(2.2, 0.16, 0.08, 0x5e4a36, 5, 0.2, 0, 0, -0.8),
    trunk(2.0, 0.15, 0.08, 0x5e4a36, 5, -0.2, 0, 0.7, 0.5),
  ]);
  const leaves = merged([
    blob(2.4, d, 0x47692f, 0, 5.2, 0, 1.1, 0.8, 1.1, 1),
    blob(1.8, d, 0x52763a, 1.6, 4.6, 0.6, 1, 0.8, 1, 2),
    blob(1.7, d, 0x3f6029, -1.5, 4.7, -0.5, 1, 0.8, 1, 3),
    blob(1.6, d, 0x4b6e33, 0.2, 6.4, -0.9, 1, 0.8, 1, 4),
  ]);
  return { wood, leaves, trunkRadius: 0.45 };
}

export function buildAcacia(lod) {
  const d = lod ? 0 : 1;
  const wood = merged([
    trunk(3.6, 0.3, 0.2, 0x6a5440, lod ? 5 : 7, 0, 0, 0.12, 0),
    trunk(2.6, 0.15, 0.1, 0x6a5440, 5, 0, 0.3, 0.2, 0.75),
    trunk(2.6, 0.15, 0.1, 0x6a5440, 5, 0, 0.3, 0.1, -0.7),
  ]);
  const leaves = merged([
    blob(3.6, d, 0x6f7a33, 0, 5.4, 0.3, 1.25, 0.28, 1.1, 5, 0.3),
    blob(2.2, d, 0x7a8238, 2.2, 5.0, 0.5, 1, 0.3, 1, 6, 0.3),
    blob(2.1, d, 0x66702f, -2.0, 5.1, 0.2, 1, 0.3, 1, 7, 0.3),
  ]);
  return { wood, leaves, trunkRadius: 0.35 };
}

export function buildSwampTree(lod) {
  const d = lod ? 0 : 1;
  const wood = merged([
    trunk(4.6, 0.5, 0.2, 0x3e362b, lod ? 5 : 8),
    trunk(1.2, 0.18, 0.12, 0x3e362b, 5, 0.45, 0, 0, 0.5),
    trunk(1.2, 0.18, 0.12, 0x3e362b, 5, -0.45, 0, 0, -0.5),
    trunk(1.2, 0.18, 0.12, 0x3e362b, 5, 0, 0.45, -0.5, 0),
    trunk(2.4, 0.12, 0.06, 0x3e362b, 4, 0, 0, 0, -0.9),
  ]);
  const leaves = merged([
    blob(2.2, d, 0x4a5a2a, 0.2, 5.0, 0, 1.2, 1.1, 1.2, 8, 0.35),
    blob(1.4, d, 0x55652d, 1.8, 4.1, 0.4, 1, 1.4, 1, 9, 0.35),
    blob(1.3, d, 0x404f25, -1.2, 4.4, -0.8, 1, 1.4, 1, 10, 0.35),
  ]);
  return { wood, leaves, trunkRadius: 0.5 };
}

export function buildBush(lod) {
  const d = lod ? 0 : 1;
  const parts = [
    blob(1.05, d, 0x3d6a2a, 0, 0.75, 0, 1.15, 0.85, 1.15, 11),
    blob(0.8, d, 0x467534, 0.75, 0.6, 0.35, 1, 0.9, 1, 12),
    blob(0.8, d, 0x355f25, -0.7, 0.6, -0.3, 1, 0.9, 1, 13),
    blob(0.7, d, 0x4b7a38, 0.1, 0.55, -0.8, 1, 0.9, 1, 14),
    blob(0.7, d, 0x3a6329, -0.2, 0.55, 0.85, 1, 0.9, 1, 15),
  ];
  if (!lod) parts.push(blob(0.6, d, 0x4f7f3a, 0.2, 1.35, 0.1, 1, 0.9, 1, 16));
  return { leaves: merged(parts) };
}

export function buildRock(lod) {
  const g = new THREE.DodecahedronGeometry(1, lod ? 0 : 1);
  g.scale(1.3, 0.8, 1.1);
  const p = prep(g, 0x8a857c, { jitter: 0.25, seed: 21, colorJitter: 0.12, normals: 'flat' });
  p.translate(0, 0.35, 0);
  p.computeBoundingSphere();
  return { wood: p };
}
