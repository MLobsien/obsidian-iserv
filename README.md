# IServ Integration for Obsidian

Integration of the IServ school management system into Obsidian.

## Features

- Timetable and substitution display
- Mail integration with pagination
- Exercise/homework tracking
- Review queue for file management
- Exam planning with countdown

## Installation

1. Download `main.js`, `styles.css`, and `manifest.json` from [Releases](https://github.com/MLobsien/obsidian-iserv/releases)
2. Copy to your vault: `.obsidian/plugins/iserv-integration/`
3. Enable the plugin in Obsidian Settings → Community Plugins

## Development

```bash
npm install
npm run build    # Build plugin
npm run test     # Run tests
npm run typecheck # Type check
npm run dev      # Watch mode
```

## Configuration

- Configure your IServ credentials in the plugin settings
- The plugin uses encrypted storage for credentials (desktop only)

## License

MIT
