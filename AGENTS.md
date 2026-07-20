# grass

Vite + React 19 + React Three Fiber demo: 72k instanced grass blades on a 3x3 tile grid.

## Structure

- `src/App.jsx` — Canvas, scene composition, ground plane.
- `src/Camera.jsx` — fixed orthographic camera at [14,9,14] looking at (0,0.6,0), `VIEW = 6.25`; `zoom = height / (2 * VIEW)` reproduces a fixed half-height view and stays correct on resize.
- `src/grass/constants.js` — GRID/TILE/blade counts/param-texture layout constants.
- `src/grass/shaders.js` — GLSL: wind bend + hash-cell clump pull (uClump, cell size from uClumpScale, mound-shaped height taper toward each clump center) + param fetch in vertex, fbm color fields + gust sheen (vGust varying) + AO in fragment. Interpolates constants into the source.
- `src/grass/geometry.js` — `buildGeometry()`: one normalized segmented strip as `InstancedBufferGeometry` with per-blade attributes (offset, scale, rotation, wind phase, tile id). The vertex shader shapes it with live blade-profile uniforms. Blades are laid out blade-major (tiles innermost) so the "blades" slider can truncate `instanceCount` and thin all tiles evenly.
- `src/grass/tileParams.js` — the per-tile `DataTexture` (4 RGBA float texels per tile: colors A/B/C + scales/mixes) and `randomizeTiles()` which rewrites it with hue/sat/lightness-jittered colors. Jitter is seeded (mulberry32) so slider changes re-tint without reshuffling the layout; only `reseed()` (the "randomize" button) rolls a new arrangement.
- `src/grass/material.js` — the `uniforms` object + ShaderMaterial, built manually as module singletons — R3F's `uniforms` prop clones each uniform into the material, so mutating a shared uniforms object via JSX `<shaderMaterial>` never reaches the GPU. Exported so App.jsx's "ground / blade base" control can drive `uBaseColor` too (ground plane and blade roots share one color).
- `src/grass/Grass.jsx` — the mesh + leva controls (`useControls`); color/scale changes and the "randomize" button call `randomizeTiles`. A "wind" folder (strength/speed/gust scale) writes transiently to the `uWindStrength`/`uWindSpeed`/`uGustScale` uniforms via `onChange` — no re-render.

## Conventions

- Geometry, param texture, and uniforms are module-level singletons — the React Compiler lint forbids render-scope mutation, and there's only one `<Grass>`. Move them into the component if it ever mounts twice.
- `npm run lint` uses the React Compiler eslint rules — strict about purity/mutation during render.
