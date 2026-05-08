# Development Notes

This document describes architecture, state patterns, and practical maintenance guidance for the Weather Dashboard.

## App architecture

The app is implemented as a single top-level UI container in `src/App.jsx`, with:

- local component state for UI interactions
- derived values via `useMemo`
- side effects and async data loading via `useEffect`

Core render sections:

1. Search + autocomplete
2. Current weather and "Today at a Glance"
3. Air quality and alerts
4. Feels-like trend chart
5. 5-day forecast cards
6. Hourly chart and detail toggles
7. Embedded map

## Data flow

### Search flow

1. User types city name
2. Debounced geocoding suggestion request runs
3. User selects suggestion or submits query
4. Forecast request resolves weather payload
5. UI sections update from shared weather state

### Location flow

1. Browser geolocation returns coordinates
2. Forecast request resolves weather for coordinates
3. Location label is derived from timezone-aware city handling
4. Environmental data (air quality) is fetched for same coordinates

## Request safety

`latestRequestRef` is used to prevent race conditions:

- each request increments a request id
- stale responses are ignored if a newer request started
- avoids flicker and out-of-order UI overwrites

## Charts

### Hourly chart

- Windowed view (`hourlyWindowStart`, `hourlyWindowSize`)
- Shared x-axis spacing (`stepX`)
- Temperature/wind/precipitation polylines
- Hover guide line and details
- External timestamp labels to avoid overlap

### Feels-like chart

- Mirrors hourly chart structure
- Uses shared domain for accurate line comparison
- Includes area fill + dual lines (feels-like vs actual)
- External labels and hover tooltip

## Styling system

Global styles are in `src/index.css`.

Notable utility classes:

- `glass-panel` for premium card surfaces
- `glass-subpanel` for nested chart surfaces
- `app-range` for consistent slider styling
- `forecast-details` for expandable card transitions
- `toast` styles for transient feedback

## Alert strategy

Live alert feeds can fail or be region-limited. The app supports:

- optional external alert feed integration
- fallback derived advisories from forecast thresholds (wind, precip, UV, temperature)

This keeps the alerts panel useful in more regions.

## Known constraints

- Browser geolocation accuracy varies by device, browser, and permission mode.
- External API behavior may differ by region and time.
- Some endpoints may enforce CORS or geographic restrictions.

## Suggested next improvements

- Split `App.jsx` into feature modules/components
- Add test coverage for utility functions (domain scaling, city resolution)
- Add lightweight client-side caching for repeated city lookups
- Add chart accessibility labels and keyboard interactions
- Add `ErrorBoundary` around chart-heavy sections
