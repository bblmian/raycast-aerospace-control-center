# Aerospace Control Center

A comprehensive Raycast interface for the
[AeroSpace](https://github.com/nikitabobko/AeroSpace) tiling window manager.

## Requirements

- macOS
- AeroSpace with its `aerospace` CLI installed

Homebrew is the recommended installation method:

```bash
brew install --cask nikitabobko/tap/aerospace
```

The extension automatically detects:

- Homebrew installations on Apple Silicon and Intel Macs
- Executables available in Raycast's `PATH`
- `~/.local/bin/aerospace` and `~/bin/aerospace`
- Manual AeroSpace applications in `/Applications` or `~/Applications`
- `~/.aerospace.toml`
- `$XDG_CONFIG_HOME/aerospace/aerospace.toml`

For non-standard installations, set the CLI, application, or configuration path
in Raycast Preferences → Extensions → Aerospace Control Center. No preferences
are required for a standard installation.

## Features

- Start, pause, resume, quit, and reload AeroSpace
- Browse, search, and focus windows across every workspace
- Move windows between workspaces and monitors
- Switch, summon, balance, and flatten workspaces
- Change tiling, floating, accordion, split, fullscreen, and window size
- Save persistent floating and workspace rules for applications
- Browse and execute shortcuts from the active AeroSpace configuration
- Run any AeroSpace CLI subcommand without shell interpolation
- Check detected paths, client/server versions, and compatibility issues
- Optional menu bar status and quick controls
- Dedicated no-view commands that can be assigned global Raycast hotkeys

Before the extension edits an application rule, it creates a
`<config>.raycast-backup` backup. Existing unrelated commands in a compatible
single-line rule are preserved. Complex multiline rules are left untouched and
must be edited manually.

## Commands

- **Control Center** — complete visual control panel
- **Switch Window** — search and focus any AeroSpace window
- **Switch Workspace** — switch or manage workspaces
- **Toggle AeroSpace** — start, pause, or resume without opening a view
- **Toggle Floating Window** — toggle the focused window between floating and tiling
- **Reload Configuration** — reload the active configuration
- **Menu Bar Control** — persistent status, workspaces, and quick actions
- **Browse Shortcuts** — inspect and execute configured shortcuts

## Troubleshooting

Open **Control Center → Compatibility Check** to see every detected path and
version. If the CLI is not found after a manual AeroSpace installation, either
install the CLI in your `PATH` or select it in the extension preferences.

AeroSpace itself needs macOS Accessibility permission to manage windows. This
extension does not request additional system permissions.

## Development

```bash
npm install
npm run dev
```

## License

MIT
