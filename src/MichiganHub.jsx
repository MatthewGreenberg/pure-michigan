import { useEffect, useRef, useState } from 'react'
import { useControls } from 'leva'
import { Text } from '@react-three/drei'
import { useClickCursor } from './ClickHint.jsx'
import { useFrame } from '@react-three/fiber'
import * as THREE from 'three'
import { MITTEN_PATH, UP_PATH } from './MittenLoader.jsx'
import { uniforms as grassUniforms } from './grass/material.js'
import { sceneRendering } from './sceneState.js'

const MAP_SCALE = 0.0225
const MAP_CENTER_X = 258
const MAP_CENTER_Y = 350
const NUMBER = /-?\d+(?:\.\d+)?/g
// Extrude depth 0.34 + bevelThickness 0.055 → flat top of the land slab
const LAND_TOP = 0.395

function pathToShapePoints(path) {
  const values = path.match(NUMBER).map(Number)
  const points = []
  for (let i = 0; i < values.length; i += 2) {
    points.push(new THREE.Vector2(
      (values[i] - MAP_CENTER_X) * MAP_SCALE,
      (MAP_CENTER_Y - values[i + 1]) * MAP_SCALE,
    ))
  }
  if (!THREE.ShapeUtils.isClockWise(points)) points.reverse()
  return points
}

function buildLandGeometry(path) {
  const geometry = new THREE.ExtrudeGeometry(new THREE.Shape(pathToShapePoints(path)), {
    depth: 0.34,
    bevelEnabled: true,
    bevelSegments: 2,
    bevelSize: 0.055,
    bevelThickness: 0.055,
    curveSegments: 1,
  })
  geometry.rotateX(-Math.PI / 2)
  geometry.computeVertexNormals()
  return geometry
}

function pointInPoly(pt, poly) {
  let inside = false
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const a = poly[i]
    const b = poly[j]
    if (((a.y > pt.y) !== (b.y > pt.y)) &&
      (pt.x < (b.x - a.x) * (pt.y - a.y) / (b.y - a.y) + a.x)) inside = !inside
  }
  return inside
}

// Seeded scatter kept inland (coast margin) and clear of destination pins.
function scatterTrees(poly, count, seed, hMin, hMax) {
  let minX = Infinity
  let minY = Infinity
  let maxX = -Infinity
  let maxY = -Infinity
  for (const p of poly) {
    minX = Math.min(minX, p.x)
    minY = Math.min(minY, p.y)
    maxX = Math.max(maxX, p.x)
    maxY = Math.max(maxY, p.y)
  }
  let s = seed | 0
  const rand = () => {
    s = (s + 0x6d2b79f5) | 0
    let t = Math.imul(s ^ (s >>> 15), 1 | s)
    t ^= t + Math.imul(t ^ (t >>> 7), 61 | t)
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
  const trees = []
  let tries = 0
  while (trees.length < count && tries < count * 80) {
    tries++
    const sx = minX + rand() * (maxX - minX)
    const sy = minY + rand() * (maxY - minY)
    const p = new THREE.Vector2(sx, sy)
    if (!pointInPoly(p, poly)) continue
    // keep a little inland so cones aren't perched on the beveled shore
    let nearEdge = false
    for (let a = 0; a < 8; a++) {
      const ang = (a * Math.PI) / 4
      if (!pointInPoly(new THREE.Vector2(sx + Math.cos(ang) * 0.14, sy + Math.sin(ang) * 0.14), poly)) {
        nearEdge = true
        break
      }
    }
    if (nearEdge) continue
    // world xz after rotateX(-π/2): (sx, -sy)
    const x = sx
    const z = -sy
    if (Math.hypot(x - DESTINATION_POSITIONS.city.x, z - DESTINATION_POSITIONS.city.z) < 1.6) continue
    if (Math.hypot(x - DESTINATION_POSITIONS.meadow.x, z - DESTINATION_POSITIONS.meadow.z) < 1.3) continue
    if (Math.hypot(x - DESTINATION_POSITIONS.annarbor.x, z - DESTINATION_POSITIONS.annarbor.z) < 1.3) continue
    trees.push([x, z, hMin + rand() * (hMax - hMin)])
  }
  return trees
}

const landGeometries = [buildLandGeometry(UP_PATH), buildLandGeometry(MITTEN_PATH)]
const landOutlines = landGeometries.map((geometry) => new THREE.EdgesGeometry(geometry, 28))
const landMaterials = [
  new THREE.MeshStandardMaterial({ color: '#b4c79c', roughness: 0.96, metalness: 0 }),
  new THREE.MeshStandardMaterial({ color: '#75847a', roughness: 1, metalness: 0 }),
]
const outlineMaterial = new THREE.LineBasicMaterial({ color: '#667268', transparent: true, opacity: 0.78 })
// Shore mask: white blurred land fill minus sharp black land fill = a rim fading
// outward from the coastline. Sampled by the water shader so foam only laps the shore.
// ponytail: canvas blur, not a real distance field — good enough at this rim width
function bakeShoreMask() {
  const polys = [UP_PATH, MITTEN_PATH].map(pathToShapePoints)
  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity
  for (const poly of polys) {
    for (const p of poly) {
      minX = Math.min(minX, p.x); minY = Math.min(minY, p.y)
      maxX = Math.max(maxX, p.x); maxY = Math.max(maxY, p.y)
    }
  }
  const margin = 2.5
  minX -= margin; minY -= margin; maxX += margin; maxY += margin
  const size = 512
  const canvas = document.createElement('canvas')
  canvas.width = canvas.height = size
  const ctx = canvas.getContext('2d')
  ctx.fillStyle = '#000'
  ctx.fillRect(0, 0, size, size)
  const trace = (poly) => {
    ctx.beginPath()
    poly.forEach((p, i) => {
      const x = ((p.x - minX) / (maxX - minX)) * size
      const y = size - ((p.y - minY) / (maxY - minY)) * size
      i ? ctx.lineTo(x, y) : ctx.moveTo(x, y)
    })
    ctx.closePath()
  }
  ctx.fillStyle = '#fff'
  ctx.filter = 'blur(14px)'
  for (const poly of polys) { trace(poly); ctx.fill() }
  ctx.filter = 'none'
  ctx.fillStyle = '#000'
  for (const poly of polys) { trace(poly); ctx.fill() }
  return {
    texture: new THREE.CanvasTexture(canvas),
    min: new THREE.Vector2(minX, minY),
    range: new THREE.Vector2(maxX - minX, maxY - minY),
  }
}
const shoreMask = bakeShoreMask()

// stylized flat-shaded water: two-tone swell + foam lapping the shoreline, shared grass uTime drives it
const waterMaterial = new THREE.ShaderMaterial({
  uniforms: {
    uTime: grassUniforms.uTime,
    uShore: { value: shoreMask.texture },
    uShoreMin: { value: shoreMask.min },
    uShoreRange: { value: shoreMask.range },
    uWaterA: { value: new THREE.Color('#91aece') },
    uWaterB: { value: new THREE.Color('#1d70b4') },
  },
  vertexShader: /* glsl */ `
    uniform float uTime;
    varying vec2 vP;
    void main() {
      vP = position.xy;
      vec3 p = position;
      // plane is rotated -PI/2, local z is world up — very slight bob, stays under the land at y=0
      p.z += (sin(position.x * 0.9 + uTime * 0.4) + sin(position.y * 1.1 - uTime * 0.32)) * 0.012;
      gl_Position = projectionMatrix * modelViewMatrix * vec4(p, 1.0);
    }
  `,
  fragmentShader: /* glsl */ `
    uniform float uTime;
    uniform sampler2D uShore;
    uniform vec2 uShoreMin;
    uniform vec2 uShoreRange;
    uniform vec3 uWaterA;
    uniform vec3 uWaterB;
    varying vec2 vP;
    float hash(vec2 q) { return fract(sin(dot(q, vec2(127.1, 311.7))) * 43758.5453); }
    float vnoise(vec2 q) {
      vec2 i = floor(q);
      vec2 f = fract(q);
      vec2 u = f * f * (3.0 - 2.0 * f);
      return mix(mix(hash(i), hash(i + vec2(1.0, 0.0)), u.x),
                 mix(hash(i + vec2(0.0, 1.0)), hash(i + vec2(1.0, 1.0)), u.x), u.y);
    }
    float fbm(vec2 q) {
      float v = 0.0;
      float a = 0.5;
      for (int i = 0; i < 3; i++) { v += a * vnoise(q); q *= 2.1; a *= 0.5; }
      return v;
    }
    void main() {
      vec2 p = vP;
      // slow-drifting fbm samples the A→B blue gradient (leva "water" folder)
      float n = fbm(p * 0.16 + vec2(uTime * 0.03, -uTime * 0.02));
      vec3 col = mix(uWaterA, uWaterB, smoothstep(0.2, 0.8, n));
      // ripple sheen dialed way down — a whisper of movement, no gloss
      float r1 = sin(p.x * 2.2 + uTime * 0.5 + sin(p.y * 1.8 + uTime * 0.3) * 1.4);
      float r2 = sin(p.y * 2.6 - uTime * 0.4 + sin(p.x * 2.0 - uTime * 0.25) * 1.3);
      col = mix(col, vec3(0.44, 0.49, 0.53), smoothstep(0.75, 1.0, r1 * 0.5 + r2 * 0.5) * 0.12);
      // faint survey grid under the surface (~7% opacity)
      vec2 g = abs(fract(p / 2.4) - 0.5);
      float grid = 1.0 - smoothstep(0.012, 0.03, min(g.x, g.y));
      col = mix(col, vec3(0.78, 0.83, 0.87), grid * 0.02);
      // shore mask ramps ~0.5 at the waterline down to 0 offshore — a distance proxy
      float shore = texture2D(uShore, (p - uShoreMin) / uShoreRange).r;
      // darken toward the coastline so the cream landmass silhouette reads harder
      col *= 1.0 - smoothstep(0.04, 0.42, shore) * 0.28;
      // lapping bands: thin clean rings traveling toward land
      float band = sin(shore * 28.0 - uTime * 1.1 + sin(p.x * 1.6 + p.y * 1.4) * 0.25);
      float foam = smoothstep(0.86, 0.97, band) * smoothstep(0.03, 0.3, shore) * 0.5;
      // narrow wash right at the waterline
      foam += smoothstep(0.42, 0.5, shore) * 0.6;
      col = mix(col, vec3(0.88, 0.91, 0.93), min(foam, 1.0) * 0.7);
      gl_FragColor = vec4(col, 1.0);
    }
  `,
})
const cityMaterial = new THREE.MeshStandardMaterial({ color: '#7c8986', roughness: 0.9 })
const treeMaterial = new THREE.MeshStandardMaterial({ color: '#748769', roughness: 1 })
const DESTINATION_POSITIONS = {
  // inland of the SE tip — previous spot sat slightly offshore and missed land hits
  city: new THREE.Vector3(4.9, 0, 4.15),
  meadow: new THREE.Vector3(1.15, 0, -0.68),
  // west of Detroit, verified on-polygon with >=0.6 inland margin
  annarbor: new THREE.Vector3(2.9, 0, 3.6),
}

// per-destination marker palette (hover light / area glow / pulse ring / pin body+emissive)
const MARKER_COLORS = {
  city: { light: '#8fc5d2', glow: '#20606f', pulse: '#1d4d59', pin: '#4d7580', pinEmissive: '#2e7381' },
  meadow: { light: '#b8d69e', glow: '#42663a', pulse: '#3d5a36', pin: '#6f8b65', pinEmissive: '#4e7040' },
  annarbor: { light: '#ffe28a', glow: '#8a6d1a', pulse: '#8a6d1a', pin: '#ffcb05', pinEmissive: '#b08b00' },
}
// tilt axis ⟂ to the corner view diagonal — tips the map plane toward the iso camera
const TILT_AXIS = new THREE.Vector3(1, 0, -1).normalize()
const Y_AXIS = new THREE.Vector3(0, 1, 0)
const focusPosition = new THREE.Vector3()
const _parentQ = new THREE.Quaternion()
const _camQ = new THREE.Quaternion()
// Scenes FBO pass is priority 0.5 — run just before so portal billboards stick
const BEFORE_FBO = 0.4
const NO_RAYCAST = () => null

function buildPinGeometry() {
  const shape = new THREE.Shape()
  shape.moveTo(0, -0.48)
  shape.bezierCurveTo(-0.07, -0.37, -0.36, -0.12, -0.36, 0.16)
  shape.bezierCurveTo(-0.36, 0.4, -0.2, 0.58, 0, 0.58)
  shape.bezierCurveTo(0.2, 0.58, 0.36, 0.4, 0.36, 0.16)
  shape.bezierCurveTo(0.36, -0.12, 0.07, -0.37, 0, -0.48)

  const geometry = new THREE.ExtrudeGeometry(shape, {
    depth: 0.1,
    bevelEnabled: true,
    bevelSegments: 3,
    bevelSize: 0.025,
    bevelThickness: 0.025,
    curveSegments: 16,
  })
  geometry.translate(0, 0, -0.05)
  geometry.computeVertexNormals()
  return geometry
}

const pinGeometry = buildPinGeometry()
const pinCoreGeometry = new THREE.CircleGeometry(0.115, 32)

// HUD buttons set this so map pins share the same highlight state.
let hubHoverSetter = null
// eslint-disable-next-line react-refresh/only-export-components -- dev-only HMR granularity
export function hoverHubDestination(id) {
  hubHoverSetter?.(id)
}

const CITY_BLOCKS = [
  [-0.42, -0.22, 0.2, 0.42], [-0.14, -0.3, 0.16, 0.65], [0.14, -0.25, 0.2, 0.5],
  [0.39, -0.12, 0.15, 0.34], [-0.3, 0.15, 0.18, 0.3], [0.02, 0.18, 0.22, 0.44],
  [0.33, 0.22, 0.17, 0.27],
]

const NORTH_TREES = [
  [-0.42, -0.16, 0.38], [-0.18, 0.18, 0.48],
  [0.34, 0.12, 0.5], [0.48, -0.22, 0.34], [-0.48, 0.28, 0.31],
]

const MAP_TREES = [
  ...scatterTrees(pathToShapePoints(UP_PATH), 30, 7, 0.32, 0.52),
  ...scatterTrees(pathToShapePoints(MITTEN_PATH), 24, 11, 0.3, 0.46),
]

// One unit cone, uniformly scaled per instance (radius = 0.26 × height holds
// under uniform scale) — one draw call instead of a mesh per tree.
const unitTreeGeometry = new THREE.ConeGeometry(0.26, 1, 7)
function makeTreeInstances(trees) {
  const mesh = new THREE.InstancedMesh(unitTreeGeometry, treeMaterial, trees.length)
  const m = new THREE.Matrix4()
  trees.forEach(([x, z, height], i) => {
    m.makeScale(height, height, height).setPosition(x, LAND_TOP + height / 2, z)
    mesh.setMatrixAt(i, m)
  })
  mesh.raycast = NO_RAYCAST
  mesh.frustumCulled = false // instance bounds aren't tracked; map fills the view
  mesh.castShadow = true // static casters — the on-demand shadow map covers them for free
  return mesh
}

// contact blob under each marker (Birds.jsx pattern) — grounds the preview on the land top
const blobCanvas = document.createElement('canvas')
blobCanvas.width = blobCanvas.height = 64
const blobCtx = blobCanvas.getContext('2d')
const blobGrd = blobCtx.createRadialGradient(32, 32, 0, 32, 32, 32)
blobGrd.addColorStop(0, 'rgba(30,36,28,0.42)')
blobGrd.addColorStop(0.5, 'rgba(30,36,28,0.2)')
blobGrd.addColorStop(1, 'rgba(30,36,28,0)')
blobCtx.fillStyle = blobGrd
blobCtx.fillRect(0, 0, 64, 64)
const blobTexture = new THREE.CanvasTexture(blobCanvas)
const blobGeometry = new THREE.CircleGeometry(1.1, 32)
const mapTreesMesh = makeTreeInstances(MAP_TREES)
const northTreesMesh = makeTreeInstances(NORTH_TREES)

function CityPreview() {
  return (
    <group>
      {CITY_BLOCKS.map(([x, z, width, height], index) => (
        <mesh key={index} position={[x, LAND_TOP + height / 2, z]} material={cityMaterial} castShadow raycast={NO_RAYCAST}>
          <boxGeometry args={[width, height, width * 1.25]} />
        </mesh>
      ))}
    </group>
  )
}

// Michigan block-M flag: maize M (m.png) composited over the blue field in
// the fragment, cloth waved in the vertex off the shared grass uTime — no
// useFrame. Hoist (uv.x=0) is pinned to the pole, amplitude grows to the fly.
const flagTexture = new THREE.TextureLoader().load('/m.png')
flagTexture.colorSpace = THREE.SRGBColorSpace
const flagMaterial = new THREE.ShaderMaterial({
  uniforms: {
    uTime: grassUniforms.uTime,
    uMap: { value: flagTexture },
    uSpeed: { value: 1 },
    // 0..1 amplitude-only excitement (Block M formation). Safe to animate:
    // amplitude has no phase term, unlike uSpeed whose ramp teleports the
    // cloth (phase = uTime * uSpeed with a large uTime).
    uExcite: { value: 0 },
  },
  side: THREE.DoubleSide,
  vertexShader: /* glsl */ `
    uniform float uTime;
    uniform float uSpeed;
    uniform float uExcite;
    varying vec2 vUv;
    varying float vShade;
    void main() {
      vUv = uv;
      vec3 p = position;
      float t = uTime * 4.6 * uSpeed;
      float phase = uv.x * 7.0 - t;
      float wave = sin(phase) * 0.7 + sin(uv.x * 12.0 - t * 1.6 + 1.7) * 0.3;
      p.z += wave * 0.085 * (1.0 + uExcite * 0.45) * uv.x;
      // fast flutter ripple at CONSTANT speed — phase-continuous while
      // uExcite fades in/out
      p.z += sin(uv.x * 16.0 - uTime * 7.0) * 0.015 * uExcite * uv.x;
      p.y += sin(uv.x * 6.0 - t * 0.9) * 0.02 * uv.x;
      // fake cloth shading off the wave slope
      vShade = cos(phase) * uv.x;
      gl_Position = projectionMatrix * modelViewMatrix * vec4(p, 1.0);
    }
  `,
  fragmentShader: /* glsl */ `
    uniform sampler2D uMap;
    varying vec2 vUv;
    varying float vShade;
    void main() {
      // shrink the M toward the cloth center; outside the window is field blue
      vec2 uv2 = (vUv - 0.5) * 1.55 + 0.5;
      vec4 tex = texture2D(uMap, uv2);
      float inside = step(abs(uv2.x - 0.5), 0.5) * step(abs(uv2.y - 0.5), 0.5);
      vec3 col = mix(vec3(0.0, 0.055, 0.16), tex.rgb, tex.a * inside);
      col *= 0.86 + vShade * 0.2;
      gl_FragColor = vec4(col, 1.0);
    }
  `,
})
// calm clone for the big Ann Arbor flag — slower wave reads gentle at 4x size.
// clone() deep-copies uniforms, so re-point uTime/uMap at the shared objects.
const calmFlagMaterial = flagMaterial.clone()
calmFlagMaterial.uniforms.uTime = grassUniforms.uTime
calmFlagMaterial.uniforms.uMap.value = flagTexture
calmFlagMaterial.uniforms.uSpeed.value = 0.42

const flagGeometry = new THREE.PlaneGeometry(0.55, 0.36, 24, 12)
flagGeometry.translate(0.275, 0, 0) // hoist edge at x=0, on the pole
// standard-lit: the map has a full rig; AnnArbor.jsx mounts a small flag-only
// rig (its baked GLB materials are all unlit basic, so lights touch only these)
const poleMaterial = new THREE.MeshStandardMaterial({ color: '#b9bcc0', roughness: 0.35, metalness: 0.55 })
const finialMaterial = new THREE.MeshStandardMaterial({ color: '#d9b23a', roughness: 0.3, metalness: 0.65 })

export function MichiganFlag({ position = [0.45, LAND_TOP, 0.06], scale = 0.7, yaw = -0.12, material = flagMaterial }) {
  return (
    // slight yaw so the cloth reads face-on from the iso corner view; offset
    // is screen-right of the pin under the iso camera (world (1,0,-1)/√2
    // rotated into the angle-0.91 land frame), pole taller so the cloth
    // rides up beside the pin instead of under it
    <group position={position} rotation-y={yaw} scale={scale}>
      <mesh position-y={0.6} material={poleMaterial} castShadow raycast={NO_RAYCAST}>
        <cylinderGeometry args={[0.014, 0.022, 1.2, 8]} />
      </mesh>
      <mesh position-y={1.21} material={finialMaterial} raycast={NO_RAYCAST}>
        <sphereGeometry args={[0.032, 12, 8]} />
      </mesh>
      {/* no castShadow: shadow maps are on-demand, a waving shadow would freeze */}
      <mesh geometry={flagGeometry} material={material} position={[0.018, 0.99, 0]} raycast={NO_RAYCAST} />
    </group>
  )
}
// eslint-disable-next-line react-refresh/only-export-components -- dev-only HMR granularity
export { calmFlagMaterial }

function faceCamera(group, camera, yaw = 0) {
  // ponytail: billboard before the FBO pass — default useFrame runs too late / onBeforeRender is unreliable here
  if (!group?.parent) return
  group.parent.updateWorldMatrix(true, false)
  group.parent.getWorldQuaternion(_parentQ)
  camera.getWorldQuaternion(_camQ)
  group.quaternion.copy(_parentQ).invert().multiply(_camQ)
  if (yaw) group.rotateY(yaw)
  group.updateMatrixWorld()
}

// Touch screens never hover, so the labels would rest dim and small forever —
// hold them at full contrast and scale them up so they read on a phone.
const TOUCH = window.matchMedia('(hover: none)').matches
const LABEL_REST = TOUCH ? 1 : 0
const LABEL_SCALE = TOUCH ? 1.5 : 1

function DestinationMarker({ id, label, position, highlighted, pinAngle = 0 }) {
  const hoverAmount = useRef(0)
  const preview = useRef(null)
  const pointLight = useRef(null)
  const areaGlow = useRef(null)
  const areaGlowMaterial = useRef(null)
  const pulse = useRef(null)
  const pulseMaterial = useRef(null)
  const pinBillboard = useRef(null)
  const pinMaterial = useRef(null)
  const pinCore = useRef(null)
  const labelPanel = useRef(null)
  const labelMaterial = useRef(null)
  const labelText = useRef(null)
  const blobMaterial = useRef(null)

  useFrame(({ clock, camera, gl }, rawDt) => {
    if (!sceneRendering('map')) return
    faceCamera(pinBillboard.current, camera, pinAngle)

    const dt = Math.min(rawDt, 0.05)
    hoverAmount.current = THREE.MathUtils.damp(
      hoverAmount.current,
      highlighted ? 1 : 0,
      highlighted ? 9.5 : 7,
      dt,
    )
    // the preview (a shadow caster) scales with hover; shadow maps are
    // on-demand, so re-arm while the damp is still settling
    if (Math.abs(hoverAmount.current - (highlighted ? 1 : 0)) > 0.001) gl.shadowMap.needsUpdate = true
    const hover = THREE.MathUtils.smoothstep(hoverAmount.current, 0, 1)
    const wave = Math.sin(clock.elapsedTime * 2.6)
    const pulseWave = (wave + 1) * 0.5

    if (preview.current) preview.current.scale.setScalar(1 + hover * 0.16)
    if (pointLight.current) pointLight.current.intensity = hover * 11
    if (areaGlow.current) areaGlow.current.scale.setScalar(0.82 + hover * 0.18)
    if (areaGlowMaterial.current) areaGlowMaterial.current.opacity = 0.018 + hover * 0.35
    if (blobMaterial.current) blobMaterial.current.opacity = 0.55 + hover * 0.3
    if (pulse.current) {
      // idle ring is near-static; the pulse animation wakes on hover
      const scale = 1 + pulseWave * (0.02 + hover * 0.2)
      pulse.current.scale.setScalar(scale)
    }
    if (pulseMaterial.current) {
      pulseMaterial.current.opacity = 0.16 + hover * 0.55 - pulseWave * hover * 0.15
    }
    if (pinBillboard.current) {
      pinBillboard.current.position.y = 1.12 + hover * 0.24 + wave * (0.006 + hover * 0.012)
      pinBillboard.current.scale.setScalar(0.8 + hover * 0.18)
    }
    if (pinMaterial.current) pinMaterial.current.emissiveIntensity = hover * 0.48
    if (pinCore.current) pinCore.current.scale.setScalar(1 + hover * 0.13)
    const lift = Math.max(hover, LABEL_REST)
    if (labelPanel.current) {
      labelPanel.current.position.y = 0.8 + hover * 0.05
      labelPanel.current.scale.setScalar((1 + hover * 0.04) * LABEL_SCALE)
    }
    if (labelMaterial.current) labelMaterial.current.opacity = 0.5 + lift * 0.5
    if (labelText.current?.material) labelText.current.material.opacity = 0.55 + lift * 0.45
  }, BEFORE_FBO)

  return (
    <group position={position}>
      <group ref={preview}>
        {id === 'city' ? <CityPreview /> : id === 'annarbor' ? <MichiganFlag /> : <primitive object={northTreesMesh} />}
      </group>
      <pointLight
        ref={pointLight}
        position={[0, 1.45, 0]}
        color={MARKER_COLORS[id].light}
        intensity={0}
        distance={3.8}
        decay={2}
      />
      {/* sized to the visible marker (preview footprint, pin, label) so hover matches what you see */}
      <mesh
        position-y={1.1}
        userData={{ destination: id }}
      >
        <cylinderGeometry args={[0.95, 0.95, 2.5, 12]} />
        <meshBasicMaterial colorWrite={false} depthWrite={false} />
      </mesh>
      <mesh
        rotation-x={-Math.PI / 2}
        position-y={0.402}
        geometry={blobGeometry}
        raycast={NO_RAYCAST}
      >
        <meshBasicMaterial
          ref={blobMaterial}
          map={blobTexture}
          transparent
          opacity={0.55}
          depthWrite={false}
        />
      </mesh>
      <mesh
        ref={areaGlow}
        rotation-x={-Math.PI / 2}
        position-y={0.405}
        raycast={NO_RAYCAST}
      >
        <circleGeometry args={[1.55, 48]} />
        <meshBasicMaterial
          ref={areaGlowMaterial}
          color={MARKER_COLORS[id].glow}
          transparent
          opacity={0.018}
          depthWrite={false}
          toneMapped={false}
        />
      </mesh>
      <mesh ref={pulse} rotation-x={-Math.PI / 2} position-y={0.41} raycast={NO_RAYCAST}>
        <ringGeometry args={[0.44, 0.49, 32]} />
        <meshBasicMaterial
          ref={pulseMaterial}
          color={MARKER_COLORS[id].pulse}
          transparent
          opacity={0.16}
          depthWrite={false}
          toneMapped={false}
        />
      </mesh>
      <group ref={pinBillboard} position-y={1.12} scale={0.8}>
        <mesh geometry={pinGeometry} raycast={NO_RAYCAST}>
          <meshStandardMaterial
            ref={pinMaterial}
            color={MARKER_COLORS[id].pin}
            emissive={MARKER_COLORS[id].pinEmissive}
            emissiveIntensity={0}
            roughness={0.58}
            metalness={0.02}
          />
        </mesh>
        <mesh
          ref={pinCore}
          geometry={pinCoreGeometry}
          position={[0, 0.16, 0.087]}
          raycast={NO_RAYCAST}
        >
          <meshBasicMaterial color="#f6f2e6" toneMapped={false} />
        </mesh>
        <group ref={labelPanel} position={[0, 0.8, 0]}>
          <mesh position-z={0.025} raycast={NO_RAYCAST}>
            <planeGeometry args={[1.26, 0.42]} />
            <meshBasicMaterial
              ref={labelMaterial}
              color="#f4f0e3"
              transparent
              opacity={0.5}
              toneMapped={false}
            />
          </mesh>
          <Text
            ref={labelText}
            position-z={0.055}
            fontSize={0.18}
            letterSpacing={0.07}
            color="#26312d"
            anchorX="center"
            anchorY="middle"
            material-toneMapped={false}
            raycast={NO_RAYCAST}
          >
            {label.toUpperCase()}
          </Text>
        </group>
      </group>
    </group>
  )
}

export function MichiganHub({ onSelect, transition }) {
  const mapRoot = useRef(null)
  const [hoveredRegion, setHoveredRegion] = useState(null)
  useClickCursor(Boolean(hoveredRegion))

  // HUD destination buttons call this so the matching pin lights up too.
  useEffect(() => {
    hubHoverSetter = setHoveredRegion
    return () => { hubHoverSetter = null }
  }, [])

  const { tilt, zoom, angle, pinAngle } = useControls('map', {
    tilt: { value: 0, min: 0, max: 1.2, step: 0.01 },
    zoom: { value: 2, min: 0.4, max: 2, step: 0.01 },
    angle: { value: 0.91, min: -Math.PI / 2, max: Math.PI / 2, step: 0.01 },
    pinAngle: { value: 0.77, min: -Math.PI, max: Math.PI, step: 0.01, label: 'pin angle' },
  })
  const mapTilt = new THREE.Quaternion().setFromAxisAngle(TILT_AXIS, tilt)

  // transient writes to the module-singleton material — no re-render
  useControls('water', {
    deepBlue: {
      value: '#91aece', label: 'deep',
      onChange: (v) => { waterMaterial.uniforms.uWaterA.value.set(v) },
    },
    lightBlue: {
      value: '#1d70b4', label: 'light',
      onChange: (v) => { waterMaterial.uniforms.uWaterB.value.set(v) },
    },
  }, { collapsed: true })

  useFrame(() => {
    const root = mapRoot.current
    if (!root || !sceneRendering('map')) return

    const eased = transition.p * transition.p * (3 - 2 * transition.p)
    let destination = null
    let focus = 0
    if (transition.from === 'map' && transition.to !== 'map') {
      destination = transition.to
      focus = eased
    } else if (transition.to === 'map' && transition.from !== 'map') {
      destination = transition.from
      focus = 1 - eased
    }

    const scale = zoom * (1 + focus * 0.9)
    root.scale.setScalar(scale)
    if (destination && DESTINATION_POSITIONS[destination]) {
      focusPosition
        .copy(DESTINATION_POSITIONS[destination])
        .applyAxisAngle(Y_AXIS, angle)
        .multiplyScalar(-scale * focus)
      root.position.set(focusPosition.x, 0, focusPosition.z)
    } else {
      root.position.set(0, 0, 0)
    }
  })

  return (
    <>
      <color attach="background" args={['#d7ddd4']} />
      <ambientLight intensity={2.1} />
      <hemisphereLight args={['#fff9e8', '#6f8178', 1.8]} />
      <directionalLight
        position={[-7, 12, 8]}
        intensity={3.1}
        color="#fff5da"
        castShadow
        shadow-mapSize={[2048, 2048]}
        shadow-camera-left={-8}
        shadow-camera-right={8}
        shadow-camera-top={8}
        shadow-camera-bottom={-8}
      />

      <group quaternion={mapTilt}>
        <group ref={mapRoot}>
          <group rotation-y={angle}>
            {/* inside the angle group so the baked shore mask stays aligned with the land */}
            {/* 120² so its edges stay off-screen at the intro's pulled-back zoom on any
            aspect; shader samples plane-local coords and the shore mask clamps to
            open water, so size is free to grow */}
            <mesh rotation-x={-Math.PI / 2} position-y={-0.12} material={waterMaterial} raycast={NO_RAYCAST}>
              {/* segments only feed a 0.012-unit bob — 32² is visually identical to 96² */}
              <planeGeometry args={[120, 120, 32, 32]} />
            </mesh>
            {landGeometries.map((geometry, index) => (
              <group key={index}>
                {/* land is scenery only — the markers are the sole click targets */}
                <mesh geometry={geometry} material={landMaterials} castShadow receiveShadow raycast={NO_RAYCAST} />
                <lineSegments geometry={landOutlines[index]} material={outlineMaterial} position-y={0.006} raycast={NO_RAYCAST} />
              </group>
            ))}

            <primitive object={mapTreesMesh} />

            <group
              // markers live in the map portal but R3F's event raycast still
              // hits them from inside a diorama (shared camera/event root), so
              // gate on the map being the current destination — you have to go
              // back to the map to pick a new scene
              onClick={(event) => {
                // gate BEFORE stopPropagation: while a diorama shows, a hidden
                // marker cylinder nearer along the ray must not swallow clicks
                // meant for in-scene targets (e.g. Comerica Park)
                if (transition.to !== 'map') return
                event.stopPropagation()
                onSelect(event.object.userData.destination)
              }}
              onPointerMove={(event) => {
                if (transition.to !== 'map') return
                event.stopPropagation()
                setHoveredRegion(event.object.userData.destination)
              }}
              onPointerLeave={(event) => {
                event.stopPropagation()
                setHoveredRegion(null)
              }}
            >
              <DestinationMarker
                id="city"
                label="Detroit"
                position={DESTINATION_POSITIONS.city}
                highlighted={hoveredRegion === 'city'}
                pinAngle={pinAngle}
              />
              <DestinationMarker
                id="meadow"
                label="Up North"
                position={DESTINATION_POSITIONS.meadow}
                highlighted={hoveredRegion === 'meadow'}
                pinAngle={pinAngle}
              />
              <DestinationMarker
                id="annarbor"
                label="Ann Arbor"
                position={DESTINATION_POSITIONS.annarbor}
                highlighted={hoveredRegion === 'annarbor'}
                pinAngle={pinAngle}
              />
            </group>
          </group>
        </group>
      </group>
    </>
  )
}
