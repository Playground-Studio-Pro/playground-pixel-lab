const { contextBridge, ipcRenderer } = require('electron');
contextBridge.exposeInMainWorld('pixelLabDesktop', Object.freeze({
  version: 1,
  openProject: () => ipcRenderer.invoke('project:open'),
  saveProject: (text, suggestedName) => ipcRenderer.invoke('project:save', { text, suggestedName }),
  ffmpegStatus: () => ipcRenderer.invoke('ffmpeg:status'),
  // Physical output (Phase C). D2: displays only; open/close/status arrive with D3–D5.
  output: Object.freeze({
    listDisplays: () => ipcRenderer.invoke('output:list-displays'),
    onDisplays: callback => {
      if (typeof callback !== 'function') throw new TypeError('onDisplays expects a function');
      const listener = (_event, displays) => callback(displays);
      ipcRenderer.on('output:displays-changed', listener);
      return () => ipcRenderer.removeListener('output:displays-changed', listener);
    },
  }),
}));
