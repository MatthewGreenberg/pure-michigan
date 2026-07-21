import { Suspense, useEffect, useMemo, useRef, useState } from 'react'
import { Canvas, createPortal, useFrame, useThree } from '@react-three/fiber'
import { ScreenQuad, useFBO } from '@react-three/drei'
import * as THREE from 'three'
import { Leva, useControls } from 'leva'
import { AnnArbor } from './AnnArbor.jsx'
import { Birds } from './Birds.jsx'
import { Camera } from './Camera.jsx'
import { City } from './city/City.jsx'
import { CloudCover, CloudSheet } from './CloudCover.jsx'
import { Grass } from './grass/Grass.jsx'
import { MichiganHub, hoverHubDestination } from './MichiganHub.jsx'
import { MittenLoader, MITTEN_PATH, UP_PATH, MICHIGAN_VIEWBOX } from './MittenLoader.jsx'
import { Ocean } from './Ocean.jsx'
import { Scenery } from './Scenery.jsx'
import { SoilBlock } from './SoilBlock.jsx'
import { Sky } from './Sky.jsx'
import { START_SCENE, hubTransition } from './sceneState.js'
import { initOnDemandShadows, armShadows } from './shadows.js'
import { skyMaterial, skyUniforms } from './skyMaterial.js'
import { StylePass } from './StyleEffect.jsx'
import { groundMaterial } from './grass/material.js'
import { GRID, TILE } from './grass/constants.js'
import { lowGPU } from './gpu.js'

const TRANSITION_SECONDS = 1.6

// Light rig for the meadow's Lambert-lit set dressing (cottage, loungers,
// birds) — grass/ground/ocean materials ignore lights. Lived in Rocks.jsx
// before the rocks were removed.
function MeadowLights() {
  const gl = useThree((s) => s.gl)
  // shadow maps are on-demand — arm one render so the scenery shadows bake
  useEffect(() => { armShadows(gl) }, [gl])
  return (
    <group>
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
    </group>
  )
}

// Detroit's steely sky lives on its own material clone — each scene renders
// its own sky into its own target, so no palette crossfade bookkeeping.
const citySkyMaterial = skyMaterial.clone()
citySkyMaterial.uniforms.uSkyTop.value.set('#fafcff')
citySkyMaterial.uniforms.uSkyMiddle.value.set('#90aeb2')
citySkyMaterial.uniforms.uSkyBottom.value.set('#cfc3a9')
citySkyMaterial.uniforms.uHorizonGlow.value.set('#ffffff')

// Ann Arbor: soft autumn-campus sky, maize-warm horizon.
const annarborSkyMaterial = skyMaterial.clone()
annarborSkyMaterial.uniforms.uSkyTop.value.set('#ffffff')
annarborSkyMaterial.uniforms.uSkyMiddle.value.set('#a9bdc4')
annarborSkyMaterial.uniforms.uSkyBottom.value.set('#e9dcae')
annarborSkyMaterial.uniforms.uHorizonGlow.value.set('#fff3c9')

// Fullscreen compositor: the default scene contains only this quad, which
// mixes whichever two scene targets are transitioning. StylePass grades the
// composed image, including the Michigan hub.
const blendMaterial = new THREE.ShaderMaterial({
  uniforms: {
    tFrom: { value: null },
    tTo: { value: null },
    uMix: { value: 1 },
  },
  depthTest: false,
  depthWrite: false,
  vertexShader: /* glsl */ `
    varying vec2 vUv;
    void main() {
      vUv = position.xy * 0.5 + 0.5;
      gl_Position = vec4(position.xy, 0.0, 1.0);
    }
  `,
  // targets already hold display-ready color (tonemapping + colorspace ran
  // during the scene renders), so mix raw — no conversion includes here.
  // Not a crossfade: a noise-ragged diagonal front sweeps the frame, with
  // heat-ripple warp and a glowing ember rim where the scenes swap.
  fragmentShader: /* glsl */ `
    uniform sampler2D tFrom;
    uniform sampler2D tTo;
    uniform float uMix;
    varying vec2 vUv;

    float hash(vec2 p) { return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
    float noise(vec2 p) {
      vec2 i = floor(p), f = fract(p);
      f = f * f * (3.0 - 2.0 * f);
      return mix(
        mix(hash(i), hash(i + vec2(1.0, 0.0)), f.x),
        mix(hash(i + vec2(0.0, 1.0)), hash(i + vec2(1.0, 1.0)), f.x),
        f.y
      );
    }
    float fbm(vec2 p) {
      float v = 0.0, a = 0.5;
      for (int i = 0; i < 4; i++) { v += a * noise(p); p *= 2.03; a *= 0.5; }
      return v;
    }

    void main() {
      float m = uMix;
      vec4 col;
      if (m <= 0.0) {
        col = texture2D(tFrom, vUv);
      } else if (m >= 1.0) {
        col = texture2D(tTo, vUv);
      } else {
        // ragged diagonal sweep field: front travels corner to corner
        float sweep = dot(vUv, vec2(0.62, 0.38));
        float field = sweep * 0.75 + fbm(vUv * 6.0) * 0.25;

        float W = 0.14; // burn-edge width
        float t = mix(-W, 1.0 + W, m); // threshold overshoots so both ends fully resolve
        float d = field - t;
        float mask = smoothstep(W * 0.5, -W * 0.5, d); // 1 = incoming scene

        // heat-ripple warp near the front, pulling both scenes apart
        float edge = 1.0 - smoothstep(0.0, W, abs(d));
        vec2 warp = (vec2(
          noise(vUv * 40.0 + m * 10.0),
          noise(vUv * 40.0 + 7.3 - m * 10.0)
        ) - 0.5) * edge * 0.025;

        col = mix(texture2D(tFrom, vUv + warp), texture2D(tTo, vUv - warp), mask);

        // glowing ember rim with a hot white core on the dissolve front
        float rim = edge * edge;
        col.rgb += vec3(1.0, 0.85, 0.55) * rim * 0.55;
        col.rgb += rim * rim * 0.35;
      }

      gl_FragColor = col;
    }
  `,
})

const NO_RAYCAST = () => null

// Portals copy the root camera before <Camera makeDefault> takes effect. Use
// the live root camera for pointer rays so hit testing matches the FBO render.
function computePortalPointer(event, state, rootState) {
  state.pointer.set(
    (event.offsetX / state.size.width) * 2 - 1,
    -(event.offsetY / state.size.height) * 2 + 1,
  )
  state.raycaster.setFromCamera(state.pointer, rootState.camera)
}

function Scenes({ activeScene, onSelect, children }) {
  const mapScene = useMemo(() => new THREE.Scene(), [])
  const grassScene = useMemo(() => new THREE.Scene(), [])
  const cityScene = useMemo(() => new THREE.Scene(), [])
  const annarborScene = useMemo(() => new THREE.Scene(), [])
  // Two shared targets, not one per scene: only the outgoing/incoming pair
  // ever blends, so new destinations cost zero extra VRAM.
  const outgoingFBO = useFBO({ samples: lowGPU ? 0 : 4 })
  const residentFBO = useFBO({ samples: lowGPU ? 0 : 4 })
  const fromScene = useRef(START_SCENE)
  const toScene = useRef(START_SCENE)
  const p = useRef(1)
  const grassRoot = useRef(null)
  const cityRoot = useRef(null)
  const annarborRoot = useRef(null)
  const gl = useThree((s) => s.gl)

  // Every shadow caster is static outside transitions (map dive) and marker
  // hover, so shadow maps render on demand — the flag sites re-arm it.
  // Renders of scenes with no shadow lights (city, blend quad) don't consume
  // the flag, so it survives until a shadowed scene draws.
  useEffect(() => {
    initOnDemandShadows(gl)
  }, [gl])

  useEffect(() => {
    if (activeScene === toScene.current) return
    fromScene.current = p.current < 0.5 ? fromScene.current : toScene.current
    toScene.current = activeScene
    p.current = 0
    hubTransition.from = fromScene.current
    hubTransition.to = activeScene
    hubTransition.p = 0
  }, [activeScene])

  useFrame(({ gl, camera }, rawDt) => {
    const dt = Math.min(rawDt, 0.05)
    p.current = THREE.MathUtils.clamp(p.current + dt / TRANSITION_SECONDS, 0, 1)
    hubTransition.p = p.current
    const eased = THREE.MathUtils.smoothstep(p.current, 0, 1)
    blendMaterial.uniforms.uMix.value = eased
    // captured before the completion reset so the settle frame (p just hit 1,
    // roots at rest pose) still gets one final shadow refresh
    const animating = fromScene.current !== toScene.current
    if (p.current >= 1) fromScene.current = toScene.current

    // Diorama zoom: incoming scene dollies up to full scale, outgoing recedes.
    // Uniform scale about the origin under the ortho camera reads as a zoom;
    // the sky ScreenQuads sit outside these roots so they stay fullscreen.
    const transitioning = fromScene.current !== toScene.current
    for (const [name, root] of [['meadow', grassRoot], ['city', cityRoot], ['annarbor', annarborRoot]]) {
      if (!root.current) continue
      let s = 1
      if (transitioning && name === toScene.current) s = THREE.MathUtils.lerp(0.55, 1, eased)
      else if (transitioning && name === fromScene.current) s = THREE.MathUtils.lerp(1, 0.55, eased)
      root.current.scale.setScalar(s)
    }

    const scenes = { map: mapScene, meadow: grassScene, city: cityScene, annarbor: annarborScene }

    // The composer leaves gl.autoClear=false. Outgoing scene → outgoingFBO
    // (skipped entirely when resident), incoming/resident scene → residentFBO.
    if (transitioning) {
      gl.shadowMap.needsUpdate = true
      gl.setRenderTarget(outgoingFBO)
      gl.clear()
      gl.render(scenes[fromScene.current], camera)
    }
    // re-arm per render: a shadowed scene's render consumes the flag
    if (animating) gl.shadowMap.needsUpdate = true
    gl.setRenderTarget(residentFBO)
    gl.clear()
    gl.render(scenes[toScene.current], camera)

    blendMaterial.uniforms.tFrom.value = (transitioning ? outgoingFBO : residentFBO).texture
    blendMaterial.uniforms.tTo.value = residentFBO.texture
    gl.setRenderTarget(null)
  }, 0.5)

  return (
    <>
      {createPortal(
        <>
          <MichiganHub onSelect={onSelect} transition={hubTransition} />
          <CloudCover />
        </>,
        mapScene,
        { events: { compute: computePortalPointer } }
      )}
      {createPortal(
        <>
          <Sky />
          <group ref={grassRoot}>
            {children}
            <CloudSheet altitude={7.2} />
          </group>
        </>,
        grassScene,
        // live-root-camera pointer compute (same as map/city portals) so the
        // skipping-stone water clicks raycast with the real camera
        { events: { compute: computePortalPointer } }
      )}
      {createPortal(
        <>
          <ScreenQuad material={citySkyMaterial} renderOrder={-10000} raycast={NO_RAYCAST} />
          <group ref={cityRoot}>
            <City />
            <CloudSheet tint="steel" altitude={6.6} />
          </group>
        </>,
        cityScene,
        // same live-root-camera pointer compute as the map portal — without it
        // the portal raycasts with its stale creation-time camera copy and the
        // Comerica Park click volume is unhittable
        { events: { compute: computePortalPointer } }
      )}
      {createPortal(
        <>
          <ScreenQuad material={annarborSkyMaterial} renderOrder={-10000} raycast={NO_RAYCAST} />
          <group ref={annarborRoot}>
            <AnnArbor />
            {/* same steel stratus singleton as Detroit — shared material + leva folder */}
            <CloudSheet tint="steel" altitude={6.6} />
          </group>
        </>,
        annarborScene,
        // live-root-camera pointer compute like every other portal — without
        // it the Block M flag clicks raycast with a stale camera and miss
        { events: { compute: computePortalPointer } }
      )}
      <ScreenQuad material={blendMaterial} raycast={NO_RAYCAST} />
    </>
  )
}

const LOCATIONS = [
  { id: 'city', name: 'Detroit' },
  { id: 'annarbor', name: 'Ann Arbor' },
  { id: 'meadow', name: 'Up North' },
]

function MapPinIcon() {
  return (
    <span className="hud-island-pin" aria-hidden="true">
      <svg viewBox="0 0 24 24">
        <path d="M12 21c3.9-4.3 6-7.8 6-11a6 6 0 1 0-12 0c0 3.2 2.1 6.7 6 11Z" />
        <circle cx="12" cy="10" r="2.25" />
      </svg>
    </span>
  )
}

function AboutCard() {
  const [isOpen, setIsOpen] = useState(false)
  const toggleRef = useRef(null)

  useEffect(() => {
    if (!isOpen) return undefined

    const closeCard = (event) => {
      if (event.type === 'click' && toggleRef.current?.contains(event.target)) return
      if (event.type === 'keydown' && event.key !== 'Escape') return
      setIsOpen(false)
    }

    document.addEventListener('click', closeCard)
    window.addEventListener('keydown', closeCard)
    return () => {
      document.removeEventListener('click', closeCard)
      window.removeEventListener('keydown', closeCard)
    }
  }, [isOpen])

  return (
    <div className={`hud-about${isOpen ? ' is-open' : ''}`}>
      <button
        ref={toggleRef}
        className="hud-about-toggle"
        type="button"
        aria-label={isOpen ? 'Close about card' : 'Open about card'}
        aria-expanded={isOpen}
        aria-controls="about-card"
        onClick={() => setIsOpen((open) => !open)}
      >
        <span aria-hidden="true">?</span>
      </button>
      <section
        className="hud-about-card"
        id="about-card"
        aria-label="About this experiment"
        aria-hidden={!isOpen}
      >
        <p className="hud-about-eyebrow">Pure Michigan</p>
        <p className="hud-about-credit">
          <span>A WebGL Experiment</span>
          <span>Three regions, three art styles.</span>
          <span>By Matt Greenberg</span>
        </p>
        <div className="hud-about-socials" aria-label="Matt Greenberg on social media">
          <a
            className="hud-social-link hud-social-x"
            href="https://x.com/McGreenBeats"
            target="_blank"
            rel="noreferrer"
            aria-label="Matt Greenberg on X"
            tabIndex={isOpen ? 0 : -1}
          >
            <span aria-hidden="true">X</span>
          </a>
          <a
            className="hud-social-link hud-social-linkedin"
            href="https://www.linkedin.com/in/mattcgreenberg/"
            target="_blank"
            rel="noreferrer"
            aria-label="Matt Greenberg on LinkedIn"
            tabIndex={isOpen ? 0 : -1}
          >
            <span aria-hidden="true">in</span>
          </a>
        </div>
      </section>
    </div>
  )
}

function Hud({ activeScene, onSelect }) {
  const active = LOCATIONS.find((location) => location.id === activeScene)
  const onMap = activeScene === 'map'

  return (
    <div className="hud" data-location={active?.id || 'map'}>
      <button
        className="hud-michigan"
        type="button"
        aria-label="Back to map"
        disabled={onMap}
        onClick={() => onSelect('map')}
      >
        <svg viewBox={MICHIGAN_VIEWBOX} overflow="visible" aria-hidden="true">
          <path d={UP_PATH} />
          <path d={MITTEN_PATH} />
        </svg>
      </button>
      <AboutCard />
      <div className={`hud-island${onMap ? ' is-map' : ' is-scene'}`}>
        <nav
          className="hud-island-map"
          aria-label="Michigan destinations"
          aria-hidden={!onMap}
        >
          {LOCATIONS.map((location) => {
            return (
              <button
                className="hud-island-destination"
                type="button"
                key={location.id}
                data-destination={location.id}
                onClick={() => onSelect(location.id)}
                onPointerEnter={() => hoverHubDestination(location.id)}
                onPointerLeave={() => hoverHubDestination(null)}
                onFocus={() => hoverHubDestination(location.id)}
                onBlur={() => hoverHubDestination(null)}
                tabIndex={onMap ? 0 : -1}
              >
                <MapPinIcon />
                {location.name}
              </button>
            )
          })}
        </nav>
        <button
          className="hud-island-back"
          type="button"
          onClick={() => onSelect('map')}
          tabIndex={onMap ? -1 : 0}
          aria-hidden={onMap}
        >
          <span aria-hidden="true">←</span>
          <span className="hud-island-back-copy">
            Back to map
            <small>{active?.name}</small>
          </span>
        </button>
      </div>
    </div>
  )
}

export default function App() {
  const [activeScene, setActiveScene] = useState(START_SCENE)

  useControls('background', {
    skyTop: { value: '#ffffff', label: 'sky top', onChange: (v) => { skyUniforms.uSkyTop.value.set(v) } },
    skyMiddle: { value: '#9bb5ad', label: 'sky middle', onChange: (v) => { skyUniforms.uSkyMiddle.value.set(v) } },
    skyBottom: { value: '#d7d5ab', label: 'sky bottom', onChange: (v) => { skyUniforms.uSkyBottom.value.set(v) } },
    horizonGlow: { value: '#ffffff', label: 'horizon glow', onChange: (v) => { skyUniforms.uHorizonGlow.value.set(v) } },
  }, { collapsed: true, order: 10 })

  useControls('detroit bg', {
    skyTop: { value: '#fafcff', label: 'sky top', onChange: (v) => { citySkyMaterial.uniforms.uSkyTop.value.set(v) } },
    skyMiddle: { value: '#90aeb2', label: 'sky middle', onChange: (v) => { citySkyMaterial.uniforms.uSkyMiddle.value.set(v) } },
    skyBottom: { value: '#cfc3a9', label: 'sky bottom', onChange: (v) => { citySkyMaterial.uniforms.uSkyBottom.value.set(v) } },
    horizonGlow: { value: '#ffffff', label: 'horizon glow', onChange: (v) => { citySkyMaterial.uniforms.uHorizonGlow.value.set(v) } },
  }, { collapsed: true, order: 11 })

  return (
    <main className="scene">
      <Leva collapsed hidden={!new URLSearchParams(window.location.search).has('debug')} />
      {/* antialias off: only fullscreen quads hit the canvas — the scene AA
          is the samples:4 on the two FBOs in Scenes */}
      <Canvas shadows={!lowGPU} dpr={lowGPU ? 1 : [1, 1.5]} gl={{ antialias: false, alpha: false }}>
        <Suspense fallback={null}>
          <Camera scene={activeScene} />
          <Scenes activeScene={activeScene} onSelect={setActiveScene}>
            <Grass />
            <MeadowLights />
            <Ocean />
            <Scenery />
            <Birds />
            {/* flat base under the whole grid — color synced to blade roots via leva */}
            <mesh rotation-x={-Math.PI / 2} position-y={-0.01} material={groundMaterial}>
              <planeGeometry args={[GRID * TILE, GRID * TILE]} />
            </mesh>
            <SoilBlock />
          </Scenes>
          <StylePass />
        </Suspense>
      </Canvas>
      <Hud activeScene={activeScene} onSelect={setActiveScene} />
      <MittenLoader />
    </main>
  )
}
