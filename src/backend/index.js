import { app, BrowserWindow } from 'electron';
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

// Store references to handler functions globally so they can be accessed from other modules
global.handleRedisMessage = handleRedisMessage;
global.handleClearCacheMessage = handleClearCacheMessage;

// Application startup flow
app.whenReady().then(async () => {
  console.log('Starting Twitch Redeem Overlay application...');
  
  // Initialize Twitch module
  initializeTwitchModule();
  
  // Try to load Redis config
  //const redisConfig = loadRedisConfig();
  //
  //if (redisConfig) {
  //  // Try to connect with saved config
  //  const success = await initRedisClient(
  //    redisConfig, 
  //    handleRedisMessage, 
  //    handleClearCacheMessage
  //  );
  //  
  //  if (!success) {
  //    // If connection failed, show Redis connection dialog
  //    showRedisConnectionDialog(() => showMonitorSelectionDialog(createOverlay));
  //  } else {
  //    // If Redis connection was successful, show monitor selection dialog
  //    showMonitorSelectionDialog(createOverlay);
  //  }
  //} else {
  //  // No Redis config found, show connection dialog
  //  showRedisConnectionDialog(() => showMonitorSelectionDialog(createOverlay));
  //}

  showMonitorSelectionDialog(createOverlay);
  
  // Handle application activation (macOS)
  app.on('activate', function () {
    showMonitorSelectionDialog(createOverlay);
    //if (BrowserWindow.getAllWindows().length === 0) {
    //  const redisConfig = loadRedisConfig();
    //  if (redisConfig) {
    //    initRedisClient(
    //      redisConfig, 
    //      handleRedisMessage, 
    //      handleClearCacheMessage
    //    ).then(success => {
    //      if (success) {
    //        showMonitorSelectionDialog(createOverlay);
    //      } else {
    //        showRedisConnectionDialog(() => showMonitorSelectionDialog(createOverlay));
    //      }
    //    });
    //  } else {
    //    showRedisConnectionDialog(() => showMonitorSelectionDialog(createOverlay));
    //  }
    //}
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