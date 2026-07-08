const { contextBridge, ipcRenderer, webFrame, webUtils } = require('electron');

const IPC_MANIFEST = require('./ipc/channel-manifest.json');
const ALLOWED_CHANNELS = new Set(Object.values(IPC_MANIFEST));

function isAllowedChannel(channel) {
  return ALLOWED_CHANNELS.has(channel) || channel.startsWith('channel:');
}

contextBridge.exposeInMainWorld('electron', {
  ipcRenderer: {
    invoke: (channel, ...args) => {
      if (!isAllowedChannel(channel)) throw new Error(`Blocked IPC channel: ${channel}`);
      return ipcRenderer.invoke(channel, ...args);
    },
    on: (channel, listener) => {
      if (!isAllowedChannel(channel)) throw new Error(`Blocked IPC channel: ${channel}`);
      const wrapped = (_event, ...eventArgs) => listener(...eventArgs);
      ipcRenderer.on(channel, wrapped);
      return () => ipcRenderer.removeListener(channel, wrapped);
    },
    removeAllListeners: (channel) => {
      if (!isAllowedChannel(channel)) throw new Error(`Blocked IPC channel: ${channel}`);
      ipcRenderer.removeAllListeners(channel);
    },
  },
  setZoomFactor: (factor) => webFrame.setZoomFactor(factor),
  // Returns the absolute filesystem path for a File obtained from a drop event
  // (or any DataTransfer / input[type=file]). Returns '' for File objects that
  // have no backing path (e.g. images dragged from a browser tab).
  getPathForFile: (file) => {
    try {
      return webUtils.getPathForFile(file) || '';
    } catch {
      return '';
    }
  },
});
