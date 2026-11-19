const { contextBridge, ipcRenderer } = require('electron');
function subscribe(channel, callback) {
  if (typeof callback !== 'function') throw new TypeError(`${channel} listener must be a function`);
  const listener = (_event, value) => callback(value);
  ipcRenderer.on(channel, listener);
  return () => ipcRenderer.removeListener(channel, listener);
}
contextBridge.exposeInMainWorld('pixelLabDesktop', Object.freeze({
  version: 1,
  openProject: () => ipcRenderer.invoke('project:open'),
  saveProject: (text, suggestedName) => ipcRenderer.invoke('project:save', { text, suggestedName }),
  ffmpegStatus: () => ipcRenderer.invoke('ffmpeg:status'),
  // Physical output (Phase C). D5: displays, open, close and status; D8: retry. update, clock and resume come later.
  // A rejected open carries the error code first in its message ("DISPLAY_BUSY: ...").
  output: Object.freeze({
    listDisplays: () => ipcRenderer.invoke('output:list-displays'),
    open: request => ipcRenderer.invoke('output:open', request),
    close: outputId => ipcRenderer.invoke('output:close', outputId),
    status: () => ipcRenderer.invoke('output:status-all'),
    retry: outputId => ipcRenderer.invoke('output:retry', outputId),
    onStatus: callback => subscribe('output:status', callback),
    onDisplays: callback => subscribe('output:displays-changed', callback),
  }),
}));
