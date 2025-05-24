import { app, BrowserWindow, dialog, Menu } from 'electron';
import { clearFileCache } from './utils.js';
import { 
  showMonitorSelectionDialog,
  loadMonitorConfig 
} from './monitor-select-module.js';
import { 
  createOverlay, 
} from './overlay-module.js';
import { initializeTwitchModule } from './twitch-module.js';
import { initializeConfig, logConfigStatus } from './config/app-config.js';
import { initLogger, getCurrentLogFilePath } from './utils/logger.js';
import { stopWebServer } from './web-server-module.js';
import path from 'path';
import fs from 'fs-extra';

// Enable developer tools in production
app.commandLine.appendSwitch('enable-logging');
app.commandLine.appendSwitch('v', '1'); // Verbose logging

// Initialize our file logger
const logFilePath = initLogger();
console.log(`Application logs will be saved to: ${logFilePath}`);

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
  
  // Initialize configuration system
  initializeConfig();
  logConfigStatus();
  
  // Check if we have Twitch API credentials, show config dialog if not
  const { hasRequiredConfig, showCredentialConfigWindow } = await import('./config/app-config.js');
  
  if (!hasRequiredConfig()) {
    console.log('Twitch API credentials not found, showing credentials dialog');
    const credWindow = showCredentialConfigWindow();
    
    // Wait for credential window to close before continuing
    credWindow.on('closed', () => {
      // Initialize Twitch module after credentials are set
      initializeTwitchModule();
      showMonitorSelectionDialog(createOverlay);
    });
  } else {
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
  
  // Stop web server if running
  await stopWebServer();
});

// Handle app shutdown
app.on('before-quit', async (event) => {
  // Clear cache before quitting
  await clearFileCache();
  
  // Stop web server if running
  await stopWebServer();
});