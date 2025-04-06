// This file serves as an entry point redirect to the main backend code
// It's included for backward compatibility if someone tries to run the app
// without checking the package.json main entry point

console.log('Starting Twitch Redeem Overlay application...');
import './src/backend/index.js';