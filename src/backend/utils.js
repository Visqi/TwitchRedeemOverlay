import path from 'path';
import { fileURLToPath } from 'url';
import fs from 'fs-extra';
import fetch from 'node-fetch';
import crypto from 'crypto';
import os from 'os';
import CryptoJS from 'crypto-js';

// Get dirname equivalent in ES modules
const __filename = fileURLToPath(import.meta.url);
export const __dirname = path.dirname(__filename);

// Encryption key - in production, you'd want to store this more securely
export const ENCRYPTION_KEY = 'twitch-redemption-overlay-secret-key';

// Cache directory for downloaded files
export const CACHE_DIR = path.join(os.tmpdir(), 'twitch-redeem-overlay-cache');

// Create cache directory if it doesn't exist
if (!fs.existsSync(CACHE_DIR)) {
  fs.mkdirSync(CACHE_DIR, { recursive: true });
}

// Map to track cached files
export const fileCache = new Map();

// Function to encrypt sensitive data
export function encryptData(data) {
  return CryptoJS.AES.encrypt(JSON.stringify(data), ENCRYPTION_KEY).toString();
}

// Function to decrypt sensitive data
export function decryptData(encryptedData) {
  if (!encryptedData) return null;
  try {
    const bytes = CryptoJS.AES.decrypt(encryptedData, ENCRYPTION_KEY);
    return JSON.parse(bytes.toString(CryptoJS.enc.Utf8));
  } catch (error) {
    console.error('Failed to decrypt data:', error);
    return null;
  }
}

// Function to download and cache a file
export async function downloadAndCacheFile(url) {
  try {
    // Generate a unique hash for the URL
    const fileHash = crypto.createHash('md5').update(url).digest('hex');
    
    // Check if file is already cached
    if (fileCache.has(fileHash)) {
      console.log(`Using cached file for: ${url}`);
      return fileCache.get(fileHash);
    }
    
    console.log(`Downloading file: ${url}`);
    
    // Parse URL to get file extension
    const urlObj = new URL(url);
    const pathParts = urlObj.pathname.split('.');
    const extension = pathParts.length > 1 ? pathParts.pop().toLowerCase() : '';
    
    // Create unique local path for the file
    const localFilePath = path.join(CACHE_DIR, `${fileHash}.${extension}`);
    
    // Fetch the file
    const response = await fetch(url);
    if (!response.ok) {
      throw new Error(`Failed to download: ${response.statusText}`);
    }
    
    // Save to disk
    const fileBuffer = await response.buffer();
    await fs.writeFile(localFilePath, fileBuffer);
    
    // Store in cache
    fileCache.set(fileHash, localFilePath);
    
    return localFilePath;
  } catch (err) {
    console.error('Failed to download file:', err);
    return null;
  }
}

// Clear the file cache
export async function clearFileCache() {
  try {
    // Clear the cache map
    fileCache.clear();
    
    // Remove all files from cache directory
    await fs.emptyDir(CACHE_DIR);
    console.log('Cache cleared successfully');
    return true;
  } catch (err) {
    console.error('Failed to clear cache:', err);
    return false;
  }
}

// Function to calculate appropriate dimensions based on screen size
export function calculateDimensions(originalWidth, originalHeight, screenWidth, screenHeight) {
  // If dimensions are specified, use them
  if (originalWidth && originalHeight) {
    // If the media is larger than the screen, scale it down
    if (originalWidth > screenWidth || originalHeight > screenHeight) {
      const widthRatio = screenWidth / originalWidth;
      const heightRatio = screenHeight / originalHeight;
      const ratio = Math.min(widthRatio, heightRatio);
      
      return {
        width: Math.floor(originalWidth * ratio),
        height: Math.floor(originalHeight * ratio)
      };
    }
    
    // Otherwise use original dimensions
    return { width: originalWidth, height: originalHeight };
  }
  
  // No dimensions specified - media will be displayed at its natural size
  return null;
}