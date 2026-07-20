import * as THREE from 'three'
import { Fragment, useRef } from 'react'
import { useFrame } from '@react-three/fiber'
import { FIELD_HALF } from './coast.js'

const COUNT = 5
const BOUND = FIELD_HALF - 1 // path amplitudes never exceed this, so birds stay over the tile

// shared geometry — capsule body, sphere head, beak, forked tail, two-segment wings
const bodyGeo = new THREE.CapsuleGeometry(0.05, 0.18, 3, 8)
bodyGeo.rotateX(Math.PI / 2) // axis along +z (the lookAt/forward axis)
const headGeo = new THREE.SphereGeometry(0.042, 8, 6)
const beakGeo = new THREE.ConeGeometry(0.014, 0.07, 5)
beakGeo.rotateX(Math.PI / 2)

// wing panels drawn as shapes in XY (x = span, +y = leading edge), tipped into XZ
const innerShape = new THREE.Shape()
innerShape.moveTo(0, 0.06)
innerShape.lineTo(0.24, 0.035)
innerShape.lineTo(0.24, -0.055)
innerShape.quadraticCurveTo(0.1, -0.1, 0, -0.09)
const innerWingGeo = new THREE.ShapeGeometry(innerShape)
innerWingGeo.rotateX(Math.PI / 2)
const outerShape = new THREE.Shape()
outerShape.moveTo(0, 0.035)
outerShape.quadraticCurveTo(0.18, 0.02, 0.3, -0.07) // swept leading edge to a pointed tip
outerShape.quadraticCurveTo(0.12, -0.05, 0, -0.055)
const outerWingGeo = new THREE.ShapeGeometry(outerShape)
outerWingGeo.rotateX(Math.PI / 2)
const tailShape = new THREE.Shape()
tailShape.moveTo(-0.015, 0)
tailShape.lineTo(-0.055, -0.14)
tailShape.lineTo(0, -0.11) // notch — forked tail
tailShape.lineTo(0.055, -0.14)
tailShape.lineTo(0.015, 0)
const tailGeo = new THREE.ShapeGeometry(tailShape)
tailGeo.rotateX(Math.PI / 2)

// one plumage: coast gulls — white with black wingtips, orange beak
const PAL = {
  body: new THREE.MeshLambertMaterial({ color: '#f2eee4' }),
  wing: new THREE.MeshLambertMaterial({ color: '#e2ddcf', side: THREE.DoubleSide }),
  tip: new THREE.MeshLambertMaterial({ color: '#2b2925', side: THREE.DoubleSide }),
  beak: new THREE.MeshLambertMaterial({ color: '#d29a3f' }),
}

// blob contact shadows — ground/ocean are unlit custom shaders, so real shadow
// maps can't reach them; a soft radial disc per bird tracks x/z and fades with height
const shadowCanvas = document.createElement('canvas')
shadowCanvas.width = shadowCanvas.height = 64
const sctx = shadowCanvas.getContext('2d')
// deep desaturated green, not black, so it sits in the grass instead of on it
const grd = sctx.createRadialGradient(32, 32, 0, 32, 32, 32)
grd.addColorStop(0, 'rgba(24,30,18,0.3)')
grd.addColorStop(0.35, 'rgba(24,30,18,0.2)')
grd.addColorStop(0.7, 'rgba(24,30,18,0.08)')
grd.addColorStop(1, 'rgba(24,30,18,0)')
sctx.fillStyle = grd
sctx.fillRect(0, 0, 64, 64)
const shadowTex = new THREE.CanvasTexture(shadowCanvas)
const shadowGeo = new THREE.CircleGeometry(0.6, 16)
const shadowMats = Array.from({ length: COUNT }, () =>
  new THREE.MeshBasicMaterial({ map: shadowTex, transparent: true, depthWrite: false }))

const rand = (a, b) => a + Math.random() * (b - a)
const BIRDS = Array.from({ length: COUNT }, () => ({
  ax: rand(4.8, BOUND), az: rand(4.8, BOUND), // ponytail: Lissajous wander — bounded by construction, no boids/steering
  fx: rand(0.07, 0.14), fz: rand(0.09, 0.18),
  px: rand(0, Math.PI * 2), pz: rand(0, Math.PI * 2),
  baseY: rand(2.2, 4.8), ay: rand(0.2, 0.5), fy: rand(0.3, 0.6), py: rand(0, Math.PI * 2),
  flapFreq: rand(6, 9), flapPhase: rand(0, Math.PI * 2), glideFreq: rand(0.12, 0.25),
  scale: rand(0.75, 1.15),
}))

const posAt = (b, t, out) => out.set(
  b.ax * Math.sin(b.fx * t + b.px),
  b.baseY + b.ay * Math.sin(b.fy * t + b.py),
  b.az * Math.sin(b.fz * t + b.pz),
)

// sine with a faster upstroke — real wingbeats aren't symmetric
const skew = (p) => Math.sin(p + 0.35 * Math.sin(p))

const _p = new THREE.Vector3()
const _ahead = new THREE.Vector3()
const _far = new THREE.Vector3()

export function Birds() {
  const refs = useRef([])
  const shadowRefs = useRef([])

  useFrame(({ clock }) => {
    const t = clock.elapsedTime
    refs.current.forEach((g, i) => {
      if (!g) return
      const b = BIRDS[i]
      posAt(b, t, _p)
      posAt(b, t + 0.25, _ahead)
      posAt(b, t + 0.75, _far)
      g.position.copy(_p)
      g.lookAt(_ahead)
      // bank into turns: roll from the heading change between now and slightly ahead
      const h1 = Math.atan2(_ahead.x - _p.x, _ahead.z - _p.z)
      const h2 = Math.atan2(_far.x - _ahead.x, _far.z - _ahead.z)
      const dh = Math.atan2(Math.sin(h2 - h1), Math.cos(h2 - h1))
      g.rotateZ(THREE.MathUtils.clamp(dh * 2, -0.8, 0.8))
      // flap with intermittent glides; climbing suppresses glide (birds beat uphill,
      // glide downhill), outer panel trails the inner beat and droops in glide
      const vy = (_ahead.y - _p.y) / 0.25
      const flapT = t * b.flapFreq + b.flapPhase
      const glide = THREE.MathUtils.smoothstep(
        Math.sin(t * b.glideFreq + b.px) - vy * 1.2, 0.35, 0.75)
      const flap = (1 - glide) * (skew(flapT) * 0.8 + 0.12) + glide * 0.22
      const outer = (1 - glide) * skew(flapT - 0.8) * 0.5 - glide * 0.12
      // downstroke lift: the body bobs against the wingbeat
      g.position.y += (1 - glide) * 0.025 * Math.sin(flapT - 1.5) * b.scale
      const [wingL, wingR] = g.children
      wingL.rotation.z = flap
      wingL.children[1].rotation.z = outer
      // mirrored wing: only the scale.x=-1 node's own rotation negates; nested ones keep sign
      wingR.rotation.z = -flap
      wingR.children[1].rotation.z = outer
      // head: idle scanning glances, a look into the turn, a downward tilt while gliding
      const head = g.children[3]
      head.rotation.y = Math.sin(t * 0.6 + b.px * 3) * 0.3
        + Math.sin(t * 1.7 + b.pz) * 0.12
        + THREE.MathUtils.clamp(dh * 2.5, -0.5, 0.5)
      head.rotation.x = glide * 0.2 + Math.sin(t * 1.1 + b.py) * 0.06
      // tail: rudder-yaw against turns, fans up in glide, flap-synced flick
      const tail = g.children[4]
      tail.rotation.x = 0.12 + glide * 0.15 + (1 - glide) * 0.05 * Math.sin(flapT - 2)
      tail.rotation.y = THREE.MathUtils.clamp(-dh * 1.5, -0.35, 0.35)
      // contact shadow: track x/z, grow + fade with altitude
      const s = shadowRefs.current[i]
      if (s) {
        s.position.x = _p.x
        s.position.z = _p.z
        const h = THREE.MathUtils.clamp((_p.y - 1.5) / 3.5, 0, 1)
        s.scale.setScalar(b.scale * (1.1 + h * 1.2))
        s.material.opacity = 0.8 - h * 0.6
      }
    })
  })

  return BIRDS.map((b, i) => (
    <Fragment key={i}>
      <mesh
        ref={(el) => { shadowRefs.current[i] = el }}
        geometry={shadowGeo}
        material={shadowMats[i]}
        rotation-x={-Math.PI / 2}
        position-y={0.02}
      />
      <group ref={(el) => { refs.current[i] = el }} scale={b.scale}>
      {/* wings first — the frame loop indexes children[0]/[1] */}
      <group position={[0.03, 0.02, 0.02]}>
        <mesh geometry={innerWingGeo} material={PAL.wing} />
        <group position-x={0.24}>
          <mesh geometry={outerWingGeo} material={PAL.tip} />
        </group>
      </group>
      <group position={[-0.03, 0.02, 0.02]} scale-x={-1}>
        <mesh geometry={innerWingGeo} material={PAL.wing} />
        <group position-x={0.24}>
          <mesh geometry={outerWingGeo} material={PAL.tip} />
        </group>
      </group>
      <mesh geometry={bodyGeo} material={PAL.body} scale-y={0.92} />
      {/* neck pivot — head + beak swivel together; frame loop is children[3] */}
      <group position={[0, 0.03, 0.1]}>
        <mesh geometry={headGeo} material={PAL.body} position={[0, 0.01, 0.04]} />
        <mesh geometry={beakGeo} material={PAL.beak} position={[0, 0, 0.1]} />
      </group>
      {/* tail — frame loop is children[4] */}
      <mesh geometry={tailGeo} material={PAL.wing} position={[0, 0.01, -0.12]} />
      </group>
    </Fragment>
  ))
}
