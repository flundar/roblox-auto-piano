const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('piano', {
  platform: process.platform,
  start: payload => ipcRenderer.invoke('start-playback', payload),
  chooseMidi: () => ipcRenderer.invoke('choose-midi'),
  convertAudio: () => ipcRenderer.invoke('convert-audio'),
  saveMidi: payload => ipcRenderer.invoke('save-midi', payload),
  stop: () => ipcRenderer.send('stop-playback'),
  onStatus: callback => ipcRenderer.on('playback-status', (_event, data) => callback(data)),
  onTranscriptionProgress: callback => ipcRenderer.on('transcription-progress', (_event, data) => callback(data))
});
