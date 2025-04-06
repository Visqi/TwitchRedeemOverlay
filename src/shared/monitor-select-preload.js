// Use ES modules syntax for preload scripts
import { contextBridge, ipcRenderer } from 'electron';

// Expose protected methods that allow the renderer process to use IPC
contextBridge.exposeInMainWorld('electron', {
  receive: (channel, func) => {
    // Whitelist channels for security
    const validChannels = ['monitor-list'];
    if (validChannels.includes(channel)) {
      // Remove any previous listener to avoid duplicates
      ipcRenderer.removeAllListeners(channel);
      // Add the new listener
      ipcRenderer.on(channel, (event, ...args) => func(...args));
    }
  },
  selectMonitor: (monitorId) => {
    ipcRenderer.send('monitor-selected', monitorId);
  }
});