# Simple Song Book

Simple Song Book is a Vite and TypeScript app for the Even Realities G2 platform. It presents a pageable songbook on the glasses, with a small companion web UI for status, page selection, and importing custom songbook content.

The app is designed for compact performance material such as chord charts, set lists, lyric prompts, and reference images. Pages can be plain text or PNG images. Users can move through pages with G2 gestures or by selecting a page from the browser/simulator UI.

## Features

- Loads a bundled songbook from `public/content.json`.
- Supports text pages with either one `content` string or a `lines` array.
- Supports image pages that reference PNG files.
- Renders text directly into an Even Hub text container.
- Renders image pages by scaling them to the G2 display area and splitting them into four image containers.
- Provides an on-screen page index in the companion UI.
- Allows custom songbooks to be imported from a JSON file plus optional PNG assets.
- Persists imported songbooks across reloads.
- Falls back to IndexedDB storage when Even Hub local storage is not available, which is useful in simulator/browser contexts.
- Wraps page navigation at the beginning and end of the songbook.

## Project Structure

```text
.
+-- app.json              # Even app metadata and entrypoint declaration
+-- index.html            # Companion UI shell
+-- package.json          # npm scripts and dependencies
+-- public/
|   +-- content.json      # Bundled default songbook
|   +-- G2slides.png      # Example image page asset
|   +-- hotel.png         # Example image page asset
|   +-- numbers.png       # Example image page asset
+-- src/
|   +-- main.ts           # App logic, bridge integration, import, storage, rendering
|   +-- style.css         # Companion UI styles
+-- *.ehpk                # Existing packaged app artifacts
```

## Runtime Overview

On startup, `src/main.ts` waits for the Even Hub bridge by calling `waitForEvenAppBridge()` from `@evenrealities/even_hub_sdk`.

After the bridge is available, the app loads songbook data in this order:

1. Saved songbook data from Even Hub local storage.
2. Saved songbook data from IndexedDB, used as simulator/browser fallback storage.
3. The bundled default songbook at `/content.json`.
4. A small hard-coded fallback songbook if `/content.json` cannot be fetched or parsed.

The current page is then rendered to the glasses:

- Text pages use a single `TextContainerProperty` covering the 576 x 288 display area.
- Image pages are fetched, scaled into a 576 x 288 white canvas, split into four 288 x 144 quadrants, and sent as four `ImageContainerProperty` objects.
- Image pages also include an invisible full-screen text container with `isEventCapture: 1` so gesture events can still be received.

When the current page changes, the app rebuilds the page containers and updates the companion UI status and selected page index item.

## Navigation

The app listens for Even Hub text events from the event-capturing container:

- Event type `1`, swipe up / scroll top, moves to the previous page.
- Event type `2`, swipe down / scroll bottom, moves to the next page.

Navigation wraps around:

- Moving backward from the first page opens the last page.
- Moving forward from the last page opens the first page.

In the companion UI, each page title appears in the page index. Clicking a page title jumps directly to that page.

## Companion UI

The HTML page provides:

- A heading, `Songbook`.
- A status line showing connection, loading, rendering, import, and error states.
- An `Import` button.
- A hidden file input that accepts `.json` and `.png` files.
- A page index populated from the loaded songbook.

The UI is useful in the Even Hub simulator and during development because it exposes the loaded page list and the current render status.

## Songbook Content Format

The default songbook lives at `public/content.json`. A songbook can be either:

- An object with a `pages` array.
- A bare array of page objects.

Each page must have a `type` of either `text` or `image`.

### Text Pages

Text pages require either `content` or `lines`.

```json
{
  "type": "text",
  "title": "Still the Same - Bob Seger",
  "lines": [
    "Still the Same, Bob Seger",
    "|CM7 C |CM7 C Cadd9 |Em |G |",
    "Verse 2x",
    "Chorus 2x"
  ]
}
```

The equivalent using `content` is:

```json
{
  "type": "text",
  "title": "Short Note",
  "content": "Line one\nLine two\nLine three"
}
```

Fields:

- `type`: must be `"text"`.
- `title`: optional. Used in the page index.
- `lines`: optional array of strings. Joined with newline characters.
- `content`: optional string. Used directly as the text page content.

At least one of `lines` or `content` must be present, and the resulting text must not be empty.

### Image Pages

Image pages reference PNG files.

```json
{
  "type": "image",
  "title": "Hotel chart",
  "src": "hotel.png"
}
```

Fields:

- `type`: must be `"image"`.
- `title`: optional. Used in the page index.
- `src`: required image source.

If `src` is a relative path such as `hotel.png`, the bundled app resolves it from the public root as `/hotel.png`. Absolute paths, data URLs, and fully qualified URLs are used as provided.

For imported songbooks, image lookup supports:

- The exact `src` value.
- The normalized asset key without leading `./` or `/`.
- The base file name.

This allows `src` values such as `charts/hotel.png` to match an imported file with a browser-provided relative path, while also allowing simple file-name matches.

## Page Titles

Page index labels are derived in this order:

1. The page's explicit `title`.
2. For image pages, the `src` value.
3. For text pages, the first non-empty line.
4. `Untitled`, if no other label can be found.

## Importing a Custom Songbook

Use the `Import` button in the companion UI to select files.

The import must include one JSON file. It may also include one or more PNG files used by image pages.

Example selection:

```text
content.json
hotel.png
numbers.png
charts/intro.png
```

Import behavior:

1. The app finds the first selected JSON file.
2. The JSON is parsed and validated as songbook content.
3. Selected PNG files are converted into in-memory image assets.
4. The current songbook is replaced.
5. The page index is rebuilt.
6. The first page is rendered.
7. The imported songbook is saved for later launches.

If no JSON file is selected, the status line asks the user to choose a `content.json` file.

If parsing fails, the status line displays the validation error. Common errors include an empty page list, an image page without `src`, or a text page without non-empty text.

## Persistence

Imported songbooks are persisted so that custom content survives reloads.

The app first tries to save through the Even Hub bridge:

- Manifest key: `songbook-g2:manifest`
- Image chunk keys: `songbook-g2:asset:{assetIndex}:{chunkIndex}`
- Image chunks are stored as data URL strings split into chunks of 50,000 characters.

If bridge local storage is unavailable or times out, the app saves the same logical songbook to IndexedDB:

- Database: `songbook-g2`
- Object store: `songbooks`
- Record ID: `current`

On the next launch, bridge storage takes precedence over IndexedDB. IndexedDB is primarily a simulator/development fallback.

## Image Rendering Details

The G2 display target used by this app is 576 x 288 pixels.

For each image page:

1. The image is fetched from the resolved source URL.
2. It is decoded with `createImageBitmap`.
3. It is scaled to fit within 576 x 288 while preserving aspect ratio.
4. It is centered on a white 576 x 288 canvas.
5. The canvas is split into four quadrants:
   - Top left: 0, 0, 288 x 144
   - Top right: 288, 0, 288 x 144
   - Bottom left: 0, 144, 288 x 144
   - Bottom right: 288, 144, 288 x 144
6. Each quadrant is encoded as PNG bytes and sent to the matching Even Hub image container.

This split is necessary because the app renders a full display image through four smaller image containers.

## Development

Install dependencies:

```bash
npm install
```

Run the Vite development server:

```bash
npm run dev
```

Build the app:

```bash
npm run build
```

Preview the production build:

```bash
npm run preview
```

The browser page expects an Even Hub bridge. If it is opened outside the simulator or glasses environment, it will eventually show:

```text
Could not connect to Even Hub bridge. Run this in the simulator or on glasses.
```

That message is expected when the bridge is not injected.

## Running in the Even Hub Simulator

The desktop simulator injects the Even Hub bridge that this app waits for on startup. Running the Vite page in a normal browser is useful for checking the HTML shell, but the songbook will not render to the glasses display unless the page is opened by the simulator or on real glasses.

Start the local dev server:

```bash
npm run dev
```

Vite normally serves this project at:

```text
http://localhost:5173
```

In a second terminal, launch the simulator against that URL:

```bash
npx evenhub-simulator http://localhost:5173
```

If Vite chooses a different port because `5173` is already in use, copy the actual localhost URL printed by `npm run dev` and pass that to the simulator instead.

Useful simulator variants:

```bash
npx evenhub-simulator -g http://localhost:5173
npx evenhub-simulator -b spring http://localhost:5173
npx evenhub-simulator http://localhost:5173 --automation-port 9898
```

- `-g` enables the simulator glow effect, which is useful for checking G2-style readability.
- `-b spring` enables spring-style bounce animation.
- `--automation-port 9898` exposes a local HTTP API for scripted input, screenshots, and console capture.

If `npx evenhub-simulator` is not available, install the simulator globally:

```bash
npm install -g @evenrealities/evenhub-simulator
```

Then run:

```bash
evenhub-simulator http://localhost:5173
```

### Simulator Controls for This App

The simulator supports up, down, click, and double-click inputs. This app listens for scroll events:

- Up / swipe up moves to the previous songbook page.
- Down / swipe down moves to the next songbook page.
- Click and double-click are not currently handled by this app.

The page index and `Import` button remain available in the simulator's web UI. Use them to jump directly to a page or import a custom `content.json` plus PNG files while testing.

### Screenshots

Click the simulator display to export the current glasses framebuffer as an RGBA PNG in the current working directory. The simulator prints the saved file path to stdout and to the web inspector console.

When automation is enabled, the glasses screenshot is also available from:

```text
http://127.0.0.1:9898/api/screenshot/glasses
```

### Automation API

With `--automation-port 9898`, common simulator endpoints include:

- `GET /api/ping`: health check.
- `GET /api/screenshot/glasses`: current 576 x 288 glasses framebuffer.
- `GET /api/screenshot/webview`: companion WebView screenshot.
- `GET /api/console`: captured console output and uncaught errors.
- `DELETE /api/console`: clear captured console output.
- `POST /api/input`: send input with a JSON body such as `{ "action": "down" }`.

Supported input actions are `up`, `down`, `click`, and `double_click`.

Example input request:

```bash
curl -X POST http://127.0.0.1:9898/api/input \
  -H 'Content-Type: application/json' \
  -d '{"action":"down"}'
```

Allow a few seconds after launching the simulator before sending automated input so the bridge can initialize and the first page container can be created.

### Simulator Limitations

The simulator is for development and layout testing, not a complete replacement for real G2 hardware. Known differences include:

- Font rendering can differ from the firmware display.
- Image processing is faster and may not enforce the same hardware memory limits.
- Error handling can differ in edge cases.
- Device status events are not emitted.
- The input `eventSource` is hardcoded by the simulator.
- IMU data is not representative of real device motion.

Before distributing a package, verify the songbook on real glasses as well as in the simulator.

## App Metadata

`app.json` defines the Even app package metadata:

```json
{
  "package_id": "com.timd.songbook",
  "edition": "202601",
  "name": "Simple Song Book",
  "version": "0.1.1",
  "min_app_version": "2.0.1",
  "min_sdk_version": "0.0.10",
  "entrypoint": "index.html",
  "permissions": [],
  "supported_languages": ["en"]
}
```

The entrypoint is `index.html`, which loads `src/main.ts` during development and is bundled by Vite for production.

## Updating the Default Songbook

To change the built-in songbook:

1. Edit `public/content.json`.
2. Add any referenced PNG files to `public/`.
3. Use relative `src` values that match the public file names or paths.
4. Run `npm run build` to verify the TypeScript and Vite build.

Imported content saved on a device takes precedence over the bundled `public/content.json`. If an imported songbook is present, editing `public/content.json` will not change what that device loads until the saved songbook is replaced.

## Troubleshooting

### The app says it cannot connect to the bridge

The page is running without the Even Hub bridge. Open it in the Even Hub simulator or on the glasses.

### Import says a text page is invalid

A text page must include either:

- `content`: a non-empty string.
- `lines`: an array of strings that becomes non-empty when joined.

### An image page does not appear

Check that:

- The page has `"type": "image"`.
- The `src` value is non-empty.
- The referenced image is a PNG.
- For bundled content, the file exists under `public/`.
- For imported content, the PNG was selected alongside the JSON file.

### Imported content loads but is not saved

The app tries bridge storage first and then IndexedDB. If both fail, the imported content can still render for the current session, but it will not survive reloads. Check the browser console or simulator logs for storage errors.

### Old imported images appear after a new import

The app clears obsolete bridge image chunks after saving a new manifest. If cleanup fails, it logs a warning, but the new manifest should still control which chunks are read on the next launch.

## Implementation Notes

- `parseSongbookJson` validates imported and bundled songbooks.
- `loadStoredSongbook` chooses saved device/simulator content before the bundled file.
- `saveStoredSongbook` persists imported content with bridge storage first and IndexedDB second.
- `scaleAndSplitImage` performs the 576 x 288 canvas scaling and quadrant extraction.
- `createStartupPage` creates the initial Even Hub containers.
- `updatePageContent` rebuilds containers when the selected page changes.
- `renderPageIndex` keeps the companion page list in sync with the active songbook.
