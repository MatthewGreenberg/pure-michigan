import { Color, Uniform } from 'three'
import { useControls } from 'leva'
import { BlendFunction, Effect, EffectAttribute } from 'postprocessing'
import { Bloom, EffectComposer, wrapEffect } from '@react-three/postprocessing'

const LEGACY_MODES = { ink: 0, anime: 1, outline: 2, 'b&w': 3 }

const sereneFragmentShader = /* glsl */ `
  uniform float uWash;
  uniform float uWashRadius;
  uniform float uSaturation;
  uniform float uGreenSoftness;
  uniform vec3 uShadowTint;
  uniform vec3 uHighlightTint;
  uniform vec3 uHazeColor;
  uniform float uHaze;
  uniform float uVignette;
  uniform float uDither;

  float sereneLuma(vec3 c) {
    return dot(c, vec3(0.299, 0.587, 0.114));
  }

  float sereneHash(vec2 p) {
    return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453);
  }

  // Average nearby color only when its value is close to the center pixel.
  // This quiets the grass palette without blurring strong illustrated edges.
  vec4 sereneGather(vec2 uv, vec2 offset, float centerLuma) {
    vec4 sampleColor = texture2D(inputBuffer, uv + offset);
    float delta = abs(sereneLuma(sampleColor.rgb) - centerLuma);
    float edgeWeight = exp(-delta * 18.0);
    return vec4(sampleColor.rgb * edgeWeight, edgeWeight);
  }

  vec3 sereneTint(vec3 color, vec3 tint, float amount) {
    float value = sereneLuma(color);
    float tintValue = max(sereneLuma(tint), 0.001);
    vec3 valueMatchedTint = tint * (value / tintValue);
    return mix(color, valueMatchedTint, amount);
  }

  void mainImage(
    const in vec4 inputColor,
    const in vec2 uv,
    const in float depth,
    out vec4 outputColor
  ) {
    vec3 original = inputColor.rgb;
    float centerLuma = sereneLuma(original);
    vec2 radius = texelSize * uWashRadius;

    vec4 gathered = vec4(original, 1.0);
    gathered += sereneGather(uv, vec2(radius.x, 0.0), centerLuma);
    gathered += sereneGather(uv, vec2(-radius.x, 0.0), centerLuma);
    gathered += sereneGather(uv, vec2(0.0, radius.y), centerLuma);
    gathered += sereneGather(uv, vec2(0.0, -radius.y), centerLuma);
    vec3 neighborColor = gathered.rgb / max(gathered.a, 0.001);

    // Transfer the neighbor chroma while retaining most of the center pixel's
    // luminance detail. A small value wash keeps the result painterly.
    vec3 neighborChroma = neighborColor - vec3(sereneLuma(neighborColor));
    vec3 chromaWash = vec3(centerLuma) + neighborChroma;
    chromaWash = mix(chromaWash, neighborColor, 0.08);
    vec3 color = mix(original, chromaWash, uWash);

    // Calm saturated grass selectively so the red roof remains the focal
    // accent. Moving a little green energy into red/blue produces a sage hue.
    float greenLead = color.g - max(color.r, color.b);
    float greenMask = smoothstep(-0.005, 0.18, greenLead)
      * smoothstep(0.08, 0.55, sereneLuma(color));
    vec3 sage = color;
    sage.r += max(color.g - color.r, 0.0) * 0.18;
    sage.b += max(color.g - color.b, 0.0) * 0.12;
    sage.g *= 0.87;
    color = mix(color, sage, greenMask * uGreenSoftness);

    float value = sereneLuma(color);
    color = mix(vec3(value), color, uSaturation);

    // Luma-preserving split tone: cool lifted shadows, warm creamy light.
    float shadowMask = 1.0 - smoothstep(0.12, 0.58, value);
    float highlightMask = smoothstep(0.52, 0.96, value);
    color = sereneTint(color, uShadowTint, shadowMask * 0.085);
    color = sereneTint(color, uHighlightTint, highlightMask * 0.095);

    // Gentle toe lift and shoulder compression without flattening local form.
    vec3 softCurve = color / (vec3(0.86) + color * 0.14);
    color = mix(color, softCurve, 0.16);

    // Orthographic depth is linear. The cleared background remains at 1.0,
    // so it is excluded while the rear of the diorama receives subtle haze.
    float sceneMask = 1.0 - step(0.999, depth);
    float hazeMask = smoothstep(0.14, 0.29, depth) * sceneMask * uHaze;
    color = mix(color, uHazeColor, hazeMask);

    vec2 vignetteUv = (uv - vec2(0.5, 0.50)) * vec2(0.86, 1.0);
    float vignette = smoothstep(0.38, 0.72, length(vignetteUv));
    color *= 1.0 - vignette * uVignette;

    // Static sub-pixel dither prevents the soft gradients from banding.
    float grain = sereneHash(floor(uv / texelSize)) - 0.5;
    color += grain * uDither;

    outputColor = vec4(max(color, 0.0), inputColor.a);
  }
`

class SereneEffectImpl extends Effect {
  constructor({
    wash = 0.2,
    washRadius = 1.8,
    saturation = 0.9,
    greenSoftness = 0.9,
    shadowTint = '#718792',
    highlightTint = '#ffe4bb',
    hazeColor = '#a9c6c0',
    haze = 0.065,
    vignette = 0.055,
    dither = 0.006,
  } = {}) {
    super('SereneEffect', sereneFragmentShader, {
      blendFunction: BlendFunction.NORMAL,
      attributes: EffectAttribute.CONVOLUTION | EffectAttribute.DEPTH,
      uniforms: new Map([
        ['uWash', new Uniform(wash)],
        ['uWashRadius', new Uniform(washRadius)],
        ['uSaturation', new Uniform(saturation)],
        ['uGreenSoftness', new Uniform(greenSoftness)],
        ['uShadowTint', new Uniform(new Color(shadowTint))],
        ['uHighlightTint', new Uniform(new Color(highlightTint))],
        ['uHazeColor', new Uniform(new Color(hazeColor))],
        ['uHaze', new Uniform(haze)],
        ['uVignette', new Uniform(vignette)],
        ['uDither', new Uniform(dither)],
      ]),
    })
  }
}

const WrappedSereneEffect = wrapEffect(SereneEffectImpl, {
  blendFunction: BlendFunction.NORMAL,
})

const legacyFragmentShader = /* glsl */ `
  uniform int uMode;
  uniform float uEdge;
  uniform float uLevels;

  float legacyLuma(vec3 c) { return dot(c, vec3(0.299, 0.587, 0.114)); }

  float legacySampleLuma(vec2 uv) {
    vec4 s = texture2D(inputBuffer, uv);
    return legacyLuma(s.rgb) * s.a;
  }

  void mainImage(const in vec4 inputColor, const in vec2 uv, out vec4 outputColor) {
    float tl = legacySampleLuma(uv + texelSize * vec2(-1.0,  1.0));
    float t  = legacySampleLuma(uv + texelSize * vec2( 0.0,  1.0));
    float tr = legacySampleLuma(uv + texelSize * vec2( 1.0,  1.0));
    float l  = legacySampleLuma(uv + texelSize * vec2(-1.0,  0.0));
    float r  = legacySampleLuma(uv + texelSize * vec2( 1.0,  0.0));
    float bl = legacySampleLuma(uv + texelSize * vec2(-1.0, -1.0));
    float b  = legacySampleLuma(uv + texelSize * vec2( 0.0, -1.0));
    float br = legacySampleLuma(uv + texelSize * vec2( 1.0, -1.0));
    float gx = (tr + 2.0 * r + br) - (tl + 2.0 * l + bl);
    float gy = (tl + 2.0 * t + tr) - (bl + 2.0 * b + br);
    float edge = clamp(length(vec2(gx, gy)) * uEdge, 0.0, 1.0);

    vec3 c = inputColor.rgb;
    vec3 color = c;

    if (uMode == 0) {
      vec3 paper = vec3(0.93, 0.90, 0.84);
      vec3 ink = vec3(0.10, 0.12, 0.17);
      float wash = floor(legacyLuma(c) * uLevels) / max(uLevels - 1.0, 1.0);
      color = mix(ink, paper, clamp(wash, 0.0, 1.0));
      color = mix(color, ink, edge);
    } else if (uMode == 1) {
      vec3 banded = (floor(c * uLevels) + 0.5) / uLevels;
      float gray = legacyLuma(banded);
      color = mix(vec3(gray), banded, 1.25);
      color = mix(color, vec3(0.04), edge * 0.85);
    } else if (uMode == 2) {
      color = mix(c, vec3(0.03), edge);
    } else {
      float gray = smoothstep(0.03, 0.97, legacyLuma(c));
      color = vec3(gray);
    }

    outputColor = vec4(color, inputColor.a);
  }
`

class LegacyStyleEffectImpl extends Effect {
  constructor({ mode = 0, edge = 3, levels = 5 } = {}) {
    super('LegacyStyleEffect', legacyFragmentShader, {
      blendFunction: BlendFunction.NORMAL,
      attributes: EffectAttribute.CONVOLUTION,
      uniforms: new Map([
        ['uMode', new Uniform(mode)],
        ['uEdge', new Uniform(edge)],
        ['uLevels', new Uniform(levels)],
      ]),
    })
  }
}

const WrappedLegacyEffect = wrapEffect(LegacyStyleEffectImpl, {
  blendFunction: BlendFunction.NORMAL,
})

export function StylePass() {
  const {
    style,
    wash,
    washRadius,
    saturation,
    greenSoftness,
    haze,
    vignette,
    bloom,
    edge,
    levels,
  } = useControls('style', {
    style: { value: 'serene', options: ['serene', 'none', 'ink', 'anime', 'outline', 'b&w'] },
    wash: { value: 0.2, min: 0, max: 0.6, step: 0.01, label: 'color wash' },
    washRadius: { value: 1.8, min: 0.5, max: 4, step: 0.1, label: 'wash radius' },
    saturation: { value: 0.9, min: 0, max: 1.4, step: 0.01 },
    greenSoftness: { value: 0.9, min: 0, max: 1.5, step: 0.01, label: 'soften greens' },
    haze: { value: 0.065, min: 0, max: 0.4, step: 0.005 },
    vignette: { value: 0.055, min: 0, max: 0.3, step: 0.005 },
    bloom: { value: 0.14, min: 0, max: 1, step: 0.01 },
    edge: { value: 3, min: 0, max: 10, step: 0.1, label: 'legacy lines' },
    levels: { value: 5, min: 2, max: 12, step: 1, label: 'legacy bands' },
  }, { collapsed: false, order: 8 })

  if (style === 'none') return null

  if (style !== 'serene') {
    return (
      <EffectComposer multisampling={4}>
        <WrappedLegacyEffect mode={LEGACY_MODES[style]} edge={edge} levels={levels} />
      </EffectComposer>
    )
  }

  return (
    <EffectComposer multisampling={4} depthBuffer>
      <Bloom
        mipmapBlur
        intensity={bloom}
        luminanceThreshold={0.82}
        luminanceSmoothing={0.18}
        radius={0.75}
      />
      <WrappedSereneEffect
        wash={wash}
        washRadius={washRadius}
        saturation={saturation}
        greenSoftness={greenSoftness}
        haze={haze}
        vignette={vignette}
      />
    </EffectComposer>
  )
}
