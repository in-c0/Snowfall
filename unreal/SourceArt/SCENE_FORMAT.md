# Scene export format (three.js → Unreal)

One folder per level: `SourceArt/Scenes/<level>/` where level ∈ L_Blizzard, L_Bench, L_Library, L_Park, L_Field, L_Road, L_Red.

All numbers are in **three.js space**: metres, Y-up, right-handed, exactly as the scene graph holds them. The Unreal importer converts (UE = (−z, x, y) × 100 cm). Do not convert anything in the exporter.

## Files
```
scene.json            the level description (below)
meshes/<id>.glb       one glTF binary per unique geometry (positions, normals, uv, optional uv1/color). No materials needed, no scene transform (identity).
inst/<id>.bin         float32 little-endian. Per instance: 16 floats (column-major world matrix, three.js Matrix4.elements) followed by `customFloats` floats.
tex/<name>.png        textures that only exist as canvas/generated textures (atlases, daisy, twigs, spines, rug, meadow…). sRGB PNG, alpha kept.
calib.glb             (only in L_Blizzard) calibration box: one axis-aligned box mesh with min (1,3,6) max (2,5,9) in its local space.
```

## scene.json
```jsonc
{
  "level": "L_Blizzard",
  "source": "blizzard.js mode=intro",           // free text
  "env": {
    "hdri": "snowy_field",                         // Poly Haven HDRI name or null
    "envIntensity": 0.55,
    "background": [0.76, 0.78, 0.8],               // linear RGB
    "sky": { "kind": "dome" | "color" | "hdri", "top": [..], "horizon": [..] },   // optional
    "fog": { "type": "exp2", "color": [r,g,b], "density": 0.042 }
  },
  "look": { /* the E.post look object at a representative moment: exposure, bloom, halation, focus, focusRange, dof, lift[3], gamma[3], gain[3], sat, contrast, tint[3], vignette, ca, grain, rays, raysTint */ },
  "lights": [
    { "type": "directional", "color": [r,g,b], "intensity": 3.2, "position": [x,y,z], "target": [x,y,z], "castShadow": true },
    { "type": "point", "color": [...], "intensity": 2.2, "position": [...], "distance": 9, "decay": 2, "castShadow": false },
    { "type": "spot", ..., "angle": 0.55, "penumbra": 0.6 },
    { "type": "hemisphere", "sky": [...], "ground": [...], "intensity": 0.7 }
  ],
  "materials": {
    "<matId>": {
      "kind": "pbr" | "basic" | "leafcards" | "daisy" | "grass" | "snowground" | "glass" | "emissive",
      "name": "human readable (three material name or what it is)",
      "polyhaven": "bark_brown_02",                // kind=pbr: texture set name
      "tiling": [u, v],                            // texture repeat actually used (account for setRepeat)
      "color": [r,g,b],                            // linear RGB multiplier / base colour
      "roughness": 0.8, "metalness": 0.0,
      "emissive": [r,g,b], "emissiveIntensity": 1,
      "map": "tex/meadow.png",                     // generated texture, optional
      "grid": 4,                                   // kind=leafcards: atlas grid size
      "alphaTest": 0.45, "doubleSided": true, "transparent": false, "opacity": 1,
      "translucency": 0.5,                         // leafcards: back-lit strength
      "wind": 1.0,                                 // 0 = static, 1 = sways (leaves, grass, daisies)
      "snow": 0.85, "snowDir": [-0.85, 0, -0.35]   // snow accumulation (snowCover patch) if present
    }
  },
  "meshes": [
    {
      "id": "m12", "file": "meshes/m12.glb", "material": "mat5", "name": "forest bark v2",
      "castShadow": true, "receiveShadow": true,
      "matrix": [16],                              // single placement (world)
      "instances": "inst/m12.bin", "count": 1234, "customFloats": 4   // OR instanced (then no "matrix")
      // customFloats for leafcards = [tile, r, g, b] (instanceColor or 1,1,1); for others 0
    }
  ],
  "models": [                                      // Poly Haven scans (re-imported at 2K in Unreal)
    { "name": "wheelchair_01", "matrix": [16], "snow": 0.85, "tint": [1,1,1], "castShadow": true, "tag": "Chair" }
  ],
  "markers": [                                     // gameplay anchors → Unreal TargetPoint / PlayerStart / CameraActor
    { "tag": "PlayerStart", "spawn": "default", "position": [x,y,z], "yaw": 0.0 },   // yaw = three player.yaw (radians, 0 = looking down −Z)
    { "tag": "I_book", "position": [x,y,z] },
    { "tag": "Shot", "name": "shot_opening", "position": [x,y,z], "lookAt": [x,y,z], "fov": 62 }
  ]
}
```

### Rules
- Every visible Mesh / InstancedMesh / Points the player would see becomes a `meshes` entry, except: snowfall particles (`Snow`), fog cards (`FogCards`), the sky dome, her light figure, silhouettes/characters (Xbot/Michelle), the stain decal, the flash cards, glow sprites/points (export glow positions as markers `{tag:"Glow", position, color, size}` instead). Unreal recreates those natively.
- Scanned Poly Haven models placed with `model(name)` go to `models` (not meshes) — they are re-imported at higher resolution.
- Merge identical geometry+material pairs into one instanced entry when the scene placed many copies as separate meshes (e.g. the shelf spine panels already merged; pumpkins, mushrooms, big leaves…). Keep entries under ~300 per level.
- Bake world transforms (`matrixWorld`) including parents. For `InstancedMesh`, instance world = mesh.matrixWorld × instanceMatrix.
- Geometry may be large (terrain, merged shelves). That's fine; keep vertex normals; keep `uv`; if a geometry has `color` attribute keep it.
- Shader-patched materials (onBeforeCompile wind/snow/leaf atlas) must be classified via the custom `kind` and their parameters written out (atlas grid, per-instance tile & colour → customFloats, snow amount/dir, wind).
- Markers: every scripted position the level's story uses (interactables, spawn points, cameras, paths, named props) — see the per-level marker list in the brief.
