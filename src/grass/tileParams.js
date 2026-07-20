import * as THREE from 'three'
import { NUM_TILES, PARAM_TEXELS } from './constants.js'
import { GRASS_DEFAULTS } from './defaults.js'

// Per-tile parameter texture — layout per tile row (4 RGBA float texels):
//   texel 0: colorA.rgb, gradientScale
//   texel 1: colorB.rgb, gradientMix
//   texel 2: colorC.rgb, overlayCScale
//   texel 3: overlayCMix, 0, 0, 0
const paramData = new Float32Array(NUM_TILES * PARAM_TEXELS * 4)

export const paramTexture = new THREE.DataTexture(
  paramData, PARAM_TEXELS, NUM_TILES, THREE.RGBAFormat, THREE.FloatType
)
paramTexture.magFilter = THREE.NearestFilter
paramTexture.minFilter = THREE.NearestFilter

// seed-gated randomness: slider tweaks reuse the same seed (layout stays put),
// only the "randomize" button rolls a new one via reseed()
let seed = 1337
export function reseed() {
  seed = (Math.random() * 0xffffffff) >>> 0
}

function mulberry32(s) {
  return function () {
    s = (s + 0x6d2b79f5) | 0
    let t = Math.imul(s ^ (s >>> 15), 1 | s)
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

// jittered copy of a base color: +-hue, +-sat, +-lightness
function jitter(rand, hex, h, s, l) {
  const c = new THREE.Color(hex)
  const hsl = {}
  c.getHSL(hsl)
  c.setHSL(
    (hsl.h + (rand() - 0.5) * h + 1.0) % 1.0,
    THREE.MathUtils.clamp(hsl.s + (rand() - 0.5) * s, 0, 1),
    THREE.MathUtils.clamp(hsl.l + (rand() - 0.5) * l, 0, 1)
  )
  return c
}

export function randomizeTiles(colorA, colorB, colorC, gradScale, overlayScale) {
  const rand = mulberry32(seed)
  for (let tIdx = 0; tIdx < NUM_TILES; tIdx++) {
    const o = tIdx * PARAM_TEXELS * 4
    // Keep neighboring tiles in one restrained painted palette. Large hue
    // swings read as synthetic stripes once thousands of fronds overlap.
    let c = jitter(rand, colorA, 0.025, 0.08, 0.055)
    paramData[o + 0] = c.r; paramData[o + 1] = c.g; paramData[o + 2] = c.b
    paramData[o + 3] = gradScale * (0.75 + rand() * 0.5) // gradientScale, ±25% per tile
    c = jitter(rand, colorB, 0.025, 0.08, 0.055)
    paramData[o + 4] = c.r; paramData[o + 5] = c.g; paramData[o + 6] = c.b
    paramData[o + 7] = 0.2 + rand() * 0.16 // gradientMix
    c = jitter(rand, colorC, 0.035, 0.08, 0.055)
    paramData[o + 8] = c.r; paramData[o + 9] = c.g; paramData[o + 10] = c.b
    paramData[o + 11] = overlayScale * (0.75 + rand() * 0.5) // overlayCScale, ±25% per tile
    paramData[o + 12] = 0.1 + rand() * 0.14 // overlayCMix
  }
  paramTexture.needsUpdate = true
}

randomizeTiles(
  GRASS_DEFAULTS.colorA,
  GRASS_DEFAULTS.colorB,
  GRASS_DEFAULTS.colorC,
  GRASS_DEFAULTS.gradScale,
  GRASS_DEFAULTS.overlayScale
)
