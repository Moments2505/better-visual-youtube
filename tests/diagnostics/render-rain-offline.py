"""Render the production rain shader in standalone OpenGL, never a browser.

Run: python tests/diagnostics/render-rain-offline.py
Requires ModernGL and Pillow. GLSL ES 1.00 is adapted only to GLSL 3.30 syntax.
Images show the shader alone, without YouTube, CSS rain or the compositor.
"""
import hashlib
import json
import pathlib
import re
import struct
import sys

import moderngl
from PIL import Image, ImageChops, ImageStat


root = pathlib.Path(__file__).resolve().parents[2]
source = (root / "src/content/sky-renderer.js").read_text(encoding="utf-8")
fragment = re.search(r"var fragment = `(.*?)`;", source, re.S).group(1)
fragment = "#version 330\nout vec4 out_color;\n" + fragment.replace("precision highp float;", "").replace("gl_FragColor", "out_color")
ctx = moderngl.create_context(standalone=True, require=330)
program = ctx.program(vertex_shader="#version 330\nin vec2 p;void main(){gl_Position=vec4(p,0.,1.);}", fragment_shader=fragment)
buffer = ctx.buffer(struct.pack("6f", -1, -1, 3, -1, -1, 3))
vao = ctx.simple_vertex_array(program, buffer, "p")
fbo = ctx.simple_framebuffer((960, 540), components=4)
fbo.use()


def render(daylight, rain, seconds):
    values = {"size": (960, 540), "sun": (.5, .66), "daylight": daylight,
              "warmth": 0., "night": 1. - daylight, "clouds": .96 if rain else .24,
              "seconds": seconds, "wet": float(rain), "rain": float(rain)}
    for name, value in values.items():
        program[name].value = value
    vao.render(moderngl.TRIANGLES)
    ctx.finish()
    return Image.frombytes("RGBA", fbo.size, fbo.read(components=4)).transpose(Image.Transpose.FLIP_TOP_BOTTOM)


cases = [("rain-glass-day-t0", 1., True, 0.), ("rain-glass-day-t8", 1., True, 8.),
         ("rain-glass-night-t8", 0., True, 8.), ("rain-glass-dry-day", 1., False, 0.)]
images, previews = {}, []
for name, daylight, raining, seconds in cases:
    image = render(daylight, raining, seconds)
    target = root / "dist" / (name + "-standalone.png")
    target.parent.mkdir(exist_ok=True)
    image.save(target)
    images[name] = image
    previews.append(str(target))

repeat = render(1., True, 0.)
repeat_matches = repeat.tobytes() == images["rain-glass-day-t0"].tobytes()
rain_luma = ImageStat.Stat(images["rain-glass-day-t0"].convert("L")).mean[0]
dry_luma = ImageStat.Stat(images["rain-glass-dry-day"].convert("L")).mean[0]
time_delta = ImageStat.Stat(ImageChops.difference(images["rain-glass-day-t0"].convert("RGB"), images["rain-glass-day-t8"].convert("RGB"))).mean
checks = {"fixedTimeRepeatIdentical": repeat_matches,
          "rainDayDarkerThanDryDay": rain_luma < dry_luma,
          "rainFrameChangesWithSeconds": sum(time_delta) > 0}
if not all(checks.values()):
    raise AssertionError(checks)
report = {"method": "standalone OpenGL 3.3; production GLSL ES shader with syntax adaptation; no browser",
          "scope": "shader compile and still-image inspection; excludes Edge/ANGLE, CSS rain, video, hover and FPS",
          "python": sys.version, "moderngl": moderngl.__version__, "renderer": ctx.info.get("GL_RENDERER"),
          "glVersion": ctx.info.get("GL_VERSION"), "shaderSha256": hashlib.sha256(source.encode()).hexdigest(),
          "compile": "passed", "pixels": [960, 540], "checks": checks,
          "rainMeanLuma": rain_luma, "dryMeanLuma": dry_luma, "timeDeltaMeanRGB": time_delta, "previewStills": previews}
report_path = root / "dist" / "rain-glass-standalone-report.json"
report_path.write_text(json.dumps(report, indent=2), encoding="utf-8")
print(json.dumps(report, indent=2))
vao.release()
buffer.release()
program.release()
fbo.release()
ctx.release()
