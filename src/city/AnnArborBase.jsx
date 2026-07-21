import * as THREE from 'three'

const SIZE = 15
const DEPTH = 2
const TOP_Y = -0.1
const HALF = SIZE / 2

// Ann Arbor gets a living campus-lawn cross section instead of Detroit's
// crushed urban fill: a deep sod cap, rich loam, fine roots, and damp strata.
// Everything is procedural, so the cut face remains sharp at any viewport
// resolution and does not depend on a baked soil texture.
const baseMaterial = new THREE.ShaderMaterial({
  vertexShader: /* glsl */ `
    varying vec3 vPos;
    varying vec3 vNormal;

    void main() {
      vec4 world = modelMatrix * vec4(position, 1.0);
      vPos = world.xyz;
      vNormal = normalize(mat3(modelMatrix) * normal);
      gl_Position = projectionMatrix * viewMatrix * world;
    }
  `,
  fragmentShader: /* glsl */ `
    varying vec3 vPos;
    varying vec3 vNormal;

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
      float value = 0.0;
      float amplitude = 0.5;
      mat2 turn = mat2(0.8, -0.6, 0.6, 0.8);
      for (int i = 0; i < 5; i++) {
        value += noise(p) * amplitude;
        p = turn * p * 2.05;
        amplitude *= 0.5;
      }
      return value;
    }

    float segmentDistance(vec2 p, vec2 a, vec2 b) {
      vec2 pa = p - a;
      vec2 ba = b - a;
      float h = clamp(dot(pa, ba) / max(dot(ba, ba), 0.0001), 0.0, 1.0);
      return length(pa - ba * h);
    }

    void main() {
      vec3 normal = normalize(vNormal);

      // The narrow top rim is uninterrupted turf, with fine mowing variation.
      if (normal.y > 0.55) {
        float topNoise = fbm(vPos.xz * 2.4);
        float mow = sin((vPos.x + vPos.z) * 4.1) * 0.5 + 0.5;
        vec3 turf = mix(vec3(0.13, 0.25, 0.075), vec3(0.27, 0.43, 0.13), topNoise);
        turf *= 0.91 + mow * 0.10;
        gl_FragColor = vec4(turf, 1.0);
        #include <tonemapping_fragment>
        #include <colorspace_fragment>
        return;
      }

      vec2 face = abs(normal.x) > 0.5 ? vPos.zy : vPos.xy;
      float depth = clamp((${TOP_Y.toFixed(1)} - vPos.y) / ${DEPTH.toFixed(1)}, 0.0, 1.0);

      // Warm, biologically rich loam. Broad moisture clouds and small crumb
      // structure replace the large gravel fragments used below Detroit.
      vec3 loam = mix(vec3(0.31, 0.205, 0.115), vec3(0.17, 0.115, 0.072), depth);
      float broad = fbm(face * vec2(0.74, 1.32) + 3.0);
      float crumbs = fbm(face * vec2(7.4, 10.5) + 17.0);
      loam *= 0.79 + broad * 0.33 + crumbs * 0.10;

      // Fine organic flecks give the close view detail without turning the
      // cross section back into a bed of rocks.
      vec2 fleckGrid = face * vec2(13.0, 17.0);
      vec2 fleckCell = floor(fleckGrid);
      vec2 fleckPoint = vec2(hash(fleckCell + 7.0), hash(fleckCell + 19.0));
      float fleckDist = length(fract(fleckGrid) - fleckPoint);
      float fleck = (1.0 - smoothstep(0.035, 0.082, fleckDist))
        * step(0.78, hash(fleckCell + 29.0));
      loam = mix(loam, vec3(0.50, 0.39, 0.22), fleck * 0.46);

      // Soft organic horizons rather than hard aggregate lifts.
      float layerWarp = fbm(vec2(face.x * 0.38, face.y * 1.6) + 31.0);
      float horizons = sin(vPos.y * 7.0 + layerWarp * 4.2) * 0.5 + 0.5;
      loam *= 0.93 + horizons * 0.10;

      // A thick living sod cap dominates the top quarter of the cut face.
      float sodEdge = -0.54 + (noise(vec2(face.x * 0.75, 8.0)) - 0.5) * 0.12;
      float sod = smoothstep(sodEdge - 0.045, sodEdge + 0.055, vPos.y);
      float sodMottle = fbm(vec2(face.x * 2.8, face.y * 5.0) + 57.0);
      vec3 sodColor = mix(vec3(0.11, 0.22, 0.065), vec3(0.29, 0.42, 0.12), sodMottle);

      // Dense vertical crowns and stems make the band read as turf, not green
      // paint, when the camera pushes in.
      float stemCell = floor(face.x * 19.0);
      float stemX = abs(fract(face.x * 19.0) - (0.2 + hash(vec2(stemCell, 71.0)) * 0.6));
      float stem = (1.0 - smoothstep(0.035, 0.115, stemX))
        * smoothstep(sodEdge - 0.03, sodEdge + 0.14, vPos.y);
      sodColor = mix(sodColor, vec3(0.39, 0.54, 0.16), stem * 0.42);
      vec3 color = mix(loam, sodColor, sod);

      // Irregular moss and fine grass mats cascade below the sod line. They
      // keep green as the dominant read while leaving enough open loam for the
      // roots and inlaid marks to stay legible.
      float greenReach = smoothstep(-1.48, -0.24, vPos.y);
      float matNoise = fbm(vec2(face.x * 0.78, face.y * 2.25) + 92.0);
      float livingMat = smoothstep(0.50, 0.76, matNoise + greenReach * 0.30)
        * greenReach * (1.0 - sod * 0.22);
      vec3 matColor = mix(vec3(0.10, 0.20, 0.055), vec3(0.30, 0.42, 0.12),
        fbm(face * vec2(2.0, 3.8) + 104.0));
      color = mix(color, matColor, livingMat * 0.72);

      // Primary roots descend from the sod, with one lateral branch each and
      // a lighter inner highlight for dimensionality.
      float rootDepth = max(sodEdge - vPos.y, 0.0);
      vec2 rootP = vec2(face.x, rootDepth);
      float rootBody = 0.0;
      float rootHighlight = 0.0;
      float rootShadow = 0.0;
      for (int ri = -1; ri <= 1; ri++) {
        float cell = floor(face.x * 0.82) + float(ri);
        float seed = hash(vec2(cell, 83.0));
        float base = (cell + 0.5) / 0.82 + (seed - 0.5) * 0.36;
        float maxDepth = 0.72 + hash(vec2(cell, 97.0)) * 0.72;
        float rootX = base + sin(rootDepth * (3.1 + seed * 2.2) + seed * 15.0)
          * (0.025 + rootDepth * 0.055) + (seed - 0.5) * rootDepth * 0.20;
        float rootWidth = mix(0.052, 0.008, clamp(rootDepth / maxDepth, 0.0, 1.0));
        float exists = step(0.20, seed)
          * smoothstep(0.015, 0.08, rootDepth)
          * (1.0 - smoothstep(maxDepth - 0.16, maxDepth, rootDepth));
        float dist = abs(face.x - rootX);
        float body = (1.0 - smoothstep(rootWidth * 0.58, rootWidth, dist)) * exists;
        float hi = (1.0 - smoothstep(rootWidth * 0.10, rootWidth * 0.42,
          abs(face.x - rootX + rootWidth * 0.20))) * exists;
        float shadow = (1.0 - smoothstep(rootWidth * 0.85, rootWidth * 1.5,
          abs(face.x - rootX - rootWidth * 0.36))) * exists * (1.0 - body);

        float branchAt = 0.24 + seed * 0.42;
        float side = step(0.5, hash(vec2(cell, 113.0))) * 2.0 - 1.0;
        vec2 branchA = vec2(
          base + sin(branchAt * (3.1 + seed * 2.2) + seed * 15.0) * (0.025 + branchAt * 0.055),
          branchAt
        );
        vec2 branchB = branchA + vec2(side * (0.24 + seed * 0.22), 0.28 + seed * 0.22);
        float branchDist = segmentDistance(rootP, branchA, branchB);
        float branch = (1.0 - smoothstep(0.009, 0.022, branchDist))
          * step(branchAt + 0.34, maxDepth) * exists;

        rootBody = max(rootBody, max(body, branch));
        rootHighlight = max(rootHighlight, hi);
        rootShadow = max(rootShadow, shadow);
      }
      color *= 1.0 - rootShadow * 0.25;
      vec3 rootColor = mix(vec3(0.51, 0.37, 0.18), vec3(0.76, 0.64, 0.37), rootHighlight);
      color = mix(color, rootColor, rootBody * (1.0 - sod * 0.72));

      float faceLight = 0.72 + 0.28 * max(dot(normal, normalize(vec3(0.45, 0.78, 0.56))), 0.0);
      gl_FragColor = vec4(color * faceLight, 1.0);
      #include <tonemapping_fragment>
      #include <colorspace_fragment>
    }
  `,
})

// The official mark stays a transparent source image, but mipmapping keeps it
// crisp as the camera changes scale. Low-opacity earth/maize tint makes the
// three marks feel printed into the living cross-section instead of badged on.
const mTexture = new THREE.TextureLoader().load('/m.png')
mTexture.colorSpace = THREE.SRGBColorSpace
mTexture.minFilter = THREE.LinearMipmapLinearFilter
mTexture.magFilter = THREE.LinearFilter
const markGeometry = new THREE.PlaneGeometry(0.82, 0.555)
const markMaterial = new THREE.MeshBasicMaterial({
  map: mTexture,
  color: '#9b9160',
  transparent: true,
  opacity: 0.46,
  depthWrite: false,
})

const emblems = [
  { position: [-3.55, -1.08, HALF + 0.008], rotation: [0, 0, 0] },
  { position: [3.25, -1.36, HALF + 0.008], rotation: [0, 0, 0] },
  { position: [HALF + 0.008, -1.18, 0.15], rotation: [0, Math.PI / 2, 0] },
]

function BlockMInlay({ position, rotation }) {
  return (
    <group position={position} rotation={rotation}>
      <mesh geometry={markGeometry} material={markMaterial} />
    </group>
  )
}

export function AnnArborBase() {
  return (
    <group>
      <mesh material={baseMaterial} position={[0, TOP_Y - DEPTH / 2, 0]}>
        <boxGeometry args={[SIZE, DEPTH, SIZE]} />
      </mesh>
      {emblems.map((emblem, index) => <BlockMInlay key={index} {...emblem} />)}
    </group>
  )
}
