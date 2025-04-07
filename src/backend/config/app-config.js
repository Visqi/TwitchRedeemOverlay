import dotenv from 'dotenv';
import path from 'path';
import fs from 'fs-extra';
import ElectronStore from 'electron-store';
import { app, BrowserWindow, ipcMain } from 'electron';
import { __dirname } from '../utils.js';

// Create secure store for app configuration
const configStore = new ElectronStore({
  name: 'app-config',
  encryptionKey: 'twitch-redeem-overlay-config-key',
});

// Determine if we're in production or development
const isDev = !app.isPackaged;
console.log(`Running in ${isDev ? 'DEVELOPMENT' : 'PRODUCTION'} mode`);

/**
 * Initialize configuration for the application
 * Will load from .env in development and from stored config in production
 */
export function initializeConfig() {
  try {
    // In development mode, use dotenv to load from .env file
    if (isDev) {
      console.log('Loading config from .env file (development mode)');
      dotenv.config();
    } else {
      // In production mode, try to find the .env file in multiple locations
      console.log('Searching for .env file in production mode');
      
      // Possible paths for .env file
      const possiblePaths = [
        // In the app directory
        path.join(process.cwd(), '.env'),
        
        // In the resources directory (electron-builder places it here)
        path.join(process.resourcesPath, '.env'),
        
        // Next to the executable
        path.join(path.dirname(app.getPath('exe')), '.env'),
        
        // In app.getAppPath()
        path.join(app.getAppPath(), '.env'),
        
        // In app.getPath('userData')
        path.join(app.getPath('userData'), '.env')
      ];
      
      // Log all possible paths we're checking
      possiblePaths.forEach(p => console.log(`Checking for .env at: ${p}`));
      
      // Try to find and load the .env file from any of these locations
      let envLoaded = false;
      for (const envPath of possiblePaths) {
        if (fs.existsSync(envPath)) {
          console.log(`Found .env file at: ${envPath}`);
          const envConfig = dotenv.parse(fs.readFileSync(envPath));
          
          // Set environment variables
          Object.entries(envConfig).forEach(([key, value]) => {
            process.env[key] = value;
          });
          
          // Store critical values in our secure config if not already there
          if (envConfig.TWITCH_CLIENT_ID && !configStore.has('twitchClientId')) {
            console.log('Storing Twitch Client ID in secure config');
            configStore.set('twitchClientId', envConfig.TWITCH_CLIENT_ID);
          }
          
          if (envConfig.TWITCH_CLIENT_SECRET && !configStore.has('twitchClientSecret')) {
            console.log('Storing Twitch Client Secret in secure config');
            configStore.set('twitchClientSecret', envConfig.TWITCH_CLIENT_SECRET);
          }
          
          envLoaded = true;
          console.log('Successfully loaded .env file');
          break;
        }
      }
      
      if (!envLoaded) {
        console.log('No .env file found, will use stored config if available');
      }
    }
    
    // Always check the secure store as a backup
    if (!process.env.TWITCH_CLIENT_ID && configStore.has('twitchClientId')) {
      process.env.TWITCH_CLIENT_ID = configStore.get('twitchClientId');
      console.log('Using Twitch Client ID from secure store');
    }
    
    if (!process.env.TWITCH_CLIENT_SECRET && configStore.has('twitchClientSecret')) {
      process.env.TWITCH_CLIENT_SECRET = configStore.get('twitchClientSecret');
      console.log('Using Twitch Client Secret from secure store');
    }
  } catch (err) {
    console.error('Error initializing config:', err);
  }
  
  // Log config status
  logConfigStatus();
}

/**
 * Get configuration value, checking environment variables first
 * and then the secure store as a backup
 */
export function getConfig(key, defaultValue = null) {
  // Convert config key to expected env var format (e.g. twitchClientId -> TWITCH_CLIENT_ID)
  const envKey = key
    .replace(/([A-Z])/g, '_$1')
    .toUpperCase();
    
  // Check environment variables first
  if (process.env[envKey] !== undefined) {
    return process.env[envKey];
  }
  
  // Then check stored config
  if (configStore.has(key)) {
    return configStore.get(key);
  }
  
  // Fall back to default value
  return defaultValue;
}

/**
 * Set configuration value in the secure store
 */
export function setConfig(key, value) {
  // Store in secure config
  configStore.set(key, value);
  
  // Also set in environment variable for immediate use
  const envKey = key
    .replace(/([A-Z])/g, '_$1')
    .toUpperCase();
    
  process.env[envKey] = value;
}

/**
 * Get Twitch client ID
 */
export function getTwitchClientId() {
  const clientId = getConfig('twitchClientId');
  if (!clientId) {
    console.warn('Failed to get Twitch Client ID from any source');
  }
  return clientId;
}

/**
 * Get Twitch client secret
 */
export function getTwitchClientSecret() {
  const clientSecret = getConfig('twitchClientSecret');
  if (!clientSecret) {
    console.warn('Failed to get Twitch Client Secret from any source');
  }
  return clientSecret;
}

/**
 * Check if critical configuration is present
 */
export function hasRequiredConfig() {
  const hasConfig = Boolean(getTwitchClientId() && getTwitchClientSecret());
  console.log(`Has required Twitch API config: ${hasConfig}`);
  return hasConfig;
}

/**
 * Show configuration status in console
 */
export function logConfigStatus() {
  console.log(`Running in ${isDev ? 'development' : 'production'} mode`);
  console.log(`App Path: ${app.getAppPath()}`);
  console.log(`User Data Path: ${app.getPath('userData')}`);
  console.log(`Executable Path: ${app.getPath('exe')}`);
  
  if (!isDev) {
    console.log(`Resources Path: ${process.resourcesPath || 'undefined'}`);
  }
  
  const clientId = getTwitchClientId();
  const clientSecret = getTwitchClientSecret();
  
  if (clientId && clientSecret) {
    console.log('Twitch API credentials found:');
    console.log(`Client ID (first 5 chars): ${clientId.substring(0, 5)}...`);
    console.log(`Client Secret (first 3 chars): ${clientSecret.substring(0, 3)}...`);
  } else {
    console.warn('MISSING TWITCH API CREDENTIALS:');
    if (!clientId) console.warn('- Missing Twitch Client ID');
    if (!clientSecret) console.warn('- Missing Twitch Client Secret');
  }
  
  // Log all environment variables starting with TWITCH_
  console.log('Environment variables:');
  Object.keys(process.env)
    .filter(key => key.startsWith('TWITCH_'))
    .forEach(key => {
      const value = process.env[key];
      console.log(`${key}: ${value ? (value.substring(0, 5) + '...') : 'undefined'}`);
    });
    
  // Log all secure store keys related to Twitch
  console.log('Secure store values:');
  ['twitchClientId', 'twitchClientSecret'].forEach(key => {
    const hasKey = configStore.has(key);
    console.log(`${key}: ${hasKey ? 'present' : 'missing'}`);
  });
}

/**
 * Show a dialog to directly input Twitch API credentials
 * This is useful if automatic loading fails
 */
export function showCredentialConfigWindow() {
  // Create a new window for credentials input
  const credentialWindow = new BrowserWindow({
    width: 500,
    height: 400,
    webPreferences: {
      nodeIntegration: false,
      contextIsolation: true,
      preload: path.join(__dirname, '..', '..', 'shared', 'preload-main', 'index.js')
    },
    title: 'Twitch API Credentials',
    autoHideMenuBar: true,
    resizable: false
  });

  // Set up IPC handler for saving credentials
  ipcMain.once('save-twitch-credentials', (event, data) => {
    console.log('Received credentials from UI');
    
    if (data.clientId) {
      setConfig('twitchClientId', data.clientId);
      console.log('Saved new Twitch Client ID');
    }
    
    if (data.clientSecret) {
      setConfig('twitchClientSecret', data.clientSecret);
      console.log('Saved new Twitch Client Secret');
    }
    
    // Close the window
    if (!credentialWindow.isDestroyed()) {
      credentialWindow.close();
    }
    
    // Log the new status
    logConfigStatus();
  });

  // Create HTML content
  const htmlContent = `
    <!DOCTYPE html>
    <html>
    <head>
      <title>Twitch API Credentials</title>
      <style>
        body {
          font-family: Arial, sans-serif;
          padding: 20px;
          background-color: #f5f5f5;
        }
        .container {
          background-color: white;
          border-radius: 8px;
          padding: 20px;
          box-shadow: 0 2px 10px rgba(0,0,0,0.1);
        }
        h2 {
          margin-top: 0;
          color: #6441a5;
        }
        .form-group {
          margin-bottom: 15px;
        }
        label {
          display: block;
          margin-bottom: 5px;
          font-weight: bold;
        }
        input[type="text"], input[type="password"] {
          width: 100%;
          padding: 8px;
          border: 1px solid #ddd;
          border-radius: 4px;
          box-sizing: border-box;
        }
        .buttons {
          margin-top: 20px;
          text-align: right;
        }
        button {
          background-color: #6441a5;
          color: white;
          border: none;
          padding: 8px 16px;
          border-radius: 4px;
          cursor: pointer;
          font-size: 14px;
        }
        button:hover {
          background-color: #7d5bbe;
        }
        .help-text {
          font-size: 12px;
          color: #666;
          margin-top: 5px;
        }
      </style>
    </head>
    <body>
      <div class="container">
        <h2>Twitch API Credentials</h2>
        <p>Enter your Twitch API credentials below. You can find these in the <a href="https://dev.twitch.tv/console/apps" target="_blank">Twitch Developer Console</a>.</p>
        
        <div class="form-group">
          <label for="clientId">Client ID</label>
          <input type="text" id="clientId" placeholder="Enter your Client ID">
          <div class="help-text">The Client ID from your Twitch Developer application</div>
        </div>
        
        <div class="form-group">
          <label for="clientSecret">Client Secret</label>
          <input type="password" id="clientSecret" placeholder="Enter your Client Secret">
          <div class="help-text">The Client Secret from your Twitch Developer application</div>
        </div>
        
        <div class="buttons">
          <button id="saveBtn">Save Credentials</button>
        </div>
      </div>
      
      <script>
        document.getElementById('saveBtn').addEventListener('click', () => {
          const clientId = document.getElementById('clientId').value.trim();
          const clientSecret = document.getElementById('clientSecret').value.trim();
          
          window.electron.send('save-twitch-credentials', { 
            clientId: clientId || null,
            clientSecret: clientSecret || null
          });
        });
      </script>
    </body>
    </html>
  `;

  // Write HTML to a temporary file
  const tempPath = path.join(app.getPath('temp'), 'twitch-credentials.html');
  fs.writeFileSync(tempPath, htmlContent);
  
  // Load the HTML file
  credentialWindow.loadFile(tempPath);
  
  // Open dev tools for debugging
  if (isDev) {
    credentialWindow.webContents.openDevTools({ mode: 'detach' });
  }
  
  // Delete the temporary file when the window is closed
  credentialWindow.on('closed', () => {
    try {
      fs.unlinkSync(tempPath);
    } catch (err) {
      console.error('Error deleting temporary file:', err);
    }
  });
  
  return credentialWindow;
}