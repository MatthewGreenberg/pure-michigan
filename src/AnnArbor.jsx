import { useEffect, useRef, useState } from 'react'
import { useFrame, useThree } from '@react-three/fiber'
import { useGLTF } from '@react-three/drei'
import { ClickHint, useClickCursor } from './ClickHint.jsx'
import { useControls } from 'leva'
import { AnnArborBase } from './city/AnnArborBase.jsx'
import { ktx2, patchBakedWater } from './city/City.jsx'
import { makePeople, People } from './city/People.jsx'
import * as THREE from 'three'
import { MichiganFlag, calmFlagMaterial } from './MichiganHub.jsx'
import { uniforms as grassUniforms } from './grass/material.js'
import { hubTransition, sceneRendering } from './sceneState.js'

// Endover ("The Cube") — Rosenthal-style black cube on a corner: each face is
// four raised quadrants with a cross groove + center well. Lit standard so the
// facets read under the flag light rig (unlit basic was a flat silhouette).
const CUBE_EDGE = 0.62 * 0.6
const CUBE_TIP_Y = (CUBE_EDGE * Math.sqrt(3)) / 2
const cubePanelMat = new THREE.MeshStandardMaterial({ color: '#484646', roughness: 0.82, metalness: 0.18 })
const cubeGrooveMat = new THREE.MeshStandardMaterial({ color: '#080808', roughness: 0.92, metalness: 0.08 })
const cubeBaseMat = new THREE.MeshStandardMaterial({ color: '#222222', roughness: 0.7, metalness: 0.25 })

function buildEndover() {
  const root = new THREE.Group()
  const S = 1
  const half = S / 2
  const groove = 0.1
  const thick = 0.04
  const q = (S - groove) / 2
  const core = S - thick * 2
  root.add(new THREE.Mesh(new THREE.BoxGeometry(core, core, core), cubeGrooveMat))

  const quads = [
    [(q + groove) / 2, (q + groove) / 2],
    [-(q + groove) / 2, (q + groove) / 2],
    [(q + groove) / 2, -(q + groove) / 2],
    [-(q + groove) / 2, -(q + groove) / 2],
  ]
  const faces = [
    [[0, 0, half], [0, 0, 0]],
    [[0, 0, -half], [0, Math.PI, 0]],
    [[0, half, 0], [-Math.PI / 2, 0, 0]],
    [[0, -half, 0], [Math.PI / 2, 0, 0]],
    [[half, 0, 0], [0, Math.PI / 2, 0]],
    [[-half, 0, 0], [0, -Math.PI / 2, 0]],
  ]
  for (const [pos, rot] of faces) {
    const face = new THREE.Group()
    face.position.set(...pos)
    face.rotation.set(...rot)
    for (const [u, v] of quads) {
      const panel = new THREE.Mesh(new THREE.BoxGeometry(q * 0.96, q * 0.96, thick), cubePanelMat)
      panel.position.set(u, v, -thick / 2)
      face.add(panel)
    }
    // circular center well where the cross grooves meet
    const well = new THREE.Mesh(new THREE.CylinderGeometry(groove * 0.7, groove * 0.7, thick * 1.4, 20), cubeGrooveMat)
    well.rotation.x = Math.PI / 2
    well.position.z = -thick * 0.3
    face.add(well)
    root.add(face)
  }
  root.scale.setScalar(CUBE_EDGE)
  return root
}

const endoverMesh = buildEndover()

function SpinningCube() {
  const spin = useRef(null)
  const { x, y, z } = useControls('endover', {
    x: { value: 1.25, min: -8, max: 8, step: 0.05 },
    y: { value: 0, min: -2, max: 2, step: 0.01 },
    z: { value: 4.65, min: -8, max: 8, step: 0.05 },
    face: {
      value: '#484646',
      label: 'face color',
      onChange: (v) => { cubePanelMat.color.set(v) },
    },
  })
  useFrame((_, dt) => {
    if (!spin.current || !sceneRendering('annarbor')) return
    spin.current.rotation.y += dt * 0.35
  })
  return (
    <group position={[x, y, z]}>
      {/* low pivot pad under the tip */}
      <mesh material={cubeBaseMat} position={[0, 0.012, 0]}>
        <cylinderGeometry args={[0.045, 0.055, 0.024, 12]} />
      </mesh>
      <group ref={spin}>
        {/* tip a vertex straight down, then spin the parent about world Y */}
        <primitive
          object={endoverMesh}
          position={[0, CUBE_TIP_Y, 0]}
          rotation={[Math.PI / 4, 0, Math.atan(1 / Math.SQRT2)]}
        />
      </group>
    </group>
  )
}

// soft blob contact shadow for the flag — the GLB ground is unlit (baked
// lighting), so real shadow maps can't reach it; same trick as Birds.jsx,
// tinted neutral dark for pavement instead of grass green
const shadowCanvas = document.createElement('canvas')
shadowCanvas.width = shadowCanvas.height = 64
const sctx = shadowCanvas.getContext('2d')
const grd = sctx.createRadialGradient(32, 32, 0, 32, 32, 32)
grd.addColorStop(0, 'rgba(20,20,24,0.28)')
grd.addColorStop(0.4, 'rgba(20,20,24,0.16)')
grd.addColorStop(0.75, 'rgba(20,20,24,0.05)')
grd.addColorStop(1, 'rgba(20,20,24,0)')
sctx.fillStyle = grd
sctx.fillRect(0, 0, 64, 64)
const flagShadowMaterial = new THREE.MeshBasicMaterial({
  map: new THREE.CanvasTexture(shadowCanvas),
  transparent: true,
  depthWrite: false,
})

// Clump anchors [x, z, radius, count] in authored coords, keyed to the GLB's
// landmark node translations (Law Quad -3.4,9.4 / Main St 6.1,-5.1 /
// Angell -6.4,4.4 / Stadium -7.1,-5.2 / Campus Plaza 6.1,4.3).
const annArborPeople = makePeople([
  [-3.4, 7.2, 1.0, 10], [-1.2, 9.6, 0.9, 8], [-5.6, 9.2, 0.9, 7],     // Law Quad lawn
  [6.1, -2.6, 1.0, 10], [8.8, -5.0, 0.9, 8], [3.4, -5.4, 0.9, 8],     // Main Street
  [-6.3, 1.9, 0.9, 9], [-3.9, 4.3, 0.9, 7],                            // Angell Hall
  [-7.0, -2.2, 1.0, 10], [-3.9, -6.6, 0.9, 8], [-10.2, -7.9, 0.9, 7],  // stadium gates
  [6.1, 4.3, 1.3, 14], [8.8, 2.2, 0.9, 7], [3.5, 6.4, 0.9, 7],        // campus plaza
  [0.6, 0.8, 0.8, 6], [1.6, -2.6, 0.7, 5],                             // the Diag
])

// Block M formation — click the Diag flag and the whole town hustles into a
// giant maize block M around the pole, holds it, then disperses. Reuses the
// shared People system untouched: the formation driver just animates each
// person's home point (hx/hz) toward an M-shaped target and updatePeople
// renders as usual. Targets are sampled from /m.png's alpha (same mask the
// flag shader composites), laid out along the iso camera's screen axes so
// the M reads upright from the corner view. Module singletons throughout.
const MAIZE = new THREE.Color('#ffcb05')
const M_CENTER = [0.35, 0.55] // authored xz — just off the flagpole base
const M_SIZE = 7.2 // authored width of the glyph
const M_STRETCH = 1.7 // pre-stretch screen-vertical: iso view compresses ground depth
const M_RIGHT = [Math.SQRT1_2, -Math.SQRT1_2] // image +u → screen right
const M_UP = [-Math.SQRT1_2, -Math.SQRT1_2] // image +v → away from camera (M top)
const M_TRAVEL = 3.2 // seconds each person walks
const M_DELAY = 1.4 // max stagger before setting off
const M_HOLD = 5
const mSpots = [] // world-xz targets, filled once the image decodes
{
  const img = new Image()
  img.src = '/m.png'
  img.onload = () => {
    // sample at native aspect (530x358 — a square resample squashed the M)
    const W = 53
    const H = Math.max(1, Math.round((W * img.height) / img.width))
    const cv = document.createElement('canvas')
    cv.width = W
    cv.height = H
    const ctx = cv.getContext('2d')
    ctx.drawImage(img, 0, 0, W, H)
    const a = ctx.getImageData(0, 0, W, H).data
    const filled = new Set()
    for (let y = 0; y < H; y++)
      for (let x = 0; x < W; x++)
        if (a[(y * W + x) * 4 + 3] > 128) filled.add(y * W + x)
    // ~125 people can't FILL a readable glyph — trace its outline instead:
    // keep only cells with at least one empty 4-neighbor (serifs survive)
    const cells = []
    let minX = W, maxX = 0, minY = H, maxY = 0
    for (const id of filled) {
      const x = id % W
      const y = (id - x) / W
      const interior =
        filled.has(id - 1) && filled.has(id + 1) && filled.has(id - W) && filled.has(id + W)
      if (interior) continue
      cells.push([x, y])
      if (x < minX) minX = x
      if (x > maxX) maxX = x
      if (y < minY) minY = y
      if (y > maxY) maxY = y
    }
    // normalize to the glyph's own bbox so padding never shrinks the M, and
    // divide u and v by the same width so the glyph keeps its true aspect
    const cx = (minX + maxX) / 2
    const cy = (minY + maxY) / 2
    const ext = Math.max(maxX - minX, 1)
    for (const [x, y] of cells) {
      const u = (x - cx) / ext
      const v = ((cy - y) / ext) * M_STRETCH
      mSpots.push([
        M_CENTER[0] + (u * M_RIGHT[0] + v * M_UP[0]) * M_SIZE,
        M_CENTER[1] + (u * M_RIGHT[1] + v * M_UP[1]) * M_SIZE,
      ])
    }
  }
}

const formation = { phase: 'idle', t0: 0, color: 0, orig: null, kick: 0 }

function sendPeople(toFormation) {
  const ps = annArborPeople.params
  ps.forEach((p, i) => {
    if (p.ox === undefined) { p.ox = p.hx; p.oz = p.hz; p.owr = p.wr; p.os = p.s }
    if (toFormation) {
      // clump-ordered assignment: each clump traces a coherent arc of the M
      const c = mSpots[Math.floor((i * mSpots.length) / ps.length) % mSpots.length]
      p.fx = c[0] + (Math.random() - 0.5) * 0.06
      p.fz = c[1] + (Math.random() - 0.5) * 0.06
    } else {
      p.fx = p.ox
      p.fz = p.oz
    }
    p.sx = p.hx
    p.sz = p.hz
    p.delay = Math.random() * M_DELAY
  })
  formation.t0 = grassUniforms.uTime.value
}

function toggleFormation() {
  if (formation.phase === 'idle' && mSpots.length) {
    formation.orig ??= annArborPeople.bodies.instanceColor.array.slice()
    sendPeople(true)
    formation.phase = 'gather'
  } else if (formation.phase === 'hold') {
    sendPeople(false)
    formation.phase = 'release'
  }
}

function updateFormation(t, dt) {
  // click impulse: the flag whips immediately on every click and decays —
  // instant feedback long before the walking crowd reads as anything
  formation.kick = formation.kick > 0.001 ? formation.kick * Math.exp(-2.2 * dt) : 0
  if (formation.phase === 'idle') {
    calmFlagMaterial.uniforms.uExcite.value = formation.kick
    return
  }
  const ps = annArborPeople.params
  if (formation.phase === 'gather' || formation.phase === 'release') {
    const gathering = formation.phase === 'gather'
    let done = true
    for (const p of ps) {
      const k = Math.min(Math.max((t - formation.t0 - p.delay) / M_TRAVEL, 0), 1)
      if (k < 1) done = false
      const e = k * k * (3 - 2 * k)
      p.hx = p.sx + (p.fx - p.sx) * e
      p.hz = p.sz + (p.fz - p.sz) * e
      // wander circle and 1.3x formation swell ride the same ease — snapping
      // wr/s in sendPeople teleported everyone up to wr in a single frame
      const f = gathering ? e : 1 - e
      p.wr = p.owr * (1 - f)
      p.s = p.os * (1 + 0.3 * f)
    }
    if (done) {
      if (formation.phase === 'gather') {
        formation.phase = 'hold'
        formation.t0 = t
      } else {
        formation.phase = 'idle'
      }
    }
  } else if (formation.phase === 'hold' && t - formation.t0 > M_HOLD) {
    sendPeople(false)
    formation.phase = 'release'
  }
  // shirts chase maize while forming/holding, back to their own colors after;
  // the flag stirs via the amplitude-only uExcite (NEVER animate uSpeed — the
  // wave phase is uTime * uSpeed, so ramping it teleports the cloth)
  const goal = formation.phase === 'gather' || formation.phase === 'hold' ? 1 : 0
  const next = formation.color + (goal - formation.color) * Math.min(dt * 2.5, 1)
  if (Math.abs(next - formation.color) > 0.0005 || (goal === 0 && formation.color > 0)) {
    formation.color = next
    const { bodies } = annArborPeople
    const arr = bodies.instanceColor.array
    const orig = formation.orig
    for (let i = 0; i < arr.length; i += 3) {
      arr[i] = orig[i] + (MAIZE.r - orig[i]) * next
      arr[i + 1] = orig[i + 1] + (MAIZE.g - orig[i + 1]) * next
      arr[i + 2] = orig[i + 2] + (MAIZE.b - orig[i + 2]) * next
    }
    bodies.instanceColor.needsUpdate = true
  }
  calmFlagMaterial.uniforms.uExcite.value = Math.max(formation.color, formation.kick)
}

function BlockM() {
  const [hovered, setHovered] = useState(false)
  useClickCursor(hovered)
  useFrame(({ clock }, rawDt) => {
    if (!sceneRendering('annarbor')) return
    updateFormation(clock.elapsedTime, Math.min(rawDt, 0.05))
  })
  return (
    <group>
      {/* invisible click volume around the flag; gate on the destination — the
          shared event root raycasts portal scenes even while they're hidden */}
      <mesh
        position={[0, 1.1, 0]}
        onClick={(event) => {
          if (hubTransition.to !== 'annarbor') return
          event.stopPropagation()
          formation.kick = 1 // whip the flag NOW, whatever the phase
          toggleFormation()
        }}
        onPointerOver={(event) => {
          if (hubTransition.to !== 'annarbor') return
          event.stopPropagation()
          setHovered(true)
        }}
        onPointerOut={() => setHovered(false)}
      >
        <cylinderGeometry args={[1.9, 1.9, 3.2, 12]} />
        <meshBasicMaterial colorWrite={false} depthWrite={false} />
      </mesh>
      <ClickHint
        position={[0, 0.03, 0]}
        radius={1.6}
        scene="annarbor"
        hovered={hovered}
        color="#ffd75e"
      />
    </group>
  )
}

// Ann Arbor diorama — one Tripo GLB like Detroit (Draco + KTX2). Authored
// 30x30 with ground at y≈-0.075, so scale 0.5 fits the 15x15 slab. The GLB
// declares KHR_materials_unlit, so GLTFLoader already hands back
// MeshBasicMaterials — no material swap pass needed, just strip stray
// cameras/lights like the city does.
export function AnnArbor() {
  const gl = useThree((s) => s.gl)
  const { scene } = useGLTF('/ann-arbor_compressed.glb', true, false, (loader) =>
    loader.setKTX2Loader(ktx2.detectSupport(gl))
  )
  useEffect(() => {
    const junk = []
    scene.traverse((o) => {
      if (o.isCamera || o.isLight) junk.push(o)
      else if (o.isMesh && /ANN_UNLIT_(Site|Ground)/.test(o.material.name))
        patchBakedWater(o.material)
    })
    junk.forEach((o) => o.removeFromParent())
  }, [scene])
  return (
    <group>
      {/* campus-turf cross-section: living sod/roots and three light-gray M inlays */}
      <AnnArborBase />
      {/* no local Suspense — the GLB load suspends up to the app-level loading screen */}
      <primitive object={scene} scale={0.5} />
      {/* big state flag on the Diag at scene center; yaw π/4 faces the cloth
      to the iso corner camera (no land-frame rotation here, unlike the map),
      calm material so the wave stays gentle at this size */}
      <MichiganFlag position={[0, -0.04, 0]} scale={3.2} yaw={Math.PI / 4} material={calmFlagMaterial} />
      {/* flag-only light rig: every GLB/people material here is unlit basic, so
      these shade just the standard-material pole/finial — hemisphere for the
      vertical sky/ground gradient, directional from the iso camera side for
      the cylindrical falloff */}
      <hemisphereLight args={['#fff4e0', '#565660', 1.4]} />
      <directionalLight position={[8, 12, 6]} intensity={2.4} color="#fff3d8" />
      {/* blob elongated along the fly direction, just above the ground plane */}
      <group rotation-y={Math.PI / 4}>
        <mesh rotation-x={-Math.PI / 2} position={[0.5, -0.033, 0]} scale={[1.5, 0.8, 1]} material={flagShadowMaterial}>
          <circleGeometry args={[1, 24]} />
        </mesh>
      </group>
      <People people={annArborPeople} scene="annarbor" />
      <SpinningCube />
      <BlockM />
    </group>
  )
}
