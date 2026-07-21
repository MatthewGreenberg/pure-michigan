import { useEffect, useRef, useState } from 'react'
import { useFrame, useThree } from '@react-three/fiber'
import { CameraControls, CameraControlsImpl, OrthographicCamera } from '@react-three/drei'
import { MathUtils } from 'three'
import { GRID, TILE } from './grass/constants.js'

const FIELD_HALF = (GRID * TILE) / 2
const TARGET = [0, -1.0, -0.4]
const POSITION = [12.5, 11, 12.5]

// intro dolly: pulled back from the resting zoom, quick zoom-only push in
const INTRO_SECONDS = 1.1
const ZOOM_OFF = 0.55
const MOUSE_YAW = 0.035 // radians of parallax sway at the screen edge
const MIN_ZOOM_SCALE = 0.78
const DEFAULT_ZOOM_SCALE = MIN_ZOOM_SCALE

// Isometric corner view: the square tile reads as a diamond floating on its
// soil block, ocean along the far edge. The target sits below ground so the
// slab's underside stays in frame; the aspect-aware half-height keeps the
// full diamond (half-diagonal wide) in view on ordinary widescreen windows,
// while the clamps prevent extreme viewports from cropping too hard.
//
// Intro dolly: while the loader runs the camera holds a pulled-back zoom;
// on MittenLoader's 'mitten-done' event it quickly pushes in to the composed
// view. Driven manually in useFrame with a CLAMPED dt — the loader fade
// lands right after the city's mount/compile hitch, and CameraControls'
// own damped transitions would swallow that multi-second delta and snap to
// the end pose before the scene is even visible.
export function Camera({ scene }) {
  const controls = useRef(null)
  const sway = useRef(null)
  const prevScene = useRef(scene)
  const seeded = useRef(false)
  const dolly = useRef(null) // { p } while the intro dolly is running
  const [intro, setIntro] = useState(true)
  const { width, height } = useThree((s) => s.size)
  const aspect = width / Math.max(height, 1)
  const view = MathUtils.clamp((FIELD_HALF * Math.SQRT2 + 2.0) / aspect, 7.0, 8.4)
  const zoom = height / (2 * view)
  const defaultZoom = zoom * DEFAULT_ZOOM_SCALE

  useEffect(() => {
    const cameraControls = controls.current

    // CameraControls owns both the current and desired camera state. Seed both
    // from the composed view so the first interaction cannot snap toward its
    // default target at the origin.
    cameraControls.setLookAt(...POSITION, ...TARGET, false)

    // Preserve OrbitControls' rotate + zoom-only interaction. CameraControls
    // otherwise assigns trucking/panning to the right mouse button and to
    // multi-touch gestures by default.
    cameraControls.mouseButtons.middle = CameraControlsImpl.ACTION.NONE
    cameraControls.mouseButtons.right = CameraControlsImpl.ACTION.NONE
    cameraControls.touches.two = CameraControlsImpl.ACTION.TOUCH_ZOOM
    cameraControls.touches.three = CameraControlsImpl.ACTION.NONE
  }, [])

  useEffect(() => {
    if (!intro) return
    const cameraControls = controls.current

    // Seed the pulled-back start zoom exactly once, even if the loader
    // already finished before this mounted (slow GLB load, HMR remount).
    if (!seeded.current) {
      seeded.current = true
      cameraControls.zoomTo(defaultZoom * ZOOM_OFF, false)
    }

    const start = () => { dolly.current = { p: 0 } }
    if (window.__mittenDone) start()
    else window.addEventListener('mitten-done', start, { once: true })
    return () => window.removeEventListener('mitten-done', start)
  }, [intro, defaultZoom])

  // Very slight mouse-driven yaw: a parent group around the camera sways
  // about world Y, so CameraControls (which owns the camera's local pose)
  // never fights it.
  useFrame((state, rawDt) => {
    sway.current.rotation.y = MathUtils.damp(
      sway.current.rotation.y,
      state.pointer.x * MOUSE_YAW,
      3,
      Math.min(rawDt, 0.1),
    )
  })

  useFrame((_, rawDt) => {
    const d = dolly.current
    if (!d) return
    // clamp dt so the post-load compile hitch can't fast-forward the dolly
    d.p = Math.min(d.p + Math.min(rawDt, 0.05) / INTRO_SECONDS, 1)
    const e = 1 - (1 - d.p) ** 3 // easeOutCubic: moving from frame one reads as a quick push
    controls.current.zoomTo(defaultZoom * (ZOOM_OFF + (1 - ZOOM_OFF) * e), false)
    if (d.p >= 1) {
      dolly.current = null
      setIntro(false)
    }
  })

  // Scene flips share this one camera across every portal FBO, so whatever
  // zoom the user left behind would carry into the incoming scene. Ease back
  // to the composed default as the burn wipe starts.
  useEffect(() => {
    if (scene === prevScene.current) return
    prevScene.current = scene
    const cameraControls = controls.current
    dolly.current = null
    setIntro(false)
    cameraControls.setLookAt(...POSITION, ...TARGET, true)
    cameraControls.zoomTo(defaultZoom, true)
  }, [scene, defaultZoom])

  const restoreDefaultView = () => {
    const cameraControls = controls.current

    // Releasing a drag turns the camera into a temporary peek: cancel any
    // remaining intro motion, then ease the full composed view back home.
    dolly.current = null
    setIntro(false)
    cameraControls.setLookAt(...POSITION, ...TARGET, true)
    cameraControls.zoomTo(defaultZoom, true)
  }

  return (
    <>
      <group ref={sway}>
        <OrthographicCamera
          makeDefault
          position={POSITION}
          zoom={defaultZoom}
          near={0.1}
          far={100}
          onUpdate={(camera) => camera.lookAt(...TARGET)}
        />
      </group>
      <CameraControls
        ref={controls}
        makeDefault
        smoothTime={0.3}
        draggingSmoothTime={0.12}
        azimuthRotateSpeed={0.65}
        polarRotateSpeed={0.65}
        dollySpeed={0.7}
        minZoom={zoom * (intro ? 0.4 : MIN_ZOOM_SCALE)}
        maxZoom={zoom * 1.28}
        minPolarAngle={0.9}
        maxPolarAngle={1.05}
        minAzimuthAngle={Math.PI / 4 - 0.22}
        maxAzimuthAngle={Math.PI / 4 + 0.22}
        onControlEnd={restoreDefaultView}
      />
    </>
  )
}
