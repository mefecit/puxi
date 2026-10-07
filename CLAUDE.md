# Puxi — CLAUDE.md

Project memory for Claude Code. Read before making any change.

## The project

Puxi is an 8-track drum step sequencer in Max for Live (M4L), inspired by the OXI
One's multi-track view. Target: Ableton Live 12 + Push 3. It will be open source.

Assume the reader has **no Max/MSP experience**: every Max-side explanation must
start from scratch. Ableton-side knowledge can be assumed (clips, scenes, racks and
MIDI mapping need no introduction).

## Architecture decision (do not reopen without a strong reason)

**Minimal patch shell + all the logic in JavaScript.**

- `device/puxi-shell.maxpat` — about 40 objects (37 at the top level + the 4 inside
  the `[p pstate]` sub-patcher, comments not counted). The core is about 10:
  `midiin/midiout`, `live.thisdevice`, `metro 16n @quantize 16n @active 1`, `v8`,
  `[route note gui param]`, `makenote`, `noteout`, `v8ui` (+ the `init`/`tick`
  messages). The rest is plumbing: the 8 exposed Live params (`live.toggle`/
  `live.numbox`, each with its `prepend` pair) behind one `route`, and the `[p pstate]`
  persistence sub-patcher. Add a Max object only when JS can't do the job (audio-rate
  timing, MIDI I/O, native `live.*` UI).
- `device/puxi-engine.js` — the `[v8]` object: pattern state, step logic, the Live
  API (LiveAPI), GUI communication.
- `device/puxi-gui.js` — the `[v8ui]` object: mgraphics rendering of the 8×8 grid,
  mouse interaction.
- Reference architecture that validates this pattern: Producer Pal
  (github.com/adamjmurray/producer-pal), an open-source M4L device built with
  Claude Code (v8 + Node for Max).

Why: the project is about 80% algorithmic logic (probability, polyrhythm,
ratcheting) and 20% Max plumbing. JS is versionable, testable, and diffable —
visual patching is not.

## Hard constraints (from the feasibility report — do not re-verify)

- **Push 3 display: not customizable.** No design may depend on it.
- **Control-surface Python scripts: not editable on Push 3.** Dead end.
- Push 3 integration = the control-surface API (`grab_control` / `send_value`).
  **Validated on hardware** (tethered **and** standalone): pads + LEDs + playhead,
  arrows, encoders, display, buttons — see the Push 3 integration section.
- The "Ableton Knowledge" connector (claude.ai) indexes the Live/Push manuals but
  **not** the Max programming docs — use cycling74.com/docs for those.
- **Groove: a groove's shape is NOT exposed by the API** (verified against LOM 12.1,
  2026-07-03). `Song.groove_amount` (float 0..1, observable) and
  `Song.groove_pool.grooves` → `Groove` {`name`, `base` 1/4..1/32, `timing_amount`,
  `velocity_amount`, `random_amount`, `quantization_amount`} are readable, but
  **never the step-by-step shape** (the `.agr` offsets). Moreover a groove applies
  **only to clips**, not to a device's live MIDI output. → reproducing an exact
  groove live is a **dead end**; you can only follow the **amount** (see the
  Groove/swing section). The real groove would only apply to an **exported clip**
  (clip→groove assignment not yet verified).

## Known M4L pitfalls

- ⚠️ **Declare state arrays BEFORE the top-level `initPattern()` call** (bug hit
  2026-07-03). `initPattern()` runs on load (line ~140) to populate `pattern`,
  `plock`, and so on. If a `var plock = [];` is declared **after** that call, its
  `= []` initializer runs on load **after** `initPattern` and **overwrites** the
  populated array → `plock[r]` becomes `undefined` → everything touching it breaks
  (note entry, `tick`, `serialize`). Fix: put the `var xxx = []` state declarations
  with the others (before the `initPattern()` call).
- `LiveAPI` is only reliable after `live.thisdevice` bangs → always initialize via
  the `init` message, never in the script body or `loadbang`.
- A `metro` with a musical time value (`16n`) only runs while the transport plays,
  and `@quantize 16n` aligns the bangs to the grid → derive the current step from
  `current_song_time` (never a local counter: loops/jumps break it).
- `v8`/`v8ui` require Max 8.6+ (bundled with Live 12). Do not use `js`/`jsui`
  (obsolete ES5 engine).
- `autowatch` is **0** (engine + GUI). `autowatch = 1` reloads the `.js` when a
  **Set is reopened** → during that reload the v8's outlets vanish for a fraction of a
  second → Max **deletes the cords** (`patchcord outlet out of range`) → blank GUI +
  dead params. So it's off: reload the device **by hand** (remove/re-add) after a
  `.js` edit in dev.
- ✅ **Set-reopen bug — RESOLVED (Save/Save As)** by three combined fixes
  (diagnosed 2026-06-21):
  1. **Declare the `.js` as dependencies** (`dependency_cache` populated by
     `build-amxd.py`: `{name, bootpath=<device folder, ~>, type "TEXT", implicit 1}`,
     the format of P. Meyer's MIDI Tools). Without it Max resolves the scripts by
     guesswork (folder/search-path scan) and **loses the race** on reopen → `can't
     find file puxi-engine.js` → the v8 doesn't load → cords deleted. **This was the
     root cause** (an unfrozen `.amxd` only holds **references by name**).
  2. **Engine with a single outlet** + `[route note gui param]` downstream. A v8's
     outlet count is set by the script, but on reload Max restores the cords
     **before** running the script → any cord to an outlet > 0 is "out of range" and
     **deleted** (proof: the v8ui with one outlet kept its cord). With one outlet
     (the default) the lone cord always survives.
  3. **Auto-init** (`selfInit` + `inited` guard): if the script loads **after** the
     `init` bang (message lost → `no function init`), it probes `this_device` and
     initializes itself; the `init` message covers the normal case, `inited` makes
     the setup idempotent.
  ⚠️ **Remaining: "Collect All and Save"** (the mode that **bundles external files**
  into the project) **still breaks the unfrozen DEV device** (double instantiation:
  `no function …` ×2, GUI not reloaded). Normal Save/Save As work. Workaround: in dev
  use **Save**; for a portable/shared project, the **frozen device** is
  self-contained (and collect-safe). Not yet investigated.
- Before distribution: freeze the device in Max (the snowflake **Freeze Device** button in the
  bottom toolbar of the device's Max window) to embed the .js into the .amxd (see the
  dev vs. frozen-export section — **never** "Save" a freeze onto the dev device).
- File paths: keep the .amxd and .js **in the same folder** during dev.

## Push 3 integration (control-surface API — validated: arrows, pads, encoders, screen)

**Standalone: VALIDATED (2026-06-17).** The control-surface API (`control_surfaces`,
`grab_control`, `send_value`, `value` observers) **also works on a standalone Push 3**
(no computer) — despite doubts raised on the forums. Tested on hardware: pads (play + LEDs +
playhead), arrows (nav + LEDs), encoders + screen (Follow/Start/End, ON label,
detents), Follow button, Accent — **everything works**. Conditions: (1) Puxi uses
only **native v8 objects** (no externals/Node/RNBO) → compatible; (2) the device must
be **transferred to Push** (Live's Wi-Fi transfer, or a frozen device in the User
Library — the dev setup's symlinked `.js` files don't carry over). No Max console in standalone → you
diagnose from behavior (LEDs/pads/params on the screen). The `control_surfaces`
index stays **1**, same as when tethered.

Discovered/tested on the dev machine. Recipe for the arrows (also applies to the pads):

- Push 3 is a **control surface**: `new LiveAPI("control_surfaces N")`. On the dev machine, **N = 1**
  (the real Push = `RemoteControlSurfaceWrapper`; index 0 is a ghost
  `LocalControlSurfaceWrapper` profile — a Push 1 script surface, see the Push 2 bullet). `findPushSurface()` finds it by a
  **Jogwheel** plus the core Push controls (the index can change; the ghost has no Jogwheel).
- **Push 2 (v1.0.1, 2026-10-07; confirmed working on a Push 2 by a user, pre-release
  `push2-test-1`).** A Push 2 user reported "Push not found": Push 2 has no Jogwheel. Its script names every control Puxi drives exactly like Push 3
  (both build on Ableton's shared `pushbase`: `Button_Matrix`, `Scene_Launch_Button0..7` with 0 =
  bottom, `Track_State/Select_Button0..7`, `Track_Control_N`, `Octave_Up/Down_Button`,
  `Page_Left/Right_Button`, `Convert`, … — checked against the decompiled Live 12 scripts), and its
  pad palette uses the same scheme (`Push2/colors.py`: 122 white, 124 dark gray, 125 blue, 126
  green, 127 red, shades of base color c at `(c−1)·2 + 64 + 1|2` — which is where the `VEL_LADDER`
  values sit). So `findPushSurface()` now returns `{index, model}`: a surface with a Jogwheel **and** the core
  Push controls = Push 3 (preferred; `isPush3` — the original Arturia KeyLab Essential script
  names an encoder `Jogwheel` too); otherwise a surface with all of `PUSH2_CONTROLS` = Push 2. That list includes
  `Convert` + `Page_Left/Right_Button` on purpose: the dev machine's ghost at index 0 turned out to
  be a **Push 1** script surface (its report: `Display_Line_0..3`, `In_Button`/`Out_Button`, touch
  strip, no Convert/Page; present in some states with the Push 3 off, absent in others) and a
  looser check bound to it. Push 1 = a different fixed palette + no Convert → not supported (would
  need its own color table, checked on hardware). **Push 2 screen rows stay native**: its script
  repaints both rows in device mode (TrackList on `Track_Select_Button*`, DeviceNavigation on
  `Track_State_Button*`), so the Follow and block indicators would go stale → `updateFollowLed` is
  skipped and `updateBlockLeds` paints only while Duplicate/Delete hold the row grabbed.
- **Rebuilt surfaces / reconnect (`pushWatch`, v1.0.1).** ⚠️ Live **rebuilds** a
  control surface mid-session (seen on hardware when the Push 3 was turned on: every held control
  id became foreign to the surface → `Invalid arguments: 'release_control <ButtonElement …>'`, and
  Puxi stayed dead until reloaded; a Push power-cycle or sleep/wake can do the same). Why (Live's
  Max bridge, decompiled `_MxDCore/MxDCore.py` `prepare_control_surface_update`): when control
  surfaces change, every Max device whose LiveAPI paths touched `control_surfaces` gets its whole
  device context **released** (observers uninstalled, grabs/MIDI released) and the device
  refreshed; the negative-id table is reset to `{0: None}` (ids handed out again from −1) and
  the surface wrappers are rebuilt. Symptom on hardware right after a power-on rebind: `call
  grab_control <ControlProxy …>: no valid object set` (our surface handle had id 0) and native
  pads. `pushStaleReason()` checks three signals: our surface handle's id is 0, a fresh lookup of
  the index gives another surface id, or other matrix/Accent ids. `onFocusChange` runs the same
  check before grabbing or releasing (selecting Puxi again then always recovers: a dead binding
  schedules `pushWatch` at once instead of touching dead controls). While bound,
  `pushWatch` (every 2.5 s) re-asks the bound index for the `Button_Matrix` **and** `Accent_Button`
  ids (`holdsBoundControls`; two ids because a control-surface update makes Live hand ids out again
  from −1 in request order, so one id alone can match by chance): same ids = fine; the ids on
  another index = the same Push moved (follow it: new `pushIndex`/`pushCS`); nowhere = rebuilt or
  off → `pushTeardown(true)` (drops the handles **without** release calls, which a rebuilt surface
  rejects) + `pushInit()` (polls until a Push is back). On a Push 2 it also switches to a Push 3 when
  one appears (`pushTeardown(false)` releases normally). Guarded by `pushIdsStable` (asking twice for
  `Button_Matrix` must give the same id, otherwise the check is skipped instead of reconnecting every
  tick). The "no Push found" line lists what Live runs (`surfaceTypes()`: a control surface's LiveAPI
  `type` is its **script name** — "Push3", "Push2", "Push" = Push 1, other brands). The Push 2 test
  build (pre-release `push2-test-1`, branch `push2-test`) also printed a full per-surface report of
  control names; that diagnostic was removed for the release.
- **Deferred connection (Push turned on afterward)**: if `findPushSurface()` finds
  nothing at init (Push off/not connected), `pushInit` **does not give up** — it
  **re-probes every 2.5 s** (`pushRetryTask`) until Push connects, then initializes
  and grabs (if Puxi has focus). Without this, turning Push on after loading left the
  pads in **native mode** (drum rack). The polling stops as soon as `pushCS` is set
  (guard `if (pushCS) return`).
- Arrow names: `Up_Arrow` / `Down_Arrow` / `Left_Arrow` / `Right_Arrow`.
  `surface.call("get_control", name)` → returns `id,<N>` (negative ids). ⚠️ **Puxi's
  nav is no longer on these arrows** (left native) but on the dedicated **Octave +/-
  (note banks)** and **< Page / Page > (step blocks)** buttons — names tried
  `Octave_Up`/`Octave_Down`/`Page_Left`/`Page_Right` (helper `pushControlAny` tries
  several names and logs the winner). The rest of the recipe (observe/grab/LED) is the
  same for any button.
- **Receiving a press** (undocumented): observe the control's **`value`** property —
  `var o = new LiveAPI(cb, "id " + N); o.property = "value";` → `127` on press, `0` on
  release. Works even without a grab.
- **Stealing the native function**: `surface.call("grab_control", "id", N)` /
  `release_control` — pass the control as an **object reference** (`"id" N`), never a
  raw integer (otherwise `'int' is not a control`).
- **An arrow/button LED**: `new LiveAPI("id " + N).call("send_value", v)` (a single
  arg; 0 = off, 127 = full brightness, in-between values = dimmer). Puxi's nav buttons
  (Octave/Page) are **bright when nav is possible** in that direction, **dimmed**
  (`PUSH_ARROW_LED_DIM`, default 5 — non-zero, faint but visible; mirroring the grayed
  triangle in the GUI) at an edge. `updateArrowLeds` tests match the GUI's: `noteBase>0`,
  `noteBase<NUM_NOTES-VIEW_TRACKS`, `stepBase>0`, `stepBase<TOTAL_STEPS-VIEW_STEPS`.
  Refreshed in `pushRenderGrid` (so on every nav/follow/grab). Like the pads, don't
  re-emit on release: Live takes the control back and repaints natively. The **Accent**
  button works the same way (`PUSH_ACCENT_LED`=127 if active, `PUSH_ACCENT_LED_DIM`=5
  otherwise — faintly lit, not off). **Behavior** (`accentActive()` = latched or held):
  a pad tap on an **empty cell** enters the note at **127**; on an **existing note**,
  `padhit` **raises its velocity to 127** instead of toggling it off (probability/gate/
  ratchet/locks preserved — no `resetProbOnEntry`). 2026-07-03.
- **Screen-row buttons**: the 8 buttons **above** the screen = `Track_State_Button0..7`;
  those **below** = `Track_Select_Button0..7` (found via the `get_control_names` probe,
  176 controls). They are **RGB** buttons (`send_value <palette index>`; ⚠️ palette
  **different from the pads** — e.g. index 10 = green, 124 = dim gray, 126 = white/bright;
  calibrate by sweeping the indices).
- ⚠️ **Screen rows: LED driven WITHOUT a grab (2026-06-25).** The **click** of
  `Track_State_Button0` (Follow) and `Track_Select_Button0..7` (block) is **NOT grabbed**
  → it stays **native everywhere**. Reason: M4L **cannot detect** when Push leaves the
  device view for **Settings** or the **browser (+)** (those modes change **no**
  observable property — not `pad_layout`, not `appointed_device`; verified via DIAG), so a
  grabbed button would stay **hijacked** there. **But** we still drive their **LED** via
  `send_value` **without a grab** (`updateFollowLed`/`updateBlockLeds`, called in
  `pushRenderGrid`, guarded by `pushGrabbed`): **Live does not repaint** these buttons in
  device view on **Push 3**, so our LEDs hold (**verified on hardware, Live 12.4**; Push 2's
  script does repaint them → left native there, see the Push 2 bullet) → we keep the Follow +
  block indicators **as before**, without stealing the click. The Follow **toggle** goes
  through **encoder 1** (touch/turn) + the GUI; block **paging** through the **< Page / Page >**
  buttons + the GUI. (If Live ever starts repainting them and overwriting our LEDs, remove these 2 calls.)
- **Block copy/paste (Duplicate + screen row, 2026-06-29).** `Duplicate_Button` grabbed on
  focus (modifier; suppresses the native "duplicate"). **Holding** it enters *dup mode*: we
  **momentarily grab** the 8 `Track_Select_Button0..7` (block i), 1st tap = **copy** that
  block (`dupSrc`, LED **blinks** via `dupBlinkTask`, color `PUSH_DUP_BLINK`), 2nd tap =
  **paste** (`dupblock src dst`: copies the 8 steps × all rows, `sendFullState` +
  `pushSnapshot` = undoable). Release / **blur** (`setGrabbed(false)` → `endDupMode`) =
  **release** the buttons (native click restored). ⚠️ This is the **only** exception to
  "screen rows never grabbed": the grab is **momentary** (for the duration of the hold) → a
  stuck-in-Settings grab can't outlive the release. **Duplicate** LED = available
  (`updateDuplicateLed`, `PUSH_DUP_ON`): lit iff **≥1 non-empty block AND ≥1 empty block**
  (`canDupAny`). While held without a copy, the **shown-block indicator stays lit**
  (`updateBlockLeds` re-issued **~80 ms** after the grab — otherwise the post-grab
  `send_value` is lost). GUI: **`DUP`** button (after `FOL`), click = copy the shown block,
  navigate, click = paste (`dupblock`). ⚠️ In the GUI, `dupCopied` **must NOT** be reset in
  `initState`: `sendFullState` sends `gui("clear")` on **every** nav → that wiped the copy
  (the engine never re-emits it).
- **Delete (Delete + scene / screen row, 2026-07-03).** `Delete_Button` grabbed on focus
  (modifier + LED, suppresses native delete). **Held** (`pushDeleteHeld`): a **scene** clears
  **all steps of the aligned row** (`deleteNoteRow(noteBase+sceneRow(si))`, branch in
  `makeSceneCb`); a **screen-row (block) button** clears **the whole block** (8 steps × all
  rows, `deleteBlock`). The block buttons are **grabbed momentarily** while held (helpers
  `grabBlockButtons`/`releaseBlockButtons`, shared with Duplicate; the release keeps the grab
  if the other modifier still holds it) via `makeBlockCb` (Delete wins over Dup). Release /
  blur (`endDeleteMode` in `setGrabbed(false)`) = release (native click restored).
  `deleteNoteRow`/`deleteBlock` also reset probability/gate/ratchet to defaults,
  `sendFullState`+`pushSnapshot` (undoable), and do nothing if the target is already empty.
  **LED hints while held**: scenes lit on rows **with content** (`rowHasNotes`, `pushDeleteHeld`
  branch in `updateSceneLeds`), block buttons on blocks **with content** (`blockHasNotes`,
  branch in `updateBlockLeds`, deferred repaint ~80 ms after grab like Dup). Delete LED
  full/dim (`updateDeleteLed`, `PUSH_DELETE_LED`/`_DIM`, refreshed in `pushRenderGrid`).
  **No new param or GUI message → no `.amxd` rebuild** (100% control-surface gesture, Push
  only). Delete **released**: scenes = mute/solo/loop-select, block buttons = **native**.
- **Enum label on the screen**: a toggle param's value shows via its `parameter_enum`.
  Follow = `["off","ON"]` (the capitalized "ON" is the only way to style the text — no text
  color is possible). A `.maxpat` change → regenerate the `.amxd`.
- **Polite grab (on focus)**: observe `appointed_device` on `live_set`, grab only if the
  appointed id == `this_device`. ⚠️ The observed value arrives as
  `["appointed_device", "id", N]` → the id is the **last** element (`args[1]` is the literal
  `"id"`). Same for any object-typed property.
- **Limitation**: no reliable device-removal hook in v8 → removing Puxi while it has focus
  leaves the arrows grabbed until the control surface is re-selected. Click elsewhere
  (release) before removing.
- **Pads (8×8 grid)**: the `Button_Matrix` control. LED: `matrix.call("send_value", col,
  row, color)` (col=step, row=track; palette index, e.g. 2/6/10 here). ⚠️ **Defer the first
  render** ~100 ms after a grab (via `Task`) — `send_value` calls right after `grab_control` don't
  show. Input: observe the matrix's `value` → `["value", velocity, col, row, 1]` (velocity =
  how hard the pad was hit). **Piano-roll orientation (low at the bottom)**: note row `t` (t=0 = low) is
  rendered on physical pad row `pushRow(t) = 7−t`, and the press applies the same function
  (self-inverse) → `padhit(pushRow(row), …)`. Only one line (`pushRow`) needs flipping if the
  hardware turns out the other way. **Up/Down** arrows inverted accordingly (Up = higher,
  `nav notes +1`; Down = lower), LEDs likewise. ⚠️ **`padhit` must call `pushSnapshot()`**
  like the GUI edits — otherwise **pad** edits are neither persisted nor undoable (fixed).
- **Convert button (export → MIDI clip)**: `get_control("Convert")` (falling back to
  `"Convert_Button"`). Grabbed on focus (we own its LED); **LED lit iff the sequencer holds
  ≥1 note** (`updateConvertLed`, refreshed in `pushRenderGrid` + `pushSnapshot`), off
  otherwise. The press calls `exportclip()` — **but via a deferred `Task`**: `create_clip`
  called directly from the observer callback fails (`Changes cannot be triggered by
  notifications. … defer your response`). The GUI `>CLIP` button sends a **message** (not a
  notification) → no need to defer.
- **Double Loop (`Double_Button`)**: doubles the **global** loop (end ×2, start fixed) +
  copies its notes (all rows) into the new half (`doubleloop`/`canDoubleLoop`). Grabbed on
  focus (press + LED). **LED lit iff doubling is possible**: ≥1 note **inside** the loop, the
  doubled length **fits in `TOTAL_STEPS`** (8 blocks max), and the **region just after** the
  loop is **empty** (`updateDoubleLed`, refreshed in `pushRenderGrid` + `pushSnapshot`). ⚠️
  Unlike Convert, **no deferred `Task`**: `doubleloop` does **not** touch LiveAPI (edits the JS
  pattern + emits messages) → OK in an observer callback. GUI: **`x2`** button (bottom strip,
  between `►` and `CLIP`), lit/dimmed by `dbl 0|1`.
- **Mute / Solo (scene + Mute/Solo buttons)**: `Global_Mute_Button` / `Global_Solo_Button`
  (dedicated buttons) **held** = modifiers, plus the 8 `Scene_Launch_Button0..7` (to the right
  of the pads). All **grabbed on focus** (helper `acquireGrab`: grab + observe `value` +
  returns a LiveAPI handle for the LED). Gesture: **hold Mute** (or Solo) **+ tap a scene** →
  `mutetrack` (or exclusive `solotrack`) on the aligned row; with no modifier, **holding** a
  scene targets its row for the loop/Vel/Prob/Lock encoders (we own the button, no native
  scene launch while focused). ⚠️ **Inverted scene
  orientation**: the `Scene_Launch_Button`s are numbered **bottom(0)→top(7)** — the **opposite**
  of the `Button_Matrix` rows — so the view row is the index directly (`sceneRow(si)=si`, a
  one-line flip, like `pushRow`). Scene LEDs (`updateSceneLeds`): **lit = the row plays**
  (`audible(r)`), off = muted or silenced by a solo; **all lit while Mute/Solo is held**
  (`pushMuteHeld`/`pushSoloHeld`, a "pick a row" hint). Mute/Solo LED (`updateMuteSoloLeds`):
  full if held, **dim** (`PUSH_MS_LED_DIM`=5) if the state is active without being held, off
  otherwise. Scene lit color `PUSH_SCENE_LED_ON` (RGB palette index, adjustable). **Grayed
  pads**: `pushSetPad` also uses `PUSH_OFFLOOP_COLOR` when `!audible(noteBase+t)` → the pads of
  a muted/solo-silenced row go gray (mirroring the GUI dimming); `sendMuteSolo` calls
  `pushRenderGrid` to repaint live. Refreshed in `pushRenderGrid` (grab/view) + `sendMuteSolo`
  (state change).
- **Top encoders** (`Track_Control_0..7`): rotation = **relative** encoder (1..63 = right/+,
  65..127 = left/−); touch = `Track_Control_Touch_N` (127/0). Prefer: **expose the settings as
  real Live params** (below) → Push drives AND displays them natively, without a grab.
- **Showing params on the Push screen** (the only way; the screen isn't drawable): `live.*`
  objects (toggle/numbox) with `parameter_enable: 1`. 3 conditions or nothing shows: (1) the
  object **in presentation** (`presentation: 1`) — hide it off-screen (`presentation_rect` at
  negative x); (2) a top-level **`parameters`** block `{ "obj-id": [long, short, 0] }`; (3)
  **`parameter_mapping_index`** per param = position on the encoder (1-based; index 0 = "Device
  On"). Diagnostic: `this_device` → `getcount("parameters")`.
- **Param ↔ engine bridge**: param → `prepend p<name>` → v8 (handlers `pfollow/pstart/pend`);
  v8 outlet 2 → `route … → prepend set` → param. The `set` updates the param **without
  re-emitting** (no feedback). Regenerate the `.amxd` after adding these objects
  (`tools/build-amxd.py`).
- **Momentary follow**: observe encoder 1's touch → a hold (debounce ~60 ms, no rotation)
  forces follow on, release = off; any rotation cancels the momentary hold and sets follow by its
  direction.
- **Polyrhythm — per-note loop lengths (encoders 2/3 + scene buttons).** Each note has an
  **effective** loop `[start, end)`: either the **global loop** `gLoopS/gLoopE` it **follows**,
  or its own **custom** loop (frozen) if `loopCustom[r]`. `tick` advances each note within ITS
  loop, **phase-locked at start** (`S = round(beats*4)`, `step = eLoopS(r) + (S mod
  (eLoopE−eLoopS))`) → each note at a different step. **Encoder target** (`loopSelN`): **−1 =
  global** by default; **holding a scene button** (with no Mute/Solo/Repeat/Delete modifier) sets it to **that note**
  (momentary), **release = back to global** (`makeSceneCb`: press→`selectLoopNote(note)`,
  release→`selectLoopNote(-1)` guarded by `pushSceneSel`). `setloop`: global target → moves
  `gLoop` (followers follow, custom ones **frozen**); note target → makes it **custom**;
  `normalizeCustom()` **makes it a follower again** as soon as its value **= global**. Per-note
  playhead on the pads (`pushSetPlayheads`, `pushPlayColN[]`) and in the GUI (`playheads`); pads
  grayed by each note's **effective** loop. Persisted + (partially) undoable — see the
  Persistence section.
- **Per-step probability — pad hold + 5th encoder (`prob[r][s]`, 0..100).** Playback: `tick`
  only plays if `Math.random()*100 < prob[r][step]` → **statistical** (≈ p% of the repeats, not
  every other one). 100 = always, 0 = never. **Pad gesture**: the toggle is **deferred to
  release** (`padPress` + `padHoldTask` ~250 ms). Tap = toggle; **hold** → `enterProbMode(t,s)`
  (no toggle) → `probTarget = {r,step}` + `param("prob", …)` shows the cell's probability on
  **encoder 5** (Live param `Prob`, `parameter_mapping_index 5`). Turning the encoder →
  `pprob(v)` edits `probTarget` (no pad held → the held scene's row, else the global offset; **no resync** → no storm like the loop
  detents). Release → `exitProbMode`. ⚠️ **The "Prob" label is always displayed** (a
  deliberate choice, 2026-07-02): a mapped param always shows (the screen isn't drawable) — it's
  impossible to hide it when idle without losing the label (the alternative = grabbing the encoder
  with no label). GUI: probability edited by a **horizontal drag** on a cell (vertical =
  velocity, with axis lock), cue = a **bar at the bottom of the cell** (width ∝ probability).
  Persisted in PuxiState **v5**; debounced undo (`scheduleProbSnap`). **New param →
  `build-amxd.py` required** (done). Display on the **pads**: a "shimmer" weighted between 2
  brightness levels — see the Drum Rack section. **Probability belongs to the NOTE, not the
  step** (2026-07-02): any note **entered** (GUI toggle / pad tap) starts at **100** even if a
  probability lingered on that step (`resetProbOnEntry`, called by `toggle` + `padhit` — not by
  `setvel`, otherwise the GUI velocity drag, which goes through toggle-off then setvel, would
  overwrite an existing note's probability). Corollary: `dupblock` and `doubleloop` **copy
  probability with the notes**.
- **GLOBAL probability — Prob encoder with no pad held (2026-07-02).** Same momentary pattern
  as the loops: **no pad held = global target**, pad held = the note, release → `exitProbMode`
  re-shows the global (`param("prob", gProb)`). Semantics = **non-destructive offset**:
  `effProb(r,s) = clamp(prob[r][s] + gProb − 100, 0, 100)` — the per-note probabilities stay
  stored intact (global 100→90: a note at 50 plays at 40; back to 100 → 50). **Everything
  consumes the effective value**: `tick` (roll), shimmer (`probBlinkTick`), the pad base
  (`pushSetPad`), GUI bars (the GUI receives `gprob` + each cell's own probability via `cprob` and
  derives the width itself — no burst of 64 `cprob` messages per detent). Global 0 = nothing plays. ⚠️
  `gProb` **persists via the Live "Prob" param** (restored by Live on reload → arrives via
  `pprob` with no pad held), **not** in PuxiState or `initPattern` (don't reset it to 100 there:
  the param-restore / pstate-restore race would overwrite it). `sendParams` re-emits `prob` only
  if `!probTarget` (don't overwrite the display during a hold).
- **ROW probability — Prob encoder with a scene held (2026-09-26).** Target priority in `pprob`:
  held pad (`probTarget`) → held scene (`pushSceneSel`) → global. With a scene held, `setRowProb`
  sets the **own** probability of every existing note of that row (absolute, like the pad edit
  but for the whole row; a note entered later still starts at 100). The encoder shows
  `rowProbDisplay(r)` = the value most of the row's notes share (100 for an empty row);
  `probDisplay()` picks row vs global and is used by `makeSceneCb` (press/release),
  `exitProbMode` and `sendParams`. Undo via `scheduleProbSnap`. Length stays note/global only.
- **ROW velocity — Vel encoder with a scene held (2026-09-26).** Same target priority in `pvel`
  (pad → scene → global), but **relative**, like a fader on the row, so accents/ghost notes keep
  their differences: on scene press `captureRowVel(r)` snapshots the row (`rowVelSnap`) and the
  displayed reference (`rowVelRef` = `velDisplay()` = the row's loudest note, or `gVel` for an
  empty row); each turn `shiftRowVel` sets every note to `clamp(snapshot + (value − ref), 1,
  127)` — computed from the snapshot, so turning back restores exactly. The snapshot is re-taken
  in `exitProbMode` (a pad edit during the hold may have changed the row) and dropped on scene
  release. Undo via `scheduleVelSnap`. `velDisplay()` is used by `makeSceneCb`, `exitProbMode`
  and `sendParams`.
- **Per-step length/gate — pad hold + 6th encoder (`gate[r][s]`, 5..6400%, 2026-07-02).** A
  note holds `gate%` of a step's duration: **100 = one step** (default), **<100** = staccato,
  **>100 = tie/legato** that **spills over** into the following steps (and pages) — up to **6400%**
  (**64 steps**). Playback: `tick` computes `stepMs = 60000/bpm/4` (live bpm) and plays
  `note(pitch, vel, Math.round(effGate/100 * stepMs))` → the overflow (pages/loops) is
  **automatic**, carried by the actual note duration (no linking logic needed). ⚠️ Limitation:
  `makenote` can cut a tie if the **same note** retriggers on the **same row** before it ends.
  **Gesture** = same as probability: the same **pad hold** (`padHoldTask`), `enterProbMode` shows
  **both** Prob (enc. 5) **and** Length (enc. 6, Live param `Length`, `parameter_mapping_index
  6`); turning enc. 6 → `plength(v)` edits the held cell. **GLOBAL length** (non-destructive offset,
  like probability): **with no pad held**, enc. 6 drives `gGate` → `effGate(r,s) = clamp(gate[r][s]
  + gGate − 100, MIN_GATE, MAX_GATE)`; `gGate` **persists via the Live `Length` param** (not in
  PuxiState/`initPattern` — same param-restore race as `gProb`). GUI: edited by a **horizontal
  drag in the right third** of a cell (`dragZone`: left = probability, right ≥68% = length), the
  window limits the drag (~8 steps); the Push encoder reaches 64. The **`Length` param is FLOAT**
  (`parameter_type 0`): an **integer** param caps the Push encoder at `min+255` (~260%, too
  short) — Float gives continuous resolution up to 6400. **New param → `.amxd` rebuild** (done).
  Persisted in PuxiState **v6**; debounced undo (`scheduleGateSnap`). Length **belongs to the
  note**: `resetProbOnEntry` also resets `gate` to default on note entry; `dupblock`/`doubleloop`
  **copy gate with the notes** (like probability). **Tie display** (`>100%`): a thin **trail**
  (the note's color) extends from the cell to the right. On the **pads**, `tailCoverColor` paints
  the covered cells (the low level of the hue). The **GUI** only sees the visible
  window (not its neighbors), so the engine sends `tailin t extent` = how many cells a tie **coming from the
  previous page** overflows **into** the view (derived from `incomingTail(r)`) → the GUI draws
  that incoming trail from the left edge. The two trails (outgoing clipped on the right / incoming
  from the left) make a note straddling 2 pages look continuous.
- **Ratcheting — Repeat hold + scenes (division) + pad (`ratchet[r][s]`, 1..8, 2026-07-03).** A
  step plays `R` **evenly-spaced sub-hits** instead of one (1 = normal, default). Playback:
  `playStep(pitch, vel, gate%, R, stepMs)` — hit 0 immediate, hits 1..R−1 scheduled by `Task` at
  `k·(stepMs/R)`; each hit lasts `gate% × slot` (slot = `stepMs/R`) → gate still shapes the
  staccato **within** the subdivision. **A single probability roll per step** (the ratchet is one
  unit). ⚠️ **Do NOT pass the values via `Task.arguments`**: Max appends an argument to the
  callback → `makenote: extra argument for message list`. Use a **closure**
  `new Task(function(){ note(pitch,vel,dur); })` (the 3-arg form identical to the immediate hit)
  and keep the Tasks referenced in **`ratchetTasks`** (cleared at the top of `tick`, once they
  have all fired — otherwise Max GCs them before they trigger). **Push gesture** (modeled on
  mute/solo/Duplicate): **`Repeat_Button` grabbed on focus** (modifier + LED, suppresses native
  note-repeat); **held** → `pushRepeatHeld` → the 8 **scenes become a division selector** (a bar
  lit from the **bottom**: scene `si` → division `si+1`, `ratchetSel` 1..8, default 2;
  `updateSceneLeds` has a `pushRepeatHeld` branch); **still holding Repeat, tap a pad** →
  `ratchethit(t,s,vel)` paints `ratchetSel` (creates the note if empty, otherwise keeps
  vel/probability/gate). `onPadMatrix` short-circuits the tap/hold when `pushRepeatHeld`. Repeat
  LED (`updateRepeatLed`): full if held, dim otherwise (`PUSH_REPEAT_LED`/`_DIM`).
  `pushRepeatHeld` reset to 0 on blur (`setGrabbed(false)`). **Live GUI**: a ratcheted note shows
  **R−1 dark notches** (subdivisions); editing = **Shift + vertical drag** on a cell (up = more
  hits; `onclick`/`ondrag` read the `shift` modifier — the 5th arg of the v8ui mouse events —
  creates the note if empty, no toggle). **No global** (ratchet is **per cell** only). **Belongs
  to the note** (`resetProbOnEntry` also resets `ratchet` to 1); `dupblock`/`doubleloop` **copy
  the ratchet**. Persisted in **PuxiState v7**; debounced undo (`scheduleRatchetSnap`). **No new
  Live param → no `.amxd` rebuild** (100% control-surface gesture). **Display on the pads —
  strobe (2026-07-03).** A ratcheted note **flashes R times per step** between its brightness and
  off (`startRatchetFlash`: `scheduleFlash` on at `k·slot`, off at `+slot/2`; Tasks in
  `flashTasks`, cancelled at the top of `tick`/on repaint/on stop via `cancelFlashes`).
  **Persistent indicator**: `pushRatchetIdle(S, stepMs)` (called in `tick` after
  `pushSetPlayheads`) strobes **every** visible ratcheted note **every step** (`RATCHET_IDLE_EVERY
  = 1`, tunable) → you spot it **before** the playhead; the cell under the playhead is left to
  `pushSetPlayheads` (its own strobe, replaces the green). **Coexists with probability**: each
  flash's color comes from `shimmerRoll(r,step,vel)` = a weighted roll between the velocity level
  and the one below (`chance of the top = p/100`) → the **rhythm** encodes the ratchet, the
  **brightness** encodes the probability. `probBlinkTick` **skips** ratcheted cells (their
  probability rides the flashes). `padVelColor` removed (subsumed by `shimmerRoll`).
- **Parameter lock (p-lock) — pad/scene hold + encoders 7/8 (2026-07-03).** Each note can "lock"
  2 params of its Drum Rack **pad** (the first two of the chain's first device =
  `chains 0 devices 0 parameters 1/2` → **Macro 1/2** if it's a rack; `resolvePadParams` during
  `scanDrumRack`, LiveAPI handles + min/max cached in `padParam[r]`). **2 new Live params**
  `Lock1`/`Lock2` (`parameter_mapping_index 7/8`, int 0..127) on the **2 free encoders** →
  **`.amxd` rebuild** (params injected into the `.maxpat` by a script). Values stored **normalized
  0..127**, mapped to the target param's `[min,max]` (`plockToVal`/`valToNorm`). **Gestures**
  (reuse the existing holds): **pad hold** (= prob/length mode) → enc. 7/8 = **step lock**
  (`plock[r][step]`, absolute, -1 = none); **scene hold** (= loop-select) → enc. 7/8 = **per-row
  offset** (`plockBase[r]`, 0..127, **neutral = 64**) that **affects ALL notes** of the row (like
  global probability: `effProb`). **Playback**: `applyPlocks(r,step)` (in `tick`, just before the
  note sounds) writes `eff = clamp((step lock if set, else 64) + (offset − 64), 0, 127)` to the
  param — **opt-in**: does nothing if there is no lock **and** the offset is neutral (rows
  without a p-lock are never driven). **A lock affects its own step only (fixed 2026-09-26):**
  before a lock first moves a param, `overrideParam` saves the param's own value in
  `plockHome[r][i]` (`plockOver[r][i]` = true); the row's next **played** note with neither a
  lock nor an offset calls `restoreParam` (puts the saved value back), and stopping playback
  restores all of them (`restoreAllParams`, run from a 10 ms `Task` because Live refuses
  parameter changes made inside the `is_playing` notification). Before this fix the locked value
  stuck, so it sounded as if the lock applied to the whole row. `scanDrumRack` clears the saved
  values (they belong to the previous rack's params). `applyLockLive` goes through
  `overrideParam` too. `pplock1/pplock2` (→ `pplock(i,v)`) edit whichever target is held
  (pad → step, scene → offset), `applyLockLive` applies it live (you hear it). `showLocks` shows
  the value (the lock if set, otherwise the param's current value). **Belongs to the note**
  (`resetProbOnEntry` resets the step lock to -1 → a fresh note follows the row offset);
  `dupblock`/`doubleloop` **copy the locks**; `deleteNoteRow`/`deleteBlock` clear them (clearing a row also
  resets the offset). Persisted in **PuxiState v8**; debounced undo (`scheduleLockSnap`). ⚠️
  **Puxi TAKES OVER** these 2 params for rows with locks/offset (rewritten on every played step)
  → conflicts if you move the macro by hand/automation. ⚠️ **Fixed labels `Lock1/Lock2`**: Push
  **does not re-read** a param's name when it changes at runtime (`_parameter_shortname` pushed
  into the numbox = no effect on the screen, a **dead end** verified on hardware) → impossible to
  show the macro's real name. Value shown **normalized 0..127** (not the real units). **Push
  only** (no Live GUI counterpart in v1).
- **Detents on the loop encoders**: we can't intercept the rotation before Live maps it to the
  param → we snap **afterward**, in `pstart/pend`. When the current value is a detent (a block
  boundary, every 8 steps), we absorb the first increments (`LOOP_DETENT_ESCAPE`, default 8 —
  higher = firmer) and re-pin the param on the detent via `setloop → sendParams "set"`; past the
  threshold it "breaks free" (Live's centered-pan feel). Start detents (1-based) `1,9,…,57`
  (`(v-1)%8==0`); End `8,16,…,64` (`v%8==0`). Per-encoder state: `magStart/magEnd {acc,last}`,
  resynced on an external change (GUI drag) **and on restore/undo** (`applyRestore`, to limit
  re-absorbing an undo step). The `set` doesn't re-emit → no loop. Pure JS (no `.amxd` rebuild).
- **Displaying the detents on the Push screen**: no drawable marks (the screen isn't
  customizable; the native ring is rendered by the param *type* and can't show non-uniform
  detents). The representation comes "for free" from the mechanism: during absorption the
  value/ring **freezes** at the boundary, then jumps when it breaks free → the detent shows on the screen
  without drawing anything. (The only way to get *native* detents would be a quantized param —
  ruled out because it kills per-step control.)

## Groove / swing (following the Live amounts, 2026-07-03)

Puxi **follows two of Live's global settings** as **swing**: the **Groove Pool amount**
(`groove_amount`) **and** the quantization **Swing Amount** (`swing_amount`). Since the API doesn't expose a groove's exact
shape (see the Hard constraints section), we **approximate it as
swing** and faithfully follow the **amounts** (a deliberate choice).

- **Observers**: `grooveObs`/`swingObs = new LiveAPI(onGrooveAmount/onSwingAmount, "live_set")` +
  `.property = "groove_amount"` / `"swing_amount"` (set in `init`, after `is_playing`) → store
  `grooveAmount`/`swingAmount` (0..1). Initial fire + explicit seed (`.get`) to cover the case
  where the observer doesn't fire at setup. The callbacks only store (no LiveAPI) → safe at any
  time. (`swing_amount` = float 0..1, the one from quantization/`Clip.quantize`.)
- **Playback**: `tick` combines the two (`swingAmt = min(min(grooveAmount,1)+min(swingAmount,1),
  1)` → **capped at 1**, so `swingMs ≤ SWING_MAX·stepMs`: task safety preserved) then
  `swingMs = (S odd && swingAmt>0) ? swingAmt * SWING_MAX * stepMs : 0` (**16th** swing: the
  offbeats = **odd** 16ths are delayed; `SWING_MAX = 0.5` = half a step at max, tunable).
  `playStep(pitch, vel, gate%, R, stepMs, delayMs)` shifts **the whole step** (ratchet sub-hits
  included) by `delayMs`: hit 0 goes from immediate `note()` to `scheduleHit(...)` when
  `delayMs>0`.
- ⚠️ **Two-generation retention** (`ratchetTasks` + `ratchetTasksPrev`, swapped at the top of
  `tick`): swing can push a hit **past the next tick** (up to ~1.4 steps with a ratchet), so a
  single-generation clear GCs it before it sounds. 2 generations = refs alive ~2 steps > a hit's
  max duration. (The visual `flashTasks` stay single-generation: they're on the grid, not
  swung.)
- **Straight visuals**: the GUI/pad playhead and strobes are computed on each tick (on the grid)
  → the screen stays **straight**, only the sound is shifted (like a Live groove, micro-timing).
  No Live param, no GUI message → **no `.amxd` rebuild** (100% JS). Automatic (no opt-out: follows
  the amounts; sum 0 = straight) — a toggle or an 8th-note swing base would be possible future enhancements.
- **Export**: the baked clip **prints the same combined swing** (groove + swing) into the
  `start_time` — see the Export section.

## Export → MIDI clip (`exportclip`, extended 2026-07-03)

`exportclip()` bakes the pattern into a **MIDI clip** (the first empty slot on Puxi's track),
embedding **everything Puxi adds on top of pitch+velocity**, via `add_new_notes` (the extended
note dict, **Live 11+**):

- **Length/gate** → `duration = effGate/100 × 0.25 beat` (ties >100% = long overlapping notes;
  no cap → a tie can exceed `loop_end`, Live loops it).
- **Probability** → the note's **`probability`** field = `effProb/100` (set only when <1 to keep
  100% notes as plain dicts).
- **Ratchet** → an R>1 cell is **expanded into R evenly-spaced notes** (`start + k·slotB`,
  duration `effGate% × slotB`, `slotB = 0.25/R`).
- **Groove/swing** → the current swing (combined `groove_amount` + `swing_amount`, same formula
  as playback) is **printed**: the `start_time` of the **odd** 16ths shifted by `swingAmt ×
  SWING_MAX × 0.25` beat (snapshot; a fresh clip has no groove assigned → no double swing).
- **Global offsets** prob/gate folded in (effProb/effGate); **Accent** already in the velocity;
  clip named `Puxi`. Helper `pushNote()` builds each dict (min duration 0.001, probability if
  <1).
- Length = last occupied step rounded up to the beat (`STEP_BEATS = 0.25`).

**Deliberate choices** (2026-07-03): **mute/solo not applied** (a performance state → the whole
pattern is baked) and **polyrhythm not unrolled** (the clip = the programmed grid, looped by Live
as one region; unrolling = the LCM of the loops, another feature). ⚠️ **ratchet+probability**: the
R sub-notes roll **independently** in Live (Puxi rolls once per step) → a slight difference. Pure
JS, no rebuild.

## Catch: MIDI clip → pattern (`catchclip`, 2026-07-03)

The inverse of `exportclip`. GUI **`GET`** button (bottom strip, after `DUP`) → message
`catchclip` → the engine reads a MIDI clip and writes it into the pattern:
- **Target** (`catchClipTarget`): `live_set view detail_clip` (the clip **open in the piano-roll
  editor**); fallback `highlighted_clip_slot clip`. Ignores an audio clip (`is_midi_clip`).
- **Reading**: `get_notes_extended(0,128,0,length)` (Live 11+) → JSON `{notes:[…]}` (defensive
  string/object parse). Per note: **pitch → row** `pitch − NOTE_LO`, **start_time → step**
  `round(start·4)` (**quantized to the 16th**), **velocity/duration/probability** →
  `pattern`/`gate`(=`dur/0.25·100`)/`prob`.
- **Replaces** the grid via `clearGrid()` (pattern + prob/gate/ratchet/plock to defaults;
  **keeps** mute/solo + globals + plockBase); **sets the global loop** to the clip length
  (`gLoopE = round(len·4)`, custom loops reset to 0). `sendFullState` + `pushSnapshot` (undoable).
- ⚠️ **Limitations**: off-grid notes **rounded** to the 16th; **ratchets not reconstructed** (a
  clip has none — sub-notes of one step overlap); notes **> 64 steps** or **outside C1..G3**
  dropped; **replaces** (no merge). **Push not covered** (no obvious button — parity to consider).
  Pure JS, no rebuild; called by a GUI message (not a notification) → no deferred `Task`.

## Engine ↔ GUI message protocol

| Direction | Message | Meaning |
|---|---|---|
| engine → GUI | `cell t s v` | a cell's state (v=0 off, otherwise velocity) |
| engine → GUI | `cprob t s p` | a cell's **own** probability (0..100) → bar at the bottom of the cell (width = effective) |
| engine → GUI | `gprob v` | **global** probability (offset) — the GUI derives each bar's **effective** width |
| engine → GUI | `clen t s g` | a cell's **own** length/gate (%, ≠100 = staccato/tie) → trail if >100 |
| engine → GUI | `glen v` | **global** length (offset) — the GUI derives each note's **effective** gate |
| engine → GUI | `gvel v` | **global** velocity (offset) — the GUI derives each cell's **effective brightness** |
| engine → GUI | `cratchet t s r` | a cell's **own** ratchet (1..8; 1 = none) → subdivision notches |
| engine → GUI | `tailin t extent` | a tie overflowing **from the previous page** into the view (in fractional cells) → incoming trail from the left |
| engine → GUI | `playheads s0 … s7` | play position **per visible row** (view-relative, -1 = off-block/stop) — **polyrhythm** |
| engine → GUI | `label t name` | track name (the Drum Rack chain name, otherwise the note name) |
| engine → GUI | `color t r g b` | track color (Drum Rack chain, 0..255; `r<0` = default palette) |
| engine → GUI | `clear` | full reset |
| engine → GUI | `view nb nmax sb smax follow` | view window: bank + block base/max, follow (0/1) |
| engine → GUI | `loop t ls le` | a visible row's **effective** loop (absolute steps) → per-row dimming |
| engine → GUI | `loopsel selT ls le` | the row targeted by the ruler (`selT`=view index, -1 = global/off-view) + its loop |
| engine → GUI | `musolo t m s sa` | a visible row's mute/solo (m/s = 0/1; `sa`=1 if a solo silences elsewhere → the GUI dims the non-soloed rows) |
| engine → GUI | `dbl 0\|1` | can the loop be doubled? → lights/dims the `x2` button |
| GUI → engine | `toggle t s` | toggle a step |
| GUI → engine | `setvel t s v` | set a velocity |
| GUI → engine | `setprob t s p` | set a cell's probability (0..100) |
| GUI → engine | `setgate t s g` | set a cell's length/gate (5..6400%) |
| GUI → engine | `setratchet t s r` | set a cell's ratchet (1..8 sub-hits) |
| GUI → engine | `nav axis delta` | scroll the view (axis = `notes`\|`steps`, delta = ±1) |
| GUI → engine | `follow` | toggle playhead follow (auto-scroll to the played block) |
| GUI → engine | `setloop start end` | set the loop [start, end) of the **target** (the selected note, or **global** = all following notes) |
| GUI → engine | `mutetrack t` | toggle mute of visible row t |
| GUI → engine | `solotrack t` | **exclusive** solo of visible row t (click again = clear the solo) |
| GUI → engine | `refresh` | request a full state push (load handshake) |
| GUI → engine | `doubleloop` | double the **global** loop (end ×2, start fixed) + copy its notes (velocities **+ probabilities**) into the new half |
| GUI → engine | `dupblock src dst` | copy block `src` (8 steps, all rows, velocities **+ probabilities**) to block `dst` |
| GUI → engine | `exportclip` | bake the pattern to a MIDI clip (first empty slot; embeds duration/probability/expanded ratchet/swing — see Export) |
| GUI → engine | `catchclip` | read the MIDI clip from the editor/selected slot → replace the pattern (see Catch) |
| patch → engine | `init` | LiveAPI ready (live.thisdevice) |
| patch → engine | `tick` | the metro's 16n bang |
| param → engine | `pfollow v` / `pstart v` / `pend v` / `pvel v` / `pprob v` / `plength v` / `pplock1 v` / `pplock2 v` | Live params (Follow/Start/End/Vel/Prob/Length/Lock1/Lock2) → state |
| engine → param | `follow v` / `start v` / `end v` / `vel v` / `prob v` / `length v` / `plock1 v` / `plock2 v` | state → Live params (via `set`, no echo) |
| param → engine | `pstate <ints…>` | restore the saved state (the `[p pstate]` pattr on reopen) → deserialization |
| engine → param | `state <ints…>` | push the current state into the pattr (a **bare** value → updates the param → saved with the Set) |

**Single-outlet transport (prevents cord deletion).** The engine has **a single outlet** and emits
**tagged** messages on it — `note …` (→ makenote), `gui …` (→ v8ui), `param …` (→ Live params). A
`[route note gui param]` in the patch re-splits them. On the JS side, the `note()` / `gui()` /
`param()` wrappers (no longer `outlet(0/1/2,…)`) add the tag. Reason: a v8's outlet > 0 has its
cord **deleted** on Set reopen (see Known M4L pitfalls). The `gui`/`param` tag is **removed by
`route`** before reaching the v8ui / the params → their protocol (above) is unchanged.

**Pattern persistence in the Set (a `pattr` param in a sub-patcher).** The state is saved **per
instance with the Set** via a **`pattr PuxiState`** placed in the **`[p pstate]` sub-patcher**,
exposed as a Live parameter of **type 3 (list)**. Hard-won M4L lessons (diagnosed 2026-06-22,
after many tries):
- A top-level `pattr` (or `jsui`/`v8`) **does NOT register** as a device parameter (only `live.*`
  and `pattrstorage` do at top level; verified on factory devices). You **need a sub-patcher** →
  the `parameters` block key = `obj-60::obj-3`, exactly like Step Arp's pattr param.
- **Send the BARE value** to the pattr (not `set …`): `set` changes the *runtime* value but **not
  the parameter value Live saves** (symptom: we always re-read the initial value). The bare value
  updates the param; the pattr re-emits it (echo) → `pstate` **ignores it if it equals the current
  state** (see undo/redo below).
- State = a **list of integers** (the pattr's native type, no JSON-string quoting worries).
  **`STATE_VERSION = 8`**: `[8, noteBase, nMute, <muted…>, nSolo, <soloed…>, gLoopS, gLoopE,
  nCustom, <r,ls,le per custom note…>, nProb, <r,s,p per cell ≠100…>, nGate, <r,s,g per cell
  ≠100…>, nRatchet, <r,s,rc per cell ≠1…>, nPlock, <r,s,a,b per step with a lock…>, nBase, <r,a,b
  per row with an offset ≠64…>, r,s,v, …]` (mute/solo + custom + prob/gate/ratchet ≠default +
  step locks + row offsets as **sparse lists**, before the cells; lock values normalized 0..127,
  -1 = no step lock, neutral offset = 64). Read on restore: **v7** (no p-lock), **v6** (no
  ratchet), **v5** (no gate), **v4** (no probability), **v3** (`nLoop` triples → custom), **v2**
  (mute/solo), **v1** (`[1, noteBase, r,s,v…]`). The **loop is now in PuxiState** (polyrhythm: 1
  global + N custom — impossible with `live.*` params) → **persisted + undoable**. `follow`/`block`
  persist through their `live.*` params (a single param each, no clash). ⚠️ The note bank
  (`stepBase`/shown block) is **no longer** persisted since the Block param was removed
  (2026-07-03) → returns to block 1 on reopen (paging with the Page buttons).
- `pushSnapshot()` (called by the PuxiState mutators: toggle/setvel/clear/**nav-notes**/
  **mutetrack**/**solotrack**/**dupblock**/**doubleloop** — not by nav-steps/follow, which change
  block/follow persisted elsewhere). **`setloop`, `setprob`/`pprob`, `setgate`/`plength`,
  `setratchet` AND `pplock1/2` snapshot deferred** (`scheduleLoopSnap`/`scheduleProbSnap`/
  `scheduleGateSnap`/`scheduleRatchetSnap`/`scheduleLockSnap`, 250 ms debounce): one encoder turn /
  drag = **a single undo step** instead of one per detent/pixel. ⚠️ **Loop undo from the Push
  encoder: imperfect** — the edit creates TWO undo entries (the native `live.*` param **plus**
  PuxiState) and the detents can re-absorb the param's undo (Live's restore order not guaranteed).
  Mitigated by a **detent resync in `applyRestore`** (`magStart/magEnd.last`), but not 100%. The
  GUI ruler doesn't go through the native param → **a single, clean step**. Plan B if needed: grab
  encoders 2/3 (relative rotation) to remove the undoable native param. **Guarded by
  `restoreSettled`** so it never overwrites the saved value before it has been restored. `pstate`
  deserializes it (apply-once via `pendingRestore`) **without touching LiveAPI** (it can arrive
  before `live.thisdevice`) → `init`/`selfInit` repaints afterward.
- **Native Live undo/redo — free via the param.** Since the pattern is a Live parameter, **Cmd+Z
  / Cmd+Shift+Z** undo/redo the pattern edits (+ note bank) with no dedicated code. ⚠️ The `pstate`
  echo guard must compare to the **current state** (`serialize()`), **not** remember the last value
  pushed: a **redo** re-applies that same last value → a value-based guard would mistake it for an echo
  and ignore it (redo of the *last* step failed). `follow`/`block`/`loop` are **not** undoable
  (the `set` path with no echo → no undo step).
- **Loop detents on restore**: `pstart`/`pend` go through `loopMagnetic` (incremental detents). On
  reload, Live sets an **absolute** value → the detent would absorb the jump (the loop would land in
  the wrong place). We **bypass the detents during the load window** (`loopRestoreWindow`, closed
  by `settleRestore` ~800 ms after init) → direct restore; normal detents afterward.
- ⚠️ **Do NOT** use `save()`/`embedmessage()` (the Max-standalone path; broken in M4L). Any `.maxpat`
  change (the sub-patcher, the `route … state`) requires re-running `build-amxd.py`.

The `t`/`s` coordinates of the `cell`/`label`/`toggle`/`setvel` messages are **view-relative**
(0..7 × 0..7 — the 8×8 view, which maps 1:1 onto the Push pads). The engine maps them to absolute
notes/steps via `noteBase` and `stepBase`. Loop start/end exposed as Live params are **1-based**
for the Push display; the engine converts them to a 0-based `[loopStart, loopEnd)` region.
**Encoders (2026-07-03)**: Follow(1), Loop Start(2), Loop End(3), **Vel(4)**, Prob(5), Length(6),
Lock1(7), Lock2(8). The **Block param was removed** (encoder 2 used to drive it; paging is done
with the **< Page / Page >** buttons) → ⚠️ `stepBase` (shown block) **no longer persists** in the
Set (returns to block 1 on reopen). **Vel** (`pvel`): pad held → the note's velocity; scene held →
the whole row, relative (see ROW velocity above); nothing held →
**global offset** `gVel` (`effVel = clamp(own + gVel − 100, 1, 127)`, neutral 100, rides the Vel
param like `gProb`/`gGate`) applied **everywhere**: playback, pad brightness
(`padLitColor`/`shimmerRoll` via `effVel`), the GUI (msg `gvel`) and the **exported clip**.
`sendParams()` is called on every `sendFullState()` to keep the params in sync with the view
(follow auto-scroll included).

**Phase 2 — Drum Rack (dynamic names/colors).** The engine reads the track's Drum Rack:
`findDrumRack()` does a **depth-first** search (recursive `findDrumIn`) for a device of `class_name`
**`DrumGroupDevice`** in `this_device canonical_parent` (descends into racks' `chains` → finds a
**nested** Drum Rack). `scanDrumRack()` reads, per row (row r → note `NOTE_LO+r`), `drum_pads
<note> chains 0` → `name` + `color`. **`color` = the integer `0xRRGGBB`** (e.g. `16725558` =
`0xFF3636`), decoded to `[r,g,b]` 0..255. Stored in `rowName[]`/`rowColor[]`, pushed to the GUI via
`label`/`color` in `sendFullState` (fallback to the note name + default palette if no pad).

**Live updates**: `initDrumObservers()` sets a **persistent** observer on the track's `devices`
(rack swap); `setupChainObservers()` observes each chain's `color`/`name`. Any fire →
`drumRescanTask` (80 ms debounce) → `doDrumRescan()` (re-setup the chain observers if the rack
changed + `scanDrumRack` + `sendFullState`). The `devices` observer is created **once** (never
recreated → no loop); the recreated chain observers only trigger a rescan (not a re-setup).

**Color on the Push pads**: no readable palette table (sysex only, unreadable from M4L; phone
photos too imprecise for exact RGB). We **quantize by hue**: `rgbHue()` → `nearestPaletteIndex()`
maps the chain color to the nearest hue among **known-exact Push index anchors** (`PUSH_HUE_ANCHORS`:
red 127, orange 3, yellow 8, green 126, blue 125, purple 22, pink 25; white 122 if desaturated).
Trade-off: ~7 color families (same-hue shades merge).

**Velocity → brightness on the pads — DONE via palette steps (2026-07-02).** The old "dead end"
conclusion is **reversed**: a pad's brightness is still **not directly controllable** (the 4th arg of
`send_value` is ignored — still true), **but the fixed 128-index palette contains darker variants
of the same hues**. Method: a **full sweep** of the palette on the pads (DIAG: 2 pages of 64
indices), then picking 3 levels per hue **by eye on the hardware** (photos lie about hues; the
bank/row/column coordinates → index). Result = **`VEL_LADDER`**: `[low, medium, high]` per anchor
— red `[68,67,127]`, orange `[70,69,3]`, yellow `[78,79,8]`, green `[85,32,126]`, blue
`[100,19,125]`, purple `[110,22,23]` (anchor 22 = the **medium** level), pink `[116,115,25]`, white
`[124,121,122]`. `pushSetPad` quantizes velocity into 3 levels (`velLevel`: 1-42 / 43-84 /
85-127); an anchor with no ladder (the no-rack fallback `PUSH_ON_COLOR`) stays at a fixed
brightness. Off-loop/muted gray re-picked along the way: `PUSH_OFFLOOP_COLOR = 55` (was 6).

**Probability → "shimmer" on the pads — CAPPED by velocity (2026-07-02, revised 2026-07-03).** The
shimmer **never exceeds** the step's velocity level (the old version that picked the pair from
probability alone was **abandoned**: it made velocity hard to read). A probabilistic note alternates
between its **velocity level (top)** and the level **just below (bottom)** — `shimmerPair(lad, vel)`
returns `[bottom, top]` where `top = lad[velLevel(vel)]` and `bottom = lad[velLevel−1]` (or **0 =
off** below "low"): **high** velocity → high↔medium, **medium** → medium↔low, **low** → low↔off.
The chance of showing the **top** = **p/100** → the lower p, the more the pad stays on the
**bottom** (down to off for a low velocity). **p 100 = static** (velocity level), **p 0** = resting
on the bottom level. `probBlinkTask` (~180 ms, started/stopped by `setGrabbed`) redraws **only** the
shimmering pads (cache `probShown`, resend on change) with a **random roll per frame** (the flicker
suggests a dice roll); it skips the playhead, off-loop, and muted cells. `pushSetPad` sets the **base**
to the bottom level (`shimmerPair(...)[0]`) for p<100; `setprob`/`pprob` re-base the pad live (the
shimmer updates as you turn the encoder). Brightness **encodes probability** (flicker frequency)
**under the velocity ceiling** → the two stay legible together. ⚠️ `probBlinkTick` **skips
ratcheted cells**: their probability shimmer rides the **ratchet strobe** flashes (`shimmerRoll`,
see Ratcheting → Display on the pads).

Any new feature extends this protocol — document it here.

## Roadmap

- **Phase 1 (complete)**: 8×8 grid view onto a 64-step pattern, transport sync, playhead, MIDI
  output to a Drum Rack, velocity (brightness + drag/hit), note-bank navigation (piano-roll
  orientation: **low notes at the bottom**, ▲ = higher — a GUI-only display flip, the data model
  unchanged) and step blocks, follow playhead, an adjustable loop region with handles.
  **Push 3 — full parity**: pads (velocity play + mirrored LEDs + playhead + off-loop gray),
  arrows (nav, grabbed on focus, **LED lit only when nav is possible**), encoders **exposed as
  Live params → native screen** (Follow / Loop Start / Loop End / **Vel** / Prob / Length /
  Lock1 / Lock2; **detents** on the loop bounds, **ON**/off label; the Block param was **removed**
  — paging via the Page buttons), momentary follow on encoder 1's touch, **Accent** (max velocity +
  LED), **nav** on the **Octave +/- (banks) / < Page · Page > (blocks)** buttons, **Convert**
  (export → MIDI clip). The screen-row buttons (Follow `Track_State_Button0`, block indicator
  `Track_Select_Button0..7`) keep their **indicator LED** (driven **without a grab**) but their
  **click stays native** (2026-06-25) — M4L doesn't detect Push's Settings/browser modes, so we
  don't steal the click → see the Push 3 integration section. **Push 3 standalone: 100% compat
  validated on hardware** (see the Push 3 integration section).
- **Phase 2** (in progress):
  - ✅ **Dynamic names/colors from the Drum Rack** (LiveAPI observers on the chains) — done. GUI:
    exact colors + velocity→brightness; Push pads: nearest hue. The **velocity → Push pad
    brightness**, long thought a "dead end", is **DONE 2026-07-02** via palette steps (`VEL_LADDER`,
    3 levels per hue picked on the hardware) — see the Drum Rack section.
  - ✅ **Pattern persistence in the Set — DONE** (2026-06-22). The pattern (+ note bank) is saved
    per instance with the Set via a **`pattr PuxiState` in a sub-patcher** (Live param type 3);
    follow/block/loop via their `live.*` params. See Protocol → Persistence. A prerequisite for
    undo/redo (upcoming).
  - ✅ **Per-track mute/solo — DONE (Live + Push)** (2026-06-26). Live: click the **name** = mute
    (row dimmed), click the **"S"** (left of the name) = **exclusive** solo. Push: hold
    **Mute**/**Solo** + tap a **scene button** (aligned with the row); scene LEDs = audibility (all
    lit while held), pads grayed if not audible. **Persisted + undoable** (PuxiState v2). See the
    Push 3 integration + Protocol sections.
  - ✅ **Polyrhythm — per-note loop lengths — DONE (Live + Push)** (2026-06-29). A **global** loop
    the notes **follow** + **custom** (frozen) per-note loops; independent phase locked at start →
    a **per-note** playhead. Push: holding a **scene** targets the note for the Loop Start/End
    encoders, release = back to global; a global edit does **not** move the custom ones; a custom
    one **rejoins** the global loop if its value matches. GUI: the ruler = the global loop, dimming +
    playhead **per row**. Persisted in PuxiState **v4**. ⚠️ Loop undo **from the Push encoder is
    imperfect** (native param + PuxiState + detents); the GUI ruler is clean. See the Push 3
    integration + Persistence sections.
  - ✅ **Groove Pool / Swing — following the amounts — DONE** (2026-07-03). Since the API does not expose a groove's shape
    (see Hard constraints), Puxi **follows `groove_amount` +
    `swing_amount`** and applies them as **swing** (offbeat 16ths delayed ∝ the capped sum),
    playback **and** exported clip. 100% JS. See the Groove/swing section.
- **New ideas (to schedule/refine)**:
  - ✅ **Native Live undo/redo for the pattern — DONE** (the pattern is a Live parameter
    `PuxiState` → Cmd+Z / Cmd+Shift+Z undo/redo the pattern edits + bank). Optional follow-up: make
    **follow/block/loop** undoable too (the current `set` path = no undo step).
  - ✅ **Export → MIDI clip — DONE (Live + Push)** (extended 2026-07-03). GUI `>CLIP` button + the
    Push **Convert** button → `exportclip()`: a clip in the first empty slot, length = last
    occupied step rounded up to the beat. **Embeds everything Puxi adds** (see Export): duration =
    `effGate% × step` (ties = long notes), native **`probability`** (Live 11+) = `effProb/100`,
    ratchets **expanded** into R evenly-spaced notes, **printed swing** (offbeat 16ths shifted in the
    `start_time`), global offsets folded in, name `Puxi`. `add_new_notes` (Live 11+); Convert LED =
    presence of notes; deferred Push press (see the Push 3 integration section). ⚠️ mute/solo **not
    applied** + polyrhythm **not unrolled** (the clip = the programmed grid); ratchet+probability:
    each sub-note rolls **independently** in Live (Puxi rolls 1×/step); swing = a snapshot.
  - ✅ **Piano-roll orientation (low notes at the bottom) — DONE (Live + Push)** (GUI display-only +
    `pushRow` on the Push side; the data model unchanged).
  - ✅ **Double Loop (×2) — DONE (Live + Push)** (2026-06-29). Doubles the **global** loop (end ×2,
    start fixed) + copies its notes into the new half; available iff notes in the loop, it fits in
    8 blocks, the target region is empty. Push `Double_Button` + GUI `x2` button. See the Push 3
    integration + Protocol sections.
  - ✅ **Duplicate a block to another — DONE (Live + Push)** (2026-06-29). Push: **hold
    `Duplicate_Button`** → momentary grab of the 8 screen buttons; tap a block = copy (LED blinks),
    tap another = paste; release = native. Duplicate LED = ≥1 full block & ≥1 empty. GUI: **`DUP`**
    button (copy the shown block → navigate → paste). `dupblock src dst`, undoable. See the Push 3
    integration + Protocol sections.
  - ✅ **Delete (Push) — DONE** (2026-07-03). **Hold `Delete_Button`** → a **scene** clears all
    steps of its row, a **screen-row button** clears a whole block (all rows); released = scenes
    mute/solo + block buttons native. LED hints on the rows/blocks with content. Undoable, Push
    only (no GUI counterpart). See the Push 3 integration section.
  - ✅ **Parameter lock (p-lock) — DONE (Push)** (2026-07-03). Hold a **pad** → enc. 7/8 lock 2 of
    the pad device's params (per step); hold a **scene** → enc. 7/8 = a per-row offset that affects
    **all** notes (like global probability). Written on each tick (opt-in), PuxiState v8, 2 Live
    params (rebuild). ⚠️ fixed labels (Push doesn't re-read names). Push only. See the Push 3
    integration → Parameter lock.
  - ✅ **Catch existing MIDI clip — DONE (Live)** (2026-07-03). GUI **`GET`** button → `catchclip`:
    reads the clip from the editor (detail view) / selected slot → replaces the pattern (pitch→row,
    start→step quantized to the 16th, velocity/duration/probability → cell), sets the loop to the
    length. Ratchets not reconstructed, replaces (no merge). Push not covered yet (Push parity is a possible follow-up).
    See the Catch section.
- **Phase 3** (started): ✅ **per-step probability — DONE (Live + Push)** (2026-07-02; statistical
  random playback, pad hold → "Prob" encoder, horizontal drag in the GUI, PuxiState v5). ✅
  **Velocity → pad brightness + probability "shimmer" — DONE** (2026-07-02; `VEL_LADDER` 3
  levels/hue + weighted alternation — see the Drum Rack section). ✅ **Global probability — DONE**
  (2026-07-02; Prob encoder with no pad held = a non-destructive offset on all notes — see the Push 3
  integration section). ✅ **Per-step gate/length — DONE (Live + Push)** (2026-07-02; pad hold →
  "Length" encoder (5..6400% = 1..64 steps), a tie/legato that **spills over** into the following pages/loops
  (real duration), global = a non-destructive offset with no pad held, horizontal drag (right third) in
  the GUI, incoming/outgoing visual trail, PuxiState v6 — see the Length/gate section). ✅
  **Per-step ratcheting — DONE (Live + Push)** (2026-07-03; hold **Repeat** → scenes = division
  1..8, tap a pad = paint the ratchet; playback = R evenly-spaced sub-hits (scheduled `Task`s,
  closure — not `Task.arguments`); GUI = notches + Shift+vertical drag; per cell (no global),
  PuxiState v7 — see the Ratcheting section). ✅ **Groove Pool / Swing — following the amounts —
  DONE** (2026-07-03; observes `groove_amount` + `swing_amount`, delays the offbeat 16ths ∝ the
  capped sum, playback + export; the exact shape not exposed by the API → approximated as swing —
  see the Groove/swing + Hard constraints sections). **Phase 3 CLOSED (2026-07-03).**
- **Future-iteration ideas (unplanned — kept on the back burner)**:
  - **Conditional trigs** (Elektron style): a step plays only "1 loop out of 2 / 3", "the first
    time", "fill", etc. — complements probability, big rhythmic impact.
  - **Choke groups**: mutual exclusion between rows (open hat cut by the closed hat).
  - **Per-step micro-timing / nudge** (humanize) beyond the global swing.
  - **MPE**: considered but **set aside** for a drum sequencer (per-note pitch/pressure/slide =
    melodic play; the "modulate a param per step" need is already better covered by p-locks).
    Kept only if a concrete use case appears.
  - Make **follow/block/loop** undoable (the current `set` path = no undo step); **Push** for Catch
    (no obvious button); persist `stepBase` (shown block) after the Block removal.
- **Phase 4 (STARTED, 2026-07-03)**: polish, freeze, docs, open-source release. Workstreams:
  (1) **Open-source hygiene** — `LICENSE` (GPLv3), `README.md` (overview + install + usage +
  credits), `.gitignore` review / uncommitted personal files; (2) **Docs** — `MANUAL.md` ✅ up to
  date, `SETUP.md` (install + tests), screenshots; (3) **Polish** — a bug / edge-case sweep;
  (4) **Freeze** — a frozen release export (the snowflake button in Max, **manual** — see the dev vs.
  frozen-export section).

## Conventions

- English throughout — code, comments, and project docs.
- Conservative JS (`var`, named functions) compatible with v8/v8ui without transpilation.
- One commit per working feature tested in Live. Don't commit a frozen .amxd during dev (binary)
  — the .maxpat + .js are the source of truth.
- On every commit that changes visible behavior, update **both** the project doc (CLAUDE.md)
  **and** the user manual (`docs/MANUAL.md`).
- Regenerate the `.amxd` after any `.maxpat` change: `python3 tools/build-amxd.py` (grafts the
  patch into the M4L container, **declares the `.js` in `dependency_cache`** — essential for
  reliable resolution on reload — `.prev` backup). The `.js` files in the Live User Library are symlinks to the repo
  → a single source of truth; for a .js change, editing the repo is enough.
- Test each increment in Live before stacking the next feature (see the test checklist in
  docs/SETUP.md).

## Dev device vs. frozen export (don't confuse them)

Two distinct `.amxd` artifacts, with **opposite** life cycles:

- **DEV device** — `~/Music/Ableton/User Library/…/Puxi/Puxi.amxd`, **unfrozen**. References the
  `.js` **by name** (symlinks → repo). Regenerated by `build-amxd.py`, which grafts **only the
  patcher** → stays **unfrozen** (never embeds the JS). This is the daily dev device: edit the
  repo `.js` + reload the device (remove/re-add) and you're done.
- **FROZEN export** — a **separate** file, made by hand in Max (the snowflake **Freeze Device** button,
  then **File → Save As**). **Embeds** a copy of the JS frozen at the moment of freezing. This is what you transfer to
  Push (standalone) / share. **Disposable**: **re-freeze a fresh copy** for each release to embed
  the current code (otherwise you ship stale JS).

Rules:
1. **Never a plain "Save" onto the dev device after a Freeze** — always **Save As** to another
   file. Otherwise the dev device runs **frozen** JS (the symlinks are bypassed) until the next
   `build-amxd.py` unfreezes it. A pitfall actually hit (2026-06-21): an old pre-Phase-2 freeze was
   lying around as `./Puxi.amxd`.
2. **Keep the frozen export outside the dev folder** (e.g. `…/Max MIDI Effect/Puxi Standalone/`)
   for zero confusion in the Live browser.
3. **Detect an `.amxd`'s state**: a **frozen** file embeds the JS (`grep -a -c "function "
   Puxi.amxd` is high; ~59 KB frozen vs ~14 KB unfrozen for Puxi); an unfrozen one only holds
   **references by name** (`puxi-engine.js`).

## Reference docs

- Live API in JS (LiveAPI): https://docs.cycling74.com/max8/vignettes/jsliveapi
- Live Object Model (LOM): https://docs.cycling74.com/max8/vignettes/live_object_model
- v8: https://docs.cycling74.com/max8/refpages/v8 — v8ui: .../refpages/v8ui
- mgraphics: https://docs.cycling74.com/max8/vignettes/jsmgraphics
- If a page is missing, look for the same vignette in the max9 version.
