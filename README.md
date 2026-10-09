# Searcher

Windows F2 launcher powered by [fff](https://github.com/dmtrKovalenko/fff). Local fuzzy file and folder search, installed app launching, and live text-content search with persistent frequency/recency ranking.

## Run

Requires Windows x64/ARM64 and Node.js 22.12+. Run `npm install` then `npm start`, or double-click **Start-Searcher.vbs** after installing dependencies. Searcher stays in the system tray. Right-click its tray icon to quit.

- **F2** opens/hides the dialog. This reserves F2 globally while Searcher runs, including Explorer's usual rename shortcut.
- Type to search; use **Up/Down**, **Enter**, **Escape**.
- **Ctrl+Enter** reveals a file in Explorer. Double-click opens it. Selected rows also offer Copy and Reveal.
- **Ctrl+1/2/3/4** selects All, Apps, Files & folders, or Content.
- **Ctrl+,** opens settings: add/remove folders or drives, rebuild indexes, and opt into Windows sign-in startup.

## Scope and performance

Defaults cover existing personal folders, project folders, and OneDrive roots. Add other locations in Settings. It doesn't index the entire system drive by default. fff respects ignore files, skips directory symlinks and inaccessible files, and watches indexed folders for changes. OneDrive files must be available locally for content search; indexing cloud folders may cause Windows/OneDrive disk activity.

Content search covers text/code up to 5 MB, with matching line snippets. It doesn't extract PDF/Office documents, scan image text, or read cloud-only content. Enter opens the file in its associated app; it doesn't navigate the app to the matching line.

The first scan runs in the background; startup scans are rebuilt by fff. A separate child process keeps native search off the UI thread. Search inputs debounce 55 ms. All mode paints app/file results first, then adds content matches asynchronously. Native content searches have a 25 ms per-root time budget and offer **Search more file contents** to continue partial scans. All mode initially groups up to 12 apps, 55 files/folders, and 30 content matches, so one category cannot crowd out the others. Other tabs return up to 100 results per request. Timing shown measures native search and merging, excluding IPC and rendering; no universal sub-millisecond claim is made.

App inventory comes from Windows `Get-StartApps`, refreshed on startup/reindex. Portable executables outside Start Menu registration appear as files if their folders are indexed. Frequency boosts learn from files/apps opened through Searcher, rather than monitoring all Windows activity.

Settings, local databases, engine diagnostics, and usage history are stored in `.data/` beside the checkout and excluded from Git. No search queries or file contents are sent to a server. Dependencies download from npm/GitHub during installation.

## Development

`npm test` exercises the real Windows fff binary, file/content/directory search, app ranking, and watcher updates. Set `SEARCHER_SMOKE=1` when launching Electron to generate `smoke-report.json` and `preview.png`, then exit automatically.

The renderer is sandboxed with context isolation, no Node access, a restrictive CSP, and a small preload API. The main process only opens results returned by the engine. This is an initial portable desktop app; there is no installer or system service.
