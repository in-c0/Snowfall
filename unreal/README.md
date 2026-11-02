# snowfall (Unreal Engine 5.8)

A short first-person story about grief (~15 min). Lumen (hardware RT) · Nanite · Virtual Shadow Maps · TSR · volumetric fog.

## Play
Open `Snowfall.uproject` (UE 5.8) → Play, or run a packaged build from `Build/Windows/`.
WASD move · mouse look · Shift faster · E / click use · 1–3 choices · Esc pause.

## How the project is built
Everything in `Content/` except `Data/` and `Fonts/` is generated:

| step | what | where |
|---|---|---|
| fetch | Poly Haven 2K scans + 4K HDRIs, Mixamo-rigged characters, fonts | `Content/Python/sf_fetch.py` |
| materials | master materials built node-by-node (PBR + snow, foliage, snow ground, GPU snowfall, light figure, wine stain, post warp, sky) | `sf_materials.py` |
| import | calibration, scene meshes, scans (flattened), textures, audio | `sf_import.py`, `sf_gltf.py` |
| levels | 7 maps from `SourceArt/Scenes/<level>/scene.json` (instances, lights, sky, fog, post, markers) | `sf_levels.py` |

Look tuning that was fitted against the reference renders lives in `Content/Data/look_calib.json`.

## Automated verification
`Tools\verify.ps1 -Stages build,content,shots,play,package` builds the C++ module, regenerates content, renders every
`Shot` camera off-screen (`Saved/AutoShots/<tag>/`, with frame timings), plays the whole story hands-free with the
autopilot (`-autoplay`, log in `Saved/AutoShots/<tag>/autoplay.log`) and packages a Shipping build.
`RUN_SNOWFALL_RUNNER.bat` starts a small job runner that executes queued verify jobs (`Saved/Verify/queue/*.json`).

Content warning: grief, trauma and suicide. If you are struggling: findahelpline.com · Lifeline (AU) 13 11 14 · 109 (KR).
