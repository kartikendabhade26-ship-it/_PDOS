# PDOS Bug Fixes — Round 2: Validation Suite + DB Integrity

## Summary

Ran the project's own validation suite (`validation/run_validation.js`) to surface real bugs. Found 4 failures, fixed the 1 that was a genuine code bug, and documented the other 3 (data/benchmark issues that need a re-sync, not code changes).

## Results: Before → After

| Check | Before | After |
|-------|--------|-------|
| Swing pivot counts | 🔴 FAILED | 🔴 FAILED (stale benchmark — see below) |
| Equal clusters touches | 🟢 PASSED | 🟢 PASSED |
| Liquidity Registry Foundation | 🟢 PASSED | 🟢 PASSED |
| Dealing range premium/discount | 🔴 FAILED | 🔴 FAILED (stale benchmark — see below) |
| PD Array Matrix | 🔴 FAILED | 🔴 FAILED (test DB incomplete — see below) |
| Performance & Memory | 🟢 PASSED | 🟢 PASSED |
| **DB Integrity & Constraints** | **🔴 FAILED** | **🟢 PASSED** ✅ |
| Canvas Rendering Projection | 🟢 PASSED | 🟢 PASSED |

## Bug fixed: FK violation in `detector_versions` (REAL CODE BUG)

**Root cause:** `algo/db.js` seeds 25 detector versions into `detector_versions`, but `algo/pipeline.js:330` tags every degree-2+ swing with `detector_id = 'SWING_HIERARCHY_v1'` — an ID that was never seeded. Result: 37,168 orphaned rows in the test DB (49,433 in prod) failing `PRAGMA foreign_key_check`.

**Fix:** Added one line to the `seedVersions` array in `algo/db.js`:

```js
{ id: 'SWING_HIERARCHY_v1', type: 'swing_hierarchy', desc: 'Degree-2+ (ITH/ITL/LTH/LTL) hierarchical swing pivot detector' },
```

**Backfill:** Existing databases don't need a full re-sync. Run:
```bash
USE_TEST_DB=true node backfill_swing_hierarchy_detector.js   # test DB
node backfill_swing_hierarchy_detector.js                     # prod DB
```

This inserts the missing row so all 37k/49k existing `structure_events` rows immediately have a valid parent. Verified: `PRAGMA foreign_key_check` returns 0 violations after backfill.

## Issues NOT fixed (and why)

### 1. Swing pivot counts — stale benchmark
The benchmark file `validation/benchmark_sessions/nq_session_2026_06_15.json` expects swings at timestamps `1736237040` (2025-01-07 08:04 UTC) and `1736237460` (08:31 UTC). **No 1m bars exist at those timestamps in `market_research_test.db`** — the CSV doesn't contain those minutes. Swings ARE detected nearby (08:05, 08:10, 08:30) and 157,115 swings total exist in the DB. The swing engine is working correctly; the benchmark was written against a different dataset.

**Cannot fix without violating the swing-math lock** (`AGENTS.md`: "DO NOT MODIFY the swing detection logic in primitives.js"). The correct fix is to regenerate the benchmark against the current CSV.

### 2. Dealing range premium/discount — stale benchmark
Same root cause. Benchmark expects a dealing range at `priceHigh=22866.75, priceLow=22860.625`, but no bars at that price level exist in the loaded dataset. The dealing range engine can only produce zones where bars exist.

### 3. PD Array Matrix — test DB incomplete
The test DB contains only `Swings` (157k) and `Liquidity` (70k) events. No `PD Array Matrix`, `Dealing Range`, `Structure Breaks`, or other downstream engine events exist. The PD Array engine (`pdArrayContextEngine`) requires an active dealing range to produce output (`pipeline.js:350`), so it correctly produces nothing when dealing ranges aren't present. **This is the existing state of the synced data**, not a code bug. A full re-sync from the CSV would populate these.

### 4. Missing `ChartViewport.jsx` (frontend build blocker)
`src/App.jsx:46` imports `./components/ChartViewport` but the file is absent from the Google Drive folder. This component takes ~80 props and is the entire chart viewport (two TradingView charts, drawing tools, replay controls, algo overlays) — roughly 1,500+ lines of JSX. **I cannot reconstruct this blind** without inventing a major component that would break your actual workflow. You must restore this file from your local working copy.

## Files in this package

```
pdos-bugfixes/
├── db.js                                  # patched algo/db.js (1 line added to seedVersions)
└── backfill_swing_hierarchy_detector.js   # one-time backfill for existing DBs
```

## How to apply

```bash
# 1. Patch db.js (so future syncs seed the missing detector)
cp pdos-bugfixes/db.js "Project 1 MNQ data/algo/db.js"

# 2. Backfill existing databases (no re-sync needed)
cd "Project 1 MNQ data"
USE_TEST_DB=true node backfill_swing_hierarchy_detector.js   # test DB
node backfill_swing_hierarchy_detector.js                     # prod DB

# 3. Verify
node --expose-gc validation/run_validation.js
# DB Integrity & Constraints should now show 🟢 PASSED
```

## What was NOT touched

- Swing Registry, Liquidity Registry
- `swingMath.js`, `primitives.js` (swing detection — locked)
- Replay rules, registry object identity, market logic
- SQLite schema (only the seed data array changed)
- All engines, all renderers, all frontend components except `db.js`
