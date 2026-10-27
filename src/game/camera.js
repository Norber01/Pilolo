// Third-person orbit camera that never clips under the ground.
import * as THREE from 'three';

export class ThirdPersonCamera {
  constructor(camera, terrain) {
    this.camera = camera;
    this.terrain = terrain;
    this.yaw = Math.PI;
    this.pitch = 0.32;
    this.dist = 6.5;
    this.wantDist = 6.5;
    this.target = new THREE.Vector3();
    this.pos = new THREE.Vector3();
    this.first = true;
  }

  get forward() { return { x: -Math.sin(this.yaw), z: -Math.cos(this.yaw) }; }
  get right() { return { x: Math.cos(this.yaw), z: -Math.sin(this.yaw) }; }

  input(lookX, lookY, zoom) {
    this.yaw -= lookX;
    this.pitch = THREE.MathUtils.clamp(this.pitch + lookY, -0.35, 1.25);
    this.wantDist = THREE.MathUtils.clamp(this.wantDist + zoom * 0.8, 2.5, 16);
  }

  update(dt, focus) {
    const k = this.first ? 1 : 1 - Math.exp(-dt * 14);
    this.target.lerp(focus, k);
    this.dist += (this.wantDist - this.dist) * Math.min(1, dt * 6);
    const cp = Math.cos(this.pitch), sp = Math.sin(this.pitch);
    const want = new THREE.Vector3(
      this.target.x + Math.sin(this.yaw) * cp * this.dist,
      this.target.y + sp * this.dist,
      this.target.z + Math.cos(this.yaw) * cp * this.dist,
    );
    // Lift the camera above hills between it and the player.
    for (let i = 1; i <= 4; i++) {
      const t = i / 4;
      const x = THREE.MathUtils.lerp(this.target.x, want.x, t), z = THREE.MathUtils.lerp(this.target.z, want.z, t);
      const g = this.terrain.getHeight(x, z) + 0.5;
      const y = THREE.MathUtils.lerp(this.target.y, want.y, t);
      if (y < g) want.y += (g - y) / t;
    }
    if (this.first) { this.pos.copy(want); this.first = false; }
    else this.pos.lerp(want, 1 - Math.exp(-dt * 18));
    this.camera.position.copy(this.pos);
    this.camera.lookAt(this.target);
  }

  /** Slow fly-around used behind the main menu. */
  orbit(dt, center, radius, height) {
    this.yaw += dt * 0.05;
    const x = center.x + Math.sin(this.yaw) * radius, z = center.z + Math.cos(this.yaw) * radius;
    const y = Math.max(this.terrain.getHeight(x, z) + 8, center.y + height);
    this.camera.position.set(x, y, z);
    this.camera.lookAt(center);
    this.first = true;
  }
}
