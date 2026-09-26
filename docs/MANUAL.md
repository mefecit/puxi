# Puxi User Manual

Puxi is an eight-track drum step sequencer for Ableton Live 12. You can play it
with the mouse in Live and from Push 3. It takes its cue from the OXI One's
multi-track view: all of your drum tracks are visible at once, laid out as a grid.

Puxi is a Max for Live MIDI effect. It generates MIDI notes and sends them to the
next device in the chain — typically a Drum Rack.


## 1. Setting Up

1. Drop **Puxi** onto a **MIDI track**.
2. On the **same track, after Puxi**, add a **Drum Rack** (or any other
   instrument). Puxi sends its notes to whatever follows it in the chain.
3. Start playback in Live. Puxi locks to the transport and plays its pattern.

Puxi's tracks map to MIDI notes starting at **C1** — the bottom-left pad of a
standard Drum Rack — and rise in pitch from there.


## 2. The Grid (in Live)

- **Rows are tracks** (one drum voice each). **Columns are steps** (16th notes).
  The layout follows a **piano-roll orientation**: the lowest note (C1) is the
  **bottom** row, higher notes rise toward the top.
- When a Drum Rack follows Puxi, each row takes the **name** and **color** of the
  matching pad (for example, "Kick" in red). Without a Drum Rack, the row falls
  back to its note name (C1, C#1, and so on) and a default color.
- You see an **8 × 8 window** (8 tracks by 8 steps) onto a larger pattern: **64
  steps** in total (eight blocks of eight) across several **note banks**. Use the
  navigation controls to reach the rest (see Chapter 4).
- The step at the start of each beat is drawn slightly brighter, as a visual guide.
- Steps outside the loop region are dimmed. They are not played, but remain
  editable (see Chapter 5).

### Editing steps

- **Click** a cell to turn the step on or off.
- **Click and drag up or down** on a cell to set its **velocity** (up is louder).
  The brightness of the cell reflects the velocity.
- **Click and drag left or right** in the left part of a cell to set its
  **probability** (right is more likely). A thin bar along the bottom of the cell
  shows the probability (its width follows the value; there is no bar at 100%).
- **Click and drag left or right in the right third** of a cell to set its
  **length**. Above 100% the note becomes a tie that spills over into the following
  steps, shown as a trailing bar (see Note Length below).

### Velocity

Every step carries a velocity from 1 to 127. In Live, set it by dragging a cell
vertically; the cell's brightness follows. On Push, either hit the pad harder or
hold the pad and turn the **Vel** encoder.

The **Vel** encoder with no pad held sets a **global velocity offset** that raises
or lowers all notes at once. The offset is non-destructive (neutral at the center position) and
is reflected in the sound, in the pad and grid brightness, and in exported clips.

### Probability

Each note has a **chance of playing**, from 0% to 100%. At 100% it always plays,
at 0% it never plays, and at 50% it plays about half the time, chosen at random —
not strictly every other time, but averaging out to half over many repeats.

- **In Live:** drag a cell horizontally (see Editing steps). The bottom bar
  reflects the value.
- **On Push:** hold a pad, then turn the **Prob** encoder (the fifth, shown on the
  display) to set that note's probability, and release. A quick tap toggles the
  step; holding it is what enters probability mode.
- **One row at once (Push):** hold the row's **scene button**, then turn the **Prob**
  encoder. It sets every note of that row to the same probability. While the scene is
  held, the display shows the value most of the row's notes share.
- A note that is (re)entered always starts at **100%**: if you remove a
  probabilistic note and add it back, it is back to 100%. Probability belongs to
  the note, not to the cell.
- **Global probability (Push):** turning the **Prob** encoder with **no pad held**
  lowers or raises the probability of **all notes at once** as a non-destructive offset.
  A note at 50% drops to 40% when the global value falls to 90%, and returns to 50% when you
  bring it back to 100 — the per-note values are preserved. At 0, nothing plays. The
  bars and the pad shimmer always show the probability actually in effect (note plus
  global). The global value is saved with the Set.
- **DUP** (duplicate a block) and **x2** (double the loop) copy probability along
  with the notes.

Note: on the pads, a probabilistic note shimmers (see Chapter 6). The shimmer
updates live as you turn the encoder.

### Note Length (gate and ties)

Each note has a **length** as a percentage of one step. **100%** fills one step
(the default), less is staccato, and more than 100% is a **tie** that spills over into
the following steps — up to **6400% (64 steps)**. A tie can continue onto the next
page and around the loop.

- **In Live:** drag horizontally in the **right third** of a cell (the left part
  sets probability). A trailing bar extends to the right to show the tie; if it
  reaches the edge of the window, it resumes from the left on the next page. The
  drag is limited to the window width (about eight steps); use the Push encoder for
  longer ties.
- **On Push:** hold a pad, then turn the **Length** encoder (the sixth). The Prob
  and Length encoders are shown together while you hold a pad.
- **Global length (Push):** turning the **Length** encoder with no pad held
  shortens or lengthens all notes at once, as a non-destructive offset, like global
  probability. Saved with the Set.
- **DUP** and **x2** copy length along with the notes.

Note: if the **same note** on the same track retriggers before a tie ends, the tie
is cut at the new hit (standard MIDI behavior).

### Ratcheting

A note can be **repeated several times within one step** — from 2 to 8 evenly
spaced sub-hits (a roll within the step). Length still shapes each sub-hit.

- **On Push:** hold the **Repeat** button. The eight scene buttons become a
  division selector — a bar lit from the bottom, where the bottom means one hit and
  higher means more. Tap a scene to choose the division. Still holding Repeat, tap a
  pad to give that note the ratchet (the note is created if the cell was empty).
  Release Repeat to return the buttons to their native function.
- **In Live:** hold **Shift** and drag vertically on a cell (up for more hits). A
  ratcheted note shows notches that subdivide it. (If your setup does not pass the
  Shift key through to the device, use Push.)
- A note that is (re)entered starts with no ratchet. **DUP** and **x2** copy the
  ratchet along with the notes.

### Muting and Soloing tracks

- **Click the track name** to **mute** it (the row dims and stops playing). Click
  again to unmute.
- **Click the "S"** to the left of the name to **solo**. Solo is exclusive: only one
  track is soloed at a time (click another "S" to move the solo, click the same one
  to clear it). While a solo is active, the other tracks are dimmed.
- The "S" turns amber when the track is soloed.

Mute and solo are saved with the Set and can be undone.


## 3. Playback

- Puxi follows Live's **transport** and plays in time with the tempo.
- A green playhead marks the current step.
- Puxi loops its **own region** — the part of the pattern between the loop handles —
  independently of any clip. It follows Live's clock, not a clip length. The default
  loop is eight steps (one block).

### Groove and Swing

Puxi follows two of Live's global settings and applies them as **swing**: the
**Groove Amount** (the master control at the bottom of the Groove Pool) and the
**Swing Amount** (from Live's quantization settings). The more you raise either one,
the more Puxi swings — the offbeat 16th notes are delayed. The two amounts add up
(up to a maximum); with both at zero, playback is perfectly straight. Puxi follows
them live.

Note: Puxi follows the **amount**, not the exact shape of a groove. Live's API does
not expose the step-by-step shape of a groove, and grooves only apply to clips, not
to a device's live output. So this is a swing that tracks the intensity, not a clone
of a specific groove. The grid and playhead stay straight on screen; the swing is a
timing shift of the sound, like a Live groove. An exported clip (>CLIP) prints the
same swing.


## 4. Navigating the Pattern

The pattern is larger than the 8 × 8 window. There are two axes of navigation.

- **Note banks (vertical)** — the left gutter, arrows ▲ / ▼. Piano-roll
  orientation: lower notes are at the bottom.
  - ▲ moves to higher notes; ▼ moves to lower notes.
  - The pips on the left show your position (the bottom pip is the bank holding the
    lowest notes, starting at C1).
- **Step blocks (horizontal)** — the bottom strip, arrows ◄ / ►.
  - ► moves to the next block; ◄ to the previous block.


## 5. Loop and Follow (bottom strip)

- **Global loop region:** the long bar along the bottom represents the whole
  pattern (64 steps). The bright area is the loop. Drag the **left handle** (start)
  or **right handle** (end), or the **body** of the bar to move the whole region.
  Only steps inside the loop are played; the rest are dimmed but remain editable.
  The ruler acts on the **global loop**: every track that follows it changes
  together.
- **FOLLOW** (at the left of the strip): when enabled, the view automatically
  follows the playhead, jumping to the block being played. Turn it off (or navigate
  manually) to edit another block while playback continues.

### Polyrhythm — per-track loop lengths

Each track can have its **own loop length**, independent of the others: a track of
eight steps and a track of six steps drift against each other. Each track then has
its own playhead, and its steps outside its own loop are dimmed.

Set a per-track loop **on Push** (see Chapter 6): hold the track's **scene button**
and turn **Loop Start / End**. The track becomes custom (frozen): changing the
global loop no longer moves it. To make it follow the global loop again, bring its
loop back to exactly the global value.

Everything is saved with the Set (the global loop plus the custom tracks).

### Double the loop (x2)

The **x2** button (in the bottom strip, between ► and CLIP; **Double Loop** on
Push) **doubles the global loop**: the loop grows to twice its length (the start
stays put) and the notes in the loop are copied into the new half, so the pattern
repeats at double length.

It is available (the button is lit) only when there are notes in the loop, the
doubled length still fits within 64 steps (eight blocks), and the region just after
the loop is empty. Otherwise the button is dimmed.


## 6. Using Puxi with Push 3

Puxi takes over Push only while it is the **selected** (blue-hand) device. Select
the Puxi device to control it; select another device to return the controls to Live.

You can turn on or connect Push **after** loading the Set. Puxi detects it and takes
over the pads automatically — no need to reload the device.

### Pads (8 × 8)

- Tap a pad to turn the step on or off.
- The layout is piano-roll: the lowest note is at the bottom.
- How hard you hit the pad sets the step's velocity.
- The LEDs mirror the grid: an active step takes its instrument's color (the Drum
  Rack chain color, matched to the nearest Push color), off-loop steps are dimmed,
  and the playhead is the column sweeping across.
  - **Color:** because the exact Push palette cannot be read back, the pad color is
    the nearest hue (red, orange, yellow, green, blue, purple, or pink) — so two very
    close shades of one hue can look the same. The Live grid shows the exact color.
  - **Velocity to brightness:** the pad brightness reflects velocity in three levels
    (low, medium, high — at 1–42, 43–84, 85–127), within the instrument's hue. The
    Live grid shows a continuous gradient instead.
  - **Probability to shimmer:** a probabilistic note (below 100%) shimmers between
    its velocity level and the level just below — never brighter than its velocity.
    High velocity flickers high/medium, medium flickers medium/low, low flickers
    low/off. The lower the probability, the more the pad rests on the lower level
    (down to off for a faint note); at 100% it is stable at its velocity level. At a
    glance: stable means certain, shimmering means random.
  - **Length to tail:** a tie (over 100%) dimly lights the pads it covers to its
    right, up to the end of the tie — including onto the next page if it spills over.
  - **Ratchet to strobe:** a ratcheted note flashes as many times as its ratchet
    (2 to 8) on every step, so you spot it before it plays. The rhythm shows the
    number of repeats, and if the note is probabilistic the flashes shimmer too.

### Navigation buttons (Octave / Page)

- **Octave + / −** move through note banks (+ is higher, − is lower — matching the
  grid's piano-roll orientation).
- **Page > / < Page** move through step blocks (next / previous).
- A button is bright when navigation is still possible in that direction and dim at
  an edge (the start or end of the pattern, or the first or last bank) — just like
  the grayed triangles in the Live grid.
- The Up/Down/Left/Right arrows keep their native Push function.

### Encoders (shown on the Push display)

Order: **Follow · Loop Start · Loop End · Vel · Prob · Length · Lock 1 · Lock 2**.
(Paging is done with the < Page / Page > buttons; there is no "Block" encoder.)

- **Encoder 1 — Follow:** turn to enable or disable playhead follow (the display
  shows ON / off).
- **Encoder 2 — Loop Start:** turn to move the loop's start.
- **Encoder 3 — Loop End:** turn to move the loop's end.
  - **Target — global or one track (polyrhythm):** with nothing held, the encoders
    set the global loop (all tracks that follow it). Hold a track's **scene button**
    (to the right of the pads) and the encoders set that track only (it becomes
    custom, frozen relative to the global loop); release to return to the global
    loop. Bringing a custom track back to the global value makes it follow the global
    loop again. The display shows the loop of the current target.
  - **Detents on the loop bounds:** the Loop Start and End encoders catch firmly on
    the block boundaries (every eight steps), like Live's pan snapping to center. It
    takes noticeably more turning to leave a detent, so you land easily on multiples
    of eight while keeping single-step control elsewhere. Start detents: 1, 9, 17, 25,
    33, 41, 49, 57. End detents: 8, 16, 24, 32, 40, 48, 56, 64.
  - On a detent, the displayed value freezes on the boundary while you push past it,
    then jumps — that is the visual sign you are on a block boundary.
- **Momentary follow:** touch or hold Encoder 1 without turning it, and follow turns
  on for as long as you hold, then off on release. Handy for glancing at the
  playhead without changing your setting.
- **Encoder 4 — Vel:** with a pad held, sets that note's velocity (the brightness
  follows); with no pad held, sets the global velocity — an offset that raises or
  lowers all notes (non-destructive, neutral at the center), reflected in the sound, the
  pad and grid brightness, and exported clips.
- **Encoder 5 — Prob:** with a pad held, sets that note's probability; with a scene
  button held, sets the probability of every note in that row; with nothing held, sets
  the global probability (all notes, non-destructive offset — see Chapter 2).
- **Encoder 6 — Length:** with a pad held, sets that note's length (up to 6400% = 64
  steps, even across pages); with no pad held, sets the global length (all notes,
  non-destructive offset).
- **Encoders 7 and 8 — Lock 1 / Lock 2:** parameter locks, described below.

### Screen-row buttons (indicators)

- The **Follow** button (above the display, on the left) lights to show the Follow
  state, and the row below the display shows the current block in green; both serve as
  indicators.
- They keep their native behavior when pressed, however: Puxi drives only their LEDs, not their
  function. So Follow is set with Encoder 1 (turn, or touch for momentary) and the
  Live grid; the block is set with the < Page / Page > buttons.
- (This is because Max for Live cannot tell when Push leaves the device view for its
  Settings or browser. Because Puxi does not take over their presses, these buttons keep working natively
  in those modes.)

### Accent button

- A short press **latches** it: while lit, every step entered from a pad is at
  maximum velocity (like the accent of a Live MIDI clip). Press again to turn it off.
- Holding it is **momentary**: entered steps are at maximum velocity only while held.
- With Accent active, **tapping a pad on a note that already exists** raises its
  velocity to 127 (instead of turning it off); its probability, length, ratchet, and
  locks are kept. Tapping an empty cell enters the note at 127, as usual.
- With Accent inactive, the pad's hit strength is used.
- The button is fully lit when Accent is active and faintly lit (not off) when inactive,
  so you can spot it at a glance.

### Convert button (export to a MIDI clip)

- The **Convert** button bakes your pattern into a MIDI clip — exactly like the
  >CLIP button in Live. Handy for committing a beat without touching the computer.
- The button is off while the sequencer is empty, and lit as soon as there is at
  least one note.

### Double Loop button

- The **Double Loop** button doubles the global loop and copies its notes — like x2
  in Live (see Chapter 5). The loop doubles in length; the start stays fixed.
- Lit only when doubling is possible (there are notes in the loop, the result fits within eight
  blocks, and the region after it is empty); off otherwise.

### Mute / Solo (Mute/Solo buttons + scene)

- Hold the **Mute** (or **Solo**) button and tap a **scene button** (the column to
  the right of the pads, aligned with the row) to mute (or exclusively solo) that
  track. The scenes follow the piano-roll orientation: the bottom scene is the
  lowest note.
- While Mute or Solo is held, all scene buttons light up ("pick a row").
- Otherwise a scene's LED shows whether the row will play: lit if yes, off if the
  row is muted or silenced by a solo elsewhere. With a solo active, only the soloed
  row stays lit.
- The pads of a track that will not play turn gray, mirroring the dimming in the Live
  grid.
- Solo is exclusive (one track at a time) and, as in Live, is saved with the Set and
  can be undone.

### Repeat button (ratcheting)

- Hold the **Repeat** button. The eight scene buttons become a division selector — a
  bar lit from the bottom (bottom means one hit, higher means more). Tap a scene to
  choose how many times the note repeats within the step (2 to 8).
- Still holding Repeat, tap a pad to give the note that ratchet (created if the cell
  was empty). Release Repeat to return the buttons to their native function.
- The Repeat button is fully lit while held and dim otherwise. (See Chapter 2 for details
  and for editing in Live.)

### Delete button

- Hold the **Delete** button, then:
  - tap a **scene button** (aligned with a row) to clear the whole row (every step of
    that note, across all 64 steps);
  - tap a **screen-row button** (the block row below the display) to clear the whole
    block (its eight steps across all rows).
- While held, the scenes and block buttons that contain notes light up (what can be
  cleared). Release Delete to return the scenes to mute/solo and the block buttons to
  their native function.
- Each clear can be undone and is saved. (Push only.)

### Parameter locks (Encoders 7 and 8)

Lock two parameters of each pad's device, step by step — the first two parameters of the
device on the pad (Macro 1 and 2 if it is a rack), Elektron-style.

- **Lock a step:** hold a sequenced pad, then turn Encoders 7/8 (Lock 1 / Lock 2).
  At that step, the parameter takes the value you set (you hear the change right away). Each step can
  have its own values. A lock affects its own step only: on the row's next note without a
  lock, and when you stop playback, the parameter goes back to the value you gave it.
- **Shift a whole row** (like global probability): hold a **scene button**, then turn
  Encoders 7/8. This is an offset that moves all the row's notes — unlocked steps
  follow the value, locked steps are shifted by the same amount. Recenter (value 64)
  to remove the effect. The offset is non-destructive, and notes entered afterward follow it too.
- Opt-in: until you set a lock or an offset on a row, Puxi does not touch its
  parameters.
- Saved with the Set and can be undone. (Push only.)

Note: for rows that have locks, Puxi drives those two parameters during playback (it
rewrites them on every step) — do not also move them by hand or by automation at the
same time. The labels stay "Lock 1" / "Lock 2" and the value is normalized 0–127:
Push does not allow showing the parameter's actual name or units.

### Push 3 standalone (no computer)

Puxi also works in Push 3's standalone mode — pads, navigation (Octave/Page),
encoders, display, and Accent all work without a computer.

- To install it on Push, transfer the device to your Push library (Live's Wi-Fi
  transfer, or copy the device into the User Library). Once it is there, load it onto a
  track like any other device.
- Control is identical to tethered use (the same pads, arrows, and encoders).


## 7. Control Reference

| Action | In Live (mouse) | On Push 3 |
|---|---|---|
| Toggle a step | click the cell | tap the pad |
| Mute a track | click the **name** | hold **Mute** + scene button |
| Solo a track (exclusive) | click the **"S"** | hold **Solo** + scene button |
| Set velocity | drag ↑/↓ on the cell | pad hit strength, or hold pad + **Vel** encoder (4) |
| Global velocity (all notes) | — | **Vel** encoder (4), no pad held |
| Set probability | drag ←/→ (left part) | hold pad + **Prob** encoder (5) |
| Probability of a whole row | — | hold **scene** + **Prob** encoder (5) |
| Global probability (all notes) | — | **Prob** encoder (5), no pad held |
| Set length / tie | drag ←/→ (right third) | hold pad + **Length** encoder (6) |
| Global length (all notes) | — | **Length** encoder (6), no pad held |
| Ratcheting | **Shift** + drag ↑/↓ | hold **Repeat** + scene (division) + pad |
| Max velocity on entry | (drag to full) | **Accent** button (latch/hold) |
| Note bank | left gutter ▲ / ▼ | **Octave + / −** buttons |
| Step block | bottom strip ◄ / ► | **< Page / Page >** buttons |
| Loop start / end (global) | ruler handles | encoders **2 / 3** |
| One track's loop (polyrhythm) | — | hold **scene** + encoders **2 / 3** |
| Follow on/off | FOLLOW button | Encoder 1 (turn) |
| Momentary follow | — | hold Encoder 1 |
| Double the loop (×2) | **x2** button | **Double Loop** button |
| Duplicate a block | **DUP** button (copy → nav → paste) | hold **Duplicate** + screen-row buttons |
| Clear a row / a block | — | hold **Delete** + scene (row) / screen-row button (block) |
| Parameter lock (per step) | — | hold pad + encoders **7/8** |
| Parameter lock — shift a row | — | hold **scene** + encoders **7/8** (offset, 64 = neutral) |
| Export to a MIDI clip | **>CLIP** button | **Convert** button |
| Import a MIDI clip | **GET** button | — |


## 8. Converting To and From Clips

### Export to a MIDI clip (>CLIP)

- The **>CLIP** button (bottom-right of the grid) bakes your pattern into a MIDI clip
  in the first empty slot of Puxi's track. The clip is named "Puxi".
- The clip carries everything Puxi adds, not just notes and velocities:
  - **Length / tie** as the actual duration of each note (ties stay long).
  - **Probability** as Live's per-note probability (visible and editable in the note
    editor).
  - **Ratchet**, expanded into as many notes as there are repeats.
  - **Groove / swing**: the offbeat shift (at the current Amount) is printed into the
    note timing.
  - Accent is already in the velocity.
- Clip length runs to the last step that contains a note, rounded up to the beat (an
  eight-step pattern is two beats, sixteen steps is one bar, and so on).
- Not baked: mute/solo (a performance state — the whole pattern is exported) and
  polyrhythm (per-track loops are not unrolled; the clip is the programmed grid,
  looped by Live).

Note: a note that is both ratcheted and probabilistic rolls each sub-note
independently in the clip (in Puxi it is a single roll per step). The clip is on the
same track as Puxi, so if you launch it while Puxi is also generating, you hear the
notes twice — turn Puxi off, or use the clip instead (that is the point of baking).

### Import a MIDI clip (GET)

- The **GET** button (bottom strip, after DUP) does the reverse of >CLIP: it imports
  an existing MIDI clip into Puxi.
- It reads the clip open in Live's MIDI Note Editor (or, failing that, the one in the selected
  slot). Open or select the clip you want, then click GET.
- Each note becomes a cell: pitch to row, position to step (rounded to the nearest 16th
  note), and velocity / duration / probability to the cell. The loop is set to the
  clip's length.

Note: GET replaces the current pattern (there is no merge). Off-grid notes are
quantized to the nearest 16th note, ratchets are not reconstructed, and notes beyond 64 steps
or outside the C1–G3 range are dropped. (Live only for now; not yet on Push.)

### Duplicate a block (DUP)

- The pattern is divided into blocks of eight steps (eight blocks over 64 steps). You
  can copy the notes of one block to another.
- **In Live:** the **DUP** button (bottom strip, after FOL). Click it to copy the
  current block (the button lights up); navigate to another block (► / ◄); click DUP
  again to paste into the current block. (Clicking DUP again on the same block cancels the
  copy.)
- **On Push:** hold the **Duplicate** button. The eight buttons below the display come
  under Puxi's control. Tap a block to copy it (its LED blinks); tap another block to
  paste. Release Duplicate to return the buttons to their native function. The Duplicate LED is lit
  when a copy is possible (at least one block with notes and one empty block).
- Can be undone and is saved.


## 9. Good to Know

- **Loop length:** eight steps by default (half a bar in 16th notes). Stretch the loop
  (ruler or encoders) up to 64 steps (four bars) for longer patterns.
- **Sound output:** place a Drum Rack (or instrument) after Puxi on the track —
  otherwise you won't hear anything.
- **Saving:** your pattern is saved with the Set, per device instance — the pattern,
  mute/solo, and loops (global and per-track) return when you reopen the project. Each
  Puxi on your track keeps its own state.
- **Undo / redo:** Live's Undo (Cmd/Ctrl+Z) and Redo (Cmd/Ctrl+Shift+Z) work on your
  pattern edits (steps and velocities), mute/solo, loops, and note bank. Note: undoing
  loop changes made with the Push encoder is imperfect (the history can be
  inconsistent), whereas loop changes made with the Live ruler undo cleanly.
- **Removing Puxi while it controls Push:** click another device first (to release the
  Push controls), then remove Puxi.
- The height of a Max for Live device is limited by Live, which is why the grid is
  compact (8 × 8) and you navigate the pattern rather than seeing it all at once.


Puxi is under active development and is open source (GPLv3). This manual will evolve
with the device.
