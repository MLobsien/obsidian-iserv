# IServ Integration

Obsidian plugin for integrating IServ school management system.

## Features

- **Timetable**: Weekly schedule view
- **Substitutions**: Last-minute schedule changes
- **Exercises**: Homework/assignments tracking
- **Mails**: Internal school email with pagination
- **Review Queue**: File review and filing system

## Installation

1. Download `main.js`, `manifest.json`, and `styles.css` from releases
2. Create folder `.obsidian/plugins/iserv-integration/` in your vault
3. Copy files into the plugin folder
4. Enable the plugin in Obsidian settings

## Development

```bash
npm install
npm run dev      # watch mode
npm run build    # production build
npm run typecheck
npm test
```

## Configuration

Configure your IServ credentials in the plugin settings:
- Server URL (e.g., `https://iserv.example.com`)
- Username
- Password

## License

MIT
