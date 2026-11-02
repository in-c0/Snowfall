# snowfall

A short first-person story about grief (~15 min, EN/KO). Built from the Notion design doc *snowfall game idea*.

Content warning: grief, trauma and suicide. If you are struggling: [findahelpline.com](https://findahelpline.com) · Lifeline (AU) 13 11 14 · 109 (KR).

| folder | what |
|---|---|
| `unreal/` | **Unreal Engine 5.8 game** — C++ gameplay + story directors, editor-Python content pipeline, scene data, audio, automated verification (`Tools/verify.ps1`). See [`unreal/README.md`](unreal/README.md). |
| `web/` | The three.js prototype the UE levels were exported from (play: serve the folder and open `index.html`). |
| `tools/` | Pipeline scripts: scene dumper (three.js → `unreal/SourceArt/Scenes`), offline audio renderer (WebAudio score → WAV), screenshot/compare/exposure-calibration tools. |
| `docs/shots/` | Latest automated UE renders (`ue_*.jpg`) and web-vs-UE comparison sheets. |

## Status
- C++ builds against UE 5.8; all 7 levels generate and render (Lumen HWRT, Nanite, VSM, volumetric fog, GPU snowfall).
- Per-level exposure/fog fitted against the web renders (`unreal/Content/Data/look_calib.json`).
- Autopilot playthrough (`-autoplay`) and Shipping packaging stages are written but not yet verified.
- Next for realism: replace the procedural trees/shelves with photogrammetry (Fab/Megascans) and splat interiors.

## Fresh checkout → playable
1. Open `unreal/Snowfall.uproject` once (builds the module), or run `unreal\Tools\verify.ps1 -Stages build`.
2. `unreal\Tools\verify.ps1 -Stages content,shots` downloads the Poly Haven scans/HDRIs, builds materials, imports and generates the maps (audio ships as FLAC in `SourceArt/Audio`).
