import { useEffect, useRef } from 'react'
import { useFrame, useThree } from '@react-three/fiber'
import * as THREE from 'three'
import { sceneRendering } from './sceneState.js'

// Shared hover affordance for the diorama interactives (Comerica Park, the
// skipping-stone water, the Diag flag): an additive radial glow disc that
// softly LIGHTENS the clickable area while the cursor is over it. Nothing
// shows at idle; the glow fades in/out damped on the `hovered` prop.
const glowCanvas = document.createElement('canvas')
glowCanvas.width = glowCanvas.height = 128
const glowCtx = glowCanvas.getContext('2d')
const glowGrd = glowCtx.createRadialGradient(64, 64, 0, 64, 64, 64)
glowGrd.addColorStop(0, 'rgba(255,255,255,0.9)')
glowGrd.addColorStop(0.55, 'rgba(255,255,255,0.45)')
glowGrd.addColorStop(1, 'rgba(255,255,255,0)')
glowCtx.fillStyle = glowGrd
glowCtx.fillRect(0, 0, 128, 128)
const glowTexture = new THREE.CanvasTexture(glowCanvas)
const glowGeometry = new THREE.CircleGeometry(1, 48)
const NO_RAYCAST = () => null

// drei's useCursor writes document.body.style.cursor, which loses to the
// canvas's own `cursor: grab` CSS — write the canvas's inline style instead.
// Module-level setter so the React Compiler lint doesn't see hook-state
// mutation in the effect (same convention as People's updatePeople).
function setCanvasCursor(el, cursor) {
  el.style.cursor = cursor
}

// eslint-disable-next-line react-refresh/only-export-components -- tiny paired hook
export function useClickCursor(on) {
  const gl = useThree((s) => s.gl)
  useEffect(() => {
    setCanvasCursor(gl.domElement, on ? 'pointer' : '')
    return () => setCanvasCursor(gl.domElement, '')
  }, [on, gl])
}

export function ClickHint({ position, radius = 1, scene, hovered = false, color = '#ffffff' }) {
  const mat = useRef(null)
  useFrame((_, dt) => {
    if (!sceneRendering(scene) || !mat.current) return
    const target = hovered ? 0.42 : 0
    mat.current.opacity += (target - mat.current.opacity) * Math.min(dt * 9, 1)
  })
  return (
    <mesh
      geometry={glowGeometry}
      rotation-x={-Math.PI / 2}
      position={position}
      scale={radius}
      raycast={NO_RAYCAST}
    >
      <meshBasicMaterial
        ref={mat}
        map={glowTexture}
        color={color}
        transparent
        opacity={0}
        blending={THREE.AdditiveBlending}
        depthWrite={false}
        toneMapped={false}
      />
    </mesh>
  )
}
