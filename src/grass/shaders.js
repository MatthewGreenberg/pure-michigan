import { GRID, TILE, PARAM_TEXELS } from './constants.js'
import { COAST_EDGE, WATERLINE_Z } from '../coast.js'

// Vertex: places each instanced blade in its tile, applies wind bend, and
// fetches the tile's color/mix params from the DataTexture into varyings.
export const vertexShader = /* glsl */ `
  uniform float uTime;
  uniform sampler2D uTileParams;
  uniform float uNumTiles;
  uniform float uWindStrength;
  uniform float uWindSpeed;
  uniform float uGustScale;
  uniform float uClump;
  uniform float uClumpScale;
  uniform float uBladeHeight;
  uniform float uBladeWidth;
  uniform float uBladeTipWidth;
  uniform float uBladeTaper;
  uniform float uBladeCurve;
  uniform float uBladeLean;
  uniform sampler2D uRockMask;
  uniform sampler2D uDensityMask;
  uniform float uTrailPress;
  uniform vec3 uDuneGrassColor;

  attribute vec3 aOffset;       // local position within the tile
  attribute float aScale;
  attribute float aWidth;
  attribute float aTone;
  attribute float aRotation;
  attribute float aBendOffset;
  attribute vec3 aTileData;     // tileX, tileZ (grid coords), paramIndex

  varying float vHeight;
  varying float vGust;          // 0..1 gust intensity, drives the sheen
  varying float vBladeLight;
  varying float vBladeTone;
  varying float vClumpLight;
  varying float vTrail;
  varying float vCoast;
  varying vec3 vWorldPos;
  varying vec3 vColorA;
  varying vec3 vColorB;
  varying vec3 vColorC;
  varying vec4 vParams;         // gradScale, gradMix, cScale, cMix

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

  vec4 fetchParam(float texelIndex, float row) {
    return texture2D(uTileParams, vec2(
      (texelIndex + 0.5) / ${PARAM_TEXELS}.0,
      (row + 0.5) / uNumTiles
    ));
  }

  void main() {
    vHeight = uv.y;

    float row = aTileData.z;
    vec4 p0 = fetchParam(0.0, row); // colorA.rgb, gradScale
    vec4 p1 = fetchParam(1.0, row); // colorB.rgb, gradMix
    vec4 p2 = fetchParam(2.0, row); // colorC.rgb, cScale
    vec4 p3 = fetchParam(3.0, row); // cMix, -, -, -
    vColorA = p0.rgb;
    vColorB = p1.rgb;
    vColorC = p2.rgb;
    vParams = vec4(p0.a, p1.a, p2.a, p3.r);

    float c = cos(aRotation);
    float s = sin(aRotation);
    vec3 pos = position;

    // Turn the normalized strip into a controllable blade profile. Uniforms
    // make every part of the silhouette editable without rebuilding it.
    float bladeY = uv.y;
    float taper = 1.0 - pow(bladeY, uBladeTaper) * (1.0 - uBladeTipWidth);
    pos.x = pos.x * uBladeWidth * taper
      + sin(bladeY * 3.14159265) * uBladeCurve;
    pos.y *= uBladeHeight;
    pos.z = pow(bladeY, 1.8) * uBladeLean;

    pos.x *= aWidth;
    pos.xz = mat2(c, -s, s, c) * pos.xz;
    pos *= aScale;

    // Broad, fixed-direction illumination gives the unlit shader a gentle
    // storybook value structure. Random tone avoids a stamped appearance.
    vBladeLight = 0.5 + 0.5 * cos(aRotation - 0.72);
    vBladeTone = aTone;

    // tile origin from grid coords, centered on world origin
    vec2 tileOrigin = (aTileData.xy - (${GRID}.0 - 1.0) * 0.5) * ${TILE}.0;
    vec3 root = aOffset + vec3(tileOrigin.x, 0.0, tileOrigin.y);

    // Organic clumping: scatter candidate centers, warp the lookup domain,
    // then assign each blade to its nearest center. Per-center strength can
    // fall to zero, leaving irregular gaps instead of a complete lattice.
    float clumpSize = uClumpScale;
    vec2 clumpCoord = root.xz / clumpSize;
    vec2 warp = vec2(
      noise(clumpCoord * 0.32 + vec2(13.7, -8.4)),
      noise(clumpCoord * 0.32 + vec2(-31.2, 19.6))
    ) - 0.5;
    clumpCoord += warp * 1.15;

    vec2 baseCell = floor(clumpCoord);
    vec2 nearestCell = baseCell;
    vec2 nearestCenter = baseCell + 0.5;
    vec2 nearestDelta = vec2(0.0);
    float nearestDist = 1000000.0;

    for (int cy = -1; cy <= 1; cy++) {
      for (int cx = -1; cx <= 1; cx++) {
        vec2 cell = baseCell + vec2(float(cx), float(cy));
        vec2 jitter = vec2(
          hash(cell + vec2(17.1, 51.7)),
          hash(cell + vec2(83.3, 9.2))
        );
        vec2 center = cell + mix(vec2(0.02), vec2(0.98), jitter);
        vec2 delta = center - clumpCoord;
        float dist = dot(delta, delta);

        if (dist < nearestDist) {
          nearestDist = dist;
          nearestCell = cell;
          nearestCenter = center;
          nearestDelta = delta;
        }
      }
    }

    // Shape only the selected center as an independently rotated oval. This
    // keeps the search cheap while still giving clumps very different forms.
    float angle = hash(nearestCell + 71.9) * 6.2831853;
    float aspect = mix(0.55, 1.65, hash(nearestCell + 39.4));
    float ca = cos(angle);
    float sa = sin(angle);
    vec2 metric = mat2(ca, -sa, sa, ca) * nearestDelta;
    metric = vec2(metric.x * aspect, metric.y / aspect);
    float radius = mix(0.45, 1.55, hash(nearestCell + 26.8));
    float coreDist = length(metric) / radius;
    float proximity = 1.0 - smoothstep(0.05, 1.45, coreDist);
    float presence = smoothstep(0.2, 0.88, hash(nearestCell + 7.6));
    float pullVariation = mix(0.45, 1.15, hash(nearestCell + 92.1));
    float pull = uClump * presence * pullVariation * mix(0.4, 1.0, proximity);
    pull = min(pull, 0.9);

    // Move toward the warped-space center without collapsing every clump to
    // a dot. Weak clumps remain loose while strong clumps form dense islands.
    root.xz += (nearestCenter - clumpCoord) * clumpSize * pull;
    vClumpLight = proximity * presence;

    // rocks: collapse blades standing inside a rock footprint. The mask has
    // a soft rim, so edge blades shrink into the rock instead of hard-stopping.
    float rockMask = texture2D(uRockMask, root.xz / ${GRID * TILE}.0 + 0.5).r;
    pos *= 1.0 - rockMask;

    // The shared density mask presses a meandering trail through the field.
    // R controls how many blades survive, while G keeps the remaining growth
    // short enough to read as foot-worn rather than uniformly bare ground.
    vec4 densityMask = texture2D(uDensityMask, root.xz / ${GRID * TILE}.0 + 0.5);
    float bladeRandom = hash(root.xz * 19.37 + vec2(aTone * 7.1, aBendOffset));
    float bladeVisible = step(1.0 - densityMask.r, bladeRandom);
    pos *= bladeVisible;
    pos.y *= mix(1.0, mix(uTrailPress, uTrailPress + 0.16, aTone), densityMask.g);
    vTrail = densityMask.g;

    // Thin and shorten the growth into an irregular dune edge at the in-tile
    // coastline. Sparse dried tufts survive onto the dry beach, then a hard
    // cull removes everything the wobbling waterline can reach.
    float coastShape = -root.z
      + (noise(root.xz * 0.38 + vec2(4.6, -2.3)) - 0.5) * 1.3
      + sin(root.x * 0.55) * 0.18;
    vCoast = smoothstep(${(COAST_EDGE - 1.45).toFixed(2)}, ${(COAST_EDGE - 0.05).toFixed(2)}, coastShape);
    vCoast = max(vCoast, smoothstep(${(COAST_EDGE - 0.65).toFixed(2)}, ${(COAST_EDGE - 0.18).toFixed(2)}, -root.z));
    float coastRandom = hash(root.xz * 23.71 + vec2(aTone * 11.3, 42.7));
    float coastCull = max(
      vCoast * 0.98,
      smoothstep(${(-WATERLINE_Z - 1.55).toFixed(2)}, ${(-WATERLINE_Z - 1.15).toFixed(2)}, -root.z)
    );
    pos *= step(coastCull, coastRandom);
    pos.y *= mix(1.0, 0.32, vCoast);

    // Radius, local mound shape, and overall height are independent per
    // clump, producing short wispy patches beside taller, broader growth.
    float mound = mix(0.72, 1.3, proximity);
    float clumpHeight = mix(0.68, 1.48, hash(nearestCell + 41.3));
    float heightInfluence = uClump * mix(0.35, 1.0, presence);
    pos.y *= mix(1.0, clumpHeight * mound, heightInfluence);

    // wind: traveling gust field at blade root, quadratic bend toward the tip
    // Travel shore-to-foreground in world Z; with the path-facing camera this
    // reads as vertical movement instead of a sideways sweep.
    float gust = noise(root.xz * uGustScale * 4.0 - uTime * uWindSpeed * vec2(0.0, 1.4));
    float sway = sin(uTime * uWindSpeed * 2.5 + aBendOffset + root.x * 0.8) * 0.3;
    float bend = (gust * 0.8 + sway) * uWindStrength * vHeight * vHeight;
    // Let the broad shoulder of each gust catch the light. Restricting this
    // to only the highest noise peaks made the blade sheen nearly invisible.
    vGust = smoothstep(0.42, 0.82, gust);
    pos.x += bend;
    pos.z += bend * 0.6;

    vec3 worldPos = pos + root;
    vWorldPos = worldPos;

    gl_Position = projectionMatrix * modelViewMatrix * vec4(worldPos, 1.0);
  }
`

// Fragment: eased root->tip gradient, two world-space fbm color overlays (A/B
// gradient field + independent C field), and a soft root occlusion band. The
// procedural layers fade out at the root so it stays joined to the ground.
export const fragmentShader = /* glsl */ `
  uniform vec3 uBaseColor;
  uniform vec3 uGroundColorB;
  uniform float uGroundNoiseSize;
  uniform vec3 uTipColor;
  uniform float uTime;
  uniform float uSheen;
  uniform float uGradStrength;
  uniform float uRootShade;
  uniform vec3 uDuneGrassColor;

  varying float vHeight;
  varying float vGust;
  varying float vBladeLight;
  varying float vBladeTone;
  varying float vClumpLight;
  varying float vTrail;
  varying float vCoast;
  varying vec3 vWorldPos;
  varying vec3 vColorA;
  varying vec3 vColorB;
  varying vec3 vColorC;
  varying vec4 vParams; // gradScale, gradMix, cScale, cMix

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
    // Grass A/B noise-field gradient — world-space, so continuous across a tile.
    float t = fbm(vWorldPos.xz / vParams.x + uTime * 0.02);
    t = smoothstep(0.25, 0.75, t);
    vec3 overlay = mix(vColorA, vColorB, t);

    // Ease the grass palette into the blade body, leaving the lowest pixels
    // available for the independently controlled ground gradient below.
    float heightBlend = smoothstep(0.04, 0.96, vHeight);
    vec3 col = mix(uBaseColor, uTipColor, heightBlend * uGradStrength);
    float detailMask = smoothstep(0.035, 0.3, vHeight);
    detailMask *= 1.0 - 0.18 * smoothstep(0.82, 1.0, vHeight);
    col = mix(col, overlay, vParams.y * detailMask);

    // Match the ground shader at the root so changing either ground color or
    // the noise size never leaves a flat seam around the blades.
    float groundT = fbm(vWorldPos.xz / max(uGroundNoiseSize, 0.001) + uTime * 0.02);
    groundT = smoothstep(0.25, 0.75, groundT);
    vec3 groundSample = mix(uBaseColor, uGroundColorB, groundT);
    float groundRoot = 1.0 - smoothstep(0.035, 0.3, vHeight);
    col = mix(col, groundSample, groundRoot);

    // Independent C field. Mix some of the actual C color into the tint
    // instead of only multiplying it with the grass color; multiplication
    // alone cannot bring out hues (such as pink) that the grass lacks.
    float t2 = fbm(vWorldPos.xz / vParams.z + vec2(37.2, -91.7) + uTime * 0.015);
    t2 = smoothstep(0.32, 0.68, t2);
    float cStrength = min(smoothstep(0.48, 0.82, t2) * vParams.w * detailMask, 0.28);
    col = mix(col, vColorC, cStrength);

    // Subtle per-frond and mound modulation supplies depth without the neon
    // high-frequency color noise of the original field.
    float paintedLight = mix(0.91, 1.055, vBladeLight);
    paintedLight *= mix(0.95, 1.035, vBladeTone);
    paintedLight *= mix(0.97, 1.035, vClumpLight);
    col *= mix(1.0, paintedLight, detailMask);

    // Pressed blades are cooler, darker, and slightly earth-toned. Apply this
    // at the root too so they meet the trail-tinted ground without a bright seam.
    vec3 pressedColor = mix(col * 0.55, vec3(0.15, 0.19, 0.065), 0.22);
    col = mix(col, pressedColor, vTrail * 0.52);

    // The few tufts that survive nearest the beach dry toward the dune
    // palette, carrying the land color naturally into the sand.
    col = mix(col, uDuneGrassColor * mix(0.82, 1.08, vBladeTone), vCoast * 0.68);

    // wind sheen: gust-hit blades catch light toward the tip, warm-bright
    float sheen = vGust * vHeight * vHeight;
    vec3 sheenColor = col * 1.52 + vec3(0.09, 0.085, 0.025);
    col = mix(col, sheenColor, min(sheen * uSheen * 0.72, 0.82));

    // Put the contact shadow just above the root instead of directly on it.
    // This keeps the join seamless while retaining depth inside dense grass.
    float rootOcclusion = smoothstep(0.0, 0.08, vHeight);
    rootOcclusion *= 1.0 - smoothstep(0.08, 0.42, vHeight);
    col *= 1.0 - rootOcclusion * uRootShade * 0.5;

    gl_FragColor = vec4(col, 1.0);
    #include <tonemapping_fragment>
    #include <colorspace_fragment>
  }
`
