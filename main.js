const { app, BrowserWindow, ipcMain, globalShortcut, dialog, systemPreferences, shell } = require('electron');
const fs = require('node:fs');
const path = require('node:path');
const koffi = require('koffi');
const { Midi } = require('@tonejs/midi');
const tf = require('@tensorflow/tfjs');
const { BasicPitch, outputToNotesPoly, noteFramesToTime } = require('@spotify/basic-pitch');

let window;
let player;
let countdownTimer;

const KEY_CODES = {
  a: 0, s: 1, d: 2, f: 3, h: 4, g: 5, z: 6, x: 7,
  c: 8, v: 9, b: 11, q: 12, w: 13, e: 14, r: 15,
  y: 16, t: 17, 1: 18, 2: 19, 3: 20, 4: 21, 6: 22,
  5: 23, '=': 24, 9: 25, 7: 26, '-': 27, 8: 28, 0: 29,
  ']': 30, o: 31, u: 32, '[': 33, i: 34, p: 35, l: 37,
  j: 38, "'": 39, k: 40, ';': 41, '\\': 42, ',': 43, '/': 44, n: 45,
  m: 46, '.': 47, '`': 50
};

const WINDOWS_KEY_CODES = {
  ...Object.fromEntries('abcdefghijklmnopqrstuvwxyz'.split('').map(key => [key, key.toUpperCase().charCodeAt(0)])),
  ...Object.fromEntries('0123456789'.split('').map(key => [key, key.charCodeAt(0)])),
  '=': 0xBB, '-': 0xBD, ']': 0xDD, '[': 0xDB, "'": 0xDE,
  ';': 0xBA, '\\': 0xDC, ',': 0xBC, '/': 0xBF, '.': 0xBE, '`': 0xC0
};

const SHIFTED_KEYS = {
  '!': '1', '@': '2', '#': '3', '$': '4', '%': '5', '^': '6',
  '&': '7', '*': '8', '(': '9', ')': '0', '_': '-', '+': '=',
  '{': '[', '}': ']', '|': '\\', ':': ';', '"': "'", '<': ',',
  '>': '.', '?': '/', '~': '`'
};

const MIDI_KEYBOARD = [
  '1', '!', '2', '@', '3', '4', '$', '5', '%', '6', '^', '7', '8', '*', '9', '(', '0',
  'q', 'Q', 'w', 'W', 'e', 'E', 'r', 't', 'T', 'y', 'Y', 'u', 'i', 'I', 'o', 'O', 'p', 'P',
  'a', 's', 'S', 'd', 'D', 'f', 'g', 'G', 'h', 'H', 'j', 'J', 'k', 'l', 'L',
  'z', 'Z', 'x', 'c', 'C', 'v', 'V', 'b'
];
const MIDI_BASE_NOTE = 36;

let nativeKeyboard;
const LEFT_SHIFT_CODE = 56;
let basicPitch;
let audioConversionRunning = false;

function getNativeKeyboard() {
  if (nativeKeyboard) return nativeKeyboard;
  if (process.platform === 'win32') {
    const user32 = koffi.load('user32.dll');
    const keybdEvent = user32.func('void keybd_event(uint8_t, uint8_t, uint32_t, uint64_t)');
    nativeKeyboard = {
      pressKey: (code, down) => keybdEvent(code, 0, down ? 0 : 0x0002, 0),
      isTrusted: () => true
    };
    return nativeKeyboard;
  }
  const services = koffi.load('/System/Library/Frameworks/ApplicationServices.framework/ApplicationServices');
  const core = koffi.load('/System/Library/Frameworks/CoreFoundation.framework/CoreFoundation');
  const keyboard = {
    createEvent: services.func('void *CGEventCreateKeyboardEvent(void *, uint16_t, bool)'),
    postEvent: services.func('void CGEventPost(uint32_t, void *)'),
    releaseEvent: core.func('void CFRelease(void *)'),
    isTrusted: () => systemPreferences.isTrustedAccessibilityClient(false)
  };
  nativeKeyboard = {
    pressKey: (code, down) => {
      const event = keyboard.createEvent(null, code, down);
      if (!event) return;
      keyboard.postEvent(0, event);
      keyboard.releaseEvent(event);
    },
    isTrusted: keyboard.isTrusted
  };
  return nativeKeyboard;
}

function getBasicPitch() {
  if (basicPitch) return basicPitch;
  const packageRoot = path.dirname(require.resolve('@spotify/basic-pitch/package.json'));
  const modelRoot = path.join(packageRoot, 'model');
  const modelJson = JSON.parse(fs.readFileSync(path.join(modelRoot, 'model.json'), 'utf8'));
  const weightChunks = modelJson.weightsManifest.flatMap(group =>
    group.paths.map(file => fs.readFileSync(path.join(modelRoot, file)))
  );
  const combinedWeights = Buffer.concat(weightChunks);
  const weightData = combinedWeights.buffer.slice(
    combinedWeights.byteOffset,
    combinedWeights.byteOffset + combinedWeights.byteLength
  );
  const model = tf.loadGraphModel({
    load: async () => ({
      modelTopology: modelJson.modelTopology,
      weightSpecs: modelJson.weightsManifest.flatMap(group => group.weights),
      weightData,
      format: modelJson.format,
      generatedBy: modelJson.generatedBy,
      convertedBy: modelJson.convertedBy
    })
  });
  basicPitch = new BasicPitch(model);
  return basicPitch;
}

async function decodeAudioToMono22050(filePath) {
  const { default: decodeAudio } = await import('@audio/decode');
  const decoded = await decodeAudio(fs.readFileSync(filePath));
  if (!decoded.channelData?.length || !decoded.channelData[0]?.length) throw new Error('Could not read audio samples.');
  const sourceLength = decoded.channelData[0].length;
  const mono = new Float32Array(sourceLength);
  for (const channel of decoded.channelData) {
    for (let i = 0; i < sourceLength; i += 1) mono[i] += channel[i] / decoded.channelData.length;
  }
  if (decoded.sampleRate === 22050) return mono;
  const targetLength = Math.max(1, Math.round(sourceLength * 22050 / decoded.sampleRate));
  const resampled = new Float32Array(targetLength);
  const ratio = decoded.sampleRate / 22050;
  for (let i = 0; i < targetLength; i += 1) {
    const sourcePosition = i * ratio;
    const left = Math.floor(sourcePosition);
    const right = Math.min(sourceLength - 1, left + 1);
    const fraction = sourcePosition - left;
    resampled[i] = mono[left] * (1 - fraction) + mono[right] * fraction;
  }
  return resampled;
}

function postRawKey(code, down) {
  getNativeKeyboard().pressKey(code, down);
}

function postKey(key, down) {
  const shiftedBase = SHIFTED_KEYS[key];
  const isUppercase = /^[A-Z]$/.test(key);
  const needsShift = Boolean(shiftedBase || isUppercase);
  const baseKey = shiftedBase || (isUppercase ? key.toLowerCase() : key);
  const code = process.platform === 'win32' ? WINDOWS_KEY_CODES[baseKey] : KEY_CODES[baseKey];
  if (code === undefined) return;

  if (down) {
    if (needsShift) {
      const shiftCode = process.platform === 'win32' ? 0x10 : LEFT_SHIFT_CODE;
      postRawKey(shiftCode, true);
      postRawKey(code, true);
      postRawKey(shiftCode, false);
    } else {
      postRawKey(code, true);
    }
  } else {
    postRawKey(code, false);
  }
}

const wait = milliseconds => new Promise(resolve => setTimeout(resolve, milliseconds));

async function waitWhilePlaying(controller, milliseconds) {
  let remaining = milliseconds;
  while (remaining > 0 && !controller.stopped) {
    if (controller.paused) {
      await wait(20);
      continue;
    }
    const slice = Math.min(remaining, 20);
    const startedAt = performance.now();
    await wait(slice);
    if (!controller.paused) remaining -= performance.now() - startedAt;
  }
}

function togglePause() {
  if (!player) return;
  player.paused = !player.paused;

  if (player.paused) {
    player.pausedHeld = [...player.held];
    for (const key of player.pausedHeld) postKey(key, false);
    window.webContents.send('playback-status', { state: 'paused', message: 'Paused — press F1 to resume' });
  } else {
    for (const key of player.pausedHeld) postKey(key, true);
    player.pausedHeld = [];
    window.webContents.send('playback-status', { state: 'playing', message: 'Playing — press F1 to pause' });
  }
}

function requestAccessibilityPermission(openSettings = false) {
  if (process.platform !== 'darwin') return true;
  const trusted = systemPreferences.isTrustedAccessibilityClient(true);
  if (!trusted && openSettings) {
    shell.openExternal('x-apple.systempreferences:com.apple.preference.security?Privacy_Accessibility').catch(() => {});
  }
  return trusted;
}

function createWindow() {
  window = new BrowserWindow({
    width: 1060,
    height: 760,
    minWidth: 820,
    minHeight: 620,
    backgroundColor: '#0b0c10',
    titleBarStyle: 'hiddenInset',
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false
    }
  });
  window.loadFile('index.html');
  window.webContents.once('did-finish-load', () => {
    if (process.platform === 'darwin') setTimeout(() => requestAccessibilityPermission(false), 700);
  });
}

function stopPlayback(reason = 'Stopped') {
  if (countdownTimer) clearInterval(countdownTimer);
  countdownTimer = null;
  if (player) {
    const oldPlayer = player;
    player = null;
    oldPlayer.stopped = true;
    for (const key of oldPlayer.held) postKey(key, false);
    for (const key of oldPlayer.pausedHeld) postKey(key, false);
    oldPlayer.held = [];
    oldPlayer.pausedHeld = [];
  }
  if (window && !window.isDestroyed()) {
    window.show();
    window.webContents.send('playback-status', { state: 'stopped', message: reason });
  }
}

async function startNativePlayer(payload) {
  if (!['darwin', 'win32'].includes(process.platform)) {
    window.webContents.send('playback-status', {
      state: 'error',
      message: 'System keyboard automation is available on macOS and Windows.'
    });
    window.show();
    return;
  }

  let keyboard;
  try {
    keyboard = getNativeKeyboard();
  } catch (error) {
    window.webContents.send('playback-status', { state: 'error', message: `Could not start the keyboard engine: ${error.message}` });
    window.show();
    return;
  }

  if (!keyboard.isTrusted()) {
    requestAccessibilityPermission(true);
    window.show();
    window.webContents.send('playback-status', {
      state: 'error',
      message: 'Roblox Piano Player was added to Accessibility. Enable its switch, return here, and press Play again.'
    });
    return;
  }

  const controller = { stopped: false, held: [] };
  controller.paused = false;
  controller.pausedHeld = [];
  player = controller;
  window.webContents.send('playback-status', { state: 'playing', message: 'Playing — press F1 to pause' });
  const stepMilliseconds = 60_000 / Math.max(1, payload.bpm) / Math.max(1, payload.division);

  for (const event of payload.events) {
    if (controller.stopped) return;
    const duration = stepMilliseconds * Math.max(1, event.steps);
    controller.held = event.keys;
    for (const key of event.keys) postKey(key, true);
    await waitWhilePlaying(controller, duration * payload.holdRatio);
    for (const key of event.keys) postKey(key, false);
    controller.held = [];
    if (controller.stopped) return;
    await waitWhilePlaying(controller, duration * (1 - payload.holdRatio));
  }

  if (player !== controller) return;
  player = null;
  window.show();
  window.webContents.send('playback-status', { state: 'finished', message: 'Track complete.' });
}

async function startMidiPlayer(payload) {
  if (!['darwin', 'win32'].includes(process.platform)) {
    window.webContents.send('playback-status', { state: 'error', message: 'MIDI keyboard automation is available on macOS and Windows.' });
    return;
  }

  let keyboard;
  try {
    keyboard = getNativeKeyboard();
  } catch (error) {
    window.webContents.send('playback-status', { state: 'error', message: `Could not start the keyboard engine: ${error.message}` });
    return;
  }
  if (!keyboard.isTrusted()) {
    requestAccessibilityPermission(true);
    window.show();
    window.webContents.send('playback-status', {
      state: 'error',
      message: 'Roblox Piano Player was added to Accessibility. Enable its switch, return here, and press Play again.'
    });
    return;
  }

  const speed = Math.max(0.25, Math.min(2, Number(payload.speed) || 1));
  const transpose = Math.max(-36, Math.min(36, Number(payload.transpose) || 0));
  const actions = [];
  let skipped = 0;

  for (const note of payload.notes) {
    const index = note.midi + transpose - MIDI_BASE_NOTE;
    const key = MIDI_KEYBOARD[index];
    if (!key) { skipped += 1; continue; }
    actions.push({ time: note.time * 1000 / speed, key, down: true });
    actions.push({ time: (note.time + note.duration) * 1000 / speed, key, down: false });
  }
  actions.sort((a, b) => a.time - b.time || Number(a.down) - Number(b.down));

  if (!actions.length) {
    window.webContents.send('playback-status', { state: 'error', message: 'No playable notes were found in the C2–C7 range. Adjust the transpose setting.' });
    return;
  }

  const controller = { stopped: false, paused: false, held: [], pausedHeld: [] };
  const heldCounts = new Map();
  player = controller;
  window.webContents.send('playback-status', { state: 'playing', message: 'Playing MIDI — press F1 to pause' });

  let previousTime = 0;
  for (const action of actions) {
    if (controller.stopped) return;
    await waitWhilePlaying(controller, Math.max(0, action.time - previousTime));
    if (controller.stopped) return;
    previousTime = action.time;

    const count = heldCounts.get(action.key) || 0;
    if (action.down) {
      if (count === 0) postKey(action.key, true);
      heldCounts.set(action.key, count + 1);
    } else if (count > 0) {
      if (count === 1) {
        postKey(action.key, false);
        heldCounts.delete(action.key);
      } else {
        heldCounts.set(action.key, count - 1);
      }
    }
    controller.held = [...heldCounts.keys()];
  }

  for (const key of heldCounts.keys()) postKey(key, false);
  if (player !== controller) return;
  player = null;
  window.webContents.send('playback-status', {
    state: 'finished',
    message: skipped ? `MIDI complete · ${skipped} out-of-range notes skipped.` : 'MIDI complete.'
  });
}

ipcMain.handle('choose-midi', async () => {
  const result = await dialog.showOpenDialog(window, {
    title: 'Choose a MIDI file',
    properties: ['openFile'],
    filters: [{ name: 'MIDI Files', extensions: ['mid', 'midi'] }]
  });
  if (result.canceled || !result.filePaths[0]) return { ok: false, canceled: true };

  try {
    const filePath = result.filePaths[0];
    const midi = new Midi(fs.readFileSync(filePath));
    const notes = midi.tracks.flatMap(track => track.notes.map(note => ({
      midi: note.midi,
      time: note.time,
      duration: Math.max(0.02, note.duration),
      velocity: note.velocity
    })));
    return {
      ok: true,
      name: path.basename(filePath),
      notes,
      duration: midi.duration,
      tracks: midi.tracks.length,
      tempos: midi.header.tempos.length
    };
  } catch (error) {
    return { ok: false, error: `Could not read MIDI: ${error.message}` };
  }
});

ipcMain.handle('convert-audio', async () => {
  if (audioConversionRunning) return { ok: false, error: 'An audio file is already being converted.' };
  const result = await dialog.showOpenDialog(window, {
    title: 'Choose an MP3 or audio file',
    properties: ['openFile'],
    filters: [{ name: 'Audio Files', extensions: ['mp3', 'm4a', 'wav', 'aiff', 'aif', 'flac'] }]
  });
  if (result.canceled || !result.filePaths[0]) return { ok: false, canceled: true };

  const inputPath = result.filePaths[0];
  audioConversionRunning = true;
  const sendProgress = (progress, message) => {
    if (window && !window.isDestroyed()) {
      window.webContents.send('transcription-progress', { progress, message });
    }
  };

  try {
    sendProgress(0.02, 'Preparing audio file…');
    const monoAudio = await decodeAudioToMono22050(inputPath);
    sendProgress(0.08, 'Audio decoded; detecting piano notes…');
    const duration = monoAudio.length / 22050;
    if (duration > 15 * 60) throw new Error('Audio files up to 15 minutes are supported.');

    const frames = [];
    const onsets = [];
    const contours = [];
    await getBasicPitch().evaluateModel(
      monoAudio,
      (frameChunk, onsetChunk, contourChunk) => {
        frames.push(...frameChunk);
        onsets.push(...onsetChunk);
        contours.push(...contourChunk);
      },
      progress => sendProgress(0.08 + progress * 0.84, `Extracting notes… ${Math.round(progress * 100)}%`)
    );

    sendProgress(0.94, 'Refining note timing…');
    const predicted = noteFramesToTime(outputToNotesPoly(frames, onsets, 0.25, 0.25, 5));
    const notes = predicted.map(note => ({
      midi: note.pitchMidi,
      time: note.startTimeSeconds,
      duration: Math.max(0.02, note.durationSeconds),
      velocity: Math.max(0.05, Math.min(1, note.amplitude || 0.8))
    }));
    if (!notes.length) throw new Error('No sufficiently distinct piano notes were found in this audio file.');

    sendProgress(1, 'Audio-to-MIDI conversion complete.');
    return {
      ok: true,
      name: `${path.parse(inputPath).name}.mid`,
      sourceName: path.basename(inputPath),
      notes,
      duration,
      tracks: 1,
      tempos: 1,
      converted: true
    };
  } catch (error) {
    return { ok: false, error: `Could not convert audio to MIDI: ${error.message}` };
  } finally {
    audioConversionRunning = false;
  }
});

ipcMain.handle('save-midi', async (_event, payload) => {
  try {
    const result = await dialog.showSaveDialog(window, {
      title: 'Save MIDI file',
      defaultPath: payload.name || 'converted.mid',
      filters: [{ name: 'MIDI File', extensions: ['mid'] }]
    });
    if (result.canceled || !result.filePath) return { ok: false, canceled: true };
    const midi = new Midi();
    const track = midi.addTrack();
    for (const note of payload.notes) {
      track.addNote({
        midi: note.midi,
        time: note.time,
        duration: note.duration,
        velocity: note.velocity || 0.8
      });
    }
    fs.writeFileSync(result.filePath, Buffer.from(midi.toArray()));
    return { ok: true, path: result.filePath };
  } catch (error) {
    return { ok: false, error: `Could not save MIDI: ${error.message}` };
  }
});

ipcMain.handle('start-playback', (_event, payload) => {
  if (player || countdownTimer) return { ok: false, error: 'Playback is already in progress.' };

  let remaining = Math.max(0, Math.min(10, Number(payload.countdown) || 0));
  window.webContents.send('playback-status', { state: 'countdown', remaining });

  const launch = () => {
    countdownTimer = null;
    if (payload.mode === 'midi') startMidiPlayer(payload);
    else startNativePlayer(payload);
  };

  if (remaining === 0) launch();
  else {
    countdownTimer = setInterval(() => {
      remaining -= 1;
      if (remaining <= 0) {
        clearInterval(countdownTimer);
        launch();
      } else {
        window.webContents.send('playback-status', { state: 'countdown', remaining });
      }
    }, 1000);
  }
  return { ok: true };
});

ipcMain.on('stop-playback', () => stopPlayback());

app.whenReady().then(() => {
  createWindow();
  globalShortcut.register('F1', togglePause);
  globalShortcut.register('F2', () => stopPlayback('Stopped with F2.'));
  globalShortcut.register('CommandOrControl+Shift+Escape', () => stopPlayback('Emergency stop used.'));
  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

app.on('will-quit', () => {
  globalShortcut.unregisterAll();
  if (player) {
    player.stopped = true;
    for (const key of player.held) postKey(key, false);
    for (const key of player.pausedHeld) postKey(key, false);
  }
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});
