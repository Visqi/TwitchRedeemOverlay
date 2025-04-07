import { BrowserWindow, ipcMain, shell, dialog } from 'electron';
import path from 'path';
import { randomBytes } from 'crypto';
import ElectronStore from 'electron-store';
import fetch from 'node-fetch';
import { __dirname } from './utils.js';
import http from 'http';
import https from 'https';
import fs from 'fs-extra';
import os from 'os';
import { URL } from 'url';
import { generateSelfSignedCert } from './cert-utils.js';
import WebSocket from 'ws';
import { getTwitchClientId, getTwitchClientSecret, hasRequiredConfig } from './config/app-config.js';

// Secure store for saving Twitch credentials
const secureStore = new ElectronStore({
  encryptionKey: 'twitch-overlay-secure-storage-key',
  name: 'twitch-credentials'
});

// Twitch API credentials from configuration
const TWITCH_CLIENT_ID = getTwitchClientId();
const TWITCH_CLIENT_SECRET = getTwitchClientSecret();
const REDIRECT_PORT = 3000;
const TWITCH_REDIRECT_URI = `http://localhost:${REDIRECT_PORT}/auth/callback`;

// Validate that we have the required configuration
if (!hasRequiredConfig()) {
  console.error('Error: Twitch API credentials missing in configuration.');
  console.error('Please ensure your Twitch Client ID and Client Secret are properly configured.');
}

// Paths for SSL certificates
const CERT_DIR = path.join(os.homedir(), '.twitch-redeem-overlay');
const CERT_PATH = path.join(CERT_DIR, 'cert.pem');
const KEY_PATH = path.join(CERT_DIR, 'key.pem');

// Local HTTPS server for handling OAuth callback
let authServer = null;

// Window reference
let twitchWindow = null;
let twitchSettingsWindow = null;

// Store authentication state
const authState = {
  verifier: null,
  challenge: null,
  stateValue: null,
  isPollingRewards: false,
  pollingInterval: null,
  channelId: null,
  channelName: null,
  authPromiseResolve: null,
  authPromiseReject: null,
  lastRewardRefresh: null
};

// Event listeners for reward redemptions
const eventListeners = new Set();

// Store configured rewards
let configuredRewards = {};
let hourlyRefreshTimer = null;

// Variables for EventSub
let eventsubSocket = null;
let eventsubSessionId = null;
let eventsubReconnectTimer = null;
let eventsubKeepAliveTimer = null;
let eventsubReconnectAttempts = 0;
const MAX_RECONNECT_ATTEMPTS = 5;
const RECONNECT_DELAY_MS = 1000;

/**
 * Show Twitch login window
 * @param {Function} onSuccessCallback - Callback when login is successful
 */
export function showTwitchLoginWindow(onSuccessCallback = null) {
  // If window exists, focus it instead of creating a new one
  if (twitchWindow) {
    twitchWindow.focus();
    return;
  }

  // Generate PKCE values for secure OAuth flow
  generatePKCEValues();
  
  // Start the local auth server to handle redirect
  startAuthServer().then(() => {
    // Create a new window for Twitch login
    twitchWindow = new BrowserWindow({
      width: 500,
      height: 650,
      webPreferences: {
        preload: path.join(__dirname, '..', 'shared', 'twitch-settings-preload', 'index.js'),
        nodeIntegration: false,
        contextIsolation: true,
        devTools: true
      },
      title: 'Twitch Login',
      autoHideMenuBar: true
    });

    // Listen for the window to be closed
    twitchWindow.on('closed', () => {
      twitchWindow = null;
      stopAuthServer();
    });

    // Construct the authorization URL
    const authUrl = buildAuthUrl();
    console.log(`Opening auth URL: ${authUrl}`);

    // Load the Twitch authorization URL
    twitchWindow.loadURL(authUrl);
    
    // Create a promise for auth completion
    const authPromise = new Promise((resolve, reject) => {
      authState.authPromiseResolve = resolve;
      authState.authPromiseReject = reject;
    });
    
    // Handle the auth result
    authPromise.then((tokenData) => {
      // Success case
      console.log('Successfully authenticated with Twitch');
      
      // Get user info
      getUserInfo()
        .then(() => {
          // Refresh token well before it expires
          scheduleTokenRefresh(tokenData.expires_in);
          
          // Notify if callback provided
          if (onSuccessCallback) {
            onSuccessCallback();
          }
          
          // Open the settings window after successful login
          showTwitchSettingsWindow();
        })
        .catch(err => {
          console.error('Error getting user info:', err);
        });
    }).catch((error) => {
      console.error('Authentication failed:', error);
    });
  }).catch(err => {
    console.error('Failed to start auth server:', err);
  });
}

/**
 * Ensure SSL certificates exist or create them
 */
async function ensureCertificates() {
  try {
    // Create directory if it doesn't exist
    await fs.ensureDir(CERT_DIR);
    
    // Check if certificates exist
    if (!(await fs.pathExists(CERT_PATH)) || !(await fs.pathExists(KEY_PATH))) {
      console.log('Generating self-signed SSL certificates...');
      const { cert, key } = await generateSelfSignedCert();
      
      // Save certificates
      await fs.writeFile(CERT_PATH, cert);
      await fs.writeFile(KEY_PATH, key);
      
      console.log('SSL certificates generated and saved');
    }
    
    // Return certificate paths
    return {
      cert: await fs.readFile(CERT_PATH),
      key: await fs.readFile(KEY_PATH)
    };
  } catch (err) {
    console.error('Error ensuring certificates:', err);
    throw err;
  }
}

/**
 * Start a local HTTP server to handle OAuth callback
 */
async function startAuthServer() {
  return new Promise((resolve, reject) => {
    if (authServer) {
      stopAuthServer();
    }
    
    authServer = http.createServer((req, res) => {
      try {
        const parsedUrl = new URL(req.url, `http://localhost:${REDIRECT_PORT}`);
        const pathname = parsedUrl.pathname;
        
        // Handle the callback route
        if (pathname === '/auth/callback') {
          const code = parsedUrl.searchParams.get('code');
          const state = parsedUrl.searchParams.get('state');
          
          // Send a response to the browser
          res.writeHead(200, { 'Content-Type': 'text/html' });
          res.end(`
            <!DOCTYPE html>
            <html>
            <head>
              <title>Authentication Successful</title>
              <style>
                body { 
                  font-family: Arial, sans-serif; 
                  text-align: center;
                  padding-top: 50px;
                  background-color: #18181b;
                  color: #efeff1;
                }
                .success {
                  color: #00ff00;
                  font-size: 24px;
                  margin-bottom: 20px;
                }
                .close {
                  margin-top: 30px;
                  color: #9147ff;
                }
              </style>
            </head>
            <body>
              <div class="success">Authentication Successful!</div>
              <p>You can now close this window and return to the application.</p>
              <p class="close">This window will close automatically in a few seconds.</p>
              <script>
                setTimeout(() => window.close(), 3000);
              </script>
            </body>
            </html>
          `);
          
          // Verify state to prevent CSRF
          if (state !== authState.stateValue) {
            console.error('State mismatch - possible CSRF attack');
            if (authState.authPromiseReject) {
              authState.authPromiseReject(new Error('State mismatch'));
            }
            return;
          }
          
          // Exchange code for token
          if (code) {
            exchangeCodeForToken(code)
              .then(tokenData => {
                // Save tokens securely
                saveTokens(tokenData);
                
                // Close the auth window
                if (twitchWindow) {
                  setTimeout(() => {
                    if (twitchWindow) {
                      twitchWindow.close();
                      twitchWindow = null;
                    }
                  }, 2000);
                }
                
                if (authState.authPromiseResolve) {
                  authState.authPromiseResolve(tokenData);
                }
              })
              .catch(err => {
                console.error('Error exchanging code for token:', err);
                if (authState.authPromiseReject) {
                  authState.authPromiseReject(err);
                }
              });
          }
        }
      } catch (err) {
        console.error('Error handling callback:', err);
        res.writeHead(500, { 'Content-Type': 'text/plain' });
        res.end('Internal Server Error');
      }
    });
    
    // Handle errors
    authServer.on('error', (err) => {
      console.error('Auth server error:', err);
      reject(err);
    });
    
    // Start the server
    authServer.listen(REDIRECT_PORT, () => {
      console.log(`HTTP Auth server listening on port ${REDIRECT_PORT}`);
      resolve();
    });
  });
}

/**
 * Stop the local HTTPS server
 */
function stopAuthServer() {
  if (authServer) {
    authServer.close();
    authServer = null;
    console.log('Auth server stopped');
  }
}

/**
 * Show Twitch settings window
 */
export function showTwitchSettingsWindow() {
  // If window exists, focus it instead of creating a new one
  if (twitchSettingsWindow) {
    twitchSettingsWindow.focus();
    return;
  }
  
  // Check if user is authenticated
  const isAuthenticated = secureStore.has('accessToken');
  
  // Create the settings window
  twitchSettingsWindow = new BrowserWindow({
    width: 600,
    height: 700,
    webPreferences: {
      preload: path.join(__dirname, '..', 'shared', 'twitch-settings-preload', 'index.js'),
      nodeIntegration: false,
      contextIsolation: true
    },
    title: 'Twitch Settings',
    autoHideMenuBar: true
  });
  
  // Load the settings page
  twitchSettingsWindow.loadFile(path.join(__dirname, '..', 'frontend', 'twitch-settings', 'index.html'));
  
  // When content has loaded, send user info and authentication status
  twitchSettingsWindow.webContents.on('did-finish-load', () => {
    // Send authentication status
    twitchSettingsWindow.webContents.send('twitch-auth-status', {
      isAuthenticated,
      channelName: authState.channelName || secureStore.get('channelName'),
      userName: secureStore.get('userName') || null,
      isPollingRewards: authState.isPollingRewards
    });
  });
  
  // Listen for the window to be closed
  twitchSettingsWindow.on('closed', () => {
    twitchSettingsWindow = null;
  });
  
  // Set up IPC handlers for this window
  setupTwitchSettingsHandlers();
}

/**
 * Set up IPC handlers for the Twitch settings window
 */
function setupTwitchSettingsHandlers() {
  // Handle login request
  ipcMain.on('twitch-login', (event) => {
    showTwitchLoginWindow(() => {
      // Send updated auth status after successful login
      if (twitchSettingsWindow) {
        twitchSettingsWindow.webContents.send('twitch-auth-status', {
          isAuthenticated: secureStore.has('accessToken'),
          channelName: authState.channelName || secureStore.get('channelName'),
          userName: secureStore.get('userName') || null,
          isPollingRewards: authState.isPollingRewards
        });
      }
    });
  });
  
  // Handle logout request
  ipcMain.on('twitch-logout', (event) => {
    logoutFromTwitch();
    // Send updated auth status
    if (twitchSettingsWindow) {
      twitchSettingsWindow.webContents.send('twitch-auth-status', {
        isAuthenticated: false,
        channelName: null,
        userName: null,
        isPollingRewards: false
      });
    }
  });
  
  // Handle refresh own channel request
  ipcMain.on('refresh-own-channel', async (event) => {
    try {
      const userName = secureStore.get('userName');
      
      if (!userName) {
        throw new Error('Not authenticated or username not found');
      }
      
      // Get channel ID for the authenticated user
      const channelId = await getChannelIdFromName(userName);
      if (!channelId) {
        throw new Error('Could not find channel for the authenticated user');
      }
      
      // Save channel info
      secureStore.set('channelName', userName);
      secureStore.set('channelId', channelId);
      authState.channelName = userName;
      authState.channelId = channelId;
      authState.isOwnChannel = true;
      
      // Start polling for rewards
      startRewardPolling(channelId);
      
      // Send success response
      if (twitchSettingsWindow) {
        twitchSettingsWindow.webContents.send('channel-setup-result', {
          success: true,
          channelName: userName,
          isOwnChannel: true
        });
      }
      
    } catch (error) {
      console.error('Error refreshing own channel:', error);
      // Send error response
      if (twitchSettingsWindow) {
        twitchSettingsWindow.webContents.send('channel-setup-result', {
          success: false,
          error: error.message
        });
      }
    }
  });
  
  // Handle channel setup request
  ipcMain.on('setup-channel', async (event, channelUrl) => {
    try {
      // Extract channel name from URL
      const channelName = extractChannelFromUrl(channelUrl);
      if (!channelName) {
        throw new Error('Invalid channel URL');
      }
      
      // Get authenticated user info to compare with channel
      const userData = secureStore.get('userName');
      
      // Get channel ID from name
      const channelId = await getChannelIdFromName(channelName);
      if (!channelId) {
        throw new Error('Could not find channel');
      }
      
      // Check if the channel is the user's own channel
      const isOwnChannel = userData.toLowerCase() === channelName.toLowerCase();
      
      if (!isOwnChannel) {
        // Display warning about Twitch API limitation
        if (twitchSettingsWindow) {
          twitchSettingsWindow.webContents.send('channel-setup-result', {
            success: true,
            channelName,
            isOwnChannel: false,
            warning: "NOTE: Due to Twitch API restrictions, you can only track redemptions for your own channel. You'll need to authenticate with the broadcaster's account or use PubSub/EventSub."
          });
        }
      }
      
      // Save channel info
      secureStore.set('channelName', channelName);
      secureStore.set('channelId', channelId);
      authState.channelName = channelName;
      authState.channelId = channelId;
      authState.isOwnChannel = isOwnChannel;
      
      // Start polling for rewards only if it's the user's own channel
      if (isOwnChannel) {
        startRewardPolling(channelId);
      }
      
      // Send success response
      if (twitchSettingsWindow) {
        twitchSettingsWindow.webContents.send('channel-setup-result', {
          success: true,
          channelName,
          isOwnChannel
        });
      }
    } catch (error) {
      console.error('Error setting up channel:', error);
      // Send error response
      if (twitchSettingsWindow) {
        twitchSettingsWindow.webContents.send('channel-setup-result', {
          success: false,
          error: error.message
        });
      }
    }
  });
  
  // Handle poll toggle request
  ipcMain.on('toggle-reward-polling', (event, shouldPoll) => {
    if (shouldPoll) {
      if (authState.channelId) {
        startRewardPolling(authState.channelId);
      } else {
        // Try to get channel ID from store
        const channelId = secureStore.get('channelId');
        if (channelId) {
          authState.channelId = channelId;
          startRewardPolling(channelId);
        }
      }
    } else {
      stopRewardPolling();
    }
    
    // Update status
    if (twitchSettingsWindow) {
      twitchSettingsWindow.webContents.send('polling-status-change', {
        isPolling: authState.isPollingRewards
      });
    }
  });
  
  // Add new handlers for reward configuration
  ipcMain.on('get-rewards-list', async (event) => {
    try {
      const rewards = await refreshRewardsList();
      if (twitchSettingsWindow) {
        twitchSettingsWindow.webContents.send('rewards-updated', getAllRewards());
      }
    } catch (error) {
      console.error('Error getting rewards list:', error);
      if (twitchSettingsWindow) {
        twitchSettingsWindow.webContents.send('rewards-error', {error: error.message});
      }
    }
  });
  
  ipcMain.on('save-reward-config', (event, {rewardId, config}) => {
    saveRewardConfig(rewardId, config);
  });
  
  ipcMain.on('delete-reward-config', (event, {rewardId}) => {
    deleteRewardConfig(rewardId);
  });
  
  // Handle test reward event
  ipcMain.on('test-reward', (event, reward) => {
    if (!reward || !reward.isConfigured || !reward.config) {
      console.log('Cannot test: reward is not configured');
      return;
    }
    
    console.log(`Testing reward: ${reward.title}`);
    
    // Create a mock redemption object
    const mockRedemption = {
      id: `test-${Date.now()}`,
      user_id: 'test-user-id',
      user_name: 'TestUser',
      user_input: 'This is a test redemption',
      status: 'UNFULFILLED',
      reward: {
        id: reward.id,
        title: reward.title,
        prompt: reward.prompt,
        cost: reward.cost
      },
      redeemed_at: new Date().toISOString()
    };
    
    // Call the reward redeemed handlers with the mock redemption
    notifyRewardRedeemed(mockRedemption, reward.config);
  });

  // Handle file dialog for media selection
  ipcMain.on('open-media-file-dialog', (event) => {
    dialog.showOpenDialog({
      properties: ['openFile'],
      filters: [
        { name: 'Media Files', extensions: ['jpg', 'jpeg', 'png', 'gif', 'mp4', 'webm'] }
      ],
      title: 'Select Media File'
    }).then(result => {
      if (!result.canceled && result.filePaths.length > 0) {
        event.sender.send('selected-media-file', result.filePaths[0]);
      }
    }).catch(err => {
      console.error('Error opening file dialog:', err);
    });
  });
}

/**
 * Generate PKCE values for secure OAuth
 */
function generatePKCEValues() {
  // Generate code verifier (random string)
  authState.verifier = randomBytes(32).toString('base64url');
  
  // Generate code challenge (SHA256 hash of verifier)
  authState.challenge = authState.verifier; // In a real app, hash this with SHA256
  
  // Generate random state value to prevent CSRF
  authState.stateValue = randomBytes(16).toString('hex');
}

/**
 * Build the Twitch authorization URL
 */
function buildAuthUrl() {
  const params = new URLSearchParams({
    client_id: TWITCH_CLIENT_ID,
    redirect_uri: TWITCH_REDIRECT_URI,
    response_type: 'code',
    scope: 'user:read:email channel:read:redemptions channel:manage:redemptions channel:read:subscriptions',
    state: authState.stateValue,
    code_challenge: authState.challenge,
    code_challenge_method: 'plain', // Should be 'S256' in production
    force_verify: 'true' // Force the user to re-verify their identity
  });
  
  return `https://id.twitch.tv/oauth2/authorize?${params.toString()}`;
}

/**
 * Exchange authorization code for access token
 */
async function exchangeCodeForToken(code) {
  const params = new URLSearchParams({
    client_id: TWITCH_CLIENT_ID,
    client_secret: TWITCH_CLIENT_SECRET,
    code,
    grant_type: 'authorization_code',
    redirect_uri: TWITCH_REDIRECT_URI,
    code_verifier: authState.verifier
  });
  
  console.log('Exchanging code for token...');
  
  try {
    const response = await fetch('https://id.twitch.tv/oauth2/token', {
      method: 'POST',
      body: params,
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded'
      }
    });
    
    const data = await response.json();
    
    if (!response.ok) {
      console.error('Token exchange error:', data);
      throw new Error(`HTTP error! status: ${response.status}, message: ${JSON.stringify(data)}`);
    }
    
    return data;
  } catch (err) {
    console.error('Error in token exchange:', err);
    throw err;
  }
}

/**
 * Save authentication tokens securely
 */
function saveTokens(tokenData) {
  secureStore.set('accessToken', tokenData.access_token);
  secureStore.set('refreshToken', tokenData.refresh_token);
  secureStore.set('tokenExpiresAt', Date.now() + (tokenData.expires_in * 1000));
}

/**
 * Get user information from Twitch API
 */
async function getUserInfo() {
  const accessToken = secureStore.get('accessToken');
  
  if (!accessToken) {
    throw new Error('Not authenticated');
  }
  
  const response = await fetch('https://api.twitch.tv/helix/users', {
    headers: {
      'Authorization': `Bearer ${accessToken}`,
      'Client-Id': TWITCH_CLIENT_ID
    }
  });
  
  if (!response.ok) {
    throw new Error(`HTTP error! status: ${response.status}`);
  }
  
  const data = await response.json();
  const user = data.data[0];
  
  // Save user info
  secureStore.set('userId', user.id);
  secureStore.set('userName', user.login);
  secureStore.set('userDisplayName', user.display_name);
  
  return user;
}

/**
 * Refresh access token before it expires
 */
function scheduleTokenRefresh(expiresIn) {
  // Refresh token 10 minutes before it expires
  const refreshTime = (expiresIn - 600) * 1000;
  
  setTimeout(() => {
    refreshAccessToken();
  }, refreshTime);
}

/**
 * Refresh the access token using the refresh token
 */
async function refreshAccessToken() {
  const refreshToken = secureStore.get('refreshToken');
  
  if (!refreshToken) {
    console.error('No refresh token found');
    return false;
  }
  
  try {
    const params = new URLSearchParams({
      client_id: TWITCH_CLIENT_ID,
      client_secret: TWITCH_CLIENT_SECRET,
      grant_type: 'refresh_token',
      refresh_token: refreshToken
    });
    
    console.log('Refreshing access token...');
    
    const response = await fetch('https://id.twitch.tv/oauth2/token', {
      method: 'POST',
      body: params,
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded'
      }
    });
    
    const data = await response.json();
    
    if (!response.ok) {
      console.error('Token refresh error:', data);
      throw new Error(`HTTP error! status: ${response.status}, message: ${JSON.stringify(data)}`);
    }
    
    // Save new tokens
    saveTokens(data);
    
    // Schedule next refresh
    scheduleTokenRefresh(data.expires_in);
    
    console.log('Successfully refreshed access token');
    return true;
  } catch (error) {
    console.error('Error refreshing token:', error);
    return false;
  }
}

/**
 * Logout from Twitch
 */
function logoutFromTwitch() {
  // Clear stored tokens and user info
  secureStore.delete('accessToken');
  secureStore.delete('refreshToken');
  secureStore.delete('tokenExpiresAt');
  secureStore.delete('userId');
  secureStore.delete('userName');
  secureStore.delete('userDisplayName');
  
  // Stop any active polling
  stopRewardPolling();
  
  // Reset auth state
  authState.channelId = null;
  authState.channelName = null;
  
  console.log('Logged out from Twitch');
}

/**
 * Extract channel name from Twitch URL
 */
function extractChannelFromUrl(url) {
  try {
    const urlObj = new URL(url);
    
    // Handle different URL formats
    if (urlObj.hostname === 'twitch.tv' || urlObj.hostname === 'www.twitch.tv') {
      // Format: https://twitch.tv/channelname
      const pathParts = urlObj.pathname.split('/').filter(Boolean);
      if (pathParts.length > 0) {
        return pathParts[0].toLowerCase();
      }
    }
    
    return null;
  } catch (error) {
    // If the input isn't a valid URL, check if it might be just a channel name
    const possibleChannelName = url.trim().toLowerCase();
    if (/^[a-z0-9_]{4,25}$/.test(possibleChannelName)) {
      return possibleChannelName;
    }
    
    return null;
  }
}

/**
 * Get channel ID from channel name
 */
async function getChannelIdFromName(channelName) {
  const accessToken = secureStore.get('accessToken');
  
  if (!accessToken) {
    throw new Error('Not authenticated');
  }
  
  const response = await fetch(`https://api.twitch.tv/helix/users?login=${channelName}`, {
    headers: {
      'Authorization': `Bearer ${accessToken}`,
      'Client-Id': TWITCH_CLIENT_ID
    }
  });
  
  if (!response.ok) {
    throw new Error(`HTTP error! status: ${response.status}`);
  }
  
  const data = await response.json();
  
  if (data.data.length === 0) {
    return null;
  }
  
  return data.data[0].id;
}

/**
 * Check for new channel point redemptions
 */
async function checkChannelPointRedemptions(channelId) {
  // This function is no longer needed as we're using EventSub instead of polling
  // But we'll keep it as a fallback and for initial sync
  const accessToken = secureStore.get('accessToken');
  
  if (!accessToken) {
    throw new Error('Not authenticated');
  }
  
  // Get any existing unfulfilled redemptions
  const response = await fetch(`https://api.twitch.tv/helix/channel_points/custom_rewards/redemptions?broadcaster_id=${channelId}&status=UNFULFILLED`, {
    headers: {
      'Authorization': `Bearer ${accessToken}`,
      'Client-Id': TWITCH_CLIENT_ID
    }
  });
  
  if (!response.ok) {
    throw new Error(`HTTP error! status: ${response.status}`);
  }
  
  const data = await response.json();
  
  // Process redemptions
  processRedemptions(data.data || []);
}

/**
 * Start polling for channel point redemptions
 */
function startRewardPolling(channelId) {
  // Stop any existing polling or EventSub connection
  stopRewardPolling();
  
  console.log(`Starting EventSub connection for channel ID: ${channelId}`);
  
  // Set polling state
  authState.isPollingRewards = true;
  
  // Do an initial check for unfulfilled redemptions
  checkChannelPointRedemptions(channelId).catch(error => {
    console.error('Error in initial reward check:', error);
  });
  
  // Connect to EventSub WebSocket
  connectToEventSub(channelId);
  
  // Set up hourly refresh for rewards list
  scheduleHourlyRewardRefresh(channelId);
}

/**
 * Stop polling for channel point redemptions
 */
function stopRewardPolling() {
  if (authState.pollingInterval) {
    clearInterval(authState.pollingInterval);
    authState.pollingInterval = null;
  }
  
  if (hourlyRefreshTimer) {
    clearTimeout(hourlyRefreshTimer);
    hourlyRefreshTimer = null;
  }
  
  // Disconnect from EventSub if connected
  disconnectFromEventSub();
  
  authState.isPollingRewards = false;
  console.log('Stopped reward polling and EventSub connection');
}

/**
 * Connect to Twitch EventSub WebSocket
 */
async function connectToEventSub(channelId) {
  try {
    // Reset reconnect attempts when initiating a new connection
    eventsubReconnectAttempts = 0;
    
    // Create WebSocket connection to Twitch EventSub
    eventsubSocket = new WebSocket('wss://eventsub.wss.twitch.tv/ws');
    
    eventsubSocket.on('open', () => {
      console.log('EventSub WebSocket connection established');
    });
    
    eventsubSocket.on('message', (data) => {
      handleEventSubMessage(data, channelId);
    });
    
    eventsubSocket.on('close', (code, reason) => {
      console.log(`EventSub WebSocket closed: ${code} - ${reason}`);
      handleEventSubReconnect(channelId);
    });
    
    eventsubSocket.on('error', (error) => {
      console.error('EventSub WebSocket error:', error);
      // Socket will close after an error, triggering the close handler
    });
  } catch (error) {
    console.error('Error connecting to EventSub:', error);
    handleEventSubReconnect(channelId);
  }
}

/**
 * Disconnect from Twitch EventSub WebSocket
 */
function disconnectFromEventSub() {
  // Clear any timers
  if (eventsubKeepAliveTimer) {
    clearTimeout(eventsubKeepAliveTimer);
    eventsubKeepAliveTimer = null;
  }
  
  if (eventsubReconnectTimer) {
    clearTimeout(eventsubReconnectTimer);
    eventsubReconnectTimer = null;
  }
  
  // Reset session ID
  eventsubSessionId = null;
  
  // Close socket if open
  if (eventsubSocket && eventsubSocket.readyState === WebSocket.OPEN) {
    eventsubSocket.close();
    eventsubSocket = null;
    console.log('EventSub WebSocket disconnected');
  }
}

/**
 * Handle EventSub WebSocket reconnect
 */
function handleEventSubReconnect(channelId) {
  // Clear any existing timers
  if (eventsubKeepAliveTimer) {
    clearTimeout(eventsubKeepAliveTimer);
    eventsubKeepAliveTimer = null;
  }
  
  if (eventsubReconnectTimer) {
    clearTimeout(eventsubReconnectTimer);
  }
  
  // Increase reconnect attempts
  eventsubReconnectAttempts++;
  
  // Check if we've exceeded max attempts
  if (eventsubReconnectAttempts > MAX_RECONNECT_ATTEMPTS) {
    console.error(`Failed to reconnect to EventSub after ${MAX_RECONNECT_ATTEMPTS} attempts`);
    stopRewardPolling();
    return;
  }
  
  // Schedule reconnect with exponential backoff
  const delay = RECONNECT_DELAY_MS * Math.pow(2, eventsubReconnectAttempts - 1);
  console.log(`Scheduling EventSub reconnect in ${delay}ms (attempt ${eventsubReconnectAttempts})`);
  
  eventsubReconnectTimer = setTimeout(() => {
    connectToEventSub(channelId);
  }, delay);
}

/**
 * Handle EventSub WebSocket messages
 */
function handleEventSubMessage(message, channelId) {
  try {
    const data = JSON.parse(message);
    const messageType = data.metadata?.message_type;
    
    console.log(`Received EventSub message: ${messageType}`);
    
    switch (messageType) {
      case 'session_welcome':
        handleWelcomeMessage(data, channelId);
        break;
      
      case 'notification':
        handleNotificationMessage(data);
        break;
      
      case 'session_keepalive':
        handleKeepAliveMessage();
        break;
      
      case 'session_reconnect':
        handleReconnectMessage(data);
        break;
      
      case 'revocation':
        handleRevocationMessage(data);
        break;
      
      default:
        console.log(`Unknown EventSub message type: ${messageType}`, data);
    }
  } catch (error) {
    console.error('Error processing EventSub message:', error);
  }
}

/**
 * Handle EventSub welcome message
 */
async function handleWelcomeMessage(data, channelId) {
  // Store the session ID
  eventsubSessionId = data.payload.session.id;
  console.log(`EventSub session established: ${eventsubSessionId}`);
  
  // Reset the reconnect attempts as we've successfully connected
  eventsubReconnectAttempts = 0;
  
  // Set up keep-alive timeout
  setupKeepAliveTimeout(data.payload.session.keepalive_timeout_seconds);
  
  // Subscribe to channel point redemptions
  try {
    await subscribeToChannelPointRedemptions(channelId);
  } catch (error) {
    console.error('Error subscribing to channel point redemptions:', error);
  }
}

/**
 * Setup keep-alive timeout to detect when socket should be considered dead
 */
function setupKeepAliveTimeout(timeoutSeconds) {
  const timeoutMs = timeoutSeconds * 1000;
  
  if (eventsubKeepAliveTimer) {
    clearTimeout(eventsubKeepAliveTimer);
  }
  
  eventsubKeepAliveTimer = setTimeout(() => {
    console.log(`EventSub keep-alive timeout exceeded (${timeoutSeconds}s), reconnecting...`);
    if (eventsubSocket && eventsubSocket.readyState === WebSocket.OPEN) {
      console.log('Closing stale EventSub connection');
      eventsubSocket.close(1000, 'Keepalive timeout exceeded');
      // The close handler will trigger reconnect
    } else if (eventsubSocket) {
      console.log(`Socket already in state: ${eventsubSocket.readyState}`);
      // Force reconnect if socket is in a weird state
      handleEventSubReconnect(authState.channelId);
    } else {
      console.log('No active socket found, initiating reconnect');
      connectToEventSub(authState.channelId);
    }
  }, timeoutMs);
  
  // Log when we expect the timeout to trigger
  const timeoutTime = new Date(Date.now() + timeoutMs);
  console.log(`Keepalive timeout set for: ${timeoutTime.toISOString()}`);
}

/**
 * Handle EventSub keep-alive message
 */
function handleKeepAliveMessage() {
  console.log('Received EventSub keep-alive message, resetting timeout');
  
  // Reset the keep-alive timer
  if (eventsubKeepAliveTimer) {
    clearTimeout(eventsubKeepAliveTimer);
  }
  
  // Set up a new keep-alive timeout (Twitch sends keepalive every 10 seconds)
  const keepaliveTimeoutSeconds = 15; // We'll use 15 seconds as timeout (5s buffer)
  setupKeepAliveTimeout(keepaliveTimeoutSeconds);
  
  // Log the next expected keepalive time
  const nextKeepaliveTime = new Date(Date.now() + (10 * 1000));
  console.log(`Next expected keepalive around: ${nextKeepaliveTime.toISOString()}`);
}

/**
 * Handle EventSub reconnect message
 */
function handleReconnectMessage(data) {
  const newSessionUrl = data.payload.session.reconnect_url;
  console.log(`EventSub session requires reconnect to: ${newSessionUrl}`);
  
  // Close current socket
  if (eventsubSocket) {
    eventsubSocket.close();
  }
  
  // Connect to the new URL
  eventsubSocket = new WebSocket(newSessionUrl);
  
  // Set up the same event handlers
  eventsubSocket.on('open', () => {
    console.log('EventSub WebSocket reconnected successfully');
  });
  
  eventsubSocket.on('message', (data) => {
    handleEventSubMessage(data, authState.channelId);
  });
  
  eventsubSocket.on('close', (code, reason) => {
    console.log(`EventSub WebSocket closed: ${code} - ${reason}`);
    handleEventSubReconnect(authState.channelId);
  });
  
  eventsubSocket.on('error', (error) => {
    console.error('EventSub WebSocket error:', error);
  });
}

/**
 * Handle EventSub revocation message
 */
function handleRevocationMessage(data) {
  const subscription = data.payload.subscription;
  console.log(`EventSub subscription revoked: ${subscription.type}, reason: ${data.payload.limit}`, subscription);
  
  // If it's our redemption subscription, try to resubscribe
  if (subscription.type === 'channel.channel_points_custom_reward_redemption.add') {
    subscribeToChannelPointRedemptions(authState.channelId)
      .catch(error => {
        console.error('Error resubscribing to channel point redemptions:', error);
      });
  }
}

/**
 * Handle EventSub notification message
 */
function handleNotificationMessage(data) {
  const eventType = data.metadata.subscription_type;
  const event = data.payload.event;
  
  console.log(`Received ${eventType} event:`, event);
  
  switch (eventType) {
    case 'channel.channel_points_custom_reward_redemption.add':
      handleRedemptionEvent(event);
      break;
    
    default:
      console.log(`Unhandled EventSub notification type: ${eventType}`);
  }
}

/**
 * Handle redemption event from EventSub
 */
function handleRedemptionEvent(event) {
  // Create a redemption object in the format expected by our existing code
  const redemption = {
    id: event.id,
    user_id: event.user_id,
    user_name: event.user_name,
    user_input: event.user_input,
    status: event.status,
    reward: {
      id: event.reward.id,
      title: event.reward.title,
      prompt: event.reward.prompt,
      cost: event.reward.cost
    },
    redeemed_at: event.redeemed_at
  };
  
  // Check if this reward is configured
  const rewardId = redemption.reward.id;
  if (configuredRewards[rewardId]) {
    console.log(`Processing redemption for configured reward: ${redemption.reward.title}`);
    notifyRewardRedeemed(redemption, configuredRewards[rewardId]);
  }
}

/**
 * Subscribe to channel point redemptions via EventSub API
 */
async function subscribeToChannelPointRedemptions(channelId) {
  if (!eventsubSessionId) {
    throw new Error('No EventSub session established');
  }
  
  const accessToken = secureStore.get('accessToken');
  if (!accessToken) {
    throw new Error('Not authenticated');
  }
  
  console.log(`Subscribing to channel point redemptions for channel ID: ${channelId}`);
  
  const subscriptionData = {
    type: 'channel.channel_points_custom_reward_redemption.add',
    version: '1',
    condition: {
      broadcaster_user_id: channelId
    },
    transport: {
      method: 'websocket',
      session_id: eventsubSessionId
    }
  };
  
  const response = await fetch('https://api.twitch.tv/helix/eventsub/subscriptions', {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${accessToken}`,
      'Client-Id': TWITCH_CLIENT_ID,
      'Content-Type': 'application/json'
    },
    body: JSON.stringify(subscriptionData)
  });
  
  if (!response.ok) {
    const errorData = await response.json();
    console.error('EventSub subscription error:', errorData);
    throw new Error(`HTTP error! status: ${response.status} - ${JSON.stringify(errorData)}`);
  }
  
  const data = await response.json();
  console.log('Successfully subscribed to channel point redemptions:', data);
  return data;
}

/**
 * Process rewards and notify listeners
 */
function processRedemptions(redemptions) {
  // If no redemptions, nothing to process
  if (!redemptions || redemptions.length === 0) return;
  
  console.log(`Found ${redemptions.length} redemptions to process`);
  
  // Process each redemption
  redemptions.forEach(redemption => {
    // Only process redemptions for configured rewards
    const rewardId = redemption.reward.id;
    if (configuredRewards[rewardId]) {
      console.log(`Processing redemption for configured reward: ${redemption.reward.title}`);
      notifyRewardRedeemed(redemption, configuredRewards[rewardId]);
    }
  });
}

/**
 * Add a listener for reward redemptions
 */
export function addRewardListener(listener) {
  eventListeners.add(listener);
}

/**
 * Remove a listener for reward redemptions
 */
export function removeRewardListener(listener) {
  eventListeners.delete(listener);
}

/**
 * Notify all listeners of a reward redemption
 */
function notifyRewardRedeemed(redemption, config) {
  eventListeners.forEach(listener => {
    try {
      listener({redemption, config});
    } catch (error) {
      console.error('Error in reward listener:', error);
    }
  });
}

/**
 * Initialize the Twitch module
 */
export function initializeTwitchModule() {
  // Check if we have a stored token and it's not expired
  const accessToken = secureStore.get('accessToken');
  const tokenExpiresAt = secureStore.get('tokenExpiresAt');
  
  if (accessToken && tokenExpiresAt) {
    // If token is expired or about to expire, refresh it
    if (Date.now() >= tokenExpiresAt - 600000) {
      refreshAccessToken();
    } else {
      // Schedule refresh for later
      const refreshIn = tokenExpiresAt - Date.now() - 600000;
      setTimeout(() => {
        refreshAccessToken();
      }, refreshIn);
    }
    
    // Restore channel ID if available
    const channelId = secureStore.get('channelId');
    const channelName = secureStore.get('channelName');
    
    if (channelId && channelName) {
      authState.channelId = channelId;
      authState.channelName = channelName;
    }
  }
  
  // Load configured rewards
  const savedConfiguredRewards = secureStore.get('configuredRewards');
  if (savedConfiguredRewards) {
    configuredRewards = savedConfiguredRewards;
  }
}

/**
 * Get configured rewards
 */
export function getConfiguredRewards() {
  return configuredRewards;
}

/**
 * Save reward configuration
 */
export function saveRewardConfig(rewardId, config) {
  configuredRewards[rewardId] = config;
  secureStore.set('configuredRewards', configuredRewards);
  
  // Emit event to update UI if settings window is open
  if (twitchSettingsWindow) {
    twitchSettingsWindow.webContents.send('rewards-updated', getAllRewards());
  }
}

/**
 * Delete reward configuration
 */
export function deleteRewardConfig(rewardId) {
  if (configuredRewards[rewardId]) {
    delete configuredRewards[rewardId];
    secureStore.set('configuredRewards', configuredRewards);
    
    // Emit event to update UI if settings window is open
    if (twitchSettingsWindow) {
      twitchSettingsWindow.webContents.send('rewards-updated', getAllRewards());
    }
  }
}

// Keep track of available rewards
let availableRewards = [];

/**
 * Get all rewards
 */
export function getAllRewards() {
  return availableRewards.map(reward => {
    return {
      ...reward,
      isConfigured: !!configuredRewards[reward.id],
      config: configuredRewards[reward.id]
    };
  });
}

/**
 * Schedule hourly reward refresh
 */
function scheduleHourlyRewardRefresh(channelId) {
  // Clear any existing timer
  if (hourlyRefreshTimer) {
    clearTimeout(hourlyRefreshTimer);
  }
  
  // Set the last refresh time if not set
  if (!authState.lastRewardRefresh) {
    authState.lastRewardRefresh = Date.now();
  }
  
  // Schedule next refresh
  const hourInMs = 60 * 60 * 1000;
  const timeSinceLastRefresh = Date.now() - authState.lastRewardRefresh;
  const timeToNextRefresh = Math.max(0, hourInMs - timeSinceLastRefresh);
  
  hourlyRefreshTimer = setTimeout(async () => {
    console.log('Performing hourly reward list refresh');
    try {
      await refreshRewardsList(channelId);
      // Schedule next refresh
      scheduleHourlyRewardRefresh(channelId);
    } catch (error) {
      console.error('Error in hourly reward refresh:', error);
    }
  }, timeToNextRefresh);
}

/**
 * Refresh rewards list
 */
export async function refreshRewardsList(channelId = null) {
  channelId = channelId || authState.channelId || secureStore.get('channelId');
  if (!channelId) {
    throw new Error('No channel ID available');
  }
  
  const accessToken = secureStore.get('accessToken');
  if (!accessToken) {
    throw new Error('Not authenticated');
  }
  
  console.log(`Refreshing rewards list for channel ID: ${channelId}`);
  
  const response = await fetch(`https://api.twitch.tv/helix/channel_points/custom_rewards?broadcaster_id=${channelId}`, {
    headers: {
      'Authorization': `Bearer ${accessToken}`,
      'Client-Id': TWITCH_CLIENT_ID
    }
  });
  
  if (!response.ok) {
    throw new Error(`HTTP error! status: ${response.status}`);
  }
  
  const data = await response.json();
  availableRewards = data.data || [];
  authState.lastRewardRefresh = Date.now();
  
  // Notify UI if settings window is open
  if (twitchSettingsWindow) {
    twitchSettingsWindow.webContents.send('rewards-updated', getAllRewards());
  }
  
  console.log(`Found ${availableRewards.length} rewards for the channel`);
  return availableRewards;
}