import { useEffect } from 'react'
import { useFrame } from '@react-three/fiber'
import { useControls, button } from 'leva'
import { BLADE_COUNT } from './constants.js'
import { GRASS_DEFAULTS, PATH_DEFAULTS } from './defaults.js'
import { buildGeometry } from './geometry.js'
import { randomizeTiles, reseed } from './tileParams.js'
import { uniforms, material } from './material.js'
import { setPathParam } from './densityMask.js'
import { lowGPU } from '../gpu.js'

// ponytail: module singletons — one Grass instance, and it keeps the React
// Compiler happy (no render-scope mutation). Move into the component if this
// ever needs to mount more than once.
const geometry = buildGeometry()
// weak GPU: third of the blades — the vertex-bound cost scales linearly and
// the blade-major layout keeps the thinning even across tiles
const defaultBlades = lowGPU ? Math.round(GRASS_DEFAULTS.blades / 3) : GRASS_DEFAULTS.blades
geometry.instanceCount = defaultBlades

export function Grass() {
  const { colorA, colorB, colorC, gradScale, overlayScale } = useControls({
    colorA: { value: GRASS_DEFAULTS.colorA, label: 'base A' },
    colorB: { value: GRASS_DEFAULTS.colorB, label: 'base B' },
    colorC: { value: GRASS_DEFAULTS.colorC, label: 'base C' },
    gradScale: { value: GRASS_DEFAULTS.gradScale, min: 0.5, max: 10, step: 0.1, label: 'A/B noise scale' },
    overlayScale: { value: GRASS_DEFAULTS.overlayScale, min: 0.5, max: 12, step: 0.1, label: 'C noise scale' },
    randomize: button((get) => {
      reseed()
      randomizeTiles(get('colorA'), get('colorB'), get('colorC'), get('gradScale'), get('overlayScale'))
    }),
  })

  // transient: onChange writes straight to the uniform, no re-render
  useControls('wind', {
    strength: { value: GRASS_DEFAULTS.windStrength, min: 0, max: 3, step: 0.05, onChange: (v) => { uniforms.uWindStrength.value = v } },
    speed: { value: GRASS_DEFAULTS.windSpeed, min: 0, max: 3, step: 0.05, onChange: (v) => { uniforms.uWindSpeed.value = v } },
    gustScale: { value: GRASS_DEFAULTS.gustScale, min: 0.02, max: 0.6, step: 0.01, label: 'gust scale', onChange: (v) => { uniforms.uGustScale.value = v } },
    sheen: { value: GRASS_DEFAULTS.sheen, min: 0, max: 2, step: 0.05, onChange: (v) => { uniforms.uSheen.value = v } },
  })

  useControls('field', {
    clump: { value: GRASS_DEFAULTS.clump, min: 0, max: 0.9, step: 0.01, onChange: (v) => { uniforms.uClump.value = v } },
    clumpScale: { value: GRASS_DEFAULTS.clumpScale, min: 0.6, max: 4, step: 0.1, label: 'clump scale', onChange: (v) => { uniforms.uClumpScale.value = v } },
    blades: { value: defaultBlades, min: 1000, max: BLADE_COUNT, step: 100, onChange: (v) => { geometry.instanceCount = v } },
  })

  useControls('blade shape', {
    height: { value: GRASS_DEFAULTS.bladeHeight, min: 0.1, max: 1.5, step: 0.01, onChange: (v) => { uniforms.uBladeHeight.value = v } },
    width: { value: GRASS_DEFAULTS.bladeWidth, min: 0.02, max: 0.4, step: 0.005, label: 'base width', onChange: (v) => { uniforms.uBladeWidth.value = v } },
    tipWidth: { value: GRASS_DEFAULTS.bladeTipWidth, min: 0, max: 1, step: 0.01, label: 'tip width', onChange: (v) => { uniforms.uBladeTipWidth.value = v } },
    taper: { value: GRASS_DEFAULTS.bladeTaper, min: 0.2, max: 4, step: 0.05, onChange: (v) => { uniforms.uBladeTaper.value = v } },
    curve: { value: GRASS_DEFAULTS.bladeCurve, min: -0.15, max: 0.15, step: 0.005, label: 'side curve', onChange: (v) => { uniforms.uBladeCurve.value = v } },
    lean: { value: GRASS_DEFAULTS.bladeLean, min: -0.2, max: 0.3, step: 0.005, label: 'forward lean', onChange: (v) => { uniforms.uBladeLean.value = v } },
  })

  // first four re-bake the mask texture; the rest write straight to uniforms
  useControls('path', {
    width: { value: PATH_DEFAULTS.width, min: 0.3, max: 2.5, step: 0.05, onChange: (v) => setPathParam('width', v) },
    soil: { value: PATH_DEFAULTS.soil, min: 0, max: 1, step: 0.05, label: 'soil patches', onChange: (v) => setPathParam('soil', v) },
    clearing: { value: PATH_DEFAULTS.clearing, min: 0, max: 1, step: 0.05, onChange: (v) => setPathParam('clearing', v) },
    core: { value: PATH_DEFAULTS.core, min: 0, max: 1, step: 0.05, label: 'bare core', onChange: (v) => setPathParam('core', v) },
    press: { value: PATH_DEFAULTS.press, min: 0.05, max: 1, step: 0.01, label: 'blade press', onChange: (v) => { uniforms.uTrailPress.value = v } },
    soilColor: { value: PATH_DEFAULTS.soilColor, label: 'soil color', onChange: (v) => { uniforms.uSoilColor.value.set(v) } },
    darken: { value: PATH_DEFAULTS.darken, min: 0, max: 1, step: 0.05, label: 'edge darken', onChange: (v) => { uniforms.uPathDarken.value = v } },
    bump: { value: PATH_DEFAULTS.bump, min: 0, max: 4, step: 0.1, onChange: (v) => { uniforms.uPathBump.value = v } },
    bumpScale: { value: PATH_DEFAULTS.bumpScale, min: 1, max: 16, step: 0.5, label: 'bump scale', onChange: (v) => { uniforms.uBumpScale.value = v } },
  })

  useControls('ground', {
    colorA: { value: GRASS_DEFAULTS.ground, label: 'color A', onChange: (v) => { uniforms.uBaseColor.value.set(v) } },
    colorB: { value: GRASS_DEFAULTS.groundB, label: 'color B', onChange: (v) => { uniforms.uGroundColorB.value.set(v) } },
    noiseSize: { value: GRASS_DEFAULTS.groundNoiseSize, min: 0.1, max: 10, step: 0.1, label: 'noise size', onChange: (v) => { uniforms.uGroundNoiseSize.value = v } },
  })

  useControls('color', {
    gradStrength: { value: GRASS_DEFAULTS.gradStrength, min: 0, max: 1, step: 0.05, label: 'gradient strength', onChange: (v) => { uniforms.uGradStrength.value = v } },
    bladeTip: { value: GRASS_DEFAULTS.bladeTip, label: 'blade tip', onChange: (v) => { uniforms.uTipColor.value.set(v) } },
  })

  // re-randomize whenever a control changes (and on mount)
  useEffect(() => {
    randomizeTiles(colorA, colorB, colorC, gradScale, overlayScale)
  }, [colorA, colorB, colorC, gradScale, overlayScale])

  useFrame(({ clock }) => {
    uniforms.uTime.value = clock.getElapsedTime()
  })

  return <mesh geometry={geometry} material={material} frustumCulled={false} />

}
