# Obsidian headless PDF automation — evidence (2026-08-25)

## Verdict

Obsidian Desktop is not a supported standalone headless PDF renderer. Current Obsidian CLI is a remote-control interface to a running Desktop app; its documented command set has no PDF-export command, though it can execute command-palette IDs and JavaScript. On Linux, the supported Electron testing guidance still requires a display driver, normally Xvfb. A hidden `BrowserWindow` is not the same as display-less execution.

Electron itself exposes a strong alternative: a main-process `BrowserWindow({show: false})` can load content and `webContents.printToPDF()` returns PDF bytes. That works without a visible window, but Electron's official headless-CI guidance says Linux still needs a display driver. Electron does not document `--print-to-pdf` as an Electron switch, and Electron's own issue tracker explicitly says Electron does not support `--headless`; Chromium's flag is not an Obsidian export interface.

The practical supported-ish route is: run Obsidian Desktop under Xvfb, use the official CLI or an automation plugin to invoke commands/eval/CDP, and accept that native PDF export still opens a GUI save flow. For deterministic unattended output, render Markdown independently (e.g. headless Chromium/Pandoc) or write a dedicated Obsidian plugin that controls a hidden Electron window and calls `printToPDF`; do not assume Obsidian's private renderer/export internals are a stable Node API.

## 1. Obsidian CLI and PDF flags

**Claim:** Obsidian now has an official CLI, but it requires the Desktop app and is not a separate headless renderer.

**Evidence:** The official help says CLI controls Obsidian for scripting/automation, then explicitly states “Obsidian app must be running”; the first command may launch it. ([official source](https://github.com/obsidianmd/obsidian-help/blob/a3985b585904ddb9f109bd80849b378085308c15/en/Extending%20Obsidian/Obsidian%20CLI.md#L5-L7), [runtime requirement](https://github.com/obsidianmd/obsidian-help/blob/a3985b585904ddb9f109bd80849b378085308c15/en/Extending%20Obsidian/Obsidian%20CLI.md#L26-L33))

**Claim:** The documented CLI has no `pdf`, `export-pdf`, or `print-to-pdf` command.

**Evidence:** The complete official command page contains file, workspace, plugin, developer, and `eval` commands; the only `export` match in the current file is unrelated PATH text. The developer `eval` command is documented as executing JavaScript and returning its result. ([command reference](https://github.com/obsidianmd/obsidian-help/blob/a3985b585904ddb9f109bd80849b378085308c15/en/Extending%20Obsidian/Obsidian%20CLI.md#L1419-L1425), [full current reference](https://github.com/obsidianmd/obsidian-help/blob/a3985b585904ddb9f109bd80849b378085308c15/en/Extending%20Obsidian/Obsidian%20CLI.md))

**Claim:** CLI can reach command-palette commands, JavaScript, and CDP, so it can automate the existing UI command but not necessarily a noninteractive file export.

**Evidence:** Official docs expose developer commands including `dev:cdp`, `eval`, DOM inspection, screenshots, and command execution. ([official CLI docs](https://github.com/obsidianmd/obsidian-help/blob/29e89022/en/Extending%20Obsidian/Obsidian%20CLI.md))

**Forum evidence:** The Obsidian feature-request thread records the concrete current limitation: `obsidian command id="workspace:export-pdf"` opens the export dialog; `obsidian eval ...` can click the modal button, but choosing the path and clicking Save still require GUI interaction. ([forum thread](https://forum.obsidian.md/t/export-pdf-via-command-line/19066))

## 2. `--headless` / `--print-to-pdf`

**Claim:** `--print-to-pdf` is a Chromium/Chrome-style flag, not a documented Obsidian or Electron PDF-export API.

**Evidence:** Electron's official supported-switch list documents Electron switches, Node flags, and Chromium flags, but does not list `--print-to-pdf`; it warns that Chromium switches are not a complete, guaranteed Electron interface. ([Electron switch documentation](https://github.com/electron/electron/blob/6fb81079ed728a62a3056a37f698edee7738cac8/docs/api/command-line-switches.md#L1-L10), [Chromium-switch caveat](https://github.com/electron/electron/blob/6fb81079ed728a62a3056a37f698edee7738cac8/docs/api/command-line-switches.md#L150-L164))

**Claim:** Electron does not support native `--headless` application mode in the normal Electron runtime.

**Evidence:** Electron issue #29164 is specifically a feature request to run Electron without Xvfb; issue #26974 reports Electron crashing with `--headless`, and the discussion concludes: “Electron does not support `--headless`.” ([feature request](https://github.com/electron/electron/issues/29164), [issue and conclusion](https://github.com/electron/electron/issues/26974))

**Obsidian-specific evidence:** Forum users have found `--ozone-platform=headless` can make some Obsidian CLI invocations work over SSH, while another 2026 setup uses Xvfb plus GPU flags. Obsidian staff/user discussion describes this as an unsupported workaround and distinguishes Desktop CLI from the separate Sync-only Obsidian Headless product. ([ozone workaround](https://forum.obsidian.md/t/a-complete-terminal-based-version-of-obsidian-headless-no-gui/111137/6), [Xvfb setup and caveats](https://forum.obsidian.md/t/running-obsidian-headlessly-on-ubuntu-for-ai-agent-workflows-xvfb-systemd-setup/112741), [unsupported-status discussion](https://forum.obsidian.md/t/a-complete-terminal-based-version-of-obsidian-headless-no-gui/111137))

## 3. Display server / Xvfb requirement

**Claim:** Electron apps on Linux traditionally need a display driver even if no window is shown; Xvfb supplies an invisible virtual X11 display.

**Evidence:** Electron's official headless-CI guide says Electron is based on Chromium, requires a display driver, fails to launch if Chromium cannot find one, and recommends Xvfb with `DISPLAY`. ([official Electron guide](https://github.com/electron/electron/blob/6fb81079ed728a62a3056a37f698edee7738cac8/docs/tutorial/testing-on-headless-ci.md#L1-L12))

**Claim:** `show: false` suppresses presentation, not rendering/display initialization.

**Evidence:** Electron documents `BrowserWindow({show: false})` as a window that can later be shown, while noting its renderer is still considered visible and paints. ([BrowserWindow docs](https://github.com/electron/electron/blob/6fb81079ed728a62a3056a37f698edee7738cac8/docs/api/browser-window.md#L39-L55))

**Qualification:** Newer Chromium/Ozone combinations may allow experimental `--ozone-platform=headless` behavior in particular builds, but this is not equivalent to supported Obsidian headless mode. For reproducible Linux deployment, Xvfb remains the evidence-backed baseline.

## 4. `obsidian://` protocol and PDF export

**Claim:** Core Obsidian URI supports actions such as open/new/daily/search, not PDF export or arbitrary command execution.

**Evidence:** Official URI documentation lists the built-in actions and format; no export/print action is listed. ([official URI docs](https://github.com/obsidianmd/obsidian-help/blob/a3985b585904ddb9f109bd80849b378085308c15/en/Extending%20Obsidian/Obsidian%20URI.md#L9-L26))

**Claim:** Advanced URI can execute an Obsidian command by ID and optionally click the first visible CTA, making `workspace:export-pdf` partially automatable.

**Evidence:** Advanced URI source calls `this.app.commands.executeCommandById(parameters.commandid)`, and its `confirm` path waits then clicks `.mod-cta`. ([command execution](https://github.com/Vinzent03/obsidian-advanced-uri/blob/60906cbac111551361a977ecaf8aa265eb54659c/src/handlers.ts#L242-L256), [confirm click](https://github.com/Vinzent03/obsidian-advanced-uri/blob/60906cbac111551361a977ecaf8aa265eb54659c/src/handlers.ts#L258-L267)) Its parameter types explicitly include `commandid` and `confirm`. ([types](https://github.com/Vinzent03/obsidian-advanced-uri/blob/60906cbac111551361a977ecaf8aa265eb54659c/src/types.ts#L153-L158), [confirm type](https://github.com/Vinzent03/obsidian-advanced-uri/blob/60906cbac111551361a977ecaf8aa265eb54659c/src/types.ts#L197-L199))

**Forum evidence:** The documented community workaround is `obsidian://adv-uri?commandid=workspace%3Aexport-pdf&confirm=true`; the same thread says path selection and native Save remain manual. ([forum evidence](https://forum.obsidian.md/t/export-pdf-via-command-line/19066))

## 5. Community scripting / CLI automation

**Claim:** Community plugins provide substantial in-app scripting and shell automation, but they execute inside a running Obsidian process.

**Evidence:** Shell Commands lets users define terminal commands, exposes them in Obsidian's command palette/hotkeys, and supports note variables. ([README](https://github.com/Taitava/obsidian-shellcommands/blob/5e824229b246e180a1c06a3333184197aa3e7c07/README.md#L1-L7), [command registration/use](https://github.com/Taitava/obsidian-shellcommands/blob/5e824229b246e180a1c06a3333184197aa3e7c07/README.md#L28-L34))

**Claim:** Plugin REPL, CodeScript Toolkit, CustomJS, JS Engine, and Execute Code are real scripting options; some expose `app`/plugin APIs or startup/invocable scripts.

**Evidence:** Plugin REPL states it executes JavaScript in Obsidian and exposes `app`, `editor`, and plugin objects. ([repo](https://github.com/talwrii/plugin-repl/blob/75d5dc0f4e5b2df7dbe2c91ba652690f2500ea55/README.md#L1-L12), [API objects](https://github.com/talwrii/plugin-repl/blob/75d5dc0f4e5b2df7dbe2c91ba652690f2500ea55/README.md#L64-L89)) CodeScript Toolkit states scripts can run from notes, commands, hotkeys, startup, or an `obsidian://` URL, and can explore public/internal APIs at runtime. ([repo](https://github.com/mnaoumov/obsidian-codescript-toolkit/blob/2556392c042fd0198bd395962f60636d2b782155/README.md#L1-L15)) Execute Code supports persistent output which can then be exported to PDF, but it is a note code-block executor, not a headless Obsidian service. ([repo](https://github.com/twibiral/obsidian-execute-code/blob/1ad683d7b2013554c3863d9e843f9fd3b116c7c0/README.md#L1-L15))

**Official API boundary:** Obsidian's API repository describes `main.js` as a plugin entry point, imports `obsidian`/Node/Electron from the plugin context, and exposes `this.app` to plugins. ([official API README](https://github.com/obsidianmd/obsidian-api/blob/cc1744324150c632416857c98964f87b1574a5fc/README.md#L1-L30))

## 6. `webContents.printToPDF()` without a visible window

**Claim:** Yes. Electron's API returns PDF bytes from a page's `webContents`; it does not require calling the visible print dialog.

**Evidence:** Official Electron docs specify `Returns Promise<Buffer>`, “Prints the window's web page as PDF,” and show loading a `BrowserWindow`, waiting for `did-finish-load`, calling `printToPDF`, then writing the buffer. ([API docs](https://github.com/electron/electron/blob/6fb81079ed728a62a3056a37f698edee7738cac8/docs/api/web-contents.md#L1894-L1932))

**Claim:** A visible native window is unnecessary at the API level, but a renderer/window object is still required; `show: false` is the normal pattern.

**Evidence:** Combine Electron's hidden-window documentation ([`show: false`](https://github.com/electron/electron/blob/6fb81079ed728a62a3056a37f698edee7738cac8/docs/api/browser-window.md#L39-L55)) with the `printToPDF` example above. The Electron PR that refactored printing explicitly aligned it with Chromium's headless print implementation. ([refactor PR](https://github.com/electron/electron/pull/33654))

## 7. Loading Obsidian's renderer / internal API from Node.js

**Claim:** There is no documented supported way for an external Node.js process to import Obsidian's renderer and obtain its internal `app` object. Obsidian's supported API model is a plugin loaded by Obsidian.

**Evidence:** Official API README requires a plugin `main.js`, says it imports `obsidian`/Node/Electron, and places the application object at `this.app`; it does not describe a Node-side package or renderer bootstrap. ([official API README](https://github.com/obsidianmd/obsidian-api/blob/cc1744324150c632416857c98964f87b1574a5fc/README.md#L14-L30))

**What is possible:** External Node can attach to an already-running Obsidian instance through the official CLI's `eval`/CDP facilities, or a plugin can execute code in-process. CodeScript Toolkit explicitly advertises runtime exploration of public/internal APIs, which confirms the access is in-app/runtime injection, not a supported standalone Node import. ([official CLI `eval`](https://github.com/obsidianmd/obsidian-help/blob/a3985b585904ddb9f109bd80849b378085308c15/en/Extending%20Obsidian/Obsidian%20CLI.md#L1419-L1425), [CodeScript Toolkit](https://github.com/mnaoumov/obsidian-codescript-toolkit/blob/2556392c042fd0198bd395962f60636d2b782155/README.md#L1-L15))

**Risk:** Private Obsidian bundles, renderer objects, DOM selectors, and native export dialogs are implementation details. The forum's PDF automation reports that the native save path is not exposed through the renderer-side APIs, and the community workaround relies on UI clicks. ([forum report](https://forum.obsidian.md/t/export-pdf-via-command-line/19066), [save-dialog discussion](https://forum.obsidian.md/t/export-to-pdf-remember-save-location-or-options-for-default-location/116106))

## Recommended architecture

1. If fidelity to Obsidian rendering is mandatory: run Obsidian Desktop under Xvfb; install a small plugin or use Advanced URI/official CLI to open the note and invoke the command. Expect UI/save-dialog fragility.
2. If unattended PDF path/output is mandatory: use a separate renderer (Markdown → HTML → Playwright/Chromium PDF, Pandoc, or similar) and reproduce only the Obsidian CSS/features needed.
3. If a custom Electron wrapper is acceptable: load/render the note in a hidden `BrowserWindow` and call `webContents.printToPDF()` from the main process. This proves the Electron PDF mechanism, not that Obsidian's proprietary renderer can be transplanted into Node.
