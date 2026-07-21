import { Uniform } from 'three'
import { useControls } from 'leva'
import { BlendFunction, Effect, EffectAttribute } from 'postprocessing'
import { EffectComposer, wrapEffect } from '@react-three/postprocessing'

const MODES = { ink: 0, anime: 1, outline: 2, 'b&w': 3 }

const styleFragmentShader = /* glsl */ `
  uniform int uMode;
  uniform float uEdge;
  uniform float uLevels;
  uniform float uStrength;
  uniform float uInkSaturation;
  uniform float uVignette;

  float luma(vec3 c) { return dot(c, vec3(0.299, 0.587, 0.114)); }

  float sampleLuma(vec2 uv) {
    vec4 s = texture2D(inputBuffer, uv);
    return luma(s.rgb) * s.a;
  }

  void mainImage(const in vec4 inputColor, const in vec2 uv, out vec4 outputColor) {
    float tl = sampleLuma(uv + texelSize * vec2(-1.0,  1.0));
    float t  = sampleLuma(uv + texelSize * vec2( 0.0,  1.0));
    float tr = sampleLuma(uv + texelSize * vec2( 1.0,  1.0));
    float l  = sampleLuma(uv + texelSize * vec2(-1.0,  0.0));
    float r  = sampleLuma(uv + texelSize * vec2( 1.0,  0.0));
    float bl = sampleLuma(uv + texelSize * vec2(-1.0, -1.0));
    float b  = sampleLuma(uv + texelSize * vec2( 0.0, -1.0));
    float br = sampleLuma(uv + texelSize * vec2( 1.0, -1.0));
    float gx = (tr + 2.0 * r + br) - (tl + 2.0 * l + bl);
    float gy = (tl + 2.0 * t + tr) - (bl + 2.0 * b + br);
    float edge = clamp(length(vec2(gx, gy)) * uEdge, 0.0, 1.0);

    vec3 c = inputColor.rgb;
    vec3 color = c;

    if (uMode == 0) {
      vec3 paper = vec3(0.93, 0.90, 0.84);
      vec3 ink = vec3(0.10, 0.12, 0.17);
      float wash = floor(luma(c) * uLevels) / max(uLevels - 1.0, 1.0);
      color = mix(ink, paper, clamp(wash, 0.0, 1.0));
      // bleed the original chroma back into the duotone wash
      color += (c - vec3(luma(c))) * uInkSaturation;
      color = mix(color, ink, edge);
    } else if (uMode == 1) {
      vec3 banded = (floor(c * uLevels) + 0.5) / uLevels;
      float gray = luma(banded);
      color = mix(vec3(gray), banded, 1.25);
      color = mix(color, vec3(0.04), edge * 0.85);
    } else if (uMode == 2) {
      color = mix(c, vec3(0.03), edge);
    } else {
      float gray = smoothstep(0.03, 0.97, luma(c));
      color = vec3(gray);
    }

    color = mix(c, color, uStrength);

    vec2 vignetteUv = (uv - 0.5) * vec2(0.86, 1.0);
    float vignette = smoothstep(0.38, 0.72, length(vignetteUv));
    color *= 1.0 - vignette * uVignette;

    outputColor = vec4(max(color, 0.0), inputColor.a);
  }
`

class StyleEffectImpl extends Effect {
  constructor({
    mode = 0,
    edge = 3,
    levels = 12,
    strength = 0.51,
    inkSaturation = 0.96,
    vignette = 0.5,
  } = {}) {
    super('StyleEffect', styleFragmentShader, {
      blendFunction: BlendFunction.NORMAL,
      attributes: EffectAttribute.CONVOLUTION,
      uniforms: new Map([
        ['uMode', new Uniform(mode)],
        ['uEdge', new Uniform(edge)],
        ['uLevels', new Uniform(levels)],
        ['uStrength', new Uniform(strength)],
        ['uInkSaturation', new Uniform(inkSaturation)],
        ['uVignette', new Uniform(vignette)],
      ]),
    })
  }
}

const WrappedStyleEffect = wrapEffect(StyleEffectImpl, {
  blendFunction: BlendFunction.NORMAL,
})

export function StylePass() {
  const { style, edge, levels, inkStrength, inkSaturation, inkVignette } = useControls('style', {
    style: { value: 'ink', options: ['ink', 'none', 'anime', 'outline', 'b&w'] },
    edge: { value: 3, min: 0, max: 10, step: 0.1, label: 'lines' },
    levels: { value: 12, min: 2, max: 12, step: 1, label: 'bands' },
    inkStrength: {
      value: 0.22, min: 0, max: 1, step: 0.01, label: 'strength',
      render: (get) => get('style.style') !== 'none',
    },
    inkSaturation: {
      value: 3.0, min: 0, max: 15.5, step: 0.01, label: 'ink saturation',
      render: (get) => get('style.style') === 'ink',
    },
    inkVignette: {
      value: 0.5, min: 0, max: 0.5, step: 0.005, label: 'vignette',
      render: (get) => get('style.style') !== 'none',
    },
  }, { collapsed: false, order: 8 })

  if (style === 'none') return null

  return (
    // multisampling 0: the composer's input scene is just the blend quad —
    // scene AA already happened in the samples:4 FBOs
    <EffectComposer multisampling={0}>
      <WrappedStyleEffect
        mode={MODES[style]}
        edge={edge}
        levels={levels}
        strength={inkStrength}
        inkSaturation={inkSaturation}
        vignette={inkVignette}
      />
    </EffectComposer>
  )
}
