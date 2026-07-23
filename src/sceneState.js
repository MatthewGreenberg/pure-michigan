// Scene routing state shared by App's compositor, MichiganHub's dive, and the
// per-scene frame loops. A portal scene renders only while it's the transition
// target or the (still-animating) source — sceneRendering lets each scene's
// useFrame early-out the rest of the time.
export const START_SCENE = typeof window === 'undefined'
  ? 'map'
  : ['#city', '#meadow', '#annarbor'].includes(window.location.hash)
    ? window.location.hash.slice(1)
    : 'map'

export const hubTransition = { from: START_SCENE, to: START_SCENE, p: 1 }

// Shared mute flag for ambient beds + one-shot SFX (Ocean / City).
export const audioMuted = { on: false }

export function sceneRendering(name) {
  return hubTransition.to === name || (hubTransition.p < 1 && hubTransition.from === name)
}
