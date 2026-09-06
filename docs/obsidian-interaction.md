# Obsidian Interaction Methods

How an agent on this machine can programmatically interact with the Obsidian app for the vault at `/home/mad5/Schule`.

## Vault facts (this machine)

| Fact | Value |
| --- | --- |
| Vault path | `/home/mad5/Schule` |
| Vault name | `Schule` |
| Vault ID | `2f2184d0d3d35899` (from `~/.config/obsidian/obsidian.json`) |
| CLI enabled? | No (`"cli": false` in `~/.config/obsidian/obsidian.json`) |
| Installed community plugins | `calctex`, `calculator-pro`, `chem`, `iserv-integration`, `obsidian-desmos`, `obsidian-excalidraw-plugin`, `obsidian-pandoc`, `obsidian-relative-line-numbers`, `templater-obsidian` |
| Not installed (relevant here) | `advanced-uri`, `obsidian-local-rest-api` |

Vault ID lookup: `cat ~/.config/obsidian/obsidian.json` (Linux global config dir; see [How Obsidian stores data](https://help.obsidian.md/data-storage)).

## Method comparison

| Method | Open note | Search | Create/edit | Run command | Read state | Needs Obsidian running | Setup effort |
| --- | --- | --- | --- | --- | --- | --- | --- |
| 1. Obsidian URI (native) | ✅ | ✅ (opens search UI) | ✅ (new/append) | ❌ | ❌ | ✅ | none |
| 2. Obsidian CLI (official) | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | enable setting + PATH |
| 3. Advanced URI plugin | ✅ | ✅ (per-file) | ✅ | ✅ | partial | ✅ | install plugin |
| 4. Local REST API plugin | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | install plugin + API key |
| 5. Direct file system | ✅ (via URI) | ❌ (grep instead) | ✅ | ❌ | ✅ | ❌ | none |
| 6. MCP server | ✅ | ✅ | ✅ | ✅ | ✅ | depends | varies |
| 7. Web Clipper | ❌ | ❌ | ✅ (clips only) | ❌ | ❌ | ✅ | browser extension |
| 8. Custom plugin | everything | everything | everything | everything | everything | ✅ | write TS plugin |

---

## 1. Obsidian URI protocol (native, no plugin)

Official docs: <https://help.obsidian.md/uri>

Custom URI scheme `obsidian://` built into the app. Trigger from a terminal on Linux with `xdg-open`:

```bash
xdg-open "obsidian://open?vault=Schule&file=Mathe/analysis"
```

### Format

```
obsidian://action?param1=value1&param2=value2
```

All values must be percent-encoded (`/` → `%2F`, space → `%20`).

### Actions

| Action | Purpose |
| --- | --- |
| `open` | Open a vault and/or a file |
| `new` | Create a note, optionally with content |
| `daily` | Create/open the daily note (Daily notes plugin must be enabled) |
| `unique` | Create a unique note (Unique note creator plugin must be enabled) |
| `search` | Open the search view, optionally with a query |
| `choose-vault` | Open the vault manager |

### Examples (vault `Schule`)

```bash
# Open vault (focus window if already open)
xdg-open "obsidian://open?vault=Schule"

# Open a note by name (extension optional)
xdg-open "obsidian://open?vault=Schule&file=Mathe%2Fanalysis"

# Open a note by absolute path (vault auto-detected)
xdg-open "obsidian://open?path=%2Fhome%2Fmad5%2FSchule%2FMathe%2Fanalysis.md"

# Open a heading or block inside a note
xdg-open "obsidian://open?vault=Schule&file=Mathe%2Fanalysis%23Grenzwerte"
xdg-open "obsidian://open?vault=Schule&file=Mathe%2Fanalysis%23%5Eblock-id"

# Open in a specific pane
xdg-open "obsidian://open?vault=Schule&file=Mathe&paneType=tab"   # tab | split | window

# Create a note with content (silent = don't open it)
xdg-open "obsidian://new?vault=Schule&file=Inbox%2Fnote&content=Hello%20World&silent"

# Append to an existing note
xdg-open "obsidian://new?vault=Schule&file=Inbox%2Fnote&content=more&append"

# Open search with a query
xdg-open "obsidian://search?vault=Schule&query=Grenzwert"

# Daily note
xdg-open "obsidian://daily?vault=Schule"
```

### Parameters (open/new)

- `vault` — vault name or vault ID (ID is stable across renames: `2f2184d0d3d35899`)
- `file` — file name or vault-relative path; `.md` extension optional
- `path` — absolute filesystem path; overrides `vault` + `file`
- `content`, `clipboard`, `silent`, `append`, `overwrite` — for `new`
- `paneType` — `tab`, `split`, `window` (desktop)
- `x-success` / `x-error` — x-callback-url callbacks (receive `name`, `url`, `file`)

### Shorthand forms

```
obsidian://vault/Schule/Mathe/analysis        # = open?vault=Schule&file=Mathe/analysis
obsidian:///home/mad5/Schule/Mathe/analysis  # = open?path=...
```

### Linux registration

The `obsidian://` handler must be registered via a `.desktop` file with `Exec=executable %u`. If `xdg-open` fails, check the desktop file (AppImage installs may need `--appimage-extract`). See [Obsidian URI troubleshooting](https://help.obsidian.md/uri#Register+Obsidian+URI).

### Limitations

- No command execution, no read-back of content, no search results (only opens the search UI).
- Requires Obsidian to be running (or it launches the app).
- One-shot fire-and-forget: no return value except the optional `x-success` callback.

---

## 2. Obsidian CLI (official, Obsidian 1.12+)

Official docs: <https://help.obsidian.md/cli>

A real CLI bundled with the Obsidian installer (1.12.7+). "Anything you can do in Obsidian you can do from the command line." This is the **recommended primary method** for agent use.

### Setup

1. Update Obsidian to the latest installer version (1.12.7+).
2. **Settings → General → enable "Command line interface"**.
3. Follow the prompt to register the CLI. On Linux the binary is copied to `~/.local/bin/obsidian`; ensure `~/.local/bin` is in `PATH`:
   ```bash
   export PATH="$PATH:$HOME/.local/bin"
   ```
4. Restart the terminal. Verify: `ls -l ~/.local/bin/obsidian`.

Obsidian must be running; the first command launches it if not.

### Usage

```bash
# Vault targeting: cwd inside the vault is used by default; or pass vault= first
obsidian vault=Schule search query="Grenzwert"

# Files
obsidian open path="Mathe/analysis.md"
obsidian read path="Mathe/analysis.md"
obsidian create name=note content="Hello" open overwrite
obsidian append path="Inbox/note.md" content="- [ ] task"
obsidian prepend path="Inbox/note.md" content="---\ntags: [x]\n---"
obsidian move path="a.md" to="b.md"
obsidian delete path="a.md"          # trash by default; permanent flag to skip
obsidian files folder=Mathe total

# Search
obsidian search query="meeting notes"
obsidian search:context query="TODO"          # grep-style path:line: text
obsidian search query="status::active" format=json

# Commands (any command-palette command, incl. plugin commands)
obsidian commands
obsidian command id="workspace:export-pdf"

# Daily notes
obsidian daily
obsidian daily:append content="- [ ] Buy groceries"

# Tasks
obsidian tasks todo
obsidian task ref="Mathe/analysis.md:8" toggle

# Properties / tags / links
obsidian property:set name=status value=done
obsidian tags counts
obsidian backlinks path="Mathe/analysis.md"

# Workspace / tabs
obsidian workspace
obsidian tabs
obsidian workspace:load name=main

# Plugins / themes
obsidian plugins
obsidian plugin:enable id=obsidian-advanced-uri
obsidian plugin:reload id=my-plugin

# Developer commands (agentic testing/debugging)
obsidian devtools
obsidian dev:screenshot path=shot.png
obsidian eval code="app.vault.getFiles().length"
obsidian dev:dom selector=".view-content" text
```

### Notes

- Parameters: `key=value`; flags are bare words (`open`, `overwrite`, `total`, `--copy`).
- Multiline content: `\n` for newline, `\t` for tab.
- `file=<name>` resolves like a wikilink (name only); `path=<path>` is exact from vault root.
- `--copy` copies any command's output to the clipboard.
- Interactive TUI: run `obsidian` with no args (autocomplete, history, `Ctrl+R` reverse search).

### Limitations

- Requires Obsidian 1.12+ installer and the app running.
- One-time setup (enable setting + PATH registration) needs a human click.

---

## 3. Advanced URI plugin (community)

GitHub: <https://github.com/Vinzent03/obsidian-advanced-uri> · Docs: <https://publish.obsidian.md/advanced-uri-doc>

Extends the native URI scheme with `obsidian://adv-uri` actions: command execution, search-and-replace, targeted writes, frontmatter editing, workspace loading, canvas control, plugin enable/disable, and more.

### Setup

1. **Settings → Community plugins → Browse → "Advanced URI"** → Install → Enable.
2. (Optional) Set a default `openmode` in plugin settings.

### URI format

```
obsidian://adv-uri?key1=value1&key2=value2
```

Values percent-encoded. `vault` optional (last-used vault if omitted).

### File identification

| Key | Value | Example |
| --- | --- | --- |
| `filepath` | vault-relative path (extension optional) | `filepath=Mathe%2Fanalysis` |
| `filename` | file name only, alias-aware | `filename=Brain%20Dumps` |
| `daily` | `true` (creates if missing) | `daily=true` |
| `uid` | frontmatter UUID | `uid=d43f7a17-...` |

### Actions

**Navigation** (open file, heading, block, line, workspace, settings):

```bash
# Open file
xdg-open "obsidian://adv-uri?vault=Schule&filepath=Mathe%2Fanalysis"

# Open heading / block / line / column
xdg-open "obsidian://adv-uri?vault=Schule&filepath=Mathe%2Fanalysis&heading=Grenzwerte"
xdg-open "obsidian://adv-uri?vault=Schule&filepath=Mathe%2Fanalysis&block=12345"
xdg-open "obsidian://adv-uri?vault=Schule&filepath=Mathe%2Fanalysis&line=10&column=5"

# Open a workspace
xdg-open "obsidian://adv-uri?vault=Schule&workspace=main"

# Open settings tab
xdg-open "obsidian://adv-uri?vault=Schule&settingid=editor"
```

**Writing** (`data` or `clipboard=true`; modes `write` (default), `overwrite`, `append`, `prepend`, `new`):

```bash
# Write/overwrite/append/prepend
xdg-open "obsidian://adv-uri?vault=Schule&filepath=Inbox%2Fnote&data=Hello%20World"
xdg-open "obsidian://adv-uri?vault=Schule&filepath=Inbox%2Fnote&data=Hello&mode=overwrite"
xdg-open "obsidian://adv-uri?vault=Schule&filepath=Inbox%2Fnote&data=more&mode=append"
xdg-open "obsidian://adv-uri?vault=Schule&daily=true&data=-%20New%20idea&mode=append"

# Append under a specific heading
xdg-open "obsidian://adv-uri?vault=Schule&daily=true&heading=Inbox&data=-%20New%20idea&mode=append"

# Custom separator
xdg-open "obsidian://adv-uri?vault=Schule&filepath=Inbox%2Fnote&data=x&mode=append&separator=,"
```

**Commands** (by `commandname` or `commandid`; `confirm` auto-clicks modal buttons):

```bash
# Execute any command by ID (export to PDF example)
xdg-open "obsidian://adv-uri?vault=Schule&filepath=Mathe%2Fanalysis&commandid=workspace%3Aexport-pdf"

# Close a specific tab by filepath
xdg-open "obsidian://adv-uri?vault=Schule&filepath=Mathe%2Fanalysis&commandid=workspace%3Aclose"
```

**Search and replace** (per file, plain or RegEx):

```bash
# Search in current file (copies matches to clipboard)
xdg-open "obsidian://adv-uri?vault=Schule&filepath=Mathe%2Fanalysis&search=Grenzwert"

# Replace all occurrences
xdg-open "obsidian://adv-uri?vault=Schule&filepath=Mathe%2Fanalysis&search=alt&replace=neu"

# RegEx replace
xdg-open "obsidian://adv-uri?vault=Schule&filepath=Mathe%2Fanalysis&searchregex=%5Cd%2B&replace=N"
```

**Frontmatter** (read/write via `frontmatterkey`, nested keys as `[a,b,1]`):

```bash
# Write a frontmatter field
xdg-open "obsidian://adv-uri?vault=Schule&filepath=Mathe%2Fanalysis&frontmatterkey=status&data=done"

# Read a field (copies value to clipboard)
xdg-open "obsidian://adv-uri?vault=Schule&filepath=Mathe%2Fanalysis&frontmatterkey=status"
```

**View/open modes**:

- `viewmode=source|live|preview` — switch editor mode
- `openmode=true|false|window|window-or-focus|split|split-or-focus|tab|silent|popover` — where/how to open (`silent` = don't open)

**Miscellaneous**:

```bash
# Check file exists (copies 1 or 0 to clipboard)
xdg-open "obsidian://adv-uri?vault=Schule&filepath=Mathe%2Fanalysis&exists=true"

# Update all community plugins
xdg-open "obsidian://adv-uri?vault=Schule&updateplugins=true"

# Enable/disable a plugin
xdg-open "obsidian://adv-uri?vault=Schule&enable-plugin=obsidian-advanced-uri"
```

### Limitations

- Still URI-based: no structured return values (results go to the clipboard).
- `execute arbitrary code` was removed for security.
- Requires the plugin installed and enabled.

---

## 4. Local REST API plugin (community) — recommended for agent use

GitHub: <https://github.com/coddingtonbear/obsidian-local-rest-api> · Interactive API docs: <https://coddingtonbear.github.io/obsidian-local-rest-api/>

A secure REST API **and built-in MCP server** running inside Obsidian. Full CRUD, surgical section patching, search, command execution, tags, active-file access, open-in-UI. This is the best method for an agent that wants structured JSON in/out.

### Setup

1. **Settings → Community plugins → Browse → "Local REST API"** → Install → Enable.
2. Open **Settings → Local REST API**; copy the **API key** and (optionally) download/trust the self-signed certificate from `https://127.0.0.1:27124/obsidian-local-rest-api.crt`.
3. Optional: enable **Enable HTTP server** for plain `http://127.0.0.1:27123` (no TLS).

### Endpoints

| Endpoint | Methods | Description |
| --- | --- | --- |
| `/` | GET | Server status / auth check (no auth needed) |
| `/vault/{path}` | GET PUT PATCH POST DELETE | Full CRUD on any vault file (incl. binary) |
| `/active/` | GET PUT PATCH POST DELETE | Operate on the currently open file |
| `/search/simple/` | POST | Full-text search (Obsidian's built-in search) |
| `/search/` | POST | Structured JsonLogic search over metadata |
| `/commands/` | GET | List all registered Obsidian commands |
| `/commands/{commandId}/` | POST | Execute a command |
| `/tags/` | GET | List tags with usage counts |
| `/open/{path}` | POST | Open a file in the Obsidian UI |
| `/mcp/` | GET POST | Built-in MCP server (Streamable HTTP) |

Auth: `Authorization: Bearer <api-key>` on every request. Default port **27124 (HTTPS)**, **27123 (HTTP)**.

### Examples

```bash
API_KEY="<your-api-key>"

# Health check (no auth)
curl -k https://127.0.0.1:27124/

# List vault root
curl -k -H "Authorization: Bearer $API_KEY" https://127.0.0.1:27124/vault/

# Read a note
curl -k -H "Authorization: Bearer $API_KEY" https://127.0.0.1:27124/vault/Mathe/analysis.md

# Read only a heading / frontmatter field
curl -k -H "Authorization: Bearer $API_KEY" \
  https://127.0.0.1:27124/vault/Mathe/analysis.md/heading/Grenzwerte
curl -k -H "Authorization: Bearer $API_KEY" \
  https://127.0.0.1:27124/vault/Mathe/analysis.md/frontmatter/status

# Write a file
curl -k -X PUT -H "Authorization: Bearer $API_KEY" \
  -H "Content-Type: text/markdown" --data "# Title" \
  https://127.0.0.1:27124/vault/Inbox/note.md

# Append to a heading (PATCH instruction)
curl -k -X PATCH -H "Authorization: Bearer $API_KEY" \
  -H "Content-Type: application/json" \
  --data '{"targetType":"heading","target":["Log"],"operation":"append","content":"- new item"}' \
  https://127.0.0.1:27124/vault/notes/daily.md

# Replace a frontmatter value
curl -k -X PATCH -H "Authorization: Bearer $API_KEY" \
  -H "Content-Type: application/json" \
  --data '{"targetType":"frontmatter","target":"status","operation":"replace","value":"done"}' \
  https://127.0.0.1:27124/vault/Mathe/analysis.md

# Search
curl -k -X POST -H "Authorization: Bearer $API_KEY" \
  "https://127.0.0.1:27124/search/simple/?query=Grenzwert"

# List commands
curl -k -H "Authorization: Bearer $API_KEY" https://127.0.0.1:27124/commands/

# Execute a command
curl -k -X POST -H "Authorization: Bearer $API_KEY" \
  https://127.0.0.1:27124/commands/workspace%3Aexport-pdf/

# Open a file in the UI
curl -k -X POST -H "Authorization: Bearer $API_KEY" \
  https://127.0.0.1:27124/open/Mathe/analysis.md
```

### Built-in MCP server

The plugin ships an MCP server at `https://127.0.0.1:27124/mcp/` (Streamable HTTP, bearer auth). Tools: `vault_list`, `vault_read`, `vault_write`, `vault_append`, `vault_patch`, `vault_delete`, `vault_move`, `vault_copy`, `vault_get_document_map`, `active_file_get_path`, `search_query`, `search_simple`, `tag_list`, `command_list`, `command_execute`, `open_file`. Resource: `obsidian://local-rest-api/openapi.yaml`.

### Limitations

- Requires the plugin running inside Obsidian (app must be open).
- Self-signed cert: use `-k`/trust the cert, or enable the plain-HTTP endpoint.
- PATCH whitespace is library-owned (content normalized); use `within`/`ifMatch` for precise edits.

---

## 5. Direct file system access

The vault is a plain folder of Markdown files. Read/write with normal tools; no Obsidian involvement needed.

```bash
# Read
cat /home/mad5/Schule/Mathe/analysis.md

# Write (atomic-ish: write temp file, then mv)
printf '# Title\n\nBody\n' > /tmp/note.md && mv /tmp/note.md /home/mad5/Schule/Inbox/note.md

# Search
grep -rn "Grenzwert" /home/mad5/Schule --include="*.md"
```

### Does Obsidian detect external changes?

Yes. Official statement ([How Obsidian stores data](https://help.obsidian.md/data-storage)):

> "Because notes are plain text files, you can use other text editors and file managers to edit and manage notes. **Obsidian automatically refreshes your vault to keep up with any external changes.**"

Caveats:

- The **metadata cache** (headings, links, tags, graph) is kept in sync but can lag; if it drifts, rebuild it via **Settings → Files and links → Rebuild metadata cache**.
- An open note may not visually refresh until it regains focus (Obsidian reloads the file on focus/refresh).
- `.obsidian/workspace.json` changes whenever you open a file — add it to `.gitignore` if it pollutes git diffs (this vault is a git repo).
- Obsidian's own writes (e.g. via plugins) can race with external writes; for concurrent edits prefer the REST API or CLI so Obsidian's `app.vault` stays authoritative.

### Limitations

- No command execution, no search UI, no metadata (backlinks, tags index) unless you parse it yourself.
- No notification when Obsidian changes files (poll or use git).
- Best for bulk import/export and git-driven workflows; not for triggering app behavior.

---

## 6. MCP (Model Context Protocol) servers

Several options; pick by whether you want the server inside Obsidian or standalone.

### 6a. Local REST API built-in MCP (recommended, in-app)

See method 4. No extra install — the plugin already exposes `/mcp/`. Connect any Streamable-HTTP MCP client:

```json
{
  "mcpServers": {
    "obsidian": {
      "type": "http",
      "url": "https://127.0.0.1:27124/mcp/",
      "headers": { "Authorization": "Bearer <your-api-key>" }
    }
  }
}
```

### 6b. StevenStavrakis/obsidian-mcp (standalone, no Obsidian needed)

GitHub: <https://github.com/StevenStavrakis/obsidian-mcp>

Node.js MCP server that reads/writes vault Markdown directly on disk. Works **without Obsidian open**. Tools: `obsidian_list_vaults`, `obsidian_read_note`, `obsidian_create_note`, `obsidian_edit_note`, `obsidian_delete_note`, `obsidian_move_note`, `obsidian_search_vault`, `obsidian_add_tags`, `obsidian_remove_tags`, `obsidian_rename_tag`, etc.

```bash
npm install -g obsidian-mcp@2
# configure vault path in the server config, then register with your MCP client
```

### 6c. MarkusPfundstein/mcp-obsidian (bridges Local REST API)

GitHub: <https://github.com/MarkusPfundstein/mcp-obsidian>

Python MCP server that talks to the Local REST API plugin. Requires the plugin running.

### 6d. In-app MCP plugins (alternative to Local REST API)

- `aaronsb/obsidian-mcp-plugin` ("Semantic Notes Vault MCP") — MCP server inside Obsidian, HTTP 3001 / HTTPS 3443, API key, read-only mode, Dataview/Bases support. <https://github.com/aaronsb/obsidian-mcp-plugin>
- `istefox/obsidian-mcp-connector` — in-app MCP server on `127.0.0.1:27200/mcp`, 52 tools, on-device semantic search. <https://github.com/istefox/obsidian-mcp-connector>

### Limitations

- Standalone servers (6b) bypass Obsidian's metadata cache and permission model; they operate on raw files.
- In-app servers (6a/6d) need Obsidian running.
- MCP is a client-side protocol: the agent's host must support MCP clients.

---

## 7. Obsidian Web Clipper

Docs: <https://help.obsidian.md/web-clipper> · Source: <https://github.com/obsidianmd/obsidian-clipper>

**No public API.** It is a browser extension (Chrome/Firefox/Safari/Edge) that captures web pages into the vault. It communicates with Obsidian via the native Obsidian URI (`new` action; requires Obsidian 1.7.2+). It is configurable (templates, variables, filters, triggers) but not scriptable from outside the browser.

Relevance to this agent: low. If a future task needs web clipping, the equivalent is: fetch the page, then write Markdown directly to the vault (method 5) or via the REST API (method 4).

---

## 8. Custom Obsidian plugin (plugin API)

Docs: <https://docs.obsidian.md> · Type definitions: <https://github.com/obsidianmd/obsidian-api> · Template: <https://github.com/obsidianmd/obsidian-sample-plugin>

Plugins are TypeScript/JavaScript bundles loaded into Obsidian's Electron renderer. `main.js` must export a class extending `Plugin`; `manifest.json` declares id/name/version/minAppVersion/isDesktopOnly.

### API surface (from obsidian-api README)

- `App` — global object (`this.app`); accessors for `Vault`, `Workspace`, `MetadataCache`.
- `Vault` — files/folders CRUD (`vault.create`, `vault.read`, `vault.modify`, `vault.delete`, `vault.getFiles`, ...).
- `Workspace` — panes, tabs, active file, `workspace.openLinkText`, `workspace.getLeavesOfType`.
- `MetadataCache` — cached headings, links, embeds, tags, blocks.
- `Plugin` methods — `addRibbonIcon`, `addStatusBarItem`, `addCommand`, `addSettingTab`, `registerView`, `loadData`/`saveData`, `registerEvent`, `registerDomEvent`, `registerInterval`.

### Can a plugin expose a local server or IPC?

Yes. Plugins run with Node.js/Electron access when `isDesktopOnly: true` (they can `require('fs')`, `require('electron')`, and open HTTP servers). The Local REST API plugin is exactly this: an Express server inside the plugin. A custom plugin could expose its own HTTP endpoint, WebSocket, or Unix socket for agent use.

### When to write one

Only if the existing methods (CLI, REST API, Advanced URI) can't do the job — e.g. deep integration with a specific plugin's internal API, custom views, or background indexing. For this vault, the CLI or Local REST API covers essentially everything.

---

## Recommendation matrix (for downstream tasks)

| Task | Best method |
| --- | --- |
| Open a specific note in the UI | Obsidian URI (`xdg-open "obsidian://open?..."`) — zero setup |
| Run an Obsidian command (e.g. export PDF, presentation mode) | Obsidian CLI `obsidian command id=...` (after enabling CLI) or Advanced URI `commandid=` |
| Search the vault and get results back | Obsidian CLI `obsidian search` / `search:context`, or REST API `/search/simple/` |
| Create/edit notes with structured output | Local REST API (JSON in/out) or direct file writes |
| Read vault state (open tabs, active file, tags, backlinks) | Obsidian CLI (`tabs`, `tags`, `backlinks`, `workspace`) or REST API |
| Trigger presentation mode | Obsidian CLI `obsidian command id="obsidian-presentation:start-presentation"` (or Advanced URI) |
| Bulk import/export, git workflows | Direct file system access |
| Agent-native tool access (MCP) | Local REST API built-in MCP (`/mcp/`) |

**Recommended setup order for this machine:**
1. Enable **Obsidian CLI** (Settings → General → Command line interface) — one human click, then everything is scriptable.
2. Install **Local REST API** plugin for structured JSON + MCP.
3. Install **Advanced URI** only if URI-based workflows are preferred over the CLI.

---

## Sources

- Obsidian URI — <https://help.obsidian.md/uri> (source: <https://github.com/obsidianmd/obsidian-help/blob/master/en/Extending%20Obsidian/Obsidian%20URI.md>)
- Obsidian CLI — <https://help.obsidian.md/cli> (source: <https://github.com/obsidianmd/obsidian-help/blob/master/en/Extending%20Obsidian/Obsidian%20CLI.md>)
- How Obsidian stores data — <https://help.obsidian.md/data-storage> (source: <https://github.com/obsidianmd/obsidian-help/blob/master/en/Files%20and%20folders/How%20Obsidian%20stores%20data.md>)
- Advanced URI — <https://github.com/Vinzent03/obsidian-advanced-uri> · docs: <https://publish.obsidian.md/advanced-uri-doc>
- Local REST API — <https://github.com/coddingtonbear/obsidian-local-rest-api> · API docs: <https://coddingtonbear.github.io/obsidian-local-rest-api/>
- Obsidian API — <https://github.com/obsidianmd/obsidian-api> · plugin docs: <https://docs.obsidian.md>
- Web Clipper — <https://help.obsidian.md/web-clipper> · <https://github.com/obsidianmd/obsidian-clipper>
- MCP servers — <https://github.com/StevenStavrakis/obsidian-mcp> · <https://github.com/MarkusPfundstein/mcp-obsidian> · <https://github.com/aaronsb/obsidian-mcp-plugin> · <https://github.com/istefox/obsidian-mcp-connector>
