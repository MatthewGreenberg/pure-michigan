import { useState } from 'react'
import { useFrame } from '@react-three/fiber'
import * as THREE from 'three'
import { useClickCursor } from './ClickHint.jsx'
import { GRID, TILE } from './grass/constants.js'
import { uniforms as grassUniforms } from './grass/material.js'
import { audioMuted, hubTransition, sceneRendering } from './sceneState.js'
import { coastUniforms, FIELD_HALF, LAND_EDGE_Z, WATERLINE_Z } from './coast.js'

// The ocean is clipped to the tile footprint: exactly as wide as the field,
// flat, sitting just below the ground plane. The ground discards past
// LAND_EDGE_Z, so this plane shows through there; its landward strip paints
// the same world-space sand as the ground, hiding the straight seam.
const INNER_Z = LAND_EDGE_Z + 0.3 // tucked under the ground's all-sand strip
const WIDTH = GRID * TILE
const DEPTH = FIELD_HALF + INNER_Z
const CENTER_Z = INNER_Z - DEPTH / 2
const CENTER_Y = -0.02

// Skipping-stone splash ripples: a small ring buffer of (x, z, birthTime,
// amplitude) the fragment shader draws as expanding fading rings. Birth
// times are stamped from the shared uTime (real elapsed seconds) so JS and
// GLSL agree on age without a second clock.
const RIPPLE_N = 10
const rippleUniform = {
  value: Array.from({ length: RIPPLE_N }, () => new THREE.Vector4(0, 0, -100, 0)),
}
let rippleCursor = 0
function spawnRipple(x, z, amp) {
  rippleUniform.value[rippleCursor].set(x, z, grassUniforms.uTime.value, amp)
  rippleCursor = (rippleCursor + 1) % RIPPLE_N
}

// Original painted-coast shader: dry sand → wet sand → scalloped foam →
// banded turquoise → deep teal, with the same wave and sparkle treatment.
const material = new THREE.ShaderMaterial({
  uniforms: {
    uTime: grassUniforms.uTime,
    uWindSpeed: grassUniforms.uWindSpeed,
    uGustScale: grassUniforms.uGustScale,
    uSheen: grassUniforms.uSheen,
    uSandA: coastUniforms.uSandA,
    uSandB: coastUniforms.uSandB,
    uRipples: rippleUniform,
    uHover: { value: 0 }, // 0..1 — whole water band lightens while hovered
  },
  vertexShader: /* glsl */ `
    varying vec3 vPos;

    void main() {
      // No vertex bob: the surface must stay above the soil block's top face
      // (bobbing dipped below it and let brown show through), and at this
      // framing the displacement was subpixel anyway.
      vec4 wp = modelMatrix * vec4(position, 1.0);
      vPos = wp.xyz;
      gl_Position = projectionMatrix * viewMatrix * wp;
    }
  `,
  fragmentShader: /* glsl */ `
    uniform float uTime;
    uniform float uWindSpeed;
    uniform float uGustScale;
    uniform float uSheen;
    uniform vec3 uSandA;
    uniform vec3 uSandB;
    uniform vec4 uRipples[${RIPPLE_N}]; // x, z, birth uTime, amplitude
    uniform float uHover;
    varying vec3 vPos;

    float hash(vec2 p) {
      return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453);
    }
    float noise(vec2 p) {
      vec2 i = floor(p);
      vec2 f = fract(p);
      f = f * f * (3.0 - 2.0 * f);
      return mix(
        mix(hash(i), hash(i + vec2(1.0, 0.0)), f.x),
        mix(hash(i + vec2(0.0, 1.0)), hash(i + vec2(1.0, 1.0)), f.x),
        f.y
      );
    }
    float fbm(vec2 p) {
      float v = 0.0;
      float amp = 0.5;
      mat2 rot = mat2(0.8, -0.6, 0.6, 0.8);
      for (int i = 0; i < 3; i++) {
        v += amp * noise(p);
        p = rot * p * 2.1;
        amp *= 0.5;
      }
      return v;
    }

    void main() {
      float t = uTime;
      // Small amplitudes keep the waterline's reach well seaward of the grass
      // edge — the coast band inside the tile is short, so big excursions
      // washed white over the dune tufts.
      float runup = 0.15 * sin(t * 0.7 + sin(vPos.x * 0.4) * 1.7);
      float wobble = 0.15 * sin(vPos.x * 0.8 + t * 0.5)
        + 0.08 * sin(vPos.x * 2.1 - t * 0.33);
      float d = ${WATERLINE_Z} - vPos.z + wobble + runup;

      // Match the ground's world-space sand exactly at the plane overlap.
      float mottle = fbm(vPos.xz * 0.9 + 3.0);
      vec3 sand = mix(uSandA, uSandB, mottle);
      sand = mix(sand, vec3(0.70, 0.60, 0.43), smoothstep(-0.55, -0.05, d));
      float ghost = smoothstep(0.1, 0.0, abs(d + 0.4 + 0.08 * sin(vPos.x * 1.7)));
      sand = mix(sand, vec3(0.95, 0.93, 0.84), ghost * 0.4);

      // Full turquoise-to-teal range compressed into the short in-tile band.
      float depth = smoothstep(0.0, 3.0, d);
      depth = mix(depth, floor(depth * 3.0 + 0.5) / 3.0, 0.6);
      vec3 water = mix(vec3(0.44, 0.75, 0.68), vec3(0.13, 0.35, 0.47), depth);

      float p = mod(d + 0.25 * sin(vPos.x * 0.7 + t * 0.2) + t * 0.35, 1.4);
      float line = 1.0 - smoothstep(0.04, 0.15, abs(p - 0.7));
      line *= smoothstep(0.35, 0.55, noise(vec2(vPos.x * 0.5, d * 0.6 - t * 0.1)));
      line *= smoothstep(0.5, 0.9, d) * (1.0 - depth * 0.6);
      water = mix(water, vec3(0.72, 0.9, 0.85), line * 0.6);

      float scallop = 0.15 * abs(sin(vPos.x * 1.9 + t * 0.35))
        + 0.25 * fbm(vPos.xz * 1.4 + t * 0.15);
      float foam = smoothstep(-0.18, -0.05, d)
        * (1.0 - smoothstep(0.3 + scallop, 0.55 + scallop, d));
      foam *= 0.8 + 0.2 * noise(vPos.xz * 6.0 + t * 0.3);
      float second = 1.0 - smoothstep(
        0.04,
        0.11,
        abs(d - 1.0 - 0.2 * sin(vPos.x * 1.3 + t * 0.5))
      );
      second *= smoothstep(0.45, 0.6, noise(vec2(vPos.x * 0.8, t * 0.2))) * 0.7;

      vec3 color = mix(sand, water, smoothstep(-0.03, 0.08, d));
      color = mix(color, vec3(0.97, 0.96, 0.89), clamp(foam + second, 0.0, 1.0));

      // Continue the grass/ground gust field over both beach and water. Sand
      // keeps the warm ground glint while the water catches a cooler highlight.
      vec2 gustCoord = vPos.xz * uGustScale * 4.0 - uTime * uWindSpeed * vec2(0.0, 1.4);
      float gust = noise(gustCoord);
      float sheen = smoothstep(0.42, 0.82, gust);
      float waterMix = smoothstep(-0.03, 0.08, d);
      vec3 sheenLift = mix(vec3(0.07, 0.06, 0.025), vec3(0.08, 0.13, 0.14), waterMix);
      vec3 sheenColor = color * 1.45 + sheenLift;
      // Damp the wash on dry sand — full-strength sheen blew the pale beach
      // out to white and bled (via bloom) over the grass edge.
      color = mix(color, sheenColor, min(sheen * uSheen * 0.6, 0.7) * mix(0.35, 1.0, waterMix));

      // Hover affordance: the whole clickable water band lifts toward a paler
      // turquoise while the cursor is over it (sand masked out)
      color = mix(color, color * 1.16 + vec3(0.02, 0.05, 0.05), uHover * waterMix);

      // Skipping-stone rings: expanding foam circles + a brief splash core at
      // each touch point, water-only so beach clicks never paint the sand.
      for (int i = 0; i < ${RIPPLE_N}; i++) {
        vec4 rp = uRipples[i];
        float age = t - rp.z;
        if (age >= 0.0 && age < 1.6 && rp.w > 0.0) {
          float fade = 1.0 - age / 1.6;
          float rd = length(vPos.xz - rp.xy);
          float ring = 1.0 - smoothstep(0.02, 0.13 + age * 0.05, abs(rd - (0.1 + age * 1.05)));
          float splash = (1.0 - smoothstep(0.0, 0.22, rd)) * smoothstep(0.3, 0.0, age);
          color = mix(color, vec3(0.97, 0.97, 0.9),
            min((ring * fade * fade + splash) * rp.w, 1.0) * waterMix);
        }
      }

      // Sparse pinpricks ride inside the same moving field and only appear on
      // its brightest shoulders. Their HDR lift lets the bloom pass catch them.
      vec2 sparkleCoord = gustCoord * 5.0;
      vec2 sparkleCell = floor(sparkleCoord);
      vec2 sparkleUv = fract(sparkleCoord) - 0.5;
      vec2 sparklePoint = (vec2(
        hash(sparkleCell + 11.7),
        hash(sparkleCell + 37.1)
      ) - 0.5) * 0.7;
      float sparkle = 1.0 - smoothstep(0.035, 0.12, length(sparkleUv - sparklePoint));
      float twinkle = 0.5 + 0.5 * sin(t * 8.0 + hash(sparkleCell + 5.3) * 6.28318);
      sparkle *= smoothstep(0.62, 1.0, twinkle);

      float sheenPeak = smoothstep(0.72, 0.98, sheen);
      float sparkleStrength = clamp(uSheen * 0.65, 0.0, 1.2);
      float waterSparkle = sparkle * sheenPeak * waterMix * (1.0 - depth * 0.35);
      color += vec3(0.9, 1.0, 0.96) * waterSparkle * sparkleStrength;

      gl_FragColor = vec4(color, 1.0);
      #include <tonemapping_fragment>
      #include <colorspace_fragment>
    }
  `,
})

// Skipping stones — click the water and a stone whips out from the camp,
// skips with a ripple ring at each touch, then sinks with a plunk. Module-
// singleton pool like the city's baseballs (React Compiler lint); the first
// water contact lands exactly on the click point (throw solved analytically
// from the flight time). Stones don't cast shadow — the ocean is unlit and
// a moving caster would need on-demand shadow re-arming every frame.
const NO_RAYCAST = () => null
const STONE_N = 8
const STONE_G = 7
const THROW_FROM = new THREE.Vector3(2.35, 0.5, -3.95) // beside the beach camp
const stoneGeometry = new THREE.SphereGeometry(1, 10, 8)
stoneGeometry.scale(0.16, 0.055, 0.13) // flat skipper baked into the geometry
const stoneMaterial = new THREE.MeshLambertMaterial({ color: '#8a857a' })
const stones = Array.from({ length: STONE_N }, () => {
  const mesh = new THREE.Mesh(stoneGeometry, stoneMaterial)
  mesh.visible = false
  mesh.raycast = NO_RAYCAST
  return { mesh, vel: new THREE.Vector3(), state: 'idle', age: 0, bounces: 0 }
})
const stoneRig = new THREE.Group()
stones.forEach((s) => stoneRig.add(s.mesh))
let throwStamp = 0

function playRockSkip(bounce) {
  if (audioMuted.on) return
  const a = new Audio('/sounds/rock-skip.mp3')
  // 5–50% on first hit, each bounce halves from there
  a.volume = (0.05 + Math.random() * 0.45) * Math.pow(0.5, bounce)
  a.play().catch(() => {})
}

function throwStone(target) {
  let s = stones.find((x) => x.state === 'idle')
  if (!s) s = stones.reduce((a, x) => (x.age < a.age ? x : a))
  s.age = ++throwStamp
  s.state = 'fly'
  s.bounces = 0
  s.mesh.visible = true
  s.mesh.position.copy(THROW_FROM)
  // aim so the first descent crosses water level right at the click point
  const dx = target.x - THROW_FROM.x
  const dz = target.z - THROW_FROM.z
  const t1 = Math.max(Math.hypot(dx, dz) / 5.5, 0.3) // ~5.5 u/s sidearm throw
  s.vel.set(dx / t1, (CENTER_Y - THROW_FROM.y) / t1 + 0.5 * STONE_G * t1, dz / t1)
}

function updateStones(dt) {
  for (const s of stones) {
    if (s.state === 'idle') continue
    const p = s.mesh.position
    s.vel.y -= (s.state === 'sink' ? 2.5 : STONE_G) * dt // water drag on the way down
    p.addScaledVector(s.vel, dt)
    s.mesh.rotation.y += 10 * dt // sidearm spin
    if (s.state === 'fly' && s.vel.y < 0 && p.y < CENTER_Y) {
      const onWater = p.z < WATERLINE_Z + 0.2 && p.z > -FIELD_HALF && Math.abs(p.x) < FIELD_HALF
      if (onWater) {
        p.y = CENTER_Y
        s.vel.y *= -0.55
        s.vel.x *= 0.8
        s.vel.z *= 0.8
        playRockSkip(s.bounces++)
        if (s.vel.y < 0.5) {
          // out of juice: plunk under with the big ring
          s.state = 'sink'
          s.vel.multiplyScalar(0.4)
          spawnRipple(p.x, p.z, 1.0)
        } else {
          spawnRipple(p.x, p.z, 0.55)
        }
      } else if (p.z >= WATERLINE_Z + 0.2) {
        // clipped the beach: dead thud into the sand, no ripple
        s.state = 'sink'
        s.vel.multiplyScalar(0.25)
      }
      // off-tile contacts fall past the diorama edge instead
    }
    if (p.y < -2.5 || Math.abs(p.x) > FIELD_HALF + 1 || p.z < -FIELD_HALF - 1) {
      s.state = 'idle'
      s.mesh.visible = false
    }
  }
}

function SkippingStones() {
  const [hovered, setHovered] = useState(false)
  useClickCursor(hovered)
  useFrame((_, rawDt) => {
    if (!sceneRendering('meadow')) return
    const dt = Math.min(rawDt, 0.05)
    updateStones(dt)
    const u = material.uniforms.uHover
    u.value += ((hovered ? 1 : 0) - u.value) * Math.min(dt * 8, 1)
  })
  return (
    <group>
      {/* invisible click target over the water band; handlers gate on the
          meadow being the destination — the shared event root raycasts
          portal scenes even while they're hidden (see MichiganHub markers) */}
      <mesh
        rotation-x={-Math.PI / 2}
        position={[0, 0.02, (WATERLINE_Z - FIELD_HALF) / 2]}
        onClick={(event) => {
          if (hubTransition.to !== 'meadow') return
          event.stopPropagation()
          throwStone(event.point)
        }}
        onPointerOver={(event) => {
          if (hubTransition.to !== 'meadow') return
          event.stopPropagation()
          setHovered(true)
        }}
        onPointerOut={() => setHovered(false)}
      >
        <planeGeometry args={[WIDTH, FIELD_HALF + WATERLINE_Z]} />
        <meshBasicMaterial colorWrite={false} depthWrite={false} />
      </mesh>
      <primitive object={stoneRig} />
    </group>
  )
}

export function Ocean() {
  return (
    <group>
      <mesh
        material={material}
        rotation-x={-Math.PI / 2}
        position={[0, CENTER_Y, CENTER_Z]}
        frustumCulled={false}
      >
        <planeGeometry args={[WIDTH, DEPTH]} />
      </mesh>
      <SkippingStones />
    </group>
  )
}
