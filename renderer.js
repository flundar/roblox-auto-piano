const elements = {
  sheet: document.querySelector('#sheet'),
  bpm: document.querySelector('#bpm'),
  bpmNumber: document.querySelector('#bpmNumber'),
  division: document.querySelector('#division'),
  countdown: document.querySelector('#countdown'),
  hold: document.querySelector('#hold'),
  linePause: document.querySelector('#linePause'),
  sheetPanel: document.querySelector('#sheetPanel'),
  midiPanel: document.querySelector('#midiPanel'),
  audioPanel: document.querySelector('#audioPanel'),
  sheetTempoCard: document.querySelector('#sheetTempoCard'),
  midiControls: document.querySelector('#midiControls'),
  divisionSetting: document.querySelector('#divisionSetting'),
  linePauseSetting: document.querySelector('#linePauseSetting'),
  modeButtons: [...document.querySelectorAll('.mode-button')],
  chooseMidi: document.querySelector('#chooseMidiButton'),
  midiName: document.querySelector('#midiName'),
  midiInfo: document.querySelector('#midiInfo'),
  midiSpeed: document.querySelector('#midiSpeed'),
  midiTranspose: document.querySelector('#midiTranspose'),
  midiComplexity: document.querySelector('#midiComplexity'),
  midiHumanize: document.querySelector('#midiHumanize'),
  chooseAudio: document.querySelector('#chooseAudioButton'),
  saveMidi: document.querySelector('#saveMidiButton'),
  audioName: document.querySelector('#audioName'),
  audioInfo: document.querySelector('#audioInfo'),
  audioProgressTrack: document.querySelector('#audioProgressTrack'),
  audioProgressBar: document.querySelector('#audioProgressBar'),
  audioProgressLabel: document.querySelector('#audioProgressLabel'),
  validation: document.querySelector('#validation'),
  status: document.querySelector('#status'),
  play: document.querySelector('#playButton'),
  stop: document.querySelector('#stopButton'),
  clear: document.querySelector('#clearButton'),
  platformNotice: document.querySelector('#platformNotice')
};

let activeMode = 'sheet';
let selectedMidi = null;
let convertedAudio = null;
let convertingAudio = false;

if (window.piano.platform === 'win32') {
  elements.platformNotice.innerHTML = "<b>Windows:</b> After clicking Play, switch to the Roblox window during the countdown. No additional permission is required.";
}

function parseSheet(source) {
  const events = [];
  const errors = [];
  const text = source.replace(/\r/g, '').replace(/[‐‑‒–—―−]/g, '-');
  const playableKey = character => /^[a-zA-Z0-9!@#$%^&*()_+{}|:"'<>?~;,./=\\`]$/.test(character);
  let i = 0;

  while (i < text.length) {
    const char = text[i];
    if (char === '\n') {
      const pauseBeats = Number(elements.linePause.value);
      if (pauseBeats > 0 && events.length) {
        events.push({ keys: [], steps: pauseBeats * Number(elements.division.value), rest: true });
      }
      i += 1;
      continue;
    }
    if (/\s|\|/.test(char)) { i += 1; continue; }
    if (char === '-') {
      if (events.length) events[events.length - 1].steps += 1;
      else errors.push('A sustain marker was found without a preceding note.');
      i += 1;
      continue;
    }
    if (char === '[') {
      const close = text.indexOf(']', i + 1);
      if (close === -1) {
        errors.push(`Unclosed square bracket at character ${i + 1}.`);
        break;
      }
      const rawChord = text.slice(i + 1, close);
      const keys = [...rawChord].filter(playableKey);
      const invalidChordKey = [...rawChord].find(character => !playableKey(character) && !/\s/.test(character));
      if (invalidChordKey) errors.push(`Invalid “${invalidChordKey}” character in chord.`);
      if (keys.length) events.push({ keys: [...new Set(keys)], steps: 1 });
      else errors.push(`Empty chord at character ${i + 1}.`);
      i = close + 1;
      continue;
    }
    if (playableKey(char)) {
      events.push({ keys: [char], steps: 1 });
      i += 1;
      continue;
    }
    errors.push(`Invalid “${char}” character.`);
    i += 1;
  }
  return { events, errors };
}

function syncBpm(value) {
  const bpm = Math.max(30, Math.min(300, Number(value) || 120));
  elements.bpm.value = bpm;
  elements.bpmNumber.value = bpm;
  updateValidation();
}

function updateValidation() {
  if (activeMode === 'midi' || activeMode === 'audio') {
    const selection = activeMode === 'midi' ? selectedMidi : convertedAudio;
    elements.play.disabled = !selection || convertingAudio;
    return;
  }
  const parsed = parseSheet(elements.sheet.value);
  if (!elements.sheet.value.trim()) {
    elements.validation.textContent = 'No notes entered yet.';
    elements.validation.className = 'validation';
    elements.play.disabled = true;
    return;
  }
  if (parsed.errors.length) {
    elements.validation.textContent = parsed.errors[0];
    elements.validation.className = 'validation error';
    elements.play.disabled = true;
    return;
  }
  const steps = parsed.events.reduce((sum, event) => sum + event.steps, 0);
  const seconds = steps * 60 / Number(elements.bpmNumber.value) / Number(elements.division.value);
  const noteEvents = parsed.events.filter(event => !event.rest);
  const rests = parsed.events.filter(event => event.rest).length;
  const chords = noteEvents.filter(event => event.keys.length > 1).length;
  elements.validation.textContent = `${noteEvents.length} note events · ${chords} chords · ${rests} line breaks · about ${formatTime(seconds)}`;
  elements.validation.className = 'validation';
  elements.play.disabled = false;
}

function formatTime(seconds) {
  const minutes = Math.floor(seconds / 60);
  const rest = Math.round(seconds % 60).toString().padStart(2, '0');
  return `${minutes}:${rest}`;
}

function setStatus(text, type = '') {
  elements.status.className = `status ${type}`;
  elements.status.querySelector('b').textContent = text;
}

elements.bpm.addEventListener('input', event => syncBpm(event.target.value));
elements.bpmNumber.addEventListener('input', event => syncBpm(event.target.value));
elements.division.addEventListener('change', updateValidation);
elements.linePause.addEventListener('change', updateValidation);
elements.midiComplexity.addEventListener('change', () => {
  if (selectedMidi) {
    const count = window.midiUtils.simplifyMidiNotes(selectedMidi.notes, elements.midiComplexity.value).length;
    elements.midiInfo.textContent = `${count}/${selectedMidi.notes.length} notes will play · ${selectedMidi.tracks} tracks · ${formatTime(selectedMidi.duration)}`;
  }
  if (convertedAudio) {
    const count = window.midiUtils.simplifyMidiNotes(convertedAudio.notes, elements.midiComplexity.value).length;
    elements.audioInfo.textContent = `${count}/${convertedAudio.notes.length} piano notes will play · ${formatTime(convertedAudio.duration)} source audio`;
  }
});
elements.sheet.addEventListener('input', updateValidation);
elements.modeButtons.forEach(button => button.addEventListener('click', () => {
  activeMode = button.dataset.mode;
  elements.modeButtons.forEach(item => item.classList.toggle('active', item === button));
  const sheetMode = activeMode === 'sheet';
  elements.sheetPanel.classList.toggle('hidden', !sheetMode);
  elements.midiPanel.classList.toggle('hidden', activeMode !== 'midi');
  elements.audioPanel.classList.toggle('hidden', activeMode !== 'audio');
  elements.sheetTempoCard.classList.toggle('hidden', !sheetMode);
  elements.midiControls.classList.toggle('hidden', sheetMode);
  elements.divisionSetting.classList.toggle('hidden', !sheetMode);
  elements.linePauseSetting.classList.toggle('hidden', !sheetMode);
  updateValidation();
}));

elements.chooseMidi.addEventListener('click', async () => {
  const result = await window.piano.chooseMidi();
  if (!result.ok) {
    if (!result.canceled) {
      elements.midiName.textContent = 'Could not read MIDI';
      elements.midiInfo.textContent = result.error;
    }
    return;
  }
  selectedMidi = result;
  elements.midiName.textContent = result.name;
  elements.midiInfo.textContent = `${result.notes.length} notes · ${result.tracks} tracks · ${formatTime(result.duration)} · ${result.tempos || 1} tempo sections`;
  updateValidation();
});

elements.chooseAudio.addEventListener('click', async () => {
  if (convertingAudio) return;
  convertingAudio = true;
  convertedAudio = null;
  elements.chooseAudio.disabled = true;
  elements.saveMidi.classList.add('hidden');
  elements.audioProgressTrack.classList.remove('hidden');
  elements.audioProgressLabel.classList.remove('hidden');
  elements.audioProgressBar.style.width = '0%';
  elements.audioName.textContent = 'Analyzing audio…';
  elements.audioInfo.textContent = 'This may take several minutes depending on the length of the track.';
  updateValidation();

  const result = await window.piano.convertAudio();
  convertingAudio = false;
  elements.chooseAudio.disabled = false;
  if (!result.ok) {
    if (result.canceled) {
      elements.audioName.textContent = "Convert audio to piano MIDI";
      elements.audioInfo.textContent = 'Spotify Basic Pitch · offline polyphonic note detection';
      elements.audioProgressTrack.classList.add('hidden');
      elements.audioProgressLabel.classList.add('hidden');
    } else {
      elements.audioName.textContent = 'Conversion failed';
      elements.audioInfo.textContent = result.error;
    }
    updateValidation();
    return;
  }

  convertedAudio = result;
  elements.audioName.textContent = result.name;
  elements.audioInfo.textContent = `${result.notes.length} piano notes · ${formatTime(result.duration)} source audio`;
  elements.audioProgressBar.style.width = '100%';
  elements.audioProgressLabel.textContent = 'Ready — you can play it or save the MIDI file.';
  elements.saveMidi.classList.remove('hidden');
  updateValidation();
});

elements.saveMidi.addEventListener('click', async () => {
  if (!convertedAudio) return;
  const notes = window.midiUtils.simplifyMidiNotes(convertedAudio.notes, elements.midiComplexity.value);
  const result = await window.piano.saveMidi({ name: convertedAudio.name, notes });
  if (result.ok) elements.audioProgressLabel.textContent = 'MIDI file saved.';
  else if (!result.canceled) elements.audioProgressLabel.textContent = result.error;
});

window.piano.onTranscriptionProgress(data => {
  elements.audioProgressTrack.classList.remove('hidden');
  elements.audioProgressLabel.classList.remove('hidden');
  elements.audioProgressBar.style.width = `${Math.round(data.progress * 100)}%`;
  elements.audioProgressLabel.textContent = data.message;
});
elements.clear.addEventListener('click', () => {
  elements.sheet.value = '';
  elements.sheet.focus();
  updateValidation();
});

elements.play.addEventListener('click', async () => {
  if (activeMode === 'midi' || activeMode === 'audio') {
    const selection = activeMode === 'midi' ? selectedMidi : convertedAudio;
    if (!selection) return;
    const simplifiedNotes = window.midiUtils.simplifyMidiNotes(selection.notes, elements.midiComplexity.value);
    const performanceNotes = window.midiUtils.humanizeMidiNotes(simplifiedNotes, elements.midiHumanize.value);
    elements.play.disabled = true;
    elements.stop.disabled = false;
    const result = await window.piano.start({
      mode: 'midi',
      notes: performanceNotes,
      speed: Number(elements.midiSpeed.value),
      transpose: Number(elements.midiTranspose.value),
      countdown: Number(elements.countdown.value)
    });
    if (!result.ok) {
      setStatus(result.error, 'error');
      updateValidation();
      elements.stop.disabled = true;
    }
    return;
  }
  const parsed = parseSheet(elements.sheet.value);
  if (!parsed.events.length || parsed.errors.length) return;
  elements.play.disabled = true;
  elements.stop.disabled = false;
  const result = await window.piano.start({
    events: parsed.events,
    bpm: Number(elements.bpmNumber.value),
    division: Number(elements.division.value),
    countdown: Number(elements.countdown.value),
    holdRatio: Number(elements.hold.value)
  });
  if (!result.ok) {
    setStatus(result.error, 'error');
    elements.play.disabled = false;
    elements.stop.disabled = true;
  }
});

elements.stop.addEventListener('click', () => window.piano.stop());

window.piano.onStatus(data => {
  if (data.state === 'countdown') {
    setStatus(`${data.remaining}s — switch to the game`, 'playing');
  } else if (data.state === 'playing') {
    setStatus(data.message || 'Playing', 'playing');
  } else if (data.state === 'paused') {
    setStatus(data.message || 'Paused');
  } else if (data.state === 'stopped' || data.state === 'finished') {
    setStatus(data.message || 'Ready');
    elements.stop.disabled = true;
    updateValidation();
  } else if (data.state === 'error') {
    setStatus(data.message, 'error');
    elements.stop.disabled = true;
    updateValidation();
  }
});

fetch('sheet.txt')
  .then(response => response.text())
  .then(text => {
    if (!elements.sheet.value) elements.sheet.value = text.trim();
    updateValidation();
  })
  .catch(updateValidation);
