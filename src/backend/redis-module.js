import { BrowserWindow, ipcMain } from 'electron';
import path from 'path';
import ElectronStore from 'electron-store';
import { createClient } from 'redis';
import { __dirname, encryptData, decryptData } from './utils.js';

// Initialize store for saving configuration
const store = new ElectronStore({
  encryptionKey: 'electron-store-twitch-overlay-key', // Built-in basic encryption for the entire store
});

// Create Redis client
let redisClient;
let redisWindow;

// Save Redis config with encryption for sensitive fields
export function saveRedisConfig(config) {
  // Encrypt sensitive fields
  const sensitiveFields = {
    username: config.username,
    password: config.password
  };
  
  // Store encrypted sensitive data and non-sensitive data separately
  store.set('redisConfig', {
    host: config.host,
    port: config.port,
    database: config.database,
    ssl: config.ssl,
    sensitiveData: encryptData(sensitiveFields)
  });
}

// Load Redis config with decryption for sensitive fields
export function loadRedisConfig() {
  const config = store.get('redisConfig');
  if (!config) return null;
  
  // Decrypt sensitive fields
  const sensitiveFields = decryptData(config.sensitiveData) || {};
  
  return {
    host: config.host,
    port: config.port,
    database: config.database,
    ssl: config.ssl,
    username: sensitiveFields.username,
    password: sensitiveFields.password
  };
}

// Create Redis client with config
export async function createRedisClient(config) {
  const redisConfig = {
    socket: {
      host: config.host,
      port: config.port,
      tls: config.ssl
    },
    database: config.database
  };
  
  // Add username and password if provided
  if (config.username) redisConfig.username = config.username;
  if (config.password) redisConfig.password = config.password;
  
  return createClient(redisConfig);
}

// Initialize Redis client with given config
export async function initRedisClient(config, handleRedisMessage, handleClearCacheMessage) {
  try {
    // If we have a previous client, disconnect it
    if (redisClient) {
      await redisClient.quit().catch(() => {});
    }
    
    // Create new client
    redisClient = await createRedisClient(config);
    
    // Set up error handler
    redisClient.on('error', (err) => {
      console.log('Redis Client Error', err);
      if (redisWindow) {
        redisWindow.webContents.send('redis-connection-status', { 
          error: err.message
        });
      }
    });
    
    // Try to connect
    if (redisWindow) {
      redisWindow.webContents.send('redis-connection-status', { connecting: true });
    }
    
    await redisClient.connect();
    
    // Subscribe to channels
    await redisClient.subscribe('display-overlay-gif', handleRedisMessage);
    await redisClient.subscribe('display-overlay-image', handleRedisMessage);
    await redisClient.subscribe('display-overlay-video', handleRedisMessage);
    await redisClient.subscribe('clear-overlay-cache', handleClearCacheMessage);
    
    if (redisWindow) {
      redisWindow.webContents.send('redis-connection-status', { success: true });
      // After a successful connection, close the window after a delay
      setTimeout(() => {
        if (redisWindow) {
          redisWindow.close();
          redisWindow = null;
        }
      }, 1500);
    }
    
    return true;
  } catch (err) {
    console.error('Failed to initialize Redis:', err);
    if (redisWindow) {
      redisWindow.webContents.send('redis-connection-status', { 
        error: err.message
      });
    }
    return false;
  }
}

// Show Redis connection dialog
export function showRedisConnectionDialog(onSuccessCallback) {
  // Create a window for Redis connection config
  redisWindow = new BrowserWindow({
    width: 550,
    height: 650,
    webPreferences: {
      preload: path.join(__dirname, '..', 'shared', 'redis-connect-preload', 'index.js'),
      nodeIntegration: false,
      contextIsolation: true
    },
    title: 'Redis Connection',
    autoHideMenuBar: true
  });
  
  // Load the Redis connection dialog
  const htmlPath = path.join(__dirname, '..', 'frontend', 'redis-connect', 'index.html');
  console.log(`Loading Redis connection dialog from: ${htmlPath}`);
  redisWindow.loadFile(htmlPath);
  
  // Open DevTools for debugging
  redisWindow.webContents.openDevTools({ mode: 'detach' });
  
  // When the page is loaded, send any existing config
  redisWindow.webContents.on('did-finish-load', () => {
    console.log('Redis connection dialog loaded, sending config');
    const config = loadRedisConfig();
    redisWindow.webContents.send('load-redis-config', config);
  });
  
  // Handle Redis connection test
  ipcMain.on('test-redis-connection', async (event, config) => {
    console.log('Received test-redis-connection event with config:', config);
    try {
      // Send connecting status
      redisWindow.webContents.send('redis-connection-status', { connecting: true });
      
      // Create a temporary client for testing
      const testClient = await createRedisClient(config);
      
      // Try to connect
      await testClient.connect();
      
      // Disconnect after successful test
      await testClient.quit();
      
      // Send success status
      console.log('Redis test connection successful');
      redisWindow.webContents.send('redis-connection-status', { success: true });
      
    } catch (err) {
      console.error('Redis test connection failed:', err);
      redisWindow.webContents.send('redis-connection-status', { 
        error: err.message 
      });
    }
  });
  
  // Handle saving Redis connection config
  ipcMain.on('save-redis-connection', async (event, config) => {
    console.log('Received save-redis-connection event with config:', config);
    
    // Save config first
    saveRedisConfig(config);
    
    // Try to initialize the Redis client with the new config
    const success = await initRedisClient(
      config, 
      global.handleRedisMessage, 
      global.handleClearCacheMessage
    );
    
    // If successful, proceed with callback (monitor selection)
    if (success && onSuccessCallback) {
      onSuccessCallback();
    }
  });
  
  // Clean up when closed
  redisWindow.on('closed', () => {
    console.log('Redis connection dialog closed, cleaning up listeners');
    ipcMain.removeAllListeners('test-redis-connection');
    ipcMain.removeAllListeners('save-redis-connection');
    redisWindow = null;
  });
}

// Disconnect Redis client
export async function disconnectRedis() {
  if (redisClient) {
    await redisClient.quit().catch(err => console.error('Error disconnecting Redis:', err));
    redisClient = null;
  }
}

// Get Redis client
export function getRedisClient() {
  return redisClient;
}