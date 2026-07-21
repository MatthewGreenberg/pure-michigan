export const GRASS_DEFAULTS = Object.freeze({
  colorA: "#315c3b",
  colorB: "#beb63c",
  colorC: "#d016ff",
  gradScale: 0.5,
  overlayScale: 0.5,
  windStrength: 0.67,
  windSpeed: 0.72,
  gustScale: 0.24,
  sheen: 2,
  clump: 0,
  clumpScale: 1.6,
  blades: 31_200,
  bladeHeight: 0.56,
  bladeWidth: 0.04,
  bladeTipWidth: 0,
  bladeTaper: 1.15,
  bladeCurve: 0.018,
  bladeLean: 0.085,
  ground: "#549348",
  groundB: "#91a844",
  groundNoiseSize: 0.5,
  gradStrength: 0,
  bladeTip: "#ad5151",
  rootShade: 0,
});

export const PATH_DEFAULTS = Object.freeze({
  // mask params (CPU re-bake on change)
  width: 0.6,
  soil: 1, // 0..1 → how much of the patch noise becomes exposed soil
  clearing: 1, // fraction of blades killed along the trail
  core: 0.25, // strength of the continuous bare-dirt center stripe
  // shader params (live uniforms)
  press: 0.05, // height of surviving blades on the path
  soilColor: "#b7955e",
  darken: 0.95, // pressed-turf darkening on the trail shoulders
  bump: 0,
  bumpScale: 1,
});
