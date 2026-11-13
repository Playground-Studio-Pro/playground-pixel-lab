const { contextBridge, ipcRenderer } = require('electron');
contextBridge.exposeInMainWorld('pixelLabDesktop', Object.freeze({
  version: 1,
  openProject: () => ipcRenderer.invoke('project:open'),
  saveProject: (text, suggestedName) => ipcRenderer.invoke('project:save', { text, suggestedName }),
  ffmpegStatus: () => ipcRenderer.invoke('ffmpeg:status'),
}));
