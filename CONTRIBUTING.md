# Contributing to Puxi

Thanks for your interest! Puxi is a Max for Live device — a small, focused
codebase where almost everything lives in plain JavaScript. This guide covers how
it's built and the conventions to follow.

By contributing you agree that your contributions are licensed under the project's
**GPL-3.0** license (see [LICENSE](LICENSE)).

## Architecture

The guiding decision: **a minimal Max patch + all the logic in JavaScript.**

- `device/puxi-shell.maxpat` — the patch shell: clock (`metro 16n`), MIDI I/O,
  `live.thisdevice`, the exposed Live parameters, and a pattern-persistence
  sub-patcher. ~40 objects; we only add a Max object when JS genuinely can't do the
  job (audio-rate timing, MIDI/CS I/O, native `live.*` UI).
- `device/puxi-engine.js` — the `v8` engine: pattern state, step logic, the Live
  API (`LiveAPI`), Push control-surface integration, persistence.
- `device/puxi-gui.js` — the `v8ui` GUI: the 8×8 grid rendering and mouse
  interaction (`mgraphics`).

The `.maxpat` + `.js` are the **source of truth**. The compiled `.amxd` is a binary
artifact and is **not** committed (`.gitignore`); it's rebuilt locally with
`python3 tools/build-amxd.py`.

`CLAUDE.md` is the deep design log: every non-obvious M4L pitfall,
Push-integration recipe, and message protocol is documented there — read it before
touching the engine.

## Getting set up

See **[docs/SETUP.md](docs/SETUP.md)** — symlink the `.js` files into your
Ableton User Library, build the `.amxd`, add the device in Live.

## Dev loop

- **`.js`-only change** → edit the file, then **reload the device by hand**: delete it
  from the track and drag it in again (switching it off and on does not reload the
  code). `autowatch` is intentionally **off** (auto-reload broke the v8 cords when a Set
  was reopened). No rebuild needed.
- **`.maxpat` change** (objects, params, cords) → run `python3 tools/build-amxd.py`,
  then reload the device.
- **Syntax-check the `.js` files** without Live (no Node): via JavaScriptCore —
  `jsc -e "new Function(read('device/puxi-engine.js'))"`.

## Conventions

- **English throughout** — code, comments, and docs (`CLAUDE.md`, `docs/MANUAL.md`,
  `docs/SETUP.md`).
- **Conservative JS** compatible with `v8`/`v8ui` **without transpilation**: `var`,
  named functions, no arrow-heavy/ESM syntax that the engine can't parse. Match the
  style of the surrounding code.
- **One commit per feature, tested in Live.** There is no automated test harness —
  Puxi is validated by ear/eye in Live (and on Push 3 when relevant). Describe how
  you tested.
- When a change alters visible behavior, update **both** `CLAUDE.md` (design log)
  **and** `docs/MANUAL.md` (user manual) in the same change.
- For each feature, aim for **Live first, then Push** parity where it makes sense.
- Never commit a frozen `.amxd`, personal files, or `_attic/`.

## Pull requests

1. Branch off `main`.
2. Keep the PR focused (one feature/fix).
3. In the description, say **what** changed and **how you tested it in Live** (and on
   Push 3 if applicable).
4. Update the docs (`CLAUDE.md` + `MANUAL.md`) alongside the code.
