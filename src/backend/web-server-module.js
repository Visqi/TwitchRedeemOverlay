import express from 'express';
import { Server as SocketIOServer } from 'socket.io';
import http from 'http';
import path from 'path';
import fs from 'fs-extra';
import { __dirname } from './utils.js';

// Web server configuration
const DEFAULT_PORT = 9000;
let serverPort = DEFAULT_PORT;
let server = null;
let io = null;
let app = null;
let isRunning = false;
let connectedClients = 0;
let webAudioMuted = false; // Tracking mute state for web clients

// Track local file paths for serving content
const localFilesMap = new Map();
let fileIdCounter = 1;

// Get overlay HTML content
function getOverlayHtml() {
  const overlayPath = path.join(__dirname, '..', 'frontend', 'overlay', 'index.html');
  let content = fs.readFileSync(overlayPath, 'utf8');
  
  // Modify the HTML to include socket.io client
  const headEnd = '</head>';
  const socketIoScript = '<script src="/socket.io/socket.io.js"></script>\n' +
    '<script>\n' +
    '  const socket = io();\n' +
    '  // Replace the electron API with a socket.io implementation\n' +
    '  window.electron = {\n' +
    '    receive: (channel, func) => {\n' +
    '      socket.on(channel, func);\n' +
    '    },\n' +
    '    send: (channel, data) => {\n' +
    '      socket.emit(channel, data);\n' +
    '    }\n' +
    '  };\n' +
    '  \n' +
    '  // Handle audio muting for web clients\n' +
    '  socket.on("toggle-web-audio", (muted) => {\n' +
    '    document.querySelectorAll("video, audio").forEach(el => {\n' +
    '      el.muted = muted;\n' +
    '    });\n' +
    '    // Store preference for future media elements\n' +
    '    window.webAudioMuted = muted;\n' +
    '  });\n' +
    '  \n' +
    '  // Apply mute settings to any new media elements\n' +
    '  const originalCreateElement = document.createElement;\n' +
    '  document.createElement = function(tagName) {\n' +
    '    const element = originalCreateElement.call(document, tagName);\n' +
    '    if ((tagName.toLowerCase() === "video" || tagName.toLowerCase() === "audio") && window.webAudioMuted) {\n' +
    '      element.muted = true;\n' +
    '    }\n' +
    '    return element;\n' +
    '  };\n' +
    '</script>\n';
  
  content = content.replace(headEnd, socketIoScript + headEnd);
  
  return content;
}

// Initialize the web server
export function initWebServer(port = DEFAULT_PORT) {
  if (isRunning) {
    console.log(`Web server already running on port ${serverPort}`);
    return { success: true, port: serverPort };
  }
  
  try {
    serverPort = port;
    app = express();
    server = http.createServer(app);
    io = new SocketIOServer(server);
    
    // Serve the modified overlay HTML
    app.get('/', (req, res) => {
      res.setHeader('Cache-Control', 'no-store, no-cache, must-revalidate, proxy-revalidate');
      res.setHeader('Pragma', 'no-cache');
      res.setHeader('Expires', '0');
      res.setHeader('Surrogate-Control', 'no-store');
      res.send(getOverlayHtml());
    });
    
    // Serve static files from the frontend directory
    app.use(express.static(path.join(__dirname, '..', 'frontend')));
    
    // Create a special route for serving overlay media files
    app.get('/overlay-media/:id', (req, res) => {
      const fileId = req.params.id;
      const filePath = localFilesMap.get(fileId);
      
      if (!filePath) {
        console.error(`File not found for ID: ${fileId}`);
        return res.status(404).send('File not found');
      }
      
      try {
        // Determine content type based on file extension
        const ext = path.extname(filePath).toLowerCase();
        let contentType;
        
        switch (ext) {
          case '.png':
            contentType = 'image/png';
            break;
          case '.jpg':
          case '.jpeg':
            contentType = 'image/jpeg';
            break;
          case '.gif':
            contentType = 'image/gif';
            break;
          case '.mp4':
            contentType = 'video/mp4';
            break;
          case '.webm':
            contentType = 'video/webm';
            break;
          case '.mov':
            contentType = 'video/quicktime';
            break;
          default:
            contentType = 'application/octet-stream';
        }
        
        res.setHeader('Content-Type', contentType);
        res.setHeader('Cache-Control', 'no-cache, must-revalidate'); // Added cache control
        
        // Stream the file to the client
        const fileStream = fs.createReadStream(filePath);
        fileStream.pipe(res);
        
      } catch (err) {
        console.error(`Error sending file ${filePath}:`, err);
        res.status(500).send('Error sending file');
      }
    });
    
    // WebSocket connection handling
    io.on('connection', (socket) => {
      console.log('New web client connected');
      connectedClients++;
      
      // Send current audio mute state to new clients
      socket.emit('toggle-web-audio', webAudioMuted);
      
      // Listen for overlay-item-completed events from clients
      socket.on('overlay-item-completed', () => {
        console.log('Web client reported overlay item completed');
        // We'll relay this to the main process to continue the queue
        global.webClientCompletedOverlay && global.webClientCompletedOverlay();
      });
      
      // Handle disconnection
      socket.on('disconnect', () => {
        console.log('Web client disconnected');
        connectedClients--;
      });
    });
    
    // Start the server
    server.listen(serverPort, () => {
      isRunning = true;
      console.log(`Web server started on port ${serverPort}`);
    });
    
    return { success: true, port: serverPort };
  } catch (err) {
    console.error('Failed to start web server:', err);
    return { success: false, error: err.message };
  }
}

// Stop the web server
export function stopWebServer() {
  if (!isRunning) {
    console.log('Web server is not running');
    return { success: true };
  }
  
  try {
    io.close();
    server.close();
    isRunning = false;
    connectedClients = 0;
    console.log('Web server stopped');
    
    // Clear local files mapping
    localFilesMap.clear();
    fileIdCounter = 1;
    
    return { success: true };
  } catch (err) {
    console.error('Failed to stop web server:', err);
    return { success: false, error: err.message };
  }
}

// Toggle web audio mute state
export function toggleWebAudioMute(muted) {
  webAudioMuted = muted;
  if (isRunning && io) {
    io.emit('toggle-web-audio', webAudioMuted);
    console.log(`Web audio ${webAudioMuted ? 'muted' : 'unmuted'}`);
    return true;
  }
  return false;
}

// Get current web audio mute state
export function getWebAudioMuteState() {
  return webAudioMuted;
}

// Register a local file to make it accessible via the web server
function registerLocalFile(localPath) {
  // If already registered, return existing ID
  for (const [id, path] of localFilesMap.entries()) {
    if (path === localPath) {
      return id;
    }
  }
  
  // Create a new ID for this file
  const fileId = `file${fileIdCounter++}`;
  localFilesMap.set(fileId, localPath);
  return fileId;
}

// Send overlay data to web clients
export function sendOverlayToWebClients(overlayData) {
  if (!isRunning || !io) {
    return false;
  }
  
  try {
    // Make a copy of the data so we don't modify the original
    const webOverlayData = { ...overlayData };
    
    // Convert local file paths to web-accessible URLs
    if (webOverlayData.path && !webOverlayData.path.startsWith('http')) {
      // Register the file with our server
      const fileId = registerLocalFile(webOverlayData.path);
      // Replace the path with a web URL
      webOverlayData.path = `/overlay-media/${fileId}`;
    }
    
    console.log(`Sending overlay data to ${connectedClients} web client(s)`);
    io.emit('display-overlay', webOverlayData);
    return true;
  } catch (err) {
    console.error('Error sending overlay data to web clients:', err);
    return false;
  }
}

// Get server status
export function getWebServerStatus() {
  return {
    isRunning,
    port: serverPort,
    url: isRunning ? `http://localhost:${serverPort}` : null,
    connectedClients,
    webAudioMuted
  };
}

// Change the server port
export function changeServerPort(newPort) {
  if (isRunning) {
    const stopResult = stopWebServer();
    if (!stopResult.success) {
      return { success: false, error: 'Failed to stop the server before changing port' };
    }
  }
  
  return initWebServer(newPort);
}