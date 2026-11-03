# L_Blizzard — first photoreal pass (issue #1)

The first 60 seconds of Snowfall, rebuilt as a walkable scanned environment instead of the WebGL export's
procedural trees. Everything here was produced by the automated pipeline on the RTX 2080 / i9-9900K / 32 GB machine in
UE 5.8 (uncooked `-game`). **Before** = the original level regenerated from the export (`contentStages=levels,noart`,
tag `bf2`). **After** = the same level with the art layer and the fixes below (tag `fin3`).

![before/after](before_after_overview.jpg)

| | |
|---|---|
| Matched views (8) | `pair_*.jpg` — start, trees, edge_trunk, side_forest, back, ground, wheelchair, near_wheelchair |
| 60 s walk, before \| after | [`walk_before_after.mp4`](walk_before_after.mp4) — the real pawn on a scripted path: walk, look into the forest, approach the wheelchair, look down, turn 180°, walk on, look up into the canopy |
| 60 s walk, after (720p) | [`walk_after_720p.mp4`](walk_after_720p.mp4) |
| Asset provenance | [`provenance_assets.json`](provenance_assets.json) (every file URL, all CC0) · [`art_layer_build_record.json`](art_layer_build_record.json) (what the build placed) |

## What changed (implemented)

* **Art layer** `unreal/Content/Data/Art/L_Blizzard.json` (versioned, v2), applied by `sf_art.py` inside the normal
  content build, so `sf_build_all` regenerates the same improved level every time.
* **Trees:** the export's procedural trunks/twigs (meshes m0–m4, m6–m10) are suppressed and replaced by Poly Haven's
  photoscanned Scots pine (3 trees, 4.2–7.0 M triangles each, geometric needles, split into ~1 M-triangle Nanite pieces)
  plus scanned dead trunks, stumps, moss rocks and dry branches; dense forest on the left, sparse on the right, the road
  and memorial spots kept clear, invisible trunk colliders.
  *Creative decision taken without you:* the bare deciduous silhouettes became snowy pines — the only photoreal CC0
  trees available. Reversible by editing the JSON.
* **Ground:** world-aligned 4K snow scan with its repeating dark footprint marks painted out
  (`Tools/art/prepare_assets.py`, `snow_02_clean`), macro variation, Nanite tessellation.
* **Light:** overcast forest HDRI (`snowy_forest`), softer sun (source angle 12°). Snow settles on logs, rocks, stumps;
  less snow on the wheelchair (0.85 → 0.3) so its metal and fabric read.
* **The Shadow walks again.** The story's dark figure was never visible in UE: the Mixamo characters imported at 1/100
  scale (x126 at runtime) and it flashed as a screen-sized black ellipse every few seconds instead. Found with walk-capture
  A/B runs (hide classes, motion blur off, forced LOD, per-frame figure distance — tags dk0–dk12); fixed by baking the
  armature scale and merging Xbot's body + joint meshes (`Tools/art/fix_mixamo_glb.py`, skinning verified identical with
  `check_skin.py`). This also fixes "her"/"him" in the other levels, which load the same characters.
* **Other bugs found by the moving-view evidence and fixed:** the 2 km sky sphere collided, so the player spawned on top
  of the sky (Z = +2000 m) in every playthrough; the first piece of every pine had no Nanite data and was drawn ~350× on
  the classic path; pine slots shipped without textures rendered as the engine default; snowflakes brushing the lens;
  the drifting mist cards I added read as grey discs, so they are off by default (`-mist`).
* **Tooling:** `-walkcapture` (scripted walk of the real pawn, every frame saved, mp4), `-walkperf` (same walk, real
  time), `-walkprofile` (ProfileGPU), `-walkcvars`, `-walkhide…` A/B switches; shot retry/resume after a crash; a
  watchdog for hung crash handlers; art imports split across editor processes.

## Demonstrated (looked at in the actual UE output)

* Matched stills: depth layers of pines fading into the blizzard, bark/needles up close, snow-settled logs and rocks,
  fresh powder instead of a flat grey ground, the Shadow figure on the road ahead (`pair_*.jpg`).
* 60 s walk: the Shadow walks ahead and waits as in the WebGL story; no tree, rock or collider blocks the path
  (61.0 m travelled before and after; the same 31 low-speed start-up frames in both); no popping or flicker found in the
  turn or the canopy look after the fixes above.
* Regeneration: the level was rebuilt from the JSON 9 times (tags af…af5, nn1, ch1, ch2, fin3) with identical placement
  (435 instances: 312 + 35 pines, 11 + 4 deadwood, 25 rocks, 45 branch clusters; 348 trunk colliders). A rebuild with the
  imported assets deleted was not done.

## Frame time (same 60 s walk, 1920×1080, uncooked `-game`, no screenshots)

| | avg | p95 | worst |
|---|---|---|---|
| before (`bf2`) | 11.7 ms | 13.3 ms | 1.1 s (first-frame hitch) |
| after, first build (`af3`) | 40.5 ms | 126 ms | 3.9 s |
| after, final (`fin3`) | 14.8 ms | 16.9 ms | 2.0 s (first-frame hitch) |

## Not done / not tested — explicitly

* No cooked/packaged build (`package` stage not run); the full hands-free story (`play` stage) was not run for this
  change; audio not checked; only `L_Blizzard` was regenerated (the other six levels still have the sky-collision bug
  until rebuilt).
* The Shadow is Mixamo's X Bot mannequin in a dark material: right as a silhouette in the storm, but it reads as a
  mannequin when it is close. The wheelchair (Poly Haven) still looks matte grey up close.
* Screenshot runs crash intermittently with Windows out-of-memory / `DEVICE_REMOVED` while the PC is in use (the verify
  script retries and resumes); the local Zen cache reports "Insufficient Storage".
* No custom 3D modelling was needed (all scanned CC0 assets), so Text-to-CAD was not used.
