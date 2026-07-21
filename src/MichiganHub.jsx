import { useEffect, useRef, useState } from 'react'
import { useControls } from 'leva'
import { Text, useCursor } from '@react-three/drei'
import { useFrame } from '@react-three/fiber'
import * as THREE from 'three'
import { MITTEN_PATH, UP_PATH } from './MittenLoader.jsx'

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
    trees.push([x, z, hMin + rand() * (hMax - hMin)])
  }
  return trees
}

const landGeometries = [buildLandGeometry(UP_PATH), buildLandGeometry(MITTEN_PATH)]
const landOutlines = landGeometries.map((geometry) => new THREE.EdgesGeometry(geometry, 28))
const landMaterials = [
  new THREE.MeshStandardMaterial({ color: '#eee8d5', roughness: 0.96, metalness: 0 }),
  new THREE.MeshStandardMaterial({ color: '#7f8e82', roughness: 1, metalness: 0 }),
]
const outlineMaterial = new THREE.LineBasicMaterial({ color: '#667268', transparent: true, opacity: 0.78 })
const waterMaterial = new THREE.MeshStandardMaterial({ color: '#b8c6bd', roughness: 1, metalness: 0 })
const cityMaterial = new THREE.MeshStandardMaterial({ color: '#7c8986', roughness: 0.9 })
const treeMaterial = new THREE.MeshStandardMaterial({ color: '#748769', roughness: 1 })
const DESTINATION_POSITIONS = {
  // inland of the SE tip — previous spot sat slightly offshore and missed land hits
  city: new THREE.Vector3(4.9, 0, 4.15),
  meadow: new THREE.Vector3(1.15, 0, -0.68),
}
// tilt axis ⟂ to the corner view diagonal — tips the map plane toward the iso camera
const TILT_AXIS = new THREE.Vector3(1, 0, -1).normalize()
const Y_AXIS = new THREE.Vector3(0, 1, 0)
const focusPosition = new THREE.Vector3()
const _parentQ = new THREE.Quaternion()
const _camQ = new THREE.Quaternion()
const _parentEuler = new THREE.Euler()
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

function NorthPreview() {
  return (
    <group>
      {NORTH_TREES.map(([x, z, height], index) => (
        <mesh key={index} position={[x, LAND_TOP + height / 2, z]} material={treeMaterial} raycast={NO_RAYCAST}>
          <coneGeometry args={[height * 0.26, height, 7]} />
        </mesh>
      ))}
    </group>
  )
}

function MapTrees() {
  return (
    <group>
      {MAP_TREES.map(([x, z, height], index) => (
        <mesh key={index} position={[x, LAND_TOP + height / 2, z]} material={treeMaterial} raycast={NO_RAYCAST}>
          <coneGeometry args={[height * 0.26, height, 7]} />
        </mesh>
      ))}
    </group>
  )
}

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

// Keep the floor grid flat, but yaw it against the camera azimuth so cells run
// screen-straight (not iso diamonds).
function alignGrid(grid, camera) {
  if (!grid?.parent) return
  grid.parent.updateWorldMatrix(true, false)
  grid.parent.getWorldQuaternion(_parentQ)
  _parentEuler.setFromQuaternion(_parentQ, 'YXZ')
  // atan2(x,z) is the iso corner azimuth; negate so grid X aligns with screen-horizontal
  grid.rotation.y = -Math.atan2(camera.position.x, camera.position.z) - _parentEuler.y
  grid.updateMatrixWorld()
}

function DestinationMarker({ id, chapter, label, position, highlighted, pinAngle = 0 }) {
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

  useFrame(({ clock, camera }, rawDt) => {
    faceCamera(pinBillboard.current, camera, pinAngle)

    const dt = Math.min(rawDt, 0.05)
    hoverAmount.current = THREE.MathUtils.damp(
      hoverAmount.current,
      highlighted ? 1 : 0,
      highlighted ? 9.5 : 7,
      dt,
    )
    const hover = THREE.MathUtils.smoothstep(hoverAmount.current, 0, 1)
    const wave = Math.sin(clock.elapsedTime * 2.6)
    const pulseWave = (wave + 1) * 0.5

    if (preview.current) preview.current.scale.setScalar(1 + hover * 0.115)
    if (pointLight.current) pointLight.current.intensity = hover * 11
    if (areaGlow.current) areaGlow.current.scale.setScalar(0.82 + hover * 0.18)
    if (areaGlowMaterial.current) areaGlowMaterial.current.opacity = 0.018 + hover * 0.35
    if (pulse.current) {
      const scale = 1 + pulseWave * (0.055 + hover * 0.12)
      pulse.current.scale.setScalar(scale)
    }
    if (pulseMaterial.current) {
      pulseMaterial.current.opacity = 0.48 + hover * 0.42 - pulseWave * hover * 0.12
    }
    if (pinBillboard.current) {
      pinBillboard.current.position.y = 1.12 + hover * 0.12 + wave * (0.012 + hover * 0.012)
      pinBillboard.current.scale.setScalar(0.8 + hover * 0.08)
    }
    if (pinMaterial.current) pinMaterial.current.emissiveIntensity = 0.06 + hover * 0.42
    if (pinCore.current) pinCore.current.scale.setScalar(1 + hover * 0.13)
    if (labelPanel.current) {
      labelPanel.current.position.y = 0.8 + hover * 0.035
      labelPanel.current.scale.setScalar(1 + hover * 0.025)
    }
    if (labelMaterial.current) labelMaterial.current.opacity = 0.88 + hover * 0.12
  }, BEFORE_FBO)

  return (
    <group position={position}>
      <group ref={preview}>
        {id === 'city' ? <CityPreview /> : <NorthPreview />}
      </group>
      <pointLight
        ref={pointLight}
        position={[0, 1.45, 0]}
        color={id === 'city' ? '#8fc5d2' : '#b8d69e'}
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
        ref={areaGlow}
        rotation-x={-Math.PI / 2}
        position-y={0.405}
        raycast={NO_RAYCAST}
      >
        <circleGeometry args={[1.55, 48]} />
        <meshBasicMaterial
          ref={areaGlowMaterial}
          color={id === 'city' ? '#20606f' : '#42663a'}
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
          color={id === 'city' ? '#1d4d59' : '#3d5a36'}
          transparent
          opacity={0.48}
          depthWrite={false}
          toneMapped={false}
        />
      </mesh>
      <group ref={pinBillboard} position-y={1.12} scale={0.8}>
        <mesh geometry={pinGeometry} raycast={NO_RAYCAST}>
          <meshStandardMaterial
            ref={pinMaterial}
            color={id === 'city' ? '#4d7580' : '#6f8b65'}
            emissive={id === 'city' ? '#2e7381' : '#4e7040'}
            emissiveIntensity={0.06}
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
            <planeGeometry args={[1.48, 0.42]} />
            <meshBasicMaterial
              ref={labelMaterial}
              color="#f4f0e3"
              transparent
              opacity={0.88}
              toneMapped={false}
            />
          </mesh>
          <Text
            position-z={0.055}
            fontSize={0.18}
            letterSpacing={0.07}
            color="#26312d"
            anchorX="center"
            anchorY="middle"
            material-toneMapped={false}
            raycast={NO_RAYCAST}
          >
            {`${chapter}  ${label.toUpperCase()}`}
          </Text>
        </group>
      </group>
    </group>
  )
}

export function MichiganHub({ onSelect, transition }) {
  const mapRoot = useRef(null)
  const grid = useRef(null)
  const [hoveredRegion, setHoveredRegion] = useState(null)
  useCursor(Boolean(hoveredRegion))

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

  useFrame(() => {
    const root = mapRoot.current
    if (!root) return

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

  useFrame(({ camera }) => {
    alignGrid(grid.current, camera)
  }, BEFORE_FBO)

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
        <mesh rotation-x={-Math.PI / 2} position-y={-0.12} material={waterMaterial} receiveShadow raycast={NO_RAYCAST}>
          <planeGeometry args={[60, 60]} />
        </mesh>
        <gridHelper
          ref={grid}
          args={[60, 120, '#89978e', '#b2beb5']}
          position-y={-0.105}
          rotation-y={-Math.PI / 4}
          material-transparent
          material-opacity={0.2}
          raycast={NO_RAYCAST}
        />
        <group rotation-y={angle}>
        {landGeometries.map((geometry, index) => (
          <group key={index}>
            {/* land is scenery only — the markers are the sole click targets */}
            <mesh geometry={geometry} material={landMaterials} castShadow receiveShadow raycast={NO_RAYCAST} />
            <lineSegments geometry={landOutlines[index]} material={outlineMaterial} position-y={0.006} raycast={NO_RAYCAST} />
          </group>
        ))}

        <MapTrees />

        <group
          onClick={(event) => {
            event.stopPropagation()
            onSelect(event.object.userData.destination)
          }}
          onPointerMove={(event) => {
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
            chapter="01"
            label="Detroit"
            position={DESTINATION_POSITIONS.city}
            highlighted={hoveredRegion === 'city'}
            pinAngle={pinAngle}
          />
          <DestinationMarker
            id="meadow"
            chapter="02"
            label="Up North"
            position={DESTINATION_POSITIONS.meadow}
            highlighted={hoveredRegion === 'meadow'}
            pinAngle={pinAngle}
          />
        </group>
        </group>
      </group>
      </group>
    </>
  )
}
