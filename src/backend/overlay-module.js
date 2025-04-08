import { BrowserWindow, screen, Menu, Tray, app, ipcMain, shell } from 'electron';
import path from 'path';
import { __dirname, downloadAndCacheFile, calculateDimensions, clearFileCache } from './utils.js';
import { saveMonitorConfig } from './monitor-select-module.js';
import { showTwitchSettingsWindow, addRewardListener, removeRewardListener } from './twitch-module.js';
import { 
  sendOverlayToWebClients, 
  getWebServerStatus, 
  initWebServer, 
  stopWebServer 
} from './web-server-module.js';

import { toggleWebAudioMute } from './web-server-module.js';

// Main overlay window
let mainWindow;
// System tray
let tray = null;
// Border visibility state
let borderVisible = true;

// Overlay queue system
const overlayQueue = [];
let isProcessingQueue = false;

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

  //open devtools for debugging
  //mainWindow.webContents.openDevTools({ mode: 'detach' });

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
  
  // Register Twitch reward listener
  setupTwitchRewardListener();
  
  // Listen for events from renderer about overlay item completion
  ipcMain.on('overlay-item-completed', () => {
    processNextQueueItem();
  });
  
  // Setup web client completion handler
  global.webClientCompletedOverlay = () => {
    processNextQueueItem();
  };

  return mainWindow;
}

// Add a function to handle Twitch reward redemptions
function setupTwitchRewardListener() {
  // Add listener for Twitch reward redemptions
  addRewardListener(handleTwitchReward);
}

// Handle Twitch reward redemption event
async function handleTwitchReward({ redemption, config }) {
  try {
    console.log(`Twitch reward redeemed: ${redemption.reward.title}`);
    console.log(`User: ${redemption.user_name}, Input: ${redemption.user_input || 'N/A'}`);
    
    if (mainWindow) {
      // Determine the media type
      let mediaType = config.type || 'image';
      
      // Get screen dimensions for size calculations
      const currentScreen = screen.getDisplayMatching(mainWindow.getBounds());
      const screenWidth = currentScreen.size.width;
      const screenHeight = currentScreen.size.height;
      
      // Calculate dimensions if specified in config
      let dimensions = calculateDimensions(
        config.width, 
        config.height, 
        screenWidth,
        screenHeight
      );

      // Send the data to the renderer process
      addToOverlayQueue({
        type: mediaType,
        path: config.path.replace(/\\/g, '/'), // Convert backslashes to forward slashes
        x: config.x || 0,
        y: config.y || 0,
        duration: config.duration || 5000,
        width: dimensions?.width,
        height: dimensions?.height,
        chromaKey: config.chromaKey || null,
        redemptionInfo: {
          title: redemption.reward.title,
          userName: redemption.user_name,
          userInput: redemption.user_input || ''
        },
        chromaSimilarity: config.similarity || 0.25,
        chromaSmoothness: config.smoothness || 0.1, 
      });
    }
  } catch (err) {
    console.error('Error handling Twitch reward:', err);
  }
}

// Process the next item in the queue
function processNextQueueItem() {
  if (overlayQueue.length === 0) {
    isProcessingQueue = false;
    return;
  }

  isProcessingQueue = true;
  const nextItem = overlayQueue.shift();
  
  if (mainWindow) {
    console.log('Processing next queue item:', nextItem.type);
    mainWindow.webContents.send('display-overlay', nextItem);
    
    // Also send to any connected web clients
    sendOverlayToWebClients(nextItem);
  }
}

// Add an item to the overlay queue
function addToOverlayQueue(overlayData) {
  console.log('Adding to overlay queue:', overlayData.type);
  overlayQueue.push(overlayData);
  
  if (!isProcessingQueue) {
    processNextQueueItem();
  }
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
  
  // Create the tray if it doesn't exist already
  if (!tray) {
    tray = new Tray(trayIcon || null);
    tray.setToolTip('Twitch Redeem Overlay');
    
    // Show context menu on left click as well (helpful for Windows users)
    tray.on('click', () => {
      tray.popUpContextMenu();
    });
  }
  
  // Just update the context menu for the existing tray
  updateTrayMenu();
}

// Update the tray menu without recreating the tray
function updateTrayMenu() {
  if (!tray) return;
  
  // Get current web server status
  const webServerStatus = getWebServerStatus();
  const webServerUrl = webServerStatus.url || `http://localhost:${webServerStatus.port}`;
  
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
      label: `Web Server (${webServerStatus.isRunning ? 'Running' : 'Stopped'})`,
      submenu: [
        {
          label: webServerStatus.isRunning ? `Stop Server` : 'Start Server',
          click: () => {
            if (webServerStatus.isRunning) {
              stopWebServer();
            } else {
              initWebServer();
            }
            // Update tray menu without recreating the tray
            updateTrayMenu();

            setTimeout(() => { updateTrayMenu();}, 1000);
          }
        },
        {
          label: `URL: ${webServerUrl}`,
          click: () => {
            // Open the URL in default browser
            shell.openExternal(webServerUrl);
          },
          enabled: webServerStatus.isRunning
        },
        {
          label: `Connected Clients: ${webServerStatus.connectedClients}`,
          enabled: false // Info only
        },
        { type: 'separator' },
        {
          label: 'Toggle Web Audio',
          type: 'checkbox',
          checked: webServerStatus.webAudioMuted,
          click: (menuItem) => {
            // Toggle mute state for web clients
            toggleWebAudioMute(menuItem.checked);
            updateTrayMenu();
          },
          enabled: webServerStatus.isRunning
        }
      ]
    },
    {
      label: 'Twitch Settings',
      click: () => {
        // Open Twitch settings window
        showTwitchSettingsWindow();
      }
    },
    { type: 'separator' },
    {
      label: 'Copyright © 2025 Visqi',
      enabled: false // Disabled menu item, just for display
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
      addToOverlayQueue({
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
  // Clean up Twitch reward listener
  removeRewardListener(handleTwitchReward);
  
  // Stop web server if running
  stopWebServer();
  
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