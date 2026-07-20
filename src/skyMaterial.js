import * as THREE from 'three'

// Shared because the Leva background controls update these values without
// asking React to rebuild the full-screen material.
export const skyUniforms = {
  uSkyTop: { value: new THREE.Color('#66859a') },
  uSkyMiddle: { value: new THREE.Color('#9bb5ad') },
  uSkyBottom: { value: new THREE.Color('#d7d5ab') },
  uHorizonGlow: { value: new THREE.Color('#f5dda4') },
}

export const skyMaterial = new THREE.ShaderMaterial({
  uniforms: skyUniforms,
  depthTest: false,
  depthWrite: false,
  vertexShader: /* glsl */ `
    varying vec2 vUv;

    void main() {
      vUv = position.xy * 0.5 + 0.5;
      gl_Position = vec4(position.xy, 1.0, 1.0);
    }
  `,
  fragmentShader: /* glsl */ `
    uniform vec3 uSkyTop;
    uniform vec3 uSkyMiddle;
    uniform vec3 uSkyBottom;
    uniform vec3 uHorizonGlow;
    varying vec2 vUv;

    void main() {
      // The middle stop matches the old CSS gradient's 58% position from the
      // top. Smooth interpolation avoids a visible shoulder at the join.
      float lower = smoothstep(0.0, 0.44, vUv.y);
      float upper = smoothstep(0.34, 1.0, vUv.y);
      vec3 sky = mix(uSkyBottom, uSkyMiddle, lower);
      sky = mix(sky, uSkyTop, upper);

      // Broad, low horizon light behind the island. The anisotropic distance
      // makes it read as atmosphere rather than a circular spotlight.
      vec2 glowUv = (vUv - vec2(0.5, 0.29)) * vec2(0.72, 1.45);
      float glow = 1.0 - smoothstep(0.02, 0.66, length(glowUv));
      sky = mix(sky, uHorizonGlow, glow * 0.22);

      gl_FragColor = vec4(sky, 1.0);
      #include <tonemapping_fragment>
      #include <colorspace_fragment>
    }
  `,
})
