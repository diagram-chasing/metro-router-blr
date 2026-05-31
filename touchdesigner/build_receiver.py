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
#     ├── request1        webclientDAT          — GETs the vector-journey JSON
#     ├── response        textDAT               — last response body (mirrored from request1)
#     ├── status          textDAT               — last parser status (diagnostic)
#     ├── request_cb      textDAT               — onResponse callback for request1
#     ├── param_exec      parameterexecuteDAT   — re-fetches when origin/dest params change
#     ├── geo1            geometryCOMP          — contains parser SOP + cook callback
#     │     ├── parser       scriptSOP          — JSON → polyline with per-point Cd/segid/t
#     │     └── parser_cb    textDAT            — cook callback for parser
#     ├── mat1            lineMAT               — line rendering, uses point colors (Cd)
#     └── cam1, light1, render1, out1           — minimal render chain
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
# and refetches whenever URL changes or Refreshnow is pulsed.
WATCH = {"Url", "Refreshnow"}

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

def onValueChange(par, prev):
    if par.name in WATCH:
        _fetch_now()
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

PARSER_CB = """# Reads JSON from op("../response") and emits a polyline with per-point
# Cd (color), segid (segment index), and t (0..1 progress) attributes.
# Parser lives inside geo1, so paths use ../ and parent(2).
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
    # Diagnostic: bright magenta square in the XY plane, ~10 units across,
    # so we can confirm rendering works even without JSON data.
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
    if not points:
        _status("JSON had no points — drawing test square")
        _emit_test_square(scriptOp)
        return

    seg_colors = [_hex_to_rgb(s.get("lineColor", "#FFFFFF")) for s in segments]
    try:
        scale = float(parent(2).par.Scale.eval())
    except Exception:
        scale = 1000.0
    if scale == 0:
        scale = 1.0

    # Standard attributes (Cd, N, uv, T, v) are created without a default.
    scriptOp.pointAttribs.create("Cd")
    scriptOp.pointAttribs.create("segid", 0)
    scriptOp.pointAttribs.create("t", 0.0)

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
        pt = scriptOp.appendPoint()
        pt.P = (x, y, 0.0)
        seg_idx = int(pt_data.get("seg", 0))
        color = seg_colors[seg_idx] if 0 <= seg_idx < len(seg_colors) else (1.0, 1.0, 1.0)
        pt.Cd = (color[0], color[1], color[2], 1.0)
        pt.segid = seg_idx
        pt.t = float(pt_data.get("t", 0.0))
        pts.append(pt)

    if len(pts) >= 2:
        poly = scriptOp.appendPoly(len(pts), addPoints=False, closed=False)
        for i, vertex in enumerate(poly):
            vertex.point = pts[i]

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
    param_exec.par.pars = 'Url Refreshnow'
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
    parser.display = True
    parser.render = True

    parser_cb = geo.create(textDAT, 'parser_cb')
    parser_cb.nodeX, parser_cb.nodeY = 0, -150
    _set_text(parser_cb, PARSER_CB)
    parser.par.callbacks = parser_cb

    # Debug reference: tiny sphere at origin so you can confirm the render chain
    # works even if `parser` is empty. Delete `ref_sphere` once you see the line.
    ref_sphere = geo.create(sphereSOP, 'ref_sphere')
    ref_sphere.nodeX, ref_sphere.nodeY = 200, 0
    try:
        ref_sphere.par.rad = 0.5
    except Exception:
        try:
            ref_sphere.par.radx = 0.5
            ref_sphere.par.rady = 0.5
            ref_sphere.par.radz = 0.5
        except Exception:
            pass
    ref_sphere.display = True
    ref_sphere.render = True

    geo.par.display = True
    geo.par.render = True

    # ----- Material: Line MAT renders polylines with explicit pixel width -----
    mat = comp.create(lineMAT, 'mat1')
    mat.nodeX, mat.nodeY = 200, -200
    try:
        mat.par.linewidth = 4.0
    except Exception:
        pass
    try:
        mat.par.usepointcolor = True
    except Exception:
        pass
    try:
        geo.par.material = mat
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
