#!/usr/bin/env python3
"""
build.py - gallery build script

What it does:
  1) Scan images/ tree and generate thumbnails into thumbs/ (incremental)
  2) Write manifest.json
  3) Remove orphan thumbnails (whose source image no longer exists)

Usage:
  pip install Pillow
  python scripts/build.py

Folder layout:
  images/<char>/<folder>/<cat>_<situation>.jpg
    char:      key defined in scripts/config.json (e.g. char1, char2)
    folder:    F, M, common
    cat:       A-L (case-insensitive; normalized to upper)
    situation: 01-40 (two digits)

Character display names live in scripts/config.json (UTF-8 JSON).
This .py file is pure ASCII so it survives any text-editor encoding mishap.
"""
from __future__ import annotations

import json
import re
import sys
import time
from pathlib import Path

# Try to switch stdout to UTF-8 so Korean names print correctly on Windows.
try:
    sys.stdout.reconfigure(encoding="utf-8")
except Exception:
    pass

try:
    from PIL import Image, ImageOps
except ImportError:
    sys.stderr.write("Pillow required.  pip install Pillow\n")
    sys.exit(1)


# ---- paths --------------------------------------------------------------
ROOT = Path(__file__).resolve().parent.parent
IMG_DIR = ROOT / "images"
THUMB_DIR = ROOT / "thumbs"
MANIFEST = ROOT / "manifest.json"
CONFIG_FILE = Path(__file__).resolve().parent / "config.json"

# ---- knobs --------------------------------------------------------------
THUMB_WIDTH = 400        # px, max width for thumbnails (retina-friendly)
THUMB_QUALITY = 78       # JPG quality (1-95); 78 ~= good size/quality balance

FOLDERS = {"F", "M", "common"}
FILENAME_RE = re.compile(r"^([A-La-l])_(\d{2})\.jpg$")


# ---- helpers ------------------------------------------------------------
def safe_print(msg):
    """Print, falling back to ASCII-replace on encoding errors."""
    try:
        print(msg)
    except UnicodeEncodeError:
        print(msg.encode("ascii", "replace").decode("ascii"))


def load_config():
    if not CONFIG_FILE.exists():
        sys.stderr.write("Error: scripts/config.json missing.\n")
        sys.exit(1)
    return json.loads(CONFIG_FILE.read_text(encoding="utf-8"))


def make_thumb(src: Path, dst: Path) -> bool:
    """Return True if a new thumbnail was generated."""
    if dst.exists() and dst.stat().st_mtime >= src.stat().st_mtime:
        return False
    dst.parent.mkdir(parents=True, exist_ok=True)
    with Image.open(src) as im:
        im = ImageOps.exif_transpose(im)  # honor EXIF rotation
        im.thumbnail((THUMB_WIDTH, THUMB_WIDTH * 4), Image.LANCZOS)
        if im.mode != "RGB":
            im = im.convert("RGB")
        im.save(dst, "JPEG", quality=THUMB_QUALITY, optimize=True, progressive=True)
    return True


def scan_images(characters):
    items = []
    skipped = []
    if not IMG_DIR.exists():
        return items, skipped

    for char_dir in sorted(IMG_DIR.iterdir()):
        if not char_dir.is_dir():
            continue
        char = char_dir.name
        if char not in characters:
            safe_print("  [warn] unknown character folder: %s (skip)" % char)
            continue

        for folder_dir in sorted(char_dir.iterdir()):
            if not folder_dir.is_dir():
                continue
            folder = folder_dir.name
            if folder not in FOLDERS:
                safe_print("  [warn] unknown folder: %s/%s (skip)" % (char, folder))
                continue

            for jpg in sorted(folder_dir.iterdir()):
                if not jpg.is_file() or jpg.suffix.lower() != ".jpg":
                    continue
                m = FILENAME_RE.match(jpg.name)
                if not m:
                    skipped.append("%s/%s/%s" % (char, folder, jpg.name))
                    continue
                cat = m.group(1).upper()
                sit = m.group(2)
                rel = "%s/%s/%s_%s" % (char, folder, cat, sit)
                items.append({
                    "id": rel,
                    "char": char,
                    "folder": folder,
                    "cat": cat,
                    "sit": sit,
                    "_src": jpg,  # internal
                })
    return items, skipped


def clean_orphans(expected):
    if not THUMB_DIR.exists():
        return 0
    removed = 0
    for thumb in THUMB_DIR.rglob("*.jpg"):
        if thumb not in expected:
            thumb.unlink()
            removed += 1
    # remove empty dirs, deepest first
    dirs = [p for p in THUMB_DIR.rglob("*") if p.is_dir()]
    dirs.sort(key=lambda p: len(p.parts), reverse=True)
    for d in dirs:
        try:
            if not any(d.iterdir()):
                d.rmdir()
        except OSError:
            pass
    return removed


# ---- main ---------------------------------------------------------------
def main():
    config = load_config()
    characters = config.get("characters", {})
    if not characters:
        sys.stderr.write("Error: no 'characters' in config.json\n")
        return 1

    if not IMG_DIR.exists():
        sys.stderr.write("Error: %s missing.\n" % IMG_DIR)
        sys.stderr.write("Create images/<char>/<F|M|common>/ folders first.\n")
        return 1

    start = time.time()
    safe_print("Scanning: %s" % IMG_DIR)

    items, skipped = scan_images(characters)
    if not items:
        safe_print("[warn] no images to process.")
        return 1

    # generate thumbnails
    new_count = 0
    for it in items:
        src = it.pop("_src")
        dst = THUMB_DIR / ("%s.jpg" % it["id"])
        if make_thumb(src, dst):
            new_count += 1
            if new_count % 50 == 0:
                safe_print("  generated %d thumbnails..." % new_count)

    # clean orphans
    expected = {THUMB_DIR / ("%s.jpg" % it["id"]) for it in items}
    removed = clean_orphans(expected)

    # write manifest
    manifest = {
        "characters": characters,
        "items": items,
        "generated_at": int(time.time()),
    }
    MANIFEST.write_text(
        json.dumps(manifest, ensure_ascii=False, separators=(",", ":")),
        encoding="utf-8",
    )

    # stats
    elapsed = time.time() - start
    by_char = {}
    by_folder = {}
    for it in items:
        by_char[it["char"]] = by_char.get(it["char"], 0) + 1
        key = "%s/%s" % (it["char"], it["folder"])
        by_folder[key] = by_folder.get(key, 0) + 1

    safe_print("")
    safe_print("Done (%.1fs)" % elapsed)
    safe_print("  total: %d images" % len(items))
    for char in sorted(by_char):
        name = characters[char].get("name", char)
        parts = []
        for f in sorted(by_folder):
            if f.startswith(char + "/"):
                parts.append("%s=%d" % (f.split("/")[1], by_folder[f]))
        safe_print("    %s (%s): %d  [%s]" % (char, name, by_char[char], ", ".join(parts)))
    safe_print("  new thumbnails: %d" % new_count)
    if removed:
        safe_print("  orphan thumbnails removed: %d" % removed)
    safe_print("  manifest.json written")

    if skipped:
        safe_print("")
        safe_print("[warn] files not matching A-L_01-40.jpg (skipped):")
        for s in skipped[:10]:
            safe_print("    %s" % s)
        if len(skipped) > 10:
            safe_print("    ... and %d more" % (len(skipped) - 10))

    return 0


if __name__ == "__main__":
    sys.exit(main())