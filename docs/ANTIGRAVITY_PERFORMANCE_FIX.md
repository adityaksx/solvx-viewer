# SolvX Viewer — Timeline, Instant Variable Switching & Point Inspector Performance Fix

Repository inspected: `adityaksx/solvx-viewer`

## Objective

Fix the viewer so changing **date/timeline**, **variable**, and **point inspection** feels immediate and deterministic.

Required UX:

1. Changing the timeline/date must update the visible ocean field immediately when data is already cached/prefetched.
2. Variable switching must update the visible field immediately when that variable is present in the active time bundle.
3. Point Inspector must open/update quickly without redundant expensive API calls.
4. Selecting a different timeline range/resolution must automatically fetch and load the data for that selected timeline. No extra manual action should be required after selecting a timeline.
5. Default timeline window must always be the **last 2 months relative to the current system date/time**, not the full historical dataset range.
6. Timeline/date changes must never allow stale responses from an older selection to overwrite the current selection.
7. Keep the existing scientific behavior/features; optimize the data/state flow rather than removing functionality.

---

# 1. Findings from current code

## A. Main timeline slider intentionally waits 200 ms

File:

`frontend/controls/timelineControl.js`

Current behavior:

```js
this.slider?.addEventListener('input', (e) => {
    this.currentIndex = Number(e.target.value);
    this.updateDisplay();
    clearTimeout(sliderDebounce);
    sliderDebounce = setTimeout(() => {
        this.onTimeChange(
            this.currentIndex,
            this.getCurrentTimestamp(),
            this.getCurrentMeta()
        );
    }, 200);
});
```

### Problem

There is an explicit 200 ms debounce before `onTimeChange`.

For a scientific timeline scrubber this creates unnecessary latency, especially when the target timestamp is already cached/prefetched.

### Required change

- Update UI immediately on `input`.
- Call the time-change pipeline immediately for a committed slider value.
- Do not use a 200 ms debounce for normal timeline navigation.
- Avoid duplicate API work by handling request cancellation/deduplication at the data layer.
- For very rapid pointer movement, it is acceptable to coalesce rendering work using `requestAnimationFrame`, but NOT introduce visible hundreds-of-ms debounce latency.

Recommended pattern:

```text
pointer/input
   ↓
set current timestamp immediately
   ↓
read cache immediately
   ↓
apply cached bundle immediately
   ↓
start/replace background fetch for missing data
```

---

# 2. Main timeline data path currently performs redundant work

File:

`frontend/app.js`

Current:

`onTimeChange()` does:

```js
await this.loadTimelineBundle(timeIso);

if (this.layerState.currents ||
    this.layerState.particles ||
    this.activeVar === 'currents') {
    await this.loadCurrents();
}

if (this.activeInspectedPoint &&
    !document.getElementById('readout')?.classList.contains('hidden')) {
    this.inspectPoint(this.activeInspectedPoint);
}
```

### Problems

A single time change can cause:

1. Bundle fetch/load
2. Separate current-field fetch
3. Point inspection fetch
4. More rendering/recomputation

This happens even when the active bundle already contains the current data required by the view.

The separate `loadCurrents()` call is especially important to eliminate/reuse when the bundle already contains current data.

### Required change

Make the active timestamp the single source of truth.

On time change:

```text
timestamp selected
      ↓
check client cache
      ↓
if complete bundle exists:
    apply immediately
    no duplicate fetch
else:
    fetch only missing data
      ↓
apply result
      ↓
refresh dependent UI
```

Do not call a second endpoint for currents if the active time bundle already contains current data.

Only request currents separately when:

- currents are actually needed,
- and the current bundle does not contain sufficient current information for the active visualization/depth.

---

# 3. Variable switching currently has a hidden async delay

File:

`frontend/app.js`

Current `setVariable()`:

```js
async setVariable(varId) {
    this.activeVar = varId;
    this.status(`Switching to ${varId}…`);

    ...
    const depthData = await ApiClient.getOceanDepths(varId);
    ...
    if (this.activeTime && this.bundleCache[this.activeTime]) {
        const cachedVar = this._resolveVarData(
            this.bundleCache[this.activeTime],
            varId
        );
        if (cachedVar) {
            this.applyBundleData(this.bundleCache[this.activeTime]);
            ...
            return;
        }
    }

    await this.loadActiveVariable();
}
```

### Problem

The code fetches depth metadata BEFORE checking whether the active variable is already available in the current bundle.

Therefore a variable that is already loaded can still wait for another API request before being applied.

### Required change

Reorder the logic:

```text
set activeVar immediately
      ↓
check active bundle for var
      ↓
if present:
    apply instantly
    update UI
    load depth metadata in background if needed
    DONE
      ↓
if missing:
    fetch variable
```

Depth metadata must NOT block a cached variable switch.

---

# 4. Variable switching should use normalized active-time bundle data

The project already has:

- `bundleCache[time]`
- `_resolveVarData()`
- `applyBundleData()`
- client LRU cache
- request deduplication
- AbortController

Use those mechanisms consistently.

### Required invariant

For a selected timestamp:

```
bundleCache[activeTime]
```

must be the primary source for:

- temperature
- salinity
- currents
- sea-surface variables
- any other variables returned by the bundle

When a variable exists there, changing variable should be a local operation.

No HTTP request should be required just to switch between already-loaded variables.

---

# 5. Timeline cache must be timestamp-aware AND request-generation-safe

File:

`frontend/app.js`

Existing:

```this._bundleReqSeq
```

is good, but strengthen the complete flow.

### Required

Every timeline-changing request must have a request generation/token.

Example:

```js
const requestId = ++this._bundleReqSeq;
const requestedTime = timeIso;
const requestedVar = this.activeVar;
```

Before applying async results:

```if (requestId !== this._bundleReqSeq) return;
```

Also ensure the result still belongs to the current:

- timestamp
- region
- variable/context where relevant

Never allow:

```
T1 request starts
T2 request starts
T2 completes
T1 completes later
→ T1 overwrites T2
```

This is a classic stale-response race and must be prevented everywhere in the time/variable pipeline.

---

# 6. Prefetch must be aggressive enough to make timeline movement feel instant

File:

`frontend/app.js`

There is already:

`prefetchAdjacentTimestamps()`

Keep it, but make it actually support instant navigation.

### Required behavior

When timestamp T is active:

- Prefetch T+1
- Prefetch T+2
- Prefetch T-1
- Prefer the next likely user direction when possible
- Do not block current rendering on prefetch
- Do not abort prefetch because an active request is running
- Never allow prefetch to replace the active timestamp

### Important

Current `ApiClient.getOceanBundle()` defaults to category `bundle`.

Because `request()` aborts the previous request in the same category, active bundle fetches and prefetches can interfere.

Use a distinct non-aborting category strategy for background prefetch, or an explicit background request path.

Example concept:

```
active bundle: category = "active-bundle"
prefetch:      category = null / "prefetch"
```

The implementation must prevent prefetch from aborting the user's active selection.

---

# 7. Timeline resolution switching must immediately select/load a valid timestamp

File:

`frontend/controls/timelineControl.js`

Current resolution handling:

```this.currentResolution = res;
this._applyResolutionFilter();
```

But `_applyResolutionFilter()` eventually calls:

```this.setTimes(this.filteredTimestamps);
```

with the default:

```notify = false
```

### Problem

Changing HOURLY / DAILY / MONTHLY can change the selected timestamp to index 0, but the app is not necessarily told to load the newly selected timestamp.

This directly matches the bug:

> Selecting a different timeline/resolution does not auto fetch/load data.

### Required change

When resolution/filter changes:

1. Preserve the current timestamp if it exists in the new resolution.
2. Otherwise select the nearest valid timestamp.
3. Immediately notify `onTimeChange`.
4. Trigger data load automatically.
5. Update slider, labels, counters, active timestamp and visualization together.

Target behavior:

```
resolution changed
      ↓
derive new filtered timeline
      ↓
choose valid current/nearest timestamp
      ↓
update UI
      ↓
onTimeChange(...)
      ↓
load/apply data automatically
```

No second FETCH DATA click.

---

# 8. Default timeline = last 2 months from current system date

This is a hard product requirement.

## Required default

At application startup:

```
end = current system date/time
start = current system date/time - 2 calendar months
```

Do NOT use:

```
allTimestamps[0]
allTimestamps[last]
```

as the initial visible date range.

### Example

If current system date is:

```
2026-09-28
```

default visible timeline window should approximately be:

```
2026-07-28 → 2026-09-28
```

Use calendar-month subtraction, not a hard-coded 60 days, so month lengths are respected.

### Important

The backend may expose a larger historical timeline. The UI should still default to the most recent two-month slice.

The current code in `TimelineControl.loadTimelineForVariable()` does this:

```js
this.timeStart.value = this.allTimestamps[0]
this.timeEnd.value = this.allTimestamps[last]
```

Replace that behavior.

### Robust timestamp handling

After receiving `allTimestamps`:

1. Determine `now = new Date()`.
2. Determine `twoMonthsAgo`.
3. Filter timestamps to:
   ```
   twoMonthsAgo <= timestamp <= now
   ```
4. If no timestamps exist in that exact interval, use the nearest available timestamps within the dataset rather than leaving an empty timeline.
5. Set start/end inputs from the effective filtered interval.
6. Make the latest available timestamp the default selected timestamp, or preserve a current valid selection when changing variable/resolution.

---

# 9. Default visible date and selected timestamp should be sensible

After loading the default two-month window:

- timeline should NOT select the oldest timestamp automatically.
- Prefer the latest timestamp available in the two-month window.
- The timeline slider should reflect that timestamp.
- Ocean visualization should immediately load that timestamp.

The UI should open showing the newest available data in the default two-month window.

---

# 10. Custom date-range selection should auto-load

Current UI has:

- Start datetime
- End datetime
- FETCH DATA button

Keep the button if useful, but timeline state must remain coherent.

When the user applies a custom range:

1. Fetch/reload timeline metadata for that range.
2. Filter/construct valid timeline.
3. Select the nearest/latest valid timestamp.
4. Automatically fetch data for that timestamp.
5. Update visualization.

Do not leave the application in a state where the timeline changed but the 3D scene still represents the previous date.

---

# 11. Point Inspector is currently over-fetching

File:

`frontend/app.js`

Current:

```const [data, mlData] = await Promise.all([
    ApiClient.getPoint(...),
    ApiClient.getMLPoint(...)
]);
```

### Problem

Opening the inspector waits for BOTH:

- point ocean/atmosphere data
- ML point analysis

This makes the basic inspector feel slow even when the core point value could be displayed quickly.

### Required UX

Split point inspection into fast path + background enrichment.

## Fast path

Immediately show:

- coordinates
- depth
- timestamp
- active variable
- active variable value

Use cached active field/bundle data whenever possible.

## Background enrichment

Load asynchronously:

- ML anomaly
- hazard
- nearest Argo/Glider collocation details
- complete vertical profile
- extra atmospheric values
- other expensive analysis

The inspector UI should not wait for all of these before becoming usable.

Target:

```
click point
   ↓
marker + shell/readout immediately
   ↓
active value immediately if available locally
   ↓
background API enrichment
   ↓
patch individual sections as responses arrive
```

---

# 12. Point Inspector should reuse already-loaded field data

If the current ocean bundle is already loaded for the active timestamp, use it as the first source for the selected cell.

Do NOT re-query the server for a value that can be obtained from:

- `currentBundle`
- `lastOceanData`
- loaded scalar grid
- loaded current grid

Use nearest-grid-cell lookup in the client when technically appropriate.

Only request `/api/point` when:

- the exact point value cannot be derived from loaded data,
- vertical profile is requested,
- atmospheric/observation enrichment is needed,
- or the point lies outside the currently loaded grid.

This is especially important for repeated inspection at nearby points on the same timestamp.

---

# 13. Point Inspector request cancellation

Rapidly clicking several points currently risks multiple expensive requests racing.

Implement an inspector request token / AbortController category.

Required semantics:

```
click A
click B
click C
```

Only C may update the inspector.

A/B results must be ignored or aborted.

Recommended categories:

```
point-inspect
point-ml
point-profile
point-timeseries
```

or a unified inspector request generation token.

Do not let stale point data overwrite the currently selected point.

---

# 14. Point Inspector repeated depth selection is also inefficient

Current depth pill/table behavior does:

```this.onDepthChange(targetD);
this.inspectPoint({...cell, depthM: targetD});
```

This can trigger multiple operations.

### Required

Selecting a different inspector depth should:

1. update active depth immediately;
2. reuse loaded profile data if available;
3. update the visible active row/value immediately;
4. fetch only if required data is missing.

Avoid duplicate `onDepthChange` + `inspectPoint` work when one state transition can do both.

---

# 15. API client improvements

File:

`frontend/api/apiClient.js`

Existing infrastructure is useful:

- LRU cache
- single-flight deduplication
- AbortController
- GET cache keys

But request categories currently create an important conflict.

## Required

Separate active interactive requests from background prefetch.

Example:

```
active-bundle
prefetch
active-variable
point-inspect
analysis
```

Active interactive requests may abort older interactive requests.

Background prefetch must never abort the request currently serving the user's selected timestamp.

Also consider increasing the client cache capacity if memory usage permits, because timeline bundles are large and the current:

```
MAX_CACHE_ENTRIES = 50
```

is generic rather than bundle-aware.

Do not blindly increase it without checking object size. Prefer a dedicated bounded timeline bundle cache if necessary.

---

# 16. Do not block rendering on metadata calls

General rule for interactive controls:

### Blocking operations

Only data required to render the currently requested state.

### Non-blocking operations

- depth metadata refresh
- provenance text
- ML enrichment
- anomaly enrichment
- prefetch
- auxiliary observation queries
- chart enrichment not visible in the immediate interaction

Interactive timeline/variable changes must take the shortest possible path to visible state.

---

# 17. Main-view state machine

Use a small explicit state model rather than scattered async side effects.

Recommended conceptual state:

```js
{
  activeTime,
  activeVar,
  activeDepth,
  bbox,
  currentBundle,
  bundleCache,
  requestGeneration
}
```

Transition examples:

### TIME_CHANGE

```
activeTime = T
if cache[T] complete:
    apply immediately
else:
    fetch T
```

### VARIABLE_CHANGE

```
activeVar = V
if bundle[activeTime] contains V:
    apply immediately
else:
    fetch V
```

### RESOLUTION_CHANGE

```
recompute filtered timeline
choose valid timestamp
dispatch TIME_CHANGE
```

### REGION_CHANGE

```
invalidate region-specific caches
reload terrain/timeline
select latest valid timestamp
dispatch TIME_CHANGE
```

This will eliminate many duplicate pathways.

---

# 18. Analysis page should follow the same principle

File:

`frontend/analysis/analysisPage.js`

Current `selectTime()` waits for six async groups:

```await Promise.all([
  fetchBundleData,
  fetchComparisonField,
  fetchAnomalyData,
  fetchAbnormalRegions,
  fetchArgoData,
  fetchSummaryAndCoverage
]);
```

This is a major reason the analysis timeline can feel slow.

### Required

Do not block the first visual update on every analysis endpoint.

Use:

```
select timestamp
    ↓
load/apply primary model bundle
    ↓
render immediately
    ↓
parallel background enrichment:
    - comparison
    - anomalies
    - abnormal regions
    - Argo
    - summary/coverage
    ↓
patch dashboard components as each completes
```

Primary 3D visualization must not wait for KPI/coverage/anomaly/chart enrichment.

Also add request-generation protection to analysis `selectTime()`.

---

# 19. Analysis resolution/time selection must auto-fetch too

The analysis page has its own timeline state:

```
this.timeline
this.index
this.activeTime
```

Whenever its selected time changes:

- activeTime changes immediately
- primary bundle fetch starts immediately
- 3D state updates immediately when data arrives
- dependent analytics refresh in background

No separate manual fetch action.

---

# 20. Performance targets

Use these as acceptance criteria.

## Timeline/date

- UI timestamp label updates: same event loop tick / effectively instant.
- Cached timestamp field switch: target < 50 ms perceived update.
- Prefetched timestamp: target near-instant, no loading modal.
- Uncached timestamp: immediately show loading state while request runs; do not freeze UI.

## Variable

- Variable already in bundle: instant local switch.
- Missing variable: fetch only that variable.
- No unnecessary depth metadata request before rendering.

## Inspector

- Point marker/readout shell: immediate.
- Active value from loaded grid/bundle: immediate.
- Expensive ML/profile enrichment: background.
- Rapid clicks: only latest point can update UI.

## Timeline range/resolution

- Selecting another resolution/range automatically selects and loads a valid timestamp.
- No manual FETCH DATA required for normal timeline navigation.

---

# 21. Loading UX

Avoid full-screen/blocking download modals for:

- cached timestamp switches
- cached variable switches
- prefetch hits
- point inspection updates
- background analytics

Use lightweight inline states instead:

```
Updating field…
Loading observation details…
Loading analysis…
```

The 3D scene should remain interactive while secondary data loads.

---

# 22. Cache rules

Separate cache concepts clearly:

### Timeline metadata cache

Key by:

```
variable + bbox + depth + start + end
```

### Ocean bundle cache

Key by:

```
provider + bbox + time + depth/slice context
```

### Point cache

Key by:

```
lat + lon + time + depth
```

### Analysis cache

Key by the complete analysis parameter set.

Do not accidentally reuse stale results from a different:

- bbox
- timestamp
- variable
- depth
- analysis mode

---

# 23. Backend optimization guidance

Relevant backend infrastructure already contains:

- `GLOBAL_CACHE`
- `ThreadSafeLRUCache`
- `get_or_compute()`
- dataset caching
- provider routing

Do not rewrite the backend unnecessarily.

First verify request-level cache keys and ensure timeline/bundle requests with identical parameters hit backend cache.

If a backend endpoint is still slow after cache hits, profile it and optimize only the actual bottleneck.

The frontend should not compensate for duplicate server calls by firing even more requests.

---

# 24. Files expected to change

Primary:

- `frontend/controls/timelineControl.js`
- `frontend/app.js`
- `frontend/api/apiClient.js`

Likely:

- `frontend/analysis/analysisPage.js`

Only if required after profiling:

- backend timeline/bundle/point endpoints or cache code

Do not perform broad refactors unrelated to this task.

---

# 25. Implementation order

1. Remove the 200 ms timeline delay.
2. Make cached timestamp switching synchronous from the user's perspective.
3. Remove duplicate currents fetches when bundle data is sufficient.
4. Reorder variable switching so cached variables apply before depth-metadata fetch.
5. Fix timeline resolution change so it automatically dispatches time change.
6. Implement default last-2-month timeline window.
7. Prefer latest available timestamp in that window.
8. Make point inspector fast-path use loaded bundle/grid data.
9. Move ML/observation enrichment to background.
10. Add inspector request cancellation/stale-result protection.
11. Make analysis page primary bundle render independently of secondary analytics.
12. Verify active/background request categories.
13. Add instrumentation and test timings.

---

# 26. Instrumentation required during implementation

Add lightweight performance marks around:

- timeline input → onTimeChange
- cache lookup
- bundle request start/end
- bundle apply start/end
- variable switch start/end
- inspector click → shell rendered
- inspector request start/end
- analysis primary render
- analysis enrichment completion

Example:

```js
performance.mark('timeline-change-start');
// ...
performance.mark('timeline-change-visible');
performance.measure(
  'timeline-to-visible',
  'timeline-change-start',
  'timeline-change-visible'
);
```

Log only in development/debug mode.

This is required so the team can prove whether the latency is:

- debounce,
- network,
- backend processing,
- JSON parsing,
- Three.js rebuild,
- scalar texture update,
- chart rendering,
- or duplicate requests.

---

# 27. Acceptance checklist

### Main viewer

- [ ] Dragging timeline updates the date immediately.
- [ ] Moving one timestamp does not wait 200 ms.
- [ ] Cached/prefetched timestamp changes appear essentially instantly.
- [ ] Uncached timestamps show non-blocking loading state.
- [ ] Older async responses cannot overwrite newer selections.
- [ ] Switching temperature → salinity is instant when salinity is in current bundle.
- [ ] Switching variables does not wait on depth metadata.
- [ ] Selecting resolution automatically loads a valid timestamp.
- [ ] Selecting custom timeline range automatically loads the new timestamp.
- [ ] Default timeline is last 2 calendar months from current system date.
- [ ] Default selected point is the latest available timestamp in that window.
- [ ] Prefetch does not abort active requests.

### Point Inspector

- [ ] Click immediately shows marker/readout shell.
- [ ] Active value uses loaded grid/bundle when possible.
- [ ] ML/hazard/observation enrichment loads in background.
- [ ] Rapid point clicks only allow latest click to update.
- [ ] Repeated point inspection at same time uses cache.
- [ ] Depth changes inside inspector do not cause duplicate fetches.

### Analysis

- [ ] Primary 3D field updates before secondary analytics finish.
- [ ] Time changes automatically fetch/load data.
- [ ] Resolution/range changes automatically load selected timestamp.
- [ ] Stale analysis responses cannot overwrite current state.

### Quality

- [ ] No console errors.
- [ ] No duplicate network requests for the same active timestamp/context.
- [ ] No regression to current vectors, anomalies, Argo, charts, or existing visualization controls.
- [ ] Performance marks/logs demonstrate improvement.

---

# Final implementation principle

Do NOT solve this by simply adding more loaders or increasing API concurrency.

The correct architecture is:

```text
USER INPUT
   ↓
IMMEDIATE STATE UPDATE
   ↓
CLIENT CACHE CHECK
   ├── HIT → APPLY NOW
   └── MISS → FETCH
               ↓
         APPLY WHEN READY
               ↓
      BACKGROUND ENRICHMENT
```

The UI should react to user intent immediately; network and scientific enrichment should happen behind that interaction whenever possible.
