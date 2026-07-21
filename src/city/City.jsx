import { useEffect, useState } from 'react'
import { useFrame, useThree } from '@react-three/fiber'
import { useGLTF } from '@react-three/drei'
import { ClickHint, useClickCursor } from '../ClickHint.jsx'
import { useControls } from 'leva'
import { KTX2Loader } from 'three/examples/jsm/loaders/KTX2Loader.js'
import * as THREE from 'three'
import { uniforms as grassUniforms } from '../grass/material.js'
import { hubTransition, sceneRendering } from '../sceneState.js'
import { CityBase } from './CityBase.jsx'
import { makePeople, People } from './People.jsx'

// The whole downtown Detroit diorama is one GLB
// (Tripo buildings + baked ground/river/roads/park, Draco + KTX2 compressed).
// Authored 30x30 with ground at y=0, so scale 0.5 fits the 15x15 slab.
// Lighting is baked into the textures — everything renders unlit
// (KHR_materials_unlit). The river is baked teal into the ground/site
// atlas — no separate water mesh — so patchBakedWater color-keys it.

// Shared with AnnArbor.jsx: color-key teal water texels in an unlit baked
// atlas and remap them through a drifting multi-scale ripple (plus a soft
// lapping wash on the mask ramp at the banks). Rides the shared grass
// uTime. Guards StrictMode/HMR re-traverse via userData.water.
// eslint-disable-next-line react-refresh/only-export-components -- shared water patch
export function patchBakedWater(mat) {
  if (mat.userData.water) return
  mat.userData.water = true
  mat.onBeforeCompile = (shader) => {
    shader.uniforms.uTime = grassUniforms.uTime
    shader.vertexShader = shader.vertexShader
      .replace('#include <common>', '#include <common>\nvarying vec3 vWPos;')
      .replace(
        '#include <begin_vertex>',
        '#include <begin_vertex>\nvWPos = (modelMatrix * vec4(position, 1.0)).xyz;'
      )
    shader.fragmentShader = shader.fragmentShader
      .replace(
        '#include <common>',
        /* glsl */ `#include <common>
        uniform float uTime;
        varying vec3 vWPos;
        float waterHash(vec2 p) { return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
        float waterNoise(vec2 p) {
          vec2 i = floor(p);
          vec2 f = fract(p);
          f = f * f * (3.0 - 2.0 * f);
          return mix(
            mix(waterHash(i), waterHash(i + vec2(1.0, 0.0)), f.x),
            mix(waterHash(i + vec2(0.0, 1.0)), waterHash(i + vec2(1.0, 1.0)), f.x),
            f.y
          );
        }`
      )
      .replace(
        '#include <map_fragment>',
        /* glsl */ `#include <map_fragment>
        {
          vec3 wc = diffuseColor.rgb;
          // teal mask: fades in as blue pulls ahead of red; grass/roads never trip it
          float wMask = smoothstep(0.04, 0.22, wc.b - wc.r);
          if (wMask > 0.001) {
            float t = uTime;
            vec2 p = vWPos.xz * 2.0; // GLB mounts at 0.5 — keep authored feature size
            vec2 flow = vec2(0.7071, -0.7071);
            float rip = waterNoise(p * 0.9 + flow * t * 0.22)
              + 0.55 * waterNoise(p * 2.1 - flow * t * 0.18)
              + 0.3 * waterNoise(p * 4.2 + flow.yx * t * 0.3);
            rip = smoothstep(0.2, 0.8, rip / 1.85);
            vec3 deep = wc * vec3(0.5, 0.72, 0.85);
            vec3 lit = min(wc * 1.22 + vec3(0.0, 0.03, 0.06), vec3(1.0));
            vec3 water = mix(deep, lit, rip);
            float shore = smoothstep(0.1, 0.5, wMask) * (1.0 - smoothstep(0.6, 0.95, wMask));
            water += shore * 0.14 * (0.5 + 0.5 * sin(t * 1.3 + waterNoise(p * 1.3) * 6.283));
            diffuseColor.rgb = mix(wc, water, wMask);
          }
        }`
      )
  }
  mat.needsUpdate = true
}
// Comerica's playing field re-drawn procedurally — the baked field texels are
// covered in crack/seam artifacts, so an opaque shader ellipse hovers just
// above the baked surface (field level measured from the decoded stadium
// mesh: local y≈-0.230 × node scale 5.0693 + translation 1.522 → authored
// 0.356) and repaints the whole field: mow-stripe arcs, dirt basepath
// diamond, mound/home circles, bases, foul lines, warning track, edge
// vignette. The ellipse is sized past the flat field disc so its rim tucks
// under the rising stands; the diamond points at the +x+z corner (home plate
// toward the camera-side entrance, matching the baked layout). Static —
// no time uniform, unlit like the rest of the baked city.
// ponytail: field geometry constants tuned by eye against the baked diamond, not surveyed
const FIELD_CENTER = [-7.444, 0.416, -5.334] // authored coords, +0.06 lift over the bake (0.036 still z-fought)
const FIELD_RADII = [2.9, 2.48]
const ballfieldMaterial = new THREE.ShaderMaterial({
  vertexShader: /* glsl */ `
    varying vec2 vP; // unit-disc coords
    varying vec2 vF; // authored-plane offset from field center (x, z)
    void main() {
      vP = position.xy;
      vF = vec2(position.x * ${FIELD_RADII[0]}, -position.y * ${FIELD_RADII[1]});
      gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
    }
  `,
  fragmentShader: /* glsl */ `
    varying vec2 vP;
    varying vec2 vF;

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
      float r = length(vP);
      // diamond frame: home plate sits toward +x+z (camera-side corner),
      // u runs home -> center field, v across
      vec2 hd = vec2(0.7071, 0.7071);
      vec2 H = hd * 1.42; // home plate, authored offset from field center
      vec2 p = vF - H;
      float u = dot(p, -hd);
      float v = dot(p, vec2(-hd.y, hd.x));

      // outfield grass: mottle + mow-stripe arcs centered on home plate
      float mottle = noise(vF * 3.1) * 0.06;
      float stripe = step(0.0, sin(length(p) * 7.0)) * 0.5 + 0.5;
      vec3 grass = mix(vec3(0.16, 0.27, 0.10), vec3(0.21, 0.33, 0.13), stripe * 0.5 + mottle);

      // dirt: basepath diamond (L1 band around the base square), home & mound
      // circles, plus soft noise so it isn't a flat fill
      float sHalf = 0.85; // half the home->second diagonal
      float d1 = abs(u - sHalf) + abs(v);
      float dirtM = smoothstep(0.17, 0.13, abs(d1 - sHalf)); // basepath band
      dirtM = max(dirtM, smoothstep(0.30, 0.26, length(p)));                        // home circle
      dirtM = max(dirtM, smoothstep(0.24, 0.20, length(vec2(u - sHalf, v))));       // pitcher's mound
      vec3 dirt = mix(vec3(0.60, 0.45, 0.29), vec3(0.65, 0.50, 0.33), noise(vF * 6.0));
      vec3 col = mix(grass, dirt, dirtM);

      // warning track: tan ring at the field rim
      float track = smoothstep(0.86, 0.90, r);
      col = mix(col, mix(vec3(0.55, 0.43, 0.29), vec3(0.59, 0.47, 0.32), noise(vF * 5.0)), track);

      // foul lines: white rays from home along |v| == u, fading at the rim
      float foul = smoothstep(0.045, 0.02, abs(abs(v) - u)) * step(0.25, u) * (1.0 - track);
      // bases: white pads at 1st / 2nd / 3rd corners of the square
      float bases = 0.0;
      bases = max(bases, smoothstep(0.09, 0.06, abs(u - sHalf) + abs(v - sHalf)));
      bases = max(bases, smoothstep(0.09, 0.06, abs(u - sHalf) + abs(v + sHalf)));
      bases = max(bases, smoothstep(0.09, 0.06, abs(u - 2.0 * sHalf) + abs(v)));
      col = mix(col, vec3(0.93, 0.92, 0.88), max(foul * 0.85, bases));

      // nestle: darken toward the surrounding stands
      col *= mix(1.0, 0.78, smoothstep(0.82, 1.0, r));

      gl_FragColor = vec4(col, 1.0);
      #include <tonemapping_fragment>
      #include <colorspace_fragment>
    }
  `,
})

function Ballfield() {
  return (
    <mesh
      position={FIELD_CENTER}
      rotation-x={-Math.PI / 2}
      scale={[FIELD_RADII[0], FIELD_RADII[1], 1]}
      material={ballfieldMaterial}
    >
      <circleGeometry args={[1, 48]} />
    </mesh>
  )
}

// Comerica Park interaction — click the stadium and a home run flies out.
// Hit target is one invisible solid cylinder over the stadium (marker
// pattern from MichiganHub — raycasting the Draco stadium mesh would cost
// per-pointer-move); handlers gate on hubTransition.to === 'city' because
// the shared event root raycasts portal scenes even while they're hidden.
// Balls are a module-singleton pool (React Compiler lint) of baseball.glb
// clones with integrated per-ball physics: launch off home plate toward
// center field, bounce with damping, roll to rest on the ground (or tumble
// off the diorama edge). Resting balls persist until their slot is reused.
const BALL_G = 6 // authored-units gravity, cartoon-slow so the arc reads
const MAX_BALLS = 16 // oldest slot is recycled past this
const TRAIL_N = 64 // per-ball trail ring-buffer size (leva trims the visible length)
// live-tuned by the "baseball" leva folder (transient writes, no re-render)
const ballParams = { r: 0.7, trailLen: 59, trailWidth: 0.61 }
// home plate: FIELD_CENTER + 1.42·(0.707, 0.707) in authored xz (see Ballfield)
const HOME_PLATE = new THREE.Vector3(-6.44, 0, -4.33)

const balls = Array.from({ length: MAX_BALLS }, () => ({
  root: new THREE.Group(), // baseball.glb clone parented here once loaded
  vel: new THREE.Vector3(),
  spinAxis: new THREE.Vector3(1, 0, 0),
  spin: 0,
  state: 'idle', // idle | fly | roll | rest
  age: 0, // launch stamp — lowest age is recycled first
  hist: Array.from({ length: TRAIL_N }, () => new THREE.Vector3()),
  head: 0,
}))
// one instanced trail for the whole pool: shrinking translucent spheres over
// each flying ball's recent positions — single draw call, no meshline dep
const trail = new THREE.InstancedMesh(
  new THREE.SphereGeometry(1, 8, 6),
  new THREE.MeshBasicMaterial({ color: '#ffffff', transparent: true, opacity: 0.01, depthWrite: false }),
  MAX_BALLS * TRAIL_N
)
trail.instanceMatrix.setUsage(THREE.DynamicDrawUsage)
trail.frustumCulled = false // instances span the tile; default bounds would cull them
trail.raycast = () => null
const ballRig = new THREE.Group()
balls.forEach((b) => { b.root.visible = false; ballRig.add(b.root) })
ballRig.add(trail)

const pendingLaunches = { n: 0 }
let launchStamp = 0
const _v = new THREE.Vector3()
const _m = new THREE.Matrix4()
{
  // park unused trail instances at scale 0
  _m.makeScale(0, 0, 0)
  for (let i = 0; i < MAX_BALLS * TRAIL_N; i++) trail.setMatrixAt(i, _m)
}

function launchBall(t) {
  // free slot, else recycle the oldest
  let b = balls.find((x) => x.state === 'idle')
  if (!b) b = balls.reduce((a, x) => (x.age < a.age ? x : a))
  b.age = ++launchStamp
  b.state = 'fly'
  b.root.visible = true
  b.root.position.copy(HOME_PLATE)
  b.root.position.y = 0.42 + ballParams.r // field surface + radius: starts airborne
  // spray + power jitter: deterministic off timestamp + slot (no Math.random)
  const seed = t * 1741.3 + b.age * 7.13
  const r1 = Math.sin(seed) * 0.5 + 0.5
  const r2 = Math.sin(seed * 2.71) * 0.5 + 0.5
  const a = -0.75 * Math.PI + (r1 - 0.5) * 0.7 // center field is -x-z of home plate
  const vh = 4.1 + r2 * 1.2
  b.vel.set(Math.cos(a) * vh, 5.1 + r1 * 1.0, Math.sin(a) * vh) // apex ~2.7-3.6 — clears the stands
  b.spinAxis.set(b.vel.z, 0, -b.vel.x).normalize() // backspin: up × flight dir
  b.spin = 13
  b.hist.forEach((h) => h.copy(b.root.position))
  b.head = 0
}

function updateBalls(t, dt) {
  for (let n = pendingLaunches.n; n > 0; n--) launchBall(t + n * 0.37)
  pendingLaunches.n = 0
  for (let i = 0; i < balls.length; i++) {
    const b = balls[i]
    const p = b.root.position
    if (b.state === 'fly') {
      b.vel.y -= BALL_G * dt
      p.addScaledVector(b.vel, dt)
      b.root.rotateOnWorldAxis(b.spinAxis, b.spin * dt)
      const onTile = Math.abs(p.x) < 15 && Math.abs(p.z) < 15
      // only while descending — a big radius must not swallow the launch frame
      if (onTile && p.y < ballParams.r && b.vel.y < 0) {
        // damped bounce; low verticals hand off to rolling
        p.y = ballParams.r
        b.vel.y = -b.vel.y * 0.5
        b.vel.x *= 0.72
        b.vel.z *= 0.72
        if (b.vel.y < 1.0) { b.vel.y = 0; b.state = 'roll' }
      } else if (!onTile && p.y < -8) {
        // sailed clear off the diorama — fell past the soil block
        b.state = 'idle'
        b.root.visible = false
      }
      b.head = (b.head + 1) % TRAIL_N
      b.hist[b.head].copy(p)
    } else if (b.state === 'roll') {
      const damp = Math.exp(-2.3 * dt)
      b.vel.x *= damp
      b.vel.z *= damp
      p.addScaledVector(b.vel, dt)
      if (Math.abs(p.x) > 15 || Math.abs(p.z) > 15) {
        // rolled off the tile edge — hand back to fly so it falls off the
        // diorama instead of resting on an invisible floor in mid-air
        b.state = 'fly'
        b.hist.forEach((h) => h.copy(p)) // fresh trail, no stale flight streak
      } else {
        const speed = Math.hypot(b.vel.x, b.vel.z)
        b.spinAxis.set(b.vel.z, 0, -b.vel.x).normalize()
        b.root.rotateOnWorldAxis(b.spinAxis, (speed / ballParams.r) * dt)
        if (speed < 0.12) b.state = 'rest'
      }
    }
    // trail: full comet while flying/bouncing, collapsed otherwise
    const flying = b.state === 'fly'
    const len = ballParams.trailLen
    for (let k = 0; k < TRAIL_N; k++) {
      const s = flying && k < len ? ballParams.r * ballParams.trailWidth * (1 - k / len) : 0
      _v.copy(b.hist[(b.head - k + TRAIL_N) % TRAIL_N])
      _m.makeScale(s, s, s).setPosition(_v)
      trail.setMatrixAt(i * TRAIL_N + k, _m)
    }
  }
  trail.instanceMatrix.needsUpdate = true
}

function ComericaPark() {
  const gl = useThree((s) => s.gl)
  // suspends up to the app loading screen like the city GLB; same decoders
  const { scene: ballScene } = useGLTF('/baseball.glb', true, false, (loader) =>
    loader.setKTX2Loader(ktx2.detectSupport(gl))
  )
  const [hovered, setHovered] = useState(false)
  useClickCursor(hovered)
  // transient writes to the module singletons — no re-render (wind-folder pattern)
  useControls('baseball', {
    size: {
      value: ballParams.r, min: 0.2, max: 2, step: 0.01,
      onChange: (v) => {
        ballParams.r = v
        balls.forEach((b) => {
          b.root.scale.setScalar(v)
          // grounded balls track the new contact height instead of floating/sinking
          if (b.state === 'roll' || b.state === 'rest') b.root.position.y = v
        })
      },
    },
    trailLen: {
      value: ballParams.trailLen, min: 0, max: TRAIL_N, step: 1, label: 'trail length',
      onChange: (v) => { ballParams.trailLen = v },
    },
    trailWidth: {
      value: ballParams.trailWidth, min: 0.1, max: 1.5, step: 0.01, label: 'trail width',
      onChange: (v) => { ballParams.trailWidth = v },
    },
    trailOpacity: {
      value: trail.material.opacity, min: 0, max: 1, step: 0.01, label: 'trail opacity',
      onChange: (v) => { trail.material.opacity = v },
    },
    trailColor: {
      value: '#ffffff', label: 'trail color',
      onChange: (v) => { trail.material.color.set(v) },
    },
  }, { collapsed: true })
  useEffect(() => {
    if (ballRig.userData.built) return // StrictMode/HMR guard
    ballRig.userData.built = true
    // normalize the GLB to a unit sphere centered on the pool group origin —
    // ball size is then just root scale, so the leva knob is a scale write;
    // unlit like the rest of the city (its baked texture carries the shading)
    const src = ballScene.clone(true)
    src.traverse((o) => {
      if (o.isMesh) o.material = new THREE.MeshBasicMaterial({ map: o.material.map })
    })
    const sphere = new THREE.Box3().setFromObject(src).getBoundingSphere(new THREE.Sphere())
    const s = 1 / sphere.radius
    src.scale.multiplyScalar(s)
    src.position.copy(sphere.center).multiplyScalar(-s)
    balls.forEach((b) => {
      b.root.add(src.clone(true))
      b.root.scale.setScalar(ballParams.r)
    })
  }, [ballScene])
  useFrame(({ clock }, rawDt) => {
    if (!sceneRendering('city')) return
    updateBalls(clock.elapsedTime, Math.min(rawDt, 0.05))
  })
  return (
    <group>
      {/* invisible click volume over the whole stadium (field + stands) */}
      <mesh
        position={[FIELD_CENTER[0], 1.2, FIELD_CENTER[2]]}
        onClick={(event) => {
          if (hubTransition.to !== 'city') return
          event.stopPropagation()
          pendingLaunches.n++ // launched on the next city frame
        }}
        onPointerOver={(event) => {
          if (hubTransition.to !== 'city') return
          event.stopPropagation()
          setHovered(true)
        }}
        onPointerOut={() => setHovered(false)}
      >
        <cylinderGeometry args={[3.3, 3.3, 2.4, 12]} />
        <meshBasicMaterial colorWrite={false} depthWrite={false} />
      </mesh>
      <primitive object={ballRig} />
      {/* just above the Ballfield ellipse (authored y 0.416 + 0.012 hover) —
          the field sits in a raised bowl, so anything lower is buried */}
      <ClickHint
        position={[FIELD_CENTER[0], 0.48, FIELD_CENTER[2]]}
        radius={3.2}
        scene="city"
        hovered={hovered}
        color="#eaf4f6"
      />
    </group>
  )
}

// Detroit's people singleton — the system itself lives in People.jsx, shared
// with Ann Arbor. Clump anchors [x, z, radius, count] in authored coords,
// pulled from the GLB node table.
const detroitPeople = makePeople([
  [-5.5, -3.4, 1.1, 12], [-9.6, -2.4, 1.0, 9], [-7.9, -1.6, 1.0, 8], // stadium
  [6.8, -1.7, 1.0, 10], [10.6, -0.9, 0.9, 8], [8.0, -0.6, 0.9, 7],   // arena
  [5.2, -8.2, 1.0, 12], [9.6, -7.7, 0.9, 8], [7.4, -7.4, 0.9, 7],    // RenCen
  [-5.2, 7.4, 0.9, 10], [-9.6, 7.0, 0.9, 8], [-7.5, 6.4, 0.9, 7],    // civic tower
  [5.4, 4.7, 0.9, 10], [9.6, 4.2, 0.9, 8], [7.6, 3.6, 0.9, 7],       // brick block
  [0, 1, 1.3, 14],                                                    // central park
  [-1.2, -4.5, 0.7, 5], [1.2, 4.8, 0.7, 5],                           // sidewalks
])

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
    if (!sceneRendering('city')) return
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

// shared with AnnArbor.jsx — one transcoder instance for both GLBs
// eslint-disable-next-line react-refresh/only-export-components -- dev-only HMR granularity
export const ktx2 = new KTX2Loader().setTranscoderPath(
  'https://cdn.jsdelivr.net/gh/pmndrs/drei-assets@master/basis/'
)

function BakedCity() {
  const gl = useThree((s) => s.gl)
  const { scene } = useGLTF('/detroit_compressed.glb', true, false, (loader) =>
    loader.setKTX2Loader(ktx2.detectSupport(gl))
  )
  useEffect(() => {
    const junk = []
    scene.traverse((o) => {
      if (o.isCamera || o.isLight) junk.push(o)
      // River is baked into the ground/site atlas (no Detroit_River_Blue mesh
      // in the compressed GLB) — color-key + ripple like Ann Arbor.
      else if (o.isMesh && /DET_UNLIT_(Ground|SiteBase)/.test(o.material.name))
        patchBakedWater(o.material)
      // Most of the city remains unlit because its atlas already contains
      // baked lighting. The Renaissance Center is the exception: it sits in
      // the dark screen-right corner, so give only that landmark a light-aware
      // material for the localized fill light below.
      else if (o.isMesh && (o.name === 'GLB_Renaissance_Center' || o.material.name === 'DET_UNLIT_LargeLandmark')) {
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
      {/* authored coords like PeopleMover — same 0.5 mount */}
      <group scale={0.5}>
        <Ballfield />
        <ComericaPark />
      </group>
      <People people={detroitPeople} scene="city" />
      <PeopleMover />
    </group>
  )
}
