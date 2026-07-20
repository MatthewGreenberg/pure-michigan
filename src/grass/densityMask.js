import * as THREE from 'three'
import { GRID, TILE } from './constants.js'
import { PATH_DEFAULTS } from './defaults.js'

const SIZE = 256
const FIELD_SIZE = GRID * TILE

function hash(x, y) {
  const n = Math.sin(x * 127.1 + y * 311.7) * 43758.5453
  return n - Math.floor(n)
}

function smoothstep(edge0, edge1, value) {
  const t = Math.min(1, Math.max(0, (value - edge0) / (edge1 - edge0)))
  return t * t * (3 - 2 * t)
}

function noise(x, y) {
  const ix = Math.floor(x)
  const iy = Math.floor(y)
  const fx = x - ix
  const fy = y - iy
  const ux = fx * fx * (3 - 2 * fx)
  const uy = fy * fy * (3 - 2 * fy)
  const a = hash(ix, iy)
  const b = hash(ix + 1, iy)
  const c = hash(ix, iy + 1)
  const d = hash(ix + 1, iy + 1)
  return (a + (b - a) * ux) * (1 - uy) + (c + (d - c) * ux) * uy
}

function fbm(x, y) {
  let value = 0
  let amplitude = 0.5
  for (let octave = 0; octave < 4; octave++) {
    value += noise(x, y) * amplitude
    const nextX = x * 1.7 - y * 1.1
    y = x * 1.1 + y * 1.7
    x = nextX
    amplitude *= 0.5
  }
  return value / 0.9375
}

const params = {
  width: PATH_DEFAULTS.width,
  soil: PATH_DEFAULTS.soil,
  clearing: PATH_DEFAULTS.clearing,
  core: PATH_DEFAULTS.core,
}

const data = new Uint8Array(SIZE * SIZE * 4)

function bake() {
  for (let py = 0; py < SIZE; py++) {
    const z = (py / (SIZE - 1) - 0.5) * FIELD_SIZE

    for (let px = 0; px < SIZE; px++) {
      const x = (px / (SIZE - 1) - 0.5) * FIELD_SIZE
      const centerX = -0.1 + Math.sin(z * 0.48 + 0.7) * 0.36 + Math.sin(z * 1.12 - 0.5) * 0.1
      const edgeNoise = fbm(x * 0.32 + 4.2, z * 0.32 - 7.8) - 0.5
      const width = params.width + edgeNoise * 0.42
      const distance = Math.abs(x - centerX) / Math.max(0.05, width)
      const trail = 1 - smoothstep(0.3, 1.12, distance)

      // A continuous bare core keeps the route readable end-to-end; broad
      // noise patches roughen its edges so it doesn't look stamped.
      const patchNoise = fbm(x * 0.7 + 19.4, z * 0.7 - 31.7)
      const threshold = 0.9 - params.soil * 0.6
      const core = (1 - smoothstep(0.15, 0.6, distance)) * params.core
      const patches = Math.pow(trail, 1.3) * smoothstep(threshold, threshold + 0.2, patchNoise)
      const soil = Math.max(core, patches)
      // No floor — at clearing 1 the path center must go fully bald.
      const density = Math.max(0, 1 - trail * params.clearing - soil * 0.9)
      const index = (py * SIZE + px) * 4

      data[index] = Math.round(density * 255)
      data[index + 1] = Math.round(trail * 255)
      data[index + 2] = Math.round(soil * 255)
      data[index + 3] = 255
    }
  }

  densityMaskTexture.needsUpdate = true
}

// R = remaining blade density, G = pressed-grass amount, B = exposed soil.
export const densityMaskTexture = new THREE.DataTexture(data, SIZE, SIZE, THREE.RGBAFormat)
densityMaskTexture.minFilter = THREE.LinearFilter
densityMaskTexture.magFilter = THREE.LinearFilter
densityMaskTexture.generateMipmaps = false
bake()

// ponytail: full 256² re-bake per slider tick (~a few ms) — throttle if it janks
export function setPathParam(key, value) {
  params[key] = value
  bake()
}
