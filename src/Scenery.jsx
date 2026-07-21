import { useRef } from 'react'
import * as THREE from 'three'
import { useFrame } from '@react-three/fiber'
import { stampSceneryMask } from './rocks/rockMask.js'
import { sceneRendering } from './sceneState.js'

// Static set dressing: a gabled cottage above the dune and a lounging scene
// on the sand. All primitives/extrudes + procedural Lambert materials, lit by
// the rig in Rocks.jsx and painted over by the same optional style pass.

// ponytail: fixed placements, no leva folder — add one if these ever need tuning
// House on grass above the dune, camp on the dry-sand band before the
// waterline (coast now sits inside the tile — see coast.js).
const HOUSE = { x: -4.1, z: -2.3, rotY: 0.12 }
const CAMP = { x: 2.0, z: -3.9 }
const STONES = [
  [-2.55, -2.35],
  [-2.05, -2.42],
  [-1.55, -2.5],
]

// keep grass from growing through the floor plan / towel / stones
stampSceneryMask([
  { x: HOUSE.x, z: HOUSE.z, r: 1.45 },
  { x: CAMP.x, z: CAMP.z, r: 0.55 },
  { x: CAMP.x + 0.75, z: CAMP.z + 0.35, r: 0.3 },
  { x: CAMP.x - 0.55, z: CAMP.z + 0.15, r: 0.25 },
  ...STONES.map(([x, z]) => ({ x, z, r: 0.18 })),
])

const lambert = (color, extra) => new THREE.MeshLambertMaterial({ color, ...extra })

// Add stable object-space surface detail without image assets. Object space is
// important here: every pattern remains attached to its mesh when the whole
// cottage is rotated or moved around the field.
function texturedLambert(color, key, surfaceCode, extra = {}) {
  const material = lambert(color, extra)
  material.onBeforeCompile = (shader) => {
    shader.vertexShader = shader.vertexShader
      .replace(
        '#include <common>',
        `#include <common>
        varying vec3 vSurfacePosition;
        varying vec3 vSurfaceNormal;`,
      )
      .replace(
        '#include <begin_vertex>',
        `#include <begin_vertex>
        vSurfacePosition = position;
        vSurfaceNormal = normal;`,
      )

    shader.fragmentShader = shader.fragmentShader
      .replace(
        '#include <common>',
        `#include <common>
        varying vec3 vSurfacePosition;
        varying vec3 vSurfaceNormal;

        float surfaceHash(vec2 p) {
          return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453);
        }
        float surfaceNoise(vec2 p) {
          vec2 i = floor(p);
          vec2 f = fract(p);
          f = f * f * (3.0 - 2.0 * f);
          return mix(
            mix(surfaceHash(i), surfaceHash(i + vec2(1.0, 0.0)), f.x),
            mix(surfaceHash(i + vec2(0.0, 1.0)), surfaceHash(i + vec2(1.0, 1.0)), f.x),
            f.y
          );
        }
        float surfaceFbm(vec2 p) {
          float value = 0.0;
          float amplitude = 0.5;
          mat2 turn = mat2(0.8, -0.6, 0.6, 0.8);
          for (int i = 0; i < 4; i++) {
            value += surfaceNoise(p) * amplitude;
            p = turn * p * 2.05;
            amplitude *= 0.5;
          }
          return value;
        }
        vec2 surfaceWallUv() {
          vec3 face = abs(normalize(vSurfaceNormal));
          float horizontal = face.x > face.z ? vSurfacePosition.z : vSurfacePosition.x;
          return vec2(horizontal, vSurfacePosition.y);
        }`,
      )
      .replace(
        'vec4 diffuseColor = vec4( diffuse, opacity );',
        `vec3 surfaceColor = diffuse;
        ${surfaceCode}
        vec4 diffuseColor = vec4(surfaceColor, opacity);`,
      )
  }
  material.customProgramCacheKey = () => key
  return material
}

const plaster = texturedLambert('#f0e6cf', 'cottage-plaster-v1', /* glsl */ `
  vec2 wallUv = surfaceWallUv();
  float plasterCloud = surfaceFbm(wallUv * vec2(2.7, 3.8) + 4.0);
  float limeVariation = smoothstep(0.20, 0.82, plasterCloud);
  surfaceColor *= mix(0.89, 1.07, limeVariation);

  float baseWeather = 1.0 - smoothstep(0.04, 0.42, vSurfacePosition.y);
  float dampVariation = surfaceNoise(wallUv * vec2(2.0, 5.0) + 18.0);
  surfaceColor = mix(surfaceColor, surfaceColor * vec3(0.68, 0.72, 0.64),
    baseWeather * mix(0.12, 0.34, dampVariation));

  vec2 poreGrid = wallUv * vec2(31.0, 34.0);
  vec2 poreCell = floor(poreGrid);
  vec2 porePoint = vec2(surfaceHash(poreCell + 7.0), surfaceHash(poreCell + 19.0));
  float pore = (1.0 - smoothstep(0.045, 0.11, length(fract(poreGrid) - porePoint)))
    * step(0.78, surfaceHash(poreCell + 31.0));
  surfaceColor *= 1.0 - pore * 0.20;

  float crackCell = floor(wallUv.x * 1.35);
  float crackSeed = surfaceHash(vec2(crackCell, 57.0));
  float crackX = (crackCell + 0.5) / 1.35
    + (surfaceNoise(vec2(wallUv.y * 4.8, crackCell + 9.0)) - 0.5) * 0.12;
  float crackFade = smoothstep(0.12, 0.28, wallUv.y)
    * (1.0 - smoothstep(0.72, 1.02, wallUv.y));
  float crack = (1.0 - smoothstep(0.004, 0.014, abs(wallUv.x - crackX)))
    * crackFade * step(0.76, crackSeed);
  surfaceColor *= 1.0 - crack * 0.34;
`, { flatShading: true })

const roofClay = texturedLambert('#a8553d', 'cottage-roof-clay-v1', /* glsl */ `
  float rowCoord = abs(vSurfacePosition.z) * 7.6;
  float rowId = floor(rowCoord);
  float withinRow = fract(rowCoord);
  float rowEdge = min(withinRow, 1.0 - withinRow);
  float rowMortar = 1.0 - smoothstep(0.025, 0.105, rowEdge);

  float tileCoord = vSurfacePosition.x * 3.8 + mod(rowId, 2.0) * 0.5;
  float withinTile = fract(tileCoord);
  float tileEdge = min(withinTile, 1.0 - withinTile);
  float tileMortar = (1.0 - smoothstep(0.025, 0.085, tileEdge))
    * smoothstep(0.10, 0.24, withinRow);

  float tileTone = surfaceHash(vec2(floor(tileCoord), rowId) + 23.0);
  surfaceColor *= mix(0.86, 1.12, tileTone);
  float clayMottle = surfaceFbm(vSurfacePosition.xz * 5.5 + 13.0);
  surfaceColor *= mix(0.90, 1.08, clayMottle);
  surfaceColor = mix(surfaceColor, surfaceColor * vec3(0.48, 0.55, 0.58),
    clamp(rowMortar * 0.48 + tileMortar * 0.34, 0.0, 0.62));

  float lichen = smoothstep(0.78, 0.91,
    surfaceNoise(vSurfacePosition.xz * vec2(8.0, 11.0) + 41.0));
  surfaceColor = mix(surfaceColor, vec3(0.36, 0.34, 0.22), lichen * 0.15);
`, { flatShading: true })

const houseWood = texturedLambert('#6d4c33', 'cottage-wood-v1', /* glsl */ `
  vec2 woodUv = surfaceWallUv();
  float longAxis = woodUv.y * 11.0;
  float grain = surfaceNoise(vec2(longAxis, woodUv.x * 2.2 + surfaceNoise(woodUv * 3.0)));
  float rings = sin(longAxis * 3.4 + grain * 5.0) * 0.5 + 0.5;
  surfaceColor *= mix(0.72, 1.12, rings * 0.62 + grain * 0.38);
  float knot = smoothstep(0.88, 0.97, surfaceNoise(woodUv * vec2(3.0, 5.0) + 29.0));
  surfaceColor = mix(surfaceColor, surfaceColor * 0.52, knot * 0.42);
`)

const shutterGreen = texturedLambert('#6f7f57', 'cottage-shutters-v1', /* glsl */ `
  vec2 woodUv = surfaceWallUv();
  float grain = surfaceNoise(vec2(woodUv.y * 13.0, woodUv.x * 3.0 + 8.0));
  surfaceColor *= mix(0.78, 1.13, grain);
  float wornEdge = smoothstep(0.76, 0.94, surfaceFbm(woodUv * 8.0 + 21.0));
  surfaceColor = mix(surfaceColor, vec3(0.43, 0.36, 0.24), wornEdge * 0.18);
`)

const brick = texturedLambert('#96604c', 'cottage-brick-v1', /* glsl */ `
  vec2 wallUv = surfaceWallUv();
  float course = floor((wallUv.y + 0.34) * 7.2);
  float rowUv = fract((wallUv.y + 0.34) * 7.2);
  float brickUv = fract(wallUv.x * 7.8 + mod(course, 2.0) * 0.5);
  float mortarY = min(rowUv, 1.0 - rowUv);
  float mortarX = min(brickUv, 1.0 - brickUv);
  float mortar = max(
    1.0 - smoothstep(0.035, 0.11, mortarY),
    1.0 - smoothstep(0.035, 0.10, mortarX)
  );
  float brickTone = surfaceHash(vec2(floor(wallUv.x * 7.8 + mod(course, 2.0) * 0.5), course));
  surfaceColor *= mix(0.80, 1.12, brickTone);
  surfaceColor = mix(surfaceColor, vec3(0.58, 0.53, 0.45), mortar * 0.62);
`)

const houseStone = texturedLambert('#b9b3a2', 'cottage-stone-v1', /* glsl */ `
  vec2 wallUv = surfaceWallUv();
  float stoneGrain = surfaceFbm(wallUv * vec2(7.0, 9.0) + 17.0);
  surfaceColor *= mix(0.76, 1.14, stoneGrain);
  float chip = smoothstep(0.82, 0.95, surfaceNoise(wallUv * 18.0 + 7.0));
  surfaceColor = mix(surfaceColor, surfaceColor * 0.54, chip * 0.35);
`, { flatShading: true })

const trim = lambert('#f6f1e3')
const wood = lambert('#6d4c33')
const stone = lambert('#b9b3a2')
const glow = lambert('#3a2f22', { emissive: '#ffcf7d', emissiveIntensity: 0.7 })
const towel = lambert('#d96f57')
const skin = lambert('#e8b48f')
const skinShadow = lambert('#d79a76')
const suitTeal = lambert('#4f8a8b')
const suitTealDark = lambert('#356a6d')
const suitPlum = lambert('#8a5a72')
const suitPlumDark = lambert('#684052')
const hairChestnut = lambert('#57392d')
const hairDark = lambert('#2f2724')
const faceDetail = lambert('#5d3832')
const skinTan = lambert('#cf9068')
const skinTanShadow = lambert('#aa6f4f')
const blush = lambert('#e29078')
const eyeDark = lambert('#332a26')
const canopy = lambert('#e0584b', { flatShading: true, side: THREE.DoubleSide })
const canopyCream = lambert('#f2ecdd', { flatShading: true, side: THREE.DoubleSide })
const straw = lambert('#dcbf6f')
const hatBandTeal = lambert('#315e61')
const hatBandPlum = lambert('#75475c')
const roofRidge = lambert('#8f4433', { flatShading: true })

// --- cottage geometry ------------------------------------------------------
// Ridge runs along x. W = ridge length, D = depth, H = wall height, P = gable
// peak above the walls. Body is the gable-end pentagon extruded along the
// ridge; roof is a chevron slab extruded the same way, so eaves, gable
// overhangs, and roof thickness all come for free — no rotated-box math.
const W = 2.1
const D = 1.5
const H = 1.05
const P = 0.8
const OV = 0.3 // eave overhang beyond the wall
const RT = 0.1 // roof slab thickness (measured vertically)

function extrudeAlongRidge(shape, length) {
  const geo = new THREE.ExtrudeGeometry(shape, { depth: length, bevelEnabled: false })
  geo.translate(0, 0, -length / 2)
  geo.rotateY(Math.PI / 2)
  return geo
}

const bodyShape = new THREE.Shape()
bodyShape.moveTo(-D / 2, 0)
bodyShape.lineTo(D / 2, 0)
bodyShape.lineTo(D / 2, H)
bodyShape.lineTo(0, H + P)
bodyShape.lineTo(-D / 2, H)
bodyShape.closePath()
const bodyGeometry = extrudeAlongRidge(bodyShape, W)

const eaveX = D / 2 + OV
const eaveY = H - OV * (P / (D / 2)) // continue the slope line past the wall
const roofShape = new THREE.Shape()
roofShape.moveTo(-eaveX, eaveY)
roofShape.lineTo(0, H + P)
roofShape.lineTo(eaveX, eaveY)
roofShape.lineTo(eaveX, eaveY + RT)
roofShape.lineTo(0, H + P + RT)
roofShape.lineTo(-eaveX, eaveY + RT)
roofShape.closePath()
const roofGeometry = extrudeAlongRidge(roofShape, W + 0.35)

function archShape(w, h) {
  const r = w / 2
  const s = new THREE.Shape()
  s.moveTo(-r, 0)
  s.lineTo(-r, h - r)
  s.absarc(0, h - r, r, Math.PI, 0, true)
  s.lineTo(r, 0)
  s.closePath()
  return s
}
// arched door + slightly larger frame, both sitting proud of the +x gable end
const doorGeometry = new THREE.ExtrudeGeometry(archShape(0.36, 0.68), { depth: 0.06, bevelEnabled: false })
doorGeometry.rotateY(Math.PI / 2)
const doorFrameGeometry = new THREE.ExtrudeGeometry(archShape(0.46, 0.76), { depth: 0.05, bevelEnabled: false })
doorFrameGeometry.rotateY(Math.PI / 2)

// framed window with shutters, on the +z long face
function Window({ x, flowers = false }) {
  return (
    <group position={[x, 0.62, D / 2]}>
      <mesh material={trim}>
        <boxGeometry args={[0.38, 0.38, 0.05]} />
      </mesh>
      <mesh material={glow}>
        <boxGeometry args={[0.3, 0.3, 0.09]} />
      </mesh>
      {/* mullion cross + sill */}
      <mesh position={[0, 0, 0.048]} material={trim}>
        <boxGeometry args={[0.028, 0.3, 0.02]} />
      </mesh>
      <mesh position={[0, 0, 0.048]} material={trim}>
        <boxGeometry args={[0.3, 0.028, 0.02]} />
      </mesh>
      <mesh position={[0, -0.21, 0.02]} material={trim}>
        <boxGeometry args={[0.46, 0.05, 0.1]} />
      </mesh>
      <mesh position={[-0.26, 0, 0]} material={shutterGreen}>
        <boxGeometry args={[0.1, 0.36, 0.03]} />
      </mesh>
      <mesh position={[0.26, 0, 0]} material={shutterGreen}>
        <boxGeometry args={[0.1, 0.36, 0.03]} />
      </mesh>
      {flowers && (
        <group position={[0, -0.33, 0.06]}>
          <mesh material={houseWood}>
            <boxGeometry args={[0.36, 0.08, 0.09]} />
          </mesh>
          {[
            [-0.1, '#d96f57'],
            [0.02, '#e8c76a'],
            [0.12, '#f0e6cf'],
          ].map(([fx, color]) => (
            <mesh key={color} position={[fx, 0.06, 0]}>
              <sphereGeometry args={[0.045, 8, 6]} />
              <meshLambertMaterial color={color} />
            </mesh>
          ))}
        </group>
      )}
    </group>
  )
}

const PUFFS = 4
function Smoke() {
  const puffs = useRef([])
  useFrame(({ clock }) => {
    if (!sceneRendering('meadow')) return
    const t = clock.getElapsedTime()
    for (let i = 0; i < PUFFS; i++) {
      const m = puffs.current[i]
      if (!m) continue
      const p = (t * 0.11 + i / PUFFS) % 1
      // rise, drift with the wind (+z, matching the gust field), swell, fade
      m.position.set(Math.sin(p * 5 + i) * 0.06, p * 1.15, p * 0.4)
      m.scale.setScalar(0.07 + p * 0.18)
      m.material.opacity = 0.5 * (1 - p) * Math.min(1, p * 6)
    }
  })
  return (
    <group>
      {Array.from({ length: PUFFS }, (_, i) => (
        <mesh
          key={i}
          ref={(m) => {
            puffs.current[i] = m
          }}
        >
          <sphereGeometry args={[1, 10, 8]} />
          <meshLambertMaterial color="#f2efe8" transparent depthWrite={false} />
        </mesh>
      ))}
    </group>
  )
}

function House() {
  return (
    <group position={[HOUSE.x, 0, HOUSE.z]} rotation-y={HOUSE.rotY}>
      {/* stone footing peeking out under the walls */}
      <mesh position={[0, 0.06, 0]} material={houseStone}>
        <boxGeometry args={[W + 0.12, 0.12, D + 0.12]} />
      </mesh>
      <mesh geometry={bodyGeometry} material={plaster} castShadow />
      <mesh geometry={roofGeometry} material={roofClay} castShadow />
      {/* ridge cap along the peak */}
      <mesh position={[0, H + P + RT, 0]} rotation-z={Math.PI / 2} material={roofRidge}>
        <cylinderGeometry args={[0.055, 0.055, W + 0.35, 8]} />
      </mesh>
      {/* timber framing on the gable end: beam at wall height + raking beams */}
      <mesh position={[W / 2 + 0.01, H - 0.02, 0]} material={houseWood}>
        <boxGeometry args={[0.05, 0.07, D + 0.08]} />
      </mesh>
      {[-1, 1].map((s) => (
        <mesh
          key={s}
          position={[W / 2 + 0.01, H + P / 2, s * (D / 4 + 0.015)]}
          rotation-x={-s * 0.755}
          material={houseWood}
        >
          <boxGeometry args={[0.05, 1.05, 0.07]} />
        </mesh>
      ))}
      {/* chimney on the ridge + cap */}
      <mesh position={[0.65, H + P + 0.02, 0]} material={brick} castShadow>
        <boxGeometry args={[0.22, 0.62, 0.22]} />
      </mesh>
      <mesh position={[0.65, H + P + 0.36, 0]} material={brick}>
        <boxGeometry args={[0.3, 0.07, 0.3]} />
      </mesh>
      <group position={[0.65, H + P + 0.42, 0]}>
        <Smoke />
      </group>
      {/* arched door on the +x gable end, facing the path */}
      <mesh geometry={doorFrameGeometry} position={[W / 2 - 0.01, 0, 0]} material={trim} />
      <mesh geometry={doorGeometry} position={[W / 2 + 0.02, 0, 0]} material={houseWood} />
      <mesh position={[W / 2 + 0.085, 0.36, 0.1]} material={trim}>
        <sphereGeometry args={[0.02, 8, 6]} />
      </mesh>
      <mesh position={[W / 2 + 0.1, 0.02, 0]} material={houseStone}>
        <cylinderGeometry args={[0.24, 0.26, 0.06, 10]} />
      </mesh>
      {/* round window up in the gable */}
      <group position={[W / 2 + 0.01, H + P * 0.45, 0]} rotation-z={Math.PI / 2}>
        <mesh material={trim}>
          <cylinderGeometry args={[0.13, 0.13, 0.04, 12]} />
        </mesh>
        <mesh material={glow}>
          <cylinderGeometry args={[0.09, 0.09, 0.07, 12]} />
        </mesh>
      </group>
      {/* two shuttered windows on the +z long face */}
      <Window x={-0.55} flowers />
      <Window x={0.45} />
    </group>
  )
}

function SteppingStones() {
  return (
    <group>
      {STONES.map(([x, z], i) => (
        <mesh key={i} position={[x, 0.015, z]} rotation-y={i * 1.3} material={stone}>
          <cylinderGeometry args={[0.17, 0.19, 0.05, 9]} />
        </mesh>
      ))}
    </group>
  )
}

const UP = new THREE.Vector3(0, 1, 0)

// A capsule stretched between two joint points — limbs stay connected because
// segments derive from shared joint coordinates instead of hand-placed transforms.
function Segment({ from, to, r, material }) {
  const a = new THREE.Vector3(...from)
  const b = new THREE.Vector3(...to)
  const dir = b.clone().sub(a)
  const length = Math.max(dir.length() - r, 0.02)
  const quaternion = new THREE.Quaternion().setFromUnitVectors(UP, dir.normalize())
  return (
    <mesh position={a.add(b).multiplyScalar(0.5).toArray()} quaternion={quaternion} material={material} castShadow>
      <capsuleGeometry args={[r, length, 5, 10]} />
    </mesh>
  )
}

// Two-segment limb: joints = [root, middle, end]; optional tip adds a hand/foot.
// The joint sphere shares the lower segment's material so knees/elbows read as
// bare skin, not mannequin balls.
function Limb({ joints: [root, mid, end], r, materials: [upper, lower], tip }) {
  return (
    <group>
      <Segment from={root} to={mid} r={r} material={upper} />
      <mesh position={mid} material={lower}>
        <sphereGeometry args={[r * 1.08, 10, 8]} />
      </mesh>
      <Segment from={mid} to={end} r={r * 0.85} material={lower} />
      {tip && <Segment from={end} to={tip} r={r * 0.72} material={lower} />}
    </group>
  )
}

function Loungers() {
  const lyingChest = useRef()
  const lyingHat = useRef()
  const sitTorso = useRef()
  const sitHead = useRef()
  // ponytail: sine idle on refs, no animation system
  useFrame(({ clock }) => {
    if (!sceneRendering('meadow')) return
    const t = clock.getElapsedTime()
    const breath = Math.sin(t * 1.3)
    if (lyingChest.current) {
      // chest swells across the capsule's cross-section (local x/z = world y/z)
      const swell = 1 + breath * 0.055
      lyingChest.current.scale.set(swell, 1, swell * 0.82)
      lyingChest.current.position.y = 0.09 + Math.max(0, breath) * 0.005
    }
    if (lyingHat.current) lyingHat.current.rotation.z = 0.12 + breath * 0.04
    const sitBreath = Math.sin(t * 1.05 + 2.1)
    if (sitTorso.current) {
      sitTorso.current.rotation.x = 0.1 + sitBreath * 0.025
      sitTorso.current.position.y = 0.2 + sitBreath * 0.004
    }
    if (sitHead.current) {
      sitHead.current.rotation.y = 0.18 + Math.sin(t * 0.24) * 0.22
      sitHead.current.rotation.x = sitBreath * 0.025
    }
  })
  return (
    <group position={[CAMP.x, 0, CAMP.z]}>
      {/* striped towel + reclining figure */}
      <group rotation-y={0.3}>
        <mesh position={[0.05, 0.01, 0]} material={towel}>
          <boxGeometry args={[1.05, 0.02, 0.55]} />
        </mesh>
        {[-0.32, 0.42].map((sx) => (
          <mesh key={sx} position={[sx + 0.05, 0.016, 0]} material={trim}>
            <boxGeometry args={[0.09, 0.014, 0.552]} />
          </mesh>
        ))}
        {/* tapered ribcage, shoulders, and pelvis make the body less tubular */}
        <group>
          <mesh
            ref={lyingChest}
            position={[-0.015, 0.092, 0]}
            rotation-z={Math.PI / 2}
            scale={[1, 1, 0.82]}
            material={suitTeal}
            castShadow
          >
            <capsuleGeometry args={[0.073, 0.25, 6, 12]} />
          </mesh>
          <mesh position={[-0.12, 0.09, 0]} scale={[0.07, 0.052, 0.125]} material={suitTeal} castShadow>
            <sphereGeometry args={[1, 14, 10]} />
          </mesh>
          {/* swimsuit straps draped over the chest */}
          {[-1, 1].map((s) => (
            <mesh key={s} position={[-0.08, 0.148, s * 0.045]} rotation-z={Math.PI / 2} material={suitTealDark}>
              <capsuleGeometry args={[0.008, 0.1, 3, 6]} />
            </mesh>
          ))}
          <mesh
            position={[0.205, 0.083, 0]}
            rotation-z={Math.PI / 2}
            scale={[1, 1, 0.9]}
            material={suitTealDark}
            castShadow
          >
            <capsuleGeometry args={[0.068, 0.075, 5, 10]} />
          </mesh>
          <mesh position={[-0.235, 0.09, 0]} rotation-z={Math.PI / 2} material={skin}>
            <capsuleGeometry args={[0.031, 0.045, 4, 8]} />
          </mesh>
        </group>
        {/* jointed arms resting naturally beside the torso */}
        {[-1, 1].map((s) => (
          <group key={s}>
            <mesh position={[-0.135, 0.082, s * 0.1]} material={skin}>
              <sphereGeometry args={[0.031, 10, 8]} />
            </mesh>
            <mesh position={[-0.055, 0.072, s * 0.115]} rotation-z={Math.PI / 2} material={skin} castShadow>
              <capsuleGeometry args={[0.027, 0.13, 5, 9]} />
            </mesh>
            <mesh position={[0.075, 0.072, s * 0.115]} material={skin}>
              <sphereGeometry args={[0.029, 10, 8]} />
            </mesh>
            <mesh position={[0.16, 0.068, s * 0.115]} rotation-z={Math.PI / 2} material={skin} castShadow>
              <capsuleGeometry args={[0.025, 0.12, 5, 9]} />
            </mesh>
            <mesh position={[0.245, 0.064, s * 0.115]} scale={[0.04, 0.018, 0.03]} material={skin}>
              <sphereGeometry args={[1, 10, 8]} />
            </mesh>
          </group>
        ))}
        {/* straight leg: swimsuit at the thigh, then calf, ankle, and rounded foot */}
        <mesh
          position={[0.31, 0.072, -0.05]}
          rotation={[0, 0.08, Math.PI / 2]}
          material={suitTealDark}
          castShadow
        >
          <capsuleGeometry args={[0.044, 0.1, 5, 10]} />
        </mesh>
        <mesh
          position={[0.455, 0.064, -0.057]}
          rotation={[0, 0.08, Math.PI / 2]}
          material={skin}
          castShadow
        >
          <capsuleGeometry args={[0.034, 0.14, 5, 10]} />
        </mesh>
        <mesh position={[0.575, 0.07, -0.06]} rotation-z={Math.PI / 2} scale={[1, 1, 0.8]} material={skin}>
          <capsuleGeometry args={[0.028, 0.065, 5, 10]} />
        </mesh>
        {/* other leg bent at a visible knee */}
        <mesh position={[0.285, 0.135, 0.055]} rotation-z={-0.64} material={suitTealDark} castShadow>
          <capsuleGeometry args={[0.042, 0.13, 5, 10]} />
        </mesh>
        <mesh position={[0.365, 0.188, 0.055]} material={skin}>
          <sphereGeometry args={[0.04, 10, 8]} />
        </mesh>
        <mesh position={[0.435, 0.125, 0.055]} rotation-z={0.66} material={skin} castShadow>
          <capsuleGeometry args={[0.032, 0.14, 5, 10]} />
        </mesh>
        <mesh position={[0.535, 0.045, 0.055]} rotation-z={Math.PI / 2} scale={[1, 1, 0.82]} material={skin}>
          <capsuleGeometry args={[0.027, 0.055, 5, 10]} />
        </mesh>
        {/* head, hairline, nose, and a properly seated straw hat */}
        <group position={[-0.31, 0.095, 0]}>
          <mesh position={[0.012, 0.005, 0.012]} material={hairChestnut} castShadow>
            <sphereGeometry args={[0.084, 16, 12]} />
          </mesh>
          <mesh position={[-0.006, 0.005, -0.012]} scale={[0.9, 1.03, 0.88]} material={skin} castShadow>
            <sphereGeometry args={[0.08, 16, 12]} />
          </mesh>
          <mesh position={[-0.035, 0.075, -0.014]} scale={[0.012, 0.018, 0.014]} material={skinShadow}>
            <sphereGeometry args={[1, 8, 6]} />
          </mesh>
        </group>
        <group ref={lyingHat} position={[-0.325, 0.174, 0.002]} rotation-z={0.12}>
          <mesh material={straw} castShadow>
            <cylinderGeometry args={[0.143, 0.143, 0.018, 20]} />
          </mesh>
          <mesh position={[0, 0.016, 0]} material={hatBandTeal}>
            <cylinderGeometry args={[0.073, 0.078, 0.022, 16]} />
          </mesh>
          <mesh position={[0, 0.053, 0]} material={straw} castShadow>
            <cylinderGeometry args={[0.065, 0.078, 0.055, 16]} />
          </mesh>
        </group>
      </group>
      {/* relaxed three-quarter seated figure: one raised knee, one long leg */}
      <group position={[0.78, 0, 0.42]} rotation-y={-0.16} scale={1.08}>
        <group>
          <mesh
            ref={sitTorso}
            position={[0, 0.2, 0.015]}
            rotation-x={0.1}
            scale={[1, 1, 0.72]}
            material={suitPlum}
            castShadow
          >
            <capsuleGeometry args={[0.068, 0.18, 6, 12]} />
          </mesh>
          <mesh position={[0, 0.305, 0]} scale={[0.1, 0.043, 0.058]} material={suitPlum} castShadow>
            <sphereGeometry args={[1, 14, 10]} />
          </mesh>
          <mesh position={[0, 0.075, 0.005]} scale={[0.088, 0.052, 0.055]} material={suitPlum} castShadow>
            <sphereGeometry args={[1, 12, 9]} />
          </mesh>
          <mesh position={[0, 0.365, 0.018]} material={skinTan}>
            <cylinderGeometry args={[0.029, 0.034, 0.052, 10]} />
          </mesh>
        </group>
        {/* a smaller hat leaves a clear head-and-neck silhouette from above */}
        <group ref={sitHead} position={[0, 0.438, 0.01]} rotation-y={0.18}>
          <mesh position={[0, 0.01, 0.027]} scale={[1, 1.07, 0.93]} material={hairDark} castShadow>
            <sphereGeometry args={[0.076, 16, 12]} />
          </mesh>
          {/* low bun tucked under the hat brim */}
          <mesh position={[0, -0.005, 0.092]} material={hairDark} castShadow>
            <sphereGeometry args={[0.033, 12, 9]} />
          </mesh>
          <mesh position={[0, -0.002, -0.008]} scale={[0.91, 1.04, 0.88]} material={skinTan} castShadow>
            <sphereGeometry args={[0.073, 16, 12]} />
          </mesh>
          {[-1, 1].map((s) => (
            <mesh key={s} position={[s * 0.067, -0.003, 0]} scale={[0.011, 0.018, 0.011]} material={skinTanShadow}>
              <sphereGeometry args={[1, 8, 6]} />
            </mesh>
          ))}
          {/* open eyes looking out to sea + blush */}
          {[-1, 1].map((s) => (
            <mesh key={`eye${s}`} position={[s * 0.026, 0.012, -0.066]} scale={[0.0085, 0.011, 0.006]} material={eyeDark}>
              <sphereGeometry args={[1, 8, 6]} />
            </mesh>
          ))}
          {[-1, 1].map((s) => (
            <mesh key={`blush${s}`} position={[s * 0.045, -0.016, -0.056]} scale={[0.013, 0.008, 0.007]} material={blush}>
              <sphereGeometry args={[1, 8, 6]} />
            </mesh>
          ))}
          <mesh position={[0, -0.004, -0.074]} scale={[0.01, 0.016, 0.013]} material={skinTanShadow}>
            <sphereGeometry args={[1, 8, 6]} />
          </mesh>
          <mesh position={[0, -0.029, -0.07]} scale={[0.019, 0.0035, 0.004]} material={faceDetail}>
            <sphereGeometry args={[1, 8, 6]} />
          </mesh>
          <group position={[0, 0.07, 0]} rotation-z={-0.06}>
            <mesh material={straw} castShadow>
              <cylinderGeometry args={[0.116, 0.116, 0.014, 20]} />
            </mesh>
            <mesh position={[0, 0.016, 0]} material={hatBandPlum}>
              <cylinderGeometry args={[0.066, 0.07, 0.02, 16]} />
            </mesh>
            <mesh position={[0, 0.049, 0]} material={straw} castShadow>
              <cylinderGeometry args={[0.06, 0.07, 0.048, 16]} />
            </mesh>
          </group>
        </group>
        {/* bare shoulders round off where the arms meet the suit */}
        <mesh position={[-0.085, 0.28, 0.02]} material={skinTan}>
          <sphereGeometry args={[0.03, 10, 8]} />
        </mesh>
        <mesh position={[0.085, 0.28, 0]} material={skinTan}>
          <sphereGeometry args={[0.03, 10, 8]} />
        </mesh>
        {/* left arm props the torso from behind, palm flat on the sand */}
        <Limb
          joints={[[-0.085, 0.28, 0.02], [-0.11, 0.16, 0.09], [-0.14, 0.03, 0.16]]}
          r={0.025}
          materials={[skinTan, skinTan]}
          tip={[-0.16, 0.018, 0.2]}
        />
        {/* right arm drapes over the raised knee, hand hanging past it */}
        <Limb
          joints={[[0.085, 0.28, 0], [0.13, 0.17, -0.055], [0.11, 0.27, -0.12]]}
          r={0.025}
          materials={[skinTan, skinTan]}
          tip={[0.1, 0.255, -0.165]}
        />
        {/* raised right leg, foot planted on the sand */}
        <Limb
          joints={[[0.04, 0.08, 0], [0.1, 0.24, -0.12], [0.115, 0.04, -0.185]]}
          r={0.034}
          materials={[suitPlumDark, skinTan]}
          tip={[0.125, 0.028, -0.255]}
        />
        {/* left leg stretched toward the water, toes up */}
        <Limb
          joints={[[-0.04, 0.08, 0], [-0.075, 0.065, -0.185], [-0.105, 0.04, -0.36]]}
          r={0.034}
          materials={[suitPlumDark, skinTan]}
          tip={[-0.11, 0.058, -0.41]}
        />
      </group>
      {/* striped parasol leaning over the towel, finial on top */}
      <group position={[-0.55, 0, 0.15]} rotation-z={0.26}>
        <mesh position={[0, 0.55, 0]} material={wood}>
          <cylinderGeometry args={[0.016, 0.02, 1.25, 6]} />
        </mesh>
        {Array.from({ length: 8 }, (_, i) => (
          <mesh key={i} position={[0, 1.0, 0]} material={i % 2 ? canopyCream : canopy} castShadow>
            <coneGeometry args={[0.55, 0.3, 2, 1, true, (i * Math.PI) / 4, Math.PI / 4]} />
          </mesh>
        ))}
        <mesh position={[0, 1.19, 0]} material={canopy}>
          <sphereGeometry args={[0.045, 10, 8]} />
        </mesh>
      </group>
    </group>
  )
}

export function Scenery() {
  return (
    <group>
      <House />
      <SteppingStones />
      <Loungers />
    </group>
  )
}
