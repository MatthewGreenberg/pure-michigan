import * as THREE from 'three'
import { GRID, TILE } from '../grass/constants.js'

// World-space occupancy mask over the whole field: 1 where scenery sits, 0
// elsewhere. The grass vertex shader samples it and collapses masked blades
// so grass doesn't grow through the cottage / lounging-scene footprints.
// (The rocks that originally shared this mask are gone.)
const SIZE = 256
const FIELD = GRID * TILE
const data = new Uint8Array(SIZE * SIZE)

export const rockMaskTexture = new THREE.DataTexture(data, SIZE, SIZE, THREE.RedFormat)
rockMaskTexture.magFilter = THREE.LinearFilter
rockMaskTexture.minFilter = THREE.LinearFilter
rockMaskTexture.needsUpdate = true

// grass shortens in a ring extending past each footprint, so blades ramp up
// around the base instead of standing full-height at the rim
const RING = 1.6

// footprints: [{ x, z, r }] in world units. Solid kill inside 0.8r, then a
// soft fade out to RING*r.
export function stampSceneryMask(footprints) {
  data.fill(0)
  for (const { x, z, r } of footprints) {
    const cx = (x / FIELD + 0.5) * SIZE
    const cz = (z / FIELD + 0.5) * SIZE
    const pr = ((r * RING) / FIELD) * SIZE
    const x0 = Math.max(0, Math.floor(cx - pr - 1))
    const x1 = Math.min(SIZE - 1, Math.ceil(cx + pr + 1))
    const z0 = Math.max(0, Math.floor(cz - pr - 1))
    const z1 = Math.min(SIZE - 1, Math.ceil(cz + pr + 1))
    for (let j = z0; j <= z1; j++) {
      for (let i = x0; i <= x1; i++) {
        const d = Math.hypot(i + 0.5 - cx, j + 0.5 - cz) / pr
        const v = Math.round((1 - THREE.MathUtils.smoothstep(d, 0.5, 1.0)) * 255)
        const idx = j * SIZE + i
        if (v > data[idx]) data[idx] = v
      }
    }
  }
  rockMaskTexture.needsUpdate = true
}
