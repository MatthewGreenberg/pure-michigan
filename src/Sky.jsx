import { ScreenQuad } from '@react-three/drei'
import { skyMaterial } from './skyMaterial.js'

// A rendered background instead of a CSS background. Keeping the sky inside
// WebGL means the full-screen style pass can grade the entire frame as one
// image rather than treating the transparent canvas and page as two layers.
export function Sky() {
  return <ScreenQuad material={skyMaterial} renderOrder={-10000} />
}
