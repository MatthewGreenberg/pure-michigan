import { Suspense, useMemo, useRef, useState } from 'react'
import { Canvas, createPortal, useFrame } from '@react-three/fiber'
import { ScreenQuad, useFBO } from '@react-three/drei'
import * as THREE from 'three'
import { Leva, useControls } from 'leva'
import { Birds } from './Birds.jsx'
import { Camera } from './Camera.jsx'
import { City } from './city/City.jsx'
import { Grass } from './grass/Grass.jsx'
import { MICHIGAN_VIEWBOX, MITTEN_PATH, MittenLoader, UP_PATH } from './MittenLoader.jsx'
import { Rocks } from './rocks/Rocks.jsx'
import { Ocean } from './Ocean.jsx'
import { Scenery } from './Scenery.jsx'
import { SoilBlock } from './SoilBlock.jsx'
import { Sky } from './Sky.jsx'
import { skyMaterial, skyUniforms } from './skyMaterial.js'
import { StylePass } from './StyleEffect.jsx'
import { groundMaterial } from './grass/material.js'
import { GRID, TILE } from './grass/constants.js'

const TRANSITION_SECONDS = 1.6

// Detroit is the default opening scene; deep-link #meadow to start up north
const START_CITY = typeof window !== 'undefined' && window.location.hash !== '#meadow'

// Detroit's steely sky lives on its own material clone — each scene renders
// its own sky into its own target, so no palette crossfade bookkeeping.
const citySkyMaterial = skyMaterial.clone()
citySkyMaterial.uniforms.uSkyTop.value.set('#fafcff')
citySkyMaterial.uniforms.uSkyMiddle.value.set('#90aeb2')
citySkyMaterial.uniforms.uSkyBottom.value.set('#cfc3a9')
citySkyMaterial.uniforms.uHorizonGlow.value.set('#ffffff')

// Fullscreen compositor: the default scene contains only this quad, which
// mixes the two scene render targets. StylePass grades the composed image.
const blendMaterial = new THREE.ShaderMaterial({
  uniforms: {
    tGrass: { value: null },
    tCity: { value: null },
    uMix: { value: START_CITY ? 1 : 0 },
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
    uniform sampler2D tGrass;
    uniform sampler2D tCity;
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
      if (m <= 0.0) { gl_FragColor = texture2D(tGrass, vUv); return; }
      if (m >= 1.0) { gl_FragColor = texture2D(tCity, vUv); return; }

      // ragged diagonal sweep field: front travels corner to corner
      float sweep = dot(vUv, vec2(0.62, 0.38));
      float field = sweep * 0.75 + fbm(vUv * 6.0) * 0.25;

      float W = 0.14; // burn-edge width
      float t = mix(-W, 1.0 + W, m); // threshold overshoots so both ends fully resolve
      float d = field - t;
      float mask = smoothstep(W * 0.5, -W * 0.5, d); // 1 = incoming city

      // heat-ripple warp near the front, pulling both scenes apart
      float edge = 1.0 - smoothstep(0.0, W, abs(d));
      vec2 warp = (vec2(
        noise(vUv * 40.0 + m * 10.0),
        noise(vUv * 40.0 + 7.3 - m * 10.0)
      ) - 0.5) * edge * 0.025;

      vec4 col = mix(texture2D(tGrass, vUv + warp), texture2D(tCity, vUv - warp), mask);

      // glowing ember rim with a hot white core on the dissolve front
      float rim = edge * edge;
      col.rgb += vec3(1.0, 0.85, 0.55) * rim * 0.55;
      col.rgb += rim * rim * 0.35;

      gl_FragColor = col;
    }
  `,
})

function Scenes({ toCity, children }) {
  const grassScene = useMemo(() => new THREE.Scene(), [])
  const cityScene = useMemo(() => new THREE.Scene(), [])
  const grassFBO = useFBO({ samples: 4 })
  const cityFBO = useFBO({ samples: 4 })
  const p = useRef(START_CITY ? 1 : 0)

  useFrame(({ gl, camera }, rawDt) => {
    const dt = Math.min(rawDt, 0.05)
    p.current = THREE.MathUtils.clamp(p.current + (toCity ? dt : -dt) / TRANSITION_SECONDS, 0, 1)
    blendMaterial.uniforms.uMix.value = THREE.MathUtils.smoothstep(p.current, 0, 1)
    blendMaterial.uniforms.tGrass.value = grassFBO.texture
    blendMaterial.uniforms.tCity.value = cityFBO.texture

    // the postprocessing composer leaves gl.autoClear=false — clear explicitly
    gl.setRenderTarget(grassFBO)
    gl.clear()
    gl.render(grassScene, camera)
    gl.setRenderTarget(cityFBO)
    gl.clear()
    gl.render(cityScene, camera)
    gl.setRenderTarget(null)
  }, 0.5)

  return (
    <>
      {createPortal(
        <>
          <Sky />
          {children}
        </>,
        grassScene
      )}
      {createPortal(
        <>
          <ScreenQuad material={citySkyMaterial} renderOrder={-10000} />
          <City />
        </>,
        cityScene
      )}
      <ScreenQuad material={blendMaterial} />
    </>
  )
}

const LOCATIONS = [
  {
    id: 'city',
    chapter: '01',
    name: 'Detroit',
  },
  {
    id: 'meadow',
    chapter: '02',
    name: 'Up North',
  },
]

function Hud({ toCity, onSelect }) {
  const active = LOCATIONS[toCity ? 0 : 1]

  return (
    <div className="hud" data-location={active.id}>
      <header className="hud-topbar">
        <div className="hud-brand" aria-label="Great Lakes Field Notes">
          <span className="hud-brand-mark">MI</span>
          <span className="hud-brand-name">
            Great Lakes
            <small>Field notes</small>
          </span>
        </div>

        <p className="hud-current"><span>{active.chapter}</span> Viewing {active.name}</p>

        <div className="hud-status">
          <span className="hud-status-dot" />
          Live terrain
        </div>
      </header>

      <nav className="hud-map" aria-labelledby="hud-map-title">
        <div className="hud-map-heading">
          <p id="hud-map-title">Explore Michigan</p>
          <span>Choose a destination</span>
        </div>
        <div className="hud-map-plot">
          <svg viewBox={MICHIGAN_VIEWBOX} aria-hidden="true" focusable="false">
            <path className="hud-map-shape hud-map-up" d={UP_PATH} />
            <path className="hud-map-shape" d={MITTEN_PATH} />
          </svg>
          {LOCATIONS.map((location) => {
            const selected = location.id === active.id
            return (
              <button
                className={`hud-map-stop hud-map-stop-${location.id}${selected ? ' active' : ''}`}
                type="button"
                key={location.id}
                onClick={() => onSelect(location.id === 'city')}
                aria-current={selected ? 'location' : undefined}
                aria-label={`View ${location.name}, chapter ${location.chapter}`}
              >
                <span className="hud-map-pin"><i>{location.chapter}</i></span>
                <span className="hud-map-label">{location.name}</span>
              </button>
            )
          })}
        </div>
        <p className="hud-map-credit">
          Outline by <a href="https://commons.wikimedia.org/wiki/File:SimpleMichigan.svg" target="_blank" rel="noreferrer">Phizzy</a>
          {' · '}<a href="https://creativecommons.org/licenses/by-sa/3.0/" target="_blank" rel="noreferrer">CC BY-SA 3.0</a>
        </p>
      </nav>

      <footer className="hud-footer">
        <p><span className="hud-drag-icon" aria-hidden="true" /> Drag to look · scroll to zoom</p>
        <p className="hud-progress"><strong>{active.chapter}</strong> / {String(LOCATIONS.length).padStart(2, '0')}</p>
      </footer>

      <div className="hud-corners" aria-hidden="true">
        <span /><span /><span /><span />
      </div>
    </div>
  )
}

export default function App() {
  const [toCity, setToCity] = useState(START_CITY)

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
      <Leva collapsed />
      <Canvas shadows dpr={[1, 2]} gl={{ antialias: true, alpha: false }}>
        <Suspense fallback={null}>
          <Camera />
          <Scenes toCity={toCity}>
            <Grass />
            <Rocks />
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
      <Hud toCity={toCity} onSelect={setToCity} />
      <MittenLoader />
    </main>
  )
}
