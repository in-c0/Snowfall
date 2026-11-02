"""Entry point: UnrealEditor.exe Snowfall.uproject -ExecutePythonScript="<abs>/sf_build_all.py" -unattended
Env SF_LEVELS=L_Park,L_Field limits the levels; SF_STAGES=fetch,materials,import,levels limits the stages; SF_NOQUIT=1 keeps the editor open."""
import glob, os, sys, time, traceback
import unreal
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import importlib
import sf_common, sf_fetch, sf_materials, sf_import, sf_levels
for m in (sf_common, sf_fetch, sf_materials, sf_import, sf_levels):
    importlib.reload(m)
from sf_common import SCENES, step, error, save_report, log

ALL = ['L_Blizzard', 'L_Bench', 'L_Library', 'L_Park', 'L_Field', 'L_Road', 'L_Red']

def main():
    t0 = time.time()
    present = [l for l in ALL if os.path.exists(os.path.join(SCENES, l, 'scene.json'))]
    want = [l.strip() for l in os.environ.get('SF_LEVELS', '').split(',') if l.strip()] or present
    stages = [s.strip() for s in os.environ.get('SF_STAGES', 'fetch,materials,import,levels').split(',')]
    step('build start', levels=want, stages=stages)
    try:
        if 'clean' in stages:
            for d in ('/Game/Models', '/Game/Scenes', '/Game/Maps', '/Game/Characters', '/Game/Textures'):
                if unreal.EditorAssetLibrary.does_directory_exist(d):
                    unreal.EditorAssetLibrary.delete_directory(d)
            step('clean')
        if 'fetch' in stages:
            sf_fetch.run()
        if 'materials' in stages:
            sf_materials.build_all()
        scenes = {}
        if 'import' in stages or 'levels' in stages:
            scenes = sf_import.run(want)
        if 'levels' in stages:
            calib = sf_import.calibration()
            for lv in want:
                if lv in scenes:
                    sf_levels.build_level(lv, scenes[lv], calib)
        unreal.EditorAssetLibrary.save_directory('/Game', only_if_is_dirty=True, recursive=True)
    except Exception as e:
        error(f'build crashed: {e}\n{traceback.format_exc()}')
    step('build end', seconds=round(time.time() - t0))
    save_report()
    log('SF_BUILD_DONE')

main()
if not os.environ.get('SF_NOQUIT'):
    unreal.SystemLibrary.quit_editor()
