import { useFrame } from '@react-three/fiber'
import * as THREE from 'three'
import { sceneRendering } from '../sceneState.js'

// Tiny unlit people — cylinder body + sphere head, two InstancedMeshes sharing
// transforms — clumped around landmarks. Authored in GLB coords (30x30,
// ground y=0), mounted at scale 0.5 like the GLBs. One makePeople() singleton
// per city scene (Detroit in City.jsx, Ann Arbor in AnnArbor.jsx).
// ponytail: hand-picked clump anchors, no road/river collision checks —
// re-place anchors if a layout ever changes.

const shirts = ['#c0504d', '#4f81bd', '#9bbb59', '#8064a2', '#f2c14e', '#e8e4d8', '#4bacc6']

// clumps: [x, z, radius, count] in authored coords
// eslint-disable-next-line react-refresh/only-export-components -- dev-only HMR granularity
export function makePeople(clumps) {
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
}

const _m = new THREE.Matrix4()
const _q = new THREE.Quaternion()
const _p = new THREE.Vector3()
const _sc = new THREE.Vector3()
const _up = new THREE.Vector3(0, 1, 0)

// module-level so the React Compiler lint doesn't see prop mutation in render scope
function updatePeople(people, t) {
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
}

export function People({ people, scene }) {
  useFrame(({ clock }) => {
    if (!sceneRendering(scene)) return
    updatePeople(people, clock.elapsedTime)
  })
  return <primitive object={people.g} scale={0.5} />
}
