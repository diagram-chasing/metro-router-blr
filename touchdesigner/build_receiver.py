# BMRCL vector-journey receiver — builder script for TouchDesigner.
#
# HOW TO USE
#   1. Open TouchDesigner. Create a new (empty) project, or use an existing one.
#   2. Create a Text DAT (Tab in network editor → DAT → Text).
#   3. Paste this entire file into it.
#   4. Right-click the Text DAT → "Run Script".
#   5. A new container COMP named "bmrcl_vector" appears at /project1/bmrcl_vector
#      with the wired network, a render TOP, and custom params to drive it.
#
# WHAT IT BUILDS
#   /project1/bmrcl_vector/
#     ├── request1            webclientDAT          — GETs the vector-journey JSON
#     ├── response            textDAT               — last response body
#     ├── status              textDAT               — last parser status (diagnostic)
#     ├── request_cb          textDAT               — onResponse callback for request1
#     ├── param_exec          parameterexecuteDAT   — re-fetches or re-cooks on param change
#     ├── timer1, timer_cb                          — polls Url every Pollsec seconds
#     ├── geo1                geometryCOMP
#     │     ├── parser           scriptSOP          — JSON → one Poly per segment, with
#     │     │                                         primitive groups "walks" & "metros",
#     │     │                                         per-point Cd/segid/t/kind attributes
#     │     ├── parser_cb        textDAT
#     │     ├── apply_walks_mat  materialSOP        — assigns walks_mat to group "walks"
#     │     └── apply_metros_mat materialSOP        — assigns metros_mat to group "metros"
#     ├── walks_mat           lineMAT (linewidth ← parent().par.Walkthickness)
#     ├── metros_mat          lineMAT (linewidth ← parent().par.Metrothickness)
#     └── cam1, light1, render1, out1               — render chain
#
# THE PARAMETER PAGE ("the only thing the visuals person should touch"):
#   Walk page   : Thickness, Brightness, Alpha
#   Metro page  : Thickness, Brightness, Alpha
#   Vector page : Url, Pollsec, Scale, Refreshnow
#
# Thickness drives the corresponding lineMAT's pixel width (live).
# Brightness multiplies per-point Cd; Alpha sets Cd alpha. Both re-cook the parser
# automatically when changed.
#
# CUSTOM PARAMETERS (on the container)
#   Url        : full URL of the JSON endpoint (default
#                http://localhost:5173/api/journey/current — reads whatever the
#                browser most recently picked. Change to /api/journey/vector?o=...&d=...
#                to drive from a fixed pair of coordinates instead.)
#   Pollsec    : polling interval in seconds (default 1.0)
#   Scale      : divides projected meters by this (default 1000.0 → 1 unit ≈ 1 km)
#   Refreshnow : pulse to force an immediate fetch
#
# NOTES
#   - The URL is sent verbatim. The "browser-drives-TD" flow uses /current and
#     requires you to also pick origin/destination in the SvelteKit web app.
#   - Coordinates in the JSON are projected meters relative to the journey centroid.
#     They are divided by `Scale` so the polyline fits comfortably in TD's default cam.
#   - Per-point Cd is derived from the segment's lineColor; per-point segid and t are
#     custom attributes you can read in any downstream MAT/SOP/CHOP.
#   - Requires the SvelteKit dev server running (`pnpm dev` in the repo).

COMP_NAME = 'bmrcl_vector'
PARENT = op('/project1') or root


# ---------- callback source bodies (written verbatim into textDATs) ----------

PARAM_EXEC_SCRIPT = """# Callback script for parameterexecuteDAT. Watches the container's custom params
# and either re-fetches (URL/Refreshnow) or re-cooks the parser (brightness/alpha/scale).
FETCH_PARAMS = {"Url", "Refreshnow"}
RECOOK_PARAMS = {"Walkbrightness", "Walkalpha", "Metrobrightness", "Metroalpha", "Scale"}

def _fetch_now():
    comp = parent()
    req = comp.op("request1")
    if req is None:
        return
    url = str(comp.par.Url.eval())
    try:
        req.request(url, "GET")
    except Exception as e:
        print("[bmrcl_vector] fetch failed:", e)

def _recook_parser():
    p = parent().op("geo1/parser")
    if p is not None:
        p.cook(force=True)

def onValueChange(par, prev):
    if par.name in FETCH_PARAMS:
        _fetch_now()
    elif par.name in RECOOK_PARAMS:
        _recook_parser()
    return

def onPulse(par):
    if par.name == "Refreshnow":
        _fetch_now()
    return

def onExpressionChange(par, val, prev):
    return

def onExportChange(par, val, prev):
    return

def onEnableChange(par, val):
    return

def onModeChange(par, prev):
    return
"""

TIMER_CB_SCRIPT = """# Callbacks for timerCHOP. onCycle fires once per cycle (every Pollsec seconds).
def _fetch_now():
    comp = parent()
    req = comp.op("request1")
    if req is None:
        return
    url = str(comp.par.Url.eval())
    try:
        req.request(url, "GET")
    except Exception as e:
        print("[bmrcl_vector] poll fetch failed:", e)

def onInitialize(timerOp):
    return

def onStart(timerOp, segment, interrupt):
    return

def onCycle(timerOp, segment, cycle):
    _fetch_now()
    return

def onSegment(timerOp, segment, interrupt):
    return

def onDone(timerOp, segment, interrupt):
    return

def whileTimerActive(timerOp, segment, cycle, fraction):
    return

def onPulse(par):
    return
"""

REQUEST_CB = """# Mirrors the response into the textDAT and forces the parser to re-cook.
def onResponse(webClientDAT, statusCode, headerDict, data):
    rsp = op("response")
    if rsp is not None:
        try:
            rsp.text = data.decode("utf-8") if isinstance(data, (bytes, bytearray)) else str(data)
        except Exception as e:
            rsp.text = "// decode error: " + str(e)
    p = op("geo1/parser")
    if p is not None:
        p.cook(force=True)
    return
"""

PARSER_CB = """# Reads JSON from op("../response") and emits the journey as multiple polylines:
#   - one Poly per segment (so downstream SOPs can target individual hops)
#   - two primitive groups: "walks" and "metros" (so Material SOPs can route)
#   - per-point Cd (modulated by the container's per-kind Brightness/Alpha),
#     segid (int), t (float, 0..1 across whole journey), kind (0=walk,1=metro)
# Parser lives inside geo1 → paths use ../ for response and parent(2) for container params.
import json

def _hex_to_rgb(h):
    h = h.lstrip("#")
    if len(h) != 6:
        return (1.0, 1.0, 1.0)
    return (int(h[0:2], 16) / 255.0, int(h[2:4], 16) / 255.0, int(h[4:6], 16) / 255.0)

def _status(msg):
    s = op("../../status")
    if s is not None:
        s.text = msg
    print("[bmrcl_vector parser]", msg)

def _emit_test_square(scriptOp):
    # Diagnostic: magenta square ~10 units across in the XY plane.
    scriptOp.pointAttribs.create("Cd")
    coords = [(-5.0, -5.0), (5.0, -5.0), (5.0, 5.0), (-5.0, 5.0), (-5.0, -5.0)]
    pts = []
    for x, y in coords:
        pt = scriptOp.appendPoint()
        pt.P = (x, y, 0.0)
        pt.Cd = (1.0, 0.2, 0.9, 1.0)
        pts.append(pt)
    poly = scriptOp.appendPoly(len(pts), addPoints=False, closed=False)
    for i, vertex in enumerate(poly):
        vertex.point = pts[i]

def _param(name, default):
    try:
        return float(parent(2).par[name].eval())
    except Exception:
        return default

def _get_prim_group(scriptOp, name):
    # createPrimGroup() return value is inconsistent across TD versions: some
    # return the Group, some return None. Either way, primGroups[name] resolves it.
    try:
        scriptOp.createPrimGroup(name)
    except Exception:
        pass  # already exists from a previous cook (scriptOp.clear may not purge groups)
    try:
        return scriptOp.primGroups[name]
    except Exception:
        return None

def cook(scriptOp):
    scriptOp.clear()
    rsp = op("../response")
    if rsp is None or not rsp.text.strip():
        _status("no response yet — is dev server running? drawing test square")
        _emit_test_square(scriptOp)
        return
    try:
        data = json.loads(rsp.text)
    except Exception as e:
        _status("response is not JSON (" + str(e) + ") — drawing test square")
        _emit_test_square(scriptOp)
        return
    if isinstance(data, dict) and "error" in data:
        _status("server returned error: " + str(data.get("error")) + " — drawing test square")
        _emit_test_square(scriptOp)
        return

    points = data.get("points", [])
    segments = data.get("segments", [])
    if not points or not segments:
        _status("JSON had no points/segments — drawing test square")
        _emit_test_square(scriptOp)
        return

    scale = _param("Scale", 1000.0) or 1.0
    walk_bright  = _param("Walkbrightness", 1.0)
    walk_alpha   = _param("Walkalpha",      1.0)
    metro_bright = _param("Metrobrightness", 1.0)
    metro_alpha  = _param("Metroalpha",      1.0)

    seg_colors = [_hex_to_rgb(s.get("lineColor", "#FFFFFF")) for s in segments]
    seg_kinds  = [str(s.get("kind", "metro")) for s in segments]

    scriptOp.pointAttribs.create("Cd")
    scriptOp.pointAttribs.create("segid", 0)
    scriptOp.pointAttribs.create("t", 0.0)
    scriptOp.pointAttribs.create("kind", 0)  # 0=walk, 1=metro

    walks_group  = _get_prim_group(scriptOp, "walks")
    metros_group = _get_prim_group(scriptOp, "metros")

    # Allocate all points first; record per-segment point index ranges.
    pts = []
    minx = miny = float("inf")
    maxx = maxy = float("-inf")
    for pt_data in points:
        x = float(pt_data["x"]) / scale
        y = float(pt_data["y"]) / scale
        if x < minx: minx = x
        if x > maxx: maxx = x
        if y < miny: miny = y
        if y > maxy: maxy = y
        seg_idx = int(pt_data.get("seg", 0))
        is_walk = (seg_idx < len(seg_kinds) and seg_kinds[seg_idx] == "walk")
        base = seg_colors[seg_idx] if 0 <= seg_idx < len(seg_colors) else (1.0, 1.0, 1.0)
        bright = walk_bright if is_walk else metro_bright
        alpha  = walk_alpha  if is_walk else metro_alpha
        pt = scriptOp.appendPoint()
        pt.P = (x, y, 0.0)
        pt.Cd = (base[0] * bright, base[1] * bright, base[2] * bright, alpha)
        pt.segid = seg_idx
        pt.t = float(pt_data.get("t", 0.0))
        pt.kind = 0 if is_walk else 1
        pts.append(pt)

    # Emit one Poly per segment using its [fromIndex, toIndex) range.
    for s_idx, seg in enumerate(segments):
        a = int(seg.get("fromIndex", 0))
        b = int(seg.get("toIndex", 0))
        if b - a < 2:
            continue
        poly = scriptOp.appendPoly(b - a, addPoints=False, closed=False)
        for i in range(b - a):
            poly[i].point = pts[a + i]
        target = walks_group if str(seg.get("kind", "metro")) == "walk" else metros_group
        if target is not None:
            try:
                target.add(poly)
            except Exception:
                try:
                    target.add(poly.index)
                except Exception:
                    pass

    _status("ok: {0} points, {1} segments, bbox x[{2:.2f},{3:.2f}] y[{4:.2f},{5:.2f}]".format(
        len(pts), len(segments), minx, maxx, miny, maxy
    ))
"""

# ---------- builder ----------

def _purge_existing():
    existing = PARENT.op(COMP_NAME)
    if existing:
        existing.destroy()


def _set_text(dat_op, body):
    dat_op.text = body


def _build():
    comp = PARENT.create(containerCOMP, COMP_NAME)
    comp.nodeX, comp.nodeY = 0, 0

    # --- custom parameters ---
    # Walk page (first-mile + last-mile walking) — what the visuals person tweaks
    walk_page = comp.appendCustomPage('Walk')
    for name, label, default in [
        ('Walkthickness',  'Thickness',  4.0),
        ('Walkbrightness', 'Brightness', 1.0),
        ('Walkalpha',      'Alpha',      1.0),
    ]:
        p = walk_page.appendFloat(name, label=label)[0]
        p.default = default
        p.val = default

    # Metro page (in-train hops) — same knobs, controlled independently
    metro_page = comp.appendCustomPage('Metro')
    for name, label, default in [
        ('Metrothickness',  'Thickness',  8.0),
        ('Metrobrightness', 'Brightness', 1.0),
        ('Metroalpha',      'Alpha',      1.0),
    ]:
        p = metro_page.appendFloat(name, label=label)[0]
        p.default = default
        p.val = default

    # Vector page (data source + render settings) — set once, then forget
    page = comp.appendCustomPage('Vector')
    p = page.appendStr('Url', label='URL')[0]
    p.default = 'http://localhost:5173/api/journey/current'
    p.val = 'http://localhost:5173/api/journey/current'
    for name, label, default in [
        ('Pollsec', 'Poll seconds',    1.0),
        ('Scale',   'Meters per unit', 1000.0),
    ]:
        p = page.appendFloat(name, label=label)[0]
        p.default = default
        p.val = default
    page.appendPulse('Refreshnow', label='Refresh now')

    # ----- DATs column (top-left) -----
    request_cb = comp.create(textDAT, 'request_cb')
    request_cb.nodeX, request_cb.nodeY = -600, 400
    _set_text(request_cb, REQUEST_CB)

    request1 = comp.create(webclientDAT, 'request1')
    request1.nodeX, request1.nodeY = -400, 400
    request1.par.callbacks = request_cb

    response = comp.create(textDAT, 'response')
    response.nodeX, response.nodeY = -200, 400

    status = comp.create(textDAT, 'status')
    status.nodeX, status.nodeY = 0, 400
    status.text = '(not cooked yet)'

    # parameterexecuteDAT: its OWN text is the callback script (no separate callbacks DAT).
    param_exec = comp.create(parameterexecuteDAT, 'param_exec')
    param_exec.nodeX, param_exec.nodeY = -400, 250
    param_exec.par.op = '..'
    param_exec.par.pars = 'Url Refreshnow Walkbrightness Walkalpha Metrobrightness Metroalpha Scale'
    param_exec.par.valuechange = True
    param_exec.par.onpulse = True
    _set_text(param_exec, PARAM_EXEC_SCRIPT)

    # Poll timer: fires once every Pollsec seconds and triggers a re-fetch.
    # Timer CHOP has its own Callbacks DAT parameter — much more reliable
    # than wiring through a separate chopexecuteDAT.
    timer_cb = comp.create(textDAT, 'timer_cb')
    timer_cb.nodeX, timer_cb.nodeY = 0, 250
    _set_text(timer_cb, TIMER_CB_SCRIPT)

    timer1 = comp.create(timerCHOP, 'timer1')
    timer1.nodeX, timer1.nodeY = -200, 250
    timer1.par.length.expr = 'parent().par.Pollsec'
    try:
        timer1.par.cycle = True
    except Exception:
        pass
    # IMPORTANT: default Cycle Limit is On with Max Cycles=4. That stops the timer
    # after 4 cycles and polling silently dies. Turn the limit off so it loops forever.
    try:
        timer1.par.cyclelimit = False
    except Exception:
        pass
    try:
        timer1.par.callbacks = timer_cb
    except Exception:
        pass
    try:
        timer1.par.start.pulse()
    except Exception:
        pass

    # ----- Geometry COMP with parser inside it -----
    geo = comp.create(geometryCOMP, 'geo1')
    geo.nodeX, geo.nodeY = 200, 0
    # Strip the default torus so only our parser SOP gets rendered.
    for default_name in ('torus1', 'sphere1', 'in1'):
        default_sop = geo.op(default_name)
        if default_sop:
            default_sop.destroy()

    parser = geo.create(scriptSOP, 'parser')
    parser.nodeX, parser.nodeY = 0, 0

    parser_cb = geo.create(textDAT, 'parser_cb')
    parser_cb.nodeX, parser_cb.nodeY = 0, -150
    _set_text(parser_cb, PARSER_CB)
    parser.par.callbacks = parser_cb

    # Material SOPs route MATs to primitive groups emitted by parser.
    mat_apply_walks = geo.create(materialSOP, 'apply_walks_mat')
    mat_apply_walks.nodeX, mat_apply_walks.nodeY = 200, 0
    mat_apply_walks.inputConnectors[0].connect(parser)
    try:
        mat_apply_walks.par.group = 'walks'
    except Exception:
        pass

    mat_apply_metros = geo.create(materialSOP, 'apply_metros_mat')
    mat_apply_metros.nodeX, mat_apply_metros.nodeY = 400, 0
    mat_apply_metros.inputConnectors[0].connect(mat_apply_walks)
    try:
        mat_apply_metros.par.group = 'metros'
    except Exception:
        pass
    mat_apply_metros.display = True
    mat_apply_metros.render = True

    geo.par.display = True
    geo.par.render = True

    # ----- Two Line MATs, each width bound to its respective custom param ------
    # Line MAT exposes Width Near + Width Far (distance-interpolated, not a single
    # linewidth). Bind BOTH to the same custom param so width is constant.
    def _bind_line_mat(mat, thickness_param_name):
        for par_name in ('widthnear', 'widthfar'):
            try:
                mat.par[par_name].expr = "parent().par." + thickness_param_name
            except Exception as e:
                print('[bmrcl_vector] could not bind', mat.name, par_name, ':', e)
        try:
            mat.par.usepointcolor = True
        except Exception:
            pass

    walks_mat = comp.create(lineMAT, 'walks_mat')
    walks_mat.nodeX, walks_mat.nodeY = 200, -180
    _bind_line_mat(walks_mat, 'Walkthickness')

    metros_mat = comp.create(lineMAT, 'metros_mat')
    metros_mat.nodeX, metros_mat.nodeY = 400, -180
    _bind_line_mat(metros_mat, 'Metrothickness')

    # Now point the Material SOPs at their MATs.
    try:
        mat_apply_walks.par.material = walks_mat
    except Exception:
        pass
    try:
        mat_apply_metros.par.material = metros_mat
    except Exception:
        pass

    # ----- Camera / Light / Render chain -----
    cam = comp.create(cameraCOMP, 'cam1')
    cam.nodeX, cam.nodeY = 400, 100
    cam.par.tz = 50

    light = comp.create(lightCOMP, 'light1')
    light.nodeX, light.nodeY = 400, -100

    render = comp.create(renderTOP, 'render1')
    render.nodeX, render.nodeY = 600, 0
    render.par.camera = cam
    render.par.lights = light
    render.par.geometry = geo
    render.par.resolutionw = 1280
    render.par.resolutionh = 720
    # Dark grey background (not pure black) so "render chain alive but empty"
    # is visually distinguishable from "TOP not rendering at all".
    try:
        render.par.bgred = 0.08
        render.par.bggreen = 0.08
        render.par.bgblue = 0.10
        render.par.bgalpha = 1.0
    except Exception:
        pass

    out = comp.create(outTOP, 'out1')
    out.nodeX, out.nodeY = 800, 0
    out.inputConnectors[0].connect(render)

    # Make the container display this render in its own viewer, and on the Perform
    # window if one is opened — so the user sees output without entering the comp.
    try:
        comp.par.opviewer = 'out1'
    except Exception:
        pass
    try:
        comp.viewer = True
    except Exception:
        pass

    # ----- Kick off an initial fetch -----
    try:
        request1.request(str(comp.par.Url.eval()), "GET")
    except Exception as e:
        print('Initial fetch failed:', e)

    return comp


_purge_existing()
_comp = _build()
print('bmrcl_vector built at', _comp.path)
print('Pick origin and destination in the SvelteKit web app — TD polls every Pollsec.')
