"""Master materials for Snowfall, built node-by-node with MaterialEditingLibrary (no hand-made .uasset needed)."""
import unreal
from sf_common import asset_tools, eal, mel, log, warn, error, step, ensure_dir, load, guarded

MAT_DIR = '/Game/Materials'
X = 0  # node layout helper

def _new(name, folder=MAT_DIR, domain=None, blend=None, shading=None, two_sided=False, clip=0.45, extra=None):
    ensure_dir(folder)
    path = f'{folder}/{name}'
    mat = load(path)
    if mat is None:
        mat = asset_tools.create_asset(name, folder, unreal.Material, unreal.MaterialFactoryNew())
    else:
        mel.delete_all_material_expressions(mat)
    if domain is not None:
        mat.set_editor_property('material_domain', domain)
    if blend is not None:
        mat.set_editor_property('blend_mode', blend)
    if shading is not None:
        mat.set_editor_property('shading_model', shading)
    mat.set_editor_property('two_sided', two_sided)
    mat.set_editor_property('opacity_mask_clip_value', clip)
    for k, v in (extra or {}).items():
        try:
            mat.set_editor_property(k, v)
        except Exception as e:
            warn(f'{name}.{k}: {e}')
    return mat

def _e(mat, cls, x=-400, y=0):
    return mel.create_material_expression(mat, cls, x, y)

def _scalar(mat, name, val, x=-800, y=0):
    e = _e(mat, unreal.MaterialExpressionScalarParameter, x, y)
    e.set_editor_property('parameter_name', name); e.set_editor_property('default_value', float(val)); return e

def _vec(mat, name, val, x=-800, y=0):
    e = _e(mat, unreal.MaterialExpressionVectorParameter, x, y)
    e.set_editor_property('parameter_name', name); e.set_editor_property('default_value', unreal.LinearColor(*val)); return e

def _tex(mat, name, default_path, sampler, x=-800, y=0):
    e = _e(mat, unreal.MaterialExpressionTextureSampleParameter2D, x, y)
    e.set_editor_property('parameter_name', name)
    t = eal.load_asset(default_path)
    if t:
        e.set_editor_property('texture', t)
    e.set_editor_property('sampler_type', sampler)
    return e

def _custom(mat, code, inputs, out_type=unreal.CustomMaterialOutputType.CMOT_FLOAT3, x=-500, y=0, desc='Custom'):
    e = _e(mat, unreal.MaterialExpressionCustom, x, y)
    e.set_editor_property('code', code)
    e.set_editor_property('output_type', out_type)
    e.set_editor_property('description', desc)
    ins = []
    for n in inputs:
        ci = unreal.CustomInput()
        ci.set_editor_property('input_name', n)
        ins.append(ci)
    e.set_editor_property('inputs', ins)
    return e

def _con(a, a_out, b, b_in):
    if not mel.connect_material_expressions(a, a_out, b, b_in):
        warn(f'connect failed {a.get_name()}.{a_out} -> {b.get_name()}.{b_in}')

def _prop(a, a_out, prop):
    if not mel.connect_material_property(a, a_out, prop):
        warn(f'property connect failed {a.get_name()}.{a_out} -> {prop}')

def _done(mat):
    mel.recompile_material(mat)
    try:
        errs = unreal.SFDevLibrary.get_material_errors(mat)
        if errs:
            error(f'{mat.get_name()} compile errors: ' + ' | '.join(errs))
    except Exception as e:
        warn(f'compile error query: {e}')
    eal.save_loaded_asset(mat)
    log(f'material {mat.get_path_name()}')
    return mat

MP = unreal.MaterialProperty
S_COLOR = unreal.MaterialSamplerType.SAMPLERTYPE_COLOR
S_LINEAR = unreal.MaterialSamplerType.SAMPLERTYPE_MASKS   # ARM maps are imported as TC_Masks (linear)
S_NORMAL = unreal.MaterialSamplerType.SAMPLERTYPE_NORMAL
WHITE = '/Engine/EngineResources/WhiteSquareTexture'
FLATN = '/Engine/EngineMaterials/DefaultNormal'
DEF_ARM = '/Game/Textures/Defaults/T_DefaultARM'

SNOW_HLSL = '''
float nz = Nz;
float m = saturate((N.z + (nz - 0.4) * 0.6 - 0.35) / 0.4);
float w = saturate((dot(N, Dir.xyz) + (nz - 0.45) * 0.8 - 0.25) / 0.45) * length(Dir.xyz);
return max(m, w) * Amt;
'''

def _uv_tiled(mat, x=-1300, y=0):
    tc = _e(mat, unreal.MaterialExpressionTextureCoordinate, x, y)
    tu = _scalar(mat, 'TileU', 1.0, x, y + 80); tv = _scalar(mat, 'TileV', 1.0, x, y + 160)
    # three.js UVs have a bottom-left origin; negating V reproduces three's sampling under wrap addressing
    neg = _e(mat, unreal.MaterialExpressionMultiply, x + 120, y + 160); neg.set_editor_property('const_b', -1.0); _con(tv, '', neg, 'A')
    ap = _e(mat, unreal.MaterialExpressionAppendVector, x + 200, y + 100); _con(tu, '', ap, 'A'); _con(neg, '', ap, 'B')
    mul = _e(mat, unreal.MaterialExpressionMultiply, x + 380, y); _con(tc, '', mul, 'A'); _con(ap, '', mul, 'B')
    return mul

def _pic_default(e, v=1.0):
    for prop in ('const_default_value', 'default_value'):
        try:
            e.set_editor_property(prop, v); return
        except Exception:
            pass
    warn('PerInstanceCustomData default not settable')

VNOISE_HLSL = '''
float3 p = WP * Scale;
float a = 0.0, amp = 0.5, tot = 0.0;
for (int o = 0; o < 5; o++) {
  if (o >= Levels) break;
  float3 i = floor(p); float3 f = frac(p); float3 u = f * f * (3.0 - 2.0 * f);
  float n000 = frac(sin(dot(i + float3(0,0,0), float3(127.1, 311.7, 74.7))) * 43758.5453);
  float n100 = frac(sin(dot(i + float3(1,0,0), float3(127.1, 311.7, 74.7))) * 43758.5453);
  float n010 = frac(sin(dot(i + float3(0,1,0), float3(127.1, 311.7, 74.7))) * 43758.5453);
  float n110 = frac(sin(dot(i + float3(1,1,0), float3(127.1, 311.7, 74.7))) * 43758.5453);
  float n001 = frac(sin(dot(i + float3(0,0,1), float3(127.1, 311.7, 74.7))) * 43758.5453);
  float n101 = frac(sin(dot(i + float3(1,0,1), float3(127.1, 311.7, 74.7))) * 43758.5453);
  float n011 = frac(sin(dot(i + float3(0,1,1), float3(127.1, 311.7, 74.7))) * 43758.5453);
  float n111 = frac(sin(dot(i + float3(1,1,1), float3(127.1, 311.7, 74.7))) * 43758.5453);
  float v = lerp(lerp(lerp(n000, n100, u.x), lerp(n010, n110, u.x), u.y), lerp(lerp(n001, n101, u.x), lerp(n011, n111, u.x), u.y), u.z);
  a += v * amp; tot += amp; amp *= 0.5; p = p * 2.03 + 17.1;
}
return a / max(tot, 1e-4);
'''

def _vnoise(mat, wp, scale, levels=3, x=-1000, y=0):
    """Fractal value noise of world position (0..1). scale in 1/cm."""
    sc = _e(mat, unreal.MaterialExpressionConstant, x - 200, y + 60); sc.set_editor_property('r', float(scale))
    lv = _e(mat, unreal.MaterialExpressionConstant, x - 200, y + 120); lv.set_editor_property('r', float(levels))
    c = _custom(mat, VNOISE_HLSL, ['WP', 'Scale', 'Levels'], unreal.CustomMaterialOutputType.CMOT_FLOAT1, x, y, 'ValueNoise')
    _con(wp, '', c, 'WP'); _con(sc, '', c, 'Scale'); _con(lv, '', c, 'Levels')
    return c

def _snow_mask(mat, x=-900, y=600):
    vn = _e(mat, unreal.MaterialExpressionVertexNormalWS, x - 300, y)
    wp = _e(mat, unreal.MaterialExpressionWorldPosition, x - 600, y + 120)
    noise = _vnoise(mat, wp, 0.06, 3, x - 300, y + 120)
    amt = _scalar(mat, 'SnowAmount', 0.0, x - 300, y + 260)
    d = _vec(mat, 'SnowDir', (0, 0, 0, 0), x - 300, y + 340)
    c = _custom(mat, SNOW_HLSL, ['N', 'Nz', 'Amt', 'Dir'], unreal.CustomMaterialOutputType.CMOT_FLOAT1, x, y, 'SnowMask')
    _con(vn, '', c, 'N'); _con(noise, '', c, 'Nz'); _con(amt, '', c, 'Amt'); _con(d, '', c, 'Dir')
    return c

def _inst_color(mat, x, y):
    """Per-instance colour from custom data 1..3 (default white)."""
    ch = []
    for i in (1, 2, 3):
        c = _e(mat, unreal.MaterialExpressionPerInstanceCustomData, x, y + (i - 1) * 80)
        c.set_editor_property('data_index', i); _pic_default(c); ch.append(c)
    a1 = _e(mat, unreal.MaterialExpressionAppendVector, x + 200, y + 40); _con(ch[0], '', a1, 'A'); _con(ch[1], '', a1, 'B')
    a2 = _e(mat, unreal.MaterialExpressionAppendVector, x + 350, y + 80); _con(a1, '', a2, 'A'); _con(ch[2], '', a2, 'B')
    return a2

@guarded
def build_pbr():
    """Scanned PBR surfaces (+ optional accumulated snow)."""
    mat = _new('M_SF_PBR')
    uv = _uv_tiled(mat)
    base = _tex(mat, 'BaseTex', WHITE, S_COLOR, -800, -300); _con(uv, '', base, 'UVs')
    nor = _tex(mat, 'NormalTex', FLATN, S_NORMAL, -800, 0); _con(uv, '', nor, 'UVs')
    arm = _tex(mat, 'ARMTex', DEF_ARM, S_LINEAR, -800, 300); _con(uv, '', arm, 'UVs')
    tint = _vec(mat, 'Tint', (1, 1, 1, 1), -800, -500)
    bc = _e(mat, unreal.MaterialExpressionMultiply, -500, -350); _con(base, 'RGB', bc, 'A'); _con(tint, '', bc, 'B')
    rm = _scalar(mat, 'RoughMul', 1.0, -800, 500); mm = _scalar(mat, 'MetalMul', 1.0, -800, 560)
    r = _e(mat, unreal.MaterialExpressionMultiply, -500, 300); _con(arm, 'G', r, 'A'); _con(rm, '', r, 'B')
    m = _e(mat, unreal.MaterialExpressionMultiply, -500, 400); _con(arm, 'B', m, 'A'); _con(mm, '', m, 'B')
    snow = _snow_mask(mat)
    snowc = _vec(mat, 'SnowColor', (0.86, 0.88, 0.92, 1), -500, 700)
    lb = _e(mat, unreal.MaterialExpressionLinearInterpolate, -250, -300); _con(bc, '', lb, 'A'); _con(snowc, '', lb, 'B'); _con(snow, '', lb, 'Alpha')
    sr = _scalar(mat, 'SnowRough', 0.85, -500, 800)
    lr = _e(mat, unreal.MaterialExpressionLinearInterpolate, -250, 300); _con(r, '', lr, 'A'); _con(sr, '', lr, 'B'); _con(snow, '', lr, 'Alpha')
    zero = _e(mat, unreal.MaterialExpressionConstant, -500, 500)
    lm = _e(mat, unreal.MaterialExpressionLinearInterpolate, -250, 420); _con(m, '', lm, 'A'); _con(zero, '', lm, 'B'); _con(snow, '', lm, 'Alpha')
    _prop(lb, '', MP.MP_BASE_COLOR); _prop(nor, 'RGB', MP.MP_NORMAL); _prop(lr, '', MP.MP_ROUGHNESS); _prop(lm, '', MP.MP_METALLIC); _prop(arm, 'R', MP.MP_AMBIENT_OCCLUSION)
    return _done(mat)

@guarded
def build_basic(name, two_sided, masked):
    """Flat colour (optionally textured) surfaces: shelves, books, bed linen, walls."""
    mat = _new(name, blend=unreal.BlendMode.BLEND_MASKED if masked else unreal.BlendMode.BLEND_OPAQUE, two_sided=two_sided)
    uv = _uv_tiled(mat)
    base = _tex(mat, 'BaseTex', WHITE, S_COLOR, -800, -300); _con(uv, '', base, 'UVs')
    col = _vec(mat, 'Color', (1, 1, 1, 1), -800, -500)
    bc0 = _e(mat, unreal.MaterialExpressionMultiply, -600, -350); _con(base, 'RGB', bc0, 'A'); _con(col, '', bc0, 'B')
    ic = _inst_color(mat, -1100, -700)
    bc1 = _e(mat, unreal.MaterialExpressionMultiply, -450, -400); _con(bc0, '', bc1, 'A'); _con(ic, '', bc1, 'B')
    vc = _e(mat, unreal.MaterialExpressionVertexColor, -800, -800)
    one = _e(mat, unreal.MaterialExpressionConstant3Vector, -800, -880); one.set_editor_property('constant', unreal.LinearColor(1, 1, 1, 1))
    uvc = _scalar(mat, 'UseVertexColor', 0.0, -800, -940)
    vl = _e(mat, unreal.MaterialExpressionLinearInterpolate, -600, -850); _con(one, '', vl, 'A'); _con(vc, '', vl, 'B'); _con(uvc, '', vl, 'Alpha')
    bc = _e(mat, unreal.MaterialExpressionMultiply, -350, -400); _con(bc1, '', bc, 'A'); _con(vl, '', bc, 'B')
    rough = _scalar(mat, 'Roughness', 0.8, -800, 200); metal = _scalar(mat, 'Metallic', 0.0, -800, 260)
    em = _vec(mat, 'Emissive', (0, 0, 0, 1), -800, 340)
    snow = _snow_mask(mat)
    snowc = _vec(mat, 'SnowColor', (0.86, 0.88, 0.92, 1), -500, 700)
    lb = _e(mat, unreal.MaterialExpressionLinearInterpolate, -250, -300); _con(bc, '', lb, 'A'); _con(snowc, '', lb, 'B'); _con(snow, '', lb, 'Alpha')
    _prop(lb, '', MP.MP_BASE_COLOR); _prop(rough, '', MP.MP_ROUGHNESS); _prop(metal, '', MP.MP_METALLIC); _prop(em, '', MP.MP_EMISSIVE_COLOR)
    if masked:
        _prop(base, 'A', MP.MP_OPACITY_MASK)
    return _done(mat)

LEAF_UV_HLSL = '''
float g = max(Grid, 1.0);
float cx = fmod(Tile, g);
float cy = floor(Tile / g);
// glb UVs are raw three.js UVs (origin bottom-left); UE samples top-left
return float2((UV.x + cx) / g, 1.0 - (UV.y + cy) / g);
'''
WIND_HLSL = '''
float t = Time;
float3 p = WP * 0.01;
float s = sin(t * 1.7 + p.x * 0.35 + p.y * 0.2) * 0.6 + sin(t * 3.1 + p.x * 1.3) * 0.25 + sin(t * 0.6 + p.y * 0.1) * 0.8;
float f = sin(t * 6.0 + p.x * 9.0 + p.y * 7.0);
return float3(s * 0.6, s, f * 0.3) * Amp * Wind;
'''

@guarded
def build_leaf():
    """Instanced leaf cards: atlas tile + colour per instance (PerInstanceCustomData), foliage translucency, wind."""
    mat = _new('M_SF_Leaf', blend=unreal.BlendMode.BLEND_MASKED, shading=unreal.MaterialShadingModel.MSM_TWO_SIDED_FOLIAGE, two_sided=True, clip=0.45)
    tc = _e(mat, unreal.MaterialExpressionTextureCoordinate, -1500, 0)
    grid = _scalar(mat, 'Grid', 4.0, -1500, 100)
    tile = _e(mat, unreal.MaterialExpressionPerInstanceCustomData, -1500, 200); tile.set_editor_property('data_index', 0)
    uvc = _custom(mat, LEAF_UV_HLSL, ['UV', 'Grid', 'Tile'], unreal.CustomMaterialOutputType.CMOT_FLOAT2, -1200, 0, 'AtlasUV')
    _con(tc, '', uvc, 'UV'); _con(grid, '', uvc, 'Grid'); _con(tile, '', uvc, 'Tile')
    atlas = _tex(mat, 'Atlas', WHITE, S_COLOR, -900, 0); _con(uvc, '', atlas, 'UVs')
    cr = _e(mat, unreal.MaterialExpressionPerInstanceCustomData, -1200, 300); cr.set_editor_property('data_index', 1); _pic_default(cr)
    cg = _e(mat, unreal.MaterialExpressionPerInstanceCustomData, -1200, 380); cg.set_editor_property('data_index', 2); _pic_default(cg)
    cb = _e(mat, unreal.MaterialExpressionPerInstanceCustomData, -1200, 460); cb.set_editor_property('data_index', 3); _pic_default(cb)
    a1 = _e(mat, unreal.MaterialExpressionAppendVector, -1000, 340); _con(cr, '', a1, 'A'); _con(cg, '', a1, 'B')
    a2 = _e(mat, unreal.MaterialExpressionAppendVector, -900, 380); _con(a1, '', a2, 'A'); _con(cb, '', a2, 'B')
    tint = _vec(mat, 'Tint', (1, 1, 1, 1), -900, 520)
    m1 = _e(mat, unreal.MaterialExpressionMultiply, -650, 100); _con(atlas, 'RGB', m1, 'A'); _con(a2, '', m1, 'B')
    m2 = _e(mat, unreal.MaterialExpressionMultiply, -450, 100); _con(m1, '', m2, 'A'); _con(tint, '', m2, 'B')
    trans = _scalar(mat, 'Translucency', 0.5, -650, 300)
    sub = _e(mat, unreal.MaterialExpressionMultiply, -450, 300); _con(m2, '', sub, 'A'); _con(trans, '', sub, 'B')
    rough = _scalar(mat, 'Roughness', 0.7, -650, 400)
    _prop(m2, '', MP.MP_BASE_COLOR); _prop(sub, '', MP.MP_SUBSURFACE_COLOR); _prop(rough, '', MP.MP_ROUGHNESS); _prop(atlas, 'A', MP.MP_OPACITY_MASK)
    _wind(mat, 3.0)
    return _done(mat)

def _wind(mat, amp):
    wp = _e(mat, unreal.MaterialExpressionWorldPosition, -900, 900)
    t = _e(mat, unreal.MaterialExpressionTime, -900, 980)
    w = _scalar(mat, 'Wind', 1.0, -900, 1060)
    a = _scalar(mat, 'WindAmp', amp, -900, 1140)
    c = _custom(mat, WIND_HLSL, ['WP', 'Time', 'Wind', 'Amp'], unreal.CustomMaterialOutputType.CMOT_FLOAT3, -600, 900, 'Wind')
    _con(wp, '', c, 'WP'); _con(t, '', c, 'Time'); _con(w, '', c, 'Wind'); _con(a, '', c, 'Amp')
    _prop(c, '', MP.MP_WORLD_POSITION_OFFSET)

@guarded
def build_grass():
    """Grass blades: colour gradient root→tip, wind that grows toward the tip."""
    mat = _new('M_SF_Grass', shading=unreal.MaterialShadingModel.MSM_TWO_SIDED_FOLIAGE, two_sided=True)
    tc = _e(mat, unreal.MaterialExpressionTextureCoordinate, -1200, 0)
    ca = _vec(mat, 'ColorA', (0.15, 0.25, 0.05, 1), -1200, 100); cb = _vec(mat, 'ColorB', (0.45, 0.6, 0.15, 1), -1200, 200)
    msk = _e(mat, unreal.MaterialExpressionComponentMask, -1000, 0); msk.set_editor_property('g', True); msk.set_editor_property('r', False); _con(tc, '', msk, '')
    l = _e(mat, unreal.MaterialExpressionLinearInterpolate, -800, 100); _con(ca, '', l, 'A'); _con(cb, '', l, 'B'); _con(msk, '', l, 'Alpha')
    cr = _inst_color(mat, -1400, 300)
    m = _e(mat, unreal.MaterialExpressionMultiply, -600, 100); _con(l, '', m, 'A'); _con(cr, '', m, 'B')
    sub = _e(mat, unreal.MaterialExpressionMultiply, -450, 260); half = _e(mat, unreal.MaterialExpressionConstant, -600, 300); half.set_editor_property('r', 0.4)
    _con(m, '', sub, 'A'); _con(half, '', sub, 'B')
    rough = _scalar(mat, 'Roughness', 0.75, -600, 400)
    _prop(m, '', MP.MP_BASE_COLOR); _prop(sub, '', MP.MP_SUBSURFACE_COLOR); _prop(rough, '', MP.MP_ROUGHNESS)
    _wind(mat, 4.0)
    return _done(mat)

SNOWGROUND_HLSL = '''
float2 p = WP.xy * 0.01;
float h = N1;
float3 tintc = lerp(float3(0.84, 0.88, 0.97), float3(1, 1, 1), smoothstep(0.2, 0.7, h));
return tintc;
'''
SPARKLE_HLSL = '''
// sparse view-dependent glints: a jittered cell lattice (2.5 cm), each cell a tiny facet that flashes only when its
// random normal reflects the camera; fades out with distance so it never aliases into a grid
float2 q = WP.xy / 2.5;
float2 cell = floor(q);
float2 h2 = frac(sin(float2(dot(cell, float2(127.1, 311.7)), dot(cell, float2(269.5, 183.3)))) * 43758.5453);
float2 d = frac(q) - (0.2 + 0.6 * h2);
float spot = smoothstep(0.12, 0.0, length(d));
float3 fn = normalize(float3((h2 - 0.5) * 1.6, 1.0).xzy);
float3 V = normalize(Cam - WP);
float facing = pow(saturate(dot(reflect(-V, fn.xzy), float3(0, 0, 1)) ), 40.0);
float keep = step(0.985, frac(h2.x * 91.7 + h2.y * 13.1));
float dist = length(WP - Cam) * 0.01;
return spot * facing * keep * Amt * 6.0 * smoothstep(9.0, 1.5, dist);
'''

@guarded
def build_snow_ground():
    """Fresh snow: scanned snow normals/roughness, procedural blue-white value variation, view-dependent glints."""
    mat = _new('M_SF_Snow')
    uv = _uv_tiled(mat)
    nor = _tex(mat, 'NormalTex', FLATN, S_NORMAL, -800, 0); _con(uv, '', nor, 'UVs')
    arm = _tex(mat, 'ARMTex', DEF_ARM, S_LINEAR, -800, 300); _con(uv, '', arm, 'UVs')
    wp = _e(mat, unreal.MaterialExpressionWorldPosition, -1300, 600)
    n1 = _vnoise(mat, wp, 0.004, 4, -1000, 600)
    c = _custom(mat, SNOWGROUND_HLSL, ['WP', 'N1'], unreal.CustomMaterialOutputType.CMOT_FLOAT3, -700, 600, 'SnowTint'); _con(wp, '', c, 'WP'); _con(n1, '', c, 'N1')
    col = _vec(mat, 'Color', (0.93, 0.95, 0.98, 1), -700, 760)
    bc = _e(mat, unreal.MaterialExpressionMultiply, -450, 650); _con(c, '', bc, 'A'); _con(col, '', bc, 'B')
    cam = _e(mat, unreal.MaterialExpressionCameraPositionWS, -1000, 900)
    amt = _scalar(mat, 'Sparkle', 0.5, -1000, 980)
    sp = _custom(mat, SPARKLE_HLSL, ['WP', 'Cam', 'Amt'], unreal.CustomMaterialOutputType.CMOT_FLOAT1, -700, 900, 'Sparkle'); _con(wp, '', sp, 'WP'); _con(cam, '', sp, 'Cam'); _con(amt, '', sp, 'Amt')
    rmul = _scalar(mat, 'RoughMul', 0.9, -800, 500)
    r = _e(mat, unreal.MaterialExpressionMultiply, -500, 300); _con(arm, 'G', r, 'A'); _con(rmul, '', r, 'B')
    nint = _scalar(mat, 'NormalStrength', 0.6, -800, 160)
    up = _e(mat, unreal.MaterialExpressionConstant3Vector, -700, -60); up.set_editor_property('constant', unreal.LinearColor(0, 0, 1, 1))
    fl = _e(mat, unreal.MaterialExpressionLinearInterpolate, -500, 0); _con(up, '', fl, 'A'); _con(nor, 'RGB', fl, 'B'); _con(nint, '', fl, 'Alpha')
    _prop(bc, '', MP.MP_BASE_COLOR); _prop(fl, '', MP.MP_NORMAL); _prop(r, '', MP.MP_ROUGHNESS); _prop(sp, '', MP.MP_EMISSIVE_COLOR)
    return _done(mat)

FLAKE_HLSL = '''
// GPU snowfall: every instance is a flake wrapped into a box that follows the camera; the quad is billboarded
// toward the camera and stretched along its screen-space velocity (motion streak). Rand = PerInstanceRandom.
float r0 = Rand;
float r1 = frac(sin(Rand * 91.345) * 47453.5453);
float r2 = frac(sin(Rand * 37.719) * 15731.743);
float r3 = frac(sin(Rand * 13.137) * 78953.137);
float spd = 0.65 + 0.7 * r3;
float3 p = float3(r1, r2, r0) * Box.xyz + Offset.xyz * spd;
float t = LocalTime;
p.x += sin(t * 1.3 * (0.5 + r3) + r1 * 40.0) * Turb * (0.6 + r0);
p.y += cos(t * 1.1 * (0.5 + r1) + r2 * 30.0) * Turb * (0.6 + r2);
p.z += sin(t * 0.7 + r0 * 20.0) * Turb * 0.3;
float3 lo = CamPos.xyz - Box.xyz * 0.5;
float3 q = p - lo;
q = q - floor(q / Box.xyz) * Box.xyz;
float3 center = lo + q;
float3 toCam = CamPos.xyz - center;
float dist = length(toCam);
float3 fwd = toCam / max(dist, 1.0);
float3 right = normalize(cross(float3(0, 0, 1), fwd) + float3(1e-4, 0, 0));
float3 up = cross(fwd, right);
float sz = Size * (0.5 + r3 * 1.0) * step(r2, Density) * smoothstep(15.0, 60.0, dist);
// velocity streak: project velocity onto the billboard plane
float3 v = Vel.xyz * spd * TimeScale;
float3 vp = v - fwd * dot(v, fwd);
float vl = length(vp);
float3 sdir = vl > 1e-3 ? vp / vl : up;
float3 sside = normalize(cross(fwd, sdir));
float2 c = (UV - 0.5) * 2.0;
float stretch = 1.0 + vl * 0.0035 * Streak;
float3 corner = (sside * c.x + sdir * c.y * stretch) * sz;
return center + corner - WPEx;
'''

@guarded
def build_flake():
    mat = _new('M_Snowflake', folder='/Game/FX', blend=unreal.BlendMode.BLEND_TRANSLUCENT, shading=unreal.MaterialShadingModel.MSM_UNLIT,
               two_sided=True, extra={'used_with_instanced_static_meshes': True})
    pr = _e(mat, unreal.MaterialExpressionPerInstanceRandom, -1400, 0)
    uv = _e(mat, unreal.MaterialExpressionTextureCoordinate, -1400, 80)
    wpe = _e(mat, unreal.MaterialExpressionWorldPosition, -1400, 160)
    try:
        wpe.set_editor_property('world_position_shader_offset', unreal.WorldPositionIncludedOffsets.WPT_EXCLUDE_ALL_SHADER_OFFSETS)
    except Exception as e:
        warn(f'flake WPE option: {e}')
    params = {}
    for i, (n, v) in enumerate([('Box', (2600, 2600, 1800, 0)), ('Offset', (0, 0, 0, 0)), ('CamPos', (0, 0, 0, 0)), ('Vel', (0, 0, -160, 0))]):
        params[n] = _vec(mat, n, v, -1400, 240 + i * 80)
    for i, (n, v) in enumerate([('LocalTime', 0), ('Turb', 40), ('Size', 2.2), ('Density', 1.0), ('TimeScale', 1.0), ('Streak', 1.0)]):
        params[n] = _scalar(mat, n, v, -1400, 560 + i * 60)
    c = _custom(mat, FLAKE_HLSL, ['Rand', 'UV', 'WPEx', 'Box', 'Offset', 'CamPos', 'Vel', 'LocalTime', 'Turb', 'Size', 'Density', 'TimeScale', 'Streak'],
                unreal.CustomMaterialOutputType.CMOT_FLOAT3, -900, 200, 'FlakeWrap')
    _con(pr, '', c, 'Rand'); _con(uv, '', c, 'UV'); _con(wpe, '', c, 'WPEx')
    for n in ('Box', 'Offset', 'CamPos', 'Vel', 'LocalTime', 'Turb', 'Size', 'Density', 'TimeScale', 'Streak'):
        _con(params[n], '', c, n)
    # soft round sprite
    uv2 = _e(mat, unreal.MaterialExpressionTextureCoordinate, -900, -300)
    disc = _custom(mat, 'float2 c = (UV - 0.5) * 2.0; float r = length(c); return saturate(1.0 - r * r) * saturate(1.0 - r);', ['UV'],
                   unreal.CustomMaterialOutputType.CMOT_FLOAT1, -700, -300, 'Disc')
    _con(uv2, '', disc, 'UV')
    op = _scalar(mat, 'Opacity', 0.85, -700, -200)
    om = _e(mat, unreal.MaterialExpressionMultiply, -450, -260); _con(disc, '', om, 'A'); _con(op, '', om, 'B')
    col = _vec(mat, 'Color', (0.9, 0.92, 0.96, 1), -700, -500)
    br = _scalar(mat, 'Bright', 1.0, -700, -420)
    em = _e(mat, unreal.MaterialExpressionMultiply, -450, -460); _con(col, '', em, 'A'); _con(br, '', em, 'B')
    _prop(em, '', MP.MP_EMISSIVE_COLOR); _prop(om, '', MP.MP_OPACITY); _prop(c, '', MP.MP_WORLD_POSITION_OFFSET)
    return _done(mat)

@guarded
def build_silhouette():
    mat = _new('M_Silhouette', extra={'used_with_skeletal_mesh': True})
    col = _vec(mat, 'Color', (0.012, 0.013, 0.016, 1), -600, 0)
    rough = _scalar(mat, 'Roughness', 0.92, -600, 100)
    sheen = _e(mat, unreal.MaterialExpressionFresnel, -600, 200)
    sh = _e(mat, unreal.MaterialExpressionMultiply, -400, 200); k = _e(mat, unreal.MaterialExpressionConstant, -600, 300); k.set_editor_property('r', 0.06)
    _con(sheen, '', sh, 'A'); _con(k, '', sh, 'B')
    add = _e(mat, unreal.MaterialExpressionAdd, -250, 0); _con(col, '', add, 'A'); _con(sh, '', add, 'B')
    _prop(add, '', MP.MP_BASE_COLOR); _prop(rough, '', MP.MP_ROUGHNESS)
    return _done(mat)

LIGHT_HLSL = '''
float f = 1.0 - abs(dot(normalize(N), normalize(V)));
float rim = pow(f, 2.2);
float band = 0.5 + 0.5 * sin(WP.z * 0.4 - Time * 1.5);
float3 q = WP * 0.09 + float3(0, 0, -Time * 0.35);
float s1 = frac(sin(dot(floor(q), float3(12.9898, 78.233, 37.719))) * 43758.5453);
float spark = step(0.92, s1) * (0.5 + 0.5 * sin(Time * (3.0 + s1 * 9.0) + s1 * 60.0));
float d = saturate(Dissolve * 1.6 - frac(sin(dot(floor(WP * 0.05), float3(7.1, 3.7, 1.3))) * 9183.13) * 0.6);
float a = (rim * 0.9 + 0.06 + band * 0.04 + spark * 1.6) * Opac * (1.0 - d);
return Color.rgb * a * Intensity;
'''

@guarded
def build_light_figure():
    """Her: a figure made of light. Additive rim + drifting sparks, dissolvable."""
    mat = _new('M_LightFigure', blend=unreal.BlendMode.BLEND_ADDITIVE, shading=unreal.MaterialShadingModel.MSM_UNLIT, two_sided=False, extra={'used_with_skeletal_mesh': True})
    n = _e(mat, unreal.MaterialExpressionPixelNormalWS, -900, 0)
    v = _e(mat, unreal.MaterialExpressionCameraVectorWS, -900, 80)
    wp = _e(mat, unreal.MaterialExpressionWorldPosition, -900, 160)
    t = _e(mat, unreal.MaterialExpressionTime, -900, 240)
    col = _vec(mat, 'Color', (1, 0.86, 0.68, 1), -900, 320)
    op = _scalar(mat, 'Opacity', 1.0, -900, 400); ds = _scalar(mat, 'Dissolve', 0.0, -900, 460); it = _scalar(mat, 'Intensity', 6.0, -900, 520)
    c = _custom(mat, LIGHT_HLSL, ['N', 'V', 'WP', 'Time', 'Color', 'Opac', 'Dissolve', 'Intensity'], unreal.CustomMaterialOutputType.CMOT_FLOAT3, -500, 200, 'LightFigure')
    for a, b in ((n, 'N'), (v, 'V'), (wp, 'WP'), (t, 'Time'), (col, 'Color'), (op, 'Opac'), (ds, 'Dissolve'), (it, 'Intensity')):
        _con(a, '', c, b)
    _prop(c, '', MP.MP_EMISSIVE_COLOR)
    return _done(mat)

STAIN_HLSL = '''
float2 c = UV - 0.5; c.y = c.y * 1.6 + 0.12;
float r = length(c) * 2.0;
float edge = Grow * (0.75 + N1 * 0.6);
float m = smoothstep(edge, edge - 0.12, r);
float core = smoothstep(edge * 0.8, 0.0, r);
float cov = saturate(Cover + (N2 - 0.5) * 0.6);
return float4(lerp(float3(0.34, 0.03, 0.07), float3(0.16, 0.01, 0.03), core), m * (1.0 - cov) * 0.92);
'''

@guarded
def build_stain():
    mat = _new('M_WineStain', domain=unreal.MaterialDomain.MD_DEFERRED_DECAL, blend=unreal.BlendMode.BLEND_TRANSLUCENT)
    uv = _e(mat, unreal.MaterialExpressionTextureCoordinate, -1000, 0)
    wp = _e(mat, unreal.MaterialExpressionWorldPosition, -1200, 200)
    n1 = _vnoise(mat, wp, 0.08, 3, -1000, 200)
    n2 = _vnoise(mat, wp, 0.25, 3, -1000, 320)
    g = _scalar(mat, 'Grow', 0.0, -1000, 440); cv = _scalar(mat, 'Cover', 0.0, -1000, 500)
    c = _custom(mat, STAIN_HLSL, ['UV', 'N1', 'N2', 'Grow', 'Cover'], unreal.CustomMaterialOutputType.CMOT_FLOAT4, -600, 200, 'Stain')
    for a, b in ((uv, 'UV'), (n1, 'N1'), (n2, 'N2'), (g, 'Grow'), (cv, 'Cover')):
        _con(a, '', c, b)
    rgb = _e(mat, unreal.MaterialExpressionComponentMask, -350, 150); rgb.set_editor_property('r', True); rgb.set_editor_property('g', True); rgb.set_editor_property('b', True); rgb.set_editor_property('a', False); _con(c, '', rgb, '')
    al = _e(mat, unreal.MaterialExpressionComponentMask, -350, 260); al.set_editor_property('r', False); al.set_editor_property('g', False); al.set_editor_property('b', False); al.set_editor_property('a', True); _con(c, '', al, '')
    rough = _scalar(mat, 'Roughness', 0.25, -350, 360)
    _prop(rgb, '', MP.MP_BASE_COLOR); _prop(al, '', MP.MP_OPACITY); _prop(rough, '', MP.MP_ROUGHNESS)
    return _done(mat)

WARP_HLSL = '''
float2 uv = UV;
float2 c = uv - 0.5;
// collapse: an old television switching off
float sy = lerp(1.0, 0.004, smoothstep(0.0, 0.7, Collapse));
float sx = lerp(1.0, 0.0, smoothstep(0.65, 1.0, Collapse));
uv = c / float2(max(sx, 1e-4), sy) + 0.5;
// glitch bands
float band = floor(uv.y * 28.0 + floor(Time * 24.0) * 3.1);
float rnd = frac(sin(dot(float2(band, floor(Time * 24.0)), float2(12.9898, 78.233))) * 43758.5453);
if (rnd > 1.0 - Glitch * 0.5) uv.x += (frac(sin(band * 1.7) * 9191.3) - 0.5) * 0.08 * Glitch;
float3 acc = 0; float tw = 0;
float jit = frac(sin(dot(UV * 1000.0, float2(12.9898, 78.233)) + Time) * 43758.5453);
for (int i = 0; i < 16; i++) {
  float t = (i + jit) / 16.0;
  float2 s = lerp(uv, float2(0.5, 0.5), t * Warp * 0.35);
  float w = 1.0 - t * 0.5;
  acc += SceneTextureLookup(ViewportUVToSceneTextureUV(s, 14), 14, false).rgb * w; tw += w;
}
float3 col = acc / tw;
float inside = step(0.0, uv.x) * step(uv.x, 1.0) * step(0.0, uv.y) * step(uv.y, 1.0);
col *= inside;
col += float3(0.9, 0.95, 1.0) * smoothstep(0.55, 0.75, Collapse) * (1.0 - smoothstep(0.85, 1.0, Collapse)) * exp(-abs(UV.y - 0.5) * 400.0) * 4.0;
return col;
'''

@guarded
def build_pp_warp():
    ensure_dir('/Game/Materials/PP')
    mat = _new('M_PP_Warp', folder='/Game/Materials/PP', domain=unreal.MaterialDomain.MD_POST_PROCESS)
    try:
        mat.set_editor_property('blendable_location', unreal.BlendableLocation.BL_SCENE_COLOR_AFTER_TONEMAPPING)
    except Exception as e:
        warn(f'blendable location: {e}')
    uv = _e(mat, unreal.MaterialExpressionScreenPosition, -1000, 0)
    t = _e(mat, unreal.MaterialExpressionTime, -1000, 100)
    w = _scalar(mat, 'Warp', 0.0, -1000, 200); g = _scalar(mat, 'Glitch', 0.0, -1000, 260); cl = _scalar(mat, 'Collapse', 0.0, -1000, 320)
    # SceneTexture node must exist in the graph for SceneTextureLookup to compile
    st = _e(mat, unreal.MaterialExpressionSceneTexture, -1000, 420); st.set_editor_property('scene_texture_id', unreal.SceneTextureId.PPI_POST_PROCESS_INPUT0)
    c = _custom(mat, WARP_HLSL + '\n// dummy\n', ['UV', 'Time', 'Warp', 'Glitch', 'Collapse', 'Dummy'], unreal.CustomMaterialOutputType.CMOT_FLOAT3, -600, 100, 'Warp')
    _con(uv, 'ViewportUV', c, 'UV'); _con(t, '', c, 'Time'); _con(w, '', c, 'Warp'); _con(g, '', c, 'Glitch'); _con(cl, '', c, 'Collapse'); _con(st, 'Color', c, 'Dummy')
    _prop(c, '', MP.MP_EMISSIVE_COLOR)
    return _done(mat)

WINDOW_HLSL = '''
float3 night = lerp(float3(0.02, 0.07, 0.13), float3(0.08, 0.2, 0.32), 1.0 - UV.y);
float flakes = 0;
for (int k = 0; k < 3; k++) {
  float2 g = UV * float2(18.0, 26.0) * (1.0 + k * 0.6) + float2(sin(Time * 0.3 + k) * 0.5, -Time * (1.2 + k * 0.5));
  float2 c = frac(g) - 0.5;
  float r = frac(sin(dot(floor(g) + k * 7.0, float2(127.1, 311.7))) * 43758.5453);
  flakes += step(0.82, r) * smoothstep(0.12, 0.0, length(c));
}
float frost = smoothstep(0.35, 0.95, N1 * 0.6 + N2 * 0.4 + pow(abs(UV.x - 0.5) * 2.0, 3.0) + pow(abs(UV.y - 0.5) * 2.0, 3.0) * 0.8);
float3 col = night + flakes * float3(0.7, 0.85, 1.0) * 0.9;
col = lerp(col, float3(0.55, 0.7, 0.85), frost * 0.75);
return col * (0.25 + On * 2.2) * Intensity;
'''

@guarded
def build_window():
    mat = _new('M_WindowFrost', shading=unreal.MaterialShadingModel.MSM_UNLIT)
    uv = _e(mat, unreal.MaterialExpressionTextureCoordinate, -1000, 0)
    t = _e(mat, unreal.MaterialExpressionTime, -1000, 80)
    wp = _e(mat, unreal.MaterialExpressionWorldPosition, -1200, 160)
    n1 = _vnoise(mat, wp, 0.05, 3, -1000, 160)
    n2 = _vnoise(mat, wp, 0.2, 3, -1000, 260)
    on = _scalar(mat, 'On', 0.15, -1000, 360); it = _scalar(mat, 'Intensity', 3.0, -1000, 420)
    c = _custom(mat, WINDOW_HLSL, ['UV', 'Time', 'N1', 'N2', 'On', 'Intensity'], unreal.CustomMaterialOutputType.CMOT_FLOAT3, -600, 100, 'Window')
    for a, b in ((uv, 'UV'), (t, 'Time'), (n1, 'N1'), (n2, 'N2'), (on, 'On'), (it, 'Intensity')):
        _con(a, '', c, b)
    _prop(c, '', MP.MP_EMISSIVE_COLOR)
    return _done(mat)

@guarded
def build_glass():
    mat = _new('M_SF_Glass', blend=unreal.BlendMode.BLEND_TRANSLUCENT, two_sided=True,
               extra={'translucency_lighting_mode': unreal.TranslucencyLightingMode.TLM_SURFACE_PER_PIXEL_LIGHTING})
    col = _vec(mat, 'Color', (0.9, 0.95, 1.0, 1), -600, 0)
    op = _scalar(mat, 'Opacity', 0.18, -600, 100)
    fr = _e(mat, unreal.MaterialExpressionFresnel, -600, 200)
    add = _e(mat, unreal.MaterialExpressionAdd, -400, 150); _con(op, '', add, 'A'); _con(fr, '', add, 'B')
    sat = _e(mat, unreal.MaterialExpressionSaturate, -250, 150); _con(add, '', sat, '')
    rough = _scalar(mat, 'Roughness', 0.03, -600, 300); spec = _scalar(mat, 'Specular', 1.0, -600, 360)
    _prop(col, '', MP.MP_BASE_COLOR); _prop(sat, '', MP.MP_OPACITY); _prop(rough, '', MP.MP_ROUGHNESS); _prop(spec, '', MP.MP_SPECULAR)
    return _done(mat)

@guarded
def build_emissive():
    mat = _new('M_SF_Emissive', shading=unreal.MaterialShadingModel.MSM_UNLIT)
    col = _vec(mat, 'Color', (1, 0.8, 0.5, 1), -600, 0); it = _scalar(mat, 'Intensity', 5.0, -600, 100)
    m = _e(mat, unreal.MaterialExpressionMultiply, -400, 50); _con(col, '', m, 'A'); _con(it, '', m, 'B')
    _prop(m, '', MP.MP_EMISSIVE_COLOR)
    return _done(mat)

@guarded
def build_sky():
    mat = _new('M_SkyHDRI', shading=unreal.MaterialShadingModel.MSM_UNLIT, two_sided=True, extra={'is_sky': True})
    cv = _e(mat, unreal.MaterialExpressionCameraVectorWS, -900, 0)
    neg = _e(mat, unreal.MaterialExpressionMultiply, -700, 0); neg.set_editor_property('const_b', -1.0); _con(cv, '', neg, 'A')
    cube = _e(mat, unreal.MaterialExpressionTextureSampleParameterCube, -500, 0); cube.set_editor_property('parameter_name', 'Cube')
    t = eal.load_asset('/Engine/EngineResources/DefaultTextureCube')
    if t:
        cube.set_editor_property('texture', t)
    _con(neg, '', cube, 'UVs')
    it = _scalar(mat, 'Intensity', 1.0, -500, 200)
    m = _e(mat, unreal.MaterialExpressionMultiply, -250, 50); _con(cube, 'RGB', m, 'A'); _con(it, '', m, 'B')
    _prop(m, '', MP.MP_EMISSIVE_COLOR)
    return _done(mat)

def ensure_defaults():
    import os
    from sf_common import SOURCE, import_file
    if not load(DEF_ARM):
        ensure_dir('/Game/Textures/Defaults')
        import_file(os.path.join(SOURCE, 'Textures', 'T_DefaultARM.png'), '/Game/Textures/Defaults', 'T_DefaultARM')
        t = load(DEF_ARM)
        if t:
            t.set_editor_property('compression_settings', unreal.TextureCompressionSettings.TC_MASKS)
            t.set_editor_property('srgb', False)
            eal.save_loaded_asset(t)

DOME_HLSL = '''
float3 d = normalize(-CamVec);
float h = saturate(d.z);
float3 c = lerp(Hor, Mid, smoothstep(0.0, 0.25, h));
c = lerp(c, Top, smoothstep(0.2, 0.9, h));
c = lerp(c, Hor * 0.6, saturate(-d.z * 4.0));   // below horizon: dim horizon colour
float sd = saturate(dot(d, normalize(SunDir)));
c += Glow * (pow(sd, 6.0) * 0.6 + pow(sd, 64.0) * 2.5 + pow(sd, 2048.0) * 40.0);
return c * Intensity;
'''

@guarded
def build_sky_dome():
    mat = _new('M_SkyDome', shading=unreal.MaterialShadingModel.MSM_UNLIT, two_sided=True, extra={'is_sky': True})
    cv = _e(mat, unreal.MaterialExpressionCameraVectorWS, -900, 0)
    ins = {'Top': (0.08, 0.24, 0.58, 1), 'Mid': (0.3, 0.45, 0.7, 1), 'Hor': (0.9, 0.82, 0.64, 1), 'SunDir': (0.3, 0.6, 0.75, 0), 'Glow': (1.0, 0.9, 0.75, 1)}
    nodes = {k: _vec(mat, k, v, -900, 100 + i * 80) for i, (k, v) in enumerate(ins.items())}
    it = _scalar(mat, 'Intensity', 1.0, -900, 600)
    c = _custom(mat, DOME_HLSL, ['CamVec', 'Top', 'Mid', 'Hor', 'SunDir', 'Glow', 'Intensity'], unreal.CustomMaterialOutputType.CMOT_FLOAT3, -500, 200, 'Dome')
    _con(cv, '', c, 'CamVec')
    for k, n in nodes.items():
        _con(n, '', c, k)
    _con(it, '', c, 'Intensity')
    _prop(c, '', MP.MP_EMISSIVE_COLOR)
    return _done(mat)

@guarded
def build_glow_card():
    """Soft additive light card (far glows, light cones); not fogged."""
    mat = _new('M_SF_GlowCard', blend=unreal.BlendMode.BLEND_ADDITIVE, shading=unreal.MaterialShadingModel.MSM_UNLIT, two_sided=True)
    for prop in ('apply_fogging', 'use_translucency_vertex_fog'):
        try:
            mat.set_editor_property(prop, False)
        except Exception:
            pass
    uv = _e(mat, unreal.MaterialExpressionTextureCoordinate, -900, 0)
    g = _custom(mat, 'float2 c = (UV - 0.5) * 2.0; float r = length(c); return pow(saturate(1.0 - r), 2.2);', ['UV'],
                unreal.CustomMaterialOutputType.CMOT_FLOAT1, -700, 0, 'Falloff')
    _con(uv, '', g, 'UV')
    col = _vec(mat, 'Color', (0.2, 0.5, 0.8, 1), -700, 150)
    it = _scalar(mat, 'Intensity', 1.0, -700, 250)
    m1 = _e(mat, unreal.MaterialExpressionMultiply, -450, 80); _con(g, '', m1, 'A'); _con(col, '', m1, 'B')
    m2 = _e(mat, unreal.MaterialExpressionMultiply, -300, 120); _con(m1, '', m2, 'A'); _con(it, '', m2, 'B')
    _prop(m2, '', MP.MP_EMISSIVE_COLOR)
    return _done(mat)

def build_all():
    step('materials')
    ensure_defaults()
    for f in (build_pbr, lambda: build_basic('M_SF_Basic', False, False), lambda: build_basic('M_SF_Basic2S', True, True),
              build_leaf, build_grass, build_snow_ground, build_flake, build_silhouette, build_light_figure, build_stain,
              build_pp_warp, build_window, build_glass, build_emissive, build_sky, build_sky_dome, build_glow_card):
        f()

def instance(name, parent_path, folder='/Game/Materials/Instances', scalars=None, vectors=None, textures=None):
    ensure_dir(folder)
    path = f'{folder}/{name}'
    mi = load(path)
    if mi is None:
        mi = asset_tools.create_asset(name, folder, unreal.MaterialInstanceConstant, unreal.MaterialInstanceConstantFactoryNew())
    parent = eal.load_asset(parent_path)
    mel.set_material_instance_parent(mi, parent)
    for k, v in (scalars or {}).items():
        mel.set_material_instance_scalar_parameter_value(mi, k, float(v))
    for k, v in (vectors or {}).items():
        mel.set_material_instance_vector_parameter_value(mi, k, v if isinstance(v, unreal.LinearColor) else unreal.LinearColor(*v))
    for k, v in (textures or {}).items():
        if v is not None:
            mel.set_material_instance_texture_parameter_value(mi, k, v)
    mel.update_material_instance(mi)
    eal.save_loaded_asset(mi)
    return mi
