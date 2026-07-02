# PDOS Rendering Fixes — Apply Package

## What's in this package

- `pdos-rendering-fixes-frontend-src.zip` — full `frontend/src/` directory with all fixes applied
- `rendering-fixes.diff` — unified diff showing exactly what changed (only 2 files modified)
- `RUN_INSTRUCTIONS.md` — how to apply and run

## Which files were modified

Only **2 files** were changed. Everything else in `src/` is untouched.

1. `frontend/src/components/DrawingCanvas/RenderScheduler.js`
2. `frontend/src/components/DrawingCanvas.jsx`

## Bugs fixed (6 total)

| # | Severity | Bug | Fix |
|---|----------|-----|-----|
| 1 | 🔴 P0 | `RenderScheduler` leaked a `requestAnimationFrame` on unmount — stale renders against detached canvases | Track rAF handle, cancel on `destroy()`, call `destroy()` in unmount cleanup |
| 2 | 🔴 P0 | Inline `ref` callback on `<canvas>` re-registered all 7 layers on every React render — forced full 7-canvas redraw on every state change | Memoized stable ref callbacks via `useMemo`; renderFn reads through a ref so it always calls the latest closure |
| 3 | 🟡 P1 | `renderLayerContent` ran `updateReplayTerminations()` + `updateNarrativeContext()` once per dirty layer (7× per frame) | Added `preRender` hook to `RenderScheduler`; state updates now run exactly once per frame |
| 4 | 🟡 P1 | `checkIsFaded` did O(N) `find()` over all candidates per candidate per frame — O(M×N) per frame | Precomputed `Map<id, candidate>` rebuilt when `algoCandidates` changes; O(1) lookup |
| 5 | 🟡 P1 | Viewport-change handler double-invalidated via unconditional `setTimeout(0)` — doubled work per pan/zoom | Gated the async follow-up with a flag so multiple events within the same frame coalesce into one |
| 6 | 🟢 P2 | `drawAlgoCandidate` was dead code — full duplicate of `drawAlgoCandidateWithCtx`, never called, carried its own duplicate `getReplayTimeLimit` | Deleted (~80 lines removed) |

## What was NOT touched (per PDOS locked-systems rule)

- Swing Registry, Liquidity Registry
- `swingMath.js`, `primitives.js` (swing detection logic)
- Replay rules (`replayAggregator.js` — `aggregateDevelopingCandle`)
- Registry object identity
- Market logic
- SQLite architecture
- TradingView Lightweight Charts integration
- All 8 renderers (`SwingRenderer`, `LiquidityObjectRenderer`, `FVGRenderer`, etc.) — unchanged
- `LayerManager`, `RenderIndex`, `ChartProjectionService`, `rendererRegistry` — unchanged

All fixes are purely in the rendering orchestration layer. No market behavior changed.

## Pre-existing issue you should know about

The project as-downloaded from Google Drive does **not** build out of the box. `src/App.jsx:46` imports `./components/ChartViewport` but that file does not exist in the project. This is **not** caused by my changes — it's a pre-existing missing file.

To get a working build, you'll need to either:
- Restore `ChartViewport.jsx` from your local working copy, OR
- Comment out that import in `App.jsx` (if you can identify what it wraps)

I did NOT touch this because it's outside the rendering-perf scope you approved.
