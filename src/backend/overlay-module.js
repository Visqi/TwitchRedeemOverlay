import { BrowserWindow, screen, Menu, Tray, app, ipcMain } from 'electron';
import path from 'path';
import { __dirname, downloadAndCacheFile, calculateDimensions, clearFileCache } from './utils.js';
import { saveMonitorConfig } from './monitor-select-module.js';

// Main overlay window
let mainWindow;
// System tray
let tray = null;
// Border visibility state
let borderVisible = true;

// Create the overlay window
export function createOverlay(monitorInfo) {
  // Create the browser window
  mainWindow = new BrowserWindow({
    width: monitorInfo.width,
    height: monitorInfo.height,
    x: monitorInfo.x,
    y: monitorInfo.y,
    transparent: true,
    frame: false,
    alwaysOnTop: true,
    skipTaskbar: true,
    webPreferences: {
      preload: path.join(__dirname, '..', 'shared', 'preload-main', 'index.js'),
      nodeIntegration: false,
      contextIsolation: true
    }
  });

  // Load the index.html of the app
  mainWindow.loadFile(path.join(__dirname, '..', 'frontend', 'overlay', 'index.html'));
  
  // Set window to be click-through
  mainWindow.setIgnoreMouseEvents(true);
  
  // Save selected monitor info for next startup
  saveMonitorConfig(monitorInfo);
  
  // Create system tray
  createSystemTray();
  
  // Listen for border toggle events
  ipcMain.on('toggle-border', (event, visible) => {
    borderVisible = visible;
    // We can broadcast this to any other windows that might need it
    if (mainWindow) {
      mainWindow.webContents.send('toggle-border', visible);
    }
  });
  
  return mainWindow;
}

// Create system tray with context menu
function createSystemTray() {
  // Icon path 
  const iconPath = path.join(__dirname, '..', 'assets', 'tray-icon.png');
  
  // Create a default icon if the custom icon doesn't exist
  let trayIcon;
  try {
    // Check if the icon exists
    trayIcon = iconPath;
  } catch (err) {
    // Use a built-in electron icon as fallback
    trayIcon = null;
  }
  
  // Create the tray
  tray = new Tray(trayIcon || null);
  tray.setToolTip('Twitch Redeem Overlay');
  
  // Create context menu
  const contextMenu = Menu.buildFromTemplate([
    {
      label: 'Toggle Border',
      type: 'checkbox',
      checked: borderVisible,
      click: () => {
        borderVisible = !borderVisible;
        if (mainWindow) {
          mainWindow.webContents.send('toggle-border', borderVisible);
        }
      }
    },
    {
      label: 'Toggle Click-Through',
      type: 'checkbox',
      checked: true,
      click: (menuItem) => {
        if (mainWindow) {
          mainWindow.setIgnoreMouseEvents(menuItem.checked);
        }
      }
    },
    { type: 'separator' },
    {
      label: 'Settings',
      click: () => {
        // TODO: Implement settings window
        // For now, just show a temporary settings window
        const settingsWindow = new BrowserWindow({
          width: 400,
          height: 300,
          webPreferences: {
            nodeIntegration: false,
            contextIsolation: true
          },
          title: 'Overlay Settings',
          autoHideMenuBar: true
        });
        
        // Create a simple HTML content
        const settingsContent = `
          <html>
          <head>
            <title>Twitch Redeem Overlay Settings</title>
            <style>
              body {
                font-family: Arial, sans-serif;
                margin: 20px;
                background-color: #f5f5f5;
              }
              h1 {
                color: #6441a5;
              }
              .info {
                background-color: #fff;
                border-radius: 8px;
                padding: 15px;
                margin-top: 20px;
                box-shadow: 0 2px 5px rgba(0,0,0,0.1);
              }
            </style>
          </head>
          <body>
            <h1>Overlay Settings</h1>
            <div class="info">
              <p>Settings will be implemented in a future update.</p>
              <p>For now, you can use the system tray icon to:</p>
              <ul>
                <li>Toggle the red border</li>
                <li>Toggle click-through</li>
                <li>Exit the application</li>
              </ul>
            </div>
          </body>
          </html>
        `;
        
        // Load HTML content
        settingsWindow.loadURL(`data:text/html;charset=utf-8,${encodeURIComponent(settingsContent)}`);
      }
    },
    { type: 'separator' },
    {
      label: 'Exit',
      click: () => {
        app.quit();
      }
    }
  ]);
  
  tray.setContextMenu(contextMenu);
  
  // Show context menu on left click as well (helpful for Windows users)
  tray.on('click', () => {
    tray.popUpContextMenu();
  });
}

// Handle clear cache Redis command
export async function handleClearCacheMessage() {
  await clearFileCache();
  if (mainWindow) {
    mainWindow.webContents.send('clear-cache');
  }
}

// Handle Redis message for displaying content in overlay
export async function handleRedisMessage(message, channel) {
  try {
    const data = JSON.parse(message);
    console.log(`Received ${channel} command:`, data);
    
    if (mainWindow) {
      // Determine the media type
      let mediaType;
      switch (channel) {
        case 'display-overlay-gif':
          mediaType = 'gif';
          break;
        case 'display-overlay-image':
          mediaType = 'image';
          break;
        case 'display-overlay-video':
          mediaType = 'video';
          break;
        default:
          mediaType = 'unknown';
      }
      
      // Get screen dimensions for size calculations
      const currentScreen = screen.getDisplayMatching(mainWindow.getBounds());
      const screenWidth = currentScreen.size.width;
      const screenHeight = currentScreen.size.height;
      
      // Calculate dimensions if needed
      let dimensions = calculateDimensions(
        data.width, 
        data.height, 
        screenWidth,
        screenHeight
      );
      
      // Download and cache the file if it's a URL
      let localPath = data.path;
      if (data.path.startsWith('http')) {
        localPath = await downloadAndCacheFile(data.path);
        if (!localPath) {
          console.error('Failed to download and cache file');
          return;
        }
      }
      
      // Send the data to the renderer process
      mainWindow.webContents.send('display-overlay', {
        type: mediaType,
        path: localPath,
        x: data.x || 0,
        y: data.y || 0,
        duration: data.duration || 5000,
        width: dimensions?.width,
        height: dimensions?.height,
        chromaKey: data.chromaKey || null, // Pass chroma key color if specified
      });
    }
  } catch (err) {
    console.error('Error processing Redis message:', err);
  }
}

// Get the main window instance
export function getMainWindow() {
  return mainWindow;
}

// Close the overlay window
export function closeOverlay() {
  if (mainWindow) {
    mainWindow.close();
    mainWindow = null;
  }
  
  // Clean up tray
  if (tray) {
    tray.destroy();
    tray = null;
  }
}