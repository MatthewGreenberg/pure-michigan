import * as THREE from 'three'
import { GRID, NUM_TILES, TILE } from './constants.js'
import { GRASS_DEFAULTS, PATH_DEFAULTS } from './defaults.js'
import { vertexShader, fragmentShader } from './shaders.js'
import { paramTexture } from './tileParams.js'
import { rockMaskTexture } from '../rocks/rockMask.js'
import { densityMaskTexture } from './densityMask.js'
import { COAST_EDGE, LAND_EDGE_Z, coastUniforms } from '../coast.js'

const baseColor = new THREE.Color(GRASS_DEFAULTS.ground)

export const uniforms = {
  uTime: { value: 0 },
  uBaseColor: { value: baseColor },
  uGroundColorB: { value: new THREE.Color(GRASS_DEFAULTS.groundB) },
  uGroundNoiseSize: { value: GRASS_DEFAULTS.groundNoiseSize },
  uTipColor: { value: new THREE.Color(GRASS_DEFAULTS.bladeTip) },
  uTileParams: { value: paramTexture },
  uNumTiles: { value: NUM_TILES },
  uWindStrength: { value: GRASS_DEFAULTS.windStrength },
  uWindSpeed: { value: GRASS_DEFAULTS.windSpeed },
  uGustScale: { value: GRASS_DEFAULTS.gustScale },
  uSheen: { value: GRASS_DEFAULTS.sheen },
  uGradStrength: { value: GRASS_DEFAULTS.gradStrength },
  uClump: { value: GRASS_DEFAULTS.clump },
  uClumpScale: { value: GRASS_DEFAULTS.clumpScale },
  uBladeHeight: { value: GRASS_DEFAULTS.bladeHeight },
  uBladeWidth: { value: GRASS_DEFAULTS.bladeWidth },
  uBladeTipWidth: { value: GRASS_DEFAULTS.bladeTipWidth },
  uBladeTaper: { value: GRASS_DEFAULTS.bladeTaper },
  uBladeCurve: { value: GRASS_DEFAULTS.bladeCurve },
  uBladeLean: { value: GRASS_DEFAULTS.bladeLean },
  uRootShade: { value: GRASS_DEFAULTS.rootShade },
  uRockMask: { value: rockMaskTexture },
  uDensityMask: { value: densityMaskTexture },
  uTrailPress: { value: PATH_DEFAULTS.press },
  uSoilColor: { value: new THREE.Color(PATH_DEFAULTS.soilColor) },
  uPathDarken: { value: PATH_DEFAULTS.darken },
  uPathBump: { value: PATH_DEFAULTS.bump },
  uBumpScale: { value: PATH_DEFAULTS.bumpScale },
  uDuneGrassColor: coastUniforms.uDuneGrassColor,
}

// ponytail: own the material — R3F's uniforms prop CLONES each uniform into the
// material, so mutating the module-level object would never reach the GPU.
export const material = new THREE.ShaderMaterial({
  vertexShader,
  fragmentShader,
  uniforms,
  side: THREE.DoubleSide,
})

// The ground samples its own controllable A/B noise gradient, then applies the
// shared density mask. Most of the path is darkened turf; the blue channel
// reveals broken, overlapping pockets of soil.
export const groundMaterial = new THREE.ShaderMaterial({
  uniforms: {
    uBaseColor: uniforms.uBaseColor,
    uGroundColorB: uniforms.uGroundColorB,
    uGroundNoiseSize: uniforms.uGroundNoiseSize,
    uDensityMask: uniforms.uDensityMask,
    uTime: uniforms.uTime,
    uWindSpeed: uniforms.uWindSpeed,
    uGustScale: uniforms.uGustScale,
    uSheen: uniforms.uSheen,
    uSoilColor: uniforms.uSoilColor,
    uPathDarken: uniforms.uPathDarken,
    uPathBump: uniforms.uPathBump,
    uBumpScale: uniforms.uBumpScale,
    uSandA: coastUniforms.uSandA,
    uSandB: coastUniforms.uSandB,
  },
  vertexShader: /* glsl */ `
    varying vec2 vUv;

    void main() {
      vUv = uv;
      gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
    }
  `,
  fragmentShader: /* glsl */ `
    uniform vec3 uBaseColor;
    uniform vec3 uGroundColorB;
    uniform float uGroundNoiseSize;
    uniform sampler2D uDensityMask;
    uniform float uTime;
    uniform float uWindSpeed;
    uniform float uGustScale;
    uniform float uSheen;
    uniform vec3 uSoilColor;
    uniform float uPathDarken;
    uniform float uPathBump;
    uniform float uBumpScale;
    uniform vec3 uSandA;
    uniform vec3 uSandB;
    varying vec2 vUv;

    float hash(vec2 p) {
      return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453);
    }
    float noise(vec2 p) {
      vec2 i = floor(p);
      vec2 f = fract(p);
      f = f * f * (3.0 - 2.0 * f);
      return mix(
        mix(hash(i), hash(i + vec2(1.0, 0.0)), f.x),
        mix(hash(i + vec2(0.0, 1.0)), hash(i + vec2(1.0, 1.0)), f.x),
        f.y
      );
    }
    float fbm(vec2 p) {
      float v = 0.0;
      float amp = 0.5;
      mat2 rot = mat2(0.8, -0.6, 0.6, 0.8);
      for (int i = 0; i < 3; i++) {
        v += amp * noise(p);
        p = rot * p * 2.1;
        amp *= 0.5;
      }
      return v;
    }

    void main() {
      // PlaneGeometry's V axis becomes -Z after rotation, so flip it to use
      // the same world-space mask orientation as the grass vertex shader.
      vec2 maskUv = vec2(vUv.x, 1.0 - vUv.y);
      vec4 densityMask = texture2D(uDensityMask, maskUv);
      vec2 worldXZ = (maskUv - 0.5) * ${GRID * TILE}.0;

      // World-space fbm keeps the gradient continuous across the full ground.
      // Because size is the divisor, larger values produce broader color areas.
      float gradientNoise = fbm(worldXZ / max(uGroundNoiseSize, 0.001) + uTime * 0.02);
      float gradientMix = smoothstep(0.25, 0.75, gradientNoise);
      vec3 groundColor = mix(uBaseColor, uGroundColorB, gradientMix);

      vec3 pressedTurf = mix(groundColor * 0.55, vec3(0.19, 0.25, 0.11), 0.2);
      vec3 color = mix(groundColor, pressedTurf, densityMask.g * uPathDarken);
      color = mix(color, uSoilColor, densityMask.b);

      // Bumpy path: two-scale height noise embossed toward the light — the
      // offset sample acts as a cheap slope so lumps get a lit and shadow side.
      vec2 lit = vec2(0.14, -0.11);
      float bumpHere = noise(worldXZ * uBumpScale) + 0.5 * noise(worldXZ * uBumpScale * 2.2 + 3.7);
      float bumpLit = noise((worldXZ + lit) * uBumpScale) + 0.5 * noise((worldXZ + lit) * uBumpScale * 2.2 + 3.7);
      color *= 1.0 + (bumpLit - bumpHere) * uPathBump * densityMask.b;

      // Let the field become a dune before the in-tile coastline. The warped
      // threshold avoids replacing one straight seam with another; this exact
      // sand noise is also used by the ocean plane tucked below.
      float coastShape = -worldXZ.y
        + (noise(worldXZ * 0.38 + vec2(4.6, -2.3)) - 0.5) * 1.3
        + sin(worldXZ.x * 0.55) * 0.18;
      float coast = smoothstep(${(COAST_EDGE - 1.45).toFixed(2)}, ${(COAST_EDGE - 0.05).toFixed(2)}, coastShape);
      // Noise can push the organic edge around inland, but the strip before
      // the discard line is always pure sand, so the handoff to the ocean
      // plane's identical sand never shows a straight color seam.
      coast = max(coast, smoothstep(${(COAST_EDGE - 0.65).toFixed(2)}, ${(COAST_EDGE - 0.18).toFixed(2)}, -worldXZ.y));
      // Past the coastline the ocean plane below owns the pixel.
      if (worldXZ.y < ${LAND_EDGE_Z.toFixed(2)}) discard;
      float sandNoise = fbm(worldXZ * 0.9 + 3.0);
      vec3 duneSand = mix(uSandA, uSandB, sandNoise);
      color = mix(color, duneSand, coast);

      // Shade the last strip before the landward tile edges so the margin
      // past the final blades reads as turf in shadow instead of a bright
      // flat band of ground color running along the rim.
      float rim = max(abs(worldXZ.x), worldXZ.y);
      color *= 1.0 - 0.22 * smoothstep(${(GRID * TILE / 2 - 0.45).toFixed(2)}, ${(GRID * TILE / 2).toFixed(2)}, rim);

      // Same traveling gust field as the grass blades, so the sheen wash
      // crosses the bare path and dune in step with the surrounding field.
      float gust = noise(worldXZ * uGustScale * 4.0 - uTime * uWindSpeed * vec2(0.0, 1.4));
      float sheenSurface = max(max(densityMask.g, densityMask.b), coast);
      float sheen = smoothstep(0.42, 0.82, gust) * sheenSurface;
      vec3 sheenColor = color * 1.45 + vec3(0.07, 0.06, 0.025);
      color = mix(color, sheenColor, min(sheen * uSheen * 0.6, 0.7));

      gl_FragColor = vec4(color, 1.0);
      #include <tonemapping_fragment>
      #include <colorspace_fragment>
    }
  `,
})
