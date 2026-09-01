(function exposeMidiUtils(root) {
  const PROFILES = {
    balanced: { grid: 0.035, minDuration: 0.055, minVelocity: 0.12, maxChord: 4 },
    simple: { grid: 0.07, minDuration: 0.09, minVelocity: 0.22, maxChord: 3 },
    melodyBass: { grid: 0.1, minDuration: 0.11, minVelocity: 0.28, maxChord: 2 }
  };

  const HUMAN_PROFILES = {
    subtle: { jitterMs: 5, chordSpreadMs: 5, durationVariation: 0.035, rubatoMs: 5 },
    natural: { jitterMs: 11, chordSpreadMs: 10, durationVariation: 0.07, rubatoMs: 13 },
    expressive: { jitterMs: 20, chordSpreadMs: 18, durationVariation: 0.11, rubatoMs: 25 }
  };

  function selectChord(notes, maximum) {
    if (notes.length <= maximum) return notes;
    const byPitch = [...notes].sort((a, b) => a.midi - b.midi);
    const selected = [byPitch[byPitch.length - 1]];
    if (maximum > 1 && byPitch[0] !== selected[0]) selected.push(byPitch[0]);

    const remaining = notes
      .filter(note => !selected.includes(note))
      .sort((a, b) => b.velocity - a.velocity || b.duration - a.duration);
    while (selected.length < maximum && remaining.length) selected.push(remaining.shift());
    return selected;
  }

  function simplifyMidiNotes(notes, mode = 'balanced') {
    if (mode === 'original') return notes.map(note => ({ ...note }));
    const profile = PROFILES[mode] || PROFILES.balanced;
    const groups = new Map();

    for (const raw of notes) {
      const midi = Math.round(Number(raw.midi));
      const time = Number(raw.time);
      const duration = Number(raw.duration);
      const velocity = Number.isFinite(Number(raw.velocity)) ? Number(raw.velocity) : 0.8;
      if (!Number.isFinite(midi) || !Number.isFinite(time) || !Number.isFinite(duration)) continue;
      if (duration < profile.minDuration || velocity < profile.minVelocity) continue;

      const quantizedTime = Math.max(0, Math.round(time / profile.grid) * profile.grid);
      const quantizedDuration = Math.max(
        profile.minDuration,
        Math.round(duration / profile.grid) * profile.grid
      );
      const groupKey = Math.round(quantizedTime / profile.grid);
      if (!groups.has(groupKey)) groups.set(groupKey, new Map());
      const pitchMap = groups.get(groupKey);
      const existing = pitchMap.get(midi);
      const note = { midi, time: quantizedTime, duration: quantizedDuration, velocity };
      if (!existing || note.velocity > existing.velocity || note.duration > existing.duration) {
        pitchMap.set(midi, note);
      }
    }

    const simplified = [];
    for (const pitchMap of groups.values()) {
      simplified.push(...selectChord([...pitchMap.values()], profile.maxChord));
    }
    return simplified.sort((a, b) => a.time - b.time || a.midi - b.midi);
  }

  function humanizeMidiNotes(notes, mode = 'natural') {
    if (mode === 'off') return notes.map(note => ({ ...note }));
    const profile = HUMAN_PROFILES[mode] || HUMAN_PROFILES.natural;
    const result = notes.map(note => ({ ...note }));
    const chordGroups = new Map();

    for (const note of result) {
      const groupKey = Math.round(note.time / 0.035);
      if (!chordGroups.has(groupKey)) chordGroups.set(groupKey, []);
      chordGroups.get(groupKey).push(note);
    }

    for (const group of chordGroups.values()) {
      if (group.length < 2) continue;
      const direction = Math.random() < 0.72 ? 1 : -1;
      group.sort((a, b) => direction * (a.midi - b.midi));
      const totalSpread = profile.chordSpreadMs / 1000;
      group.forEach((note, index) => {
        note.time += totalSpread * index / Math.max(1, group.length - 1);
      });
    }

    const phase = Math.random() * Math.PI * 2;
    for (const note of result) {
      const jitter = (Math.random() * 2 - 1) * profile.jitterMs / 1000;
      const rubato = (
        Math.sin(note.time * 0.72 + phase) * 0.7 +
        Math.sin(note.time * 0.19 + phase * 0.4) * 0.3
      ) * profile.rubatoMs / 1000;
      note.time = Math.max(0, note.time + jitter + rubato);

      const durationRandom = (Math.random() * 2 - 1) * profile.durationVariation;
      const velocityExpression = ((note.velocity ?? 0.8) - 0.5) * 0.06;
      note.duration = Math.max(0.035, note.duration * (1 + durationRandom + velocityExpression));
    }
    return result.sort((a, b) => a.time - b.time || a.midi - b.midi);
  }

  const api = { simplifyMidiNotes, humanizeMidiNotes };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  if (root) root.midiUtils = api;
})(typeof window !== 'undefined' ? window : globalThis);
