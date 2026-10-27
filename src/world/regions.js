// The world is split into named regions, each with its own look, plants and predators.
import { createNoise2D } from './noise.js';
import { WORLD } from '../config.js';

export const REGIONS = [
  {
    id: 'camp', name: 'Base Camp Meadow', center: [0, 0], scale: 2.6,
    ground: [0x6f8f3a, 0x88a04a], grass: 0x7fa042, map: '#7fa047',
    trees: { oak: 0.25 }, bushDensity: 0.35, rockDensity: 0.05, animal: null, animalCount: 0,
  },
  {
    id: 'savanna', name: 'Golden Savanna', center: [620, 520], scale: 1,
    ground: [0xa8904f, 0xc2a35c], grass: 0xc9a85a, map: '#c9a24f',
    trees: { acacia: 0.5 }, bushDensity: 0.55, rockDensity: 0.25, animal: 'lion', animalCount: 22,
  },
  {
    id: 'forest', name: 'Whispering Forest', center: [-640, 480], scale: 1,
    ground: [0x3f5a26, 0x506d30], grass: 0x4f7a2c, map: '#3f6b2a',
    trees: { pine: 1.0, oak: 0.8 }, bushDensity: 0.9, rockDensity: 0.15, animal: 'wolf', animalCount: 20,
  },
  {
    id: 'highlands', name: 'Stonepeak Highlands', center: [-560, -600], scale: 1,
    ground: [0x6b6a55, 0x7d7a62], grass: 0x7a8550, map: '#8a8670',
    trees: { pine: 0.35 }, bushDensity: 0.35, rockDensity: 0.9, animal: 'bear', animalCount: 12,
  },
  {
    id: 'swamp', name: 'Murkwater Swamp', center: [600, -580], scale: 1,
    ground: [0x3d4a2a, 0x4b5531], grass: 0x5a6b30, map: '#4d5a3a',
    trees: { swamp: 0.7 }, bushDensity: 0.8, rockDensity: 0.05, animal: 'croc', animalCount: 16,
  },
];

const warpNoise = createNoise2D(WORLD.seed + 11);
const BLEND = 110;

/** Returns blend weights (summing to 1) for every region at world position x,z. */
export function regionWeights(x, z, out = new Float32Array(REGIONS.length)) {
  const wx = x + warpNoise(x / 520, z / 520) * 230 + warpNoise(x / 140, z / 140) * 40;
  const wz = z + warpNoise(z / 520 + 31, x / 520 - 17) * 230 + warpNoise(z / 140 + 9, x / 140) * 40;
  let dmin = Infinity;
  for (let i = 0; i < REGIONS.length; i++) {
    const c = REGIONS[i].center;
    const d = Math.hypot(wx - c[0], wz - c[1]) * REGIONS[i].scale;
    out[i] = d;
    if (d < dmin) dmin = d;
  }
  let sum = 0;
  for (let i = 0; i < REGIONS.length; i++) {
    const w = Math.exp(-(out[i] - dmin) / (BLEND * 0.35));
    out[i] = w;
    sum += w;
  }
  for (let i = 0; i < REGIONS.length; i++) out[i] /= sum;
  return out;
}

export function dominantRegion(weights) {
  let best = 0;
  for (let i = 1; i < weights.length; i++) if (weights[i] > weights[best]) best = i;
  return best;
}
