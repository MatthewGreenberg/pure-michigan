import { useRef, useState } from 'react'
import { useFrame } from '@react-three/fiber'
import { useControls } from 'leva'
import * as THREE from 'three'
import { uniforms as grassUniforms } from './grass/material.js'

const BASE_FIELD_SIZE = 46
const BASE_CLUSTERS = 28
const CLUSTER_DENSITY = BASE_CLUSTERS / (BASE_FIELD_SIZE * BASE_FIELD_SIZE)
const MAX_CLUSTERS = 340
const PUFFS_PER_CLUSTER = 7
const MAX_PUFFS = MAX_CLUSTERS * PUFFS_PER_CLUSTER
const NO_RAYCAST = () => null
const transform = new THREE.Object3D()

function mulberry32(seed) {
  let state = seed >>> 0
  return () => {
    state += 0x6d2b79f5
    let value = state
    value = Math.imul(value ^ (value >>> 15), value | 1)
    value ^= value + Math.imul(value ^ (value >>> 7), value | 61)
    return ((value ^ (value >>> 14)) >>> 0) / 4294967296
  }
}

function wrap(value, span) {
  return THREE.MathUtils.euclideanModulo(value + span / 2, span) - span / 2
}

function buildClouds() {
  const random = mulberry32(0x504f4e59)
  const anchors = [
    [-0.12, -0.08],
    [0.09, 0.13],
    [0.17, -0.14],
    [-0.18, 0.15],
  ]
  const clouds = []

  for (let cluster = 0; cluster < MAX_CLUSTERS; cluster++) {
    const anchor = anchors[cluster] || [
      random() - 0.5,
      random() - 0.5,
    ]
    const clusterScale = 0.78 + random() * 0.58
    const puffs = []

    // A large center and overlapping satellites create one readable cloud
    // silhouette instead of a field of unrelated spheres.
    for (let puff = 0; puff < PUFFS_PER_CLUSTER; puff++) {
      const angle = puff === 0 ? 0 : ((puff - 1) / (PUFFS_PER_CLUSTER - 1)) * Math.PI * 2
      const radius = puff === 0 ? 0 : 0.72 + random() * 0.52
      const width = (puff === 0 ? 1.65 : 1.05 + random() * 0.5) * clusterScale
      puffs.push({
        x: Math.cos(angle) * radius * 1.55 * clusterScale,
        y: puff === 0 ? 0.42 : random() * 0.62,
        z: Math.sin(angle) * radius * 0.92 * clusterScale,
        width,
        height: (puff === 0 ? 1.1 : 0.72 + random() * 0.42) * clusterScale,
        depth: (0.88 + random() * 0.46) * clusterScale,
        rotation: random() * Math.PI,
      })
    }

    clouds.push({
      x: anchor[0],
      z: anchor[1],
      phase: random() * Math.PI * 2,
      drift: 0.82 + random() * 0.34,
      puffs,
    })
  }

  return clouds
}

const CLOUDS = buildClouds()

// Cel shading baked into per-face vertex colors (3-band ramp by face-normal
// height) so clouds are unlit — no light rig to fight each portal scene's own
// lighting (the map has a bright rig, the city has none). Puffs only rotate
// about Y, which preserves normal.y, so the bake holds for every instance.
function tintCloudGeometry(geometry, topColor, undersideColor) {
  const position = geometry.attributes.position
  const colors = geometry.attributes.color?.array || new Float32Array(position.count * 3)
  const top = new THREE.Color(topColor)
  const under = new THREE.Color(undersideColor)
  const a = new THREE.Vector3()
  const ab = new THREE.Vector3()
  const ac = new THREE.Vector3()
  const face = new THREE.Color()

  for (let i = 0; i < position.count; i += 3) {
    a.fromBufferAttribute(position, i)
    ab.fromBufferAttribute(position, i + 1).sub(a)
    ac.fromBufferAttribute(position, i + 2).sub(a)
    const ny = ab.cross(ac).normalize().y
    const band = Math.round(THREE.MathUtils.smoothstep(ny, -0.65, 0.9) * 2) / 2
    face.copy(under).lerp(top, band)
    for (let vertex = i; vertex < i + 3; vertex++) {
      colors[vertex * 3] = face.r
      colors[vertex * 3 + 1] = face.g
      colors[vertex * 3 + 2] = face.b
    }
  }

  const attribute = geometry.attributes.color || new THREE.BufferAttribute(colors, 3)
  attribute.needsUpdate = true
  geometry.setAttribute('color', attribute)
  return geometry
}

// IcosahedronGeometry is non-indexed, so per-face colors need no toNonIndexed.
const warmGeometry = tintCloudGeometry(new THREE.IcosahedronGeometry(1, 1), '#fffaf0', '#f8f8f8')
const steelGeometry = tintCloudGeometry(new THREE.IcosahedronGeometry(1, 1), '#f4f8fb', '#76878f')
const TINTS = { warm: warmGeometry, steel: steelGeometry }
const warmTint = { top: '#fffaf0', under: '#f8f8f8' }

const cloudMaterial = new THREE.MeshBasicMaterial({
  vertexColors: true,
  transparent: true,
  opacity: 0.52,
  depthTest: false,
  depthWrite: true,
})

// The map hub's drifting instanced cumulus deck (leva-driven via CloudCover).
function CloudLayer({
  tint = 'warm',
  altitude = 5.6,
  amount = 0.37,
  areaWidth = 130,
  areaLength = 46,
  opacity = 0.52,
  size = 0.77,
  puffiness = 1.01,
  speed = 1,
  direction = -161,
  enterSeconds = 5.6,
  exitSeconds = 4,
  transition,
}) {
  const mesh = useRef(null)
  const elapsed = useRef(0)
  const intro = useRef(0)

  // Runs at 0.4 (before the Scenes FBO pass at 0.5) so matrices are current
  // in the same frame's portal renders.
  useFrame((_, rawDt) => {
    const cloudMesh = mesh.current
    if (!cloudMesh) return

    const dt = Math.min(rawDt, 0.05)
    elapsed.current = (elapsed.current + dt) % 4096
    const radians = THREE.MathUtils.degToRad(direction)
    const windX = Math.cos(radians)
    const windZ = Math.sin(radians)
    const visibleClusters = Math.min(
      MAX_CLUSTERS,
      Math.round(amount * CLUSTER_DENSITY * areaWidth * areaLength),
    )
    const time = elapsed.current * speed
    let instance = 0

    // Keep the initial deck behind the loader's stratus blanket, then use the
    // same entrance choreography whenever the map returns. The layer stays
    // mounted and its drift clock keeps running while hidden.
    const toMap = !transition || transition.to === 'map'
    const loaderReady = typeof window === 'undefined' || window.__mittenDone
    const shouldShow = toMap && loaderReady
    intro.current = THREE.MathUtils.clamp(
      intro.current + dt * (shouldShow ? 1 / enterSeconds : -1 / exitSeconds),
      0,
      1,
    )
    // Only opacity participates in navigation. Cloud positions, rotations,
    // scales, and silhouettes remain on their ordinary ambient-drift path.
    const introP = 0.5 - Math.cos(intro.current * Math.PI) * 0.5
    cloudMaterial.opacity = opacity * introP

    for (let cluster = 0; cluster < visibleClusters; cluster++) {
      const cloud = CLOUDS[cluster]
      const distance = time * 0.42 * cloud.drift
      const x = wrap(cloud.x * areaWidth + windX * distance, areaWidth)
      const z = wrap(cloud.z * areaLength + windZ * distance, areaLength)
      const bob = Math.sin(time * 0.34 + cloud.phase) * 0.09

      for (const puff of cloud.puffs) {
        transform.position.set(
          x + puff.x * size,
          altitude + (puff.y + bob) * puffiness * size,
          z + puff.z * size,
        )
        transform.rotation.set(0, puff.rotation, 0)
        transform.scale.set(
          puff.width * size,
          puff.height * puffiness * size,
          puff.depth * size,
        )
        transform.updateMatrix()
        cloudMesh.setMatrixAt(instance, transform.matrix)
        instance++
      }
    }

    cloudMesh.count = instance
    cloudMesh.instanceMatrix.needsUpdate = true
  }, 0.4)

  return (
    <instancedMesh
      ref={mesh}
      args={[TINTS[tint], cloudMaterial, MAX_PUFFS]}
      renderOrder={10000}
      frustumCulled={false}
      raycast={NO_RAYCAST}
    />
  )
}

// Flat shader stratus for the dioramas: one transparent horizontal plane,
// wispy fbm streaks stretched along the wind, alpha-only — no volume, no
// lights, no frame loop (rides the shared grass uTime like Ocean/river).
function makeCloudSheetMaterial({ color, shade, cover, opacity, directionDeg, speed, scaleAlong, scaleAcross, soft }) {
  const radians = THREE.MathUtils.degToRad(directionDeg)
  const c = Math.cos(radians)
  const s = Math.sin(radians)
  return new THREE.ShaderMaterial({
    transparent: true,
    depthWrite: false,
    uniforms: {
      uTime: grassUniforms.uTime,
      uColor: { value: new THREE.Color(color) },
      uShade: { value: new THREE.Color(shade) },
      uCover: { value: cover },
      uOpacity: { value: opacity },
      uDir: { value: new THREE.Vector2(c, s) },
      uSpeed: { value: speed },
      uScale: { value: new THREE.Vector2(scaleAlong, scaleAcross) },
      uSoft: { value: soft },
    },
    vertexShader: /* glsl */ `
      varying vec2 vUv;
      varying vec2 vPos;
      void main() {
        vUv = uv;
        vPos = position.xy; // plane-local world units
        gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
      }
    `,
    fragmentShader: /* glsl */ `
      uniform float uTime;
      uniform vec3 uColor;
      uniform vec3 uShade;
      uniform float uCover;
      uniform float uOpacity;
      uniform vec2 uDir;
      uniform float uSpeed;
      uniform vec2 uScale;
      uniform float uSoft;
      varying vec2 vUv;
      varying vec2 vPos;

      float hash(vec2 p) { return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
      float noise(vec2 p) {
        vec2 i = floor(p), f = fract(p);
        f = f * f * (3.0 - 2.0 * f);
        return mix(
          mix(hash(i), hash(i + vec2(1.0, 0.0)), f.x),
          mix(hash(i + vec2(0.0, 1.0)), hash(i + vec2(1.0, 1.0)), f.x),
          f.y
        );
      }
      float fbm(vec2 p) {
        float v = 0.0, a = 0.5;
        for (int i = 0; i < 4; i++) { v += a * noise(p); p *= 2.03; a *= 0.5; }
        return v;
      }

      void main() {
        // rotate into the wind frame, then squash across-wind so features
        // become long streaks; drift upwind over time
        vec2 wind = vec2(dot(vPos, uDir), dot(vPos, vec2(-uDir.y, uDir.x)));
        wind.x -= uTime * uSpeed;
        vec2 q = wind * uScale;
        float n = fbm(q) * 0.78 + fbm(q * 2.9 + vec2(41.3, 13.7) + uTime * 0.008) * 0.22;

        float cloud = smoothstep(1.0 - uCover - uSoft, 1.0 - uCover + uSoft, n);
        // asymmetric falloff: gentle thinning toward the camera (uv.y=0,
        // which also hides the ortho near-clip line crossing the plane),
        // narrow trims on the far-offscreen side edges
        float fade = smoothstep(0.0, 0.12, min(vUv.x, 1.0 - vUv.x))
          * smoothstep(0.0, 0.18, vUv.y)
          * smoothstep(0.0, 0.06, 1.0 - vUv.y);
        // denser cores dim toward the shade tone for a hint of underside
        vec3 col = mix(uColor, uShade, smoothstep(0.45, 1.0, cloud) * 0.5);

        float alpha = cloud * fade * uOpacity;
        if (alpha < 0.004) discard;
        gl_FragColor = vec4(col, alpha);
      }
    `,
  })
}

const SHEETS = {
  warm: makeCloudSheetMaterial({
    color: '#fffdf6', shade: '#ccd6cc', cover: 0.45, opacity: 1, directionDeg: 78, speed: 1.15,
    scaleAlong: 0.06, scaleAcross: 0.15, soft: 0.22,
  }),
  steel: makeCloudSheetMaterial({
    color: '#f2f7fa', shade: '#ffffff', cover: 0.33, opacity: 1, directionDeg: -159, speed: 0.32,
    scaleAlong: 0.1, scaleAcross: 0.24, soft: 0.15,
  }),
}

// Load intro: a dense warm stratus sheet blankets the map; once the loader
// fires mitten-done its coverage burns down to nothing (~1.4s, opacity chased
// out at the tail) and the mesh unmounts for good.
const INTRO_COVER = 1.15 // past the shader's solid point so the blanket starts gapless
const introStratusMaterial = makeCloudSheetMaterial({
  color: '#fffdf6', shade: '#ccd6cc', cover: INTRO_COVER, opacity: 1, directionDeg: 78, speed: 1.15,
  scaleAlong: 0.06, scaleAcross: 0.15, soft: 0.22,
})

function IntroStratus() {
  const [done, setDone] = useState(false)
  useFrame((_, rawDt) => {
    if (done || !window.__mittenDone) return
    const u = introStratusMaterial.uniforms
    u.uCover.value = Math.max(u.uCover.value - (Math.min(rawDt, 0.05) / 1.4) * INTRO_COVER, 0)
    u.uOpacity.value = Math.min(u.uCover.value / 0.2, 1)
    if (u.uCover.value <= 0) setDone(true)
  })
  if (done) return null
  // Bigger than the diorama sheets (the intro camera holds a pulled-back
  // zoom, so more world is on screen): same near edge as the 65-deep sheet
  // (keeps the near-clip crossing inside the uv.y fade), extra depth pushed
  // away from the camera along (-1,0,-1)/√2, still inside the ortho far box.
  return (
    <mesh
      position={[-24.7, 7, -24.7]}
      rotation={[-Math.PI / 2, 0, Math.PI / 4]}
      material={introStratusMaterial}
      renderOrder={9000}
      frustumCulled={false}
      raycast={NO_RAYCAST}
    >
      <planeGeometry args={[240, 110]} />
    </mesh>
  )
}

// Screen-aligned under the fixed iso camera: the extra rotation-z spins the
// plane 45° so its width runs along the screen's horizontal axis (1,0,-1)/√2
// and spans well past both edges at any aspect; depth runs up-screen, pushed
// away from the camera so the whole plane sits inside the ortho near/far box
// (near-clip crosses the layer ~20 units toward the camera; the uv.y fade
// dissolves the clouds before they reach it).
export function CloudSheet({ tint = 'warm', altitude: defaultAltitude = 7.2 }) {
  const material = SHEETS[tint]
  const uniforms = material.uniforms

  // Everything except altitude writes transiently to the sheet's uniforms —
  // no re-render. Values initialize from the tint's preset, so each scene
  // gets its own folder starting where its material is tuned.
  const { altitude } = useControls(
    tint === 'warm' ? 'stratus · up north' : 'stratus · detroit',
    {
      altitude: { value: defaultAltitude, min: 3, max: 14, step: 0.1 },
      cover: {
        value: uniforms.uCover.value, min: 0, max: 1, step: 0.01,
        onChange: (v) => { uniforms.uCover.value = v },
      },
      opacity: {
        value: uniforms.uOpacity.value, min: 0, max: 1, step: 0.01,
        onChange: (v) => { uniforms.uOpacity.value = v },
      },
      softness: {
        value: uniforms.uSoft.value, min: 0.03, max: 0.45, step: 0.01,
        onChange: (v) => { uniforms.uSoft.value = v },
      },
      streakLength: {
        value: uniforms.uScale.value.x, min: 0.02, max: 0.2, step: 0.005, label: 'streak scale ∥',
        onChange: (v) => { uniforms.uScale.value.x = v },
      },
      streakWidth: {
        value: uniforms.uScale.value.y, min: 0.05, max: 0.5, step: 0.005, label: 'streak scale ⊥',
        onChange: (v) => { uniforms.uScale.value.y = v },
      },
      speed: {
        value: uniforms.uSpeed.value, min: 0, max: 2, step: 0.01,
        onChange: (v) => { uniforms.uSpeed.value = v },
      },
      direction: {
        value: Math.round(THREE.MathUtils.radToDeg(Math.atan2(uniforms.uDir.value.y, uniforms.uDir.value.x))),
        min: -180, max: 180, step: 1, label: 'direction °',
        onChange: (v) => {
          const radians = THREE.MathUtils.degToRad(v)
          uniforms.uDir.value.set(Math.cos(radians), Math.sin(radians))
        },
      },
      cloudColor: {
        value: `#${uniforms.uColor.value.getHexString()}`, label: 'cloud color',
        onChange: (v) => { uniforms.uColor.value.set(v) },
      },
      shadeColor: {
        value: `#${uniforms.uShade.value.getHexString()}`, label: 'shade',
        onChange: (v) => { uniforms.uShade.value.set(v) },
      },
    },
    { collapsed: true, order: tint === 'warm' ? 8 : 9 },
  )

  return (
    <mesh
      position={[-8.8, altitude, -8.8]}
      rotation={[-Math.PI / 2, 0, Math.PI / 4]}
      material={SHEETS[tint]}
      renderOrder={9000}
      frustumCulled={false}
      raycast={NO_RAYCAST}
    >
      <planeGeometry args={[170, 65]} />
    </mesh>
  )
}

// The leva-tuned map-hub deck. Color sliders retint the warm geometry.
export function CloudCover({ transition }) {
  const values = useControls('cloud layer', {
    altitude: { value: 5.6, min: 1.5, max: 9.5, step: 0.1 },
    amount: { value: 0.37, min: 0, max: 1, step: 0.01 },
    areaWidth: { value: 130, min: 46, max: 130, step: 2, label: 'area width' },
    areaLength: { value: 46, min: 46, max: 160, step: 2, label: 'area length' },
    opacity: {
      value: 0.52, min: 0.25, max: 1, step: 0.01,
      onChange: (value) => { cloudMaterial.opacity = value },
    },
    size: { value: 0.77, min: 0.45, max: 2.2, step: 0.01 },
    puffiness: { value: 1.01, min: 0.35, max: 2, step: 0.01 },
    speed: { value: 1, min: 0, max: 3, step: 0.01 },
    direction: { value: -161, min: -180, max: 180, step: 1, label: 'direction °' },
    enterSeconds: { value: 5.6, min: 0.8, max: 10, step: 0.05, label: 'fade in duration' },
    exitSeconds: { value: 4, min: 0.6, max: 8, step: 0.05, label: 'fade out duration' },
    cloudColor: {
      value: '#fffaf0', label: 'cloud color',
      onChange: (value) => {
        warmTint.top = value
        tintCloudGeometry(warmGeometry, warmTint.top, warmTint.under)
      },
    },
    undersideColor: {
      value: '#f8f8f8', label: 'underside',
      onChange: (value) => {
        warmTint.under = value
        tintCloudGeometry(warmGeometry, warmTint.top, warmTint.under)
      },
    },
  }, { collapsed: false, order: 7 })

  return (
    <>
      <CloudLayer {...values} transition={transition} />
      <IntroStratus />
    </>
  )
}
