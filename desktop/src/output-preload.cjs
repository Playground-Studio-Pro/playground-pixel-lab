// Preload for output windows only (PHYSICAL_OUTPUT section 3, OutputWindowApi). Nothing else is exposed:
// no project files, no FFmpeg, no display list. Main checks every message's sender against the output role.
const { contextBridge, ipcRenderer } = require('electron');
const subscribe = channel => callback => {
  if (typeof callback !== 'function') throw new TypeError(`${channel} expects a function`);
  ipcRenderer.on(channel, (_event, payload) => callback(payload));
};
contextBridge.exposeInMainWorld('pixelLabOutput', Object.freeze({
  version: 1,
  onSession: subscribe('output:session'),
  onClock: subscribe('output:clock'),
  onDisplay: subscribe('output:display'),
  ready: () => ipcRenderer.send('output:ready'),
  report: report => ipcRenderer.send('output:report', report),
}));
