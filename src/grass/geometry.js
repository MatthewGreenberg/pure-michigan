import * as THREE from 'three'
import { GRID, TILE, BLADES_PER_TILE, BLADE_COUNT } from './constants.js'

// One normalized, segmented strip, instanced BLADE_COUNT times with per-blade
// position/scale/width/tone/rotation/wind-phase and tile-id attributes. The
// vertex shader shapes the strip so the blade profile can be changed live.
export function buildGeometry() {
  const blade = new THREE.PlaneGeometry(1, 1, 1, 4)
  blade.translate(0, 0.5, 0)

  const geometry = new THREE.InstancedBufferGeometry()
  geometry.index = blade.index
  geometry.attributes.position = blade.attributes.position
  geometry.attributes.uv = blade.attributes.uv
  geometry.instanceCount = BLADE_COUNT

  const offsets = new Float32Array(BLADE_COUNT * 3)
  const scales = new Float32Array(BLADE_COUNT)
  const widths = new Float32Array(BLADE_COUNT)
  const tones = new Float32Array(BLADE_COUNT)
  const rotations = new Float32Array(BLADE_COUNT)
  const bendOffsets = new Float32Array(BLADE_COUNT)
  const tileData = new Float32Array(BLADE_COUNT * 3)

  // blade-major order (tiles innermost) so truncating instanceCount via the
  // blade-count slider thins all tiles uniformly instead of emptying the last ones
  let i = 0
  for (let b = 0; b < BLADES_PER_TILE; b++) {
    for (let ty = 0; ty < GRID; ty++) {
      for (let tx = 0; tx < GRID; tx++, i++) {
        const paramIndex = ty * GRID + tx
        offsets[i * 3] = (Math.random() - 0.5) * TILE
        offsets[i * 3 + 1] = 0
        offsets[i * 3 + 2] = (Math.random() - 0.5) * TILE
        // Most growth stays low and pillowy; a few taller fronds break the
        // silhouette without turning the moss into a field of long grass.
        scales[i] = 0.58 + Math.pow(Math.random(), 1.8) * 0.82
        widths[i] = 0.78 + Math.random() * 0.52
        tones[i] = Math.random()
        rotations[i] = Math.random() * Math.PI * 2
        bendOffsets[i] = Math.random() * Math.PI * 2
        tileData[i * 3] = tx
        tileData[i * 3 + 1] = ty
        tileData[i * 3 + 2] = paramIndex
      }
    }
  }

  geometry.setAttribute('aOffset', new THREE.InstancedBufferAttribute(offsets, 3))
  geometry.setAttribute('aScale', new THREE.InstancedBufferAttribute(scales, 1))
  geometry.setAttribute('aWidth', new THREE.InstancedBufferAttribute(widths, 1))
  geometry.setAttribute('aTone', new THREE.InstancedBufferAttribute(tones, 1))
  geometry.setAttribute('aRotation', new THREE.InstancedBufferAttribute(rotations, 1))
  geometry.setAttribute('aBendOffset', new THREE.InstancedBufferAttribute(bendOffsets, 1))
  geometry.setAttribute('aTileData', new THREE.InstancedBufferAttribute(tileData, 3))
  return geometry
}
