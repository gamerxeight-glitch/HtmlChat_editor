# DoRoleplay Chat Editor

A standalone, offline editor for chat HTML files, so you can fix a chat before importing it into DoRoleplay (Mac or iPhone).

It opens:
- chat exports from the DoRoleplay apps (Mac and iPhone)
- HTML exports from the [JanitorAI Chat Downloader](https://github.com/Tydorius/janitorai-chat-downloader), which it converts to a full DoRoleplay chat file

## Use
1. Open `index.html` in Safari or Chrome (double-click it). Nothing to install, no network access.
2. Click **Open chat HTML…** or drop the file on the page.
3. Edit, then **Save edited copy** (⌘S). This downloads a new `<name>-edited.html`. Your original file is never changed.
4. Import the edited file in the app. The app asks which character and persona the chat belongs to and pre-selects them by the names set here.

## What you can edit
- Message text, role (character or you), and thinking
- Order: drag the ⠿ handle, or use ↑ ↓
- Delete one message, or select several and delete them together
- Add a message below any message or at the end; split a message at the cursor; merge with the next one
- Swipes (alternative replies): switch, add, delete
- Chat title, character name, persona name (applied to every user message)
- Find and replace across the active text, and tidy stray whitespace
- Undo (⌘Z outside a text box)

Everything else in the file (memory, Memory Graph, script state, per-chat settings, ids) is carried through unchanged.

## Why it exists
Both apps import a chat only from the data block embedded in the HTML (`<script id="doroleplay-chat-data">`), not from the visible page. The iPhone app reads that block strictly: one wrong field type, a date with milliseconds, or a text/swipe mismatch makes it ignore the block and fall back to scraping the page, which loses swipes, memory and settings. The editor keeps the block exact and checks it before saving:
- each message's text equals its active swipe, and the swipe index is valid
- message times are strictly increasing, in whole seconds, in the order shown
- message count, last-message snippet and memory pointers are recalculated after deletes
- it refuses to save, and lists why, if anything would not import

If you delete messages that the Memory Graph refers to, it warns you; the graph itself is kept as is.

## Tests
```
npm test
```
Runs the core format tests with Node's built-in test runner (Node 18+). No dependencies.

## Files
- `index.html`, `style.css`, `app.js` - the editor page
- `core.js` - the chat file format rules (no DOM; shared by the page and the tests)
- `test/core.test.js` - format tests
