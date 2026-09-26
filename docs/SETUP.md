# Puxi — Setup and first run (dev / build from source)

No Max knowledge required. Budget about 15 minutes.

The device loads from your Ableton **User Library**. The two `.js` files there are
**symbolic links** back to this repository (single source of truth); the `.amxd`
(a binary, not under version control) is **regenerated** from the `.maxpat` by
`tools/build-amxd.py`.

## 1. Put the files in place

From the repository root:

```sh
LIB="$HOME/Music/Ableton/User Library/Presets/MIDI Effects/Max MIDI Effect/Puxi"
mkdir -p "$LIB"
ln -sf "$PWD/device/puxi-engine.js" "$LIB/"
ln -sf "$PWD/device/puxi-gui.js"    "$LIB/"
python3 tools/build-amxd.py          # writes "$LIB/Puxi.amxd" from the .maxpat
```

With no arguments, `build-amxd.py` targets that default path and saves the previous
`.amxd` as `Puxi.amxd.prev`. (It also declares the `.js` files as device dependencies —
essential for Max to resolve them reliably when a Set is reopened.)

## 2. Add the device in Live

1. Create a MIDI track.
2. Browser → **User Library** → `Presets/MIDI Effects/Max MIDI Effect/Puxi` → drag
   **Puxi** onto the track. The **8 × 8** grid appears.

(Alternative: start from the default Max MIDI Effect device and paste the contents
of `puxi-shell.maxpat` into it — but step 1 is simpler and reproducible.)

## 3. Add a Drum Rack

1. On the **same track**, drag a **Drum Rack** with a kit (any kit from the Core
   Library) **after** Puxi in the chain.
2. Puxi's rows drive notes starting at **C1 (36)** — Puxi reads the pad names and
   colors from the Drum Rack and shows them on the grid.

## 4. Test (checklist)

| Test | Expected |
|---|---|
| Click on cells | The cell lights up in the pad's color; click again to clear it |
| Drag ↑/↓ on a cell | Sets velocity (brightness) |
| Play in Live | A green playhead sweeps the grid, in time with the tempo |
| Steps lit on the bottom row | The matching Drum Rack pad plays |
| Stop | The playhead disappears |
| Move the play head in the arrangement | The playhead follows (no drift) |
| Loop handles / Loop encoders | The loop region changes |
| Cmd/Ctrl+Z after an edit | The edit is undone (the pattern is a Live parameter) |
| Save and reopen the Set | The pattern is restored |

Push 3 (optional): select the Puxi device and it takes over the pads, arrows, encoders, and buttons.
See **[MANUAL.md](MANUAL.md)**.

## 5. Dev loop

- **Editing a `.js`** (`puxi-engine.js` / `puxi-gui.js`): edit the repository file,
  then **reload the device by hand**: delete it from the track and drag it in again
  (switching it off and on does not reload the code). Note: `autowatch` is **off** —
  there is **no** auto-reload (it broke the v8 cords when a Set was reopened). No
  `build-amxd.py` needed.
- **Editing the `.maxpat`** (adding/removing objects, parameters, or cords): run
  `python3 tools/build-amxd.py`, then reload the device.
- **Syntax-checking a `.js` file** (without Live; no Node): via JavaScriptCore —
  `jsc -e "new Function(read('device/puxi-engine.js'))"`.
- One commit per feature **tested in Live**. Update `CLAUDE.md` **and**
  `docs/MANUAL.md` on every visible behavior change.

## 6. If something doesn't work

- **Blank grid / empty device:** right-click the device → *Open Max Window* and read
  the errors. `v8ui: can't find puxi-gui.js` means the `.js` files are not in the `Puxi`
  folder of the User Library (check the symlinks from step 1).
- **No sound:** the Drum Rack must be **after** Puxi on the **same track**, and steps
  on the bottom row (C1) must be lit.
- **The playhead doesn't move:** Live's transport must be running (Play). The metro
  only ticks during playback, by design.
- **A `.js` edit doesn't take effect** even after a reload: a stray Max project (a frozen
  copy from a *Collect All and Save*) can shadow the symlinks — see `CLAUDE.md`.

## 7. Distribution (frozen device)

To share the device or transfer it to a standalone Push 3: in the device's Max window,
click the **Freeze Device** button (the snowflake in the bottom toolbar), then
**File → Save As** to a **separate** file (never a plain "Save" onto the dev device).
Freezing embeds a copy of the JS; re-freeze on each release. See `CLAUDE.md`, "Dev
device vs. frozen export".
