import * as THREE from 'three'

const SIZE = 15
const DEPTH = 2
const TOP_Y = -0.1
// Urban fill cross-section: compacted crushed stone, concrete fines, brick
// chips, and darker settled bands — all painted into the face in-shader.
const baseMaterial = new THREE.ShaderMaterial({
  vertexShader: /* glsl */ `
    varying vec3 vPos;
    varying vec3 vNormal;

    void main() {
      vec4 world = modelMatrix * vec4(position, 1.0);
      vPos = world.xyz;
      vNormal = normalize(mat3(modelMatrix) * normal);
      gl_Position = projectionMatrix * viewMatrix * world;
    }
  `,
  fragmentShader: /* glsl */ `
    varying vec3 vPos;
    varying vec3 vNormal;

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
      float value = 0.0;
      float amplitude = 0.5;
      mat2 turn = mat2(0.8, -0.6, 0.6, 0.8);
      for (int i = 0; i < 4; i++) {
        value += noise(p) * amplitude;
        p = turn * p * 2.08;
        amplitude *= 0.5;
      }
      return value;
    }

    mat2 rotate2d(float a) {
      float c = cos(a);
      float s = sin(a);
      return mat2(c, -s, s, c);
    }

    void main() {
      vec3 normal = normalize(vNormal);
      vec2 face = abs(normal.x) > 0.5 ? vPos.zy : vPos.xy;
      float depth = clamp((${TOP_Y.toFixed(1)} - vPos.y) / ${DEPTH.toFixed(1)}, 0.0, 1.0);

      // Compacted gray-brown road base, darker and slightly damper at depth.
      vec3 fill = mix(vec3(0.38, 0.37, 0.34), vec3(0.24, 0.25, 0.24), depth);
      float broad = fbm(face * vec2(0.72, 1.55) + 4.0);
      float fines = fbm(face * vec2(5.5, 8.0) + 19.0);
      fill *= 0.82 + broad * 0.26 + fines * 0.11;

      // Uneven compacted lifts from successive layers of road-base material.
      float liftWarp = fbm(vec2(face.x * 0.55, face.y * 1.8) + 9.0);
      float lifts = sin(vPos.y * 9.5 + liftWarp * 4.0) * 0.5 + 0.5;
      fill *= 0.93 + lifts * 0.10;

      // Dense fine gravel. Each cell has its own rotation, aspect, mineral
      // color, socket shadow, and crown highlight, so it reads above pixel noise.
      vec2 gc = face * vec2(9.5, 12.5);
      vec2 gcell = floor(gc);
      vec2 gp = fract(gc) - 0.5;
      gp -= (vec2(hash(gcell + 3.1), hash(gcell + 8.7)) - 0.5) * 0.42;
      gp = rotate2d(hash(gcell + 11.0) * 6.283) * gp;
      gp *= vec2(
        mix(0.72, 1.38, hash(gcell + 17.0)),
        mix(0.78, 1.28, hash(gcell + 23.0))
      );
      float gr = 0.12 + hash(gcell + 29.0) * 0.13;
      float gritEdge = (noise(gp * 9.0 + gcell) - 0.5) * 0.065;
      float gd = length(gp) + gritEdge;
      float gexists = step(0.34, hash(gcell + 37.0));
      float gravelOuter = (1.0 - smoothstep(gr + 0.025, gr + 0.085, gd)) * gexists;
      float gravel = (1.0 - smoothstep(gr - 0.018, gr + 0.016, gd)) * gexists;
      fill *= 1.0 - max(gravelOuter - gravel, 0.0) * 0.30;

      float mineralId = hash(gcell + 43.0);
      vec3 gravelColor = mix(vec3(0.31, 0.32, 0.32), vec3(0.63, 0.60, 0.53), mineralId);
      gravelColor = mix(gravelColor, vec3(0.48, 0.42, 0.36),
        smoothstep(0.76, 0.96, hash(gcell + 47.0)));
      gravelColor *= clamp(0.78 + gp.y * 1.15 - gp.x * 0.28, 0.62, 1.18);
      gravelColor *= 0.88 + fbm(gp * 17.0 + gcell * 1.7) * 0.22;
      fill = mix(fill, gravelColor, gravel * 0.94);

      // Larger angular fragments: limestone and occasional warm brick chips.
      vec2 rc = face * vec2(2.25, 3.0) + 31.0;
      vec2 rcell = floor(rc);
      vec2 rp = fract(rc) - 0.5;
      rp -= (vec2(hash(rcell + 2.0), hash(rcell + 7.0)) - 0.5) * 0.34;
      rp = rotate2d((hash(rcell + 13.0) - 0.5) * 2.8) * rp;
      rp *= vec2(mix(0.72, 1.38, hash(rcell + 19.0)), mix(0.88, 1.32, hash(rcell + 23.0)));
      float angle = atan(rp.y, rp.x);
      float chipped = sin(angle * (5.0 + floor(hash(rcell + 29.0) * 3.0))) * 0.022
        + (noise(rp * 8.0 + rcell) - 0.5) * 0.075;
      float rr = 0.18 + hash(rcell + 31.0) * 0.13;
      float rd = length(rp) + chipped;
      float rexists = step(0.53, hash(rcell + 37.0));
      float rubbleOuter = (1.0 - smoothstep(rr + 0.025, rr + 0.085, rd)) * rexists;
      float rubble = (1.0 - smoothstep(rr - 0.022, rr + 0.014, rd)) * rexists;
      fill *= 1.0 - max(rubbleOuter - rubble, 0.0) * 0.38;

      vec3 rubbleColor = mix(vec3(0.38, 0.39, 0.38), vec3(0.69, 0.66, 0.59), hash(rcell + 41.0));
      float brick = step(0.88, hash(rcell + 47.0));
      rubbleColor = mix(rubbleColor, vec3(0.48, 0.25, 0.17), brick);
      rubbleColor *= clamp(0.72 + rp.y * 1.18 - rp.x * 0.22, 0.60, 1.17);
      float rubbleGrain = fbm(rp * 13.0 + rcell * 2.4);
      rubbleColor *= 0.77 + rubbleGrain * 0.36;
      fill = mix(fill, rubbleColor, rubble * 0.97);

      // Asphalt dust and compression directly below the city surface.
      float capNoise = (noise(vec2(face.x * 2.4, 2.0)) - 0.5) * 0.035;
      float cap = smoothstep(-0.25 + capNoise, -0.11 + capNoise, vPos.y);
      fill = mix(fill, vec3(0.20, 0.21, 0.21) * (0.9 + fines * 0.16), cap * 0.76);

      float faceLight = 0.68 + 0.32 * max(dot(normal, normalize(vec3(0.45, 0.78, 0.56))), 0.0);
      gl_FragColor = vec4(fill * faceLight, 1.0);
      #include <tonemapping_fragment>
      #include <colorspace_fragment>
    }
  `,
})

export function CityBase() {
  return (
    <group>
      {/* lights stay: City.jsx gives the RenCen a Lambert material that needs them */}
      <ambientLight intensity={1.3} color="#c7cbc8" />
      <directionalLight position={[8, 10, 7]} intensity={1.2} color="#ffe8c9" />
      <mesh material={baseMaterial} position={[0, TOP_Y - DEPTH / 2, 0]}>
        <boxGeometry args={[SIZE, DEPTH, SIZE]} />
      </mesh>
    </group>
  )
}
