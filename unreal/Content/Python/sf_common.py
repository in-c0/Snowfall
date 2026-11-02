"""Shared helpers for the Snowfall content build (runs inside the Unreal Editor's Python)."""
import json, os, time, traceback
import unreal

PROJECT = unreal.Paths.convert_relative_path_to_full(unreal.Paths.project_dir())
SOURCE = os.path.join(PROJECT, 'SourceArt')
DOWNLOADS = os.path.join(SOURCE, 'Downloads')
SCENES = os.path.join(SOURCE, 'Scenes')
REPORT_DIR = os.path.join(PROJECT, 'Saved', 'ContentBuild')
os.makedirs(REPORT_DIR, exist_ok=True)

asset_tools = unreal.AssetToolsHelpers.get_asset_tools()
eal = unreal.EditorAssetLibrary
mel = unreal.MaterialEditingLibrary

_report = {'started': time.strftime('%Y-%m-%d %H:%M:%S'), 'steps': [], 'errors': [], 'warnings': []}

def log(msg):
    unreal.log('[SF] ' + str(msg))

def warn(msg):
    unreal.log_warning('[SF] ' + str(msg)); _report['warnings'].append(str(msg))

def error(msg):
    unreal.log_error('[SF] ' + str(msg)); _report['errors'].append(str(msg))

def step(name, **info):
    _report['steps'].append({'step': name, 'time': time.strftime('%H:%M:%S'), **info}); log(f'== {name} {info}')

def save_report():
    with open(os.path.join(REPORT_DIR, 'report.json'), 'w', encoding='utf-8') as f:
        json.dump(_report, f, indent=1)

def guarded(fn):
    def wrap(*a, **k):
        try:
            return fn(*a, **k)
        except Exception as e:
            error(f'{fn.__name__}: {e}\n{traceback.format_exc()}')
            return None
    return wrap

def ensure_dir(path):
    if not eal.does_directory_exist(path):
        eal.make_directory(path)

def load(path):
    return eal.load_asset(path) if eal.does_asset_exist(path) else None

def import_file(filename, dest, name=None, replace=True, options=None):
    """Imports one file; returns the list of created asset object paths."""
    task = unreal.AssetImportTask()
    task.set_editor_property('filename', filename)
    task.set_editor_property('destination_path', dest)
    if name:
        task.set_editor_property('destination_name', name)
    task.set_editor_property('automated', True)
    task.set_editor_property('save', True)
    task.set_editor_property('replace_existing', replace)
    if options is not None:
        task.set_editor_property('options', options)
    asset_tools.import_asset_tasks([task])
    return list(task.get_editor_property('imported_object_paths') or [])

def lin(c, a=1.0):
    return unreal.LinearColor(float(c[0]), float(c[1]), float(c[2]), a)

# three.js world (m, Y-up, RH) -> Unreal (cm, Z-up, LH)
def c3(v):
    return unreal.Vector(-v[2] * 100.0, v[0] * 100.0, v[1] * 100.0)

def yaw_three_to_ue(yaw):
    """three player.yaw (0 looks down -Z, positive turns left) -> Unreal yaw in degrees."""
    import math
    fx, fz = -math.sin(yaw), -math.cos(yaw)       # three forward
    ue = (-fz, fx)                                 # (X, Y)
    return math.degrees(math.atan2(ue[1], ue[0]))

def look_rotation(src, dst):
    """Rotator looking from src to dst (both three coords)."""
    import math
    a, b = c3(src), c3(dst)
    d = unreal.Vector(b.x - a.x, b.y - a.y, b.z - a.z)
    yaw = math.degrees(math.atan2(d.y, d.x))
    pitch = math.degrees(math.atan2(d.z, math.hypot(d.x, d.y)))
    return unreal.Rotator(roll=0.0, pitch=pitch, yaw=yaw)
