const { contextBridge, ipcRenderer } = require('electron');

// Expose protected methods for Twitch functionality to the renderer process
contextBridge.exposeInMainWorld('twitchAPI', {
  // Authentication actions
  login: () => {
    ipcRenderer.send('twitch-login');
  },
  logout: () => {
    ipcRenderer.send('twitch-logout');
  },
  // Channel setup
  setupChannel: (channelUrl) => {
    ipcRenderer.send('setup-channel', channelUrl);
  },
  // Refresh own channel data
  refreshOwnChannel: () => {
    ipcRenderer.send('refresh-own-channel');
  },
  // Polling control
  toggleRewardPolling: (shouldPoll) => {
    ipcRenderer.send('toggle-reward-polling', shouldPoll);
  },
  // Reward management
  getRewardsList: () => {
    ipcRenderer.send('get-rewards-list');
  },
  saveRewardConfig: (rewardId, config) => {
    ipcRenderer.send('save-reward-config', {rewardId, config});
  },
  deleteRewardConfig: (rewardId) => {
    ipcRenderer.send('delete-reward-config', {rewardId});
  },
  // Test reward
  testReward: (reward) => {
    ipcRenderer.send('test-reward', reward);
  },
  // File browser dialog
  browseMediaFile: (callback) => {
    ipcRenderer.once('selected-media-file', (_, filePath) => {
      callback(filePath);
    });
    ipcRenderer.send('open-media-file-dialog');
  },
  // Event listeners
  onAuthStatusUpdate: (callback) => {
    ipcRenderer.on('twitch-auth-status', (_, data) => callback(data));
  },
  onChannelSetupResult: (callback) => {
    ipcRenderer.on('channel-setup-result', (_, data) => callback(data));
  },
  onPollingStatusChange: (callback) => {
    ipcRenderer.on('polling-status-change', (_, data) => callback(data));
  },
  // Reward event listeners
  onRewardsUpdated: (callback) => {
    ipcRenderer.on('rewards-updated', (_, data) => callback(data));
  },
  onRewardsError: (callback) => {
    ipcRenderer.on('rewards-error', (_, data) => callback(data));
  }
});