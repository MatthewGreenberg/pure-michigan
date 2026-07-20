import { useEffect } from 'react'
import * as THREE from 'three'
import { useControls, button, folder } from 'leva'
import { GRID, TILE } from '../grass/constants.js'
import { COAST_EDGE } from '../coast.js'
import { stampRockMask, overlapsScenery } from './rockMask.js'

const MAX_ROCKS = 80
const HALF = (GRID * TILE) / 2

// seed-gated like the grass tiles: sliders re-scatter with the same layout,
// only the "randomize" button rolls a new arrangement
let seed = 4242
function reseed() {
  seed = (Math.random() * 0xffffffff) >>> 0
}

function mulberry32(s) {
  return function () {
    s = (s + 0x6d2b79f5) | 0
    let t = Math.imul(s ^ (s >>> 15), 1 | s)
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

// ponytail: module singletons, same deal as Grass.jsx — one <Rocks>, and the
// React Compiler lint forbids render-scope mutation.

// A moderately faceted sphere makes a readable boulder without becoming a
// geometric jewel. Per-instance rotation/squash/scale hides repetition.
const geometry = new THREE.IcosahedronGeometry(1, 2)
const basePos = geometry.attributes.position.array.slice()

// displacement is a function of base position, so duplicated (non-indexed)
// vertices move together and the surface stays watertight
function reshape(jag) {
  const rand = mulberry32(seed ^ 0x9e3779b9)
  const phase = Array.from({ length: 6 }, () => rand() * Math.PI * 2)
  const pos = geometry.attributes.position
  const v = new THREE.Vector3()
  for (let i = 0; i < pos.count; i++) {
    v.fromArray(basePos, i * 3)
    const n =
      0.65 * Math.sin(v.x * 2.1 + phase[0]) * Math.sin(v.y * 1.8 + phase[1]) +
      0.25 * Math.sin(v.y * 3.4 + phase[2]) * Math.sin(v.z * 3.0 + phase[3]) +
      0.1 * Math.sin(v.z * 4.5 + phase[4]) * Math.sin(v.x * 4.1 + phase[5])
    v.multiplyScalar(1 + jag * n)
    // Clip the hidden underside so the boulder can be buried slightly without
    // poking through the field's floating edge.
    pos.setXYZ(i, v.x, Math.max(v.y, -0.45), v.z)
  }
  pos.needsUpdate = true
  geometry.computeVertexNormals()
}

// Matte diffuse shading reads as stone and avoids both glossy highlights and
// the posterized bands that made the earlier rocks look artificial.
const material = new THREE.MeshLambertMaterial({ flatShading: true })

// moss: world-space noise patches on up-facing surfaces, mixed into the
// diffuse before the toon ramp so moss picks up the same cel bands.
// leva writes here transiently (same pattern as the grass wind folder).
const mossUniforms = {
  uMoss: { value: 0.12 },
  uMossColor: { value: new THREE.Color('#667a4c') },
  uMossScale: { value: 2.4 },
}
// module-level setters: the React Compiler lint flags direct mutation of
// module vars inside the component's onChange closures, but not calls out
const setMossAmount = (v) => { mossUniforms.uMoss.value = v }
const setMossScale = (v) => { mossUniforms.uMossScale.value = v }
const setMossColor = (v) => mossUniforms.uMossColor.value.set(v)

material.onBeforeCompile = (shader) => {
  Object.assign(shader.uniforms, mossUniforms)
  shader.vertexShader = shader.vertexShader
    .replace(
      '#include <common>',
      /* glsl */ `#include <common>
      varying vec3 vMossPos;
      varying vec3 vMossN;`
    )
    .replace(
      '#include <fog_vertex>',
      /* glsl */ `#include <fog_vertex>
      vec4 mossWorld = modelMatrix * instanceMatrix * vec4(position, 1.0);
      vMossPos = mossWorld.xyz;
      vMossN = normalize(mat3(modelMatrix * instanceMatrix) * normal);`
    )
  shader.fragmentShader = shader.fragmentShader
    .replace(
      '#include <common>',
      /* glsl */ `#include <common>
      uniform float uMoss;
      uniform vec3 uMossColor;
      uniform float uMossScale;
      varying vec3 vMossPos;
      varying vec3 vMossN;
      float mhash(vec2 p) { return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
      float mnoise(vec2 p) {
        vec2 i = floor(p);
        vec2 f = fract(p);
        f = f * f * (3.0 - 2.0 * f);
        return mix(
          mix(mhash(i), mhash(i + vec2(1.0, 0.0)), f.x),
          mix(mhash(i + vec2(0.0, 1.0)), mhash(i + vec2(1.0, 1.0)), f.x),
          f.y
        );
      }`
    )
    .replace(
      '#include <color_fragment>',
      /* glsl */ `#include <color_fragment>
      float mossUp = smoothstep(0.35, 0.82, vMossN.y);
      float mossN = mnoise(vMossPos.xz * uMossScale) * 0.75 + mnoise(vMossPos.xz * uMossScale * 1.9 + vMossPos.y) * 0.25;
      float moss = mossUp * smoothstep(0.72 - uMoss * 0.42, 0.84 - uMoss * 0.32, mossN);
      vec3 mossTint = uMossColor * mix(0.9, 1.05, mossN);
      diffuseColor.rgb = mix(diffuseColor.rgb, mossTint, moss);`
    )
}

const rocks = new THREE.InstancedMesh(geometry, material, MAX_ROCKS)
rocks.frustumCulled = false // camera is fixed; instance bounds aren't tracked anyway
rocks.castShadow = true
// no receiveShadow: shadow-map self-shadowing paints harsh black crescents
// over the toon bands — the ramp alone handles the shaded side

const dummy = new THREE.Object3D()
const tint = new THREE.Color()
const tintA = new THREE.Color()
const tintB = new THREE.Color()
const hsl = {}

function scatter({ count, size, variation, squash, spread, grouping, rockColor, rockColorB, gradient }) {
  const rand = mulberry32(seed)
  const footprints = []
  const clusterCount = Math.min(5, Math.max(1, Math.ceil(count / 7)))
  const clusterRadius = Math.max(size * 3.2, 0.9)
  const clusters = Array.from({ length: clusterCount }, () => ({
    x: (rand() * 2 - 1) * HALF * spread * 0.78,
    z: (rand() * 2 - 1) * HALF * spread * 0.78,
  }))

  for (let i = 0; i < count; i++) {
    // size skews small so big boulders stay rare
    const s = size * THREE.MathUtils.lerp(1 - variation, 1 + variation, rand() ** 1.7)
    const sx = s * (0.85 + rand() * 0.4)
    const sz = s * (0.85 + rand() * 0.4)
    // center sits above ground; the clipped underside ends ~0.15*sy below it,
    // just enough burial to absorb the random tilt without piercing the plane
    let x, z
    // reroll positions that land inside the house / lounging scene footprints
    let tries = 0
    do {
      x = (rand() * 2 - 1) * HALF * spread
      z = (rand() * 2 - 1) * HALF * spread
      if (i < clusterCount || rand() < grouping) {
        const cluster = clusters[i < clusterCount ? i : Math.floor(rand() * clusterCount)]
        const angle = rand() * Math.PI * 2
        const radius = Math.pow(rand(), 0.72) * clusterRadius
        x = THREE.MathUtils.clamp(cluster.x + Math.cos(angle) * radius, -HALF * spread, HALF * spread)
        z = THREE.MathUtils.clamp(cluster.z + Math.sin(angle) * radius, -HALF * spread, HALF * spread)
      }
      // the coast is inside the tile now — reroll rocks off the beach/water
    } while ((overlapsScenery(x, z, Math.max(sx, sz)) || z < -(COAST_EDGE - 0.5)) && ++tries < 12)
    dummy.position.set(x, s * squash * 0.3, z)
    dummy.rotation.set((rand() - 0.5) * 0.16, rand() * Math.PI * 2, (rand() - 0.5) * 0.16)
    dummy.scale.set(sx, s * squash, sz)
    dummy.updateMatrix()
    rocks.setMatrixAt(i, dummy.matrix)
    footprints.push({ x: dummy.position.x, z: dummy.position.z, r: Math.max(sx, sz) })

    // each rock samples a random point along the A→B gradient, then gets a
    // small HSL jitter on top so even same-t rocks don't match exactly
    // gradient scales how far toward color B a rock can sample: 0 = all A, 1 = full span
    tint.lerpColors(tintA.set(rockColor), tintB.set(rockColorB), rand() * gradient).getHSL(hsl)
    tint.setHSL(
      (hsl.h + (rand() - 0.5) * 0.035 + 1) % 1,
      THREE.MathUtils.clamp(hsl.s + (rand() - 0.5) * 0.05, 0, 1),
      THREE.MathUtils.clamp(hsl.l + (rand() - 0.5) * 0.08, 0, 1)
    )
    rocks.setColorAt(i, tint)
  }
  rocks.count = count
  rocks.instanceMatrix.needsUpdate = true
  if (rocks.instanceColor) rocks.instanceColor.needsUpdate = true
  stampRockMask(footprints) // clear the grass under every footprint
}

export function Rocks() {
  const { count, size, variation, jaggedness, squash, spread, grouping, rockColor, rockColorB, gradient } = useControls('rocks', {
    count: { value: 0, min: 0, max: MAX_ROCKS, step: 1 },
    size: { value: 0.34, min: 0.1, max: 2, step: 0.01 },
    variation: { value: 0.6, min: 0, max: 0.9, step: 0.05 },
    jaggedness: { value: 0.2, min: 0, max: 0.6, step: 0.01 },
    squash: { value: 0.72, min: 0.2, max: 2, step: 0.05 },
    spread: { value: 0.88, min: 0.1, max: 1, step: 0.05 },
    grouping: { value: 0.45, min: 0, max: 1, step: 0.05 },
    rockColor: { value: '#aeb0a8', label: 'color A' },
    rockColorB: { value: '#aa9a84', label: 'color B' },
    gradient: { value: 0.45, min: 0, max: 1, step: 0.05 },
    moss: folder({
      mossAmount: { value: 0.12, min: 0, max: 1, step: 0.01, label: 'amount', onChange: setMossAmount },
      mossScale: { value: 2.4, min: 0.5, max: 8, step: 0.1, label: 'patch scale', onChange: setMossScale },
      mossColor: { value: '#667a4c', label: 'color', onChange: setMossColor },
    }),
    randomize: button((get) => {
      reseed()
      reshape(get('rocks.jaggedness'))
      scatter({
        count: get('rocks.count'),
        size: get('rocks.size'),
        variation: get('rocks.variation'),
        squash: get('rocks.squash'),
        spread: get('rocks.spread'),
        grouping: get('rocks.grouping'),
        rockColor: get('rocks.rockColor'),
        rockColorB: get('rocks.rockColorB'),
        gradient: get('rocks.gradient'),
      })
    }),
  })

  useEffect(() => {
    reshape(jaggedness)
    scatter({ count, size, variation, squash, spread, grouping, rockColor, rockColorB, gradient })
  }, [count, size, variation, jaggedness, squash, spread, grouping, rockColor, rockColorB, gradient])

  return (
    <group>
      {/* lights only feed the toon rocks — grass + ground use light-free materials */}
      <ambientLight intensity={1.25} color="#c8d0b5" />
      <directionalLight
        position={[6, 10, 4]}
        intensity={1.15}
        color="#ffe7bd"
        castShadow
        shadow-mapSize={[2048, 2048]}
        shadow-camera-left={-12}
        shadow-camera-right={12}
        shadow-camera-top={12}
        shadow-camera-bottom={-12}
        shadow-camera-far={40}
        shadow-bias={-0.0003}
        shadow-normalBias={0.04}
      />
      {/* invisible shadow catcher — ground/grass materials can't receive shadows */}
      <mesh rotation-x={-Math.PI / 2} position-y={0.005} receiveShadow>
        <planeGeometry args={[GRID * TILE, GRID * TILE]} />
        <shadowMaterial opacity={0.1} />
      </mesh>
      <primitive object={rocks} />
    </group>
  )
}
