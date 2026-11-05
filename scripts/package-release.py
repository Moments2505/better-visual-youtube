"""Build a whitelist-only distributable; fail before writing invalid packages."""
import argparse
import hashlib
import json
import pathlib
import zipfile

root = pathlib.Path(__file__).resolve().parents[1]
parser = argparse.ArgumentParser(description=__doc__)
parser.add_argument("--output-dir", type=pathlib.Path, default=root.parent)
args = parser.parse_args()
manifest = json.loads((root / "manifest.json").read_text(encoding="utf-8"))
assert len(manifest["description"]) <= 132, "Manifest description exceeds 132 characters"
assert manifest["permissions"] == ["storage"]
assert manifest["host_permissions"] == ["https://www.youtube.com/*"]
files = [root / name for name in ("manifest.json", "LICENSE", "README.md", "INSTALL-EN.md", "INSTALL-VI.md", "default-settings.json", "THIRD-PARTY-NOTICES.md", "CONTRIBUTING.md", "docs/PRIVACY-EN.md", "docs/PRIVACY-VI.md")]
for folder in ("assets", "src", "vendor"):
    files.extend(p for p in (root / folder).rglob("*") if p.is_file())
names = {p.relative_to(root).as_posix() for p in files}
for name in names:
    assert all(not part.startswith("_") or part == "_locales" for part in name.split("/")), name
    assert not name.endswith((".map", ".log")), "Unneeded debug artifact: " + name
required = [manifest["action"]["default_popup"], *manifest["icons"].values()]
for entry in manifest["content_scripts"]:
    required += entry["js"] + entry["css"]
assert all(name in names for name in required), "Missing runtime dependency"
assert "vendor/ambient/LICENSE" in names
args.output_dir.mkdir(parents=True, exist_ok=True)
target = args.output_dir / ("Better-visual-Youtube-" + manifest["version"] + ".zip")
with zipfile.ZipFile(target, "w", zipfile.ZIP_DEFLATED) as archive:
    for source in sorted(files):
        archive.write(source, source.relative_to(root).as_posix())
with zipfile.ZipFile(target) as archive:
    assert archive.testzip() is None
    assert all(archive.read(name) == (root / name).read_bytes() for name in names)
checksum = hashlib.sha256(target.read_bytes()).hexdigest()
target.with_suffix(".zip.sha256").write_text(checksum + "  " + target.name + "\n", encoding="utf-8")
print(json.dumps({"zip": str(target), "files": len(names), "sha256": checksum, "descriptionLength": len(manifest["description"])}, indent=2))
