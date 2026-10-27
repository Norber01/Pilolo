// Shared materials. Foliage gets a cheap wind sway injected into the standard shader.
import * as THREE from 'three';

export const windUniforms = { uTime: { value: 0 } };

export function foliageMaterial({ sway = 0.06, roughness = 0.85 } = {}) {
  const mat = new THREE.MeshStandardMaterial({ vertexColors: true, roughness, metalness: 0 });
  mat.onBeforeCompile = (shader) => {
    shader.uniforms.uTime = windUniforms.uTime;
    shader.vertexShader = shader.vertexShader
      .replace('#include <common>', '#include <common>\nuniform float uTime;')
      .replace(
        '#include <begin_vertex>',
        `#include <begin_vertex>
        #ifdef USE_INSTANCING
          vec3 ip = vec3(instanceMatrix[3][0], instanceMatrix[3][1], instanceMatrix[3][2]);
        #else
          vec3 ip = vec3(0.0);
        #endif
        float bend = max(position.y, 0.0);
        float ph = uTime * 1.6 + ip.x * 0.11 + ip.z * 0.07;
        transformed.x += sin(ph) * ${sway.toFixed(3)} * bend * bend * 0.1;
        transformed.z += cos(ph * 0.8) * ${sway.toFixed(3)} * bend * bend * 0.07;`
      );
  };
  mat.customProgramCacheKey = () => 'foliage' + sway;
  return mat;
}

export function solidMaterial(opts = {}) {
  return new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.9, metalness: 0, ...opts });
}
