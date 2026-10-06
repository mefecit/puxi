// SPDX-License-Identifier: GPL-3.0-only
// Copyright (C) 2026 mefecit <pest-kernels-6r@icloud.com>
// ============================================================
// Puxi — 8-track drum sequencer for Max for Live
// puxi-engine.js — sequencer engine, runs inside a [v8] object
//
// Responsibilities (Phase 1 MVP):
//   - Hold the full pattern (NUM_NOTES note rows x TOTAL_STEPS)
//   - Expose a viewport (VIEW_TRACKS x VIEW_STEPS) scrolled by note banks and
//     step blocks via "nav" — the GUI only ever sees the current window
//   - On each transport tick, derive the current step from Live's song position
//     and fire active notes across the WHOLE pattern
//   - Follow playhead: when enabled, the step view snaps to the playing block
//   - Talk to the GUI (v8ui): cell/playhead/label/view, receive nav/follow/toggle
//
// Output: a SINGLE outlet carrying tagged messages (see emit() below):
//   "note pitch vel dur" -> [makenote]
//   "gui …"   -> [v8ui]: "cell t s v", "cprob t s p", "clen t s g", "cratchet t s r", "playheads s0..s7",
//                "label t name", "color t r g b", "loop t ls le", "loopsel selT ls le", "view … follow",
//                "musolo t m s sa", "dbl 0|1", "tailin t extent", "gprob v", "glen v", "gvel v", "clear"
//   "param …" -> Live params "follow"/"start"/"end"/"vel"/"prob"/"length"/"plock1"/"plock2" v
//                (-> route -> set; no echo), plus "state <ints…>" -> the PuxiState pattr
// Inlet:
//   0 <- "init"/"tick" (patch), "toggle t s" / "setvel t s v" / "setprob t s p" / "setgate t s g" /
//        "setratchet t s r" / "nav axis delta" / "follow [0|1]" / "setloop start end" / "refresh" /
//        "exportclip" / "catchclip" (GUI),
//        "pfollow"/"pstart"/"pend"/"pvel"/"pprob"/"plength"/"pplock1"/"pplock2" v (from the exposed Live params)
//
// View model: the GUI sends VIEW-relative (t, s). The engine maps them to the
// absolute note row noteBase + t and step stepBase + s.
// ============================================================

autowatch = 0; // OFF: autowatch reloads the script when a Set reopens, which briefly
               // drops the v8 outlets -> Max deletes the patch cords (v8->GUI/params)
               // -> blank GUI + dead params until re-add. Reload the device manually
               // after editing this .js: delete it from the track and drag it in again
               // (switching it off and on does not reload the script).
inlets = 1;
outlets = 1; // SINGLE outlet on purpose. A v8's outlet count is set by the script,
             // but on Set reopen Max restores the patch cords BEFORE the script runs,
             // so any cord to an outlet > 0 is "out of range" and gets deleted (blank
             // GUI + dead params). With one outlet (the v8 default) the lone cord
             // always survives; a [route note gui param] in the patch fans it back out.
// Outlet 0 carries tagged messages, split downstream by [route note gui param]:
//   "note <pitch> <vel> <dur>"  -> [makenote]      (MIDI)
//   "gui <...>"                 -> [v8ui]           (the GUI messages listed in the header)
//   "param <...>"               -> Live params      (follow/start/end/vel/prob/length/plock1/plock2
//                                                    + state -> the PuxiState pattr)
function emit(tag, a) { var m = [0, tag]; for (var i = 0; i < a.length; i++) m.push(a[i]); outlet.apply(null, m); }
function note()  { emit("note",  arguments); }
function gui()   { emit("gui",   arguments); }
function param() { emit("param", arguments); }

// ---- Constants ----------------------------------------------------
var VIEW_TRACKS = 8;          // visible rows
var VIEW_STEPS = 8;           // visible columns (one step block) — matches Push 8x8
var TOTAL_STEPS = 64;         // pattern length = 8 blocks of 8 steps
var NOTE_LO = 36;             // lowest addressable MIDI note (C1)
var NUM_NOTES = 32;           // addressable note rows -> 4 banks of 8 (C1..G3)
var DEFAULT_VELOCITY = 100;
var DEFAULT_GATE = 100;       // note length as % of one step: 100 = full step,
var MIN_GATE = 5, MAX_GATE = 6400; // <100 = staccato, >100 = tie across steps (up to 64)
var RATCHET_MAX = 8;          // per-step ratchet: 1 = one hit (default), up to 8 sub-hits
var SWING_MAX = 0.5;          // swing depth at groove_amount 1.0: offbeat 16ths delayed by this * a step

var NOTE_NAMES = ["C", "C#", "D", "D#", "E", "F", "F#", "G", "G#", "A", "A#", "B"];

// ---- State --------------------------------------------------------
var pattern = [];      // pattern[noteRow][step] = velocity (0 = off)
var prob = [];         // prob[noteRow][step] = the note's OWN probability 0..100 (100 = always)
var gProb = 100;       // GLOBAL probability (Prob encoder with no pad held): an OFFSET on
                       // every note — effective = clamp(own + gProb - 100). Own values stay
                       // stored, so raising gProb back restores them exactly. Persists via
                       // the Prob live.* param (NOT PuxiState / initPattern).
var gate = [];         // gate[noteRow][step] = the note's OWN length, % of a step (100 = full)
var gGate = 100;       // GLOBAL length offset (Length encoder, no pad held), same as gProb.
                       // Persists via the Length live.* param, not PuxiState / initPattern.
var gVel = 100;        // GLOBAL velocity offset (Vel encoder, no pad held), same as gProb:
                       // effVel = clamp(own + gVel - 100, 1, 127). Rides the Vel live.* param.
var ratchet = [];      // ratchet[noteRow][step] = # of evenly-spaced sub-hits in the step (1 = none)
var PLOCK_N = 2;       // p-lock: # of locked params (Push encoders 7 & 8)
var PLOCK_MID = 64;    // neutral value of a per-row offset (like gProb's 100): no effect
var plock = [];        // plock[r][step] = [a, b] per-STEP lock, normalized 0..127, -1 = no lock
var plockBase = [];    // plockBase[r] = [a, b] per-ROW offset, 0..127 (64 = neutral) -> affects ALL notes
var padParam = [];     // padParam[r] = [{api,min,max,name}, …] LiveAPI handles for the pad's params (or null)
var plockHome = [];    // plockHome[r][i] = the pad param's OWN value (real units), saved before a lock moved it
var plockOver = [];    // plockOver[r][i] = true while a lock holds that param away from its own value
var noteBase = 0;      // top visible note row (a multiple of VIEW_TRACKS)
var stepBase = 0;      // leftmost visible step (a multiple of VIEW_STEPS)
var gLoopS = 0, gLoopE = 8; // GLOBAL loop region; a note follows it unless it's custom
var loopStartN = [];   // per note row: CUSTOM loop start (meaningful only when loopCustom[r])
var loopEndN = [];      // per note row: CUSTOM loop end (exclusive)
var loopCustom = [];    // per note row: 1 = own (frozen) loop, 0 = follows the global loop
var loopSelN = -1;      // loop-edit target: -1 = GLOBAL, >=0 = that single note
var followPlay = true; // when playing, snap the step view to the playing block
var liveSet = null;
var lastStep = -1;     // selected note's current step (drives follow + stop reset)
var lastRawStep = -1;  // last absolute 16th index processed (whole-tick dedup)
var lastStepN = [];    // per row: last played step (per-note retrigger dedup)
var inited = false;    // init() ran once (guards the "init" message + self-init retry)
var muted = [];        // muted[noteRow] = 1 -> sequencer doesn't output that row
var soloed = [];       // soloed[noteRow] = 1 -> when any row is soloed, only soloed rows play
var soloCount = 0;     // # of soloed rows (cache; >0 = solo active)
var grooveAmount = 0;  // Live's global groove amount (0..1, observed) -> Puxi swing depth
var grooveObs = null;  // LiveAPI observer on live_set groove_amount (kept alive)
var swingAmount = 0;   // Live's global swing amount (0..1, observed) -> adds to Puxi swing (live only)
var swingObs = null;   // LiveAPI observer on live_set swing_amount (kept alive)

function clamp(v, lo, hi) {
    return v < lo ? lo : (v > hi ? hi : v);
}

function noteName(n) {
    return NOTE_NAMES[n % 12] + (Math.floor(n / 12) - 2); // 36 -> C1
}

function blockOf(step) {
    return step - (step % VIEW_STEPS);
}

function initPattern() {
    pattern = [];
    prob = [];
    gate = [];
    ratchet = [];
    muted = [];
    soloed = [];
    soloCount = 0;
    loopStartN = [];
    loopEndN = [];
    loopCustom = [];
    lastStepN = [];
    plock = [];
    plockBase = [];
    gLoopS = 0; gLoopE = VIEW_STEPS; // default global loop = first 8-step block
    loopSelN = -1; // -1 = GLOBAL (encoders/ruler edit the global loop); >=0 = that note
    for (var r = 0; r < NUM_NOTES; r++) {
        var row = [], prow = [], grow = [], rrow = [], lrow = [];
        for (var s = 0; s < TOTAL_STEPS; s++) { row.push(0); prow.push(100); grow.push(DEFAULT_GATE); rrow.push(1); lrow.push([-1, -1]); }
        pattern.push(row);
        prob.push(prow); // default 100% (always plays)
        gate.push(grow); // default full-step length
        ratchet.push(rrow); // default 1 hit (no ratchet)
        plock.push(lrow); // no per-step locks
        plockBase.push([PLOCK_MID, PLOCK_MID]); // per-row offset, neutral = no effect
        muted.push(0);
        soloed.push(0);
        loopStartN.push(0);
        loopEndN.push(VIEW_STEPS);
        loopCustom.push(0); // every note follows the global loop initially
        lastStepN.push(-1);
    }
}

// A note's EFFECTIVE loop: its own when custom, otherwise the global loop.
function eLoopS(r) { return loopCustom[r] ? loopStartN[r] : gLoopS; }
function eLoopE(r) { return loopCustom[r] ? loopEndN[r] : gLoopE; }

// A row is heard if it's not muted AND (no row is soloed, or it is one of the soloed).
function audible(r) { return !muted[r] && (soloCount === 0 || soloed[r]); }

// A cell's EFFECTIVE play probability / length: its own value shifted by the global offset.
function effProb(r, step) { return clamp(prob[r][step] + gProb - 100, 0, 100); }
function effGate(r, step) { return clamp(gate[r][step] + gGate - 100, MIN_GATE, MAX_GATE); }
function effVel(r, step) { return clamp(pattern[r][step] + gVel - 100, 1, 127); }
initPattern();

// ---- Live API -----------------------------------------------------
// Called by [live.thisdevice] -> "init" once the device is fully loaded.
// LiveAPI is NOT reliable before that point. sendFullState() here covers the
// "GUI already ready" ordering; the GUI also pulls via "refresh" (see refresh()).
function init() {
    if (inited) { sendFullState(); return; } // idempotent: re-entry just re-pushes state
    liveSet = new LiveAPI(onLiveChange, "live_set");
    liveSet.property = "is_playing"; // observe transport state
    grooveObs = new LiveAPI(onGrooveAmount, "live_set"); // follow the global groove amount (swing)
    grooveObs.property = "groove_amount"; // fires once now with the current value
    try { onGrooveAmount(["groove_amount", grooveObs.get("groove_amount")]); } catch (e) {} // seed it explicitly too
    swingObs = new LiveAPI(onSwingAmount, "live_set"); // ...and the global swing amount (Quantize swing)
    swingObs.property = "swing_amount";
    try { onSwingAmount(["swing_amount", swingObs.get("swing_amount")]); } catch (e) {}
    inited = true;                   // core LiveAPI is up: setup below runs exactly once
    try { scanDrumRack(); } catch (e) { post("Puxi drum scan err: " + e + "\n"); }
    sendFullState();
    post("Puxi engine ready\n");
    post("Puxi TEST BUILD for Push 2, not a release\n"); // TEST BUILD
    try { pushInit(); } catch (e) { post("Push init failed: " + e + "\n"); }
    try { initDrumObservers(); } catch (e) { post("Puxi drum obs err: " + e + "\n"); }
    // Reopening a Set races the engine/GUI/Push load order: the grab happens but the
    // first render can fire before the GUI / Push pads are ready, and isn't re-sent
    // (re-focusing doesn't change the grab state). So re-push the full state a few
    // times — idempotent, just re-renders the current state to catch late loaders.
    initCatchupN = 0;
    if (!initCatchupTask) initCatchupTask = new Task(initCatchup);
    initCatchupTask.schedule(350);
    // If a Set-reopen snapshot (pstate) landed before LiveAPI was up, flush it now.
    // INVARIANT: init() must NOT call initPattern() — applyRestoreIfReady() may have
    // already restored the grid before init() runs, and zeroing here would wipe it.
    applyRestoreIfReady();
    // Fresh device / no saved state: open the push gate shortly after load so edits
    // get saved. A real reopen sets restoreSettled earlier, via pstate().
    if (!settleTask) settleTask = new Task(settleRestore);
    settleTask.schedule(800);
}
var initCatchupTask = null;
var initCatchupN = 0;
function initCatchup() {
    sendFullState();
    initCatchupN++;
    if (initCatchupN < 3 && initCatchupTask) initCatchupTask.schedule(350);
}

// Per-row Drum Rack name + color (row r -> note NOTE_LO+r), filled by scanDrumRack().
// Color is [r,g,b] 0..255 decoded from the chain's 0xRRGGBB; null = no pad -> the GUI
// falls back to the note name + its default palette color.
var rowName = [];
var rowColor = [];

// Parameter lock (p-lock): see the state declarations near the top (plock/plockBase/padParam),
// which MUST be declared before initPattern() runs so its initializer can't clobber them.

// Find the Drum Rack feeding Puxi: depth-first over the track's device tree, so a
// Drum Rack nested inside an Instrument/Effect Rack chain is found too.
function findDrumRack() { return findDrumIn("this_device canonical_parent"); }
function findDrumIn(path) {
    var host = new LiveAPI(path);
    var n = parseInt(host.getcount("devices"), 10) || 0;
    for (var i = 0; i < n; i++) {
        var dp = path + " devices " + i;
        var d = new LiveAPI(dp);
        var cls = "" + d.get("class_name");
        if (cls === "DrumGroupDevice") return d;
        if (cls.indexOf("GroupDevice") >= 0) { // a rack -> has chains, recurse (avoids getcount errors on plain devices)
            var nc = parseInt(d.getcount("chains"), 10) || 0;
            for (var c = 0; c < nc; c++) {
                var found = findDrumIn(dp + " chains " + c);
                if (found) return found;
            }
        }
    }
    return null;
}

// Read each row's drum-chain name + color (row r -> MIDI note NOTE_LO+r), and resolve the
// pad's first-device parameter handles for the p-lock (parameters 1 & 2 = Macro 1/2 for a rack).
function scanDrumRack() {
    rowName = []; rowColor = []; padParam = [];
    plockHome = []; plockOver = []; // saved values belong to the old rack's params
    var rack = findDrumRack();
    for (var r = 0; r < NUM_NOTES; r++) {
        rowName[r] = null; rowColor[r] = null; padParam[r] = null;
        if (!rack) continue;
        var base = rack.unquotedpath + " drum_pads " + (NOTE_LO + r);
        var pad = new LiveAPI(base);
        if (!pad || parseInt(pad.id, 10) === 0) continue;
        if ((parseInt(pad.getcount("chains"), 10) || 0) < 1) continue;
        var cbase = base + " chains 0";
        var ch = new LiveAPI(cbase);
        rowName[r] = String(ch.get("name"));
        var col = parseInt(ch.get("color"), 10);
        if (!isNaN(col)) rowColor[r] = [(col >> 16) & 255, (col >> 8) & 255, col & 255];
        padParam[r] = resolvePadParams(cbase); // first device's params 1..PLOCK_N (skip 'Device On' at 0)
    }
}

// Resolve parameters 1..PLOCK_N of the first device on a pad chain (index 0 is 'Device On').
// Returns [{api,min,max,name}, …] (kept alive as LiveAPI handles) or null.
function resolvePadParams(cbase) {
    try {
        var dev = new LiveAPI(cbase + " devices 0");
        if (!dev || parseInt(dev.id, 10) === 0) return null;
        var np = parseInt(dev.getcount("parameters"), 10) || 0;
        var out = [];
        for (var i = 1; i <= PLOCK_N && i < np; i++) {
            var pa = new LiveAPI(cbase + " devices 0 parameters " + i);
            if (pa && parseInt(pa.id, 10) > 0) {
                out.push({ api: pa, min: parseFloat(pa.get("min")), max: parseFloat(pa.get("max")),
                           name: String(pa.get("name")) });
            }
        }
        return out.length ? out : null;
    } catch (e) { return null; }
}

// Clamp a restored lock/base value: -1 (unset) or 0..127.
function clampLock(v) { v = v | 0; return v < 0 ? -1 : (v > 127 ? 127 : v); }
// Normalized 0..127 <-> the target parameter's real range.
function plockToVal(h, norm) { return (h.max <= h.min) ? h.min : h.min + (norm / 127) * (h.max - h.min); }
function valToNorm(h, v) {
    if (h.max <= h.min) return 0;
    return clamp(Math.round((v - h.min) / (h.max - h.min) * 127), 0, 127);
}

// A lock applies to its own step only: before a lock first moves a pad param, save the param's
// own value, and put it back on the next step that has no lock (or when playback stops).
function overrideParam(r, i, h, real) {
    if (!plockHome[r]) { plockHome[r] = []; plockOver[r] = []; }
    if (!plockOver[r][i]) {
        var own = parseFloat(h.api.get("value"));
        plockHome[r][i] = isNaN(own) ? real : own;
        plockOver[r][i] = true;
    }
    h.api.set("value", real);
}
function restoreParam(r, i, h) {
    if (!plockOver[r] || !plockOver[r][i]) return;
    plockOver[r][i] = false;
    h.api.set("value", plockHome[r][i]);
}
function restoreAllParams() {
    for (var r = 0; r < NUM_NOTES; r++) {
        var hs = padParam[r];
        if (!hs) continue;
        for (var i = 0; i < hs.length; i++) { try { restoreParam(r, i, hs[i]); } catch (e) {} }
    }
}

// Playback: set the pad's target params to this step's lock (otherwise the row offset) right before
// the note sounds. A step with neither puts back any value an earlier lock moved (opt-in per row:
// rows never locked are never touched).
function applyPlocks(r, step) {
    var hs = padParam[r];
    if (!hs) return;
    for (var i = 0; i < hs.length; i++) {
        var own = plock[r][step][i];          // per-step lock, -1 = none
        var off = plockBase[r][i] - PLOCK_MID; // per-row offset (affects all notes; 0 = neutral)
        try {
            if (own < 0 && off === 0) { restoreParam(r, i, hs[i]); continue; }
            var eff = clamp((own >= 0 ? own : PLOCK_MID) + off, 0, 127);
            overrideParam(r, i, hs[i], plockToVal(hs[i], eff));
        } catch (e) {}
    }
}
// Apply one param live while editing (so you hear it as you turn the encoder).
function applyLockLive(r, i, norm) {
    var hs = padParam[r];
    if (hs && hs[i]) { try { overrideParam(r, i, hs[i], plockToVal(hs[i], norm)); } catch (e) {} }
}
// Show a step's locks (or a row's offset) on the Lock encoders (7/8). A stored value shows
// as-is; no lock -> the target's CURRENT value (so the encoder starts where the param is).
// (The screen keeps the fixed "Lock1/Lock2" labels: Push doesn't re-read a param's name when
// it changes at runtime — same limitation as the non-customizable screen.)
function showLocks(r, storedPair) {
    var hs = padParam[r];
    for (var i = 0; i < PLOCK_N; i++) {
        var disp;
        if (storedPair[i] >= 0) disp = storedPair[i];
        else if (hs && hs[i]) disp = valToNorm(hs[i], parseFloat(hs[i].api.get("value")));
        else disp = 0;
        param(i === 0 ? "plock1" : "plock2", disp);
    }
}

// ---- Live updates: follow the Drum Rack as it changes -------------
// Observe the track devices (rack add/remove/swap) + each drum chain's color/name,
// so Puxi re-scans when you swap racks or recolor/rename a pad — no reload needed.
var drumDevObs = null;       // persistent: track 'devices' changed
var drumChainObs = [];       // per-chain color/name observers (rebuilt on rack change)
var drumRescanTask = null;   // debounce: coalesce observer bursts
var drumResetupPending = false;

function onDrumDevices() { drumResetupPending = true; if (drumRescanTask) drumRescanTask.schedule(80); }
function onDrumChain() { if (drumRescanTask) drumRescanTask.schedule(80); }

function doDrumRescan() {
    if (drumResetupPending) { drumResetupPending = false; setupChainObservers(); }
    scanDrumRack();
    sendFullState();
}

// (Re)create the color/name observers for the current rack's chains. The creation
// fire only schedules a rescan (not a re-setup), so there is no observer loop.
function setupChainObservers() {
    drumChainObs = [];
    var rack = findDrumRack();
    if (!rack) return;
    for (var r = 0; r < NUM_NOTES; r++) {
        var base = rack.unquotedpath + " drum_pads " + (NOTE_LO + r);
        var pad = new LiveAPI(base);
        if (!pad || parseInt(pad.id, 10) === 0) continue;
        if ((parseInt(pad.getcount("chains"), 10) || 0) < 1) continue;
        try {
            var co = new LiveAPI(onDrumChain, base + " chains 0"); co.property = "color"; drumChainObs.push(co);
            var no = new LiveAPI(onDrumChain, base + " chains 0"); no.property = "name";  drumChainObs.push(no);
        } catch (e) {}
    }
}

// The track-'devices' observer is created once (never recreated -> no loop). It fires
// on creation too, which triggers the first chain-observer setup + rescan.
function initDrumObservers() {
    drumRescanTask = new Task(doDrumRescan);
    drumDevObs = new LiveAPI(onDrumDevices, "this_device canonical_parent");
    drumDevObs.property = "devices";
}

// Push 3 integration. Surface 1 is the real Push (RemoteControlSurfaceWrapper).
// We observe the arrow controls' "value" (press=127, release=0) and grab them
// ONLY while Puxi is the appointed (focused) device, so the arrows keep their
// normal Live navigation everywhere else. grab/release_control take the control
// as an object reference ("id N").
var PUSH_ON_COLOR = 2;      // pad LED: active step inside the loop
var PUSH_OFFLOOP_COLOR = 55; // pad LED: step outside the loop / muted row (grayed; picked on hardware 2026-07-02)
var PUSH_PLAY_COLOR = 126;  // pad LED: playhead column
var PUSH_FOLLOW_ON_COLOR = 126;  // Track_State_Button0 LED (LED-only): follow on
var PUSH_FOLLOW_OFF_COLOR = 124; // Track_State_Button0 LED (LED-only): follow off (dim gray)
var PUSH_BLOCK_LED = 10;         // Track_Select_Button LED (LED-only): green on the shown block
var pushCS = null;
var pushGrabIds = [];       // control ids grabbed while focused (arrows, encoders, buttons)
var pushMatrix = null;      // Button_Matrix control — LED out via send_value
var pushMatrixId = 0;
var pushObs = [];           // keep LiveAPI observers alive
var pushGrabbed = false;
var followMomentary = false; // encoder-1 touch turned follow on temporarily
var followTouchTask = null;  // debounce: a hold (not a turn) -> momentary follow
var followTouchPending = false;
var pushPlayColN = [-1, -1, -1, -1, -1, -1, -1, -1]; // per visible row: pad col lit as that row's playhead (-1 none)
var pushAfterGrab = null;   // deferred LED draw (grab must settle before send_value)
var pushRetryTask = null;   // poll for the Push until it connects (turned on after load)
var pushModel = 0;          // 3 = Push 3, 2 = Push 2 (experimental), 0 = none yet
var pushIndex = -1;         // control_surfaces index of the bound Push
var pushIdsStable = false;  // get_control hands back the same id for the same control (see pushWatch)
var pushWatchTask = null;   // while bound: still the same surface? (and on a Push 2: a Push 3 now?)
var PUSH_PROBE_MS = 2500;   // polling period of both probes
var PUSH_ACCENT_LED = 127;  // Accent button LED value when active (full)
var PUSH_ACCENT_LED_DIM = 5; // Accent button LED when inactive: dim, not off
var accentLatched = false;  // Accent toggled on (every pad-entered step = max vel)
var accentHeld = false;     // Accent button physically held (momentary)
var accentDownAt = 0;       // press timestamp, to tell a tap from a hold
var pushAccent = null;      // Accent_Button control (for its LED)
var pushAccentId = 0;
var pushArrows = null;      // {up,down,left,right} nav-button controls (Octave/Page) — LED out
var pushFollowBtn = null;   // Track_State_Button0 — LED only (NOT grabbed; native click kept)
var pushBlockBtns = null;   // Track_Select_Button0..7 LiveAPI handles (LED); momentarily grabbed in dup mode
var pushBlockIds = [];      // their control ids (for the momentary grab/release)
var pushDupBtn = null;      // Duplicate button (held = block copy/paste modifier)
var pushDupHeld = false;    // Duplicate currently held -> block buttons grabbed by Puxi
var dupSrc = -1;            // block copied (source) awaiting a paste target; -1 = none
var PUSH_DUP_BLINK = 126;   // copied-block LED color while it blinks (RGB index, calibrate)
var PUSH_DUP_ON = 127;      // Duplicate button LED when block copy/paste is available
var dupBlinkTask = null, dupBlinkOn = false;
var dupGrabTask = null;     // defer the block-LED repaint after grabbing the buttons
var PUSH_ARROW_LED = 127;   // arrow LED when that direction can still scroll (bright)
var PUSH_ARROW_LED_DIM = 5;  // arrow LED at a view edge: dim but visible, not off
var PUSH_CONVERT_ON = 127;  // Convert button LED: lit when the sequencer holds >=1 note
var pushConvert = null;     // Convert button control (for its LED)
var pushConvertId = 0;
var PUSH_DOUBLE_ON = 127;   // Double Loop button LED: lit when the loop can be doubled
var pushDoubleBtn = null;   // Double Loop button control (grabbed; for press + LED)
// Ratcheting: hold the Repeat button (modifier) -> the scene buttons pick the ratchet
// division (a level-meter bar 1..8 from the bottom), and a pad press paints that ratchet
// onto the step (entering a note if empty). Repeat is grabbed on focus (own press + LED).
var PUSH_REPEAT_LED = 127;  // Repeat button LED: held (full)
var PUSH_REPEAT_LED_DIM = 5; // Repeat button LED: available but not held (dim, not off)
var pushRepeatBtn = null;   // Repeat button control (grabbed; for press + LED)
var pushRepeatHeld = false; // Repeat currently held -> scenes = division, pad = paint ratchet
var ratchetSel = 2;         // ratchet division a pad press paints while Repeat is held (1..8)
// Delete: hold Delete -> scene buttons clear a note row, block buttons clear a block (all
// rows). Grabbed on focus (modifier + LED); block buttons momentarily grabbed while held.
var PUSH_DELETE_LED = 127;  // Delete button LED: held (full)
var PUSH_DELETE_LED_DIM = 5; // Delete button LED: available but not held (dim, not off)
var pushDeleteBtn = null;   // Delete button control (grabbed; for press + LED)
var pushDeleteHeld = false; // Delete currently held -> scenes/blocks become clear actions
var deleteGrabTask = null;  // defer the block-LED repaint after grabbing the buttons
// Mute/solo: hold the Mute (or Solo) button and tap a scene-launch button to mute
// (or exclusively solo) the row aligned with it. The 8 scene buttons are grabbed so
// we own the press; their LEDs mirror audibility — on = the row will play, off = muted
// or silenced by a solo elsewhere — and turn fully on while Mute/Solo is held (a
// "pick a row" hint). Scene button si (physical, 0 = bottom) maps to view row sceneRow(si)
// (no pushRow flip: the scenes already run bottom-up, like the piano-roll pads).
var PUSH_SCENE_LED_ON = 126;  // scene button LED: row audible / hint while held (RGB index, calibrate)
var PUSH_SCENE_LED_OFF = 0;   // scene button LED: row muted or solo-silenced
var PUSH_MS_LED_ON = 127;     // Mute/Solo button LED: held (full)
var PUSH_MS_LED_DIM = 5;      // Mute/Solo button LED: state active but not held (dim, not off)
var pushSceneBtns = null;     // 8 scene-launch button controls (for their LEDs)
var pushMuteBtn = null;       // Mute button control (LED)
var pushSoloBtn = null;       // Solo button control (LED)
var pushMuteHeld = false;     // Mute button physically held
var pushSoloHeld = false;     // Solo button physically held
var pushSceneSel = -1;        // note row held via a plain scene (loop/Vel/Prob/Lock target); -1 = none
var thisDeviceId = 0;

function pushInit() {
    if (pushCS) return; // already initialized
    var found = findPushSurface();
    // TEST BUILD: report at the first probe, and again when a Push shows up after a report
    // that saw no surface at all (the Push was turned on after Puxi loaded).
    if (surfaceReportN < 0 || (surfaceReportN === 0 && found.index >= 0)) {
        try { surfaceReportN = reportSurfaces(); }
        catch (e) { surfaceReportN = 0; post("Puxi report failed: " + e + "\n"); }
    }
    if (found.index < 0) {
        // The Push may be off / not yet connected. Keep polling so turning it ON after
        // Puxi is already on the track still hands the pads to Puxi (not the native drum
        // view). Cheap probe; stops as soon as the Push is found.
        if (!pushRetryTask) {
            post("Puxi: no Push found — retrying until one connects\n");
            pushRetryTask = new Task(pushInit);
        }
        pushRetryTask.schedule(PUSH_PROBE_MS);
        return;
    }
    if (pushRetryTask) pushRetryTask.cancel();
    pushModel = found.model;
    pushIndex = found.index;
    pushCS = new LiveAPI("control_surfaces " + found.index);
    post("Puxi: Push " + pushModel + " on control_surfaces " + found.index +
         (pushModel === 2 ? " (Push 2 support is experimental)" : "") + "\n");

    // View navigation lives on the dedicated Octave/Page buttons (NOT the Up/Down/
    // Left/Right arrows, which keep their native function): Octave +/- = note banks
    // (piano-roll, + = higher), Page </> = step blocks. Grabbed only while focused.
    var upId    = pushControlAny(["Octave_Up", "Octave_Up_Button"],     makeArrowCb("notes", 1));
    var downId  = pushControlAny(["Octave_Down", "Octave_Down_Button"], makeArrowCb("notes", -1));
    var rightId = pushControlAny(["Page_Right", "Page_Right_Button"],   makeArrowCb("steps", 1));
    var leftId  = pushControlAny(["Page_Left", "Page_Left_Button"],     makeArrowCb("steps", -1));
    // Keep these controls for LED output (lit only when that nav is still possible).
    pushArrows = {
        up:    upId    ? new LiveAPI("id " + upId)    : null,
        down:  downId  ? new LiveAPI("id " + downId)  : null,
        right: rightId ? new LiveAPI("id " + rightId) : null,
        left:  leftId  ? new LiveAPI("id " + leftId)  : null
    };
    // (encoders are NOT grabbed: the loop/follow params are exposed to Live, so
    //  Push shows + drives them natively on the top knobs.)
    // Encoder 1: touch = momentary follow (hold to follow while off); a turn
    // cancels it, so turning the encoder still sets follow normally (no flicker).
    followTouchTask = new Task(momentaryOn);
    observeCtl("Track_Control_Touch_0", onFollowTouch); // finger on/off
    observeCtl("Track_Control_0", onFollowTurn);        // rotation

    // 8x8 pad matrix: LED output (send_value col row color) + press input.
    pushMatrixId = extractId(pushCS.call("get_control", "Button_Matrix"));
    // pushWatch spots a rebuilt surface by a changed matrix id: only valid if asking twice
    // for the same control gives the same id.
    pushIdsStable = !!pushMatrixId && extractId(pushCS.call("get_control", "Button_Matrix")) === pushMatrixId;
    if (!pushIdsStable) post("Puxi: control ids not stable, Push reconnect check off\n");
    if (!pushWatchTask) pushWatchTask = new Task(pushWatch);
    pushWatchTask.schedule(PUSH_PROBE_MS);
    if (pushMatrixId) {
        pushMatrix = new LiveAPI("id " + pushMatrixId);            // for send_value
        var mObs = new LiveAPI(onPadMatrix, "id " + pushMatrixId); // for presses
        mObs.property = "value";
        pushObs.push(mObs);
    }

    // Accent button: tap = latch on/off, hold = momentary. While active, steps
    // entered on the pads are at max velocity. Grabbed so we own it + its LED.
    pushAccentId = extractId(pushCS.call("get_control", "Accent_Button"));
    if (pushAccentId) {
        pushGrabIds.push(pushAccentId);
        pushAccent = new LiveAPI("id " + pushAccentId);           // for the LED
        var accObs = new LiveAPI(onAccent, "id " + pushAccentId); // for press/release
        accObs.property = "value";
        pushObs.push(accObs);
    }

    // Convert button: bake the pattern to a MIDI clip. Grabbed so we own it + its LED
    // (lit only when the sequencer holds at least one note). Try both control names.
    pushConvertId = extractId(pushCS.call("get_control", "Convert"));
    if (!pushConvertId) pushConvertId = extractId(pushCS.call("get_control", "Convert_Button"));
    post("Puxi: Convert button " + (pushConvertId ? "id " + pushConvertId : "NOT FOUND") + "\n");
    if (pushConvertId) {
        pushGrabIds.push(pushConvertId);
        pushConvert = new LiveAPI("id " + pushConvertId);           // for the LED
        var cvObs = new LiveAPI(onConvert, "id " + pushConvertId);  // press -> export clip
        cvObs.property = "value";
        pushObs.push(cvObs);
    }

    // Double Loop button (the Push "Double Loop" key): doubles the global loop + copies its
    // notes. Grabbed (press + LED).
    pushDoubleBtn = acquireGrab(["Double_Button"], onDoubleLoop);

    // Repeat button = held modifier for ratcheting (scene = division, pad = paint). Grabbed
    // on focus (we own its press + LED; native note-repeat is suppressed while Puxi is focused).
    pushRepeatBtn = acquireGrab(["Repeat_Button", "Repeat"], onRepeatBtn);

    // The screen-row buttons (Track_State_Button0 = Follow, Track_Select_Button0..7 =
    // block) are NOT grabbed — M4L can't tell when the Push leaves the device view into
    // Settings/browser, so a grabbed screen button would stay hijacked there (their CLICK
    // must stay native everywhere). We still try to drive their LEDs (send_value without
    // grab) to mirror Follow + the shown block while focused. EXPERIMENTAL: Live may
    // repaint these itself in device mode and override us — if so, drop the LED calls.
    var followBtnId = extractId(pushCS.call("get_control", "Track_State_Button0"));
    if (followBtnId) pushFollowBtn = new LiveAPI("id " + followBtnId);
    // Track_Select_Button0..7 = block i. LED-only (un-grabbed) normally — their click stays
    // native — BUT they're grabbed MOMENTARILY while Duplicate is held (block copy/paste).
    // Keep their id (for the momentary grab) + observe their value (acted on only in dup mode).
    pushBlockBtns = [];
    pushBlockIds = [];
    for (var bi = 0; bi < 8; bi++) {
        var bid = extractId(pushCS.call("get_control", "Track_Select_Button" + bi));
        pushBlockIds[bi] = bid || 0;
        pushBlockBtns[bi] = bid ? new LiveAPI("id " + bid) : null;
        if (bid) {
            var blObs = new LiveAPI(makeBlockCb(bi), "id " + bid);
            blObs.property = "value";
            pushObs.push(blObs);
        }
    }
    // Duplicate button = held modifier for block copy/paste. Grabbed on focus (we own it +
    // suppress native duplicate while Puxi is selected).
    pushDupBtn = acquireGrab(["Duplicate_Button"], onDuplicate);

    // Delete button = held modifier for clearing a note row (scene) / a block (screen row).
    pushDeleteBtn = acquireGrab(["Delete_Button", "Delete"], onDeleteBtn);

    // Scenes: grab the 8 scene-launch buttons (mute/solo a row, row target for the encoders,
    // Repeat/Delete combos) + the Mute & Solo buttons (held = modifier). All grabbed while
    // focused; their LEDs are ours.
    pushSceneBtns = [];
    for (var si = 0; si < 8; si++)
        pushSceneBtns[si] = acquireGrab(["Scene_Launch_Button" + si], makeSceneCb(si));
    pushMuteBtn = acquireGrab(["Global_Mute_Button"], onMuteBtn);
    pushSoloBtn = acquireGrab(["Global_Solo_Button"], onSoloBtn);

    pushAfterGrab = new Task(pushRenderGrid); // deferred LED draw after a grab

    // Grab the arrows only while Puxi is the focused/appointed device.
    thisDeviceId = parseInt((new LiveAPI("this_device")).id, 10);
    var focusObs = new LiveAPI(onFocusChange, "live_set");
    focusObs.property = "appointed_device"; // fires once now with the current value
    pushObs.push(focusObs);
}

// While bound, every PUSH_PROBE_MS (and right away when a focus change finds the binding
// dead, see onFocusChange). When its control surfaces change (a Push turned on or off, sleep/
// wake, settings), Live's Max bridge (_MxDCore prepare_control_surface_update) releases every
// surface/control object a device holds, clears its observers and grabs, rebuilds the surface
// wrappers and hands negative ids out again from -1. Seen on hardware: "call grab_control …:
// no valid object set" and "Invalid arguments: release_control <ButtonElement …>", with the
// pads back to native. pushStaleReason() spots it; then the same controls at another index =
// the same Push moved (follow it), otherwise bind again from scratch (pushInit polls until a
// Push is back). On a Push 2, also switch to a Push 3 as soon as one shows up (preferred).
function pushWatch() {
    if (!pushCS) return;
    var why = pushIdsStable ? pushStaleReason() : "";
    if (why) {
        var moved = surfaceOwning();
        if (moved < 0 || moved === pushIndex) {
            post("Puxi: Push disconnected or rebuilt (" + why + "), reconnecting\n"); // TEST BUILD: (why)
            pushTeardown(true);
            pushInit();
            return;
        }
        pushIndex = moved;
        pushCS = new LiveAPI("control_surfaces " + moved);
    }
    if (pushModel === 2 && findPushSurface(true).model === 3) {
        post("Puxi: Push 3 connected, switching to it\n");
        pushTeardown(false);
        pushInit();
        return;
    }
    pushWatchTask.schedule(PUSH_PROBE_MS);
}

// Let go of the current surface and forget its handles (pushInit sets them all again).
// gone = the surface was rebuilt or removed: it rejects releases, so drop the handles
// first and setGrabbed(false) only resets Puxi's own grab state.
function pushTeardown(gone) {
    if (gone) {
        pushGrabIds = [];
        pushMatrixId = 0;
        pushBlockIds = [];
        pushBlockBtns = null;
        pushSceneBtns = null;
        pushDeleteBtn = null;
    }
    setGrabbed(false);
    if (!gone) for (var i = 0; i < pushObs.length; i++) { try { pushObs[i].property = ""; } catch (e) {} }
    if (pushWatchTask) pushWatchTask.cancel();
    pushObs = [];
    pushGrabIds = [];
    pushCS = null;
    pushModel = 0;
    pushIndex = -1;
    pushMatrix = null;
    pushMatrixId = 0;
    pushAccentId = 0;
    pushConvertId = 0;
}

// The appointed_device value arrives as ["appointed_device", "id", <N>] — the
// device id is the LAST element, not args[1].
function onFocusChange(args) {
    if (!args || args[0] !== "appointed_device") return;
    var appId = Number(args[args.length - 1]);
    var focused = appId === thisDeviceId && thisDeviceId !== 0;
    // Grabs and releases happen here, so first make sure the binding is still alive: a
    // control-surface update may have killed it since the last pushWatch tick. If so, don't
    // touch dead controls: let pushWatch rebind now (a Task, not from inside this
    // notification); the new binding's focus observer then grabs or not.
    if (pushCS && pushIdsStable && pushStaleReason()) {
        if (pushWatchTask) pushWatchTask.schedule(0);
        return;
    }
    setGrabbed(focused);
}

function setGrabbed(on) {
    if (on === pushGrabbed || !pushCS) return;
    if (!on && pushDupHeld) endDupMode(); // releasing focus mid-hold: free the block buttons
    if (!on && pushDeleteHeld) endDeleteMode(); // ...same for delete mode
    if (!on) { if (padHoldTask) padHoldTask.cancel(); padPress = null; probTarget = null; pushRepeatHeld = false; } // drop any pad hold / repeat mode
    pushGrabbed = on;
    for (var i = 0; i < pushGrabIds.length; i++) {
        pushCS.call(on ? "grab_control" : "release_control", "id", pushGrabIds[i]);
    }
    if (pushMatrixId) pushCS.call(on ? "grab_control" : "release_control", "id", pushMatrixId);
    if (on && pushAfterGrab) pushAfterGrab.schedule(100); // defer LED draw, let grab settle
    else if (pushAfterGrab) pushAfterGrab.cancel();
    if (on) { // probability shimmer runs only while focused
        if (!probBlinkTask) probBlinkTask = new Task(probBlinkTick);
        probBlinkTask.schedule(PROB_BLINK_MS);
    } else if (probBlinkTask) probBlinkTask.cancel();
    post("Puxi: Push " + (on ? "grabbed (focused)" : "released") + "\n");
}

function makeArrowCb(axis, delta) {
    return function (args) {
        if (!pushGrabbed || !args || args[0] !== "value") return;
        var v = Number(args[1]);
        if (isNaN(v) || v <= 0) return; // press only
        nav(axis, delta);
    };
}

// Push pad palette anchors we can TRUST (index -> hue in degrees): the documented exact
// values (red/green/blue/white) + named entries from the community pad-palette dump
// (orange/yellow/purple/pink). The full 128-color palette is only readable
// by sysex from the device (impossible from an M4L device + phone photos are too
// imprecise), so we quantize each chain color to the NEAREST of these known-correct
// indices. Trade-off: a small set of correct hues (very close shades may collapse).
// Velocity brightness comes from darker same-hue indices per anchor (VEL_LADDER, below).
// Match by HUE (not raw RGB distance, which sends medium blues to purple). Each anchor
// is a known-correct Push pad index at its hue (degrees); near-neutral colors go white.
var PUSH_HUE_ANCHORS = { "127": 0, "3": 33, "8": 55, "126": 120, "125": 240, "22": 268, "25": 330 };
var PUSH_WHITE = 122; // near-neutral / desaturated chain color
function rgbHue(r, g, b) {
    var max = Math.max(r, g, b), min = Math.min(r, g, b), d = max - min;
    if (d === 0) return 0;
    var h;
    if (max === r) h = ((g - b) / d) % 6;
    else if (max === g) h = (b - r) / d + 2;
    else h = (r - g) / d + 4;
    h *= 60; if (h < 0) h += 360;
    return h;
}
function nearestPaletteIndex(r, g, b) {
    var max = Math.max(r, g, b);
    var sat = max <= 0 ? 0 : (max - Math.min(r, g, b)) / max;
    if (sat < 0.18) return PUSH_WHITE; // near-gray/white -> white
    var h = rgbHue(r, g, b), best = 127, bestD = 999;
    for (var k in PUSH_HUE_ANCHORS) {
        var dh = Math.abs(h - PUSH_HUE_ANCHORS[k]);
        if (dh > 180) dh = 360 - dh;
        if (dh < bestD) { bestD = dh; best = parseInt(k, 10); }
    }
    return best;
}

// LED output: mirror the visible 8x8 window onto the pads. col = step, row = track.
// An in-loop active step takes its row's Drum Rack color (quantized to the nearest
// known palette hue); out-of-loop steps are grayed; rows with no chain color fall
// back to the fixed PUSH_ON color. Velocity -> brightness picks a darker same-hue palette
// index (VEL_LADDER): the Push API gives only a fixed-brightness color index per pad — a
// 4th 'brightness' arg to send_value is ignored, verified on hardware.
// Piano-roll orientation (mirrors the GUI): view-row t (t=0 lowest note) maps to the
// BOTTOM physical pad row. The press handler applies the same map (it is its own
// inverse). If the hardware turns out flipped the other way, change this one line.
function pushRow(t) { return VIEW_TRACKS - 1 - t; }

// Scene-launch button -> view row. The scene buttons are numbered bottom(0)..top(7) —
// the OPPOSITE of the pad-matrix rows — so the view row is the index directly (button 0
// = bottom = lowest note t=0), matching the piano-roll pads. Flip here if a hardware
// revision differs.
function sceneRow(si) { return si; }

// The lit color of an in-loop, audible note cell: velocity brightness level (p>=100), or the
// LOWER level of the velocity-capped shimmer pair (p<100; probBlinkTick animates up from it).
// A row with no ladder (no rack) keeps a fixed brightness. Shared by pushSetPad + the strobe.
function padLitColor(r, step, vel) {
    var rc = rowColor[r];
    var anchor = rc ? nearestPaletteIndex(rc[0], rc[1], rc[2]) : PUSH_ON_COLOR;
    var lad = VEL_LADDER[String(anchor)];
    if (!lad) return anchor;
    var p = effProb(r, step); // own prob + global offset
    return (p >= 100) ? lad[velLevel(vel)] : shimmerPair(lad, vel)[0];
}

// A single shimmer-rolled pad color for a ratchet flash's ON level: p>=100 is static at the
// velocity level; p<100 rolls between the velocity level and the one below (chance of the
// brighter = p/100), so the ratchet flashes ALSO carry the probability shimmer — the two
// animations coexist (flash rhythm = ratchet, flash brightness = probability).
function shimmerRoll(r, step, vel) {
    var rc = rowColor[r];
    var anchor = rc ? nearestPaletteIndex(rc[0], rc[1], rc[2]) : PUSH_ON_COLOR;
    var lad = VEL_LADDER[String(anchor)];
    if (!lad) return anchor;
    var p = effProb(r, step);
    if (p >= 100) return lad[velLevel(vel)];
    var pair = shimmerPair(lad, vel); // [lower, upper]; upper = velocity level
    return (Math.random() * 100 < p) ? pair[1] : pair[0];
}

function pushSetPad(t, s, vel) {
    if (!pushGrabbed || !pushMatrix) return;
    var color = 0;
    if (vel > 0) {
        var r = noteBase + t, step = stepBase + s;
        var inLoop = (step >= eLoopS(r) && step < eLoopE(r)); // this note's effective loop (polyrhythm)
        if (!inLoop || !audible(r)) color = PUSH_OFFLOOP_COLOR; // outside this note's loop OR muted/soloed-out -> gray
        else color = padLitColor(r, step, effVel(r, step)); // brightness = effective velocity (own + global offset)
    } else {
        color = tailCoverColor(t, s); // empty cell: 0, or a dim "tie tail" of a long note
    }
    probShown[t][s] = -1; // static repaint -> let the shimmer resend this pad
    pushMatrix.call("send_value", s, pushRow(t), color);
}

// If the empty cell (t,s) is covered by the TIE of a note to its left (same row) — that note's
// effective length reaches past it — return the dim (low) level of the note's hue; else
// 0 (off). Off-loop / muted cells stay off (the grid grays them separately). The nearest
// note on the left blocks tails from farther ones (a tie stops at the next note).
function tailCoverColor(t, s) {
    var r = noteBase + t, step = stepBase + s;
    if (!audible(r) || !(step >= eLoopS(r) && step < eLoopE(r))) return 0;
    for (var ps = step - 1; ps >= 0; ps--) {
        if (pattern[r][ps] > 0) {
            if (ps + effGate(r, ps) / 100 <= step) return 0; // that note doesn't reach here
            var rc = rowColor[r];
            var anchor = rc ? nearestPaletteIndex(rc[0], rc[1], rc[2]) : PUSH_ON_COLOR;
            var lad = VEL_LADDER[String(anchor)];
            return lad ? lad[0] : anchor; // low level = the tail
        }
    }
    return 0;
}

// How far (in view cells, fractional) a note BEFORE the visible window ties into it — so
// the GUI can draw a note spilling over from the previous page. The nearest note left of
// the window sets it; a note inside the window stops the incoming tail.
function incomingTail(r) {
    var reach = 0, ps;
    for (ps = stepBase - 1; ps >= 0; ps--)
        if (pattern[r][ps] > 0) { reach = ps + effGate(r, ps) / 100; break; }
    if (reach <= stepBase) return 0;
    var firstNote = stepBase + VIEW_STEPS;
    for (var vs = 0; vs < VIEW_STEPS; vs++)
        if (pattern[r][stepBase + vs] > 0) { firstNote = stepBase + vs; break; }
    var end = Math.min(reach, firstNote);
    return end > stepBase ? end - stepBase : 0;
}
function sendTailIns() {
    for (var t = 0; t < VIEW_TRACKS; t++) gui("tailin", t, incomingTail(noteBase + t));
}

// Velocity -> pad brightness. A pad's brightness is NOT directly controllable (the 4th
// send_value arg is ignored), but the fixed 128-entry palette DOES hold same-hue
// brightness variants — hand-picked on the hardware (2026-07-02, full palette
// sweep). For each anchor hue: [low, medium, high] palette indices; a note's velocity
// is quantized to those 3 levels (1-42 / 43-84 / 85-127). An anchor without a ladder
// (e.g. the no-rack fallback PUSH_ON_COLOR) keeps a fixed brightness.
var VEL_LADDER = {
    "127": [68, 67, 127],   // red
    "3":   [70, 69, 3],     // orange
    "8":   [78, 79, 8],     // yellow
    "126": [85, 32, 126],   // green
    "125": [100, 19, 125],  // blue
    "22":  [110, 22, 23],   // purple (anchor 22 = the MID level; 23 = high)
    "25":  [116, 115, 25],  // pink
    "122": [124, 121, 122]  // white
};
function velLevel(vel) { return vel > 84 ? 2 : (vel > 42 ? 1 : 0); }

// Probability shimmer pair, CAPPED BY VELOCITY: the flicker never goes brighter than the
// note's velocity level. A note alternates between its velocity brightness (upper) and the
// level just BELOW it (lower — OFF for the faintest velocity):
//   velocity high   -> high <-> medium
//   velocity medium -> medium <-> low
//   velocity low    -> low <-> OFF (pad unlit)
// Returns [lowerIdx, upperIdx] palette indices (lower = 0 means pad off).
function shimmerPair(lad, vel) {
    var vl = velLevel(vel);
    return [vl > 0 ? lad[vl - 1] : 0, lad[vl]];
}

// Probability -> pad "shimmer". A probabilistic note (prob < 100) alternates between the two
// levels of shimmerPair(); the chance of the BRIGHTER (velocity) level = p/100, so the lower
// the probability the more the pad sits on the lower level (down to OFF for faint velocity).
//   p 100: static (velocity level, no shimmer)   p 0: static lower level (never plays)
// A repeating Task redraws only the shimmering pads (random roll per frame -> the flicker
// itself suggests a dice roll); the playhead overlay, off-loop/muted grays are left alone.
var PROB_BLINK_MS = 180;   // shimmer frame period
var probBlinkTask = null;
var probShown = [];        // last palette index sent per shimmering pad (-1 = repaint)
function resetProbShown() {
    probShown = [];
    for (var t = 0; t < VIEW_TRACKS; t++) {
        var row = [];
        for (var s = 0; s < VIEW_STEPS; s++) row.push(-1);
        probShown.push(row);
    }
}
resetProbShown();
function probBlinkTick() {
    if (!pushGrabbed || !pushMatrix) return; // stop silently; setGrabbed(true) restarts
    for (var t = 0; t < VIEW_TRACKS; t++) {
        for (var s = 0; s < VIEW_STEPS; s++) {
            var r = noteBase + t, step = stepBase + s;
            var vel = pattern[r][step], p = effProb(r, step); // own prob + global offset
            if (!(vel > 0) || p >= 100 || p <= 0) continue;   // only shimmering cells
            if (ratchet[r][step] > 1) continue;                // ratcheted cells blink instead
            if (pushPlayColN[t] === s) continue;               // playhead overlay wins
            if (!audible(r)) continue;                          // muted/solo-silenced: gray
            if (!(step >= eLoopS(r) && step < eLoopE(r))) continue; // off-loop: gray
            var rc = rowColor[r];
            var anchor = rc ? nearestPaletteIndex(rc[0], rc[1], rc[2]) : PUSH_ON_COLOR;
            var lad = VEL_LADDER[String(anchor)];
            if (!lad) continue;
            var pair = shimmerPair(lad, effVel(r, step)); // [lower, upper]; upper = EFFECTIVE velocity level
            var idx = (Math.random() * 100 < p) ? pair[1] : pair[0]; // chance of upper = p/100
            if (probShown[t][s] !== idx) {
                pushMatrix.call("send_value", s, pushRow(t), idx);
                probShown[t][s] = idx;
            }
        }
    }
    if (probBlinkTask) probBlinkTask.schedule(PROB_BLINK_MS);
}

function pushRenderGrid() {
    if (!pushGrabbed || !pushMatrix) return;
    cancelFlashes(); // a pending ratchet strobe would paint over the fresh repaint
    for (var z = 0; z < VIEW_TRACKS; z++) pushPlayColN[z] = -1; // a full repaint clears the playhead overlays
    resetProbShown(); // view/state may have changed under the shimmering pads
    for (var t = 0; t < VIEW_TRACKS; t++) {
        for (var s = 0; s < VIEW_STEPS; s++) {
            pushSetPad(t, s, pattern[noteBase + t][stepBase + s]);
        }
    }
    updateAccentLed(); // restore the Accent LED after a (re)grab
    updateRepeatLed(); // Repeat button: dim (available) / full (held)
    updateDeleteLed(); // Delete button: dim (available) / full (held)
    updateArrowLeds(); // light only the nav buttons that can still scroll
    updateConvertLed(); // Convert button: lit iff the sequencer holds >=1 note
    updateDoubleLed();  // Double Loop button: lit iff the loop can be doubled
    updateDuplicateLed(); // Duplicate button: lit iff a block can be copied to an empty one
    updateFollowLed();  // LED-only (un-grabbed): Follow state on Track_State_Button0
    updateBlockLeds();  // LED-only (un-grabbed): shown block on Track_Select row
    updateSceneLeds();  // mute/solo state on the scene-launch buttons (+ Mute/Solo LEDs)
}

// Octave/Page nav-button LEDs mirror the GUI gutter/strip triangles: bright when the
// view can still scroll that way, dimmed to the lowest level at an edge. Same
// availability tests as the GUI (noteBase/stepBase vs their max). Called from
// pushRenderGrid, so every view change (nav, follow auto-scroll, grab) refreshes them.
function updateArrowLeds() {
    if (!pushGrabbed || !pushArrows) return;
    setArrowLed(pushArrows.up,    noteBase < NUM_NOTES - VIEW_TRACKS); // up -> higher notes
    setArrowLed(pushArrows.down,  noteBase > 0);                       // down -> lower notes
    setArrowLed(pushArrows.left,  stepBase > 0);
    setArrowLed(pushArrows.right, stepBase < TOTAL_STEPS - VIEW_STEPS);
}
function setArrowLed(ctl, available) {
    if (ctl) ctl.call("send_value", available ? PUSH_ARROW_LED : PUSH_ARROW_LED_DIM);
}

// Convert button: press bakes the pattern to a MIDI clip (release ignored). Its LED is
// lit only when the sequencer holds at least one note, off when empty — so it invites a
// bake exactly when there is something to bake. Refreshed from pushRenderGrid (grab /
// view / restore) and pushSnapshot (every pattern edit).
var convertTask = null;
function onConvert(args) {
    if (!pushGrabbed || !args || args[0] !== "value") return;
    // create_clip can't run inside this notification callback ("Changes cannot be
    // triggered by notifications") — defer it to the task queue, out of the observer.
    if (Number(args[1]) > 0) {
        if (!convertTask) convertTask = new Task(exportclip);
        convertTask.schedule(0);
    }
}
function patternHasNotes() {
    for (var r = 0; r < NUM_NOTES; r++)
        for (var s = 0; s < TOTAL_STEPS; s++)
            if (pattern[r][s] > 0) return true;
    return false;
}
function updateConvertLed() {
    if (pushGrabbed && pushConvert) {
        pushConvert.call("send_value", patternHasNotes() ? PUSH_CONVERT_ON : 0);
    }
}

// Double Loop button: press doubles the loop (no need to defer it — it makes no LiveAPI change).
// LED lit only when the loop CAN be doubled (notes inside, fits, target empty).
function onDoubleLoop(args) {
    if (!pushGrabbed || !args || args[0] !== "value") return;
    if (Number(args[1]) > 0) doubleloop(); // press only
}
function updateDoubleLed() {
    if (pushGrabbed && pushDoubleBtn) {
        pushDoubleBtn.call("send_value", canDoubleLoop() ? PUSH_DOUBLE_ON : 0);
    }
}

// Scene-button LEDs. Repeat held: the ratchet-division bar. Delete held: the rows that have
// notes. Otherwise they mirror mute/solo: on = the aligned row will play (audible), off =
// muted or silenced by a solo elsewhere. While Mute/Solo is held, all turn fully on (a
// "pick a row" hint). Scene si (physical, 0 = bottom) -> view row sceneRow(si). Refreshed
// from sendMuteSolo (state change) and pushRenderGrid (grab / view change).
function updateSceneLeds() {
    if (!pushGrabbed || !pushSceneBtns) return;
    if (pushRepeatHeld) { // ratchet-division bar: scenes 0..ratchetSel-1 lit (bottom = 1 hit)
        for (var ri = 0; ri < pushSceneBtns.length; ri++) {
            if (pushSceneBtns[ri]) pushSceneBtns[ri].call("send_value", ri < ratchetSel ? PUSH_SCENE_LED_ON : PUSH_SCENE_LED_OFF);
        }
        updateMuteSoloLeds();
        return;
    }
    if (pushDeleteHeld) { // delete hint: light scenes whose aligned note row has something to clear
        for (var di = 0; di < pushSceneBtns.length; di++) {
            if (pushSceneBtns[di]) pushSceneBtns[di].call("send_value", rowHasNotes(noteBase + sceneRow(di)) ? PUSH_SCENE_LED_ON : PUSH_SCENE_LED_OFF);
        }
        updateMuteSoloLeds();
        return;
    }
    var held = pushMuteHeld || pushSoloHeld;
    for (var si = 0; si < pushSceneBtns.length; si++) {
        var btn = pushSceneBtns[si];
        if (!btn) continue;
        var on = held || audible(noteBase + sceneRow(si));
        btn.call("send_value", on ? PUSH_SCENE_LED_ON : PUSH_SCENE_LED_OFF);
    }
    updateMuteSoloLeds();
}
function anyMuted() {
    for (var i = 0; i < NUM_NOTES; i++) if (muted[i]) return true;
    return false;
}
// Mute/Solo button LEDs: full while held, dim when the state is active (something muted
// / soloed) but not held, off when neither.
function updateMuteSoloLeds() {
    if (!pushGrabbed) return;
    if (pushMuteBtn) pushMuteBtn.call("send_value",
        pushMuteHeld ? PUSH_MS_LED_ON : (anyMuted() ? PUSH_MS_LED_DIM : 0));
    if (pushSoloBtn) pushSoloBtn.call("send_value",
        pushSoloHeld ? PUSH_MS_LED_ON : (soloCount > 0 ? PUSH_MS_LED_DIM : 0));
}

// LED-only indicators on the un-grabbed screen-row buttons (their click stays native):
// Follow state on Track_State_Button0, the shown 8-step block (green) on the
// Track_Select_Button0..7 row. Painted only while Puxi is focused.
function updateFollowLed() {
    if (pushModel === 2) return; // Push 2's script repaints this row (device list): leave it native
    if (pushGrabbed && pushFollowBtn) {
        pushFollowBtn.call("send_value", followPlay ? PUSH_FOLLOW_ON_COLOR : PUSH_FOLLOW_OFF_COLOR);
    }
}
function updateBlockLeds() {
    if (!pushGrabbed || !pushBlockBtns) return;
    // Push 2's script repaints this row (its track list) in device mode, so the block
    // indicator would go stale: paint it only while Duplicate/Delete hold the row grabbed.
    if (pushModel === 2 && !pushDupHeld && !pushDeleteHeld) return;
    if (pushDeleteHeld) { // delete hint: light the blocks that hold something to clear
        for (var d = 0; d < pushBlockBtns.length; d++)
            if (pushBlockBtns[d]) pushBlockBtns[d].call("send_value", blockHasNotes(d) ? PUSH_BLOCK_LED : 0);
        return;
    }
    var cur = Math.floor(stepBase / VIEW_STEPS);
    for (var i = 0; i < pushBlockBtns.length; i++) {
        if (!pushBlockBtns[i]) continue;
        if (pushDupHeld && i === dupSrc) continue; // the copied block blinks — leave it to the blink task
        pushBlockBtns[i].call("send_value", i === cur ? PUSH_BLOCK_LED : 0);
    }
}

// ---- Block copy/paste (Duplicate + screen-row buttons) ------------
// Hold Duplicate -> grab Track_Select_Button0..7 (block i). Tap a block to COPY it (its LED
// blinks); tap another to PASTE the copy there. Release Duplicate -> release the buttons
// (native click restored). Momentary grab only, so a stuck-in-Settings grab can't outlive
// the hold. (These buttons are normally left ungrabbed because Push's Settings mode can't be
// detected — see CLAUDE.md, Push 3 integration.)
function onDuplicate(args) {
    if (!pushGrabbed || !args || args[0] !== "value") return;
    if (Number(args[1]) > 0) startDupMode(); else endDupMode();
}
// The screen-row (block) buttons are normally un-grabbed (native click). Duplicate AND Delete
// grab them MOMENTARILY while held; the release guards against yanking the grab if the other
// modifier still holds it (holding both at once is not a real workflow, but the state stays consistent).
function grabBlockButtons() {
    for (var i = 0; i < pushBlockIds.length; i++)
        if (pushBlockIds[i]) pushCS.call("grab_control", "id", pushBlockIds[i]);
}
function releaseBlockButtons() {
    for (var i = 0; i < pushBlockIds.length; i++)
        if (pushBlockIds[i]) pushCS.call("release_control", "id", pushBlockIds[i]);
}
function startDupMode() {
    if (pushDupHeld) return;
    pushDupHeld = true;
    dupSrc = -1;
    grabBlockButtons();
    // Keep the displayed-block indicator lit while held (until a block is copied). Deferred
    // so the grab settles first (send_value right after grab_control can be dropped).
    if (!dupGrabTask) dupGrabTask = new Task(updateBlockLeds);
    dupGrabTask.schedule(80);
}
function endDupMode() {
    if (!pushDupHeld) return;
    pushDupHeld = false;
    dupSrc = -1;
    stopDupBlink();
    if (dupGrabTask) dupGrabTask.cancel();
    if (!pushDeleteHeld) releaseBlockButtons(); // keep the grab if Delete still holds it
    updateBlockLeds(); // restore the block indicator
}
// A block button press matters only while Delete or Duplicate is held (otherwise the native press handling
// runs). Delete wins if both are somehow held.
function makeBlockCb(i) {
    return function (args) {
        if (!pushGrabbed || !args || args[0] !== "value" || Number(args[1]) <= 0) return; // press only
        if (pushDeleteHeld) deleteBlock(i);
        else if (pushDupHeld) onDupBlockClick(i);
    };
}
function onDupBlockClick(i) {
    if (dupSrc < 0) {            // first tap: copy this block, blink it
        dupSrc = i;
        startDupBlink();
    } else {                    // second tap: paste the copy here, back to normal
        if (i !== dupSrc) dupblock(dupSrc, i);
        dupSrc = -1;
        stopDupBlink();
        updateBlockLeds();
    }
}
// Copy block src -> dst (all rows, 8 steps). Used by Push and the GUI (dupblock message).
function dupblock(src, dst) {
    var nb = TOTAL_STEPS / VIEW_STEPS;
    src = Math.round(src); dst = Math.round(dst);
    if (src < 0 || src >= nb || dst < 0 || dst >= nb || src === dst) return;
    var sBase = src * VIEW_STEPS, dBase = dst * VIEW_STEPS;
    for (var r = 0; r < NUM_NOTES; r++)
        for (var s = 0; s < VIEW_STEPS; s++) {
            pattern[r][dBase + s] = pattern[r][sBase + s];
            prob[r][dBase + s] = prob[r][sBase + s]; // a note carries its probability
            gate[r][dBase + s] = gate[r][sBase + s]; // ...its length
            ratchet[r][dBase + s] = ratchet[r][sBase + s]; // ...its ratchet
            plock[r][dBase + s] = [plock[r][sBase + s][0], plock[r][sBase + s][1]]; // ...and its param locks
        }
    sendFullState(); // repaint GUI + pads + availability
    pushSnapshot();  // persist + one undo step
}
function blockHasNotes(b) {
    var base = b * VIEW_STEPS;
    for (var r = 0; r < NUM_NOTES; r++)
        for (var s = 0; s < VIEW_STEPS; s++) if (pattern[r][base + s] > 0) return true;
    return false;
}
// Block copy/paste is meaningful when at least one block has a note AND at least one is
// empty (something to copy + somewhere to paste). Lights the Duplicate button.
function canDupAny() {
    var nb = TOTAL_STEPS / VIEW_STEPS, hasFull = false, hasEmpty = false;
    for (var b = 0; b < nb; b++) {
        if (blockHasNotes(b)) hasFull = true; else hasEmpty = true;
        if (hasFull && hasEmpty) return true;
    }
    return false;
}
function updateDuplicateLed() {
    if (pushGrabbed && pushDupBtn) pushDupBtn.call("send_value", canDupAny() ? PUSH_DUP_ON : 0);
}

// ---- Delete (Delete + scene / block buttons) ----------------------
// Hold Delete -> a SCENE button clears every step of its aligned note row; a screen-row
// (block) button clears every note of that block (all rows). Delete is grabbed on focus
// (modifier + LED); the block buttons are grabbed momentarily while held (like Duplicate).
// When Delete is not held the scene buttons keep their normal role (mute/solo/loop-select)
// and the block buttons stay native.
function onDeleteBtn(args) {
    if (!pushGrabbed || !args || args[0] !== "value") return;
    if (Number(args[1]) > 0) startDeleteMode(); else endDeleteMode();
}
function startDeleteMode() {
    if (pushDeleteHeld) return;
    pushDeleteHeld = true;
    grabBlockButtons();
    updateDeleteLed();
    updateSceneLeds(); // scenes light up the note rows that have something to delete
    if (!deleteGrabTask) deleteGrabTask = new Task(updateBlockLeds); // deferred (grab settles)
    deleteGrabTask.schedule(80);
}
function endDeleteMode() {
    if (!pushDeleteHeld) return;
    pushDeleteHeld = false;
    if (deleteGrabTask) deleteGrabTask.cancel();
    if (!pushDupHeld) releaseBlockButtons(); // keep the grab if Duplicate still holds it
    updateDeleteLed();
    updateBlockLeds();
    updateSceneLeds();
}
function updateDeleteLed() {
    if (pushGrabbed && pushDeleteBtn) {
        pushDeleteBtn.call("send_value", pushDeleteHeld ? PUSH_DELETE_LED : PUSH_DELETE_LED_DIM);
    }
}
function rowHasNotes(r) {
    for (var s = 0; s < TOTAL_STEPS; s++) if (pattern[r][s] > 0) return true;
    return false;
}
// Clear a whole note row (all TOTAL_STEPS): velocity off + per-step params back to defaults.
function deleteNoteRow(r) {
    if (r < 0 || r >= NUM_NOTES) return;
    var changed = false;
    for (var s = 0; s < TOTAL_STEPS; s++) {
        if (pattern[r][s] > 0) changed = true;
        pattern[r][s] = 0; prob[r][s] = 100; gate[r][s] = DEFAULT_GATE; ratchet[r][s] = 1; plock[r][s] = [-1, -1];
    }
    plockBase[r] = [PLOCK_MID, PLOCK_MID]; // clearing the whole row also resets its offset to neutral
    if (!changed) return; // nothing to delete -> no snapshot/repaint
    sendFullState();
    pushSnapshot();
}
// Clear a whole block (its 8 steps across ALL note rows): velocity off + params to defaults.
function deleteBlock(b) {
    var nb = TOTAL_STEPS / VIEW_STEPS;
    b = Math.round(b);
    if (b < 0 || b >= nb) return;
    var base = b * VIEW_STEPS, changed = false, r, s;
    for (r = 0; r < NUM_NOTES; r++)
        for (s = 0; s < VIEW_STEPS; s++) {
            if (pattern[r][base + s] > 0) changed = true;
            pattern[r][base + s] = 0; prob[r][base + s] = 100; gate[r][base + s] = DEFAULT_GATE; ratchet[r][base + s] = 1;
            plock[r][base + s] = [-1, -1]; // ...and its param locks (the row-wide lock offset, plockBase, is left intact)
        }
    if (!changed) return;
    sendFullState();
    pushSnapshot();
}
// Blink the copied block's LED until paste/cancel/release.
function startDupBlink() {
    dupBlinkOn = false;
    if (!dupBlinkTask) dupBlinkTask = new Task(dupBlinkTick);
    dupBlinkTick();
}
function dupBlinkTick() {
    if (!pushGrabbed || dupSrc < 0 || !pushBlockBtns[dupSrc]) return;
    dupBlinkOn = !dupBlinkOn;
    pushBlockBtns[dupSrc].call("send_value", dupBlinkOn ? PUSH_DUP_BLINK : 0);
    if (dupBlinkTask) dupBlinkTask.schedule(300);
}
function stopDupBlink() {
    if (dupBlinkTask) dupBlinkTask.cancel();
    dupBlinkOn = false;
}

// Ratchet strobe: when the playhead lands on a ratcheted note, the pad pulses R times over
// the step (R = ratchet count) between its lit color and OFF — one flash per sub-hit — so
// you SEE the ratchet on the pad. Replaces the steady green playhead for that pad. The flash
// tasks all fire within one step; they are kept referenced (cancelled at the next tick / on a
// full repaint / stop) so Max doesn't GC them before they run.
var flashTasks = [];
function cancelFlashes() {
    for (var i = 0; i < flashTasks.length; i++) flashTasks[i].cancel();
    flashTasks = [];
}
function scheduleFlash(t, s, color, delay) {
    var tk = new Task(function () {
        if (!pushGrabbed || !pushMatrix) return;
        pushMatrix.call("send_value", s, pushRow(t), color);
        probShown[t][s] = -1; // let the shimmer resend this pad once the flash is over
    });
    tk.schedule(delay);
    flashTasks.push(tk);
}
function startRatchetFlash(t, s, R, stepMs, r, step) {
    var slot = stepMs / R;
    for (var k = 0; k < R; k++) {
        scheduleFlash(t, s, shimmerRoll(r, step, effVel(r, step)), Math.round(k * slot)); // on (prob-rolled, eff. vel brightness)
        scheduleFlash(t, s, 0, Math.round(k * slot + slot * 0.5));            // off mid-slot
    }
}

// Per-note playhead on the pads: cols[t] = the view-column where row t is currently
// playing (-1 if that note's playhead is in another block). Each row has its own
// position (polyrhythm). Restore the pad a row's playhead leaves, light the one it
// enters (steady green, or a ratchet strobe if that cell is ratcheted). Piano-roll flip
// via pushRow(t) like the rest. stepMs (the step duration) drives the strobe timing.
function pushSetPlayheads(cols, stepMs) {
    if (!pushGrabbed || !pushMatrix) return;
    for (var t = 0; t < VIEW_TRACKS; t++) {
        var nc = cols[t], oc = pushPlayColN[t];
        if (nc === oc) continue;
        if (oc >= 0 && oc < VIEW_STEPS) pushSetPad(t, oc, pattern[noteBase + t][stepBase + oc]); // restore left pad
        if (nc >= 0 && nc < VIEW_STEPS) {
            var r = noteBase + t, step = stepBase + nc, vel = pattern[r][step];
            var R = ratchet[r][step];
            if (vel > 0 && R > 1 && stepMs && audible(r) && step >= eLoopS(r) && step < eLoopE(r))
                startRatchetFlash(t, nc, R, stepMs, r, step); // ratchet strobe (prob-shimmered)
            else
                pushMatrix.call("send_value", nc, pushRow(t), PUSH_PLAY_COLOR); // steady playhead
        }
        pushPlayColN[t] = nc;
    }
}

// Idle ratchet indicator: so you can SEE which notes are ratcheted BEFORE the playhead
// reaches them, each visible ratcheted note strobes its N-flash pattern EVERY step. The
// cell currently under a row's playhead is left to pushSetPlayheads (its own strobe).
// Driven from tick. (RATCHET_IDLE_EVERY = blink cadence in steps; 1 = every step.)
var RATCHET_IDLE_EVERY = 1;
function pushRatchetIdle(S, stepMs) {
    if (!pushGrabbed || !pushMatrix || !stepMs) return;
    var flashStep = (S % RATCHET_IDLE_EVERY === 0);
    for (var t = 0; t < VIEW_TRACKS; t++) {
        for (var s = 0; s < VIEW_STEPS; s++) {
            if (pushPlayColN[t] === s) continue; // the playhead owns this pad this step
            var r = noteBase + t, step = stepBase + s, vel = pattern[r][step];
            if (!(vel > 0) || ratchet[r][step] <= 1) continue;
            if (!audible(r) || !(step >= eLoopS(r) && step < eLoopE(r))) continue; // off-loop/muted: no blink
            if (flashStep) startRatchetFlash(t, s, ratchet[r][step], stepMs, r, step);
            else pushSetPad(t, s, vel); // rest step: base (prob-aware) color
        }
    }
}

// Pad press arrives as ["value", velocity, col, row, 1] (velocity 0 on release).
// TAP (quick press+release) toggles the step on RELEASE — taking the press velocity. HOLD
// (kept down past PAD_HOLD_MS) enters PROBABILITY mode for that cell instead of toggling:
// "Prob" (5th encoder) then edits this cell's play probability; release exits. Deferring
// the toggle to release is what lets a hold edit an existing note without flipping it off.
var PAD_HOLD_MS = 250;
var padHoldTask = null;       // fires PAD_HOLD_MS after a press still held -> prob mode
var padPress = null;          // {t, s, vel} of the pad currently down (pending tap/hold)
var probTarget = null;        // {r, step} cell whose probability the encoder edits; null = off
function onPadMatrix(args) {
    if (!pushGrabbed || !args || args[0] !== "value") return;
    var vel = Number(args[1]), t = pushRow(Number(args[3])), s = Number(args[2]);
    if (pushRepeatHeld) { // Repeat modifier: a press paints the selected ratchet (no tap/hold)
        if (vel > 0) ratchethit(t, s, vel);
        padPress = null;
        return;
    }
    if (vel > 0) { // press: arm the tap/hold decision, don't toggle yet
        padPress = { t: t, s: s, vel: vel };
        if (!padHoldTask) padHoldTask = new Task(padHoldFired);
        padHoldTask.schedule(PAD_HOLD_MS);
    } else {       // release
        if (padHoldTask) padHoldTask.cancel();
        if (probTarget) exitProbMode();                 // was a hold -> leave prob mode
        else if (padPress) padhit(padPress.t, padPress.s, padPress.vel); // was a tap -> toggle
        padPress = null;
    }
}
function padHoldFired() {
    if (padPress) enterProbMode(padPress.t, padPress.s);
}
// Point the Vel, Prob AND Length encoders at a held cell: show its velocity, prob and length.
// Also show this step's parameter LOCKS on the Lock encoders (7/8).
function enterProbMode(t, s) {
    var r = noteBase + t, step = stepBase + s;
    if (!validCell(r, step)) return;
    probTarget = { r: r, step: step };
    param("vel", pattern[r][step] > 0 ? pattern[r][step] : gVel); // "Vel" encoder shows the note's velocity
    param("prob", prob[r][step]);  // set (no echo) -> the "Prob" encoder shows it
    param("length", gate[r][step]); // ...the "Length" encoder shows the note's length
    showLocks(r, plock[r][step]);   // ...the Lock encoders show this step's locks
}
function exitProbMode() {
    probTarget = null;
    if (pushSceneSel >= 0) captureRowVel(pushSceneSel); // a pad edit may have changed the row
    param("vel", velDisplay());   // encoders fall back to the GLOBAL vel / prob / length display
    param("prob", probDisplay()); // (or the held scene's row, for Vel and Prob)
    param("length", gGate);
}
// Prob param (5th encoder). A pad HELD -> edits that cell's own probability. A scene HELD ->
// sets the own probability of every note in that row. Nothing held -> edits the GLOBAL
// probability (an offset on every note; own values untouched, so raising it back restores
// them). The global rides the live.* param itself: persisted by Live with the Set (value
// restored on reload lands here) — not part of PuxiState.
function pprob(v) {
    var nv = clamp(Math.round(Number(v)), 0, 100);
    if (probTarget) { // held pad: edit the note's own prob
        prob[probTarget.r][probTarget.step] = nv;
        var t = probTarget.r - noteBase, s = probTarget.step - stepBase;
        if (t >= 0 && t < VIEW_TRACKS && s >= 0 && s < VIEW_STEPS) {
            gui("cprob", t, s, nv);                                   // mirror in the GUI
            pushSetPad(t, s, pattern[probTarget.r][probTarget.step]); // re-base the shimmer live
        }
        scheduleProbSnap();
        return;
    }
    if (pushSceneSel >= 0) { setRowProb(pushSceneSel, nv); return; } // held scene: the whole row
    if (nv === gProb) return; // echo / no change
    gProb = nv;
    gui("gprob", gProb); // GUI recomputes every bar (effective = own + offset)
    if (pushGrabbed && pushAfterGrab) pushAfterGrab.schedule(50); // re-base the pads (coalesced)
}

// Scene held: set the own probability of every note in row r. (A note entered later still
// starts at 100: probability belongs to the note.)
function setRowProb(r, nv) {
    for (var st = 0; st < TOTAL_STEPS; st++) if (pattern[r][st] > 0) prob[r][st] = nv;
    var t = r - noteBase;
    if (t >= 0 && t < VIEW_TRACKS) {
        for (var s = 0; s < VIEW_STEPS; s++) {
            if (pattern[r][stepBase + s] > 0) {
                gui("cprob", t, s, nv);
                pushSetPad(t, s, pattern[r][stepBase + s]);
            }
        }
    }
    scheduleProbSnap();
}
// What the Prob encoder shows while a scene is held: the probability most of the row's notes
// share (100 for an empty row).
function rowProbDisplay(r) {
    var count = {}, best = 100, bestN = 0;
    for (var st = 0; st < TOTAL_STEPS; st++) {
        if (pattern[r][st] <= 0) continue;
        var p = prob[r][st];
        count[p] = (count[p] || 0) + 1;
        if (count[p] > bestN) { bestN = count[p]; best = p; }
    }
    return best;
}
// The Prob encoder's display when no pad is held: the held scene's row, else the global.
function probDisplay() { return pushSceneSel >= 0 ? rowProbDisplay(pushSceneSel) : gProb; }

// Length param (6th encoder), like pprob but with no row (scene) target: held pad -> the note's length,
// no pad -> the GLOBAL length offset (rides the live.* param, persisted by Live).
function plength(v) {
    var nv = clamp(Math.round(Number(v)), MIN_GATE, MAX_GATE);
    if (probTarget) { // held pad: edit the note's own length
        gate[probTarget.r][probTarget.step] = nv;
        gui("clen", probTarget.r - noteBase, probTarget.step - stepBase, nv);
        scheduleGateSnap();
        return;
    }
    if (nv === gGate) return; // echo / no change
    gGate = nv;
    gui("glen", gGate); // GUI recomputes every tail (effective = own + offset)
    sendTailIns();      // ...incl. overflow tails from the previous page
    if (pushGrabbed && pushAfterGrab) pushAfterGrab.schedule(50); // repaint pad tails (coalesced)
}

// Lock params (7th/8th encoders). A pad HELD -> lock THIS step's param i (absolute). A scene
// HELD (loop-select) -> the row-wide OFFSET for param i (64 = neutral), which shifts ALL notes
// of the row like the global probability does — unlocked steps follow it, locked steps ride on top of
// it, centering it (64) removes the effect. No target held -> ignored. Edits apply live.
var lockSnapTask = null;
function scheduleLockSnap() {
    if (!lockSnapTask) lockSnapTask = new Task(pushSnapshot);
    lockSnapTask.schedule(250);
}
function pplock1(v) { pplock(0, v); }
function pplock2(v) { pplock(1, v); }
function pplock(i, v) {
    var nv = clamp(Math.round(Number(v)), 0, 127);
    if (probTarget) {                 // pad held -> lock this step
        plock[probTarget.r][probTarget.step][i] = nv;
        applyLockLive(probTarget.r, i, nv);
        scheduleLockSnap();
    } else if (pushSceneSel >= 0) {    // scene held -> the row-wide offset (affects all notes)
        plockBase[pushSceneSel][i] = nv;
        applyLockLive(pushSceneSel, i, nv);
        scheduleLockSnap();
    } // else: no target -> ignore
}


function padhit(t, s, vel) {
    var r = noteBase + t, step = stepBase + s;
    if (!validCell(r, step)) return;
    if (accentActive() && pattern[r][step] > 0) {
        pattern[r][step] = 127; // Accent held + existing note -> boost to max velocity (don't toggle off)
    } else {
        var on = accentActive() ? 127 : clamp(Math.round(vel), 1, 127); // accent -> enter at max vel
        pattern[r][step] = (pattern[r][step] > 0) ? 0 : on;
        resetProbOnEntry(r, step, t, s); // a fresh note always starts clean (prob/gate/ratchet/lock defaults)
    }
    gui("cell", t, s, pattern[r][step]); // update the GUI
    pushSetPad(t, s, pattern[r][step]);          // update the pad LED
    pushSnapshot(); // persist + make Push pad edits undoable (and refresh the Convert LED)
}

// Repeat + pad: paint the selected ratchet division onto this step. Enters a fresh note
// (accent-aware) if the cell is empty — a fresh note resets prob/gate/ratchet first, then
// we set the ratchet; an existing note keeps its prob/gate and just takes the ratchet.
function ratchethit(t, s, vel) {
    var r = noteBase + t, step = stepBase + s;
    if (!validCell(r, step)) return;
    if (pattern[r][step] <= 0) {
        pattern[r][step] = accentActive() ? 127 : clamp(Math.round(vel), 1, 127);
        resetProbOnEntry(r, step, t, s); // fresh note: prob 100, gate default, ratchet 1
        gui("cell", t, s, pattern[r][step]);
    }
    ratchet[r][step] = ratchetSel;
    gui("cratchet", t, s, ratchetSel);
    pushSetPad(t, s, pattern[r][step]);
    pushSnapshot();
}

// Scene-launch button press. With a modifier held: Repeat -> pick the ratchet division;
// Delete -> clear the aligned row; Mute -> toggle mute; Solo -> exclusive solo. With no
// modifier, a HOLD targets the row for the loop, Vel, Prob and Lock encoders (below). We own the button,
// so there's no native scene launch while focused. si = physical scene (0 = bottom) ->
// view row sceneRow(si); the scenes run opposite to the pad rows, so no pushRow flip.
function makeSceneCb(si) {
    return function (args) {
        if (!pushGrabbed || !args || args[0] !== "value") return;
        var pressed = Number(args[1]) > 0;
        var t = sceneRow(si);
        // Repeat held: the scenes are a ratchet-division selector (bottom scene = 1 hit,
        // going up = more). Press picks it; the LED bar (updateSceneLeds) shows the count.
        if (pushRepeatHeld) { if (pressed) { ratchetSel = si + 1; updateSceneLeds(); } return; }
        // Delete held: a scene press clears every step of its aligned note row.
        if (pushDeleteHeld) { if (pressed) deleteNoteRow(noteBase + t); return; }
        if (pushMuteHeld) { if (pressed) mutetrack(t); return; }
        if (pushSoloHeld) { if (pressed) solotrack(t); return; }
        // No modifier: HOLD a scene to point the loop Start/End encoders at THAT note
        // (polyrhythm), the Vel and Prob encoders at that row's notes, AND the Lock encoders
        // (7/8) at that row's OFFSET (shifts all its notes); RELEASE returns them to the
        // global loop / global velocity / global probability. Momentary.
        if (pressed) {
            pushSceneSel = noteBase + t;
            selectLoopNote(noteBase + t);
            showLocks(noteBase + t, plockBase[noteBase + t]);
            captureRowVel(noteBase + t);
            if (!probTarget) { param("prob", probDisplay()); param("vel", velDisplay()); }
        } else if (pushSceneSel >= 0) {
            pushSceneSel = -1;
            rowVelSnap = null;
            selectLoopNote(-1);
            if (!probTarget) { param("prob", gProb); param("vel", gVel); }
        }
    };
}
// Mute / Solo buttons act as held modifiers. Track the hold and repaint the scene LEDs
// (all on while held, the mute/solo picture otherwise).
function onMuteBtn(args) {
    if (!pushGrabbed || !args || args[0] !== "value") return;
    pushMuteHeld = Number(args[1]) > 0;
    updateSceneLeds();
}
function onSoloBtn(args) {
    if (!pushGrabbed || !args || args[0] !== "value") return;
    pushSoloHeld = Number(args[1]) > 0;
    updateSceneLeds();
}
// Repeat button = held modifier for ratcheting. While held the scenes show/pick the
// division (updateSceneLeds bar); releasing repaints the scenes back to mute/solo state.
function onRepeatBtn(args) {
    if (!pushGrabbed || !args || args[0] !== "value") return;
    pushRepeatHeld = Number(args[1]) > 0;
    updateRepeatLed();
    updateSceneLeds();
}
function updateRepeatLed() {
    if (pushGrabbed && pushRepeatBtn) {
        pushRepeatBtn.call("send_value", pushRepeatHeld ? PUSH_REPEAT_LED : PUSH_REPEAT_LED_DIM);
    }
}

// Accent button: a quick tap toggles a latch; a longer press is momentary.
// While accent is active (latched OR held), pad-entered steps are at max velocity.
function onAccent(args) {
    if (!pushGrabbed || !args || args[0] !== "value") return;
    if (Number(args[1]) > 0) {                  // press
        accentHeld = true;
        accentDownAt = Date.now();
    } else {                                    // release
        accentHeld = false;
        if (Date.now() - accentDownAt < 300) accentLatched = !accentLatched; // tap = toggle
    }                                           // longer press = hold = momentary only
    updateAccentLed();
}

function accentActive() { return accentLatched || accentHeld; }

function updateAccentLed() {
    if (pushGrabbed && pushAccent) {
        pushAccent.call("send_value", accentActive() ? PUSH_ACCENT_LED : PUSH_ACCENT_LED_DIM);
    }
}

// Set up a Push control: observe its value with cb, and mark it for grabbing
// while Puxi is focused.
function pushControl(name, cb) {
    var id = extractId(pushCS.call("get_control", name));
    if (!id) { post("Puxi: " + name + " not found\n"); return 0; }
    pushGrabIds.push(id);
    var obs = new LiveAPI(cb, "id " + id);
    obs.property = "value";
    pushObs.push(obs);
    return id;
}

// Like pushControl but tries several candidate names (Push control naming varies) and
// uses the first that resolves, logging the winner — or that none matched.
function pushControlAny(names, cb) {
    for (var i = 0; i < names.length; i++) {
        var id = extractId(pushCS.call("get_control", names[i]));
        if (id) {
            pushGrabIds.push(id);
            var obs = new LiveAPI(cb, "id " + id);
            obs.property = "value";
            pushObs.push(obs);
            post("Puxi: nav control '" + names[i] + "' -> id " + id + "\n");
            return id;
        }
    }
    post("Puxi: nav control NOT FOUND, tried [" + names.join(", ") + "]\n");
    return 0;
}

// Acquire a button by trying candidate names: mark it for grabbing while focused,
// observe its value with cb (press/release), and return a LiveAPI handle for its LED
// (or null if no name resolved). Used for the grabbed buttons: scenes, Mute/Solo, Double,
// Repeat, Duplicate and Delete.
function acquireGrab(names, cb) {
    for (var i = 0; i < names.length; i++) {
        var id = extractId(pushCS.call("get_control", names[i]));
        if (id) {
            pushGrabIds.push(id);
            if (cb) {
                var obs = new LiveAPI(cb, "id " + id);
                obs.property = "value";
                pushObs.push(obs);
            }
            post("Puxi: control '" + names[i] + "' -> id " + id + "\n");
            return new LiveAPI("id " + id); // handle for send_value (LED)
        }
    }
    post("Puxi: control NOT FOUND, tried [" + names.join(", ") + "]\n");
    return null;
}

// ---- Live device parameters (Push display + native encoders) ------
// Exposed params (live.* objects in the patch) bridge to engine state. Incoming
// "p*" messages come from the param objects (user/automation); outgoing values go
// via sendParams() using "set", which updates the param WITHOUT re-triggering it
// (no feedback loop). Loop params are 1-based for display and act on the SELECTED note
// (loopSelN); each note's region is [loopStartN, loopEndN) with start 0-based.
function pfollow(v) { followMomentary = false; follow(Number(v) !== 0 ? 1 : 0); }

// Encoder 1 touch: a sustained hold (no turn) momentarily forces follow on; it
// reverts on release. Debounced so grabbing the encoder to TURN it doesn't blip
// follow on.
function onFollowTouch(args) {
    if (!pushGrabbed || !args || args[0] !== "value") return;
    if (Number(args[1]) > 0) {                              // finger on
        followTouchPending = true;
        if (followTouchTask) followTouchTask.schedule(60);  // hold -> momentary
    } else {                                                // finger off
        followTouchPending = false;
        if (followTouchTask) followTouchTask.cancel();
        if (followMomentary) { followMomentary = false; follow(0); }
    }
}

// ~60ms after a touch with no turn: it's a hold -> momentary follow on.
function momentaryOn() {
    if (followTouchPending && !followPlay) { followMomentary = true; follow(1); }
}

// Relative encoder: 1..63 = right (+), 65..127 = left (value - 128).
function encDelta(v) { return v <= 63 ? v : v - 128; }

// A turn of encoder 1 = "turn", not "hold": cancel any pending/active momentary,
// then set follow by direction (right on / left off). We drive follow straight
// from the observed rotation so it works regardless of the native param mapping.
function onFollowTurn(args) {
    if (!pushGrabbed || !args || args[0] !== "value") return;
    followTouchPending = false;
    if (followTouchTask) followTouchTask.cancel();
    followMomentary = false;
    var d = encDelta(Number(args[1]));
    if (d > 0 && !followPlay) follow(1);       // right -> on
    else if (d < 0 && followPlay) follow(0);   // left -> off
}

// Observe a Push control's value WITHOUT grabbing it (native function intact).
function observeCtl(name, cb) {
    var id = extractId(pushCS.call("get_control", name));
    if (!id) return;
    var o = new LiveAPI(cb, "id " + id);
    o.property = "value";
    pushObs.push(o);
}
// ---- Magnetic detents on the loop encoders ------------------------
// The loop Start/End knobs "catch" on block boundaries (every 8 steps), like
// Live's sticky pan-center: it costs extra rotation to leave a detent value,
// so the common 8-step increments are easy to land on, while fine 1-step moves
// still work everywhere else. We can't intercept the encoder before Live maps it
// to the param, so we snap AFTER: when sitting on a detent we absorb the first few
// increments and re-pin the param to the detent (via setloop -> sendParams "set",
// which Live accepts as the new value without re-triggering us).
var LOOP_DETENT_ESCAPE = 8;       // extra increments needed to leave a detent (higher = stiffer)
var magStart = { acc: 0, last: 1 };
var magEnd   = { acc: 0, last: 8 };
var loopRestoreWindow = true; // during device load, Live restores Loop Start/End to
                              // absolute values -> apply them directly (no detents),
                              // else the magnet absorbs the restore jump. Closed by
                              // settleRestore() once load settles.

// base 1 -> start detents 1,9,...,57; base 0 -> end detents 8,16,...,64
function isLoopDetent(v, base) { return ((v - base) % 8) === 0; }

// committed = engine's current param value (1-based); raw = value Live just set.
function loopMagnetic(mag, committed, raw, base) {
    if (loopRestoreWindow) { mag.acc = 0; mag.last = raw; return raw; } // load restore -> direct
    if (committed !== mag.last) { mag.acc = 0; mag.last = committed; } // external change
    var delta = raw - committed;
    if (delta === 0) return committed;
    if (isLoopDetent(committed, base)) {
        mag.acc += delta;
        if (Math.abs(mag.acc) <= LOOP_DETENT_ESCAPE) return committed; // absorb: stay pinned
        var dir = mag.acc > 0 ? 1 : -1;
        var out = clamp(committed + dir * (Math.abs(mag.acc) - LOOP_DETENT_ESCAPE),
                        1, TOTAL_STEPS);
        mag.acc = 0; mag.last = out;
        return out;
    }
    mag.acc = 0;                                          // off a detent: move 1:1
    var moved = clamp(committed + delta, 1, TOTAL_STEPS);
    mag.last = moved;
    return moved;
}

// Loop Start/End encoders edit the active target's loop (global or the held note).
function pstart(v) {
    if (loopRestoreWindow) return;
    setloop(loopMagnetic(magStart, loopTargetS() + 1, Number(v), 1) - 1, loopTargetE());
}
function pend(v) {
    if (loopRestoreWindow) return;
    setloop(loopTargetS(), loopMagnetic(magEnd, loopTargetE(), Number(v), 0));
}

// "Vel" param (Push encoder 4, just before Prob). A pad HELD -> edits that NOTE's velocity;
// a scene HELD -> moves every note of that row up or down together (shiftRowVel); NOTHING
// held -> the GLOBAL velocity offset gVel (an offset on every note, like gProb: effVel
// = clamp(own + gVel - 100, 1, 127)). The global rides the live.* param (persisted by Live).
function pvel(v) {
    var nv = clamp(Math.round(Number(v)), 1, 127);
    if (probTarget) { // held pad: set the note's own velocity (only if there is a note)
        var r = probTarget.r, step = probTarget.step;
        if (pattern[r][step] > 0) {
            pattern[r][step] = nv;
            var t = r - noteBase, s = step - stepBase;
            if (t >= 0 && t < VIEW_TRACKS && s >= 0 && s < VIEW_STEPS) { gui("cell", t, s, nv); pushSetPad(t, s, nv); }
            scheduleVelSnap();
        }
        return;
    }
    if (pushSceneSel >= 0) { shiftRowVel(pushSceneSel, nv); return; } // held scene: the whole row
    if (nv === gVel) return; // echo / no change
    gVel = nv;
    gui("gvel", gVel); // GUI recomputes each cell's brightness (effective = own + gVel - 100)
    if (pushGrabbed && pushAfterGrab) pushAfterGrab.schedule(50); // refresh the pads' brightness (coalesced)
}
var velSnapTask = null;
function scheduleVelSnap() { if (!velSnapTask) velSnapTask = new Task(pushSnapshot); velSnapTask.schedule(250); }

// Scene held: the Vel encoder works like a fader on the whole row. It shows the row's loudest
// note, and turning it shifts every note of the row by the same amount, so their differences
// (accents, ghost notes) are kept. The shift is computed from the velocities captured when the
// scene was pressed, so turning back restores them exactly.
var rowVelSnap = null;   // row velocities captured at scene press; null = no scene held
var rowVelRef = 100;     // what the Vel encoder showed at that moment
function captureRowVel(r) {
    rowVelSnap = pattern[r].slice();
    rowVelRef = velDisplay();
}
function shiftRowVel(r, nv) {
    if (!rowVelSnap) return;
    var d = nv - rowVelRef, changed = false;
    for (var st = 0; st < TOTAL_STEPS; st++) {
        if (rowVelSnap[st] > 0) { pattern[r][st] = clamp(rowVelSnap[st] + d, 1, 127); changed = true; }
    }
    if (!changed) return;
    var t = r - noteBase;
    if (t >= 0 && t < VIEW_TRACKS) {
        for (var s = 0; s < VIEW_STEPS; s++) {
            var sv = pattern[r][stepBase + s];
            if (sv > 0) { gui("cell", t, s, sv); pushSetPad(t, s, sv); }
        }
    }
    scheduleVelSnap();
}
// The Vel encoder's display when no pad is held: the held scene row's loudest note, else the
// global offset (also the global when the held row is empty).
function velDisplay() {
    if (pushSceneSel < 0) return gVel;
    var top = 0;
    for (var st = 0; st < TOTAL_STEPS; st++) if (pattern[pushSceneSel][st] > top) top = pattern[pushSceneSel][st];
    return top > 0 ? top : gVel;
}

function sendParams() {
    param("follow", followPlay ? 1 : 0);
    param("start", loopTargetS() + 1);
    param("end", loopTargetE());
    if (!probTarget) { param("prob", probDisplay()); param("length", gGate); param("vel", velDisplay()); } // don't fight the held-pad display
}

function extractId(res) {
    if (res == null) return 0;
    if (typeof res === "number") return res;
    for (var i = res.length - 1; i >= 0; i--) {
        if (res[i] !== "" && !isNaN(Number(res[i]))) return Number(res[i]);
    }
    return 0;
}

// Find the Push control surface by index (its index can change between Live sessions).
// Returns {index, model}: model 3 = Push 3, 2 = Push 2, index -1 = none (onlyPush3: skip Push 2).
// A Push 3 is preferred: a Jogwheel plus the core Push controls (the original Arturia
// KeyLab Essential script names an encoder "Jogwheel" too). Push 2 has no jog wheel
// but names every control Puxi drives the same way (both scripts build on Ableton's
// shared Push code). Push 1 shares most names too, but has no Convert or Page buttons
// (In/Out instead) and a different color palette, so it is NOT taken for a Push 2 (the dev
// machine holds such a Push 1 surface, LocalControlSurfaceWrapper, with no hardware).
var PUSH2_CONTROLS = ["Button_Matrix", "Scene_Launch_Button0", "Track_State_Button0",
                      "Track_Select_Button0", "Accent_Button", "Convert", "Page_Left_Button",
                      "Page_Right_Button"];
function findPushSurface(onlyPush3) {
    var push2 = -1;
    for (var i = 0; i < 16; i++) {
        var cs = surfaceAt(i);
        if (!cs) continue;
        if (isPush3(cs)) return { index: i, model: 3 };
        if (!onlyPush3 && push2 < 0 && isPush2(cs)) push2 = i;
    }
    return { index: push2, model: push2 < 0 ? 0 : 2 };
}

function surfaceAt(i) {
    try {
        var cs = new LiveAPI("control_surfaces " + i);
        return (cs && parseInt(cs.id, 10) !== 0) ? cs : null;
    } catch (e) { return null; }
}

function controlId(cs, name) {
    try { return extractId(cs.call("get_control", name)); } catch (e) { return 0; }
}

function hasControl(cs, name) { return controlId(cs, name) !== 0; }

// "" while the binding is alive, else what changed. Three signals: our own surface handle
// went dead (id 0), a fresh lookup of that index gives another surface object, or that
// surface hands out other matrix/Accent ids (two ids: recycled ids could match one by chance).
function pushStaleReason() {
    var mine = parseInt(pushCS.id, 10);
    if (!mine) return "surface handle dead";
    var cs = surfaceAt(pushIndex);
    if (!cs) return "no surface at " + pushIndex;
    if (parseInt(cs.id, 10) !== mine) return "surface id " + mine + " -> " + cs.id;
    if (!holdsBoundControls(cs))
        return "control ids " + pushMatrixId + "/" + pushAccentId + " -> " +
               controlId(cs, "Button_Matrix") + "/" + controlId(cs, "Accent_Button");
    return "";
}

// Does this surface still hand out the matrix and Accent ids Puxi bound to?
function holdsBoundControls(cs) {
    return !!cs && controlId(cs, "Button_Matrix") === pushMatrixId &&
           controlId(cs, "Accent_Button") === pushAccentId;
}

// Index of the surface that still holds Puxi's bound controls, -1 if none does any more.
function surfaceOwning() {
    for (var i = 0; i < 16; i++)
        if (holdsBoundControls(surfaceAt(i))) return i;
    return -1;
}

function isPush3(cs) {
    return hasControl(cs, "Button_Matrix") && hasControl(cs, "Scene_Launch_Button0") &&
           hasControl(cs, "Track_State_Button0") && hasControl(cs, "Jogwheel");
}

function isPush2(cs) {
    for (var i = 0; i < PUSH2_CONTROLS.length; i++)
        if (!hasControl(cs, PUSH2_CONTROLS[i])) return false;
    return true;
}

// TEST BUILD: a one-time report of every control surface, for Push 2 testers. It lists
// which of Puxi's controls each surface lacks, then all its control names, 10 per line,
// so a copy of the Max window says how that Push names its controls.
var PUXI_CONTROLS = [["Button_Matrix"], ["Accent_Button"], ["Convert", "Convert_Button"],
    ["Double_Button"], ["Repeat_Button", "Repeat"], ["Duplicate_Button"], ["Delete_Button", "Delete"],
    ["Global_Mute_Button"], ["Global_Solo_Button"], ["Octave_Up", "Octave_Up_Button"],
    ["Octave_Down", "Octave_Down_Button"], ["Page_Left", "Page_Left_Button"],
    ["Page_Right", "Page_Right_Button"], ["Track_Control_0"], ["Track_Control_Touch_0"],
    ["Track_Control_7"], ["Track_State_Button0"], ["Track_Select_Button0"], ["Track_Select_Button7"],
    ["Scene_Launch_Button0"], ["Scene_Launch_Button7"], ["Jogwheel"]];
var surfaceReportN = -1; // surfaces seen by the last report (-1 = no report yet)

function reportSurfaces() {
    var app = new LiveAPI("live_app");
    post("Puxi report: Live " + app.call("get_major_version") + "." + app.call("get_minor_version") +
         "." + app.call("get_bugfix_version") + "\n");
    var count = 0;
    for (var i = 0; i < 16; i++) {
        var cs = surfaceAt(i);
        if (!cs) continue;
        count++;
        var names = controlNames(cs);
        post("Puxi report: control_surfaces " + i + ", type " + cs.type + ", " + names.length + " controls\n");
        var missing = [];
        for (var g = 0; g < PUXI_CONTROLS.length; g++) {
            var found = false;
            for (var k = 0; k < PUXI_CONTROLS[g].length; k++)
                if (names.indexOf(PUXI_CONTROLS[g][k]) >= 0) found = true;
            if (!found) missing.push(PUXI_CONTROLS[g][0]);
        }
        post("Puxi report:   missing: " + (missing.length ? missing.join(" ") : "none") + "\n");
        for (var n = 0; n < names.length; n += 10)
            post("Puxi report:   " + names.slice(n, n + 10).join(" ") + "\n");
    }
    if (!count) post("Puxi report: no control surfaces\n");
    return count;
}

// get_control_names answers "control_names N control <name> control <name> … done".
function controlNames(cs) {
    var res = cs.call("get_control_names"), names = [];
    if (!res || typeof res === "string") return names;
    for (var i = 0; i + 1 < res.length; i++)
        if (res[i] === "control") names.push(String(res[i + 1]));
    return names;
}

// Observer callback: the global groove amount changed (or its initial value). Drives the
// swing depth in tick(); stored 0..1 (Live reports 0.-1.0), negatives clamped to 0.
function onGrooveAmount(args) {
    if (!args || args[0] !== "groove_amount") return;
    var v = parseFloat(args[1]);
    grooveAmount = (isNaN(v) || v < 0) ? 0 : v;
}
// Same for the global Swing amount (Live's Quantize swing). Adds to the swing, in playback
// AND in the exported clip (combined groove + swing).
function onSwingAmount(args) {
    if (!args || args[0] !== "swing_amount") return;
    var v = parseFloat(args[1]);
    swingAmount = (isNaN(v) || v < 0) ? 0 : v;
}

// Observer callback: fired when is_playing changes
var restoreParamsTask = null;
function onLiveChange(args) {
    if (args && args[0] === "is_playing" && Number(args[1]) === 0) {
        lastStep = -1;
        lastRawStep = -1;
        for (var r = 0; r < NUM_NOTES; r++) lastStepN[r] = -1; // re-trigger cleanly on restart
        clearPlayheads();
        // Put locked pad params back to their own values. Deferred: Live refuses parameter
        // changes made from inside a notification.
        if (!restoreParamsTask) restoreParamsTask = new Task(restoreAllParams);
        restoreParamsTask.schedule(10);
    }
}

// Per-row playhead to the GUI: cols[t] = view-relative step for row t (-1 = not shown).
function sendPlayheads(cols) {
    gui("playheads", cols[0], cols[1], cols[2], cols[3], cols[4], cols[5], cols[6], cols[7]);
}
function clearPlayheads() {
    cancelFlashes(); // stop any ratchet strobe so a trailing flash task can't relight a pad
    var z = [-1, -1, -1, -1, -1, -1, -1, -1];
    sendPlayheads(z);
    pushSetPlayheads(z);
}

// ---- Sequencer clock ----------------------------------------------
// Called by [metro 16n @quantize 16n] -> "tick". We derive the sixteenth index from
// Live's song position so jumps/loops/launch-quantization stay in sync, then wrap each
// note independently at its OWN loop length (polyrhythm), all phase-locked to song start.
function tick() {
    if (!liveSet) return;
    var beats = parseFloat(liveSet.get("current_song_time")); // in beats
    if (isNaN(beats)) return;
    var S = Math.round(beats * 4); // absolute sixteenth index (1 beat = 4 sixteenths)
    if (S === lastRawStep) return; // nothing advanced this bang
    lastRawStep = S;
    ratchetTasksPrev = ratchetTasks; // keep last step's tasks referenced ONE more tick — swing can
    ratchetTasks = [];               // push a hit past the next tick, so a single-gen clear could GC it
    cancelFlashes();   // ...and the ratchet-strobe tasks, before this step schedules new ones
    var bpm = parseFloat(liveSet.get("tempo"));
    var stepMs = (isNaN(bpm) || bpm <= 0) ? 125 : (60000 / bpm / 4); // one 16th in ms

    // Swing: follow Live's global groove amount AND swing amount — delay the offbeat (odd) 16ths by
    // a fraction of the step proportional to their (capped) sum (the exact groove SHAPE isn't
    // exposed by the API, and grooves apply only to clips, so Puxi approximates it as swing).
    var swingAmt = Math.min(Math.min(grooveAmount, 1) + Math.min(swingAmount, 1), 1); // combined, capped
    var swingMs = (S % 2 === 1 && swingAmt > 0) ? Math.round(swingAmt * SWING_MAX * stepMs) : 0;

    // POLYRHYTHM: each note loops over its OWN region [loopStartN, loopEndN), phase-locked
    // to song start (S=0 -> every note at its loopStart). So at any time each note sits at
    // a different local step. Playback covers the whole pattern, not just the visible block.
    var steps = [], r, len, step;
    for (r = 0; r < NUM_NOTES; r++) {
        len = eLoopE(r) - eLoopS(r);
        if (len < 1) len = 1;
        var local = S % len; if (local < 0) local += len;
        step = eLoopS(r) + local;
        steps[r] = step;
        if (step !== lastStepN[r]) { // per-note dedup: only trigger on an actual step change
            var vel = pattern[r][step];
            // Probability: a fresh random roll per trigger -> statistical (≈ p% of hits),
            // not a fixed every-other pattern. p=100 always (rand<100), p=0 never.
            // Length: note duration = gate% x one step (tempo-aware) -> staccato / tie.
            // Ratchet: R>1 subdivides the step into R evenly-spaced hits (one prob roll for
            // the whole step: all R hits play or none do).
            if (vel > 0 && audible(r) && Math.random() * 100 < effProb(r, step)) {
                applyPlocks(r, step); // p-lock: set the pad's params for this trig before it sounds
                playStep(NOTE_LO + r, effVel(r, step), effGate(r, step), ratchet[r][step], stepMs, swingMs);
            }
            lastStepN[r] = step;
        }
    }
    // Follow reference: the held note's step, else note 0's (global mode has no single one).
    lastStep = steps[loopSelN >= 0 ? loopSelN : 0];

    // Follow: snap the visible block to the reference note's playing block, then re-push.
    if (followPlay && lastStep >= 0) {
        var block = blockOf(lastStep);
        if (block !== stepBase) { stepBase = block; sendFullState(); }
    }

    // Per-row playhead (computed with the final stepBase); -1 when off the visible block.
    var cols = [];
    for (var t = 0; t < VIEW_TRACKS; t++) {
        var st = steps[noteBase + t];
        cols[t] = (st >= stepBase && st < stepBase + VIEW_STEPS) ? (st - stepBase) : -1;
    }
    sendPlayheads(cols);
    pushSetPlayheads(cols, stepMs);
    pushRatchetIdle(S, stepMs); // strobe ratcheted notes every RATCHET_IDLE_EVERY steps (idle indicator)
}

// Play one step. delayMs > 0 = swing: the whole step (incl. any ratchet sub-hits) is delayed
// by delayMs. R>1 = ratchet: R evenly-spaced hits across the step at delayMs + k*(stepMs/R).
// Each hit lasts gate% of its own SLOT (stepMs/R) so gate still shapes staccato/tie within the
// subdivision. Scheduled hits are kept referenced across TWO ticks (ratchetTasks + ...Prev) so
// Max doesn't garbage-collect one before it runs (swing can push a hit past the next tick). Each
// hit is emitted by a closure calling note(pitch, vel, dur) — the same 3-arg form as an immediate
// hit (passing values via Task.arguments appends an arg -> "makenote: extra argument").
var ratchetTasks = [], ratchetTasksPrev = [];
function scheduleHit(pitch, vel, dur, delay) {
    var tk = new Task(function () { note(pitch, vel, dur); });
    tk.schedule(delay);
    ratchetTasks.push(tk);
}
function playStep(pitch, vel, gatePct, R, stepMs, delayMs) {
    R = Math.round(R);
    delayMs = delayMs || 0;
    if (R <= 1) {
        var d1 = Math.round(gatePct / 100 * stepMs);
        if (delayMs > 0) scheduleHit(pitch, vel, d1, delayMs); else note(pitch, vel, d1);
        return;
    }
    var slot = stepMs / R;
    var dur = Math.round(gatePct / 100 * slot); if (dur < 1) dur = 1;
    if (delayMs > 0) scheduleHit(pitch, vel, dur, delayMs); else note(pitch, vel, dur); // first hit
    for (var k = 1; k < R; k++) scheduleHit(pitch, vel, dur, Math.round(delayMs + k * slot));
}

// ---- View navigation ----------------------------------------------
// "nav notes <delta>" / "nav steps <delta>" scroll the viewport by whole banks
// / blocks. The same messages will later come from the Push arrow buttons.
function nav(axis, delta) {
    delta = Math.round(delta);
    if (axis === "notes") {
        var nb = clamp(noteBase + delta * VIEW_TRACKS, 0, NUM_NOTES - VIEW_TRACKS);
        if (nb === noteBase) return;
        noteBase = nb;
        sendFullState();
        pushSnapshot(); // noteBase is part of PuxiState
    } else if (axis === "steps") {
        followPlay = false; // manual step navigation turns follow off
        stepBase = clamp(stepBase + delta * VIEW_STEPS, 0, TOTAL_STEPS - VIEW_STEPS);
        sendFullState(); // stepBase is not persisted (a reopened Set starts on block 1)
    }
}

// FOLLOW toggle from the GUI (bare "follow" flips it; "follow 0|1" sets it).
function follow(on) {
    if (arguments.length === 0) followPlay = !followPlay;
    else followPlay = (Number(on) !== 0);
    if (followPlay && lastStep >= 0) stepBase = blockOf(lastStep); // snap now
    sendFullState(); // also re-emits the params (Follow persists via its live.* param)
}

// The loop the encoders/ruler currently edit: the global loop, or the selected note's
// EFFECTIVE loop (so grabbing a follower starts from the global value, then diverges).
function loopTargetS() { return loopSelN < 0 ? gLoopS : eLoopS(loopSelN); }
function loopTargetE() { return loopSelN < 0 ? gLoopE : eLoopE(loopSelN); }

// A custom loop equal to the global one is no longer "custom" -> it rejoins global
// control (so editing the global loop will move it again). Keeps the custom/global invariant.
function normalizeCustom() {
    for (var r = 0; r < NUM_NOTES; r++) {
        if (loopCustom[r] && loopStartN[r] === gLoopS && loopEndN[r] === gLoopE) loopCustom[r] = 0;
    }
}

// Set the loop region [start, end) in steps (GUI ruler / Push encoders). Global target
// (loopSelN < 0) moves the global loop — followers track it, custom notes stay FROZEN.
// A note target makes that note custom (frozen vs global); setting it back to the global
// value turns it back into a follower.
function setloop(start, end) {
    start = clamp(Math.round(start), 0, TOTAL_STEPS - 1);
    end = clamp(Math.round(end), start + 1, TOTAL_STEPS);
    if (loopSelN < 0) {
        gLoopS = start; gLoopE = end; // followers track via eLoop*; custom notes frozen
    } else {
        loopStartN[loopSelN] = start;
        loopEndN[loopSelN] = end;
        loopCustom[loopSelN] = 1;
    }
    normalizeCustom();
    sendLoops();      // GUI: per-row effective regions + ruler/selection
    sendParams();     // Push encoders/screen reflect the active target
    if (pushGrabbed && pushAfterGrab) pushAfterGrab.schedule(50); // re-gray pads (coalesced)
    scheduleLoopSnap(); // debounce: a whole encoder turn / ruler drag = ONE undo step
}

// Loop edits arrive in bursts (every encoder increment / drag pixel). Coalesce them into
// a single PuxiState snapshot ~250 ms after the gesture settles, so Cmd+Z reverts the
// whole turn at once instead of one step at a time.
var loopSnapTask = null;
function scheduleLoopSnap() {
    if (!loopSnapTask) loopSnapTask = new Task(pushSnapshot);
    loopSnapTask.schedule(250);
}

// Same idea for probability: a drag (GUI) or encoder turn (Push) = one undo step.
var probSnapTask = null;
function scheduleProbSnap() {
    if (!probSnapTask) probSnapTask = new Task(pushSnapshot);
    probSnapTask.schedule(250);
}

// "Double loop": extend the GLOBAL loop to twice its length (start fixed, end doubled) and
// copy its notes (all rows) into the new second half — a phrase that repeats at 2x length.
// Available only when: there is >=1 note inside the loop (something to double), the doubled
// length still fits in TOTAL_STEPS (max 8 blocks), and the target region is EMPTY (nothing
// to overwrite). The loop start/end markers' START is unchanged; only the end moves.
function canDoubleLoop() {
    var L = gLoopE - gLoopS;
    if (L < 1 || gLoopE + L > TOTAL_STEPS) return false; // nothing, or won't fit
    var hasSrc = false, r, s;
    for (r = 0; r < NUM_NOTES; r++) {
        for (s = gLoopE; s < gLoopE + L; s++) if (pattern[r][s] > 0) return false; // target not empty
        if (!hasSrc) for (s = gLoopS; s < gLoopE; s++) if (pattern[r][s] > 0) { hasSrc = true; break; }
    }
    return hasSrc;
}
function doubleloop() {
    if (!canDoubleLoop()) return;
    var L = gLoopE - gLoopS, oldEnd = gLoopE, r, s;
    for (r = 0; r < NUM_NOTES; r++)
        for (s = 0; s < L; s++) {
            pattern[r][oldEnd + s] = pattern[r][gLoopS + s];
            prob[r][oldEnd + s] = prob[r][gLoopS + s]; // a note carries its probability
            gate[r][oldEnd + s] = gate[r][gLoopS + s]; // ...its length
            ratchet[r][oldEnd + s] = ratchet[r][gLoopS + s]; // ...its ratchet
            plock[r][oldEnd + s] = [plock[r][gLoopS + s][0], plock[r][gLoopS + s][1]]; // ...and its param locks
        }
    gLoopE = oldEnd + L;     // start fixed, end doubled (followers track it)
    normalizeCustom();
    sendFullState();         // repaint grid + loops + pads + the ×2 button's availability
    pushSnapshot();          // persist + one undo step
}

// Choose what the loop encoders / ruler target: a note row, or -1 for the global loop.
// Re-syncs the encoder detents to the target and refreshes the GUI ruler + Push screen.
function selectLoopNote(r) {
    if (r < -1 || r >= NUM_NOTES || r === loopSelN) return;
    loopSelN = r;
    magStart.acc = 0; magStart.last = loopTargetS() + 1; // detents track the new target
    magEnd.acc = 0;   magEnd.last = loopTargetE();
    sendLoops();
    sendParams();
}

// Per-row loop regions (for the GUI gray-out) + the active target (ruler + highlight).
// loop t ls le (visible row, absolute step bounds); loopsel selT ls le
// (selT = view-rel selected row, or -1 = global / off-view -> no row highlighted).
function sendLoops() {
    for (var t = 0; t < VIEW_TRACKS; t++) {
        var r = noteBase + t;
        gui("loop", t, eLoopS(r), eLoopE(r)); // effective region (custom or global)
    }
    var selT = (loopSelN >= 0) ? (loopSelN - noteBase) : -1;
    if (selT < 0 || selT >= VIEW_TRACKS) selT = -1;
    gui("loopsel", selT, loopTargetS(), loopTargetE());
}

// ---- Messages from the GUI (VIEW-relative t, s) -------------------
function toggle(t, s) {
    var r = noteBase + t, step = stepBase + s;
    if (!validCell(r, step)) return;
    pattern[r][step] = (pattern[r][step] > 0) ? 0 : DEFAULT_VELOCITY;
    resetProbOnEntry(r, step, t, s);
    gui("cell", t, s, pattern[r][step]);
    pushSetPad(t, s, pattern[r][step]);
    pushSnapshot();
}

// Probability, length AND ratchet belong to the NOTE, not the step: entering a note always
// starts all three at their default, even if values lingered on that step. (Editing an
// existing note — velocity drag / prob / length / ratchet — does NOT come through here.)
function resetProbOnEntry(r, step, t, s) {
    if (pattern[r][step] <= 0) return;
    if (prob[r][step] !== 100) { prob[r][step] = 100; gui("cprob", t, s, 100); }
    if (gate[r][step] !== DEFAULT_GATE) { gate[r][step] = DEFAULT_GATE; gui("clen", t, s, DEFAULT_GATE); }
    if (ratchet[r][step] !== 1) { ratchet[r][step] = 1; gui("cratchet", t, s, 1); }
    plock[r][step] = [-1, -1]; // a fresh note has no per-step lock -> it follows the row offset
}

function setvel(t, s, v) {
    var r = noteBase + t, step = stepBase + s;
    if (!validCell(r, step)) return;
    pattern[r][step] = clamp(Math.round(v), 0, 127);
    gui("cell", t, s, pattern[r][step]);
    pushSetPad(t, s, pattern[r][step]);
    pushSnapshot();
}

// Per-cell play probability 0..100. (Entering a note resets it to 100 — see
// resetProbOnEntry; this only edits the prob of the note as it stands.)
function setprob(t, s, p) {
    var r = noteBase + t, step = stepBase + s;
    if (!validCell(r, step)) return;
    prob[r][step] = clamp(Math.round(p), 0, 100);
    gui("cprob", t, s, prob[r][step]);
    pushSetPad(t, s, pattern[r][step]); // re-base the pad (shimmer pair may have changed)
    scheduleProbSnap(); // debounce: a whole drag = one undo step
}

// Per-cell note length, % of a step (5..6400). GUI horizontal-drag on a note's right zone /
// Push Length encoder. Repaints the pad tail region.
var gateSnapTask = null;
function scheduleGateSnap() {
    if (!gateSnapTask) gateSnapTask = new Task(pushSnapshot);
    gateSnapTask.schedule(250);
}
// Per-cell ratchet 1..8 (GUI Shift-drag / Push Repeat gesture). Snapshots debounced like
// the other continuous edits. (Ratchet is per-cell only — no global offset.)
var ratchetSnapTask = null;
function scheduleRatchetSnap() {
    if (!ratchetSnapTask) ratchetSnapTask = new Task(pushSnapshot);
    ratchetSnapTask.schedule(250);
}
function setratchet(t, s, rc) {
    var r = noteBase + t, step = stepBase + s;
    if (!validCell(r, step)) return;
    ratchet[r][step] = clamp(Math.round(rc), 1, RATCHET_MAX);
    gui("cratchet", t, s, ratchet[r][step]);
    scheduleRatchetSnap();
}

function setgate(t, s, g) {
    var r = noteBase + t, step = stepBase + s;
    if (!validCell(r, step)) return;
    gate[r][step] = clamp(Math.round(g), MIN_GATE, MAX_GATE);
    gui("clen", t, s, gate[r][step]);
    if (pushGrabbed && pushAfterGrab) pushAfterGrab.schedule(50); // repaint tails (coalesced)
    scheduleGateSnap();
}

// Mute / solo a visible row (t view-relative -> absolute row noteBase+t). Persisted +
// undoable like the pattern. sendMuteSolo() repaints the GUI + Push for that row.
function mutetrack(t) {
    var r = noteBase + t;
    if (r < 0 || r >= NUM_NOTES) return;
    muted[r] = muted[r] ? 0 : 1;
    sendMuteSolo();
    pushSnapshot();
}
// Exclusive solo: the row you click becomes the ONLY soloed one; clicking it again
// clears solo entirely.
function solotrack(t) {
    var r = noteBase + t;
    if (r < 0 || r >= NUM_NOTES) return;
    var wasSolo = soloed[r];
    for (var i = 0; i < NUM_NOTES; i++) soloed[i] = 0;
    soloCount = 0;
    if (!wasSolo) { soloed[r] = 1; soloCount = 1; }
    sendMuteSolo();
    pushSnapshot();
}

// Push the mute/solo state of every visible row to the GUI, then refresh the Push
// (pads gray muted/silenced rows; scene + Mute/Solo button LEDs follow).
// "musolo t mute solo soloActive" — soloActive (global) lets the GUI gray rows that a
// solo elsewhere silences.
function sendMuteSolo() {
    var sa = soloCount > 0 ? 1 : 0;
    for (var t = 0; t < VIEW_TRACKS; t++) {
        var r = noteBase + t;
        gui("musolo", t, muted[r], soloed[r], sa);
    }
    pushRenderGrid(); // repaint pads (gray muted rows) + scene/Mute/Solo LEDs (no-op unless focused)
}

// ---- Export the pattern to a MIDI clip ----------------------------
// "exportclip" (GUI button / Push): bake the pattern into a new MIDI clip in the first empty
// slot of Puxi's track, carrying everything Puxi adds on top of pitch + velocity:
//   - LENGTH (gate): note duration = effGate% x a step (ties become longer/overlapping notes)
//   - PROBABILITY: the note's `probability` field (Live 11+) = effProb/100
//   - RATCHET: a ratcheted cell is expanded into R evenly-spaced notes across the step
//   - GROOVE/SWING: the current swing is printed — offbeat (odd) 16ths are nudged later in time
//   - global probability/length offsets are folded in (effProb/effGate); Accent is already in velocity
// Length = last occupied step rounded up to whole beats (so an 8/16-step loop stays intact).
// NOT unrolled: per-note loops (polyrhythm) and mute/solo are performance state — the clip is
// the programmed grid, looped by Live as one region. (add_new_notes — Live 11+; `has_clip == 0`,
// never `!has_clip`, which the LiveAPI/JS engine evaluates wrong.)
function exportclip() {
    try {
        var lastStep = -1, r, s;
        for (r = 0; r < NUM_NOTES; r++)
            for (s = 0; s < TOTAL_STEPS; s++)
                if (pattern[r][s] > 0 && s > lastStep) lastStep = s;
        if (lastStep < 0) { post("Puxi: pattern is empty — nothing to export\n"); return; }
        var steps = Math.ceil((lastStep + 1) / 4) * 4; // round up to whole beats
        var lengthBeats = steps / 4;                   // 4 sixteenth-steps per beat

        var track = new LiveAPI("this_device canonical_parent"); // the device's track
        var nSlots = parseInt(track.getcount("clip_slots"), 10) || 0;
        var slotIdx = -1;
        for (var i = 0; i < nSlots; i++) {
            var sl = new LiveAPI("this_device canonical_parent clip_slots " + i);
            if (sl.get("has_clip") == 0) { slotIdx = i; break; }
        }
        if (slotIdx < 0) { post("Puxi: no empty clip slot on this track\n"); return; }

        var base = "this_device canonical_parent clip_slots " + slotIdx;
        new LiveAPI(base).call("create_clip", lengthBeats);
        var clip = new LiveAPI(base + " clip");

        var STEP_BEATS = 0.25; // one 16th
        var swingAmt = Math.min(Math.min(grooveAmount, 1) + Math.min(swingAmount, 1), 1); // groove + swing, capped
        var swingBeats = swingAmt * SWING_MAX * STEP_BEATS; // offbeat-16th nudge (same as playback)
        var notes = [];
        for (r = 0; r < NUM_NOTES; r++)
            for (s = 0; s < steps; s++) {
                if (pattern[r][s] <= 0) continue;
                var v = effVel(r, s);                  // velocity with the global offset folded in
                var startB = s * STEP_BEATS + ((s % 2 === 1) ? swingBeats : 0); // print the swing
                var prob01 = effProb(r, s) / 100;      // per-note probability (Live 11+)
                var gatePct = effGate(r, s);           // length as % of a step
                var R = ratchet[r][s];
                if (R <= 1) {
                    pushNote(notes, NOTE_LO + r, startB, gatePct / 100 * STEP_BEATS, v, prob01);
                } else {
                    var slotB = STEP_BEATS / R;        // ratchet -> R notes across the step
                    for (var k = 0; k < R; k++)
                        pushNote(notes, NOTE_LO + r, startB + k * slotB, gatePct / 100 * slotB, v, prob01);
                }
            }
        clip.call("add_new_notes", { notes: notes });
        try { clip.set("name", "Puxi"); } catch (e2) {}
        post("Puxi: exported " + notes.length + " notes -> slot " + slotIdx +
             " (" + lengthBeats + " beats)\n");
    } catch (e) { post("Puxi exportclip err: " + e + "\n"); }
}
// Build one note dict; `probability` is only set when < 1 (100% notes stay plain dicts).
function pushNote(notes, pitch, start, dur, vel, prob01) {
    var n = { pitch: pitch, start_time: start, duration: Math.max(dur, 0.001), velocity: vel };
    if (prob01 < 1) n.probability = prob01 < 0 ? 0 : prob01;
    notes.push(n);
}

// ---- Catch an existing MIDI clip -> the pattern (inverse of exportclip) ------
// Reads the clip open in Live's detail (piano-roll) view — or the highlighted slot's clip —
// and lays its notes onto Puxi's grid: pitch -> row (NOTE_LO+r), start_time -> nearest 16th
// step, velocity/duration/probability -> the cell. Notes off the 16th grid are QUANTIZED;
// notes outside the pitch/step range are dropped; ratchets aren't reconstructed (a clip has
// none — sub-notes within a step collapse). REPLACES the note grid + per-cell params (keeps
// mute/solo + globals); sets the global loop to the clip length.
function catchClipTarget() {
    var c = new LiveAPI("live_set view detail_clip");
    if (c && parseInt(c.id, 10) > 0 && String(c.get("is_midi_clip")) === "1") return c;
    var slot = new LiveAPI("live_set view highlighted_clip_slot");
    if (slot && parseInt(slot.id, 10) > 0 && String(slot.get("has_clip")) === "1") {
        var cc = new LiveAPI("live_set view highlighted_clip_slot clip");
        if (cc && parseInt(cc.id, 10) > 0 && String(cc.get("is_midi_clip")) === "1") return cc;
    }
    return null;
}
function clearGrid() { // note content + per-cell params (mute/solo, loops, globals untouched)
    for (var r = 0; r < NUM_NOTES; r++)
        for (var s = 0; s < TOTAL_STEPS; s++) {
            pattern[r][s] = 0; prob[r][s] = 100; gate[r][s] = DEFAULT_GATE; ratchet[r][s] = 1; plock[r][s] = [-1, -1];
        }
}
function catchclip() {
    try {
        var clip = catchClipTarget();
        if (!clip) { post("Puxi: select a MIDI clip to catch\n"); return; }
        var lenBeats = parseFloat(clip.get("length")); if (isNaN(lenBeats) || lenBeats <= 0) lenBeats = TOTAL_STEPS / 4;
        var res = clip.call("get_notes_extended", 0, 128, 0, lenBeats); // Live 11+: JSON dict (string)
        var data = (typeof res === "string") ? JSON.parse(res) : res;
        var src = (data && data.notes) ? data.notes : [];
        clearGrid();
        var n, r, step, kept = 0;
        for (var i = 0; i < src.length; i++) {
            n = src[i];
            r = Math.round(Number(n.pitch)) - NOTE_LO;
            step = Math.round(Number(n.start_time) * 4); // quantize to the 16th grid
            if (r < 0 || r >= NUM_NOTES || step < 0 || step >= TOTAL_STEPS) continue;
            pattern[r][step] = clamp(Math.round(Number(n.velocity)), 1, 127);
            gate[r][step] = clamp(Math.round(Number(n.duration) / 0.25 * 100), MIN_GATE, MAX_GATE); // 0.25 beat = a step
            if (n.probability != null) prob[r][step] = clamp(Math.round(Number(n.probability) * 100), 0, 100);
            kept++;
        }
        // global loop = clip length (>=1 block), all notes follow it (drop custom polyrhythm loops)
        gLoopS = 0; gLoopE = clamp(Math.round(lenBeats * 4), VIEW_STEPS, TOTAL_STEPS);
        for (r = 0; r < NUM_NOTES; r++) loopCustom[r] = 0;
        normalizeCustom();
        sendFullState();
        pushSnapshot();
        post("Puxi: caught " + kept + " notes (" + lenBeats + " beats)\n");
    } catch (e) { post("Puxi catchclip err: " + e + "\n"); }
}

function validCell(r, step) {
    return r >= 0 && r < NUM_NOTES && step >= 0 && step < TOTAL_STEPS;
}

function refresh() {
    sendFullState();
}

// ---- GUI sync ------------------------------------------------------
function sendFullState() {
    gui("clear");
    sendView();
    for (var t = 0; t < VIEW_TRACKS; t++) {
        var r = noteBase + t;
        gui("label", t, rowName[r] != null ? rowName[r] : noteName(NOTE_LO + r));
        if (rowColor[r]) gui("color", t, rowColor[r][0], rowColor[r][1], rowColor[r][2]);
        else gui("color", t, -1); // -1 -> GUI uses its default palette color
        for (var s = 0; s < VIEW_STEPS; s++) {
            var vel = pattern[r][stepBase + s];
            if (vel > 0) gui("cell", t, s, vel);
            if (prob[r][stepBase + s] !== 100) gui("cprob", t, s, prob[r][stepBase + s]); // probability cue
            if (gate[r][stepBase + s] !== DEFAULT_GATE) gui("clen", t, s, gate[r][stepBase + s]); // length cue
            if (ratchet[r][stepBase + s] !== 1) gui("cratchet", t, s, ratchet[r][stepBase + s]); // ratchet cue
        }
    }
    sendLoops();      // per-note loop regions (gray-out) + selected row (ruler)
    sendTailIns();    // notes tying in from the previous page (GUI overflow tails)
    gui("gprob", gProb); // global probability (the GUI derives each bar's effective width)
    gui("glen", gGate);  // global length offset (GUI derives each note's effective tail)
    gui("gvel", gVel);   // global velocity offset (GUI derives each cell's effective brightness)
    gui("dbl", canDoubleLoop() ? 1 : 0); // GUI ×2 button availability
    sendMuteSolo();   // mute/solo -> GUI + Push pads (grayed) + scene/Mute/Solo LEDs (also repaints pads)
    sendParams();     // keep exposed params in sync on every view change
}

// Current window so the GUI can draw bank/block position, limits, follow state. The
// loop regions are per-note now and travel via sendLoops (loop/loopsel), not here.
// view <noteBase> <noteMax> <stepBase> <stepMax> <follow>
function sendView() {
    gui("view", noteBase, NUM_NOTES - VIEW_TRACKS,
           stepBase, TOTAL_STEPS - VIEW_STEPS, followPlay ? 1 : 0);
}

// ---- Persistence with the Live Set --------------------------------
// State persists through a [pattr PuxiState] living INSIDE the [p pstate] subpatcher,
// made a type-3 (list) Live parameter. Factory-proven shape (Step Arp): a TOP-LEVEL
// pattr does NOT register as a device parameter (verified: getcount stayed at 5), but
// a pattr in a subpatcher does. We keep the state as a flat INT LIST — the pattr's
// native type, with none of the quoting/symbol hazards of a JSON string. The engine
// pushes the current state into the pattr (via "set", no echo) on every change so
// Live saves the latest value; on Set reopen the pattr re-emits its saved list, which
// arrives here as "pstate <ints...>". (NOT getvalueof/setvalueof + @bindto: a bound
// top-level pattr never registered. NOT save()/embedmessage: Max-standalone only.)
// Layout: see serialize() (v4 = noteBase + sparse mute/solo + global loop + custom loops + hits).
var STATE_VERSION = 8;      // v1..v7 (see below); v8 +per-step param locks & per-row lock offsets
var pendingRestore = null;  // saved list stashed by pstate() until the engine is up
var restoreSettled = false; // gate: don't push to the pattr until any saved value has
                            // been restored, so we never overwrite it on reopen
var settleTask = null;

// Serialize to a flat int list. v8 layout:
//   [8, noteBase, nMute, <muted…>, nSolo, <soloed…>, gLoopS, gLoopE, nCustom, <r,ls,le…>,
//       nProb, <r,s,p…>, nGate, <r,s,g…>, nRatchet, <r,s,rc…>,
//       nPlock, <r,s,a,b for a step with any lock…>, nBase, <r,a,b for a row with a non-neutral offset…>,
//       r,s,v, …]
// Sparse everywhere (lock/base values are normalized 0..127, -1 = unset). The view block +
// follow + global probability/length persist via their own live.* params, not here. v1..v7 still read.
function serialize() {
    var a = [STATE_VERSION, noteBase];
    var mi = [], si = [], ci = [], pi = [], gi = [], ri = [], li = [], bi = [], r, s;
    for (r = 0; r < NUM_NOTES; r++) {
        if (muted[r]) mi.push(r);
        if (soloed[r]) si.push(r);
        if (loopCustom[r]) ci.push(r);
        if (plockBase[r][0] !== PLOCK_MID || plockBase[r][1] !== PLOCK_MID) bi.push(r, plockBase[r][0], plockBase[r][1]);
        for (s = 0; s < TOTAL_STEPS; s++) {
            if (prob[r][s] !== 100) pi.push(r, s, prob[r][s]);
            if (gate[r][s] !== DEFAULT_GATE) gi.push(r, s, gate[r][s]);
            if (ratchet[r][s] !== 1) ri.push(r, s, ratchet[r][s]);
            if (plock[r][s][0] >= 0 || plock[r][s][1] >= 0) li.push(r, s, plock[r][s][0], plock[r][s][1]);
        }
    }
    a.push(mi.length); for (var im = 0; im < mi.length; im++) a.push(mi[im]);
    a.push(si.length); for (var is = 0; is < si.length; is++) a.push(si[is]);
    a.push(gLoopS); a.push(gLoopE);
    a.push(ci.length); for (var ic = 0; ic < ci.length; ic++) {
        var cr = ci[ic]; a.push(cr); a.push(loopStartN[cr]); a.push(loopEndN[cr]);
    }
    a.push(pi.length / 3); for (var ip = 0; ip < pi.length; ip++) a.push(pi[ip]);
    a.push(gi.length / 3); for (var ig = 0; ig < gi.length; ig++) a.push(gi[ig]);
    a.push(ri.length / 3); for (var ir = 0; ir < ri.length; ir++) a.push(ri[ir]);
    a.push(li.length / 4); for (var il = 0; il < li.length; il++) a.push(li[il]);
    a.push(bi.length / 3); for (var ib = 0; ib < bi.length; ib++) a.push(bi[ib]);
    for (r = 0; r < NUM_NOTES; r++) {
        var row = pattern[r];
        for (s = 0; s < TOTAL_STEPS; s++) {
            var v = row[s];
            if (v > 0) { a.push(r); a.push(s); a.push(v); }
        }
    }
    return a;
}

// Store the current state in the [p pstate] pattr so Live saves it with the Set. We
// send the bare value (NOT "set ...") so the pattr updates its PARAMETER value (what
// Live persists); the pattr echoes it back, which pstate() ignores via lastPushedKey.
// Gated on restoreSettled so a reopen can't be clobbered before its saved value lands.
function pushSnapshot() {
    if (!restoreSettled) return;
    param.apply(null, ["state"].concat(serialize())); // -> route ... state -> pattr (updates param)
    updateConvertLed(); // a pattern edit may have crossed the empty<->non-empty boundary
    updateDoubleLed();  // …and the double-loop availability
    updateDuplicateLed(); // …and the block copy/paste availability
    gui("dbl", canDoubleLoop() ? 1 : 0); // refresh the GUI ×2 button after an edit
}

// Saved value arriving from the subpatcher pattr on Set reopen ("pstate <ints...>").
// MUST NOT touch LiveAPI (can fire before live.thisdevice): only stash + apply state.
function pstate() {
    try {
        var a = arrayfromargs(arguments);
        // Skip if it already matches the current state: that is the pattr echoing our own
        // push, or a redundant restore — nothing to apply. A real undo/redo brings a
        // DIFFERENT value, which falls through to applyRestore (so redo of the last edit
        // works, unlike a persistent value-guard that would mistake it for an echo).
        if (a.join(",") === serialize().join(",")) return;
        pendingRestore = a;
        restoreSettled = true; // the saved value has landed -> pushes may run now
        applyRestoreIfReady();
    } catch (e) { post("Puxi pstate err: " + e + "\n"); }
}

// Apply the stashed list at most once (consumes pendingRestore, so a duplicate pstate
// or double-instantiation can't re-apply), tolerant of stale/short/old-schema data.
// Repaints only if inited; otherwise init()/selfInit() paints once LiveAPI is up.
function applyRestoreIfReady() {
    if (pendingRestore == null) return;
    var a = pendingRestore;
    pendingRestore = null; // consume: apply-once
    if (!a || a.length < 2) return;
    var ver = a[0] | 0;
    if (ver < 1 || ver > 8) return; // unknown schema -> keep defaults

    initPattern(); // zero the grid + reset mute/solo + default loops, then lay down saved data
    var i = 2, hStart;
    if (ver >= 2) { // mute, solo, [v3] per-note loops / [v4] global+custom loops, then hits
        var nM = a[i++] | 0;
        for (var km = 0; km < nM && i < a.length; km++) {
            var mr = a[i++] | 0; if (mr >= 0 && mr < NUM_NOTES) muted[mr] = 1;
        }
        var nS = a[i++] | 0;
        for (var ks = 0; ks < nS && i < a.length; ks++) {
            var sr = a[i++] | 0;
            if (sr >= 0 && sr < NUM_NOTES && !soloed[sr]) { soloed[sr] = 1; soloCount++; }
        }
        if (ver === 3) { // legacy: per-note loops -> custom (global stays default)
            var nL = a[i++] | 0;
            for (var kl = 0; kl < nL && i + 2 < a.length; kl++) {
                var lr = a[i++] | 0, ls = a[i++] | 0, le = a[i++] | 0;
                if (lr >= 0 && lr < NUM_NOTES && ls >= 0 && le > ls && le <= TOTAL_STEPS) {
                    loopStartN[lr] = ls; loopEndN[lr] = le; loopCustom[lr] = 1;
                }
            }
        } else if (ver >= 4) { // global loop, then custom-loop notes
            gLoopS = clamp(a[i++] | 0, 0, TOTAL_STEPS - 1);
            gLoopE = clamp(a[i++] | 0, gLoopS + 1, TOTAL_STEPS);
            var nC = a[i++] | 0;
            for (var kc = 0; kc < nC && i + 2 < a.length; kc++) {
                var cr = a[i++] | 0, cls = a[i++] | 0, cle = a[i++] | 0;
                if (cr >= 0 && cr < NUM_NOTES && cls >= 0 && cle > cls && cle <= TOTAL_STEPS) {
                    loopStartN[cr] = cls; loopEndN[cr] = cle; loopCustom[cr] = 1;
                }
            }
        }
        if (ver >= 5) { // per-cell probability (only cells != 100)
            var nP = a[i++] | 0;
            for (var kp = 0; kp < nP && i + 2 < a.length; kp++) {
                var pr = a[i++] | 0, ps = a[i++] | 0, pp = a[i++] | 0;
                if (pr >= 0 && pr < NUM_NOTES && ps >= 0 && ps < TOTAL_STEPS) prob[pr][ps] = clamp(pp, 0, 100);
            }
        }
        if (ver >= 6) { // per-cell length (only cells != DEFAULT_GATE)
            var nG = a[i++] | 0;
            for (var kg = 0; kg < nG && i + 2 < a.length; kg++) {
                var gr = a[i++] | 0, gs = a[i++] | 0, gg = a[i++] | 0;
                if (gr >= 0 && gr < NUM_NOTES && gs >= 0 && gs < TOTAL_STEPS) gate[gr][gs] = clamp(gg, MIN_GATE, MAX_GATE);
            }
        }
        if (ver >= 7) { // per-cell ratchet (only cells != 1)
            var nR = a[i++] | 0;
            for (var kr = 0; kr < nR && i + 2 < a.length; kr++) {
                var rr = a[i++] | 0, rs = a[i++] | 0, rc = a[i++] | 0;
                if (rr >= 0 && rr < NUM_NOTES && rs >= 0 && rs < TOTAL_STEPS) ratchet[rr][rs] = clamp(rc, 1, RATCHET_MAX);
            }
        }
        if (ver >= 8) { // per-step param locks (quads) then per-row lock offsets (triples)
            var nL = a[i++] | 0;
            for (var kL = 0; kL < nL && i + 3 < a.length; kL++) {
                var lr = a[i++] | 0, ls2 = a[i++] | 0, la = a[i++] | 0, lb = a[i++] | 0;
                if (lr >= 0 && lr < NUM_NOTES && ls2 >= 0 && ls2 < TOTAL_STEPS)
                    plock[lr][ls2] = [clampLock(la), clampLock(lb)];
            }
            var nB = a[i++] | 0;
            for (var kB = 0; kB < nB && i + 2 < a.length; kB++) {
                var br = a[i++] | 0, ba = a[i++] | 0, bb = a[i++] | 0;
                if (br >= 0 && br < NUM_NOTES) plockBase[br] = [clampLock(ba), clampLock(bb)];
            }
        }
        hStart = i;
    } else {
        hStart = 2; // v1: hits start right after noteBase
    }
    for (i = hStart; i + 2 < a.length; i += 3) {
        var r = a[i] | 0, st = a[i + 1] | 0, vel = clamp(a[i + 2] | 0, 0, 127);
        if (r >= 0 && r < NUM_NOTES && st >= 0 && st < TOTAL_STEPS && vel > 0)
            pattern[r][st] = vel; // validate every cell (tolerate stale/bad data)
    }
    noteBase = clamp(a[1] | 0, 0, NUM_NOTES - VIEW_TRACKS); noteBase -= noteBase % VIEW_TRACKS;
    normalizeCustom(); // drop any restored custom loop that equals the global one
    // Re-sync the loop-encoder detents to the restored values, so when an undo/redo also
    // reverts the Loop Start/End param the detent sees no delta and won't re-absorb it.
    magStart.acc = 0; magStart.last = loopTargetS() + 1;
    magEnd.acc = 0;   magEnd.last = loopTargetE();
    // global + custom loops restored above; view block + follow come from their live.* params.
    if (inited) { try { sendFullState(); } catch (e) {} } // else init/selfInit will paint it
}

// Fresh device (or a Set with no saved Puxi state): no pstate ever arrives, so open
// the push gate after a short delay so the first edit can be saved. Scheduled by init.
function settleRestore() { restoreSettled = true; loopRestoreWindow = false; }

// ---- Self-init (Set-reopen safety) --------------------------------
// On Set reopen the v8 script can finish loading AFTER [live.thisdevice] already
// banged "init" (that message is then lost -> "no function init"). But a late load
// means the device is already up, so LiveAPI is usable: probe this_device and init
// ourselves. The "init" message still covers the normal early-load path; the
// `inited` guard makes the heavy setup run exactly once whichever path wins.
var selfInitTask = null, selfInitTries = 0;
function liveReady() {
    try { return parseInt(new LiveAPI("this_device").id, 10) > 0; } catch (e) { return false; }
}
function selfInit() {
    if (inited) return;
    if (liveReady()) { try { init(); } catch (e) { post("Puxi selfInit err: " + e + "\n"); } }
    if (!inited && selfInitTries++ < 40 && selfInitTask) selfInitTask.schedule(100);
}
selfInitTask = new Task(selfInit);
selfInitTask.schedule(150);
