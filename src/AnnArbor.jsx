import { useEffect } from 'react'
import { useThree } from '@react-three/fiber'
import { useGLTF } from '@react-three/drei'
import { AnnArborBase } from './city/AnnArborBase.jsx'
import { ktx2, patchBakedWater } from './city/City.jsx'
import { makePeople, People } from './city/People.jsx'
import * as THREE from 'three'
import { MichiganFlag, calmFlagMaterial } from './MichiganHub.jsx'

// soft blob contact shadow for the flag — the GLB ground is unlit (baked
// lighting), so real shadow maps can't reach it; same trick as Birds.jsx,
// tinted neutral dark for pavement instead of grass green
const shadowCanvas = document.createElement('canvas')
shadowCanvas.width = shadowCanvas.height = 64
const sctx = shadowCanvas.getContext('2d')
const grd = sctx.createRadialGradient(32, 32, 0, 32, 32, 32)
grd.addColorStop(0, 'rgba(20,20,24,0.28)')
grd.addColorStop(0.4, 'rgba(20,20,24,0.16)')
grd.addColorStop(0.75, 'rgba(20,20,24,0.05)')
grd.addColorStop(1, 'rgba(20,20,24,0)')
sctx.fillStyle = grd
sctx.fillRect(0, 0, 64, 64)
const flagShadowMaterial = new THREE.MeshBasicMaterial({
  map: new THREE.CanvasTexture(shadowCanvas),
  transparent: true,
  depthWrite: false,
})

// Clump anchors [x, z, radius, count] in authored coords, keyed to the GLB's
// landmark node translations (Law Quad -3.4,9.4 / Main St 6.1,-5.1 /
// Angell -6.4,4.4 / Stadium -7.1,-5.2 / Campus Plaza 6.1,4.3).
const annArborPeople = makePeople([
  [-3.4, 7.2, 1.0, 10], [-1.2, 9.6, 0.9, 8], [-5.6, 9.2, 0.9, 7],     // Law Quad lawn
  [6.1, -2.6, 1.0, 10], [8.8, -5.0, 0.9, 8], [3.4, -5.4, 0.9, 8],     // Main Street
  [-6.3, 1.9, 0.9, 9], [-3.9, 4.3, 0.9, 7],                            // Angell Hall
  [-7.0, -2.2, 1.0, 10], [-3.9, -6.6, 0.9, 8], [-10.2, -7.9, 0.9, 7],  // stadium gates
  [6.1, 4.3, 1.3, 14], [8.8, 2.2, 0.9, 7], [3.5, 6.4, 0.9, 7],        // campus plaza
  [0.6, 0.8, 0.8, 6], [1.6, -2.6, 0.7, 5],                             // the Diag
])

// Ann Arbor diorama — one Tripo GLB like Detroit (Draco + KTX2). Authored
// 30x30 with ground at y≈-0.075, so scale 0.5 fits the 15x15 slab. The GLB
// declares KHR_materials_unlit, so GLTFLoader already hands back
// MeshBasicMaterials — no material swap pass needed, just strip stray
// cameras/lights like the city does.
export function AnnArbor() {
  const gl = useThree((s) => s.gl)
  const { scene } = useGLTF('/ann-arbor_compressed.glb', true, false, (loader) =>
    loader.setKTX2Loader(ktx2.detectSupport(gl))
  )
  useEffect(() => {
    const junk = []
    scene.traverse((o) => {
      if (o.isCamera || o.isLight) junk.push(o)
      else if (o.isMesh && /ANN_UNLIT_(Site|Ground)/.test(o.material.name))
        patchBakedWater(o.material)
    })
    junk.forEach((o) => o.removeFromParent())
  }, [scene])
  return (
    <group>
      {/* campus-turf cross-section: living sod/roots and three muted maize M inlays */}
      <AnnArborBase />
      {/* no local Suspense — the GLB load suspends up to the app-level loading screen */}
      <primitive object={scene} scale={0.5} />
      {/* big state flag on the Diag at scene center; yaw π/4 faces the cloth
      to the iso corner camera (no land-frame rotation here, unlike the map),
      calm material so the wave stays gentle at this size */}
      <MichiganFlag position={[0, -0.04, 0]} scale={3.2} yaw={Math.PI / 4} material={calmFlagMaterial} />
      {/* flag-only light rig: every GLB/people material here is unlit basic, so
      these shade just the standard-material pole/finial — hemisphere for the
      vertical sky/ground gradient, directional from the iso camera side for
      the cylindrical falloff */}
      <hemisphereLight args={['#fff4e0', '#565660', 1.4]} />
      <directionalLight position={[8, 12, 6]} intensity={2.4} color="#fff3d8" />
      {/* blob elongated along the fly direction, just above the ground plane */}
      <group rotation-y={Math.PI / 4}>
        <mesh rotation-x={-Math.PI / 2} position={[0.5, -0.033, 0]} scale={[1.5, 0.8, 1]} material={flagShadowMaterial}>
          <circleGeometry args={[1, 24]} />
        </mesh>
      </group>
      <People people={annArborPeople} scene="annarbor" />
    </group>
  )
}
