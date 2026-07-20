import { useRef, useState } from 'react'
import { Canvas, useFrame } from '@react-three/fiber'
import { Color, MathUtils } from 'three'
import { Leva, useControls } from 'leva'
import { Birds } from './Birds.jsx'
import { Camera } from './Camera.jsx'
import { City } from './city/City.jsx'
import { flipState } from './city/flipState.js'
import { Grass } from './grass/Grass.jsx'
import { Rocks } from './rocks/Rocks.jsx'
import { Ocean } from './Ocean.jsx'
import { Scenery } from './Scenery.jsx'
import { SoilBlock } from './SoilBlock.jsx'
import { Sky } from './Sky.jsx'
import { skyUniforms } from './skyMaterial.js'
import { StylePass } from './StyleEffect.jsx'
import { groundMaterial } from './grass/material.js'
import { GRID, TILE } from './grass/constants.js'

const FLIP_SECONDS = 1.7

// deep-link: open with #city to start on the Detroit side, no flip animation
const START_CITY = typeof window !== 'undefined' && window.location.hash === '#city'

// Detroit gets a steelier sky with a warm smoggy horizon; blended from whatever
// the leva "background" colors currently are while the block is mid-flip.
const CITY_SKY = {
  uSkyTop: new Color('#5b7186'),
  uSkyMiddle: new Color('#94a4a6'),
  uSkyBottom: new Color('#cfc3a9'),
  uHorizonGlow: new Color('#e9c9a0'),
}

// easeInOutBack with a gentle s: a small wind-up tip before the flip and a few
// degrees of over-rotation that settle on landing — reads as weight.
function easeFlip(t) {
  const c = 0.6 * 1.525
  return t < 0.5
    ? (Math.pow(2 * t, 2) * ((c + 1) * 2 * t - c)) / 2
    : (Math.pow(2 * t - 2, 2) * ((c + 1) * (t * 2 - 2) + c) + 2) / 2
}

// Coin-flip rig: the grass diorama rides the top of the slab, Detroit is mounted
// upside-down on the underside (pre-rotated π about x). Rotating this group π
// about the slab's mid-height (y=-1) somersaults the block and lands the city
// upright exactly where the grass was. The hidden side is culled at rest, the
// sky palette and the two light rigs crossfade mid-flip (city rig reads
// flipState in City.jsx), and a dust ring puffs out where the block lands.
function Flipper({ flipped, children }) {
  const flip = useRef()
  const grassSide = useRef()
  const citySide = useRef()
  const dust = useRef()
  const p = useRef(START_CITY ? 1 : 0)
  const dustT = useRef(null)
  const meadowSky = useRef(null)

  useFrame((_, rawDt) => {
    const dt = Math.min(rawDt, 0.05)
    const prev = p.current
    p.current = MathUtils.clamp(p.current + (flipped ? dt : -dt) / FLIP_SECONDS, 0, 1)
    flipState.p = p.current

    const g = flip.current
    g.rotation.x = Math.PI * easeFlip(p.current)
    g.position.y = Math.sin(Math.PI * MathUtils.smoothstep(p.current, 0.04, 0.96)) * 1.55

    grassSide.current.visible = p.current < 0.98
    citySide.current.visible = p.current > 0.02

    // sky crossfade — capture the meadow palette (incl. any leva edits) at rest
    if (p.current <= 0.001) {
      if (!meadowSky.current) meadowSky.current = {}
      for (const k in CITY_SKY) {
        meadowSky.current[k] = (meadowSky.current[k] || new Color()).copy(skyUniforms[k].value)
      }
    } else if (meadowSky.current) {
      const mix = MathUtils.smoothstep(p.current, 0.25, 0.75)
      for (const k in CITY_SKY) {
        skyUniforms[k].value.copy(meadowSky.current[k]).lerp(CITY_SKY[k], mix)
      }
    }

    // landing dust: trigger as either face touches down
    if ((prev < 0.93 && p.current >= 0.93) || (prev > 0.07 && p.current <= 0.07)) dustT.current = 0
    if (dustT.current !== null) {
      dustT.current += dt
      const k = dustT.current / 0.6
      if (k >= 1) {
        dustT.current = null
        dust.current.visible = false
      } else {
        const s = 4 + 5 * (1 - Math.pow(1 - k, 3))
        dust.current.visible = true
        dust.current.scale.set(s, s, s)
        dust.current.material.opacity = 0.4 * Math.pow(1 - k, 1.6)
      }
    }
  })

  return (
    <>
      <group position-y={-1}>
        <group ref={flip}>
          <group ref={grassSide} position-y={1}>{children}</group>
          <group ref={citySide} position-y={-1} rotation-x={Math.PI}>
            <City />
          </group>
        </group>
      </group>
      <mesh ref={dust} rotation-x={-Math.PI / 2} position-y={0.03} visible={false}>
        <ringGeometry args={[0.82, 1, 32]} />
        <meshBasicMaterial color="#ded6c2" transparent opacity={0} depthWrite={false} />
      </mesh>
    </>
  )
}

export default function App() {
  const [flipped, setFlipped] = useState(START_CITY)

  useControls('background', {
    skyTop: { value: '#66859a', label: 'sky top', onChange: (v) => { skyUniforms.uSkyTop.value.set(v) } },
    skyMiddle: { value: '#9bb5ad', label: 'sky middle', onChange: (v) => { skyUniforms.uSkyMiddle.value.set(v) } },
    skyBottom: { value: '#d7d5ab', label: 'sky bottom', onChange: (v) => { skyUniforms.uSkyBottom.value.set(v) } },
    horizonGlow: { value: '#f5dda4', label: 'horizon glow', onChange: (v) => { skyUniforms.uHorizonGlow.value.set(v) } },
  }, { collapsed: true, order: 10 })

  return (
    <main className="scene">
      <Leva collapsed />
      <Canvas shadows dpr={[1, 2]} gl={{ antialias: true, alpha: false }}>
        <Camera />
        <Sky />
        <Flipper flipped={flipped}>
          <Grass />
          <Rocks />
          <Ocean />
          <Scenery />
          <Birds />
          {/* flat base under the whole grid — color synced to blade roots via leva */}
          <mesh rotation-x={-Math.PI / 2} position-y={-0.01} material={groundMaterial}>
            <planeGeometry args={[GRID * TILE, GRID * TILE]} />
          </mesh>
          <SoilBlock />
        </Flipper>
        <StylePass />
      </Canvas>
      <button
        className={`flip-btn${flipped ? ' flipped' : ''}`}
        onClick={() => setFlipped((f) => !f)}
        aria-label={flipped ? 'flip to meadow' : 'flip to downtown Detroit'}
        title={flipped ? 'flip to meadow' : 'flip to downtown Detroit'}
      >
        ➜
      </button>
    </main>
  )
}
