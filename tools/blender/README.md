# Detroit diorama bake pipeline

Rebuilds `public/detroit.glb` — the baked downtown-Detroit diorama that
`src/city/City.jsx` loads. Everything static (slab, streets, buildings,
landmarks, bridge, trees, streetlights, and the wordless riverfront civic
plaza) is modeled procedurally in Blender and lit-baked into two texture
atlases (ground 4096², buildings 8192²); the app renders it unlit. Animated
pieces (river, People Mover, traffic, boats, railing) stay procedural in
City.jsx.

## Run

1. Launch Blender with the [blender-mcp](https://github.com/ahujasid/blender-mcp)
   addon socket server (GUI required — bakes/ops need a window):

       /Applications/Blender.app/Contents/MacOS/Blender --python tools/blender/start_mcp.py

2. Run the pipeline over the addon socket (port 9876):

       cd tools/blender
       python3 bmcp.py exec build.py     # scene: geometry + materials + sun/world (three.js coords via P())
       python3 bmcp.py exec bake.py      # material scale retune, join into 2 atlas objects, smart-UV, Cycles GPU bake
       python3 bmcp.py exec export.py    # swap to baked mats, export public/detroit.glb

   The bake step runs several minutes; call it with a long socket timeout
   (`bmcp.send(..., timeout=3600)`) rather than bmcp.py's 180s default.

   Intermediates (atlases, .blend, preview render) land in /tmp/detroit-bake.

Notes:
- Geometry is authored in three.js coordinates and converted per-vertex with
  `P(x,y,z) -> (x,-z,y)`; the glTF exporter converts back to Y-up, so the GLB
  lands exactly in City.jsx's authored space (ground y=0, river at -z).
- Thin geometry (railing) bakes badly (atlas islands smear) — keep it live in
  City.jsx instead of adding it here.
- `bmcp.py` speaks the blender-mcp addon's JSON-over-TCP protocol directly, so
  the pipeline also works without an MCP client session.
