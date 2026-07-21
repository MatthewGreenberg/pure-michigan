import { useRef, useState } from 'react'
import { useFrame } from '@react-three/fiber'
import { useControls } from 'leva'
import * as THREE from 'three'
import { uniforms as grassUniforms } from './grass/material.js'

const NO_RAYCAST = () => null

// Flat shader stratus for the dioramas: one transparent horizontal plane,
// wispy fbm streaks stretched along the wind, alpha-only — no volume, no
// lights, no frame loop (rides the shared grass uTime like Ocean/river).
function makeCloudSheetMaterial({ color, shade, cover, opacity, directionDeg, speed, scaleAlong, scaleAcross, soft }) {
  const radians = THREE.MathUtils.degToRad(directionDeg)
  const c = Math.cos(radians)
  const s = Math.sin(radians)
  return new THREE.ShaderMaterial({
    transparent: true,
    depthWrite: false,
    uniforms: {
      uTime: grassUniforms.uTime,
      uColor: { value: new THREE.Color(color) },
      uShade: { value: new THREE.Color(shade) },
      uCover: { value: cover },
      uOpacity: { value: opacity },
      uDir: { value: new THREE.Vector2(c, s) },
      uSpeed: { value: speed },
      uScale: { value: new THREE.Vector2(scaleAlong, scaleAcross) },
      uSoft: { value: soft },
    },
    vertexShader: /* glsl */ `
      varying vec2 vUv;
      varying vec2 vPos;
      void main() {
        vUv = uv;
        vPos = position.xy; // plane-local world units
        gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
      }
    `,
    fragmentShader: /* glsl */ `
      uniform float uTime;
      uniform vec3 uColor;
      uniform vec3 uShade;
      uniform float uCover;
      uniform float uOpacity;
      uniform vec2 uDir;
      uniform float uSpeed;
      uniform vec2 uScale;
      uniform float uSoft;
      varying vec2 vUv;
      varying vec2 vPos;

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
        // rotate into the wind frame, then squash across-wind so features
        // become long streaks; drift upwind over time
        vec2 wind = vec2(dot(vPos, uDir), dot(vPos, vec2(-uDir.y, uDir.x)));
        wind.x -= uTime * uSpeed;
        vec2 q = wind * uScale;
        // ponytail: one fbm, not two — the fine-detail octave doubled the
        // heaviest always-on fragment cost for a barely visible shimmer
        float n = fbm(q);

        float cloud = smoothstep(1.0 - uCover - uSoft, 1.0 - uCover + uSoft, n);
        // asymmetric falloff: gentle thinning toward the camera (uv.y=0,
        // which also hides the ortho near-clip line crossing the plane),
        // narrow trims on the far-offscreen side edges
        float fade = smoothstep(0.0, 0.12, min(vUv.x, 1.0 - vUv.x))
          * smoothstep(0.0, 0.18, vUv.y)
          * smoothstep(0.0, 0.06, 1.0 - vUv.y);
        // denser cores dim toward the shade tone for a hint of underside
        vec3 col = mix(uColor, uShade, smoothstep(0.45, 1.0, cloud) * 0.5);

        float alpha = cloud * fade * uOpacity;
        if (alpha < 0.004) discard;
        gl_FragColor = vec4(col, alpha);
      }
    `,
  })
}

const SHEETS = {
  warm: makeCloudSheetMaterial({
    color: '#fffdf6', shade: '#ffffff', cover: 0.33, opacity: 1, directionDeg: 31, speed: 1.15,
    scaleAlong: 0.06, scaleAcross: 0.15, soft: 0.22,
  }),
  steel: makeCloudSheetMaterial({
    color: '#f2f7fa', shade: '#ffffff', cover: 0.33, opacity: 1, directionDeg: -159, speed: 0.32,
    scaleAlong: 0.1, scaleAcross: 0.24, soft: 0.15,
  }),
}

// Load intro: two stacked warm stratus sheets blanket the map for a
// break-through-the-clouds reveal; once the loader fires mitten-done the
// high thin veil clears first (~1.9s), then the dense low blanket burns off
// (~2.6s, delayed 0.3s), opacity chased out at each tail, matching
// Camera.jsx's slow push-in. Counter-drifting layers give parallax depth.
const INTRO_COVER = 1.15 // past the shader's solid point so the blanket starts gapless
const INTRO_LAYERS = [
  { // high thin veil, drifting against the blanket for parallax
    material: makeCloudSheetMaterial({
      color: '#fffdf6', shade: '#d8dfd8', cover: INTRO_COVER, opacity: 0.85, directionDeg: -132, speed: 1.9,
      scaleAlong: 0.045, scaleAcross: 0.11, soft: 0.26,
    }),
    // higher altitude moves the near-clip crossing up-plane, so this layer's
    // near edge is pushed back a bit further to keep it inside the uv.y fade
    position: [-27, 10, -27], opacity: 0.85, seconds: 1.9, delay: 0,
  },
  { // dense low blanket, the main burn-off
    material: makeCloudSheetMaterial({
      color: '#fffdf6', shade: '#ccd6cc', cover: INTRO_COVER, opacity: 1, directionDeg: 78, speed: 1.15,
      scaleAlong: 0.06, scaleAcross: 0.15, soft: 0.22,
    }),
    position: [-24.7, 7, -24.7], opacity: 1, seconds: 2.6, delay: 0.3,
  },
]

function IntroStratus() {
  const [done, setDone] = useState(false)
  const elapsed = useRef(0)
  useFrame((_, rawDt) => {
    if (done || !window.__mittenDone) return
    elapsed.current += Math.min(rawDt, 0.05)
    let alive = false
    for (const layer of INTRO_LAYERS) {
      const p = Math.min(Math.max((elapsed.current - layer.delay) / layer.seconds, 0), 1)
      const u = layer.material.uniforms
      u.uCover.value = INTRO_COVER * (1 - p)
      u.uOpacity.value = Math.min(u.uCover.value / 0.2, layer.opacity)
      if (p < 1) alive = true
    }
    if (!alive) setDone(true)
  })
  if (done) return null
  // Bigger than the diorama sheets (the intro camera holds a pulled-back
  // zoom, so more world is on screen): same near edge as the 65-deep sheet
  // (keeps the near-clip crossing inside the uv.y fade), extra depth pushed
  // away from the camera along (-1,0,-1)/√2, still inside the ortho far box.
  return INTRO_LAYERS.map((layer) => (
    <mesh
      key={layer.position[1]}
      position={layer.position}
      rotation={[-Math.PI / 2, 0, Math.PI / 4]}
      material={layer.material}
      renderOrder={9000}
      frustumCulled={false}
      raycast={NO_RAYCAST}
    >
      <planeGeometry args={[240, 110]} />
    </mesh>
  ))
}

// Screen-aligned under the fixed iso camera: the extra rotation-z spins the
// plane 45° so its width runs along the screen's horizontal axis (1,0,-1)/√2
// and spans well past both edges at any aspect; depth runs up-screen, pushed
// away from the camera so the whole plane sits inside the ortho near/far box
// (near-clip crosses the layer ~20 units toward the camera; the uv.y fade
// dissolves the clouds before they reach it).
export function CloudSheet({ tint = 'warm', altitude: defaultAltitude = 7.2 }) {
  const material = SHEETS[tint]
  const uniforms = material.uniforms

  // Everything except altitude writes transiently to the sheet's uniforms —
  // no re-render. Values initialize from the tint's preset, so each scene
  // gets its own folder starting where its material is tuned.
  const { altitude } = useControls(
    tint === 'warm' ? 'stratus · up north' : 'stratus · detroit',
    {
      altitude: { value: defaultAltitude, min: 3, max: 14, step: 0.1 },
      cover: {
        value: uniforms.uCover.value, min: 0, max: 1, step: 0.01,
        onChange: (v) => { uniforms.uCover.value = v },
      },
      opacity: {
        value: uniforms.uOpacity.value, min: 0, max: 1, step: 0.01,
        onChange: (v) => { uniforms.uOpacity.value = v },
      },
      softness: {
        value: uniforms.uSoft.value, min: 0.03, max: 0.45, step: 0.01,
        onChange: (v) => { uniforms.uSoft.value = v },
      },
      streakLength: {
        value: uniforms.uScale.value.x, min: 0.02, max: 0.2, step: 0.005, label: 'streak scale ∥',
        onChange: (v) => { uniforms.uScale.value.x = v },
      },
      streakWidth: {
        value: uniforms.uScale.value.y, min: 0.05, max: 0.5, step: 0.005, label: 'streak scale ⊥',
        onChange: (v) => { uniforms.uScale.value.y = v },
      },
      speed: {
        value: uniforms.uSpeed.value, min: 0, max: 2, step: 0.01,
        onChange: (v) => { uniforms.uSpeed.value = v },
      },
      direction: {
        value: Math.round(THREE.MathUtils.radToDeg(Math.atan2(uniforms.uDir.value.y, uniforms.uDir.value.x))),
        min: -180, max: 180, step: 1, label: 'direction °',
        onChange: (v) => {
          const radians = THREE.MathUtils.degToRad(v)
          uniforms.uDir.value.set(Math.cos(radians), Math.sin(radians))
        },
      },
      cloudColor: {
        value: `#${uniforms.uColor.value.getHexString()}`, label: 'cloud color',
        onChange: (v) => { uniforms.uColor.value.set(v) },
      },
      shadeColor: {
        value: `#${uniforms.uShade.value.getHexString()}`, label: 'shade',
        onChange: (v) => { uniforms.uShade.value.set(v) },
      },
    },
    { collapsed: true, order: tint === 'warm' ? 8 : 9 },
  )

  return (
    <mesh
      position={[-8.8, altitude, -8.8]}
      rotation={[-Math.PI / 2, 0, Math.PI / 4]}
      material={SHEETS[tint]}
      renderOrder={9000}
      frustumCulled={false}
      raycast={NO_RAYCAST}
    >
      <planeGeometry args={[170, 65]} />
    </mesh>
  )
}

// The map hub's cloud deck is gone — only the load-intro stratus blanket remains.
export function CloudCover() {
  return <IntroStratus />
}
