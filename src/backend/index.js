import { app, BrowserWindow, dialog, Menu } from 'electron';
import { clearFileCache } from './utils.js';
import { 
  loadRedisConfig, 
  initRedisClient, 
  showRedisConnectionDialog,
  disconnectRedis,
  getRedisClient
} from './redis-module.js';
import { 
  showMonitorSelectionDialog,
  loadMonitorConfig 
} from './monitor-select-module.js';
import { 
  createOverlay, 
  handleRedisMessage, 
  handleClearCacheMessage 
} from './overlay-module.js';
import { initializeTwitchModule } from './twitch-module.js';
import { initializeConfig, logConfigStatus } from './config/app-config.js';
import { initLogger, getCurrentLogFilePath } from './utils/logger.js';
import path from 'path';
import fs from 'fs-extra';

// Enable developer tools in production
app.commandLine.appendSwitch('enable-logging');
app.commandLine.appendSwitch('v', '1'); // Verbose logging

// Initialize our file logger
const logFilePath = initLogger();
console.log(`Application logs will be saved to: ${logFilePath}`);

// Store references to handler functions globally so they can be accessed from other modules
global.handleRedisMessage = handleRedisMessage;
global.handleClearCacheMessage = handleClearCacheMessage;

// Add a menu item to show log file location
const createAppMenu = () => {
  const template = [
    {
      label: 'File',
      submenu: [
        {
          label: 'Open Log File Location',
          click: async () => {
            const logPath = getCurrentLogFilePath();
            const dir = path.dirname(logPath);
            
            try {
              // Try to open the log directory
              await app.showItemInFolder(logPath);
            } catch (err) {
              console.error('Error opening log file location:', err);
              
              // Fallback method - show dialog with log path
              dialog.showMessageBox({
                type: 'info',
                title: 'Log File Location',
                message: `Log files are stored at: ${dir}`,
                detail: `Current log file: ${logPath}`,
                buttons: ['OK']
              });
            }
          }
        },
        { type: 'separator' },
        {
          label: 'Exit',
          click: () => app.quit(),
          accelerator: 'Alt+F4'
        }
      ]
    },
    {
      label: 'Help',
      submenu: [
        {
          label: 'Show DevTools',
          click: () => {
            // Get the focused window and open DevTools
            const win = BrowserWindow.getFocusedWindow();
            if (win) {
              win.webContents.openDevTools({ mode: 'detach' });
            }
          },
          accelerator: 'F12'
        },
        {
          label: 'About',
          click: () => {
            dialog.showMessageBox({
              type: 'info',
              title: 'About Twitch Redeem Overlay',
              message: 'Twitch Redeem Overlay',
              detail: `Version: ${app.getVersion()}\nElectron: ${process.versions.electron}\nChrome: ${process.versions.chrome}\nNode: ${process.versions.node}\n\nCopyright © 2025`
            });
          }
        }
      ]
    }
  ];
  
  const menu = Menu.buildFromTemplate(template);
  Menu.setApplicationMenu(menu);
};

// Application startup flow
app.whenReady().then(async () => {
  console.log('Starting Twitch Redeem Overlay application...');
  
  // Set up application menu
  createAppMenu();
  
  // Initialize configuration system - this now returns a boolean indicating success
  const configLoaded = initializeConfig();
  logConfigStatus();
  
  // Get config helpers
  const { hasRequiredConfig, showCredentialConfigWindow } = await import('./config/app-config.js');
  
  // Check if we have required configuration
  if (!configLoaded || !hasRequiredConfig()) {
    console.log('Configuration missing or first run detected, showing credentials dialog');
    
    // Show credential config dialog
    const credWindow = showCredentialConfigWindow();
    
    // Wait for credential window to close before continuing
    credWindow.once('closed', () => {
      // Re-check if we have credentials after the dialog is closed
      if (hasRequiredConfig()) {
        console.log('Credentials have been set, initializing Twitch module');
        initializeTwitchModule();
        showMonitorSelectionDialog(createOverlay);
      } else {
        console.warn('Credentials still missing after dialog closed, starting anyway');
        // Continue anyway but modules that need credentials may not work
        initializeTwitchModule();
        showMonitorSelectionDialog(createOverlay);
      }
    });
  } else {
    console.log('Configuration loaded successfully, initializing application');
    // Initialize Twitch module
    initializeTwitchModule();
    showMonitorSelectionDialog(createOverlay);
  }
  
  // Handle application activation (macOS)
  app.on('activate', function () {
    showMonitorSelectionDialog(createOverlay);
  });
});

// Handle all windows closed
app.on('window-all-closed', async () => {
  // Clear cache before quitting
  await clearFileCache();
  
  if (process.platform !== 'darwin') {
    // Disconnect Redis client before quitting
    const redisClient = getRedisClient();
    if (redisClient) {
      await disconnectRedis();
    }
    app.quit();
  }
});

// Handle app shutdown
app.on('before-quit', async (event) => {
  // Clear cache before quitting
  await clearFileCache();
  
  const redisClient = getRedisClient();
  if (redisClient) {
    event.preventDefault();
    await disconnectRedis();
    app.exit();
  }
});