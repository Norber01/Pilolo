// Builds the whole environment: sky, light, terrain, water, vegetation, grass.
import * as THREE from 'three';
import { Sky } from 'three/addons/objects/Sky.js';
import { WORLD } from '../config.js';
import { Terrain } from './terrain.js';
import { Vegetation } from './vegetation.js';
import { GrassField } from './grass.js';
import { makeGroundDetail, makeWaterNormals } from './textures.js';
import { windUniforms } from './materials.js';

const nextFrame = () => new Promise((r) => requestAnimationFrame(() => setTimeout(r, 0)));

export class World {
  constructor(renderer, scene, quality) {
    this.renderer = renderer;
    this.scene = scene;
    this.quality = quality;
    this.viewDistance = quality.high ? 650 : 380;
  }

  async build(onProgress = () => {}) {
    const scene = this.scene;
    onProgress(0.05, 'Shaping the land…');
    await nextFrame();
    this.terrain = new Terrain();

    onProgress(0.35, 'Painting regions…');
    await nextFrame();
    const detail = makeGroundDetail();
    detail.repeat.set(WORLD.size / 6, WORLD.size / 6);
    this.terrainMesh = this.terrain.buildMesh(detail);
    scene.add(this.terrainMesh);

    onProgress(0.5, 'Filling the sky…');
    await nextFrame();
    this.buildSky();
    this.buildWater();

    onProgress(0.6, 'Growing trees and bushes…');
    await nextFrame();
    this.vegetation = new Vegetation(this.terrain, scene);

    onProgress(0.9, 'Planting grass…');
    await nextFrame();
    this.grass = new GrassField(this.terrain, scene, this.quality.high ? { count: 9000, radius: 48 } : { count: 3000, radius: 30 });
    onProgress(1, 'Ready');
  }

  buildSky() {
    const scene = this.scene;
    const sky = new Sky();
    sky.scale.setScalar(4500);
    const u = sky.material.uniforms;
    u.turbidity.value = 5;
    u.rayleigh.value = 1.4;
    u.mieCoefficient.value = 0.004;
    u.mieDirectionalG.value = 0.82;
    if (u.cloudCoverage) u.cloudCoverage.value = 0.45;
    this.sky = sky;

    const elevation = THREE.MathUtils.degToRad(38);
    const azimuth = THREE.MathUtils.degToRad(145);
    this.sunDir = new THREE.Vector3().setFromSphericalCoords(1, Math.PI / 2 - elevation, azimuth);
    u.sunPosition.value.copy(this.sunDir);
    scene.add(sky);

    // Image based lighting from the sky => much more natural shading on everything.
    const pmrem = new THREE.PMREMGenerator(this.renderer);
    const envScene = new THREE.Scene();
    const envSky = new Sky();
    envSky.scale.setScalar(100);
    Object.assign(envSky.material.uniforms.sunPosition.value, this.sunDir);
    envSky.material.uniforms.turbidity.value = 5;
    envSky.material.uniforms.rayleigh.value = 1.4;
    if (envSky.material.uniforms.showSunDisc) envSky.material.uniforms.showSunDisc.value = 0;
    envScene.add(envSky);
    scene.environment = pmrem.fromScene(envScene, 0, 0.1, 200).texture;
    scene.environmentIntensity = 0.55;
    pmrem.dispose();

    const fogColor = new THREE.Color(0xc4d3dc);
    scene.fog = new THREE.Fog(fogColor, 120, this.viewDistance);

    const hemi = new THREE.HemisphereLight(0xcfe3ff, 0x5a5236, 0.55);
    scene.add(hemi);
    const sun = new THREE.DirectionalLight(0xfff1d6, 2.6);
    sun.position.copy(this.sunDir).multiplyScalar(200);
    if (this.quality.high) {
      sun.castShadow = true;
      sun.shadow.mapSize.set(2048, 2048);
      const s = 70;
      Object.assign(sun.shadow.camera, { left: -s, right: s, top: s, bottom: -s, near: 10, far: 500 });
      sun.shadow.bias = -0.0004;
      sun.shadow.normalBias = 0.6;
    }
    scene.add(sun, sun.target);
    this.sun = sun;
  }

  buildWater() {
    const normals = makeWaterNormals();
    normals.repeat.set(WORLD.size / 18, WORLD.size / 18);
    const mat = new THREE.MeshStandardMaterial({
      color: 0x2d4c4c,
      roughness: 0.06,
      metalness: 0.2,
      normalMap: normals,
      normalScale: new THREE.Vector2(0.35, 0.35),
      transparent: true,
      opacity: 0.86,
    });
    const geo = new THREE.PlaneGeometry(WORLD.size, WORLD.size, 1, 1);
    geo.rotateX(-Math.PI / 2);
    const water = new THREE.Mesh(geo, mat);
    water.position.y = WORLD.waterLevel;
    water.receiveShadow = true;
    this.scene.add(water);
    this.water = water;
  }

  update(dt, camera, focus) {
    windUniforms.uTime.value += dt;
    this.sky.position.copy(camera.position);
    if (this.sky.material.uniforms.time) this.sky.material.uniforms.time.value += dt;
    this.water.material.normalMap.offset.x += dt * 0.004;
    this.water.material.normalMap.offset.y += dt * 0.0025;
    // Keep the shadow camera centred on the player.
    this.sun.position.copy(focus).addScaledVector(this.sunDir, 220);
    this.sun.target.position.copy(focus);
    this.grass.update(focus);
    this._acc = (this._acc || 0) + dt;
    if (this._acc > 0.25) {
      this._acc = 0;
      this.vegetation.update(camera.position, this.viewDistance);
    }
  }
}
