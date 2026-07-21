// Shadow maps render on demand: every caster is static outside scene
// transitions (map dive), marker hover, and rock re-scatter, so those sites
// re-arm the flag instead of re-rendering shadows every frame. Plain functions
// (not inline mutations) keep the React Compiler immutability lint happy.
export function initOnDemandShadows(gl) {
  gl.shadowMap.autoUpdate = false
  gl.shadowMap.needsUpdate = true
}

export function armShadows(gl) {
  gl.shadowMap.needsUpdate = true
}
