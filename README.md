# MobileCoder VSCode Extension

Sync your code files seamlessly between VSCode and the MobileCoder mobile app.

## Features

- **Cross-device sync**: Sync files between VSCode and MobileCoder mobile app
- **GitHub OAuth**: Secure authentication using your GitHub account
- **Automatic sync**: Files are automatically synced when changed
- **File watching**: Real-time monitoring of file changes
- **Remote file management**: Browse and download files from your mobile device
- **Conflict resolution**: Smart handling of concurrent edits

## Installation

### From VSIX (Development)

1. Clone the MobileCoder repository
2. Navigate to the extension directory:
   ```bash
   cd vscode-extension
   npm install
   npm run compile
   ```
3. Package the extension:
   ```bash
   npm install -g vsce
   vsce package
   ```
4. Install the generated `.vsix` file in VSCode

### From Source (Development)

1. Open the `vscode-extension` folder in VSCode
2. Press `F5` to run the extension in a new Extension Development Host window

## Setup

1. **Create GitHub OAuth App**:
   - Go to [GitHub Developer Settings](https://github.com/settings/developers)
   - Create a new OAuth App with callback URL: `mobilecoder://auth`
   - Copy the Client ID

2. **Configure the extension**:
   - Update the Client ID in `src/services/authService.ts`
   - Recompile with `npm run compile`

3. **Sign in**:
   - Open the MobileCoder panel in VSCode
   - Click "Sign In" and follow the device flow instructions

## Usage

### Commands

- `MobileCoder: Sign In with GitHub` - Authenticate with GitHub
- `MobileCoder: Sign Out` - Sign out and clear stored credentials
- `MobileCoder: Sync Files` - Manually sync all files
- `MobileCoder: Download from MobileCoder` - Download a specific remote file

### Views

- **Remote Files**: Browse files from your MobileCoder mobile app
- **Authentication**: Manage your sign-in status

### Settings

- `mobilecoder.syncDirectory`: Directory to sync (default: workspace root)
- `mobilecoder.autoSync`: Enable automatic syncing (default: true)
- `mobilecoder.syncInterval`: Auto-sync interval in seconds (default: 300)

## File Types Supported

The extension syncs the following file types:
- JavaScript/TypeScript: `.js`, `.ts`, `.jsx`, `.tsx`
- Python: `.py`
- Java: `.java`
- C/C++: `.cpp`, `.c`, `.h`
- Web: `.css`, `.html`
- Documentation: `.md`, `.txt`
- Data: `.json`, `.xml`

## How It Works

1. Files are stored as private GitHub Gists
2. Each file gets its own Gist for granular sync control
3. Timestamp comparison resolves conflicts automatically
4. Real-time file watching enables automatic syncing
5. Metadata tracking ensures efficient sync operations

## Development

### Building

```bash
npm install
npm run compile
```

### Testing

```bash
npm run watch  # Watch mode for development
```

### Packaging

```bash
vsce package
```

## Contributing

1. Fork the repository
2. Create a feature branch
3. Make your changes
4. Test thoroughly
5. Submit a pull request

## License

This extension is part of the MobileCoder project. See the main repository for license information.

## Support

For issues and feature requests, please visit the [MobileCoder GitHub repository](https://github.com/yourusername/mobilecoder).