# Twitch Redeem Overlay

A customizable overlay application that displays media when viewers redeem Twitch Channel Points.

![Twitch Redeem Overlay](src/assets/tray-icon.png)

## Features

- **Real-time Channel Point Redemption Display**: Show images, GIFs, or videos when viewers redeem channel points
- **Queue System**: Media files play one after another without overlapping
- **Chroma Key Support**: Remove backgrounds from videos using color keying
- **Custom Positioning**: Position media anywhere on screen or go fullscreen
- **Audio Support**: Play sound from video media files
- **Multi-monitor Support**: Choose which display to show the overlay on
- **Broadcaster-friendly**: Click-through overlay won't interfere with other applications
- **Transparent Background**: Overlay only shows your media, not a background

## Installation

### Prerequisites

- Node.js 14+ and npm

### Setup

1. Clone the repository
   ```
   git clone https://github.com/yourusername/TwitchRedeemOverlay.git
   cd TwitchRedeemOverlay
   ```

2. Install dependencies
   ```
   npm install
   ```

3. Create a `.env` file in the root directory with your Twitch API credentials:
   ```
   TWITCH_CLIENT_ID=your_client_id_here
   TWITCH_CLIENT_SECRET=your_client_secret_here
   ```

   Get your credentials by creating a Twitch application at [Twitch Developer Console](https://dev.twitch.tv/console/apps)

4. Start the application
   ```
   npm start
   ```

### Building for Production

To build a standalone application:

```
# For Windows
npm run build:win

# For macOS
npm run build:mac

# For Linux
npm run build:linux
```

## Usage

1. **Start the application**: Run the executable or use `npm start`

2. **Select monitor**: Choose which display to show the overlay on

3. **Configure Twitch**: 
   - Log in with your Twitch account
   - Set up your channel
   - Configure rewards to trigger displays

4. **Test rewards**: Use the test button to preview how media will appear

### Configuring Rewards

Each Channel Point reward can be configured with:

- Media type (image, GIF, or video)
- File path or URL
- Duration on screen
- Position (X, Y coordinates)
- Size (width, height)
- Chroma key color (for green screen effects)

## Troubleshooting

### Logs

Application logs are saved in:
- Windows: `%APPDATA%\TwitchRedeemOverlay\logs`
- macOS: `~/Library/Application Support/TwitchRedeemOverlay/logs`
- Linux: `~/.config/TwitchRedeemOverlay/logs`

Access logs from the application menu: `File > Open Log File Location`

### Common Issues

- **"Invalid Client" Error**: Check your Twitch API credentials in the app settings
- **Overlay Not Visible**: Make sure the correct monitor is selected
- **Media Not Playing**: Verify file paths and formats (MP4, GIF, JPEG, PNG supported)

## Development

The application is built with:
- Electron
- Twitch EventSub API for Channel Point redemptions
- WebGL for chroma keying

To start in development mode:

```
npm start
```

## License

This project is licensed under the MIT License - see the [LICENSE](LICENSE) file for details.

## Acknowledgements

- [Twitch API](https://dev.twitch.tv/) for channel point integration
- [Electron](https://www.electronjs.org/) for cross-platform desktop support
- [WebGL](https://www.khronos.org/webgl/) for video processing