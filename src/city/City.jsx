import { Suspense, useEffect, useRef } from 'react'
import { useFrame } from '@react-three/fiber'
import { useGLTF } from '@react-three/drei'
import * as THREE from 'three'
import { uniforms as grassUniforms } from '../grass/material.js'
import { flipState } from './flipState.js'

// Downtown Detroit diorama — authored ground-at-y=0; App.jsx mounts it flipped
// under the slab so the arrow coin-flips between scenes. All static
// architecture (slab, streets, buildings, landmarks, bridge, trees) is a
// Blender-authored GLB with lighting baked into two texture atlases
// (public/detroit.glb — see scratchpad detroit.blend); it renders unlit
// (MeshBasicMaterial). Only the animated systems stay procedural here: the
// river shader, People Mover track + train (the train must follow the exact
// three.js curve), traffic, boats, and the beacon/fountain pulses. The light
// rig remains for those Lambert-lit dynamic pieces, faded in via flipState.

const FIELD = 15
const HALF = FIELD / 2

// ---------------------------------------------------------------- baked city
function BakedCity() {
  const { scene } = useGLTF('/detroit.glb')
  useEffect(() => {
    scene.traverse((o) => {
      if (o.isMesh && !o.material.isMeshBasicMaterial) {
        // lighting is baked into the atlas — swap to unlit
        o.material = new THREE.MeshBasicMaterial({ map: o.material.map })
      }
    })
  }, [scene])
  return <primitive object={scene} />
}
useGLTF.preload('/detroit.glb')

// ---------------------------------------------------------------- river
// water occupies z 5.19..7.45 — the near-left foreground edge from the camera
const riverMaterial = new THREE.ShaderMaterial({
  uniforms: { uTime: grassUniforms.uTime },
  vertexShader: /* glsl */ `
    varying vec3 vW;
    void main() {
      vec4 wp = modelMatrix * vec4(position, 1.0);
      vW = wp.xyz;
      gl_Position = projectionMatrix * viewMatrix * wp;
    }
  `,
  fragmentShader: /* glsl */ `
    uniform float uTime;
    varying vec3 vW;
    float hash(vec2 p) { return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
    float noise(vec2 p) {
      vec2 i = floor(p), f = fract(p);
      vec2 u = f * f * (3.0 - 2.0 * f);
      return mix(mix(hash(i), hash(i + vec2(1, 0)), u.x), mix(hash(i + vec2(0, 1)), hash(i + vec2(1, 1)), u.x), u.y);
    }
    void main() {
      float x = vW.x, z = vW.z;
      float t = uTime;
      float depth = smoothstep(5.3, 7.3, z);
      // gouache current bands, wobbled by noise, drifting downstream
      float w = noise(vec2(x * 0.55 - t * 0.12, z * 1.1));
      float s = sin(x * 1.6 + z * 3.4 + w * 4.5 + t * 0.35);
      float band = floor((s + 1.0) * 1.5) / 3.0;
      vec3 col = mix(vec3(0.33, 0.53, 0.60), vec3(0.10, 0.28, 0.38), depth);
      col = mix(col, vec3(0.48, 0.68, 0.73), band * 0.28);
      // seawall foam scallop along the riverwalk edge
      float edge = 5.14 + 0.035 * sin(x * 5.0 + t * 1.3) + 0.02 * sin(x * 11.0 - t * 0.9);
      float foam = 1.0 - smoothstep(edge, edge + 0.05, z);
      col = mix(col, vec3(0.93, 0.96, 0.95), foam * 0.85);
      // glints on open water
      float g = hash(floor(vec2(x, z) * 9.0) + floor(t * 2.0));
      col = mix(col, vec3(1.0), step(0.985, g) * depth * 0.5);
      gl_FragColor = vec4(col, 1.0);
    }
  `,
})

// ---------------------------------------------------------------- People Mover
// hand-authored rounded loop threading between the skyline towers — waypoints
// are load-bearing: tools/blender/build.py places buildings clear of this path
const PM_Y = 0.78
const pmCurve = new THREE.CatmullRomCurve3(
  [
    [2.5, 1.6], [2.6, 3.0], [1.5, 3.7], [0, 3.85], [-1.6, 3.75], [-2.7, 3.1],
    [-2.6, 1.5], [-2.5, 0.1], [-1.45, -1.0], [0, -1.2], [1.45, -1.0], [2.55, 0.1],
  ].map(([x, z]) => new THREE.Vector3(x, PM_Y, z)),
  true, 'centripetal'
)
const pmTrackGeo = new THREE.TubeGeometry(pmCurve, 220, 0.05, 8, true)
const pmPylons = Array.from({ length: 22 }, (_, i) => {
  const p = pmCurve.getPointAt(i / 22)
  return [p.x, p.z]
})
const pmMat = new THREE.MeshLambertMaterial({ color: '#9ba1a6' })

// stations sit exactly on the curve: nearest-u lookup against sampled points
function nearestU(x, z) {
  let best = 0
  let bestD = Infinity
  for (let i = 0; i < 400; i++) {
    const p = pmCurve.getPointAt(i / 400)
    const d = (p.x - x) * (p.x - x) + (p.z - z) * (p.z - z)
    if (d < bestD) {
      bestD = d
      best = i / 400
    }
  }
  return best
}
const pmStations = [[2.6, 3.0], [-2.7, 3.1], [0, -1.2]].map(([x, z]) => {
  const u = nearestU(x, z)
  const p = pmCurve.getPointAt(u)
  const t = pmCurve.getTangentAt(u)
  return { pos: [p.x, p.z], rot: Math.atan2(t.x, t.z) }
})

function Train() {
  const cars = useRef([])
  const look = useRef(new THREE.Vector3())
  useFrame(({ clock }) => {
    const u0 = (clock.elapsedTime * 0.022) % 1
    cars.current.forEach((car, i) => {
      if (!car) return
      const u = (u0 + i * 0.045) % 1
      const p = pmCurve.getPointAt(u)
      const tan = pmCurve.getTangentAt(u)
      car.position.copy(p)
      car.position.y = PM_Y + 0.11
      car.lookAt(look.current.copy(car.position).add(tan))
    })
  })
  return [0, 1, 2].map((i) => (
    <group key={i} ref={(el) => { cars.current[i] = el }}>
      <mesh castShadow><boxGeometry args={[0.15, 0.15, 0.42]} /><meshLambertMaterial color="#eceae2" /></mesh>
      <mesh position-y={-0.045}><boxGeometry args={[0.155, 0.05, 0.425]} /><meshLambertMaterial color="#3d6b74" /></mesh>
      <mesh position-y={0.045}><boxGeometry args={[0.152, 0.04, 0.36]} /><meshLambertMaterial color="#2c343c" /></mesh>
      <mesh position={[0, -0.02, 0.213]}><boxGeometry args={[0.1, 0.06, 0.01]} /><meshLambertMaterial color="#2c343c" /></mesh>
    </group>
  ))
}

function Stations() {
  return pmStations.map((s, i) => (
    <group key={i} position={[s.pos[0], 0, s.pos[1]]} rotation-y={s.rot}>
      <mesh position-y={PM_Y - 0.09}><boxGeometry args={[0.3, 0.045, 0.62]} /><meshLambertMaterial color="#8a8378" /></mesh>
      {[-0.24, 0.24].map((dz) => (
        <mesh key={dz} position={[0, PM_Y + 0.06, dz]}><cylinderGeometry args={[0.012, 0.012, 0.3, 5]} /><meshLambertMaterial color="#3c4046" /></mesh>
      ))}
      <mesh position-y={PM_Y + 0.22}><boxGeometry args={[0.34, 0.025, 0.68]} /><meshLambertMaterial color="#3d6b74" /></mesh>
      {[-1, 1].map((s2) => (
        <mesh key={s2} position={[0, (PM_Y - 0.12) / 2, s2 * 0.26]}><cylinderGeometry args={[0.02, 0.028, PM_Y - 0.12, 6]} /><meshLambertMaterial color="#9ba1a6" /></mesh>
      ))}
    </group>
  ))
}

// ---------------------------------------------------------------- traffic
// v3 city has radial avenues — straight lanes only fit Jefferson (x-axis,
// z 3.7..4.2) and Woodward north of Campus Martius (z-axis, x ±0.15, z -0.2..-7.4)
const CARS = [
  { lane: 3.74, speed: 1.4, offset: 0, color: '#c2452d', axis: 'x' },
  { lane: 3.88, speed: 1.0, offset: 3, color: '#d9b23a', axis: 'x' },
  { lane: 4.16, speed: -1.1, offset: 6, color: '#3d7a8c', axis: 'x' },
  { lane: 4.16, speed: -0.9, offset: 12, color: '#7d8288', axis: 'x' },
  { lane: 0.15, speed: 1.6, offset: 9, color: '#e8e4da', axis: 'z' },
  { lane: -0.15, speed: -1.3, offset: 12, color: '#54586a', axis: 'z' },
]

function Traffic() {
  const refs = useRef([])
  const bus = useRef()
  useFrame(({ clock }) => {
    const t = clock.elapsedTime
    CARS.forEach((c, i) => {
      const m = refs.current[i]
      if (!m) return
      if (c.axis === 'x') {
        m.position.set(((c.speed * t + c.offset) % FIELD + FIELD) % FIELD - HALF, 0.07, c.lane)
        m.rotation.y = c.speed > 0 ? 0 : Math.PI
      } else {
        m.position.set(c.lane, 0.07, -0.2 - ((c.speed * t + c.offset) % 7.2 + 7.2) % 7.2)
        m.rotation.y = c.speed > 0 ? Math.PI / 2 : -Math.PI / 2
      }
    })
    if (bus.current) {
      bus.current.position.set(((0.8 * t + 2) % FIELD) - HALF, 0.1, 4.02)
    }
  })
  return (
    <>
      {CARS.map((c, i) => (
        <group key={i} ref={(el) => { refs.current[i] = el }}>
          <mesh castShadow><boxGeometry args={[0.3, 0.09, 0.15]} /><meshLambertMaterial color={c.color} /></mesh>
          <mesh position={[0.01, 0.07, 0]}><boxGeometry args={[0.16, 0.07, 0.13]} /><meshLambertMaterial color="#dfe6ea" /></mesh>
        </group>
      ))}
      {/* DDOT bus on Jefferson */}
      <group ref={bus}>
        <mesh castShadow><boxGeometry args={[0.55, 0.17, 0.17]} /><meshLambertMaterial color="#e5e0d2" /></mesh>
        <mesh position-y={0.01}><boxGeometry args={[0.555, 0.05, 0.175]} /><meshLambertMaterial color="#3f7a4d" /></mesh>
        <mesh position-y={0.06}><boxGeometry args={[0.5, 0.05, 0.175]} /><meshLambertMaterial color="#2c343c" /></mesh>
      </group>
    </>
  )
}

// slow laker + a little sailboat sharing the river
function Boats() {
  const ref = useRef()
  const sail = useRef()
  useFrame(({ clock }) => {
    const t = clock.elapsedTime
    if (ref.current) ref.current.position.x = 5.6 * Math.sin(t * 0.05)
    if (sail.current) {
      sail.current.position.x = -3.2 + 2.4 * Math.sin(t * 0.09 + 2)
      sail.current.position.y = 0.03 + 0.008 * Math.sin(t * 1.4)
      sail.current.rotation.z = 0.06 * Math.sin(t * 0.9)
    }
  })
  return (
    <>
      <group ref={sail} position={[-3.2, 0.03, 5.75]}>
        <mesh><boxGeometry args={[0.2, 0.045, 0.08]} /><meshLambertMaterial color="#e8e4da" /></mesh>
        <mesh position-y={0.14}><cylinderGeometry args={[0.005, 0.005, 0.24, 4]} /><meshLambertMaterial color="#6b5138" /></mesh>
        <mesh position={[0.03, 0.15, 0]} scale={[1, 1, 0.12]}><coneGeometry args={[0.08, 0.2, 3]} /><meshLambertMaterial color="#f2eee2" /></mesh>
      </group>
      <group ref={ref} position={[0, 0.03, 6.55]}>
      <mesh castShadow><boxGeometry args={[1.7, 0.09, 0.3]} /><meshLambertMaterial color="#7a3b30" /></mesh>
      <mesh position-y={0.06}><boxGeometry args={[1.6, 0.04, 0.26]} /><meshLambertMaterial color="#4a4440" /></mesh>
      {[-0.5, -0.15, 0.2].map((x) => (
        <mesh key={x} position={[x, 0.095, 0]}><boxGeometry args={[0.22, 0.03, 0.18]} /><meshLambertMaterial color="#8a5a4a" /></mesh>
      ))}
      <mesh position={[0.68, 0.14, 0]} castShadow><boxGeometry args={[0.14, 0.14, 0.2]} /><meshLambertMaterial color="#e8e4da" /></mesh>
      <mesh position={[-0.72, 0.11, 0]}><cylinderGeometry args={[0.02, 0.025, 0.1, 6]} /><meshLambertMaterial color="#3c3835" /></mesh>
      </group>
    </>
  )
}

// Penobscot beacon pulse + Dodge Fountain jet breathe
function CityPulse() {
  const beacon = useRef()
  const jet = useRef()
  useFrame(({ clock }) => {
    const t = clock.elapsedTime
    if (beacon.current) beacon.current.material.emissiveIntensity = 0.45 + 0.45 * Math.sin(t * 2.6)
    if (jet.current) {
      const s = 0.9 + 0.12 * Math.sin(t * 1.7) + 0.05 * Math.sin(t * 4.3)
      jet.current.scale.set(1, s, 1)
    }
  })
  return (
    <>
      <mesh ref={beacon} position={[-1.3, 4.4, 2.9]}>
        <sphereGeometry args={[0.07, 10, 8]} />
        <meshLambertMaterial color="#d8402a" emissive="#ff5a3a" emissiveIntensity={0.6} />
      </mesh>
      <mesh ref={jet} position={[1.3, 0.42, 4.6]}>
        <coneGeometry args={[0.1, 0.36, 10]} />
        <meshLambertMaterial color="#dfeef2" transparent opacity={0.4} depthWrite={false} />
      </mesh>
    </>
  )
}

export function City() {
  const amb = useRef()
  const dir = useRef()
  // crossfade this rig against the meadow rig in Rocks.jsx so mid-flip is never
  // double-lit; only the dynamic Lambert pieces (train/traffic/boats/pulses)
  // need it — the baked GLB is unlit
  useFrame(() => {
    const f = THREE.MathUtils.smoothstep(flipState.p, 0.35, 0.75)
    if (amb.current) amb.current.intensity = 1.15 * f
    if (dir.current) dir.current.intensity = 1.2 * f
  })

  return (
    <group>
      <ambientLight ref={amb} intensity={0} color="#c9d2d8" />
      <directionalLight ref={dir} position={[6, 10, 4]} intensity={0} color="#ffeccb" />

      {/* Blender-baked static city (slab, streets, buildings, landmarks, bridge) */}
      <Suspense fallback={null}>
        <BakedCity />
      </Suspense>

      {/* Detroit River — animated shader, rides the shared uTime */}
      <mesh rotation-x={-Math.PI / 2} position={[0, 0.008, 6.25]} material={riverMaterial}>
        <planeGeometry args={[14.9, 2.5, 1, 1]} />
      </mesh>

      {/* riverwalk railing — too thin to bake cleanly, so it stays live geometry */}
      <mesh position={[-2.85, 0.045, 4.99]}><boxGeometry args={[9.2, 0.05, 0.02]} /><meshLambertMaterial color="#55524c" /></mesh>
      <mesh position={[5.85, 0.045, 4.99]}><boxGeometry args={[3.2, 0.05, 0.02]} /><meshLambertMaterial color="#55524c" /></mesh>

      {/* People Mover guideway + pylons + train (procedural so the train stays glued) */}
      <mesh geometry={pmTrackGeo} material={pmMat} />
      {pmPylons.map(([x, z], i) => (
        <mesh key={`p${i}`} position={[x, PM_Y / 2 - 0.02, z]} material={pmMat}>
          <cylinderGeometry args={[0.026, 0.034, PM_Y, 8]} />
        </mesh>
      ))}
      <Train />
      <Stations />

      <Traffic />
      <Boats />
      <CityPulse />
    </group>
  )
}
