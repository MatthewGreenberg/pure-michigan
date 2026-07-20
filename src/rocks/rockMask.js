import * as THREE from 'three'
import { GRID, TILE } from '../grass/constants.js'

// World-space occupancy mask over the whole field: 1 where a rock sits, 0
// elsewhere. The grass vertex shader samples it and collapses masked blades.
// Lives in its own module so grass/material.js can import it without pulling
// in the Rocks component (no cycle: this file only needs constants).
const SIZE = 256
const FIELD = GRID * TILE
const data = new Uint8Array(SIZE * SIZE)

export const rockMaskTexture = new THREE.DataTexture(data, SIZE, SIZE, THREE.RedFormat)
rockMaskTexture.magFilter = THREE.LinearFilter
rockMaskTexture.minFilter = THREE.LinearFilter
rockMaskTexture.needsUpdate = true

// grass shortens in a ring extending past each rock, so blades ramp up
// around the base instead of standing full-height at the rim
const RING = 1.6

// footprints: [{ x, z, r }] in world units. Solid kill inside 0.8r, then a
// soft fade out to RING*r — blades at the rock's edge are ~15% height and
// grow back to full across the surrounding ring.
// Rocks re-scatter on every slider change; scenery (house, loungers) is
// static. Keep both lists so a rock re-stamp doesn't wipe the scenery kills.
let rockFootprints = []
let sceneryFootprints = []

export function stampRockMask(footprints) {
  rockFootprints = footprints
  bake()
}

export function stampSceneryMask(footprints) {
  sceneryFootprints = footprints
  bake()
}

// Rocks use this to avoid spawning inside the house / lounging scene.
export function overlapsScenery(x, z, r) {
  return sceneryFootprints.some((f) => Math.hypot(x - f.x, z - f.z) < f.r + r)
}

function bake() {
  data.fill(0)
  for (const { x, z, r } of [...rockFootprints, ...sceneryFootprints]) {
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
