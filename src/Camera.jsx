import { useEffect, useRef, useState } from 'react'
import { useFrame, useThree } from '@react-three/fiber'
import { CameraControls, CameraControlsImpl, OrthographicCamera } from '@react-three/drei'
import { MathUtils } from 'three'
import { GRID, TILE } from './grass/constants.js'

const FIELD_HALF = (GRID * TILE) / 2
const TARGET = [0, -1.0, -0.4]
const POSITION = [12.5, 11, 12.5]

// intro dolly shape: pulled back from the resting zoom, swung off the corner axis,
// tilted higher, easing into the composed view over INTRO_SECONDS
const INTRO_SECONDS = 3.5
const AZIMUTH_OFF = -0.34
const POLAR_OFF = 0.22 // start lower (closer to street level), rising into the iso view
const ZOOM_OFF = 0.8
const DEFAULT_ZOOM_SCALE = 0.88
const MIN_ZOOM_SCALE = 0.78

// Isometric corner view: the square tile reads as a diamond floating on its
// soil block, ocean along the far edge. The target sits below ground so the
// slab's underside stays in frame; the aspect-aware half-height keeps the
// full diamond (half-diagonal wide) in view on ordinary widescreen windows,
// while the clamps prevent extreme viewports from cropping too hard.
//
// Intro dolly: while the loader runs the camera holds a pulled-back, higher,
// off-axis pose; on MittenLoader's 'mitten-done' event it eases into the
// composed view. Driven manually in useFrame with a CLAMPED dt — the loader
// fade lands right after the city's mount/compile hitch, and CameraControls'
// own damped transitions would swallow that multi-second delta and snap to
// the end pose before the scene is even visible.
export function Camera() {
  const controls = useRef(null)
  const endAngles = useRef(null)
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
    endAngles.current = { azimuth: cameraControls.azimuthAngle, polar: cameraControls.polarAngle }

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
    const { azimuth, polar } = endAngles.current

    // Seed the pulled-back start pose exactly once, even if the loader
    // already finished before this mounted (slow GLB load, HMR remount).
    if (!seeded.current) {
      seeded.current = true
      cameraControls.rotateTo(azimuth + AZIMUTH_OFF, polar + POLAR_OFF, false)
      cameraControls.zoomTo(defaultZoom * ZOOM_OFF, false)
    }

    const start = () => { dolly.current = { p: 0 } }
    if (window.__mittenDone) start()
    else window.addEventListener('mitten-done', start, { once: true })
    return () => window.removeEventListener('mitten-done', start)
  }, [intro, defaultZoom])

  useFrame((_, rawDt) => {
    const d = dolly.current
    if (!d) return
    // clamp dt so the post-load compile hitch can't fast-forward the dolly
    d.p = Math.min(d.p + Math.min(rawDt, 0.05) / INTRO_SECONDS, 1)
    const e = d.p < 0.5 ? 4 * d.p ** 3 : 1 - (-2 * d.p + 2) ** 3 / 2 // easeInOutCubic
    const { azimuth, polar } = endAngles.current
    const cameraControls = controls.current
    cameraControls.rotateTo(azimuth + AZIMUTH_OFF * (1 - e), polar + POLAR_OFF * (1 - e), false)
    cameraControls.zoomTo(defaultZoom * (ZOOM_OFF + (1 - ZOOM_OFF) * e), false)
    if (d.p >= 1) {
      dolly.current = null
      setIntro(false)
    }
  })

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
      <OrthographicCamera
        makeDefault
        position={POSITION}
        zoom={defaultZoom}
        near={0.1}
        far={100}
        onUpdate={(camera) => camera.lookAt(...TARGET)}
      />
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
        maxPolarAngle={intro ? 1.3 : 1.05}
        minAzimuthAngle={Math.PI / 4 - (intro ? 0.6 : 0.22)}
        maxAzimuthAngle={Math.PI / 4 + 0.22}
        onControlEnd={restoreDefaultView}
      />
    </>
  )
}
