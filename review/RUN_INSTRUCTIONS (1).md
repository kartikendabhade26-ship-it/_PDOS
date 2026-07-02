# PDOS Rendering Fixes — Run Instructions

## Option A: Drop-in replace your `src/` (recommended)

You already have the full project locally. To apply only the rendering fixes:

```bash
# 1. Backup your current frontend/src (safety net)
cd "Project 1 MNQ data/frontend"
cp -r src src.backup.$(date +%Y%m%d)

# 2. Extract the fixed src/ over your existing one
unzip -o pdos-rendering-fixes-frontend-src.zip -d .

# 3. Install deps (only needed if you haven't already)
npm install

# 4. Start the dev server
npm run dev
```

Then open the URL Vite prints (usually `http://localhost:5173`).

## Option B: Apply only the 2 changed files manually

If you don't want to replace your entire `src/` (e.g. you have local edits elsewhere), copy just these 2 files:

```
src/components/DrawingCanvas/RenderScheduler.js
src/components/DrawingCanvas.jsx
```

from the zip into the same paths in your project.

## Option C: Review the diff first

Open `rendering-fixes.diff` in any text editor or run:

```bash
git apply --stat rendering-fixes.diff   # see what changes
git apply rendering-fixes.diff          # apply (run from project root)
```

## Verifying the fixes work

After starting the dev server:

1. **Pan/zoom the chart** — should feel noticeably smoother (Bug 2 + 5). Previously every pan triggered a full 7-canvas redraw; now only the layers that need it redraw.

2. **Scrub the replay timeline** — should be less janky (Bug 3). Previously replay-termination logic ran 7× per frame (once per layer); now once per frame.

3. **Toggle narrative mode with many candidates visible** — fading should be instant (Bug 4). Previously `checkIsFaded` did a linear scan of all candidates for every visible candidate every frame.

4. **Unmount/remount the chart component** (e.g. switch symbols or tabs) — no console errors from stale rAF callbacks (Bug 1).

## Production build

```bash
npm run build
```

**Note:** The project has a pre-existing issue — `src/App.jsx` imports `./components/ChartViewport` which doesn't exist in the Drive folder. This blocks `npm run build` regardless of my changes. You'll need to restore that file from your local copy before building. The dev server (`npm run dev`) may still work depending on how Vite resolves the missing module at runtime.

## If something breaks

All 6 fixes are individually reversible. Each fix is marked with a `Bug N fix:` comment in the code. To revert a single fix, search for its comment and restore the original code from `rendering-fixes.diff` (the `-` lines in the diff are the originals).
