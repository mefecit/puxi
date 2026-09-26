// SPDX-License-Identifier: GPL-3.0-only
// Copyright (C) 2026 mefecit <pest-kernels-6r@icloud.com>
// ============================================================
// Puxi — 8-track drum sequencer for Max for Live
// puxi-gui.js — GUI, runs inside a [v8ui] object (mgraphics API)
//
// Phase 1 MVP:
//   - An 8-track x 8-step grid (OXI One style), a viewport into a larger
//     pattern held by the engine
//   - Tap a cell to toggle it; hold + drag vertically to set its velocity
//     (brightness = velocity); steps outside the loop region are dimmed
//   - Left gutter: ▲/▼ scroll note banks ("nav notes ±1") + bank pips
//   - Bottom strip: FOLLOW toggle, ◄/► scroll step blocks ("nav steps ±1"),
//     and a loop ruler with start/end handles (drag -> "setloop start end")
//   - Green vertical playhead following Live's transport
//   - Track labels = note names of the current bank
//
// Inlet:  from engine: "cell t s v", "cprob t s p", "gprob v", "clen t s g", "glen v", "gvel v",
//         "cratchet t s r", "tailin t extent", "playheads s0..s7", "label t name", "color t r g b",
//         "loop t ls le",
//         "loopsel selT ls le", "view nb nmax sb smax follow", "musolo t m s sa", "dbl 0|1", "clear"
// Outlet: "toggle t s" / "setvel t s v" / "setprob t s p" / "setgate t s g" / "setratchet t s r" /
//         "nav axis delta" / "follow" / "setloop start end" / "mutetrack t" / "solotrack t" /
//         "doubleloop" / "dupblock src dst" / "exportclip" / "catchclip" / "refresh"
// ============================================================

autowatch = 0; // OFF (see puxi-engine.js): autowatch reload on Set reopen drops
               // outlets and deletes patch cords -> blank GUI. Re-add the device to
               // pick up .js edits during dev.
inlets = 1;
outlets = 1;

mgraphics.init();
mgraphics.relative_coords = 0;
mgraphics.autofill = 0;

// ---- Constants ----------------------------------------------------
var VIEW_TRACKS = 8;
var VIEW_STEPS = 8; // matches the Push 8x8 pad grid (same view in the GUI and on Push)
var NAV_W = 14;       // left gutter (note-bank arrows + pips)
var LABEL_W = 52;     // left column total (gutter + note name)
var STEP_NAV_H = 14;  // bottom strip (FOLLOW + step arrows + length ruler)
var PAD = 2;          // gap between cells

var TRACK_COLORS = [
    [0.95, 0.35, 0.35], [0.95, 0.60, 0.25], [0.95, 0.85, 0.30], [0.45, 0.85, 0.40],
    [0.30, 0.80, 0.80], [0.35, 0.55, 0.95], [0.65, 0.45, 0.95], [0.95, 0.45, 0.75]
];
var COL_BG = [0.10, 0.10, 0.11];
var COL_CELL_OFF = [0.20, 0.20, 0.22];
var COL_CELL_OFF_BEAT = [0.25, 0.25, 0.28];  // every 4th step slightly lighter
var COL_CELL_INACTIVE = [0.13, 0.13, 0.14];  // step beyond the loop length
var COL_PLAYHEAD = [0.20, 1.00, 0.40];
var COL_TEXT = [0.85, 0.85, 0.85];
var COL_NAV = [0.80, 0.80, 0.85];            // active arrow / current pip / loop
var COL_NAV_DIM = [0.32, 0.32, 0.36];        // disabled arrow / other pips
var COL_HANDLE = [0.95, 0.95, 1.00];         // loop start/end handles
var COL_SOLO = [1.00, 0.80, 0.25];           // solo "S" indicator when active (amber)

// ---- State (mirrored from the engine) -----------------------------
var grid = [];
var gridProb = [];    // per visible cell: play probability 0..100 (100 = always, no cue)
var gridGate = [];    // per visible cell: note length %, 100 = one step (>100 = tie tail)
var gridRatchet = []; // per visible cell: ratchet sub-hits 1..8 (1 = none, no cue)
var tailIn = [];      // per visible row: cells covered by a tie overflowing IN from the previous page
var labels = [];
var rowColors = [];   // per visible track: [r,g,b] 0..1 from the Drum Rack, or null
var rowMuted = [];    // per visible row: 1 = muted
var rowSoloed = [];   // per visible row: 1 = soloed
var soloActive = 0;   // 1 if a solo anywhere silences the non-soloed rows
var canX2 = 0;        // 1 if the loop can be doubled (engine "dbl") -> x2 button enabled
var dupCopied = -1;   // block index copied via the DUP button, awaiting a paste; -1 = none
var gProbG = 100;     // global probability offset (engine "gprob"): bar = own + gProbG - 100
var gGateG = 100;     // global length offset (engine "glen"): tail = own + gGateG - 100
var gVelG = 100;      // global velocity offset (engine "gvel"): brightness = own + gVelG - 100
var playPosN = [];    // per visible row: view-relative playhead col (-1 = not in view)
var noteBase = 0, noteMax = 0;
var stepBase = 0, stepMax = 0;
var rowLoopS = [], rowLoopE = []; // per visible row: loop region (absolute steps) — polyrhythm
var loopSelT = -1;                 // view-rel index of the row the ruler edits (-1 = off-view)
var selLoopS = 0, selLoopE = 8;    // selected row's loop (absolute) shown/edited on the ruler
var followOn = true;
var loopDrag = false, loopMode = "", grabOffset = 0, grabSpan = 16;
var velDrag = false, velT = 0, velS = 0, velStartY = 0, velStartX = 0, velBase = 100;
// cell drag: vertical = velocity; horizontal in the LEFT zone = probability, in the RIGHT
// zone = length. dragZone/velCellL set on press; noteRestored re-adds a note the click cleared.
var probBase = 100, gateBase = 100, dragAxis = "", dragZone = "prob", velCellL = 0, noteRestored = false;
// ratchet drag (Shift + vertical drag on a cell): up = more sub-hits.
var ratchetDrag = false, ratchetBase = 1;

function clamp(v, lo, hi) { return v < lo ? lo : (v > hi ? hi : v); }

function initState() {
    grid = [];
    gridProb = [];
    gridGate = [];
    gridRatchet = [];
    tailIn = [];
    labels = [];
    rowColors = [];
    rowMuted = [];
    rowSoloed = [];
    soloActive = 0;
    canX2 = 0;
    // NOTE: dupCopied is NOT reset here — initState() runs on every "clear" (each
    // sendFullState/nav), and the engine never re-sends it, so resetting it would wipe a
    // pending block copy whenever the view refreshes. It persists until DUP is clicked again.
    rowLoopS = [];
    rowLoopE = [];
    playPosN = [];
    loopSelT = -1; selLoopS = 0; selLoopE = VIEW_STEPS;
    for (var t = 0; t < VIEW_TRACKS; t++) {
        var row = [], prow = [], grow = [], rrow = [];
        for (var s = 0; s < VIEW_STEPS; s++) { row.push(0); prow.push(100); grow.push(100); rrow.push(1); }
        grid.push(row);
        gridProb.push(prow);
        gridGate.push(grow);
        gridRatchet.push(rrow);
        tailIn.push(0);
        labels.push("--");
        rowColors.push(null);
        rowMuted.push(0);
        rowSoloed.push(0);
        rowLoopS.push(0);
        rowLoopE.push(VIEW_STEPS);
        playPosN.push(-1);
    }
}
initState();

// ---- Geometry ------------------------------------------------------
function dims() {
    var w = this.box.rect[2] - this.box.rect[0];
    var h = this.box.rect[3] - this.box.rect[1];
    var gridH = h - STEP_NAV_H;
    return {
        w: w, h: h, gridH: gridH,
        cellW: (w - LABEL_W - PAD * VIEW_STEPS) / VIEW_STEPS,
        cellH: (gridH - PAD * VIEW_TRACKS) / VIEW_TRACKS
    };
}

// Length ruler x-extent within the bottom strip (the left end holds FOL/DUP/GET/◄, the right end ► + x2 + CLIP).
function rulerX(d) { return { x0: 96, x1: d.w - 80 }; }

// ---- Painting ------------------------------------------------------
function paint() {
    var d = dims.call(this);

    mgraphics.set_source_rgb(COL_BG[0], COL_BG[1], COL_BG[2]);
    mgraphics.rectangle(0, 0, d.w, d.h);
    mgraphics.fill();

    drawNoteNav(d);
    drawStepNav(d);

    for (var t = 0; t < VIEW_TRACKS; t++) {
        var y = PAD / 2 + (VIEW_TRACKS - 1 - t) * (d.cellH + PAD); // note 0 (lowest) at the BOTTOM
        var aud = !rowMuted[t] && (!soloActive || rowSoloed[t]);   // is this row heard?
        var rdim = aud ? 1 : 0.3;                                  // gray rows that won't play

        // "S" solo zone on the LEFT of the label column (click -> solo)
        var sc = rowSoloed[t] ? COL_SOLO : COL_NAV_DIM;
        mgraphics.set_source_rgb(sc[0], sc[1], sc[2]);
        mgraphics.select_font_face("Arial");
        mgraphics.set_font_size(9);
        mgraphics.move_to(NAV_W + 1, y + d.cellH * 0.65);
        mgraphics.show_text("S");
        // track name after it (click -> mute / select for loop), dimmed when inaudible,
        // brightened when this row is the one the loop ruler edits.
        var sel = (t === loopSelT);
        var nc = sel ? COL_NAV : COL_TEXT;
        mgraphics.set_source_rgb(nc[0] * rdim, nc[1] * rdim, nc[2] * rdim);
        mgraphics.set_font_size(11);
        mgraphics.move_to(NAV_W + 11, y + d.cellH * 0.65);
        mgraphics.show_text(labels[t]);
        if (sel) { // accent bar at the right edge of the label column
            mgraphics.set_source_rgb(COL_NAV[0], COL_NAV[1], COL_NAV[2]);
            mgraphics.rectangle(LABEL_W - 3, y + 1, 2, d.cellH - 2);
            mgraphics.fill();
        }

        for (var s = 0; s < VIEW_STEPS; s++) {
            var x = LABEL_W + PAD / 2 + s * (d.cellW + PAD);
            var abs = stepBase + s;
            var active = (abs >= rowLoopS[t] && abs < rowLoopE[t]); // inside THIS row's loop (polyrhythm)
            var vel = grid[t][s];
            if (vel > 0) {
                var c = rowColors[t] || TRACK_COLORS[t];
                var ev = clamp(vel + gVelG - 100, 1, 127); // effective velocity (own + global offset)
                var k = (0.35 + 0.65 * (ev / 127)) * rdim;
                if (!active) k *= 0.35; // lit cell outside the loop -> dimmed
                mgraphics.set_source_rgb(c[0] * k, c[1] * k, c[2] * k);
            } else {
                var off = active ? ((s % 4 === 0) ? COL_CELL_OFF_BEAT : COL_CELL_OFF)
                                 : COL_CELL_INACTIVE;
                mgraphics.set_source_rgb(off[0] * rdim, off[1] * rdim, off[2] * rdim);
            }
            mgraphics.rectangle(x, y, d.cellW, d.cellH);
            mgraphics.fill();
            // ratchet cue: a note with R sub-hits shows R-1 dark notches splitting the lit
            // cell into R equal columns (reads as a subdivided step).
            var rc = gridRatchet[t][s];
            if (vel > 0 && rc > 1) {
                mgraphics.set_source_rgb(COL_BG[0], COL_BG[1], COL_BG[2]);
                for (var rk = 1; rk < rc; rk++) {
                    mgraphics.rectangle(x + d.cellW * (rk / rc) - 0.5, y, 1, d.cellH);
                    mgraphics.fill();
                }
            }
            // probability cue: a bottom bar, filled width ∝ the EFFECTIVE prob (the cell's
            // own prob shifted by the global offset); hidden when effectively certain
            var effp = clamp(gridProb[t][s] + gProbG - 100, 0, 100);
            if (vel > 0 && effp < 100) {
                var bh = 3;
                mgraphics.set_source_rgb(COL_BG[0], COL_BG[1], COL_BG[2]); // dark track
                mgraphics.rectangle(x, y + d.cellH - bh, d.cellW, bh);
                mgraphics.fill();
                mgraphics.set_source_rgb(COL_HANDLE[0] * rdim, COL_HANDLE[1] * rdim, COL_HANDLE[2] * rdim);
                mgraphics.rectangle(x, y + d.cellH - bh, d.cellW * (effp / 100), bh);
                mgraphics.fill();
            }
        }
    }

    // Note length "tails" (thin bar at mid-row, note color): a note whose EFFECTIVE gate
    // > 100% ties into the cells on its right; plus any tie overflowing IN from the previous
    // page (tailIn) drawn from the left edge. Both clipped to the grid.
    var gridLeft = LABEL_W + PAD / 2;
    var gridRight = gridLeft + VIEW_STEPS * (d.cellW + PAD) - PAD;
    for (var lt = 0; lt < VIEW_TRACKS; lt++) {
        var laud = !rowMuted[lt] && (!soloActive || rowSoloed[lt]);
        var lk = 0.55 * (laud ? 1 : 0.3);
        var ly = PAD / 2 + (VIEW_TRACKS - 1 - lt) * (d.cellH + PAD) + d.cellH * 0.5 - 1.5;
        var lc = rowColors[lt] || TRACK_COLORS[lt];
        mgraphics.set_source_rgb(lc[0] * lk, lc[1] * lk, lc[2] * lk);
        if (tailIn[lt] > 0) { // overflow tie from the previous page
            var xin = Math.min(gridLeft + tailIn[lt] * (d.cellW + PAD) - PAD, gridRight);
            mgraphics.rectangle(gridLeft, ly, xin - gridLeft, 3);
            mgraphics.fill();
        }
        for (var ls = 0; ls < VIEW_STEPS; ls++) {
            if (grid[lt][ls] <= 0) continue;
            var effg = clamp(gridGate[lt][ls] + gGateG - 100, 5, 6400);
            if (effg <= 100) continue; // fits its own cell -> no tail
            var cellL = gridLeft + ls * (d.cellW + PAD);
            var xEnd = Math.min(cellL + (effg / 100) * (d.cellW + PAD) - PAD, gridRight);
            mgraphics.rectangle(cellL + d.cellW, ly, xEnd - (cellL + d.cellW), 3);
            mgraphics.fill();
        }
    }

    // Per-row playhead (polyrhythm): each row's own playing cell, highlighted on its row.
    for (var pt = 0; pt < VIEW_TRACKS; pt++) {
        var pc = playPosN[pt];
        if (pc < 0 || pc >= VIEW_STEPS) continue;
        var pxx = LABEL_W + PAD / 2 + pc * (d.cellW + PAD);
        var pyy = PAD / 2 + (VIEW_TRACKS - 1 - pt) * (d.cellH + PAD);
        mgraphics.set_source_rgba(COL_PLAYHEAD[0], COL_PLAYHEAD[1], COL_PLAYHEAD[2], 0.22);
        mgraphics.rectangle(pxx, pyy, d.cellW, d.cellH);
        mgraphics.fill();
        mgraphics.set_source_rgba(COL_PLAYHEAD[0], COL_PLAYHEAD[1], COL_PLAYHEAD[2], 0.95);
        mgraphics.rectangle(pxx, pyy, 2, d.cellH); // left edge marker
        mgraphics.fill();
    }
}

// Left gutter: ▲ higher notes / ▼ lower notes + bank pips.
function drawNoteNav(d) {
    var cx = NAV_W / 2;
    mgraphics.set_source_rgb(COL_CELL_OFF[0], COL_CELL_OFF[1], COL_CELL_OFF[2]);
    mgraphics.rectangle(0, 0, NAV_W, d.gridH);
    mgraphics.fill();

    // Notes run low->high bottom->top, so the banks count down from the top: the
    // lowest 8 (C1..) are the BOTTOM bank / bottom pip; ▲ reveals higher notes.
    var pcount = Math.round(noteMax / VIEW_TRACKS) + 1;
    triV(cx, 9, 5, true, noteBase < noteMax);            // ▲ -> higher notes
    triV(cx, d.gridH - 9, 5, false, noteBase > 0);       // ▼ -> lower notes
    pips(cx, d.gridH / 2, pcount, (pcount - 1) - Math.round(noteBase / VIEW_TRACKS));
}

// Bottom strip: FOLLOW toggle, ◄/► step-block view nav, and the length ruler.
function drawStepNav(d) {
    var y0 = d.gridH, cy = y0 + STEP_NAV_H / 2;
    mgraphics.set_source_rgb(COL_CELL_OFF[0], COL_CELL_OFF[1], COL_CELL_OFF[2]);
    mgraphics.rectangle(0, y0, d.w, STEP_NAV_H);
    mgraphics.fill();

    // FOLLOW indicator: lit square + label
    var fc = followOn ? COL_PLAYHEAD : COL_NAV_DIM;
    mgraphics.set_source_rgb(fc[0], fc[1], fc[2]);
    mgraphics.rectangle(4, cy - 3.5, 7, 7);
    mgraphics.fill();
    mgraphics.set_source_rgb(COL_TEXT[0], COL_TEXT[1], COL_TEXT[2]);
    mgraphics.select_font_face("Arial");
    mgraphics.set_font_size(8);
    mgraphics.move_to(13, cy + 3);
    mgraphics.show_text("FOL");

    // "DUP" block copy/paste: 1st click copies the current block (button lit), 2nd click
    // (after navigating to another block) pastes it there.
    mgraphics.set_source_rgb(COL_CELL_OFF_BEAT[0], COL_CELL_OFF_BEAT[1], COL_CELL_OFF_BEAT[2]);
    mgraphics.rectangle(32, cy - 5, 22, 10);
    mgraphics.fill();
    var dpc = (dupCopied >= 0) ? COL_PLAYHEAD : COL_NAV_DIM;
    mgraphics.set_source_rgb(dpc[0], dpc[1], dpc[2]);
    mgraphics.set_font_size(7);
    mgraphics.move_to(36, cy + 2.5);
    mgraphics.show_text("DUP");

    // "GET" button: pull the selected (or currently edited) MIDI clip into the pattern (inverse of CLIP).
    mgraphics.set_source_rgb(COL_CELL_OFF_BEAT[0], COL_CELL_OFF_BEAT[1], COL_CELL_OFF_BEAT[2]);
    mgraphics.rectangle(56, cy - 5, 22, 10);
    mgraphics.fill();
    mgraphics.set_source_rgb(COL_NAV[0], COL_NAV[1], COL_NAV[2]);
    mgraphics.set_font_size(7);
    mgraphics.move_to(60, cy + 2.5);
    mgraphics.show_text("GET");

    triH(86, cy, 4, false, stepBase > 0);            // ◄ previous block
    triH(d.w - 72, cy, 4, true, stepBase < stepMax); // ► next block (left of the x2/CLIP buttons)

    drawRuler(d, cy);

    // "x2" double-loop button: extend the loop to 2x + copy its notes. Bright when available
    // (the engine says so via "dbl"), dimmed otherwise.
    var dx = d.w - 62;
    mgraphics.set_source_rgb(COL_CELL_OFF_BEAT[0], COL_CELL_OFF_BEAT[1], COL_CELL_OFF_BEAT[2]);
    mgraphics.rectangle(dx, cy - 5, 24, 10);
    mgraphics.fill();
    var dc = canX2 ? COL_NAV : COL_NAV_DIM;
    mgraphics.set_source_rgb(dc[0], dc[1], dc[2]);
    mgraphics.select_font_face("Arial");
    mgraphics.set_font_size(7);
    mgraphics.move_to(dx + 8, cy + 2.5);
    mgraphics.show_text("x2");

    // "CLIP" button at the FAR RIGHT: bake the pattern to a MIDI clip
    var bx = d.w - 32;
    mgraphics.set_source_rgb(COL_CELL_OFF_BEAT[0], COL_CELL_OFF_BEAT[1], COL_CELL_OFF_BEAT[2]);
    mgraphics.rectangle(bx, cy - 5, 28, 10);
    mgraphics.fill();
    mgraphics.set_source_rgb(COL_NAV[0], COL_NAV[1], COL_NAV[2]);
    mgraphics.set_font_size(7);
    mgraphics.move_to(bx + 5, cy + 2.5);
    mgraphics.show_text("CLIP");
}

// Length ruler spanning the whole pattern: dim full track, bright active loop,
// block ticks, and an outline marking the steps currently shown in the grid.
function drawRuler(d, cy) {
    var r = rulerX(d), w = r.x1 - r.x0;
    var total = stepMax + VIEW_STEPS;
    var seg = w / total;

    mgraphics.set_source_rgb(COL_NAV_DIM[0], COL_NAV_DIM[1], COL_NAV_DIM[2]);
    mgraphics.rectangle(r.x0, cy - 3, w, 6);
    mgraphics.fill();

    mgraphics.set_source_rgb(COL_NAV[0], COL_NAV[1], COL_NAV[2]);
    mgraphics.rectangle(r.x0 + selLoopS * seg, cy - 3, (selLoopE - selLoopS) * seg, 6);
    mgraphics.fill();

    mgraphics.set_source_rgb(COL_BG[0], COL_BG[1], COL_BG[2]);
    for (var i = VIEW_STEPS; i < total; i += VIEW_STEPS) { // block boundaries
        mgraphics.rectangle(r.x0 + i * seg, cy - 4, 1, 8);
        mgraphics.fill();
    }

    mgraphics.set_source_rgba(COL_TEXT[0], COL_TEXT[1], COL_TEXT[2], 0.7);
    mgraphics.set_line_width(1);
    mgraphics.rectangle(r.x0 + stepBase * seg, cy - 4, VIEW_STEPS * seg, 8);
    mgraphics.stroke();

    // start / end handles (grabbable) — for the selected row's loop
    mgraphics.set_source_rgb(COL_HANDLE[0], COL_HANDLE[1], COL_HANDLE[2]);
    mgraphics.rectangle(r.x0 + selLoopS * seg - 1.5, cy - 5, 3, 10);
    mgraphics.fill();
    mgraphics.rectangle(r.x0 + selLoopE * seg - 1.5, cy - 5, 3, 10);
    mgraphics.fill();
}

// Vertical (▲/▼) triangle.
function triV(cx, cy, half, up, enabled) {
    var c = enabled ? COL_NAV : COL_NAV_DIM;
    mgraphics.set_source_rgb(c[0], c[1], c[2]);
    if (up) {
        mgraphics.move_to(cx, cy - half);
        mgraphics.line_to(cx - half, cy + half);
        mgraphics.line_to(cx + half, cy + half);
    } else {
        mgraphics.move_to(cx, cy + half);
        mgraphics.line_to(cx - half, cy - half);
        mgraphics.line_to(cx + half, cy - half);
    }
    mgraphics.close_path();
    mgraphics.fill();
}

// Horizontal (◄/►) triangle.
function triH(cx, cy, half, right, enabled) {
    var c = enabled ? COL_NAV : COL_NAV_DIM;
    mgraphics.set_source_rgb(c[0], c[1], c[2]);
    if (right) {
        mgraphics.move_to(cx - half, cy - half);
        mgraphics.line_to(cx - half, cy + half);
        mgraphics.line_to(cx + half, cy);
    } else {
        mgraphics.move_to(cx + half, cy - half);
        mgraphics.line_to(cx + half, cy + half);
        mgraphics.line_to(cx - half, cy);
    }
    mgraphics.close_path();
    mgraphics.fill();
}

// Vertical column of position pips, current one lit (used by the note gutter).
function pips(cx, cy, count, cur) {
    var gap = 6, span = (count - 1) * gap;
    for (var i = 0; i < count; i++) {
        var on = (i === cur);
        var c = on ? COL_NAV : COL_NAV_DIM, sz = on ? 4 : 2;
        mgraphics.set_source_rgb(c[0], c[1], c[2]);
        mgraphics.rectangle(cx - sz / 2, cy - span / 2 + i * gap - sz / 2, sz, sz);
        mgraphics.fill();
    }
}

// ---- Mouse ----------------------------------------------------------
function onclick(x, y, but, cmd, shift) {
    var d = dims.call(this);
    loopDrag = false;
    velDrag = false;
    ratchetDrag = false;

    if (y >= d.gridH) { // bottom strip
        if (x < 30) { outlet(0, "follow"); return; }                  // FOLLOW
        if (x < 56) { dupClick(); return; }                           // DUP (copy/paste block)
        if (x < 78) { outlet(0, "catchclip"); return; }               // GET (import a MIDI clip)
        if (x < 94) { outlet(0, "nav", "steps", -1); return; }        // ◄
        if (x >= d.w - 34) { outlet(0, "exportclip"); return; }       // CLIP (far right)
        if (x >= d.w - 64) { if (canX2) outlet(0, "doubleloop"); return; } // x2 (only if available)
        if (x >= d.w - 80) { outlet(0, "nav", "steps", 1); return; }  // ►
        var r = rulerX(d);
        if (x >= r.x0 && x <= r.x1) beginLoopDrag(x, r);              // ruler: grab handle / body
        return;
    }
    if (x < NAV_W) { // note-bank gutter: top half -> higher notes, bottom half -> lower
        outlet(0, "nav", "notes", (y < d.gridH / 2) ? 1 : -1);
        return;
    }
    if (x < LABEL_W) { // label column: "S" zone (left) -> solo, the name -> mute
        var tl = VIEW_TRACKS - 1 - Math.floor(y / (d.cellH + PAD)); // screen bottom = note 0
        if (tl < 0 || tl >= VIEW_TRACKS) return;
        if (x < NAV_W + 10) outlet(0, "solotrack", tl); // "S" zone on the left
        else outlet(0, "mutetrack", tl);                 // name -> mute
        return;
    }

    var s = Math.floor((x - LABEL_W) / (d.cellW + PAD));
    var t = VIEW_TRACKS - 1 - Math.floor(y / (d.cellH + PAD)); // screen bottom = note 0 (lowest)
    if (t < 0 || t >= VIEW_TRACKS || s < 0 || s >= VIEW_STEPS) return;
    // Shift + vertical drag = ratchet (1..8, up = more sub-hits). No toggle: an existing note
    // keeps its state; an empty cell gets a note on first drag. (Push: hold Repeat + pad.)
    if (shift) {
        ratchetDrag = true; velT = t; velS = s; velStartY = y;
        ratchetBase = (grid[t][s] > 0) ? gridRatchet[t][s] : 1;
        velBase = (grid[t][s] > 0) ? grid[t][s] : 100;
        noteRestored = (grid[t][s] > 0); // existing note: nothing to restore
        return;
    }
    // Tap toggles. Drag = edit (axis-locked on first move): vertical = velocity; horizontal
    // = probability (LEFT zone of the cell) or length (RIGHT zone). A fresh note starts at
    // prob 100 / length 100 (engine resets on entry); an existing note keeps its values.
    var cellL = LABEL_W + PAD / 2 + s * (d.cellW + PAD);
    velDrag = true; velT = t; velS = s; velStartY = y; velStartX = x; velCellL = cellL;
    dragZone = (x > cellL + d.cellW * 0.68) ? "len" : "prob";
    velBase = (grid[t][s] > 0) ? grid[t][s] : 100;
    probBase = (grid[t][s] > 0) ? gridProb[t][s] : 100;
    gateBase = (grid[t][s] > 0) ? gridGate[t][s] : 100;
    dragAxis = ""; noteRestored = false;
    outlet(0, "toggle", t, s);
}
onclick.local = 1;

function ondrag(x, y, but) {
    if (loopDrag) {
        if (but === 0) { loopDrag = false; return; } // released
        var r = rulerX(dims.call(this));
        applyLoopDrag(clamp(x, r.x0, r.x1), r);
        return;
    }
    if (ratchetDrag) {
        if (but === 0) { ratchetDrag = false; return; } // released
        if (!noteRestored) { outlet(0, "setvel", velT, velS, velBase); noteRestored = true; } // create if empty
        var R = clamp(ratchetBase + Math.round((velStartY - y) / 12), 1, 8);
        outlet(0, "setratchet", velT, velS, R); // up = more sub-hits
        return;
    }
    if (velDrag) {
        if (but === 0) { velDrag = false; return; } // released
        var dx = x - velStartX, dy = velStartY - y;
        if (dragAxis === "") { // lock to the dominant axis once there's real movement
            if (Math.abs(dx) > 4 || Math.abs(dy) > 4) dragAxis = (Math.abs(dx) > Math.abs(dy)) ? "horiz" : "vel";
            else return;
        }
        if (dragAxis === "vel") {
            var vel = clamp(velBase + Math.round(dy * 1.5), 1, 127);
            outlet(0, "setvel", velT, velS, vel); // up = louder; brightness follows
            return;
        }
        // horizontal: the click toggled the note off if it existed — restore it once first
        if (!noteRestored) { outlet(0, "setvel", velT, velS, velBase); noteRestored = true; }
        if (dragZone === "len") { // length = how far right the cursor is, in cell-widths
            var seg = dims.call(this).cellW + PAD;
            var g = clamp(Math.round((x - velCellL) / seg * 100), 5, 6400);
            outlet(0, "setgate", velT, velS, g); // right = longer (>100% = tie; window limits the drag)
        } else {
            var p = clamp(probBase + Math.round(dx * 1.5), 0, 100);
            outlet(0, "setprob", velT, velS, p); // right = more likely
        }
    }
}
ondrag.local = 1;

// Decide what the ruler press grabbed: the start handle, the end handle, or the
// band body (drag to move the whole region). Handles win within a few px.
function beginLoopDrag(x, r) {
    var total = stepMax + VIEW_STEPS, seg = (r.x1 - r.x0) / total, TOL = 6;
    var startX = r.x0 + selLoopS * seg, endX = r.x0 + selLoopE * seg;
    loopDrag = true;
    if (Math.abs(x - startX) <= TOL) loopMode = "start";
    else if (Math.abs(x - endX) <= TOL) loopMode = "end";
    else if (x > startX && x < endX) loopMode = "move";
    else loopMode = (x < startX) ? "start" : "end";
    grabSpan = selLoopE - selLoopS;
    grabOffset = boundaryAtX(x, r) - selLoopS;
    applyLoopDrag(x, r);
}

function applyLoopDrag(x, r) {
    var total = stepMax + VIEW_STEPS, b = boundaryAtX(x, r), ns, ne;
    if (loopMode === "start") { ns = clamp(b, 0, selLoopE - 1); ne = selLoopE; }
    else if (loopMode === "end") { ns = selLoopS; ne = clamp(b, selLoopS + 1, total); }
    else { ns = clamp(b - grabOffset, 0, total - grabSpan); ne = ns + grabSpan; }
    outlet(0, "setloop", ns, ne); // engine applies to the selected note (loopSelN)
}

// Step boundary (0..total) nearest x on the ruler.
function boundaryAtX(x, r) {
    var total = stepMax + VIEW_STEPS;
    return clamp(Math.round((x - r.x0) / (r.x1 - r.x0) * total), 0, total);
}

// DUP button: 1st click copies the current block (lit); after navigating to another block,
// 2nd click pastes the copy there ("dupblock src dst"). Same block again = cancel.
function dupClick() {
    var cur = Math.floor(stepBase / VIEW_STEPS);
    if (dupCopied < 0) {
        dupCopied = cur;                                          // copy this block
    } else {
        if (cur !== dupCopied) outlet(0, "dupblock", dupCopied, cur); // paste here
        dupCopied = -1;
    }
    mgraphics.redraw();
}

// ---- Messages from the engine ---------------------------------------
function cell(t, s, v) {
    if (t < 0 || t >= VIEW_TRACKS || s < 0 || s >= VIEW_STEPS) return;
    grid[t][s] = v;
    mgraphics.redraw();
}

// Per-cell play probability (0..100). 100 = no cue.
function cprob(t, s, p) {
    if (t < 0 || t >= VIEW_TRACKS || s < 0 || s >= VIEW_STEPS) return;
    gridProb[t][s] = p;
    mgraphics.redraw();
}

// Global probability offset (Prob encoder with no pad held). Every bar is recomputed.
function gprob(v) {
    gProbG = v;
    mgraphics.redraw();
}

// Global velocity offset (Vel encoder with no pad held). Cell brightness is recomputed.
function gvel(v) {
    gVelG = v;
    mgraphics.redraw();
}

// Per-cell note length % and the global length offset; together they drive the tail rendering.
function clen(t, s, g) {
    if (t < 0 || t >= VIEW_TRACKS || s < 0 || s >= VIEW_STEPS) return;
    gridGate[t][s] = g;
    mgraphics.redraw();
}
function glen(v) {
    gGateG = v;
    mgraphics.redraw();
}

// Per-cell ratchet count (1..8). 1 = no cue; >1 draws subdivision notches.
function cratchet(t, s, r) {
    if (t < 0 || t >= VIEW_TRACKS || s < 0 || s >= VIEW_STEPS) return;
    gridRatchet[t][s] = r;
    mgraphics.redraw();
}

// Per-row: how many leading view cells are covered by a tie overflowing from the previous
// page (a note whose length crosses the page boundary). Drives the incoming tail.
function tailin(t, extent) {
    if (t < 0 || t >= VIEW_TRACKS) return;
    tailIn[t] = extent;
    mgraphics.redraw();
}

// Per-row playhead (polyrhythm): one view-relative col per visible row (-1 = not shown).
function playheads() {
    for (var t = 0; t < VIEW_TRACKS; t++) playPosN[t] = arguments[t];
    mgraphics.redraw();
}

function label(t) {
    if (t < 0 || t >= VIEW_TRACKS) return;
    // name may arrive as several atoms when it contains spaces ("DS Kick") — rejoin.
    labels[t] = Array.prototype.slice.call(arguments, 1).join(" ");
    mgraphics.redraw();
}

// Per-track cell color from the Drum Rack chain (r,g,b 0..255); r<0 -> default palette.
function color(t, r, g, b) {
    if (t < 0 || t >= VIEW_TRACKS) return;
    rowColors[t] = (r < 0) ? null : [r / 255, g / 255, b / 255];
    mgraphics.redraw();
}

// Per-row mute/solo state. soloActive (global) = 1 if a solo anywhere silences the
// non-soloed rows. m/s are 0/1 for this visible row.
function musolo(t, m, s, sa) {
    if (t < 0 || t >= VIEW_TRACKS) return;
    rowMuted[t] = m;
    rowSoloed[t] = s;
    soloActive = sa;
    mgraphics.redraw();
}

function view(nb, nmax, sb, smax, fol) {
    noteBase = nb; noteMax = nmax;
    stepBase = sb; stepMax = smax;
    followOn = (fol !== 0);
    mgraphics.redraw();
}

// Per-row loop region (absolute steps) — drives the per-row gray-out (polyrhythm).
function loop(t, ls, le) {
    if (t < 0 || t >= VIEW_TRACKS) return;
    rowLoopS[t] = ls; rowLoopE[t] = le;
    mgraphics.redraw();
}

// The row the ruler edits: t = view-rel index (-1 if off-view), ls/le = its loop (absolute).
function loopsel(t, ls, le) {
    loopSelT = t; selLoopS = ls; selLoopE = le;
    mgraphics.redraw();
}

// Whether the loop can be doubled right now (engine) -> enables/grays the x2 button.
function dbl(v) {
    canX2 = v;
    mgraphics.redraw();
}

function clear() {
    initState();
    mgraphics.redraw();
}

// ---- Init handshake -------------------------------------------------
// The engine pushes the full pattern from its init() (driven by
// live.thisdevice). If this v8ui's script finishes loading after that push —
// common when a saved .amxd is reloaded, since instantiation order differs from
// the Max editor — the push is lost and the grid stays blank. So we ask the
// engine to (re)send state once WE are ready. Plain outlet messaging is fine
// here; only LiveAPI must wait for live.thisdevice, and we touch no LiveAPI.
function requestState() {
    outlet(0, "refresh");
}

// Fires once the device patcher has finished loading: every object (incl. the
// engine) exists and the patch cords are connected, so the engine can answer.
function loadbang() {
    requestState();
}

// autowatch hot-reloads this file on save during development but does NOT
// re-fire loadbang(). Re-request a beat after (re)load so the grid repopulates
// without reloading the whole device. Deferred so the outlet is wired; guarded
// so a missing Task API can never break the GUI.
try {
    var bootRefreshN = 0;
    var bootRefresh = new Task(function () {
        requestState();
        bootRefreshN++;
        if (bootRefreshN < 4) bootRefresh.schedule(300); // retry: catch a late-loading engine
    }, this);
    bootRefresh.schedule(120);
} catch (e) {}
