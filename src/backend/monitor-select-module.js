import { BrowserWindow, screen, ipcMain } from 'electron';
import path from 'path';
import ElectronStore from 'electron-store';
import { __dirname } from './utils.js';

// Initialize store for saving configuration
const store = new ElectronStore({
  encryptionKey: 'electron-store-twitch-overlay-key',
});

let selectionWindow;

// Select monitor dialog
export function showMonitorSelectionDialog(createOverlayCallback) {
  const displays = screen.getAllDisplays();
  
  // Create a small window for monitor selection
  selectionWindow = new BrowserWindow({
    width: 500,
    height: 400,
    webPreferences: {
      preload: path.join(__dirname, '..', 'shared', 'monitor-select-preload', 'index.js'),
      nodeIntegration: false,
      contextIsolation: true
    },
    title: 'Select Monitor',
    autoHideMenuBar: true
  });
  
  selectionWindow.loadFile(path.join(__dirname, '..', 'frontend', 'monitor-select', 'index.html'));
  
  // Send monitor info to selection window
  selectionWindow.webContents.on('did-finish-load', () => {
    selectionWindow.webContents.send('monitor-list', displays);
  });
  
  // Listen for monitor selection
  ipcMain.once('monitor-selected', (event, monitorId) => {
    const selectedMonitor = displays.find(d => d.id === monitorId);
    if (selectedMonitor) {
      selectionWindow.close();
      
      // Create monitor info object
      const monitorInfo = {
        width: selectedMonitor.size.width,
        height: selectedMonitor.size.height,
        x: selectedMonitor.bounds.x,
        y: selectedMonitor.bounds.y
      };
      
      // Save selected monitor info for next startup
      saveMonitorConfig(monitorInfo);
      
      // Call the callback to create the overlay window
      if (createOverlayCallback) {
        createOverlayCallback(monitorInfo);
      }
    }
  });
  
  // Clean up when closed
  selectionWindow.on('closed', () => {
    selectionWindow = null;
  });
}

// Save monitor configuration
export function saveMonitorConfig(monitorInfo) {
  store.set('selectedMonitor', monitorInfo);
}

// Load monitor configuration
export function loadMonitorConfig() {
  return store.get('selectedMonitor');
}