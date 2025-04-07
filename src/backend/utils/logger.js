import fs from 'fs-extra';
import path from 'path';
import { app } from 'electron';
import util from 'util';

// Define log levels
const LOG_LEVELS = {
  DEBUG: 0,
  INFO: 1,
  WARN: 2,
  ERROR: 3,
  FATAL: 4
};

// Current log level - change to adjust verbosity
let currentLogLevel = LOG_LEVELS.DEBUG;

// Get the log file path
const getLogFilePath = () => {
  // Use the userData directory for logs
  const logDir = path.join(app.getPath('userData'), 'logs');
  
  // Ensure the logs directory exists
  fs.ensureDirSync(logDir);
  
  // Create a timestamped log file name
  const now = new Date();
  const dateStr = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`;
  
  return path.join(logDir, `app-${dateStr}.log`);
};

let logFilePath = null;

// Format a log message
const formatLogMessage = (level, message, ...args) => {
  const timestamp = new Date().toISOString();
  const formattedArgs = args.map(arg => {
    if (typeof arg === 'object') {
      return util.inspect(arg, { depth: 4, colors: false });
    }
    return String(arg);
  }).join(' ');
  
  return `[${timestamp}] [${level}] ${message} ${formattedArgs}`;
};

// Write to log file
const writeToLogFile = (message) => {
  if (!logFilePath) {
    try {
      logFilePath = getLogFilePath();
    } catch (err) {
      console.error('Failed to determine log file path:', err);
      return;
    }
  }

  try {
    fs.appendFileSync(logFilePath, message + '\n');
  } catch (err) {
    console.error('Failed to write to log file:', err);
  }
};

// Override console methods to add file logging
const overrideConsole = () => {
  const originalConsole = {
    log: console.log,
    info: console.info,
    warn: console.warn,
    error: console.error,
    debug: console.debug
  };

  console.log = function(message, ...args) {
    if (currentLogLevel <= LOG_LEVELS.INFO) {
      const formattedMessage = formatLogMessage('INFO', message, ...args);
      writeToLogFile(formattedMessage);
      originalConsole.log.apply(console, [message, ...args]);
    }
  };

  console.info = function(message, ...args) {
    if (currentLogLevel <= LOG_LEVELS.INFO) {
      const formattedMessage = formatLogMessage('INFO', message, ...args);
      writeToLogFile(formattedMessage);
      originalConsole.info.apply(console, [message, ...args]);
    }
  };

  console.warn = function(message, ...args) {
    if (currentLogLevel <= LOG_LEVELS.WARN) {
      const formattedMessage = formatLogMessage('WARN', message, ...args);
      writeToLogFile(formattedMessage);
      originalConsole.warn.apply(console, [message, ...args]);
    }
  };

  console.error = function(message, ...args) {
    if (currentLogLevel <= LOG_LEVELS.ERROR) {
      const formattedMessage = formatLogMessage('ERROR', message, ...args);
      writeToLogFile(formattedMessage);
      originalConsole.error.apply(console, [message, ...args]);
    }
  };

  console.debug = function(message, ...args) {
    if (currentLogLevel <= LOG_LEVELS.DEBUG) {
      const formattedMessage = formatLogMessage('DEBUG', message, ...args);
      writeToLogFile(formattedMessage);
      originalConsole.debug.apply(console, [message, ...args]);
    }
  };
};

// Set log level
export const setLogLevel = (level) => {
  if (LOG_LEVELS[level] !== undefined) {
    currentLogLevel = LOG_LEVELS[level];
    console.log(`Log level set to ${level}`);
  } else {
    console.warn(`Invalid log level: ${level}. Using default.`);
  }
};

// Clean old log files (keep logs for 7 days)
export const cleanOldLogs = async () => {
  try {
    const logDir = path.join(app.getPath('userData'), 'logs');
    const files = await fs.readdir(logDir);
    
    const now = Date.now();
    const maxAge = 7 * 24 * 60 * 60 * 1000; // 7 days in milliseconds
    
    for (const file of files) {
      if (file.startsWith('app-') && file.endsWith('.log')) {
        const filePath = path.join(logDir, file);
        const stats = await fs.stat(filePath);
        
        if (now - stats.mtime.getTime() > maxAge) {
          await fs.unlink(filePath);
          console.log(`Deleted old log file: ${file}`);
        }
      }
    }
    
    console.log('Old log files cleaned up');
  } catch (err) {
    console.error('Error cleaning old log files:', err);
  }
};

// Get log file path for displaying in UI
export const getCurrentLogFilePath = () => {
  return logFilePath || getLogFilePath();
};

// Initialize logger
export const initLogger = () => {
  try {
    logFilePath = getLogFilePath();
    
    // Add initial log entry
    const startMessage = `=== Application started at ${new Date().toISOString()} ===`;
    const separator = '='.repeat(startMessage.length);
    
    writeToLogFile(separator);
    writeToLogFile(startMessage);
    writeToLogFile(`App version: ${app.getVersion()}`);
    writeToLogFile(`Electron version: ${process.versions.electron}`);
    writeToLogFile(`Chrome version: ${process.versions.chrome}`);
    writeToLogFile(`Node version: ${process.versions.node}`);
    writeToLogFile(`Platform: ${process.platform} (${process.arch})`);
    writeToLogFile(separator);
    
    // Override console methods
    overrideConsole();
    
    console.log(`Logger initialized. Log file: ${logFilePath}`);
    
    // Clean old logs
    cleanOldLogs();
  } catch (err) {
    console.error('Failed to initialize logger:', err);
  }
  
  return logFilePath;
};

// Export direct log methods
export const logger = {
  debug: (message, ...args) => {
    console.debug(message, ...args);
  },
  log: (message, ...args) => {
    console.log(message, ...args);
  },
  info: (message, ...args) => {
    console.info(message, ...args);
  },
  warn: (message, ...args) => {
    console.warn(message, ...args);
  },
  error: (message, ...args) => {
    console.error(message, ...args);
  }
};