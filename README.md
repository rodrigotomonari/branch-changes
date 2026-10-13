# Branch Changes

[![License: MIT](https://img.shields.io/badge/License-MIT-blue.svg)](https://opensource.org/licenses/MIT)

## Overview

Branch Changes is a simple VS Code extension that helps developers track and visualize code changes between Git branches. With a clean tree view directly integrated in the VS Code explorer, it provides a seamless way to understand what files have been modified.

## Features

- 🔍 **Real-time Change Tracking**: Automatically updates when files change, branches switch, or files are saved
- 🌳 **Hierarchical View**: Files are organized by folder structure for easier navigation
- 🔄 **Compare Against a Branch or Commit**: Select which branch to compare against (defaults to main/master), or enter a commit id
- 📊 **Color-coded Status**: Quickly identify staged, unstaged, and committed changes
- ⚡ **Auto-detection**: Automatically finds the most appropriate source branch
- 🖱️ **Click to Open**: Files open directly when clicked
- 🔄 **Automatic Refresh**: View stays current with file system changes

## Installation

This extension isn't published to the Marketplace. You can either install a built package into your normal VS Code, or run it from source for development.

### Install locally (.vsix)

```bash
npm install
npm run package
code --install-extension branch-changes-0.0.1.vsix
```

Reload VS Code afterwards and it'll show up under "branch-changes" in your Extensions list, just like a Marketplace install.

### Run from source (for development)

1. Clone the repo and run `npm install`.
2. Open the folder in VS Code.
3. Press `F5` to launch an Extension Development Host with the extension loaded.

See [CLAUDE.md](CLAUDE.md) for the full list of build/lint/test commands.

## Usage

The extension automatically adds a "Changed Files" view to your Explorer panel. From there, you can:

- **View Changed Files**: All modified files are shown in a tree view, organized by status and directory structure
- **Select Comparison Branch or Commit**: Click the branch selector at the top of the view to choose which branch to compare against, or pick "Enter a commit id…" to compare against a specific commit. The view then shows everything changed since that commit
- **Open Files**: Click on any file to open it in the editor
- **Monitor Changes**: The view automatically refreshes when you make changes or switch branches

### Commands

- `Refresh Changed Files`: Manually refresh the changed files view
- `Select Comparison Branch or Commit`: Open a dropdown to select which branch to compare against, or enter a commit id

## Requirements

- Visual Studio Code v1.98.0 or higher
- Git installed and available in PATH

## Contributing

Contributions are welcome! Please feel free to submit a Pull Request.

1. Fork the repository
2. Create your feature branch (`git checkout -b feature/amazing-feature`)
3. Commit your changes (`git commit -m 'Add some amazing feature'`)
4. Push to the branch (`git push origin feature/amazing-feature`)
5. Open a Pull Request

## License

This project is licensed under the MIT License - see the LICENSE file for details.
