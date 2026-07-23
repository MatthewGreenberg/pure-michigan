import * as THREE from 'three'

// Procedural hybrid bike (img2threejs reconstruction of a black commuter bike,
// side reference photo). Authored in meters, drive side +z, facing +x, ground
// contact at y=0; scaled to diorama size at mount (see Bike.jsx). Pure three —
// no React — so the review harness can render it standalone.
//
// Every mesh carries userData.tier (0 blockout / 1 structural / 2 form) so the
// staged build-pass reviews can show exactly the pass scope; the full model is
// tier <= 2. All geometry/materials are module-level singletons built once.

// ---- shared joint constants (side-view x,y; z is lateral) ----
const BB = [0.42, 0.27] // bottom bracket
const RH = [0.0, 0.34] // rear hub
const FH = [1.06, 0.34] // front hub
const ST_TOP = [0.35, 0.8] // seat tube top
const HT_TOP = [0.88, 0.8] // head tube top
const HT_BOT = [0.93, 0.615]
const WHEEL_R = 0.312 // tire centerline radius (outer 0.34)
const TIRE_R = 0.028

export const bikeMaterials = {
  // metalness kept low — the meadow rig is ambient+directional with no envmap,
  // and high metalness goes black without one; albedo carries the metal read
  paint: new THREE.MeshStandardMaterial({ color: '#1a1c1f', roughness: 0.55, metalness: 0.15 }),
  rubber: new THREE.MeshStandardMaterial({ color: '#0e0e10', roughness: 0.95 }),
  darkMetal: new THREE.MeshStandardMaterial({ color: '#33373c', roughness: 0.5, metalness: 0.3 }),
  brightMetal: new THREE.MeshStandardMaterial({ color: '#b8bec6', roughness: 0.35, metalness: 0.4 }),
  vinyl: new THREE.MeshStandardMaterial({ color: '#131315', roughness: 0.8 }),
  chainMetal: new THREE.MeshStandardMaterial({ color: '#4a4f56', roughness: 0.4, metalness: 0.35 }),
  decal: new THREE.MeshStandardMaterial({ color: '#d8dadc', roughness: 0.4 }),
}

const UP = new THREE.Vector3(0, 1, 0)
const v3 = (p) => new THREE.Vector3(p[0], p[1], p[2] ?? 0)

// capsule stretched between two joint points — Scenery.jsx Limb pattern
function tube(a, b, r, material, tier, name) {
  const A = v3(a)
  const B = v3(b)
  const dir = B.clone().sub(A)
  const mesh = new THREE.Mesh(new THREE.CapsuleGeometry(r, dir.length(), 3, 10), material)
  mesh.position.copy(A).add(B).multiplyScalar(0.5)
  mesh.quaternion.setFromUnitVectors(UP, dir.normalize())
  mesh.userData.tier = tier
  mesh.name = name
  return mesh
}

function disc(r, h, material, pos, tier, name) {
  const mesh = new THREE.Mesh(new THREE.CylinderGeometry(r, r, h, 24), material)
  mesh.rotation.x = Math.PI / 2 // axis along z
  mesh.position.set(pos[0], pos[1], pos[2] ?? 0)
  mesh.userData.tier = tier
  mesh.name = name
  return mesh
}

function box(w, h, d, material, pos, tier, name) {
  const mesh = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), material)
  mesh.position.set(pos[0], pos[1], pos[2] ?? 0)
  mesh.userData.tier = tier
  mesh.name = name
  return mesh
}

// ---- wheels: tire torus + rim torus + hub + instanced spoke lattice ----
const spokeGeometry = new THREE.CylinderGeometry(0.0045, 0.0045, 1, 5)
function buildWheel(name) {
  const wheel = new THREE.Group()
  wheel.name = name

  const tire = new THREE.Mesh(new THREE.TorusGeometry(WHEEL_R, TIRE_R, 12, 40), bikeMaterials.rubber)
  tire.userData.tier = 0
  tire.name = name + '-tire'
  wheel.add(tire)

  const rim = new THREE.Mesh(new THREE.TorusGeometry(0.292, 0.011, 8, 36), bikeMaterials.darkMetal)
  rim.userData.tier = 1
  rim.name = name + '-rim'
  wheel.add(rim)

  const hub = disc(0.022, 0.085, bikeMaterials.darkMetal, [0, 0, 0], 1, name + '-hub')
  wheel.add(hub)
  for (const side of [-1, 1]) wheel.add(disc(0.032, 0.006, bikeMaterials.darkMetal, [0, 0, side * 0.032], 1, name + '-flange'))

  // 28 spokes, alternating flange sides for lacing depth
  const spokes = new THREE.InstancedMesh(spokeGeometry, bikeMaterials.darkMetal, 28)
  const m = new THREE.Matrix4()
  const q = new THREE.Quaternion()
  const from = new THREE.Vector3()
  const to = new THREE.Vector3()
  const dir = new THREE.Vector3()
  for (let i = 0; i < 28; i++) {
    const angle = (i / 28) * Math.PI * 2
    const side = i % 2 ? 1 : -1
    from.set(Math.cos(angle + 0.12) * 0.03, Math.sin(angle + 0.12) * 0.03, side * 0.028)
    to.set(Math.cos(angle) * 0.281, Math.sin(angle) * 0.281, 0)
    dir.subVectors(to, from)
    q.setFromUnitVectors(UP, dir.clone().normalize())
    m.compose(from.clone().add(to).multiplyScalar(0.5), q, new THREE.Vector3(1, dir.length(), 1))
    spokes.setMatrixAt(i, m)
  }
  spokes.userData.tier = 1
  spokes.name = name + '-spokes'
  wheel.add(spokes)
  return wheel
}

export function buildBike() {
  const root = new THREE.Group()
  root.name = 'hybrid-bike'

  // ---- frame lattice ----
  const frame = new THREE.Group()
  frame.name = 'frame'
  frame.add(tube(HT_BOT, HT_TOP, 0.021, bikeMaterials.paint, 0, 'head-tube'))
  frame.add(tube([0.36, 0.755], [0.885, 0.79], 0.019, bikeMaterials.paint, 0, 'top-tube'))
  frame.add(tube([0.44, 0.29], [0.92, 0.635], 0.024, bikeMaterials.paint, 0, 'down-tube'))
  frame.add(tube(BB, ST_TOP, 0.018, bikeMaterials.paint, 0, 'seat-tube'))
  for (const side of [-1, 1]) {
    frame.add(tube([0.36, 0.72, side * 0.03], [0.005, 0.34, side * 0.045], 0.009, bikeMaterials.paint, 1, 'seat-stay'))
    frame.add(tube([0.43, 0.27, side * 0.03], [0.005, 0.34, side * 0.045], 0.01, bikeMaterials.paint, 1, 'chain-stay'))
  }
  frame.add(disc(0.03, 0.09, bikeMaterials.paint, BB, 1, 'bb-shell'))

  // white decal bands riding the down/seat tube axes (sleeves slightly proud)
  const dtDir = [0.92 - 0.44, 0.635 - 0.29]
  const dtMid = [0.61, 0.41]
  const decalA = tube(
    [dtMid[0] - dtDir[0] * 0.11, dtMid[1] - dtDir[1] * 0.11],
    [dtMid[0] + dtDir[0] * 0.11, dtMid[1] + dtDir[1] * 0.11],
    0.0252, bikeMaterials.decal, 2, 'decal-down-tube',
  )
  frame.add(decalA)
  frame.add(tube([0.395, 0.575], [0.385, 0.635], 0.0192, bikeMaterials.decal, 2, 'decal-seat-tube'))
  root.add(frame)

  // ---- wheels (spin pivots at hubs, axis z) ----
  const wheelRear = buildWheel('wheel-rear')
  wheelRear.position.set(RH[0], RH[1], 0)
  const wheelFront = buildWheel('wheel-front')
  wheelFront.position.set(FH[0], FH[1], 0)
  root.add(wheelRear, wheelFront)

  // ---- suspension fork + steering ----
  const steer = new THREE.Group()
  steer.name = 'steer'
  const crown = box(0.055, 0.045, 0.13, bikeMaterials.paint, [0.945, 0.565], 1, 'fork-crown')
  crown.rotation.z = -0.26
  steer.add(crown)
  for (const side of [-1, 1]) {
    steer.add(tube([0.945, 0.56, side * 0.052], [0.99, 0.46, side * 0.052], 0.014, bikeMaterials.darkMetal, 1, 'stanchion'))
    steer.add(tube([0.985, 0.475, side * 0.052], [1.06, 0.345, side * 0.052], 0.02, bikeMaterials.paint, 1, 'fork-lower'))
  }
  const arch = new THREE.Mesh(new THREE.TorusGeometry(0.054, 0.007, 6, 12, Math.PI), bikeMaterials.paint)
  arch.position.set(0.995, 0.455, 0)
  arch.rotation.set(0, Math.PI / 2, 0.4)
  arch.userData.tier = 2
  arch.name = 'brake-arch'
  steer.add(arch)

  // steerer spacers + stem + flat bar
  steer.add(tube(HT_TOP, [0.867, 0.848], 0.016, bikeMaterials.darkMetal, 2, 'spacer-stack'))
  steer.add(tube([0.867, 0.848], [0.905, 0.876], 0.014, bikeMaterials.darkMetal, 1, 'stem'))
  const bar = disc(0.011, 0.56, bikeMaterials.darkMetal, [0.905, 0.878], 0, 'handlebar')
  steer.add(bar)
  for (const side of [-1, 1]) {
    const grip = tube([0.895, 0.878, side * 0.28], [0.878, 0.878, side * 0.17], 0.015, bikeMaterials.rubber, 2, 'grip')
    steer.add(grip)
    steer.add(box(0.045, 0.02, 0.03, bikeMaterials.darkMetal, [0.9, 0.868, side * 0.13], 2, 'brake-pod'))
    steer.add(tube([0.92, 0.862, side * 0.13], [0.97, 0.838, side * 0.1], 0.004, bikeMaterials.darkMetal, 2, 'brake-lever'))
  }
  root.add(steer)

  // ---- saddle on exposed post ----
  const saddleGroup = new THREE.Group()
  saddleGroup.name = 'saddle-assembly'
  saddleGroup.add(tube([0.365, 0.72], [0.315, 0.9], 0.013, bikeMaterials.darkMetal, 1, 'seatpost'))
  saddleGroup.add(disc(0.021, 0.025, bikeMaterials.darkMetal, [0.352, 0.775], 2, 'seat-clamp'))
  const saddle = new THREE.Mesh(new THREE.SphereGeometry(1, 18, 12), bikeMaterials.vinyl)
  saddle.scale.set(0.135, 0.03, 0.062)
  saddle.position.set(0.3, 0.925, 0)
  saddle.rotation.z = 0.1 // nose dips, tail kicks
  saddle.userData.tier = 0
  saddle.name = 'saddle'
  saddleGroup.add(saddle)
  const tail = new THREE.Mesh(new THREE.SphereGeometry(1, 12, 8), bikeMaterials.vinyl)
  tail.scale.set(0.05, 0.026, 0.052)
  tail.position.set(0.235, 0.943, 0)
  tail.userData.tier = 2
  tail.name = 'saddle-tail'
  saddleGroup.add(tail)
  root.add(saddleGroup)

  // ---- drivetrain ----
  const crank = new THREE.Group()
  crank.name = 'crankset'
  crank.position.set(BB[0], BB[1], 0)
  // big ring is an open torus so it reads as a chainring, not a plate
  const bigRing = new THREE.Mesh(new THREE.TorusGeometry(0.095, 0.0065, 5, 32), bikeMaterials.darkMetal)
  bigRing.position.z = 0.052
  bigRing.userData.tier = 1
  bigRing.name = 'chainring'
  crank.add(bigRing)
  const ringR = [0.078, 0.058]
  ringR.forEach((r, i) => crank.add(disc(r, 0.004, bikeMaterials.darkMetal, [0, 0, 0.062 + i * 0.01], 1, 'chainring')))
  const teeth = new THREE.Mesh(new THREE.TorusGeometry(0.1, 0.004, 4, 36), bikeMaterials.brightMetal)
  teeth.position.z = 0.052
  teeth.userData.tier = 2
  teeth.name = 'chainring-teeth'
  crank.add(teeth)
  crank.add(tube([0, 0, 0.085], [0.085, -0.147, 0.085], 0.011, bikeMaterials.darkMetal, 1, 'crank-arm'))
  crank.add(tube([0, 0, -0.085], [-0.085, 0.147, -0.085], 0.011, bikeMaterials.darkMetal, 1, 'crank-arm'))
  crank.add(box(0.095, 0.018, 0.06, bikeMaterials.darkMetal, [0.085, -0.147, 0.125], 1, 'pedal'))
  crank.add(box(0.095, 0.018, 0.06, bikeMaterials.darkMetal, [-0.085, 0.147, -0.125], 1, 'pedal'))
  root.add(crank)

  const rearDrive = new THREE.Group()
  rearDrive.name = 'rear-drivetrain'
  for (let i = 0; i < 7; i++) {
    rearDrive.add(disc(0.05 - i * 0.004, 0.003, bikeMaterials.brightMetal, [RH[0], RH[1], 0.042 + i * 0.0058], 1, 'cog'))
  }
  rearDrive.add(box(0.02, 0.05, 0.015, bikeMaterials.darkMetal, [0.01, 0.235, 0.05], 2, 'derailleur-body'))
  rearDrive.add(disc(0.014, 0.005, bikeMaterials.darkMetal, [0.035, 0.2, 0.05], 2, 'jockey-wheel'))
  rearDrive.add(disc(0.014, 0.005, bikeMaterials.darkMetal, [0.055, 0.175, 0.05], 2, 'jockey-wheel'))
  root.add(rearDrive)

  // chain: closed loop big ring → cassette with derailleur wrap underneath
  const chainCurve = new THREE.CatmullRomCurve3(
    [
      [0.52, 0.27], [0.47, 0.355], [0.3, 0.372], [0.05, 0.382], [-0.045, 0.345],
      [-0.02, 0.295], [0.035, 0.205], [0.06, 0.178], [0.25, 0.175], [0.42, 0.172], [0.505, 0.21],
    ].map((p) => new THREE.Vector3(p[0], p[1], 0.062)),
    true, 'catmullrom', 0.35,
  )
  const chain = new THREE.Mesh(new THREE.TubeGeometry(chainCurve, 56, 0.007, 5, true), bikeMaterials.chainMetal)
  chain.userData.tier = 2
  chain.name = 'chain'
  root.add(chain)

  // ---- cable loops off the pods, sagging forward then back to the frame ----
  const cables = new THREE.Group()
  cables.name = 'cable-runs'
  const cableSpecs = [
    [[0.905, 0.865, 0.1], [1.05, 0.73, 0.06], [0.62, 0.428, 0.024]], // shift → down tube surface
    [[0.905, 0.865, -0.1], [1.01, 0.72, -0.075], [0.988, 0.49, -0.052]], // brake → fork
  ]
  for (const [a, c, b] of cableSpecs) {
    const curve = new THREE.QuadraticBezierCurve3(v3(a), v3(c), v3(b))
    const cable = new THREE.Mesh(new THREE.TubeGeometry(curve, 24, 0.0035, 5), bikeMaterials.darkMetal)
    cable.userData.tier = 2
    cable.name = 'cable'
    cables.add(cable)
  }
  root.add(cables)

  root.traverse((o) => {
    if (o.isMesh) {
      o.castShadow = true
      if (o.userData.tier === undefined) o.userData.tier = 1
    }
  })

  root.userData.sculptRuntime = {
    pivots: {
      wheelRear: 'wheel-rear (spin, z axis at rear hub)',
      wheelFront: 'wheel-front (spin, z axis at front hub)',
      crank: 'crankset (spin, z axis at bottom bracket)',
      steer: 'steer group (fork+cockpit; yaw about head-tube axis if ever animated)',
    },
    sockets: { frontDropouts: 'front hub rides the fork lowers', rearDropouts: 'rear hub between the stays' },
    collider: 'none — decorative diorama prop',
    units: 'meters; ground contact at y=0, length ~1.7, bar height ~0.89',
  }
  return root
}

// tier filter for the staged build-pass reviews (0 blockout / 1 structural / 2 full)
export function setBikeTier(root, tier) {
  root.traverse((o) => {
    if (o.isMesh) o.visible = (o.userData.tier ?? 1) <= tier
  })
}
