# Weather Dashboard

A modern React + Tailwind weather application with search, geolocation, charts, air quality, and forecast insights.

## Tech stack

- React 18
- Vite 5
- Tailwind CSS 3
- Open-Meteo APIs (no API key required)

## Features

- City search with autocomplete suggestions
- Auto-location weather (with manual "Use My Location" action)
- Current weather + "Today at a Glance" summary
- 5-day forecast with expandable daily detail cards
- Hourly chart window with:
  - temperature line
  - wind line
  - precipitation line (anchored to zero baseline)
  - hover tooltip and detail panel
- Feels-like trend chart with:
  - feels-like vs actual temperature lines
  - hourly slider sync
  - hover tooltip
- Air quality + pollen panel
- Weather alerts panel with forecast-derived fallback advisories
- Embedded weather map centered on selected location
- Recent searches with remove/clear actions
- Unit toggle (Celsius/Fahrenheit)
- Toast feedback for key user actions

## Quick start

1. Install dependencies:

   ```bash
   npm install
   ```

2. Start development server:

   ```bash
   npm run dev
   ```

3. Build for production:

   ```bash
   npm run build
   ```

## Scripts

- `npm run dev` - starts local dev server
- `npm run build` - creates production build
- `npm run preview` - previews built app

## API endpoints used

### Open-Meteo forecast + geocoding

- Geocoding search:
  - `https://geocoding-api.open-meteo.com/v1/search`
- Forecast:
  - `https://api.open-meteo.com/v1/forecast`
- Air quality:
  - `https://air-quality-api.open-meteo.com/v1/air-quality`

### Notes

- No API key is required.
- Some third-party alert feeds are region-scoped; this project includes fallback advisory generation from forecast data.

## Project structure

```text
Weather Dashboard/
  src/
    App.jsx        # Main app state, data fetching, UI rendering
    index.css      # Global styles and component utility classes
    main.jsx       # App bootstrap
  public/
  index.html
  package.json
```

## UX and behavior notes

- Search suggestions open only on user interaction (focus/typing) and close on outside click.
- Geolocation and manual search are both supported; data fetches guard against stale responses.
- Charts are synchronized to the hourly window slider and include hover details.

## Troubleshooting

### App runs but location label is generic

- Confirm location permissions are allowed in your browser.
- Click "Use My Location" to force a fresh location fetch.

### Weather data does not appear

- Check your internet connection and browser console for blocked requests.
- Restart the dev server:

  ```bash
  npm run dev
  ```

### Stale browser bundles after major edits

- Hard refresh with `Ctrl+Shift+R`.
- If needed, close/reopen the dev tab.

## Documentation

Additional implementation and maintenance notes are available in:

- `docs/DEVELOPMENT.md`
