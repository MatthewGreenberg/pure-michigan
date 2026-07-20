import { useThree } from '@react-three/fiber'
import { OrbitControls, OrthographicCamera } from '@react-three/drei'
import { MathUtils } from 'three'
import { GRID, TILE } from './grass/constants.js'

const FIELD_HALF = (GRID * TILE) / 2
const TARGET = [0, -1.0, -0.4]
const POSITION = [12.5, 11, 12.5]

// Isometric corner view: the square tile reads as a diamond floating on its
// soil block, ocean along the far edge. The target sits below ground so the
// slab's underside stays in frame; the aspect-aware half-height keeps the
// full diamond (half-diagonal wide) in view on ordinary widescreen windows,
// while the clamps prevent extreme viewports from cropping too hard.
export function Camera() {
  const { width, height } = useThree((s) => s.size)
  const aspect = width / Math.max(height, 1)
  const view = MathUtils.clamp((FIELD_HALF * Math.SQRT2 + 2.0) / aspect, 7.0, 8.4)
  const zoom = height / (2 * view)

  return (
    <>
      <OrthographicCamera
        makeDefault
        position={POSITION}
        zoom={zoom}
        near={0.1}
        far={100}
        onUpdate={(camera) => camera.lookAt(...TARGET)}
      />
      <OrbitControls
        makeDefault
        target={TARGET}
        enableDamping
        dampingFactor={0.08}
        enablePan={false}
        minZoom={zoom * 0.88}
        maxZoom={zoom * 1.28}
        minPolarAngle={0.9}
        maxPolarAngle={1.05}
        minAzimuthAngle={Math.PI / 4 - 0.22}
        maxAzimuthAngle={Math.PI / 4 + 0.22}
      />
    </>
  )
}
