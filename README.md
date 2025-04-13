# FixLang

A local macOS app that uses OpenAI to fix grammar and improve writing style. This app runs entirely on your local machine and uses your own OpenAI API key.

## Features

- Fix grammar and improve writing style with a keyboard shortcut (Ctrl+Shift+F)
- Undo corrections (Ctrl+Shift+Z)
- Retry corrections (Ctrl+Shift+A)
- Preview original and corrected text in the UI
- Configure your OpenAI API key in the settings
- Customize keyboard shortcuts

## Installation

### From Release

1. Download the latest `.dmg` file from the releases page
2. Open the `.dmg` file
3. Drag the FixLang app to your Applications folder
4. Open the app and enter your OpenAI API key in the settings

### Building from Source

1. Clone this repository
2. Install dependencies: `npm install` or `bun install`
3. Build the app: `npm run build:dist` or `bun run build:dist`
4. The packaged app will be available in the `release` directory

## Usage

1. Copy text to your clipboard
2. Press Ctrl+Shift+F to fix the text
3. The corrected text will be copied to your clipboard
4. You can view the original and corrected text in the app UI
5. Press Ctrl+Shift+Z to undo the correction
6. Press Ctrl+Shift+A to retry the correction

## Development

- Run in development mode: `npm run dev` or `bun run dev`
- Build and preview: `npm run start` or `bun run start`
- Build for distribution: `npm run build:dist` or `bun run build:dist`

## Security

This app uses your OpenAI API key to make requests to the OpenAI API. Your API key is stored securely on your local machine using electron-store and is never sent anywhere except to the OpenAI API for processing your text.

## License

MIT
