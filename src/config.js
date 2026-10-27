// Central tuning knobs. Change numbers here to rebalance the game.

export const WORLD = {
  seed: 20261027,      // same seed for everyone => same world for everyone
  size: 2400,          // metres, edge to edge (world spans -1200..1200)
  segments: 320,       // terrain grid resolution
  waterLevel: 1.2,
  chunkSize: 200,      // vegetation is grouped in chunks for culling + LOD
};

export const GAME = {
  minPlayers: 2,
  maxPlayers: 3,
  hideSeconds: 75,     // time the hider gets to find a bush
  seekSeconds: 300,    // time seekers get to find the hider
  hintEvery: 60,       // seconds between map hints for seekers
  hintRadii: [260, 180, 120, 80],
  searchRange: 3.6,    // how close a seeker must be to search a bush
  hideRange: 3.0,      // how close the hider must be to enter a bush
  tagRange: 2.6,       // tag a hider who is out in the open
  searchTime: 0.9,     // seconds a bush search takes
  respawnSeconds: 4,
};

export const PLAYER = {
  walk: 5.5,
  sprint: 10.5,
  jump: 7.5,
  gravity: 24,
  radius: 0.45,
  maxHealth: 100,
};

export const NET = {
  sendHz: 10,
};

export const SPAWN = { x: 0, z: 0 };
