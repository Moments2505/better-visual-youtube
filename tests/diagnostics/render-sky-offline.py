"""Render production shader equations with standalone OpenGL, NOT a browser.
Only the GLSL dialect is adapted for OpenGL 3.3. No browser connection or UI.
Run with ModernGL 5.13.0, glcontext 3.1.0, Pillow 12.3.0. Produces preview stills
and records compile/render status; this cannot validate Edge/ANGLE or hover FPS.
"""
import json
import math
import pathlib
import re
import struct
import sys
import statistics
import moderngl
from PIL import Image

root = pathlib.Path(__file__).resolve().parents[2]
text = (root / "src/content/sky-renderer.js").read_text(encoding="utf-8")
fragment = re.search(r"var fragment = `(.*?)`;", text, re.S).group(1)
fragment = "#version 330\nout vec4 out_color;\n" + fragment.replace("precision highp float;", "").replace("gl_FragColor", "out_color")
ctx = moderngl.create_context(standalone=True, require=330)
program = ctx.program(vertex_shader="#version 330\nin vec2 p;void main(){gl_Position=vec4(p,0.,1.);}", fragment_shader=fragment)
buffer = ctx.buffer(struct.pack("6f", -1, -1, 3, -1, -1, 3))
vao = ctx.simple_vertex_array(program, buffer, "p")
fbo = ctx.simple_framebuffer((960, 540), components=4)
fbo.use()
previews = []
timings = {}
for scene, elevation, angle in [("night", -30, 140), ("dawn", -2, -85), ("morning", 15, -65), ("day", 60, 0), ("sunset", 2, 80)]:
    values = {"size": (960, 540), "sun": (max(.05, min(.95, .5+angle/180*.7)), 1-max(.1,min(.85,.82-max(0,elevation)/90*.72))),
        "daylight": max(0,min(1,(elevation+6)/18)), "warmth":max(0,1-abs(elevation-1)/13),
        "night":1-max(0,min(1,(elevation+12)/12)), "clouds":.65, "seconds":0, "wet":0}
    for name, value in values.items():
        program[name].value = value
    vao.render(moderngl.TRIANGLES)
    ctx.finish()
    image = Image.frombytes("RGBA", fbo.size, fbo.read(components=4)).transpose(Image.Transpose.FLIP_TOP_BOTTOM)
    target = root / "dist" / ("procedural-sky-"+scene+"-0.4.62.png")
    image.save(target)
    previews.append(str(target))
    samples=[]
    for i in range(33):
        query=ctx.query(time=True)
        with query:
            vao.render(moderngl.TRIANGLES)
        ctx.finish()
        elapsed=query.elapsed/1_000_000
        if i>=3:samples.append(elapsed)
    timings[scene]={"samples":len(samples),"medianGpuMs":round(statistics.median(samples),3),"maxGpuMs":round(max(samples),3)}
report={"method":"standalone OpenGL 3.3, production equations adapted from GLSL ES 1.00; not Edge/ANGLE", "moderngl":moderngl.__version__,
    "python":sys.version,"vendor":ctx.info.get("GL_VENDOR"),"renderer":ctx.info.get("GL_RENDERER"),"glVersion":ctx.info.get("GL_VERSION"),
    "compile":"passed","pixels":[960,540],"previewStills":previews,"standaloneShaderGpuTimings":timings,
    "timingLimits":"Single shader offscreen, warm cache, no browser/video/compositor. Not FPS or hover latency."}
(root/"dist/sky-offline-render-report.json").write_text(json.dumps(report,indent=2),encoding="utf-8")
print(json.dumps(report,indent=2))
vao.release();buffer.release();program.release();fbo.release();ctx.release()
