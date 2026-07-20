import * as THREE from 'three'
import { GRID, TILE } from './grass/constants.js'
import { COAST_EDGE, coastUniforms } from './coast.js'

// Diorama base: a dirt cross-section box under the tile so the field reads as
// a floating square slab. Everything is painted in the fragment shader —
// mottled soil gradient with wavy strata, embedded pebbles and larger shaded
// stones, a branching root network under the grass lip, a grass lip that turns
// to sand along the coast edges, and the path's sand carried down the +z face.
// Unlit like the ground/grass materials; sits below the ground (-0.01) and
// ocean (-0.02) planes so both keep owning the top surface.
const SIZE = GRID * TILE
const DEPTH = 2.0
const TOP_Y = -0.03

const material = new THREE.ShaderMaterial({
  uniforms: {
    uSandA: coastUniforms.uSandA,
    uSandB: coastUniforms.uSandB,
  },
  vertexShader: /* glsl */ `
    varying vec3 vPos;
    varying vec3 vN;

    void main() {
      vPos = (modelMatrix * vec4(position, 1.0)).xyz;
      vN = normalize(mat3(modelMatrix) * normal);
      gl_Position = projectionMatrix * viewMatrix * vec4(vPos, 1.0);
    }
  `,
  fragmentShader: /* glsl */ `
    uniform vec3 uSandA;
    uniform vec3 uSandB;
    varying vec3 vPos;
    varying vec3 vN;

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
      for (int i = 0; i < 5; i++) {
        v += amp * noise(p);
        p = rot * p * 2.1;
        amp *= 0.5;
      }
      return v;
    }

    mat2 rotate2d(float angle) {
      float c = cos(angle);
      float s = sin(angle);
      return mat2(c, -s, s, c);
    }

    float segmentDistance(vec2 p, vec2 a, vec2 b) {
      vec2 pa = p - a;
      vec2 ba = b - a;
      float h = clamp(dot(pa, ba) / max(dot(ba, ba), 0.0001), 0.0, 1.0);
      return length(pa - ba * h);
    }

    float rootPath(float baseX, float seed, float depth) {
      float slowBend = (seed - 0.5) * depth * 0.34;
      float broadWiggle = sin(depth * (3.0 + seed * 3.5) + seed * 41.0)
        * (0.035 + depth * 0.028);
      float fineWiggle = sin(depth * 10.0 + seed * 19.0) * 0.014;
      return baseX + slowBend + broadWiggle + fineWiggle;
    }

    void main() {
      vec3 n = normalize(vN);
      // face-plane coords so the paint doesn't stretch along a face
      vec2 fc = abs(n.x) > 0.5 ? vPos.zy : vPos.xy;
      float depthT = clamp(-vPos.y / ${DEPTH.toFixed(1)}, 0.0, 1.0);

      // mottled soil, darker toward the bottom of the slab
      vec3 soil = mix(vec3(0.44, 0.31, 0.20), vec3(0.28, 0.19, 0.12), depthT);
      float mottle = fbm(fc * vec2(0.9, 1.7));
      soil = mix(soil, vec3(0.52, 0.38, 0.25), mottle * 0.45);

      // Fine aggregate and tiny dark pores keep the cut face crisp even when
      // the camera is zoomed in, while the low-frequency mottle still reads at
      // the default diorama scale.
      float aggregate = fbm(fc * vec2(6.0, 8.5) + 17.0);
      soil *= 0.91 + aggregate * 0.16;
      vec2 gritGrid = fc * vec2(16.0, 20.0);
      vec2 gritCell = floor(gritGrid);
      vec2 gritPoint = vec2(hash(gritCell + 31.0), hash(gritCell + 53.0));
      float gritDist = length(fract(gritGrid) - gritPoint);
      float pore = (1.0 - smoothstep(0.055, 0.11, gritDist))
        * step(0.72, hash(gritCell + 71.0));
      soil = mix(soil, vec3(0.20, 0.14, 0.09), pore * 0.42);

      // wavy sediment strata banding down the cut faces
      float strata = sin(vPos.y * 6.0 + fbm(fc * 0.7) * 4.0) * 0.5 + 0.5;
      soil *= 0.95 + strata * 0.09;

      // Small embedded pebbles. Each gets an irregular silhouette, contact
      // shadow, lit crown, and mineral grain instead of reading as a flat dot.
      vec2 pc = fc * vec2(2.8, 3.8);
      vec2 cell = floor(pc);
      vec2 ppt = (vec2(hash(cell + 3.7), hash(cell + 9.1)) - 0.5) * 0.48;
      vec2 plocal = fract(pc) - 0.5 - ppt;
      plocal = rotate2d((hash(cell + 12.4) - 0.5) * 2.4) * plocal;
      plocal *= vec2(mix(0.82, 1.22, hash(cell + 23.1)), mix(0.88, 1.32, hash(cell + 27.7)));
      float pr = 0.105 + hash(cell + 17.3) * 0.085;
      float pdetail = (noise(plocal * 10.0 + cell * 1.7) - 0.5) * 0.055;
      float pd = length(plocal) + pdetail;
      float pexists = step(0.57, hash(cell + 5.5));
      float pebbleOuter = (1.0 - smoothstep(pr + 0.025, pr + 0.07, pd)) * pexists;
      float pebble = (1.0 - smoothstep(pr - 0.018, pr + 0.012, pd)) * pexists;
      float pebbleRim = max(pebbleOuter - pebble, 0.0);
      soil *= 1.0 - pebbleRim * 0.22;
      vec3 pebbleColor = mix(vec3(0.43, 0.38, 0.33), vec3(0.67, 0.58, 0.47), hash(cell + 29.7));
      float pebbleLight = clamp(0.76 + plocal.y * 1.8 - plocal.x * 0.45, 0.62, 1.18);
      pebbleColor *= pebbleLight;
      pebbleColor = mix(pebbleColor, pebbleColor * 0.67,
        (1.0 - smoothstep(0.45, 0.72, fbm(plocal * 18.0 + cell))) * 0.30);
      soil = mix(soil, pebbleColor, pebble * 0.94);

      // Larger buried stones: chipped outline, an occluded socket, mineral
      // veining and speckles, with a crown-to-belly value ramp for form.
      vec2 sc = fc * vec2(0.72, 1.05) + 11.0;
      vec2 scell = floor(sc);
      vec2 spt = (vec2(hash(scell + 1.3), hash(scell + 7.7)) - 0.5) * 0.36;
      vec2 sd = fract(sc) - 0.5 - spt;
      sd = rotate2d((hash(scell + 18.8) - 0.5) * 2.1) * sd;
      sd *= vec2(mix(0.78, 1.22, hash(scell + 4.6)), mix(0.96, 1.38, hash(scell + 8.2)));
      float srad = 0.18 + hash(scell + 3.1) * 0.13;
      float sangle = atan(sd.y, sd.x);
      float chippedEdge = (noise(sd * vec2(8.0, 6.0) + scell * 2.3) - 0.5) * 0.085
        + sin(sangle * (5.0 + floor(hash(scell + 6.4) * 3.0)) + hash(scell) * 12.0) * 0.018;
      float sdist = length(sd) + chippedEdge;
      float sexists = step(0.48, hash(scell + 13.9));
      float stoneOuter = (1.0 - smoothstep(srad + 0.025, srad + 0.075, sdist)) * sexists;
      float stone = (1.0 - smoothstep(srad - 0.022, srad + 0.014, sdist)) * sexists;
      float stoneSocket = max(stoneOuter - stone, 0.0);
      soil *= 1.0 - stoneSocket * 0.34;
      vec3 stoneCol = mix(vec3(0.36, 0.34, 0.31), vec3(0.61, 0.55, 0.47), hash(scell + 21.3));
      stoneCol *= clamp(0.75 + sd.y * 1.28 - sd.x * 0.25, 0.62, 1.18);
      float mineral = fbm(sd * 15.0 + scell * 3.7);
      stoneCol = mix(stoneCol * 0.72, stoneCol * 1.10, smoothstep(0.24, 0.78, mineral));
      float vein = (1.0 - smoothstep(0.025, 0.075,
        abs(noise(sd * vec2(5.0, 13.0) + scell * 4.1) - 0.48))) * stone;
      stoneCol = mix(stoneCol, stoneCol * 0.56, vein * 0.35);
      soil = mix(soil, stoneCol, stone * 0.96);

      // root shadow just under the lip
      soil *= 1.0 - 0.28 * smoothstep(-0.7, -0.2, vPos.y);

      // the rim turns from grass to sand toward the coast (beach + water
      // edges); the -z face is entirely past the coastline so it goes sandy
      float sandTop = smoothstep(${(COAST_EDGE - 1.0).toFixed(2)}, ${(COAST_EDGE - 0.2).toFixed(2)},
        -vPos.z + (noise(vec2(vPos.x * 0.55, 7.3)) - 0.5) * 1.2);

      // Root system: a few substantial primary roots travel deep through the
      // profile, with angled lateral branches and a denser curtain of hair
      // roots under the sod. Nearby cells are evaluated so branches never clip
      // when they cross their source cell boundary.
      float rootDepth = max(-vPos.y, 0.0);
      vec2 rootP = vec2(fc.x, rootDepth);
      float root = 0.0;
      float rootHighlight = 0.0;
      float rootShadow = 0.0;
      float rootTone = 0.0;

      for (int ri = -1; ri <= 1; ri++) {
        float rootCell = floor(fc.x * 1.10) + float(ri);
        float rootSeed = hash(vec2(rootCell, 42.0));
        float rootExists = step(0.26, rootSeed) * (1.0 - sandTop);
        float rootBase = (rootCell + 0.5) / 1.10 + (rootSeed - 0.5) * 0.34;
        float maxDepth = 0.84 + hash(vec2(rootCell, 58.0)) * 1.05;
        float rootX = rootPath(rootBase, rootSeed, rootDepth);
        float depthFade = smoothstep(0.025, 0.09, rootDepth)
          * (1.0 - smoothstep(maxDepth - 0.20, maxDepth, rootDepth));
        float rootWidth = mix(0.066, 0.009,
          pow(clamp(rootDepth / maxDepth, 0.0, 1.0), 0.72));
        float rootDist = abs(fc.x - rootX);
        float rootBody = (1.0 - smoothstep(rootWidth * 0.62, rootWidth, rootDist))
          * depthFade * rootExists;
        float rootHi = (1.0 - smoothstep(rootWidth * 0.16, rootWidth * 0.46,
          abs(fc.x - rootX + rootWidth * 0.22))) * depthFade * rootExists;
        float rootSh = (1.0 - smoothstep(rootWidth * 0.80, rootWidth * 1.45,
          abs(fc.x - rootX - rootWidth * 0.38))) * depthFade * rootExists;
        root = max(root, rootBody);
        rootHighlight = max(rootHighlight, rootHi);
        rootShadow = max(rootShadow, rootSh * (1.0 - rootBody));
        rootTone = max(rootTone, rootBody * rootSeed);

        for (int bi = 0; bi < 2; bi++) {
          float branchSeed = hash(vec2(rootCell + float(bi) * 17.0, 133.0));
          float branchStart = 0.22 + branchSeed * 0.72;
          float branchLength = 0.28 + hash(vec2(rootCell, 161.0 + float(bi))) * 0.42;
          float branchSide = step(0.5, hash(vec2(rootCell, 181.0 + float(bi)))) * 2.0 - 1.0;
          vec2 branchA = vec2(rootPath(rootBase, rootSeed, branchStart), branchStart);
          vec2 branchB = branchA + vec2(
            branchSide * (0.24 + branchSeed * 0.34),
            branchLength
          );
          float branchWidth = 0.013 + (1.0 - branchSeed) * 0.011;
          float branchExists = rootExists * step(branchStart + branchLength + 0.05, maxDepth)
            * step(0.30, hash(vec2(rootCell + float(bi), 207.0)));
          float branchDist = segmentDistance(rootP, branchA, branchB);
          float branch = (1.0 - smoothstep(branchWidth * 0.55, branchWidth, branchDist))
            * branchExists;
          float branchHi = (1.0 - smoothstep(branchWidth * 0.18, branchWidth * 0.50,
            segmentDistance(rootP + vec2(branchWidth * 0.24, 0.0), branchA, branchB)))
            * branchExists;
          float branchSh = (1.0 - smoothstep(branchWidth, branchWidth * 1.75,
            segmentDistance(rootP - vec2(branchWidth * 0.55, 0.0), branchA, branchB)))
            * branchExists * (1.0 - branch);
          root = max(root, branch);
          rootHighlight = max(rootHighlight, branchHi);
          rootShadow = max(rootShadow, branchSh);
          rootTone = max(rootTone, branch * rootSeed);
        }
      }

      // Fine roots are deliberately narrower and more numerous. Their broken
      // opacity makes them feel embedded in the face rather than painted over it.
      float hairCell = floor(fc.x * 5.2 + 7.0);
      float hairSeed = hash(vec2(hairCell, 91.0));
      float hairBase = (hairCell + 0.5) / 5.2 - 7.0 / 5.2
        + (hairSeed - 0.5) * 0.11;
      float hairMax = 0.28 + hairSeed * 0.62;
      float hairX = rootPath(hairBase, hairSeed, rootDepth) + sin(rootDepth * 17.0 + hairSeed) * 0.009;
      float hairFade = smoothstep(0.02, 0.07, rootDepth)
        * (1.0 - smoothstep(hairMax - 0.12, hairMax, rootDepth));
      float hairBreak = smoothstep(0.28, 0.46,
        noise(vec2(rootDepth * 10.0 + hairSeed * 8.0, hairCell)));
      float hair = (1.0 - smoothstep(0.004, 0.011, abs(fc.x - hairX)))
        * hairFade * mix(0.45, 1.0, hairBreak) * step(0.20, hairSeed) * (1.0 - sandTop);

      soil *= 1.0 - rootShadow * 0.28;
      vec3 rootColor = mix(vec3(0.20, 0.11, 0.045), vec3(0.57, 0.39, 0.17), rootTone * 0.82);
      rootColor = mix(rootColor, vec3(0.73, 0.53, 0.27), rootHighlight * 0.62);
      soil = mix(soil, rootColor, root * 0.96);
      soil = mix(soil, vec3(0.31, 0.19, 0.085), hair * 0.86);

      // the dirt path exits the +z edge — carry its sand down the front face
      float pathBand = n.z > 0.5
        ? 1.0 - smoothstep(0.55, 0.95, abs(vPos.x + 0.43 + (noise(vec2(vPos.y * 1.3, 3.1)) - 0.5) * 0.5))
        : 0.0;

      vec3 sandCol = mix(uSandA, uSandB, fbm(fc * 1.1 + 3.0));
      vec3 col = mix(soil, sandCol * mix(1.0, 0.72, depthT), pathBand);

      // lip: thin DARK grass edge inland (a bright band read as ground color
      // seeping down the face), a shallow sand wash along the coast
      float lipNoise = (noise(vec2(fc.x * 2.1, 0.5)) - 0.5) * 0.08;
      float grassLip = smoothstep(-0.13 + lipNoise, -0.07 + lipNoise, vPos.y);
      float sandLip = smoothstep(-0.55 + lipNoise * 2.0, -0.25, vPos.y);
      vec3 grassRim = mix(vec3(0.19, 0.27, 0.10), vec3(0.30, 0.41, 0.16), smoothstep(-0.10, -0.02, vPos.y));
      float lip = mix(grassLip, sandLip, sandTop);
      vec3 lipColor = mix(grassRim, sandCol, max(sandTop, pathBand));
      col = mix(col, lipColor, lip);

      // cheap form shading: +x face catches the light, +z face in half shade
      col *= abs(n.x) > 0.5 ? 1.0 : 0.88;

      gl_FragColor = vec4(col, 1.0);
      #include <tonemapping_fragment>
      #include <colorspace_fragment>
    }
  `,
})

export function SoilBlock() {
  return (
    <mesh material={material} position={[0, TOP_Y - DEPTH / 2, 0]}>
      <boxGeometry args={[SIZE, DEPTH, SIZE]} />
    </mesh>
  )
}
