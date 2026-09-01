# Roblox Piano Player

A tempo-controlled Electron player for Roblox and Virtual Piano on macOS and Windows.

It supports three playback modes:

- **Sheet text** — paste Roblox piano notation and set the tempo.
- **MIDI file** — play standard `.mid` and `.midi` files while preserving their tempo map, note lengths, and chord timing.
- **Audio to MIDI** — transcribe MP3, M4A, WAV, AIFF, or FLAC audio into piano notes locally with Spotify Basic Pitch, then play or save the resulting MIDI.

MIDI playback includes speed and transpose controls, piano-focused simplification, and optional humanized timing.

## Install and run

```bash
npm install
npm start
```

## Build distributable apps

Build the macOS DMGs:

```bash
npm run build:mac
```

Build the Windows portable executable:

```bash
npm run build:win
```

Build output is written to the `dist` directory. The Windows package is a portable executable and does not require installation.

The macOS builds use an ad-hoc signature and the Windows build is unsigned. macOS Gatekeeper or Windows SmartScreen may therefore show a warning on first launch.

### Opening the macOS build

The app is ad-hoc signed but is not Apple-notarized. On first launch, Control-click the app, choose **Open**, then confirm **Open**. If macOS still reports that the downloaded app is damaged, move it to **Applications** and run:

```bash
xattr -dr com.apple.quarantine "/Applications/Roblox Piano Player.app"
```

Only use this command for a copy downloaded from this project's official GitHub release.

### macOS keyboard permission

On first playback, enable **Roblox Piano Player** in **System Settings → Privacy & Security → Accessibility**. Then quit the app completely and reopen it.

### Windows keyboard input

No additional accessibility permission is required. Click **Play**, then switch to the Roblox window during the countdown. If Roblox is running as administrator, run Roblox Piano Player at the same privilege level.

## Sheet notation

- `a` presses one key.
- `[se]` presses multiple keys together as a chord.
- `-` extends the preceding note or chord by one subdivision.
- Uppercase letters and Shift characters such as `! @ # $ % ^ & * ( )` are supported as distinct piano keys.
- Spaces and `|` are ignored and may be used for readability.
- Each new line adds a configurable pause. The default is one beat; it can be disabled.
- If **Notes per beat** is set to `2`, each note uses an eighth-note subdivision.

After clicking **Play**, switch to Roblox during the countdown. The app remains open. Press **F1** to pause or resume and **F2** to stop. **Cmd/Ctrl+Shift+Esc** is also available as an emergency stop.

## MIDI playback

The supported piano range is C2–C7 and uses the full Roblox/Virtual Piano keyboard mapping, including lowercase keys, uppercase keys, digits, and Shift symbols. Notes outside the supported range are skipped; use **Transpose** when needed.

Simplification options reduce dense arrangements to a playable number of simultaneous notes:

- **Original** — keeps all notes.
- **Balanced** — keeps up to four notes per chord.
- **Simple** — keeps up to three notes per chord.
- **Melody + bass** — keeps the highest and lowest notes.

Humanization adds small timing, chord-roll, duration, and rubato variations. Choose **Off** for exact mechanical timing.

## Audio-to-MIDI notes

Transcription runs locally and supports audio up to 15 minutes long. Results depend on the source: isolated piano recordings produce cleaner MIDI than full mixes with vocals and drums. Use the simplification controls before playback or saving to make dense transcriptions more suitable for the Roblox piano.
