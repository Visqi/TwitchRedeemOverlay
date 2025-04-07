const { contextBridge, ipcRenderer } = require('electron');

// Expose protected methods that allow the renderer process to use
// the ipcRenderer without exposing the entire object
contextBridge.exposeInMainWorld(
  'electron',
  {
    send: (channel, data) => {
      // List of allowed channels to send
      const validSendChannels = [
        'toggle-border',
        'overlay-item-completed',
        'save-twitch-credentials'
      ];
      
      if (validSendChannels.includes(channel)) {
        ipcRenderer.send(channel, data);
      }
    },
    receive: (channel, func) => {
      // List of allowed channels to receive
      const validReceiveChannels = [
        'display-overlay',
        'toggle-border',
        'clear-cache'
      ];
      
      if (validReceiveChannels.includes(channel)) {
        // Remove any old listeners to avoid duplicates
        ipcRenderer.removeAllListeners(channel);
        
        // Add the new listener
        ipcRenderer.on(channel, (event, ...args) => func(...args));
      }
    }
  }
);