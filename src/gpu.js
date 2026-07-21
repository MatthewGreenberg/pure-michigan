// Detects weak GPUs at module load via WEBGL_debug_renderer_info on a
// throwaway context. `lowGPU` gates the expensive knobs: FBO MSAA, dpr cap,
// blade count. ?gpu=low / ?gpu=high force it for testing.
// ponytail: string blocklist, add a benchmark pass if the heuristic misfires
function detect() {
  const forced = new URLSearchParams(window.location.search).get('gpu')
  if (forced) return forced === 'low'
  try {
    const gl = document.createElement('canvas').getContext('webgl2')
    if (!gl) return true
    const ext = gl.getExtension('WEBGL_debug_renderer_info')
    const renderer = ext
      ? gl.getParameter(ext.UNMASKED_RENDERER_WEBGL)
      : gl.getParameter(gl.RENDERER)
    return /swiftshader|llvmpipe|software|mesa|intel(?!.*(arc|iris xe max))|mali|adreno|powervr|videocore/i.test(renderer)
  } catch {
    return true
  }
}

export const lowGPU = detect()
