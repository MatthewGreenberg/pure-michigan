import * as THREE from 'three'
import { GRID, TILE } from './grass/constants.js'

export const FIELD_HALF = (GRID * TILE) / 2

// Keep the coast palette in one place so the field's dune edge and the ocean
// plane meet with the same color instead of reading as stacked surfaces.
export const coastColors = {
  // Numeric construction keeps these in the same linear space as the
  // original Ocean shader's vec3 palette.
  sandA: new THREE.Color(0.91, 0.84, 0.64),
  sandB: new THREE.Color(0.84, 0.75, 0.54),
  duneGrass: new THREE.Color('#a5a85d'),
}

export const coastUniforms = {
  uSandA: { value: coastColors.sandA },
  uSandB: { value: coastColors.sandB },
  uDuneGrassColor: { value: coastColors.duneGrass },
}

// The whole coast now lives INSIDE the tile so the scene reads as one square
// diorama: grass is fully dune sand by z = -COAST_EDGE, the ground plane
// discards past LAND_EDGE_Z (the ocean plane tucked beneath it shows through),
// and the water runs from WATERLINE_Z to the tile edge at -FIELD_HALF.
export const COAST_EDGE = 3.6
export const LAND_EDGE_Z = -(COAST_EDGE - 0.18)
export const WATERLINE_Z = -5.1
