#!/usr/bin/env python3
# SPDX-License-Identifier: GPL-3.0-only
# Copyright (C) 2026 mefecit <pest-kernels-6r@icloud.com>
"""
build-amxd.py - regenerate the Puxi.amxd Max for Live device from source.

The .amxd is a binary artifact (not tracked by git). The source of truth is
device/puxi-shell.maxpat (the patcher) plus the .js files. This script grafts
the patcher into the M4L .amxd container (ampf/ptch) so Live loads the current
patch.

Run it whenever you change puxi-shell.maxpat (add/remove objects or cords).
For .js-only changes you do NOT need this - the .js files in the library are symlinked to
the repo, so Live already reads the current code.

Usage:
    python3 tools/build-amxd.py [path/to/Puxi.amxd]

With no argument it targets the device in the Live User Library. The previous
.amxd is saved next to it as Puxi.amxd.prev before overwriting.
"""

import copy
import json
import os
import struct
import sys
import shutil

HERE = os.path.dirname(os.path.abspath(__file__))
REPO = os.path.dirname(HERE)
MAXPAT = os.path.join(REPO, "device", "puxi-shell.maxpat")

DEFAULT_AMXD = os.path.expanduser(
    "~/Music/Ableton/User Library/Presets/MIDI Effects/Max MIDI Effect/Puxi/Puxi.amxd"
)

# ampf container header for an M4L MIDI Effect, up to (not incl.) the ptch size.
# (ampf, format version 4; meta chunk = device type 1 = MIDI effect; then 'ptch')
# Used only when there is no existing .amxd to copy the exact header from.
DEFAULT_HEADER = (
    b"ampf" + struct.pack("<I", 4)
    + b"mmmmmeta" + struct.pack("<I", 4) + struct.pack("<I", 1)
    + b"ptch"
)

# Minimal M4L device-level keys, used only as a fallback (fresh checkout with no
# .amxd). When an .amxd already exists we copy these from it instead, which also
# preserves the dependency 'project' block Max maintains.
DEFAULT_DEVICE_KEYS = {
    "appversion": {"major": 9, "minor": 0, "revision": 8,
                   "architecture": "x64", "modernui": 1},
    "title": "Max MIDI Effect",
    "latency": 0,
    "is_mpe": 0,
    "external_mpe_tuning_enabled": 0,
    "minimum_live_version": "",
    "minimum_max_version": "",
    "platform_compatibility": 0,
}
DEVICE_KEYS = list(DEFAULT_DEVICE_KEYS) + ["project"]


def read_patcher(amxd_bytes):
    """Decode the patcher JSON out of an .amxd's ptch chunk."""
    idx = amxd_bytes.index(b"{")
    patcher = json.JSONDecoder().raw_decode(
        amxd_bytes[idx:].decode("utf-8", "replace"))[0]["patcher"]
    return idx, patcher


def presentation_bbox(patcher):
    """Bounding box (l, t, r, b) of every object in presentation mode."""
    xs, ys = [], []
    for b in patcher.get("boxes", []):
        box = b["box"]
        if box.get("presentation"):
            r = box.get("presentation_rect") or box.get("patching_rect")
            if r:
                xs += [r[0], r[0] + r[2]]
                ys += [r[1], r[1] + r[3]]
    if not xs:
        return (0.0, 0.0, 320.0, 160.0)
    return (min(xs), min(ys), max(xs), max(ys))


def build(amxd_path):
    if not os.path.exists(MAXPAT):
        sys.exit("ERROR: source patcher not found: " + MAXPAT)
    patcher = copy.deepcopy(json.load(open(MAXPAT))["patcher"])

    # Prefer the exact container header + device-level keys from an existing
    # .amxd; fall back to the embedded defaults on a fresh checkout.
    header = DEFAULT_HEADER
    devkeys = dict(DEFAULT_DEVICE_KEYS)
    if os.path.exists(amxd_path):
        data = open(amxd_path, "rb").read()
        idx, tmpl = read_patcher(data)
        header = data[:idx - 4]
        for k in DEVICE_KEYS:
            if k in tmpl:
                devkeys[k] = tmpl[k]
    patcher.update(devkeys)

    # Declare the .js files as device dependencies. Without this, Max only resolves the
    # scripts by a best-effort folder/search-path scan, which loses a load-order
    # race when a saved Set is reopened -> "can't find file puxi-engine.js" -> the v8
    # never loads -> its outlets default low -> Max deletes the GUI/param cords
    # ("outlet out of range") -> blank GUI + dead params. A populated
    # dependency_cache pins each script's location so Max resolves it directly,
    # and lets a later Freeze (the snowflake button in Max) actually embed them (an undeclared dep embeds
    # nothing -> a ~14KB "frozen" file that still can't find its .js). Format
    # mirrors factory JS devices (Philip Meyer's MIDI Tools): one entry per script,
    # bootpath = the device's own folder in ~ notation.
    dep_dir = os.path.dirname(os.path.abspath(amxd_path))
    home = os.path.expanduser("~")
    boot = "~" + dep_dir[len(home):] if dep_dir.startswith(home) else dep_dir
    scripts = []
    for b in patcher.get("boxes", []):
        bx = b["box"]
        fn = bx.get("filename")           # v8ui carries its script as 'filename'
        if not fn:                         # v8/js objects carry it in the text: "v8 foo.js"
            for tok in (bx.get("text") or "").split():
                if tok.endswith(".js"):
                    fn = tok
                    break
        if fn and fn.endswith(".js") and fn not in scripts:
            scripts.append(fn)
    patcher["dependency_cache"] = [
        {"name": fn, "bootpath": boot, "type": "TEXT", "implicit": 1}
        for fn in scripts
    ]

    # M4L display. Width comes from the presentation bounding box; height is
    # capped at ~168px by Live (taller content scrolls), so it's informational.
    _, _, right, bottom = presentation_bbox(patcher)
    devw = float(round(right + 8))
    devh = float(round(bottom + 16))
    patcher["openinpresentation"] = 1
    patcher["devicewidth"] = devw
    patcher["enablehscroll"] = 1
    patcher["enablevscroll"] = 1
    patcher["rect"] = [245.0, 519.0, devw, devh]
    patcher["openrect"] = [0.0, 0.0, devw, devh]

    body = (json.dumps({"patcher": patcher}, ensure_ascii=False, indent=1)
            + "\n").encode("utf-8")
    blob = header + struct.pack("<I", len(body)) + body

    if os.path.exists(amxd_path):
        shutil.copy2(amxd_path, amxd_path + ".prev")
    os.makedirs(os.path.dirname(amxd_path), exist_ok=True)
    with open(amxd_path, "wb") as f:
        f.write(blob)

    # Verify by parsing the result back.
    _, p = read_patcher(open(amxd_path, "rb").read())
    objs = [bx["box"].get("text") or bx["box"].get("filename")
            for bx in p["boxes"] if bx["box"].get("maxclass") in ("newobj", "v8ui")]
    v8 = next(bx["box"] for bx in p["boxes"]
              if bx["box"].get("maxclass") == "v8ui")
    home = os.path.expanduser("~")
    print("built:", amxd_path.replace(home, "~"))
    print("  bytes: %d | boxes: %d | lines: %d"
          % (len(blob), len(p["boxes"]), len(p["lines"])))
    print("  devicewidth: %g | v8ui height: %g px"
          % (p["devicewidth"], v8["presentation_rect"][3]))
    print("  objects:", objs)
    print("  deps:", [(d["name"], d["bootpath"]) for d in p.get("dependency_cache", [])])
    print("Reload the device in Live to pick it up.")


if __name__ == "__main__":
    build(sys.argv[1] if len(sys.argv) > 1 else DEFAULT_AMXD)
