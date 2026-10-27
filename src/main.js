import './style.css';
import * as THREE from 'three';
import { World } from './world/world.js';
import { Wildlife } from './entities/animals.js';
import { Controls } from './game/controls.js';
import { ThirdPersonCamera } from './game/camera.js';
import { Game } from './game/game.js';
import { Minimap } from './ui/minimap.js';
import { Room } from './net/room.js';
import { LocalBackend } from './net/local-backend.js';
import { $, show, toast } from './ui/ui.js';
import { GAME } from './config.js';

const params = new URLSearchParams(location.search);
const isMobile = matchMedia('(pointer: coarse)').matches;
const quality = { high: params.get('q') ? params.get('q') === 'high' : !isMobile };

const firebaseConfig = {
  apiKey: import.meta.env.VITE_FIREBASE_API_KEY,
  authDomain: import.meta.env.VITE_FIREBASE_AUTH_DOMAIN,
  databaseURL: import.meta.env.VITE_FIREBASE_DATABASE_URL,
  projectId: import.meta.env.VITE_FIREBASE_PROJECT_ID,
  appId: import.meta.env.VITE_FIREBASE_APP_ID,
};
const useFirebase = !!(firebaseConfig.apiKey && firebaseConfig.databaseURL) && !params.has('local');

const store = {
  get(k) { try { return localStorage.getItem(k); } catch { return null; } },
  set(k, v) { try { localStorage.setItem(k, v); } catch { /* private mode */ } },
};

function progress(p, text) {
  $('load-fill').style.width = `${Math.round(p * 100)}%`;
  $('load-text').textContent = text;
}

async function boot() {
  const canvas = $('c');
  const renderer = new THREE.WebGLRenderer({ canvas, antialias: quality.high, powerPreference: 'high-performance' });
  renderer.setPixelRatio(Math.min(devicePixelRatio, quality.high ? 1.75 : 1.25));
  renderer.setSize(innerWidth, innerHeight);
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.toneMappingExposure = 0.85;
  renderer.shadowMap.enabled = quality.high;
  renderer.shadowMap.type = THREE.PCFSoftShadowMap;

  const scene = new THREE.Scene();
  const camera = new THREE.PerspectiveCamera(60, innerWidth / innerHeight, 0.1, 6000);
  addEventListener('resize', () => {
    camera.aspect = innerWidth / innerHeight;
    camera.updateProjectionMatrix();
    renderer.setSize(innerWidth, innerHeight);
  });

  const world = new World(renderer, scene, quality);
  await world.build(progress);
  const wildlife = new Wildlife(world, scene);
  const cam = new ThirdPersonCamera(camera, world.terrain);
  const controls = new Controls(canvas, {
    stick: $('stick'), knob: $('knob'), btnJump: $('btn-jump'), btnAction: $('btn-action'), btnSprint: $('btn-sprint'),
  });
  const minimap = new Minimap($('minimap'), world.terrain);
  const game = new Game({ scene, camera, world, wildlife, controls, cam, minimap });
  if (params.has('debug')) window.__game = game; // handy in the browser console

  progress(1, useFirebase ? 'Connecting to Firebase…' : 'Starting local test mode…');
  let backend;
  try {
    if (useFirebase) {
      const { FirebaseBackend } = await import('./net/firebase-backend.js');
      backend = new FirebaseBackend(firebaseConfig);
    } else backend = new LocalBackend();
    await backend.init();
  } catch (e) {
    console.error(e);
    $('menu-error').textContent = `Could not connect to Firebase (${e.code || e.message}). Using local test mode instead.`;
    backend = new LocalBackend();
    await backend.init();
  }
  $('mode').innerHTML = backend.kind === 'firebase'
    ? '🌍 Online mode — friends anywhere can join with your room code.'
    : '🧪 Local test mode — open this page in 2–3 browser tabs on this computer to play together. See README to go online.';

  // ---- menu wiring ---------------------------------------------------------
  const minPlayers = Math.max(1, Number(params.get('min')) || GAME.minPlayers);
  $('name').value = store.get('hs-name') || '';
  if (params.get('room')) $('code').value = params.get('room').toUpperCase();
  const getName = () => {
    const n = $('name').value.trim() || `Explorer${Math.floor(Math.random() * 90 + 10)}`;
    $('name').value = n;
    store.set('hs-name', n);
    return n;
  };
  const enterRoom = async (fn) => {
    $('menu-error').textContent = '';
    for (const b of document.querySelectorAll('#menu button')) b.disabled = true;
    try {
      const room = new Room(backend, { minPlayers });
      const code = await fn(room);
      const url = new URL(location.href);
      url.searchParams.set('room', code);
      history.replaceState(null, '', url);
      game.setRoom(room);
      show('menu', false);
      toast(`Joined room ${code}`);
    } catch (e) {
      console.error(e);
      $('menu-error').textContent = e.message || String(e);
    } finally {
      for (const b of document.querySelectorAll('#menu button')) b.disabled = false;
    }
  };
  $('btn-create').onclick = () => enterRoom((room) => room.create(getName()));
  $('btn-join').onclick = () => {
    const code = $('code').value.trim();
    if (!code) { $('menu-error').textContent = 'Type the room code your friend gave you.'; return; }
    enterRoom((room) => room.join(code, getName()));
  };
  $('code').addEventListener('keydown', (e) => { if (e.key === 'Enter') $('btn-join').click(); });

  const leave = async () => {
    const room = game.room;
    game.clearRoom();
    await room?.leave();
    const url = new URL(location.href);
    url.searchParams.delete('room');
    history.replaceState(null, '', url);
    show('menu', true);
  };
  $('btn-leave').onclick = leave;
  $('btn-end-leave').onclick = leave;
  const settings = () => ({ hideSeconds: Number($('opt-hide').value), seekSeconds: Number($('opt-seek').value) });
  if (params.get('hide')) $('opt-hide').add(new Option(`${params.get('hide')} s`, params.get('hide'), true, true));
  if (params.get('seek')) $('opt-seek').add(new Option(`${params.get('seek')} s`, params.get('seek'), true, true));
  $('btn-start').onclick = () => game.room?.startGame(settings());
  $('btn-again').onclick = () => game.room?.startGame(settings());
  $('btn-to-lobby').onclick = () => game.room?.backToLobby();
  $('btn-roll').onclick = () => { show('btn-roll', false); game.room?.roll(); };
  $('btn-copy').onclick = async () => {
    const link = `${location.origin}${location.pathname}?room=${game.room.code}`;
    try { await navigator.clipboard.writeText(link); toast('Invite link copied!'); }
    catch { prompt('Send this link to your friends:', link); }
  };
  $('lobby-toggle').onclick = () => $('lobby').classList.toggle('collapsed');

  show('loading', false);
  show('menu', true);

  // ---- main loop -----------------------------------------------------------
  let last = performance.now();
  const fps = params.has('debug') ? $('fps') : null;
  let frames = 0, fpsT = 0;
  const center = new THREE.Vector3(0, 5, 0);
  renderer.setAnimationLoop(() => {
    const t = performance.now();
    const dt = Math.min((t - last) / 1000, 0.05);
    last = t;
    if (game.room) {
      game.update(dt);
    } else {
      cam.orbit(dt, center, 40, 14);
      world.update(dt, camera, camera.position);
      wildlife.update(dt, [], camera.position, () => {});
    }
    renderer.render(scene, camera);
    if (fps) {
      frames++; fpsT += dt;
      if (fpsT > 1) { fps.textContent = `${frames} fps · ${renderer.info.render.calls} draws · ${(renderer.info.render.triangles / 1000).toFixed(0)}k tris`; frames = 0; fpsT = 0; }
    }
  });
}

boot().catch((e) => {
  console.error(e);
  $('load-text').textContent = `Something went wrong: ${e.message}. Your browser needs WebGL.`;
});
