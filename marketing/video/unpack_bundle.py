"""Unpack Granola_v2_Standalone bundle into editable files.

Parses the bundled HTML, extracts each asset (gzip-decoded if needed),
saves them to Granola_v2_edit/assets/ with human-readable names,
rewrites the template to reference those files via relative paths,
splits the inline JS out into granola.js, and writes index.html.
"""
from __future__ import annotations

import base64
import gzip
import json
import re
from pathlib import Path

ROOT = Path(__file__).parent
SRC = ROOT / "Granola_v2.html"
OUT = ROOT / "Granola_v2_edit"
ASSETS = OUT / "assets"
OUT.mkdir(parents=True, exist_ok=True)
ASSETS.mkdir(parents=True, exist_ok=True)

raw = SRC.read_text(encoding="utf-8")

def extract(tag_type: str) -> str:
    m = re.search(
        rf'<script type="{re.escape(tag_type)}">\s*(.*?)\s*</script>',
        raw, re.DOTALL,
    )
    if not m:
        raise RuntimeError(f"missing script type={tag_type}")
    return m.group(1)

manifest = json.loads(extract("__bundler/manifest"))
template_str = json.loads(extract("__bundler/template"))  # JSON string
try:
    ext_res = json.loads(extract("__bundler/ext_resources"))
except RuntimeError:
    ext_res = []

# Reference table: mime + approximate byte length → file we already have on disk
# (we match by mime + size; fall back to UUID-based filename otherwise).
DISK_PATHS = {
    "prints": ROOT / "claude_design_package" / "prints",
    "clips": ROOT / "claude_design_package" / "clips",
    "fonts": ROOT / "claude_design_package" / "fonts",
    "recortes": ROOT / "recortes_funcionalidades",
    "cortados": ROOT,  # picks up kanban_cortado.mp4, financeiro_cortado.mp4 etc
}

import hashlib

known_by_hash: dict[str, Path] = {}
for cat, base in DISK_PATHS.items():
    if not base.exists():
        continue
    for p in base.iterdir():
        if not p.is_file():
            continue
        h = hashlib.sha1(p.read_bytes()).hexdigest()
        # keep the first match so deterministic if duplicates exist on disk
        known_by_hash.setdefault(h, p)

EXT_BY_MIME = {
    "image/png": ".png",
    "image/jpeg": ".jpg",
    "video/mp4": ".mp4",
    "video/webm": ".webm",
    "font/ttf": ".ttf",
    "font/otf": ".otf",
    "font/woff": ".woff",
    "font/woff2": ".woff2",
    "application/javascript": ".js",
    "text/javascript": ".js",
    "text/css": ".css",
}

uuid_to_relpath: dict[str, str] = {}
summary: list[tuple[str, str, str, int]] = []

for uuid, entry in manifest.items():
    data_b64 = entry["data"]
    mime = entry.get("mime", "application/octet-stream")
    compressed = entry.get("compressed", False)
    raw_bytes = base64.b64decode(data_b64)
    if compressed:
        raw_bytes = gzip.decompress(raw_bytes)

    # Try to match an existing on-disk file by content hash (SHA1)
    digest = hashlib.sha1(raw_bytes).hexdigest()
    known = known_by_hash.get(digest)
    if known is not None:
        # reuse existing pretty name
        rel = f"assets/{known.name}"
        (ASSETS / known.name).write_bytes(raw_bytes)
    else:
        ext = EXT_BY_MIME.get(mime, ".bin")
        name = f"{uuid}{ext}"
        rel = f"assets/{name}"
        (ASSETS / name).write_bytes(raw_bytes)

    uuid_to_relpath[uuid] = rel
    summary.append((uuid, mime, rel, len(raw_bytes)))

# Rewrite template: replace blob placeholder (which is the raw uuid itself in the
# bundler's runtime.split(uuid).join(blobUrl) pass) with the relative path.
template_resolved = template_str
for uuid, rel in uuid_to_relpath.items():
    template_resolved = template_resolved.replace(uuid, rel)

# Extract the JS asset (it's loaded via <script src="assets/xxx.js"></script>).
# Split it into its own file with a stable name (granola.js) and rewire.
js_script_match = re.search(
    r'<script[^>]*\bsrc="(assets/[^"]+\.js)"[^>]*></script>',
    template_resolved,
)
if js_script_match:
    js_rel = js_script_match.group(1)
    js_abs = OUT / js_rel
    js_bytes = js_abs.read_bytes()
    # Move to friendly name
    (OUT / "granola.js").write_bytes(js_bytes)
    js_abs.unlink()
    template_resolved = template_resolved.replace(js_rel, "granola.js")

# Inject the ext_resources map inline, the same way the bundler runtime does.
resources_map_js = {}
for entry in ext_res:
    resources_map_js[entry["id"]] = uuid_to_relpath.get(entry["uuid"], entry["uuid"])
inject_script = (
    "<script>window.__resources = "
    + json.dumps(resources_map_js)
    + ";</script>"
)
template_resolved = re.sub(
    r"(<head[^>]*>)",
    r"\1" + inject_script,
    template_resolved,
    count=1,
)

(OUT / "index.html").write_text(template_resolved, encoding="utf-8")

# Summary
import sys
sys.stdout.reconfigure(encoding="utf-8")
print(f"Unpacked {len(manifest)} assets -> {ASSETS}")
print(f"HTML  -> {OUT/'index.html'}  ({len(template_resolved)} bytes)")
print(f"JS    -> {OUT/'granola.js'}  ({(OUT/'granola.js').stat().st_size} bytes)")
print()
print("Asset map:")
for uuid, mime, rel, size in sorted(summary, key=lambda r: r[2]):
    print(f"  {rel:<50} {mime:<20} {size:>10} bytes  [{uuid[:8]}]")
