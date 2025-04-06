// Use CommonJS syntax for preload scripts
const { contextBridge, ipcRenderer } = require('electron');

// Expose protected methods that allow the renderer process to use IPC
contextBridge.exposeInMainWorld('electron', {
  receive: (channel, func) => {
    // Whitelist channels for security
    const validChannels = ['load-redis-config', 'redis-connection-status'];
    if (validChannels.includes(channel)) {
      // Remove any previous listener to avoid duplicates
      ipcRenderer.removeAllListeners(channel);
      // Add the new listener
      ipcRenderer.on(channel, (event, ...args) => func(...args));
    }
  },
  testRedisConnection: (config) => {
    console.log('Testing Redis connection with config:', config);
    ipcRenderer.send('test-redis-connection', config);
  },
  saveRedisConnection: (config) => {
    console.log('Saving Redis connection with config:', config); 
    ipcRenderer.send('save-redis-connection', config);
  }
});