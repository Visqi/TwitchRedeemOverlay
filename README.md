# Twitch Redeem Overlay

An overlay application that displays images, GIFs, and videos on screen in response to Twitch point redemptions via Redis.

## Features

- Transparent overlay that works on any monitor
- Redis connection to receive display commands
- System tray icon for easy management
- Support for images, GIFs, and videos
- Chroma key feature for transparent media

## Building the Application

To build a distributable version of the application:

1. Install dependencies:
   ```
   npm install
   ```

2. Create application icons:
   - Windows: Save a `.ico` file as `src/assets/app-icon.ico`
   - macOS: Save a `.icns` file as `src/assets/app-icon.icns`
   - Linux: Save a `.png` file as `src/assets/app-icon.png`

3. Build for your platform:

   ### Portable Builds (No Installation Required)
   ```
   # For Windows (creates a portable .exe)
   npm run build:win

   # For macOS (creates a .app directory)
   npm run build:mac

   # For Linux (creates an AppImage)
   npm run build:linux
   ```

   The portable Windows version will be available as `dist/TwitchRedeemOverlay-Portable.exe`.

4. Find the built application in the `dist` folder.

## Development

```
# Start the application in development mode
npm start
```

## Redis Commands

The application listens for these Redis commands:

- `display-overlay-image`: Display an image
- `display-overlay-gif`: Display a GIF
- `display-overlay-video`: Display a video
- `clear-overlay-cache`: Clear the media cache

Example JSON payload:
```json
{
  "path": "https://example.com/image.png",
  "x": 100,
  "y": 100,
  "duration": 5000,
  "width": 300,
  "height": 300,
  "chromaKey": "#00ff00"
}
```

## License

MIT