import { buildBike } from './bike/model.js'

// Procedural hybrid bike (img2threejs reconstruction — spec + review history in
// the session scratchpad), leaning against the cottage's camera-side wall.
// Authored in meters (ground contact y=0, ~1.7 long); scaled to people scale.
// Static prop: casts real shadows (free under the on-demand shadow map), no
// useFrame. Placement is world-space, derived from Scenery's HOUSE
// (-4.1, -2.3, rotY 0.12): wall-parallel offset (0.55, 0.98) rotated by 0.12,
// inside the house's stampSceneryMask circle so no new grass-kill stamp needed.
const bike = buildBike()

export function Bike() {
  return (
    <group position={[-3.44, 0, -1.39]} rotation-y={0.12}>
      {/* lean rotates about the tire contact line (x axis at y=0), top toward the wall */}
      <group rotation-x={-0.17}>
        <primitive object={bike} scale={0.6} />
      </group>
    </group>
  )
}
