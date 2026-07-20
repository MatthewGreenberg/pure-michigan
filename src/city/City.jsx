import { useEffect } from 'react'
import { useFrame, useThree } from '@react-three/fiber'
import { useGLTF } from '@react-three/drei'
import { KTX2Loader } from 'three/examples/jsm/loaders/KTX2Loader.js'
import * as THREE from 'three'
import { uniforms as grassUniforms } from '../grass/material.js'
import { CityBase } from './CityBase.jsx'

// The whole downtown Detroit diorama is one GLB
// (Tripo buildings + baked ground/river/roads/park, Draco + KTX2 compressed).
// Authored 30x30 with ground at y=0, so scale 0.5 fits the 15x15 slab.
// Lighting is baked into the textures — everything renders unlit.

// Animated Detroit River — replaces the GLB's flat Detroit_River_Blue
// material. Deliberately calmer than src/Ocean.jsx: dark steely blue with
// multi-scale drifting ripple — no crests/sheen/glint/sparkles.
// Shares the grass scene's uTime uniform object, so Grass's existing frame
// loop drives it — no useFrame here.
const riverMaterial = new THREE.ShaderMaterial({
  uniforms: {
    uTime: grassUniforms.uTime,
  },
  vertexShader: /* glsl */ `
    varying vec3 vPos;
    void main() {
      vec4 wp = modelMatrix * vec4(position, 1.0);
      vPos = wp.xyz;
      gl_Position = projectionMatrix * viewMatrix * wp;
    }
  `,
  fragmentShader: /* glsl */ `
    uniform float uTime;
    varying vec3 vPos;

    float hash(vec2 p) {
      return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453);
    }
    float noise(vec2 p) {
      vec2 i = floor(p);
      vec2 f = fract(p);
      f = f * f * (3.0 - 2.0 * f);
      return mix(
        mix(hash(i), hash(i + vec2(1.0, 0.0)), f.x),
        mix(hash(i + vec2(0.0, 1.0)), hash(i + vec2(1.0, 1.0)), f.x),
        f.y
      );
    }

    void main() {
      float t = uTime;
      // GLB is scaled 0.5, so double world xz to keep feature size sane.
      vec2 p = vPos.xz * 2.0;

      // Multi-scale ripple drifting along the river's corner diagonal.
      vec2 flow = vec2(0.7071, -0.7071);
      float ripple = noise(p * 0.55 + flow * t * 0.28)
        + 0.55 * noise(p * 1.3 - flow * t * 0.22)
        + 0.3 * noise(p * 2.8 + flow.yx * t * 0.35);
      ripple /= 1.85;
      // Stretch contrast so the waves read clearly without a bright glint.
      ripple = smoothstep(0.15, 0.85, ripple);
      vec3 water = mix(vec3(0.08, 0.17, 0.30), vec3(0.18, 0.32, 0.48), ripple);

      gl_FragColor = vec4(water, 1.0);
      #include <tonemapping_fragment>
      #include <colorspace_fragment>
    }
  `,
})

// Tiny unlit people — cylinder body + sphere head, two InstancedMeshes sharing
// transforms — clumped around each landmark. Authored in GLB coords (30x30,
// ground y=0), mounted at scale 0.5 like the GLB. Module singleton.
// ponytail: hand-picked clump anchors, no road/river collision checks —
// re-place anchors if the layout ever changes.
const people = (() => {
  // [x, z, radius, count] in authored coords, pulled from the GLB node table
  const clumps = [
    [-5.5, -3.4, 1.1, 12], [-9.6, -2.4, 1.0, 9], [-7.9, -1.6, 1.0, 8], // stadium
    [6.8, -1.7, 1.0, 10], [10.6, -0.9, 0.9, 8], [8.0, -0.6, 0.9, 7],   // arena
    [5.2, -8.2, 1.0, 12], [9.6, -7.7, 0.9, 8], [7.4, -7.4, 0.9, 7],    // RenCen
    [-5.2, 7.4, 0.9, 10], [-9.6, 7.0, 0.9, 8], [-7.5, 6.4, 0.9, 7],    // civic tower
    [5.4, 4.7, 0.9, 10], [9.6, 4.2, 0.9, 8], [7.6, 3.6, 0.9, 7],       // brick block
    [0, 1, 1.3, 14],                                                    // central park
    [-1.2, -4.5, 0.7, 5], [1.2, 4.8, 0.7, 5],                           // sidewalks
  ]
  const shirts = ['#c0504d', '#4f81bd', '#9bbb59', '#8064a2', '#f2c14e', '#e8e4d8', '#4bacc6']
  const n = clumps.reduce((s, c) => s + c[3], 0)
  const bodies = new THREE.InstancedMesh(
    new THREE.CylinderGeometry(0.05, 0.075, 0.26, 6), new THREE.MeshBasicMaterial(), n)
  const heads = new THREE.InstancedMesh(
    new THREE.SphereGeometry(0.075, 8, 6), new THREE.MeshBasicMaterial({ color: '#e6b8a2' }), n)
  // Per-person wander params: each walker paces a small circle around its
  // spawn point (heading = tangent), the rest stand still. ~70% walk.
  const params = []
  for (const [cx, cz, r, count] of clumps) {
    for (let k = 0; k < count; k++) {
      const a = Math.random() * Math.PI * 2
      const d = Math.sqrt(Math.random()) * r
      params.push({
        hx: cx + Math.cos(a) * d,
        hz: cz + Math.sin(a) * d,
        s: 0.85 + Math.random() * 0.3,
        rot: Math.random() * Math.PI * 2,
        wr: Math.random() < 0.7 ? 0.25 + Math.random() * 0.45 : 0,
        w: (0.25 + Math.random() * 0.35) * (Math.random() < 0.5 ? -1 : 1),
        ph: Math.random() * Math.PI * 2,
      })
    }
  }
  params.forEach((_, i) => bodies.setColorAt(i, new THREE.Color(shirts[i % shirts.length])))
  const g = new THREE.Group()
  g.add(bodies, heads)
  return { g, params, bodies, heads }
})()

// Detroit People Mover — elevated guideway loop threading between the
// landmarks, with a two-car train riding it. Authored coords (30x30,
// ground y=0), mounted at scale 0.5 like everything else. Unlit to match
// the baked scene. Module singleton.
// Waypoints verified against the GLB building AABBs (sampled curve clears
// every footprint by >= 0.3 authored units, tile edge by 0.7, river by 0.45):
// riverfront between stadium & RenCen -> the arena/RenCen gap -> east edge ->
// north of the brick block -> around the civic tower -> west edge -> back
// along the river past the stadium.
const TRACK_Y = 1.3
const moverCurve = new THREE.CatmullRomCurve3(
  [
    [0, -10.8], [1.2, -8.6], [2.2, -7.3], [4.5, -6.5], [8, -6.5],
    [12.6, -6.5], [14.0, -4.6], [14.1, -1], [14.1, 3], [14.1, 6.5],
    [13.9, 8.5], [11.6, 11.2], [4, 11.8], [-3.2, 13.4], [-8.5, 13.4],
    [-12.6, 12.7], [-14.1, 9.5], [-14.1, 3], [-14.1, -5], [-13.5, -10.6],
    [-11, -11.6], [-6, -11.4],
  ].map(([x, z]) => new THREE.Vector3(x, TRACK_Y, z)),
  true
)

const mover = (() => {
  const g = new THREE.Group()
  const concrete = new THREE.MeshBasicMaterial({ color: '#8f8c84' })
  g.add(new THREE.Mesh(new THREE.TubeGeometry(moverCurve, 220, 0.08, 6, true), concrete))
  const nP = 36
  const pillars = new THREE.InstancedMesh(
    new THREE.CylinderGeometry(0.055, 0.075, TRACK_Y, 6), concrete, nP)
  const m = new THREE.Matrix4()
  for (let i = 0; i < nP; i++) {
    const p = moverCurve.getPointAt(i / nP)
    pillars.setMatrixAt(i, m.makeTranslation(p.x, TRACK_Y / 2 - 0.08, p.z))
  }
  g.add(pillars)

  // Two cars, DPM-style: white body with rounded ends, dark upper window
  // band, grey roof, teal accent stripe, dark bogie skirt hugging the beam.
  const white = new THREE.MeshBasicMaterial({ color: '#eceff1' })
  const glass = new THREE.MeshBasicMaterial({ color: '#22262c' })
  const roofM = new THREE.MeshBasicMaterial({ color: '#c6c9cb' })
  const teal = new THREE.MeshBasicMaterial({ color: '#1d6e78' })
  const dark = new THREE.MeshBasicMaterial({ color: '#3a3d40' })
  const capGeo = new THREE.CylinderGeometry(0.14, 0.14, 0.22, 12, 1, false, 0, Math.PI)
  const cars = [0, 1].map(() => {
    const car = new THREE.Group() // origin = body center
    const body = new THREE.Mesh(new THREE.BoxGeometry(0.28, 0.22, 0.85), white)
    const nose = new THREE.Mesh(capGeo, white) // rounded front/back ends
    nose.position.z = 0.425
    nose.rotation.y = -Math.PI / 2 // curved half bulges +z
    const tail = nose.clone()
    tail.position.z = -0.425
    tail.rotation.y = Math.PI / 2
    const windows = new THREE.Mesh(new THREE.BoxGeometry(0.285, 0.085, 0.72), glass)
    windows.position.y = 0.04
    const stripe = new THREE.Mesh(new THREE.BoxGeometry(0.287, 0.022, 0.74), teal)
    stripe.position.y = -0.02
    const roof = new THREE.Mesh(new THREE.BoxGeometry(0.26, 0.035, 0.97), roofM)
    roof.position.y = 0.12
    const skirt = new THREE.Mesh(new THREE.BoxGeometry(0.25, 0.08, 0.78), dark)
    skirt.position.y = -0.14
    car.add(body, nose, tail, windows, stripe, roof, skirt)
    g.add(car)
    return car
  })
  return { g, cars }
})()

const _tan = new THREE.Vector3()

function PeopleMover() {
  useFrame(({ clock }) => {
    const t = clock.elapsedTime / 70 // longer perimeter loop, ~70s per lap
    mover.cars.forEach((car, i) => {
      const u = (t + i * 0.0135) % 1
      moverCurve.getPointAt(u, car.position)
      car.position.y += 0.26 // tube top + skirt: body center above the rail
      moverCurve.getTangentAt(u, _tan)
      // parent is a pure uniform scale at the origin, so the world-space
      // lookAt target is just (local position + tangent) * 0.5
      _tan.add(car.position).multiplyScalar(0.5)
      car.lookAt(_tan)
    })
  })
  return <primitive object={mover.g} scale={0.5} />
}

const _m = new THREE.Matrix4()
const _q = new THREE.Quaternion()
const _p = new THREE.Vector3()
const _sc = new THREE.Vector3()
const _up = new THREE.Vector3(0, 1, 0)

function People() {
  useFrame(({ clock }) => {
    const t = clock.elapsedTime
    const { params, bodies, heads } = people
    for (let i = 0; i < params.length; i++) {
      const p = params[i]
      const a = p.ph + t * p.w
      const x = p.hx + Math.cos(a) * p.wr
      const z = p.hz + Math.sin(a) * p.wr
      // face the tangent of the circle; standers keep their spawn heading
      const heading = p.wr ? -a - Math.sign(p.w) * Math.PI / 2 : p.rot
      // little step bob while walking
      const bob = p.wr ? Math.abs(Math.sin(t * 6 + p.ph)) * 0.015 : 0
      _q.setFromAxisAngle(_up, heading)
      _sc.setScalar(p.s)
      bodies.setMatrixAt(i, _m.compose(_p.set(x, (0.13 + bob) * p.s, z), _q, _sc))
      heads.setMatrixAt(i, _m.compose(_p.set(x, (0.32 + bob) * p.s, z), _q, _sc))
    }
    bodies.instanceMatrix.needsUpdate = true
    heads.instanceMatrix.needsUpdate = true
  })
  return <primitive object={people.g} scale={0.5} />
}

const ktx2 = new KTX2Loader().setTranscoderPath(
  'https://cdn.jsdelivr.net/gh/pmndrs/drei-assets@master/basis/'
)

function BakedCity() {
  const gl = useThree((s) => s.gl)
  const { scene } = useGLTF('/detroit.glb', true, false, (loader) =>
    loader.setKTX2Loader(ktx2.detectSupport(gl))
  )
  useEffect(() => {
    const junk = []
    scene.traverse((o) => {
      if (o.isCamera || o.isLight) junk.push(o)
      // isShaderMaterial: the effect re-runs (StrictMode, HMR) on the cached
      // mutated scene — re-point any prior river ShaderMaterial at the
      // current module's instance instead of clobbering it to basic-white
      else if (o.isMesh && (o.material.name === 'Detroit_River_Blue' || o.material.isShaderMaterial))
        o.material = riverMaterial
      // Most of the city remains unlit because its atlas already contains
      // baked lighting. The Renaissance Center is the exception: it sits in
      // the dark screen-right corner, so give only that landmark a light-aware
      // material for the localized fill light below.
      else if (o.isMesh && o.name === 'GLB_Renaissance_Center') {
        if (!o.material.userData.cityFill) {
          const source = o.material
          o.material = new THREE.MeshLambertMaterial({
            map: source.map,
            color: source.color,
            emissive: '#ffffff',
            emissiveMap: source.map,
            emissiveIntensity: 0.12,
          })
          o.material.userData.cityFill = true
        }
      }
      else if (o.isMesh && !o.material.isMeshBasicMaterial)
        o.material = new THREE.MeshBasicMaterial({ map: o.material.map, color: o.material.color })
    })
    junk.forEach((o) => o.removeFromParent())
  }, [scene])
  return <primitive object={scene} scale={0.5} />
}

export function City() {
  return (
    <group>
      {/* Top sits below the GLB's ground (min y ≈ -0.075) to avoid z-fighting. */}
      <CityBase />
      {/* Soft daylight fill over the Renaissance Center. No shadow map: this
          only lifts its baked dark side and keeps the rest of the city intact. */}
      <pointLight position={[4.5, 7.5, -4.8]} intensity={18} distance={13} decay={1.6} color="#dcecff" />
      {/* no local Suspense — the GLB load suspends up to the app-level loading screen */}
      <BakedCity />
      <People />
      <PeopleMover />
    </group>
  )
}
