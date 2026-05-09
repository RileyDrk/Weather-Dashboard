import { useCallback, useEffect, useMemo, useRef, useState } from "react";

const MAX_RECENT_SEARCHES = 6;
const RECENT_SEARCHES_KEY = "weather-dashboard-recent-searches";
/** Dropdown rows after merging + ranking remote geocode hits. */
const AUTOCOMPLETE_LIMIT = 12;
/** Fetch a wide slice from Open-Meteo, then rank locally (helps “St Johns Newfoundland” vs other Saint Johns). */
const GEOCODE_FETCH_COUNT = 50;
/** Open-Meteo supports up to 16 forecast days on the bundled weather API — use full span so hourly aligns with far-out days */
const FORECAST_API_DAYS = 16;
const FORECAST_DAILY_DAYS_SHOWN = 14;

/** Y-axis ° labels in SVG charts (readable on small screens). */
const CHART_AXIS_FONT_PX = 14;
const CHART_AXIS_FILL = "#cbd5e1";
/** Left padding inside chart viewBox so wider axis labels do not clip. */
const CHART_PADDING = 58;
/** X-axis hour labels drawn inside the SVG (bottom margin strip). */
const CHART_X_AXIS_FONT_PX = 12;
/** Visible hourly slots when using the sliding-window mode (not full calendar day). */
const HOURLY_SLIDING_VISIBLE_HOURS = 12;

/** Subtle “now” guide on charts (purple). */
const CHART_NOW_STROKE = "rgba(167, 139, 250, 0.82)";
const CHART_NOW_DOT = "rgba(192, 168, 255, 0.95)";

/** Plot height shared by hourly + feels-like SVG charts. */
const CHART_FIXED_HEIGHT_PX = 280;
/** Lower bound — keeps short windows usable on small laptops. */
const CHART_VIEWBOX_MIN_WIDTH_PX = 1100;
/** Widens evenly with slot count so both charts scale identically. */
const CHART_PIXELS_PER_SLOT = 74;

/** Identical SVG viewBox footprint for hourly & feels plots (aligned time axis). */
function getSharedHourlyChartViewBox(slotCount) {
  const n = Math.max(1, slotCount);
  const padding = CHART_PADDING;
  const height = CHART_FIXED_HEIGHT_PX;
  const width = Math.max(CHART_VIEWBOX_MIN_WIDTH_PX, Math.round(CHART_PIXELS_PER_SLOT * n));
  const inner = Math.max(width - padding * 2, 60);
  const stepX = inner / Math.max(n - 1, 1);
  return { width, height, padding, stepX };
}

const WEATHER_CODES = {
  0: "Clear sky",
  1: "Mainly clear",
  2: "Partly cloudy",
  3: "Overcast",
  45: "Fog",
  48: "Depositing rime fog",
  51: "Light drizzle",
  53: "Moderate drizzle",
  55: "Dense drizzle",
  56: "Light freezing drizzle",
  57: "Dense freezing drizzle",
  61: "Slight rain",
  63: "Moderate rain",
  65: "Heavy rain",
  66: "Light freezing rain",
  67: "Heavy freezing rain",
  71: "Slight snow fall",
  73: "Moderate snow fall",
  75: "Heavy snow fall",
  77: "Snow grains",
  80: "Slight rain showers",
  81: "Moderate rain showers",
  82: "Violent rain showers",
  85: "Slight snow showers",
  86: "Heavy snow showers",
  95: "Thunderstorm",
  96: "Thunderstorm with slight hail",
  99: "Thunderstorm with heavy hail",
};

function getWeatherDescription(code) {
  return WEATHER_CODES[code] ?? "Unknown weather";
}

function getWeatherEmoji(code) {
  if (code === 0) return "☀️";
  if ([1, 2].includes(code)) return "🌤️";
  if (code === 3) return "☁️";
  if ([45, 48].includes(code)) return "🌫️";
  if ([51, 53, 55, 56, 57].includes(code)) return "🌦️";
  if ([61, 63, 65, 66, 67, 80, 81, 82].includes(code)) return "🌧️";
  if ([71, 73, 75, 77, 85, 86].includes(code)) return "❄️";
  if ([95, 96, 99].includes(code)) return "⛈️";
  return "🌍";
}

function getRecentSearches() {
  try {
    const parsed = JSON.parse(localStorage.getItem(RECENT_SEARCHES_KEY) ?? "[]");
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

function formatDisplayDate(dateString) {
  return new Intl.DateTimeFormat("en-US", {
    weekday: "short",
    month: "short",
    day: "numeric",
  }).format(new Date(`${dateString}T00:00:00`));
}

const FORECAST_DAYS_PER_WEEK_ROW = 7;

function chunkForecastDays(cards, chunkSize = FORECAST_DAYS_PER_WEEK_ROW) {
  if (!Array.isArray(cards) || cards.length === 0) return [];
  const chunks = [];
  for (let i = 0; i < cards.length; i += chunkSize) {
    chunks.push(cards.slice(i, i + chunkSize));
  }
  return chunks;
}

function formatForecastWeekRange(firstDateStr, lastDateStr) {
  const a = new Date(`${firstDateStr}T12:00:00`);
  const b = new Date(`${lastDateStr}T12:00:00`);
  const md = new Intl.DateTimeFormat("en-US", { month: "short", day: "numeric" });
  return `${md.format(a)} → ${md.format(b)}`;
}

function forecastDayVisualMeta(dateString) {
  const d = new Date(`${dateString}T12:00:00`);
  const dow = d.getDay();
  return {
    weekdayShort: new Intl.DateTimeFormat("en-US", { weekday: "short" }).format(d),
    dayOfMonth: d.getDate(),
    monthShort: new Intl.DateTimeFormat("en-US", { month: "short" }).format(d),
    isWeekend: dow === 0 || dow === 6,
  };
}

function ForecastWeekDayCard({
  day,
  unitSymbol,
  windUnit,
  expandedForecastDate,
  forecastDetailDay,
  anchorDateLabel,
  onToggleDay,
}) {
  const badge = forecastDayVisualMeta(day.date);
  const isExpanded = expandedForecastDate === day.date;
  const isPinned = forecastDetailDay === day.date;
  const isForecastStart = anchorDateLabel && day.date === anchorDateLabel;

  return (
    <button
      className={`flex shrink-0 snap-start flex-col rounded-xl border p-3 text-left transition-all duration-300 sm:min-w-0 lg:w-auto ${
        isExpanded
          ? "scale-[1.02] border-sky-400 bg-slate-900/85 shadow-[0_0_0_1px_rgba(56,189,248,0.22)] sm:scale-100"
          : isPinned
            ? "border-amber-500/55 bg-slate-900/65 ring-2 ring-amber-400/35"
            : badge.isWeekend
              ? "border-slate-600/65 bg-indigo-950/25 hover:border-indigo-400/55 hover:bg-indigo-950/35"
              : "border-slate-700/50 bg-slate-900/50 hover:border-sky-500/50 hover:bg-slate-900/70"
      } w-[min(44vw,168px)] min-h-[148px] sm:w-auto`}
      onClick={() => onToggleDay(day.date)}
      type="button"
    >
      <div className="flex items-start justify-between gap-1 border-b border-slate-600/55 pb-2">
        <div className="min-w-0">
          <p className={`text-[10px] font-bold uppercase tracking-widest ${badge.isWeekend ? "text-indigo-300" : "text-sky-400/90"}`}>
            {badge.weekdayShort}
          </p>
          <div className="flex items-baseline gap-1.5">
            <span className="text-3xl font-bold tabular-nums leading-none text-slate-50">{badge.dayOfMonth}</span>
            <span className="text-[11px] font-medium uppercase text-slate-500">{badge.monthShort}</span>
          </div>
          <p className="truncate text-[10px] leading-tight text-slate-400">{formatDisplayDate(day.date)}</p>
        </div>
        <div className="flex shrink-0 flex-col items-end gap-0.5">
          {isForecastStart ? (
            <span className="rounded-full border border-emerald-500/40 bg-emerald-950/50 px-1.5 py-0 text-[9px] font-semibold uppercase text-emerald-200">
              Start
            </span>
          ) : null}
          {isPinned && !isExpanded ? (
            <span className="rounded-full border border-amber-500/40 bg-amber-950/55 px-1.5 py-0 text-[9px] font-semibold uppercase text-amber-200">
              Charts
            </span>
          ) : null}
        </div>
      </div>

      <p className="mt-2 shrink-0 text-2xl leading-none sm:text-[1.65rem]" aria-hidden>
        {getWeatherEmoji(day.code)}
      </p>
      <p className="mt-2 line-clamp-2 text-xs font-semibold leading-snug text-slate-200 sm:text-sm">
        {getWeatherDescription(day.code)}
      </p>
      <p className="mt-auto pt-3 text-sm text-slate-100">
        <span className="font-semibold">
          {Math.round(day.tempMax)}
          {unitSymbol}
        </span>
        <span className="text-slate-400">
          {" "}
          / {Math.round(day.tempMin)}
          {unitSymbol}
        </span>
      </p>

      <div
        className={`forecast-details mt-2 overflow-hidden border-t border-slate-700 pt-2 text-[11px] leading-snug text-slate-200 sm:text-xs ${
          isExpanded ? "is-open" : ""
        }`}
      >
        <div className="space-y-0.5">
          <p>
            Wind: up to {Math.round(day.windMax ?? 0)} {windUnit}
          </p>
          <p>Rain odds: up to {Math.round(day.precipitationProbabilityMax ?? 0)}%</p>
          <p>Rain total: {(day.precipitationSum ?? 0).toFixed(1)} mm</p>
          <p>Sunrise / set: {day.sunrise ? formatTimeLabel(day.sunrise) : "—"} / {day.sunset ? formatTimeLabel(day.sunset) : "—"}</p>
        </div>
      </div>
      <p className="mt-2 text-[10px] text-slate-500">{isExpanded ? "Tap again to collapse" : "Tap to expand"}</p>
    </button>
  );
}

/** Calendar day key (YYYY-MM-DD) from an Open-Meteo hourly timestamp. */
function hourlyTimeDateKey(timeString) {
  if (!timeString || typeof timeString !== "string") return "";
  return timeString.slice(0, 10);
}

function tempToCelsius(value, unit) {
  if (!Number.isFinite(value)) return null;
  return unit === "fahrenheit" ? ((value - 32) * 5) / 9 : value;
}

function summarizeSkyFromCodes(hourlySeries) {
  if (!hourlySeries?.length) return "";
  const buckets = { clear: 0, fair: 0, gray: 0, wet: 0, frozen: 0, storm: 0 };
  for (const h of hourlySeries) {
    const c = h.weatherCode;
    if (!Number.isFinite(c)) continue;
    if (c === 0) buckets.clear += 1;
    else if (c <= 3) buckets.fair += 1;
    else if (c <= 48) buckets.gray += 1;
    else if (c <= 67 || [80, 81, 82].includes(c)) buckets.wet += 1;
    else if ([71, 73, 75, 77, 85, 86].includes(c)) buckets.frozen += 1;
    else if (c >= 95) buckets.storm += 1;
    else buckets.gray += 1;
  }
  const rank = Object.entries(buckets).sort((a, b) => b[1] - a[1]);
  const top = rank[0]?.[0];
  if (!top || rank[0][1] === 0) return "";
  if (top === "clear") return "Skies often look clear or nearly so.";
  if (top === "fair") return "Expect a mix of sun and cloud.";
  if (top === "wet") return "Wet weather figures into the mood of the day.";
  if (top === "frozen") return "Wintery precipitation could show up at times.";
  if (top === "storm") return "Thunder risk appears in the hourly mix — stay aware outdoors.";
  return "Skies lean gray or murky for stretches.";
}

/**
 * Short natural-language rundown from daily + hourly API fields.
 */
function buildDayRundownParagraph({
  dayDaily,
  hourlySeries,
  unit,
  unitSymbol,
  windUnit,
  forecastDetailDay,
  formatDisplayDateFn,
  getWeatherDescriptionFn,
}) {
  const hasHourly = hourlySeries && hourlySeries.length > 0;
  if (!dayDaily && !hasHourly) return "";

  const temps = hasHourly ? hourlySeries.map((h) => h.temp).filter(Number.isFinite) : [];
  const pairedFeels = hasHourly
    ? hourlySeries
        .map((h) =>
          Number.isFinite(h.temp) && Number.isFinite(h.apparentTemp) ? Math.abs(h.apparentTemp - h.temp) : null
        )
        .filter(Number.isFinite)
    : [];
  const hi = Number.isFinite(dayDaily?.tempMax) ? dayDaily.tempMax : temps.length ? Math.max(...temps) : null;
  const lo = Number.isFinite(dayDaily?.tempMin) ? dayDaily.tempMin : temps.length ? Math.min(...temps) : null;
  const hiC = tempToCelsius(hi, unit);

  const probs = hasHourly ? hourlySeries.map((h) => h.precipitationProbability ?? 0).filter(Number.isFinite) : [];
  const maxProb = probs.length
    ? Math.max(...probs)
    : Number.isFinite(dayDaily?.precipitationProbabilityMax)
      ? dayDaily.precipitationProbabilityMax
      : 0;
  const hourlyPrecipSum = hasHourly ? hourlySeries.reduce((s, h) => s + (Number(h.precipitation) || 0), 0) : 0;
  const dailyPrecipMm = Number.isFinite(dayDaily?.precipitationSum) ? dayDaily.precipitationSum : null;
  const precipTotalHint = dailyPrecipMm != null ? dailyPrecipMm : hourlyPrecipSum;

  const winds = hasHourly ? hourlySeries.map((h) => h.windspeed ?? 0).filter(Number.isFinite) : [];
  const maxWind = winds.length
    ? Math.max(...winds)
    : Number.isFinite(dayDaily?.windMax)
      ? dayDaily.windMax
      : null;
  const breezyAt = windUnit === "mph" ? 14 : 22;
  const windyAt = windUnit === "mph" ? 24 : 38;

  let comfort = "";
  if (Number.isFinite(hiC)) {
    if (hiC >= 33) comfort = "Heat will be the story — plan for hot, draining conditions.";
    else if (hiC >= 27) comfort = "It should feel warm overall; heat may build in peak hours.";
    else if (hiC >= 21) comfort = "Comfortable warmth for most of the day.";
    else if (hiC >= 12) comfort = "Temperatures stay mild.";
    else if (hiC >= 4) comfort = "Cool air dominates — layering helps.";
    else comfort = "Expect a cold bite, especially toward the lows.";
  }

  const sentences = [];
  const label = forecastDetailDay ? formatDisplayDateFn(forecastDetailDay) : "this stretch";

  if (Number.isFinite(hi) && Number.isFinite(lo)) {
    sentences.push(
      forecastDetailDay
        ? `${label} trends toward highs near ${Math.round(hi)}${unitSymbol} and lows around ${Math.round(lo)}${unitSymbol}.`
        : `Across the next hours on deck, expect peaks near ${Math.round(hi)}${unitSymbol} and cooler pockets near ${Math.round(lo)}${unitSymbol}.`
    );
  } else if (Number.isFinite(hi)) {
    sentences.push(
      forecastDetailDay
        ? `${label} should top out near ${Math.round(hi)}${unitSymbol}.`
        : `Temperatures reach near ${Math.round(hi)}${unitSymbol} at the warmest point in the window.`
    );
  } else {
    sentences.push("Temperatures swing hour to hour — lean on the chart to spot the warmest and coolest moments.");
  }

  if (comfort) sentences.push(comfort);

  if (maxProb >= 70 || (precipTotalHint != null && precipTotalHint >= 8)) {
    sentences.push("Precipitation looks meaningful, so raingear is useful and surfaces may turn slick.");
  } else if (maxProb >= 40 || (precipTotalHint != null && precipTotalHint >= 2)) {
    sentences.push("Showers or drizzle could visit for part of this window.");
  } else if (maxProb >= 20) {
    sentences.push("A passing shower is possible, but long dry stretches are still in play.");
  } else {
    sentences.push("Precipitation chances stay fairly low through this slice of the forecast.");
  }

  if (Number.isFinite(maxWind)) {
    if (maxWind >= windyAt) {
      sentences.push(
        `Wind freshens with peaks near ${Math.round(maxWind)} ${windUnit}, so gusts can make it feel colder than the mercury suggests.`
      );
    } else if (maxWind >= breezyAt) {
      sentences.push(`Breezes stay active, topping out around ${Math.round(maxWind)} ${windUnit}.`);
    } else {
      sentences.push(`Winds stay mostly gentle, with the strongest hour near ${Math.round(maxWind)} ${windUnit}.`);
    }
  }

  const sky = summarizeSkyFromCodes(hourlySeries);
  if (sky) sentences.push(sky);

  if (pairedFeels.length) {
    const meanDiff = pairedFeels.reduce((a, b) => a + b, 0) / pairedFeels.length;
    const meanDiffC = unit === "fahrenheit" ? (meanDiff * 5) / 9 : meanDiff;
    if (meanDiffC >= 2.5) {
      sentences.push(
        "“Feels like” often strays from the air temperature because humidity, wind, or sun angle is nudging comfort."
      );
    }
  }

  const uv = dayDaily?.uvMax;
  if (Number.isFinite(uv) && uv >= 6) {
    sentences.push(`UV can climb near ${uv.toFixed(1)} — sunscreen and shade breaks are smart.`);
  } else if (Number.isFinite(uv) && uv >= 3) {
    sentences.push("UV sits in the moderate range, so light protection helps for long outdoor blocks.");
  }

  const dailyCode = dayDaily?.weatherCode;
  if (Number.isFinite(dailyCode)) {
    sentences.push(`The blended daily snapshot reads as ${getWeatherDescriptionFn(dailyCode)}.`);
  }

  return sentences.join(" ").replace(/\s+/g, " ").trim();
}

function formatHourLabel(timestamp) {
  return new Intl.DateTimeFormat("en-US", {
    hour: "numeric",
    minute: "2-digit",
  }).format(new Date(timestamp));
}

/** Short hour marker for SVG x-axis (avoids wide “10:30 AM” when stacked by slot). */
function formatChartAxisHour(timestamp) {
  return new Intl.DateTimeFormat("en-US", {
    hour: "numeric",
  }).format(new Date(timestamp));
}

/** Typical millis between successive hourly timestamps (median); fallback 1 h. */
function medianHourGapMs(hourCards) {
  if (!hourCards?.length || hourCards.length < 2) return 3600000;
  const gaps = [];
  for (let i = 1; i < hourCards.length; i++) {
    gaps.push(Math.max(60000, new Date(hourCards[i].time).getTime() - new Date(hourCards[i - 1].time).getTime()));
  }
  gaps.sort((a, b) => a - b);
  const mid = gaps[Math.floor(gaps.length / 2)];
  return Number.isFinite(mid) && mid > 0 ? mid : 3600000;
}

function clampNum(value, lo, hi) {
  return Math.min(hi, Math.max(lo, value));
}

/**
 * Latest hourly timestep at or before `nowMs`.
 * Requires `times` sorted ascending—Open-Meteo hourly order. Used so sliding windows anchor to “this hour”, not the next forecast slot after now.
 */
function rollingHourlyStartIndex(times, nowMs = Date.now()) {
  if (!Array.isArray(times) || times.length === 0) return 0;
  let startIndex = -1;
  for (let i = times.length - 1; i >= 0; i -= 1) {
    const t = new Date(times[i]).getTime();
    if (Number.isFinite(t) && t <= nowMs) {
      startIndex = i;
      break;
    }
  }
  return startIndex < 0 ? 0 : startIndex;
}

/**
 * X position on the hourly chart SVG for “now”, interpolated within the visible series.
 */
function computeNowMarkerSvgX(hourCards, padding, stepX, width) {
  if (!hourCards?.length || !Number.isFinite(stepX) || stepX <= 0 || !Number.isFinite(padding) || !Number.isFinite(width)) {
    return null;
  }

  const nowMs = Date.now();
  const plotRight = Math.max(width - padding, padding);
  const slotEst = medianHourGapMs(hourCards);

  for (let i = 0; i < hourCards.length - 1; i++) {
    const tA = new Date(hourCards[i].time).getTime();
    const tB = new Date(hourCards[i + 1].time).getTime();
    if (nowMs >= tA && nowMs < tB) {
      const span = Math.max(tB - tA, 60000);
      const frac = (nowMs - tA) / span;
      return clampNum(padding + (i + frac) * stepX, padding, plotRight);
    }
  }

  const tLast = new Date(hourCards[hourCards.length - 1].time).getTime();
  if (nowMs >= tLast && nowMs < tLast + slotEst) {
    const frac = (nowMs - tLast) / Math.max(slotEst, 60000);
    return clampNum(padding + (hourCards.length - 1 + Math.min(frac, 1)) * stepX, padding, plotRight);
  }

  return null;
}

function formatTimeLabel(timestamp) {
  return new Intl.DateTimeFormat("en-US", {
    hour: "numeric",
    minute: "2-digit",
  }).format(new Date(timestamp));
}

function roundCoordinate(value, precision = 1) {
  const factor = 10 ** precision;
  return Math.round(value * factor) / factor;
}

function getDistanceScore(latA, lonA, latB, lonB) {
  const dLat = latA - latB;
  const dLon = lonA - lonB;
  return dLat * dLat + dLon * dLon;
}

/** Preferred GeoNames feature codes when picking / ranking settlements. */
const GEOCODE_PREFERR_PPL_FEATURES = new Set(["PPL", "PPLA", "PPLA2", "PPLA3", "PPLA4", "PPLC"]);

function pickNearestCity(results, targetLatitude, targetLongitude) {
  if (!Array.isArray(results) || results.length === 0) return null;

  const enriched = results
    .filter((item) => Number.isFinite(item?.latitude) && Number.isFinite(item?.longitude))
    .map((item) => ({
      item,
      distanceScore: getDistanceScore(targetLatitude, targetLongitude, item.latitude, item.longitude),
      population: item.population ?? 0,
      isCityCode: GEOCODE_PREFERR_PPL_FEATURES.has(item.feature_code),
    }));

  if (!enriched.length) return null;

  enriched.sort((a, b) => {
    // Prefer city-like locations, then nearest distance, then larger population.
    if (a.isCityCode !== b.isCityCode) return a.isCityCode ? -1 : 1;
    if (a.distanceScore !== b.distanceScore) return a.distanceScore - b.distanceScore;
    return (b.population ?? 0) - (a.population ?? 0);
  });

  return enriched[0].item;
}

function getCityFromTimezone(timezoneValue) {
  if (typeof timezoneValue !== "string" || !timezoneValue.includes("/")) return "";
  const parts = timezoneValue.split("/");
  const cityPart = parts[parts.length - 1] ?? "";
  return cityPart.replaceAll("_", " ").trim();
}

function getTimezoneLocationOverride(timezoneValue) {
  const overrides = {
    "America/St_Johns": {
      city: "St. John's",
      label: "St. John's, Newfoundland and Labrador, Canada",
    },
  };
  return overrides[timezoneValue] ?? null;
}

function getSeriesDomain(values) {
  const valid = values.filter((value) => Number.isFinite(value));
  if (!valid.length) return { min: 0, max: 1 };
  const min = Math.min(...valid);
  const max = Math.max(...valid);
  if (min === max) return { min: min - 1, max: max + 1 };
  return { min, max };
}

function buildLinePoints(values, width, height, padding) {
  if (values.length < 2) return "";
  const { min, max } = getSeriesDomain(values);
  const usableWidth = width - padding * 2;
  const usableHeight = height - padding * 2;
  const stepX = usableWidth / (values.length - 1);

  return values
    .map((value, index) => {
      const x = padding + index * stepX;
      const ratio = (value - min) / (max - min);
      const y = height - padding - ratio * usableHeight;
      return `${x},${y}`;
    })
    .join(" ");
}

function buildLinePointsWithDomain(values, width, height, padding, min, max) {
  if (values.length < 2) return "";
  const safeMin = Number.isFinite(min) ? min : 0;
  const safeMax = Number.isFinite(max) && max !== safeMin ? max : safeMin + 1;
  const usableWidth = width - padding * 2;
  const usableHeight = height - padding * 2;
  const stepX = usableWidth / (values.length - 1);

  return values
    .map((value, index) => {
      const x = padding + index * stepX;
      const ratio = (value - safeMin) / (safeMax - safeMin);
      const y = height - padding - ratio * usableHeight;
      return `${x},${y}`;
    })
    .join(" ");
}

/** SVG user-space `{x,y}` for each plotted point (supports single-point datasets). */
function buildSeriesCoordinatesWithDomain(values, width, height, padding, domainMin, domainMax) {
  if (!values.length) return [];
  const safeMin = Number.isFinite(domainMin) ? domainMin : 0;
  const safeMax = Number.isFinite(domainMax) && domainMax !== safeMin ? domainMax : safeMin + 1;
  const usableWidth = width - padding * 2;
  const usableHeight = height - padding * 2;

  return values.map((value, index) => {
    const x =
      values.length === 1
        ? padding + usableWidth / 2
        : padding + (index * usableWidth) / Math.max(values.length - 1, 1);
    const ratio = (value - safeMin) / (safeMax - safeMin);
    const y = height - padding - ratio * usableHeight;
    return { x, y };
  });
}

function buildSeriesCoordinates(values, width, height, padding) {
  const { min, max } = getSeriesDomain(values);
  return buildSeriesCoordinatesWithDomain(values, width, height, padding, min, max);
}

function svgPointFromClient(svgEl, clientX, clientY) {
  if (typeof svgEl.createSVGPoint !== "function") return null;
  const pt = svgEl.createSVGPoint();
  pt.x = clientX;
  pt.y = clientY;
  const ctm = svgEl.getScreenCTM();
  if (!ctm) return null;
  return pt.matrixTransform(ctm.inverse());
}

function hourSlotIndexFromSvgX(svgX, length, padding, chartWidth) {
  if (!length || length < 1) return 0;
  const plottingWidth = Math.max(chartWidth - padding * 2, 0);
  if (plottingWidth <= 0) return 0;
  const rel = svgX - padding;
  const ratio = Math.min(1, Math.max(0, rel / plottingWidth));
  const maxIdx = Math.max(length - 1, 1);
  return Math.min(length - 1, Math.max(0, Math.round(ratio * maxIdx)));
}

function pickNearestHourlySeries(mouseY, index, tempCoords, windCoords, precipCoords, thresholdPx) {
  const t = tempCoords[index];
  const w = windCoords[index];
  const p = precipCoords[index];
  if (!t || !w || !p) return null;
  const distances = [
    { key: "temp", distance: Math.abs(mouseY - t.y) },
    { key: "wind", distance: Math.abs(mouseY - w.y) },
    { key: "precip", distance: Math.abs(mouseY - p.y) },
  ];
  distances.sort((a, b) => {
    if (a.distance !== b.distance) return a.distance - b.distance;
    if (a.key === "temp") return -1;
    if (b.key === "temp") return 1;
    if (a.key === "wind") return -1;
    if (b.key === "wind") return 1;
    return 0;
  });
  if (!distances[0] || distances[0].distance > thresholdPx) return null;
  return distances[0].key;
}

function pickNearestFeelsSeries(mouseY, index, feelsCoords, actualCoords, thresholdPx) {
  const f = feelsCoords[index];
  const a = actualCoords[index];
  if (!f || !a) return null;
  const distances = [
    { key: "feels", distance: Math.abs(mouseY - f.y) },
    { key: "actual", distance: Math.abs(mouseY - a.y) },
  ];
  distances.sort((a, b) => {
    if (a.distance !== b.distance) return a.distance - b.distance;
    if (a.key === "feels") return -1;
    return 1;
  });
  if (!distances[0] || distances[0].distance > thresholdPx) return null;
  return distances[0].key;
}

async function fetchJsonWithRetry(url, retries = 2, timeoutMs = 10000) {
  let lastError = null;

  for (let attempt = 0; attempt <= retries; attempt += 1) {
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), timeoutMs);

    try {
      const response = await fetch(url, { signal: controller.signal });
      clearTimeout(timeoutId);

      if (!response.ok) {
        throw new Error(`Request failed (${response.status})`);
      }

      return await response.json();
    } catch (error) {
      clearTimeout(timeoutId);
      lastError = error;
      if (attempt < retries) {
        await new Promise((resolve) => setTimeout(resolve, 300 * (attempt + 1)));
      }
    }
  }

  throw lastError ?? new Error("Request failed");
}

function normalizeGeoMatchString(input) {
  if (typeof input !== "string" || !input) return "";
  return input
    .toLowerCase()
    .normalize("NFD")
    .replace(/\p{M}/gu, "")
    .replace(/[.'ʼ`´]/g, "")
    .replace(/\s+/g, " ")
    .trim();
}

function tokenizeGeoQuery(query) {
  return normalizeGeoMatchString(query)
    .split(/\s+/)
    .filter(Boolean)
    .filter((t) => t.length > 1 || t === "st");
}

function geoTokenHitsHaystack(token, hayNorm) {
  if (!token || !hayNorm) return false;
  if (hayNorm.includes(token)) return true;
  if (token === "st" || token === "saint") return /\b(st|saint)\b/.test(hayNorm);
  if (token.startsWith("john")) return hayNorm.includes("john") || hayNorm.includes("johns");
  return false;
}

/**
 * Derive Open-Meteo countryCode filter and strip obvious country suffixes so the primary `name` term matches settlements better.
 */
function parseGeocodeQuery(rawInput) {
  const original = typeof rawInput === "string" ? rawInput.trim() : "";
  if (!original) return { searchName: "", countryCode: null, original };

  let countryCode = null;
  let q = original;
  const lower = original.toLowerCase();

  const caRegion =
    /\bnewfoundland(\s+and\s+labrador)?\b/i.test(lower) ||
    /\b(british columbia|\bbc\b(?=[\s,]|$)|alberta|saskatchewan|manitoba|ontario|quebec|\bqc\b(?=[\s,]|$)|nova scotia|new brunswick|prince edward island|yukon|northwest territories|nunavut)\b/i.test(
      lower
    );
  if (caRegion) countryCode = "CA";

  function stripInto(iso, pattern) {
    if (pattern.test(q)) {
      countryCode = iso;
      q = q.replace(pattern, " ").replace(/\s+/g, " ").trim();
    }
  }

  stripInto("CA", /\bcanada\b/gi);
  stripInto("US", /\b(united states|usa|u\.s\.a\.|u\.s\.)\b/gi);
  stripInto(
    "GB",
    /\b(united kingdom|u\.k\.|uk|great britain|england|scotland|wales|northern ireland)\b/gi
  );
  stripInto("AU", /\baustralia\b/gi);
  stripInto("IE", /\bireland\b/gi);
  stripInto("NZ", /\bnew zealand\b/gi);
  stripInto("FR", /\bfrance\b/gi);
  stripInto("DE", /\b(germany|deutschland)\b/gi);

  const searchName = q.replace(/^[\s,.]+|[\s,.]+$/g, "").trim();
  return { searchName: searchName.length >= 2 ? searchName : original, countryCode, original };
}

function expandGeoSearchNames(trimmedOriginal, parsed) {
  const names = new Set([trimmedOriginal, parsed.searchName].filter((x) => x && x.trim().length >= 2));

  const lower = trimmedOriginal.toLowerCase();
  if (/\bst\.?\s+john'?s?\b/i.test(lower)) {
    names.add("St. John's");
  }

  return [...names];
}

function rankGeocodeResults(originalQuery, results) {
  if (!Array.isArray(results) || results.length === 0) return [];

  const tokens = tokenizeGeoQuery(originalQuery);
  const origNorm = normalizeGeoMatchString(originalQuery);
  const origCompact = origNorm.replace(/\s/g, "");

  const scored = [];

  for (const item of results) {
    if (!Number.isFinite(item?.latitude) || !Number.isFinite(item?.longitude)) continue;

    const haystackRaw = [item.name, item.admin1, item.admin2, item.country].filter(Boolean).join(" ");
    const hayNorm = normalizeGeoMatchString(haystackRaw);

    let score = 0;
    for (const t of tokens) {
      if (geoTokenHitsHaystack(t, hayNorm)) score += 28;
    }

    if (origNorm.length >= 4 && hayNorm.includes(origNorm)) score += 100;

    const nameCompact = normalizeGeoMatchString(item.name ?? "").replace(/\s/g, "");
    if (
      origCompact.length >= 6 &&
      (nameCompact.includes(origCompact) || origCompact.includes(nameCompact))
    ) {
      score += 72;
    }

    const population = Number(item.population) || 0;
    if (population > 0) score += Math.min(36, Math.log10(population + 1) * 7);

    const fc = item.feature_code ?? "";
    if (GEOCODE_PREFERR_PPL_FEATURES.has(fc)) score += 40;
    else if (typeof fc === "string" && fc.startsWith("PPL")) score += 18;

    scored.push({ item, score });
  }

  scored.sort((a, b) => {
    if (b.score !== a.score) return b.score - a.score;
    return (Number(b.item.population) || 0) - (Number(a.item.population) || 0);
  });

  return scored.map(({ item }) => item);
}

async function mergeGeocodeFromOpenMeteo(uniqueNames, countryCodeHint) {
  const mergedById = new Map();

  function ingestResults(arr) {
    if (!Array.isArray(arr)) return;
    for (const r of arr) {
      if (!Number.isFinite(r?.latitude) || !Number.isFinite(r?.longitude)) continue;
      const id = r.id ?? `${r.latitude}-${r.longitude}`;
      if (!mergedById.has(id)) mergedById.set(id, r);
    }
  }

  const urls = [];
  for (const name of uniqueNames) {
    const n = String(name).trim();
    if (n.length < 2) continue;
    const enc = encodeURIComponent(n);
    const base = `https://geocoding-api.open-meteo.com/v1/search?name=${enc}&count=${GEOCODE_FETCH_COUNT}&language=en&format=json`;
    if (countryCodeHint) urls.push(`${base}&countryCode=${countryCodeHint}`);
    urls.push(base);
  }

  await Promise.all(
    urls.map((url) =>
      fetchJsonWithRetry(url, 1, 9000).then((data) => ingestResults(data?.results ?? [])).catch(() => {})
    )
  );

  return [...mergedById.values()];
}

async function fetchRankedGeocodeResults(trimmedOriginal) {
  const parsed = parseGeocodeQuery(trimmedOriginal);
  const names = expandGeoSearchNames(trimmedOriginal, parsed);
  const raw = await mergeGeocodeFromOpenMeteo(names, parsed.countryCode);
  const ranked = rankGeocodeResults(parsed.original, raw);
  return ranked;
}

export default function App() {
  const searchAreaRef = useRef(null);
  const [query, setQuery] = useState("");
  const [suggestions, setSuggestions] = useState([]);
  const [showSuggestions, setShowSuggestions] = useState(false);
  const [isSearchFocused, setIsSearchFocused] = useState(false);
  const [isLoadingSuggestions, setIsLoadingSuggestions] = useState(false);
  const [recentSearches, setRecentSearches] = useState(() => getRecentSearches());
  const [activeCity, setActiveCity] = useState("");
  const [weather, setWeather] = useState(null);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState("");
  const [unit, setUnit] = useState("celsius");
  const [activeCoordinates, setActiveCoordinates] = useState(null);
  const [expandedForecastDate, setExpandedForecastDate] = useState(null);
  /** When set, hourly/feels graphs and daily summary widgets use this calendar day; `null` = rolling hours from the current clock hour (floored to the hourly grid). */
  const [forecastDetailDay, setForecastDetailDay] = useState(null);
  const [isLocating, setIsLocating] = useState(false);
  const [toast, setToast] = useState(null);
  const [aqiData, setAqiData] = useState(null);
  const [alerts, setAlerts] = useState([]);
  const [alertsUnavailable, setAlertsUnavailable] = useState(false);
  const [hoverHourlyIndex, setHoverHourlyIndex] = useState(null);
  const [hoverScreenPos, setHoverScreenPos] = useState(null);
  const [hoverFeelsIndex, setHoverFeelsIndex] = useState(null);
  const [hoverFeelsScreenPos, setHoverFeelsScreenPos] = useState(null);
  const [hoverHourlySeries, setHoverHourlySeries] = useState(null);
  const [hoverFeelsSeries, setHoverFeelsSeries] = useState(null);
  const [hourlyWindowStart, setHourlyWindowStart] = useState(0);
  /** `sliding` = 24h stream from the floored “now” slot + 12-slot window; `fullday` = calendar-day midnight → midnight (shows “now” marker when that day is ongoing). */
  const [hourlyCoverageMode, setHourlyCoverageMode] = useState("sliding");
  const [showHourlyDetails, setShowHourlyDetails] = useState(false);
  const latestRequestRef = useRef(0);
  const hourlyHoverBarHourRef = useRef(null);
  const [theme, setTheme] = useState(() => {
    const saved = localStorage.getItem("weather-dashboard-theme");
    if (saved === "light" || saved === "dark") return saved;
    const prefersDark = window.matchMedia && window.matchMedia("(prefers-color-scheme: dark)").matches;
    return prefersDark ? "dark" : "light";
  });

  const unitSymbol = unit === "celsius" ? "°C" : "°F";
  const windUnit = unit === "celsius" ? "km/h" : "mph";

  useEffect(() => {
    localStorage.setItem(RECENT_SEARCHES_KEY, JSON.stringify(recentSearches));
  }, [recentSearches]);

  useEffect(() => {
    localStorage.setItem("weather-dashboard-theme", theme);
  }, [theme]);

  const forecastCards = useMemo(() => {
    if (!weather?.daily) return [];
    return weather.daily.time.slice(0, FORECAST_DAILY_DAYS_SHOWN).map((date, index) => ({
      date,
      tempMax: weather.daily.temperature_2m_max[index],
      tempMin: weather.daily.temperature_2m_min[index],
      code: weather.daily.weathercode[index],
      precipitationProbabilityMax: weather.daily.precipitation_probability_max?.[index] ?? null,
      precipitationSum: weather.daily.precipitation_sum?.[index] ?? null,
      windMax: weather.daily.windspeed_10m_max?.[index] ?? null,
      uvMax: weather.daily.uv_index_max?.[index] ?? null,
      sunrise: weather.daily.sunrise?.[index] ?? null,
      sunset: weather.daily.sunset?.[index] ?? null,
    }));
  }, [weather]);

  const forecastDayIndex = useMemo(() => {
    if (!weather?.daily?.time?.length) return 0;
    if (!forecastDetailDay) return 0;
    const idx = weather.daily.time.indexOf(forecastDetailDay);
    return idx >= 0 ? idx : 0;
  }, [weather, forecastDetailDay]);

  const dayAtAGlance = useMemo(() => {
    if (!weather?.daily?.time?.length) return null;
    const idx = forecastDayIndex;
    const dateLabel = weather.daily.time[idx];
    if (!dateLabel) return null;
    return {
      dateLabel,
      tempMax: weather.daily.temperature_2m_max?.[idx] ?? null,
      tempMin: weather.daily.temperature_2m_min?.[idx] ?? null,
      precipitationSum: weather.daily.precipitation_sum?.[idx] ?? null,
      precipitationProbabilityMax: weather.daily.precipitation_probability_max?.[idx] ?? null,
      uvMax: weather.daily.uv_index_max?.[idx] ?? null,
      windMax: weather.daily.windspeed_10m_max?.[idx] ?? null,
      sunrise: weather.daily.sunrise?.[idx] ?? null,
      sunset: weather.daily.sunset?.[idx] ?? null,
      weatherCode: weather.daily.weathercode?.[idx] ?? null,
    };
  }, [weather, forecastDayIndex]);

  const forecastAlerts = useMemo(() => {
    const results = [];
    if (!weather?.daily?.time?.length) return results;

    const i = forecastDayIndex;
    const maxWind = weather.daily.windspeed_10m_max?.[i] ?? 0;
    const precipChance = weather.daily.precipitation_probability_max?.[i] ?? 0;
    const precipTotal = weather.daily.precipitation_sum?.[i] ?? 0;
    const uvMax = weather.daily.uv_index_max?.[i] ?? 0;
    const highTemp = weather.daily.temperature_2m_max?.[i] ?? 0;
    const lowTemp = weather.daily.temperature_2m_min?.[i] ?? 0;
    const highTempC = unit === "fahrenheit" ? (highTemp - 32) * (5 / 9) : highTemp;
    const lowTempC = unit === "fahrenheit" ? (lowTemp - 32) * (5 / 9) : lowTemp;

    if (maxWind >= 55) {
      results.push({
        id: "derived-wind",
        event: "High Wind Advisory",
        headline: `Forecast wind gust potential is elevated (${Math.round(maxWind)} ${windUnit}).`,
      });
    }
    if (precipChance >= 70 || precipTotal >= 20) {
      results.push({
        id: "derived-precip",
        event: "Heavy Precipitation Risk",
        headline: `Precipitation risk is high (${Math.round(precipChance)}% chance, ${precipTotal.toFixed(1)} mm expected).`,
      });
    }
    if (uvMax >= 7) {
      results.push({
        id: "derived-uv",
        event: "High UV Index",
        headline: `UV index may reach ${uvMax.toFixed(1)}. Sun protection is recommended.`,
      });
    }
    if (highTempC >= 32 || lowTempC <= -5) {
      results.push({
        id: "derived-temp",
        event: "Temperature Advisory",
        headline: `Temperature range may be extreme this day (${Math.round(highTemp)}${unitSymbol} / ${Math.round(
          lowTemp
        )}${unitSymbol}).`,
      });
    }

    return results;
  }, [weather, forecastDayIndex, windUnit, unitSymbol, unit]);

  const hourlyCards = useMemo(() => {
    if (!weather?.hourly?.time?.length) return [];

    const times = weather.hourly.time;

    function rowAt(index) {
      return {
        time: times[index],
        temp: weather.hourly.temperature_2m[index],
        apparentTemp: weather.hourly.apparent_temperature?.[index] ?? null,
        precipitationProbability: weather.hourly.precipitation_probability[index],
        precipitation: weather.hourly.precipitation[index],
        windspeed: weather.hourly.windspeed_10m[index],
        weatherCode: weather.hourly.weathercode?.[index] ?? null,
      };
    }

    const daySliceForKey = (dayKey) => {
      const matched = [];
      for (let i = 0; i < times.length; i++) {
        if (hourlyTimeDateKey(times[i]) === dayKey) matched.push(rowAt(i));
      }
      return matched.slice(0, 24);
    };

    if (forecastDetailDay) {
      return daySliceForKey(forecastDetailDay);
    }

    if (hourlyCoverageMode === "fullday") {
      const anchorKey = weather.daily?.time?.[0] ?? hourlyTimeDateKey(times[0] ?? "");
      if (!anchorKey) return [];
      return daySliceForKey(anchorKey);
    }

    const now = Date.now();
    const startIndex = rollingHourlyStartIndex(times, now);

    return times
      .slice(startIndex, Math.min(times.length, startIndex + 24))
      .map((_, index) => rowAt(startIndex + index));
  }, [weather, forecastDetailDay, hourlyCoverageMode]);

  const currentAqi = useMemo(() => {
    if (!aqiData?.hourly?.time?.length) return null;
    const now = Date.now();
    const times = aqiData.hourly.time;
    const idx = rollingHourlyStartIndex(times, now);
    return {
      usAqi: aqiData.hourly.us_aqi?.[idx] ?? null,
      euAqi: aqiData.hourly.european_aqi?.[idx] ?? null,
      pm25: aqiData.hourly.pm2_5?.[idx] ?? null,
      pm10: aqiData.hourly.pm10?.[idx] ?? null,
      ozone: aqiData.hourly.ozone?.[idx] ?? null,
      no2: aqiData.hourly.nitrogen_dioxide?.[idx] ?? null,
      so2: aqiData.hourly.sulphur_dioxide?.[idx] ?? null,
      pollen: {
        alder: aqiData.hourly.alder_pollen?.[idx] ?? null,
        birch: aqiData.hourly.birch_pollen?.[idx] ?? null,
        grass: aqiData.hourly.grass_pollen?.[idx] ?? null,
        ragweed: aqiData.hourly.ragweed_pollen?.[idx] ?? null,
      },
    };
  }, [aqiData]);

  const hourlyVisibleWindowSize =
    hourlyCoverageMode === "fullday" ? hourlyCards.length : HOURLY_SLIDING_VISIBLE_HOURS;

  const visibleHourlyCards = useMemo(() => {
    return hourlyCards.slice(hourlyWindowStart, hourlyWindowStart + hourlyVisibleWindowSize);
  }, [hourlyCards, hourlyWindowStart, hourlyVisibleWindowSize]);

  const sharedChartViewBox = useMemo(() => {
    const n = visibleHourlyCards.length;
    if (!n) return null;
    return getSharedHourlyChartViewBox(n);
  }, [visibleHourlyCards.length]);

  const showHourlyWindowSlider =
    hourlyCoverageMode === "sliding" &&
    hourlyCards.length > hourlyVisibleWindowSize &&
    hourlyVisibleWindowSize > 0;

  const dayRundownText = useMemo(() => {
    if (!weather) return "";
    return buildDayRundownParagraph({
      dayDaily: dayAtAGlance,
      hourlySeries: hourlyCards,
      unit,
      unitSymbol,
      windUnit,
      forecastDetailDay,
      formatDisplayDateFn: formatDisplayDate,
      getWeatherDescriptionFn: getWeatherDescription,
    });
  }, [weather, dayAtAGlance, hourlyCards, unit, unitSymbol, windUnit, forecastDetailDay]);

  const feelsLikeTrend = useMemo(() => {
    if (!visibleHourlyCards.length || !sharedChartViewBox) return null;
    const feelsValues = visibleHourlyCards.map((item) => item.apparentTemp ?? item.temp ?? 0);
    const actualValues = visibleHourlyCards.map((item) => item.temp ?? 0);
    const { width, height, padding, stepX } = sharedChartViewBox;
    const combinedValues = [...feelsValues, ...actualValues];
    const min = Math.min(...combinedValues);
    const max = Math.max(...combinedValues);
    const avg = feelsValues.reduce((sum, value) => sum + value, 0) / feelsValues.length;
    const feelsPoints = buildLinePointsWithDomain(feelsValues, width, height, padding, min, max);
    const actualPoints = buildLinePointsWithDomain(actualValues, width, height, padding, min, max);
    const feelsCoords = buildSeriesCoordinatesWithDomain(feelsValues, width, height, padding, min, max);
    const actualCoords = buildSeriesCoordinatesWithDomain(actualValues, width, height, padding, min, max);
    const tickCount = 5;
    const yTicks = Array.from({ length: tickCount }, (_, index) => {
      const ratio = index / (tickCount - 1);
      const value = max - ratio * (max - min);
      const y = padding + ratio * (height - padding * 2);
      return { value, y };
    });

    return {
      width,
      height,
      padding,
      stepX,
      feelsPoints,
      actualPoints,
      feelsCoords,
      actualCoords,
      areaPoints: `${padding},${height - padding} ${feelsPoints} ${width - padding},${height - padding}`,
      min,
      max,
      avg,
      yTicks,
    };
  }, [visibleHourlyCards, sharedChartViewBox]);

  const mapUrl = useMemo(() => {
    if (!activeCoordinates) return "";
    const { latitude, longitude } = activeCoordinates;
    return `https://embed.windy.com/embed2.html?lat=${latitude}&lon=${longitude}&detailLat=${latitude}&detailLon=${longitude}&width=650&height=420&zoom=6&level=surface&overlay=rain&product=ecmwf&menu=false&message=false&marker=true&calendar=now&pressure=false&type=map&location=coordinates&detail=false&metricWind=${unit === "celsius" ? "kmh" : "mph"}&metricTemp=${unit === "celsius" ? "c" : "f"}`;
  }, [activeCoordinates, unit]);

  const hourlyChart = useMemo(() => {
    if (!visibleHourlyCards.length || !sharedChartViewBox) return null;

    const { width: chartWidth, height: chartHeight, padding } = sharedChartViewBox;

    const temperatures = visibleHourlyCards.map((item) => item.temp ?? 0);
    const windspeeds = visibleHourlyCards.map((item) => item.windspeed ?? 0);
    const precipitation = visibleHourlyCards.map((item) => item.precipitation ?? 0);
    const precipitationMax = Math.max(...precipitation, 1);
    const tempMax = Math.max(...temperatures);
    const tempMin = Math.min(...temperatures);
    const tempMaxIndex = temperatures.indexOf(tempMax);
    const tempMinIndex = temperatures.indexOf(tempMin);
    const tickCount = 5;
    const yTicks = Array.from({ length: tickCount }, (_, index) => {
      const ratio = index / (tickCount - 1);
      const value = tempMax - ratio * (tempMax - tempMin);
      const y = padding + ratio * (chartHeight - padding * 2);
      return { value, y };
    });

    const tempCoords = buildSeriesCoordinates(temperatures, chartWidth, chartHeight, padding);
    const windCoords = buildSeriesCoordinates(windspeeds, chartWidth, chartHeight, padding);
    const precipCoords = buildSeriesCoordinatesWithDomain(
      precipitation,
      chartWidth,
      chartHeight,
      padding,
      0,
      precipitationMax
    );

    return {
      width: chartWidth,
      height: chartHeight,
      padding,
      stepX: sharedChartViewBox.stepX,
      tempCoords,
      windCoords,
      precipCoords,
      tempPoints: buildLinePoints(temperatures, chartWidth, chartHeight, padding),
      windPoints: buildLinePoints(windspeeds, chartWidth, chartHeight, padding),
      // Anchor precipitation scale to 0 so "no precip" stays at bottom.
      precipPoints: buildLinePointsWithDomain(
        precipitation,
        chartWidth,
        chartHeight,
        padding,
        0,
        precipitationMax
      ),
      tempDomain: getSeriesDomain(temperatures),
      tempMax,
      tempMin,
      tempMaxIndex,
      tempMinIndex,
      tempMaxTime: visibleHourlyCards[tempMaxIndex]?.time ?? null,
      tempMinTime: visibleHourlyCards[tempMinIndex]?.time ?? null,
      yTicks,
    };
  }, [visibleHourlyCards, sharedChartViewBox]);

  const chartNowMarkerSvgX =
    sharedChartViewBox && visibleHourlyCards.length
      ? computeNowMarkerSvgX(
          visibleHourlyCards,
          sharedChartViewBox.padding,
          sharedChartViewBox.stepX,
          sharedChartViewBox.width
        )
      : null;

  const hoveredHour = hoverHourlyIndex !== null ? visibleHourlyCards[hoverHourlyIndex] : null;
  const hoveredFeelsHour = hoverFeelsIndex !== null ? visibleHourlyCards[hoverFeelsIndex] : null;
  if (hoveredHour) {
    hourlyHoverBarHourRef.current = hoveredHour;
  }
  const hourlyHoverBarDisplayHour = hoveredHour ?? hourlyHoverBarHourRef.current;

  const chartPointerUpdateFeels = useCallback(
    (clientX, clientY, currentTarget) => {
      const svg = currentTarget.ownerSVGElement;
      if (!svg || !feelsLikeTrend) return;
      const cursor = svgPointFromClient(svg, clientX, clientY);
      const bounds = currentTarget.getBoundingClientRect();
      const localX = clientX - bounds.left;
      if (!cursor) {
        const ratio = localX / bounds.width;
        const idx = Math.min(
          visibleHourlyCards.length - 1,
          Math.max(0, Math.round(ratio * Math.max(visibleHourlyCards.length - 1, 1)))
        );
        setHoverFeelsIndex(idx);
        setHoverFeelsScreenPos({ x: localX + 12, y: 10 });
        setHoverFeelsSeries(null);
        return;
      }
      const idx = hourSlotIndexFromSvgX(cursor.x, visibleHourlyCards.length, feelsLikeTrend.padding, feelsLikeTrend.width);
      const hitThreshold = Math.min(32, Math.max(12, feelsLikeTrend.height * 0.09));
      const nearest = pickNearestFeelsSeries(
        cursor.y,
        idx,
        feelsLikeTrend.feelsCoords,
        feelsLikeTrend.actualCoords,
        hitThreshold
      );
      setHoverFeelsIndex(idx);
      setHoverFeelsSeries(nearest);
      setHoverFeelsScreenPos({ x: localX + 12, y: 10 });
    },
    [feelsLikeTrend, visibleHourlyCards]
  );

  const chartPointerUpdateHourly = useCallback(
    (clientX, clientY, currentTarget) => {
      const svg = currentTarget.ownerSVGElement;
      if (!svg || !hourlyChart) return;
      const cursor = svgPointFromClient(svg, clientX, clientY);
      const bounds = currentTarget.getBoundingClientRect();
      const localX = clientX - bounds.left;
      if (!cursor) {
        const ratio = localX / bounds.width;
        const idx = Math.min(
          visibleHourlyCards.length - 1,
          Math.max(0, Math.round(ratio * Math.max(visibleHourlyCards.length - 1, 1)))
        );
        setHoverHourlyIndex(idx);
        setHoverScreenPos({ x: localX + 12, y: 16 });
        setHoverHourlySeries(null);
        return;
      }
      const idx = hourSlotIndexFromSvgX(cursor.x, visibleHourlyCards.length, hourlyChart.padding, hourlyChart.width);
      const hitThreshold = Math.min(36, Math.max(14, hourlyChart.height * 0.095));
      const nearest = pickNearestHourlySeries(
        cursor.y,
        idx,
        hourlyChart.tempCoords,
        hourlyChart.windCoords,
        hourlyChart.precipCoords,
        hitThreshold
      );
      setHoverHourlyIndex(idx);
      setHoverHourlySeries(nearest);
      setHoverScreenPos({ x: localX + 12, y: 16 });
    },
    [hourlyChart, visibleHourlyCards]
  );

  async function fetchEnvironmentalData(latitude, longitude, requestId) {
    try {
      const [airQuality] = await Promise.allSettled([
        fetchJsonWithRetry(
          `https://air-quality-api.open-meteo.com/v1/air-quality?latitude=${latitude}&longitude=${longitude}&hourly=us_aqi,european_aqi,pm10,pm2_5,ozone,nitrogen_dioxide,sulphur_dioxide,alder_pollen,birch_pollen,grass_pollen,mugwort_pollen,olive_pollen,ragweed_pollen&timezone=auto`,
          1,
          9000
        ),
      ]);

      if (requestId !== latestRequestRef.current) return;

      if (airQuality.status === "fulfilled") {
        setAqiData(airQuality.value);
      } else {
        setAqiData(null);
      }

      // weather.gov is US-only; avoid noisy 400s for non-US coordinates.
      setAlerts([]);
      setAlertsUnavailable(false);
    } catch {
      if (requestId !== latestRequestRef.current) return;
      setAqiData(null);
      setAlerts([]);
      setAlertsUnavailable(false);
    }
  }

  function showToast(message, kind = "info") {
    setToast({ message, kind });
  }

  useEffect(() => {
    if (!toast) return;
    const timeoutId = setTimeout(() => setToast(null), 2600);
    return () => clearTimeout(timeoutId);
  }, [toast]);

  useEffect(() => {
    const maxStart = Math.max(0, hourlyCards.length - hourlyVisibleWindowSize);
    if (hourlyWindowStart > maxStart) {
      setHourlyWindowStart(maxStart);
    }
  }, [hourlyCards, hourlyWindowStart, hourlyVisibleWindowSize]);

  useEffect(() => {
    setHourlyWindowStart(0);
    hourlyHoverBarHourRef.current = null;
    setHoverHourlySeries(null);
    setHoverFeelsSeries(null);
  }, [weather?.hourly?.time, forecastDetailDay, hourlyCoverageMode]);

  useEffect(() => {
    setHoverHourlyIndex(null);
    setHoverScreenPos(null);
    setHoverFeelsIndex(null);
    setHoverFeelsScreenPos(null);
    setHoverHourlySeries(null);
    setHoverFeelsSeries(null);
    hourlyHoverBarHourRef.current = null;
  }, [hourlyWindowStart, forecastDetailDay]);

  useEffect(() => {
    function handleDocumentPointerDown(event) {
      if (!searchAreaRef.current) return;
      if (!searchAreaRef.current.contains(event.target)) {
        setShowSuggestions(false);
        setIsSearchFocused(false);
      }
    }

    document.addEventListener("pointerdown", handleDocumentPointerDown);
    return () => {
      document.removeEventListener("pointerdown", handleDocumentPointerDown);
    };
  }, []);

  useEffect(() => {
    const trimmed = query.trim();
    if (trimmed.length < 2) {
      setSuggestions([]);
      setShowSuggestions(false);
      setIsLoadingSuggestions(false);
      return;
    }

    let isCancelled = false;
    const timeoutId = setTimeout(async () => {
      setIsLoadingSuggestions(true);
      try {
        const ranked = await fetchRankedGeocodeResults(trimmed);
        if (isCancelled) return;

        const nextSuggestions = ranked.slice(0, AUTOCOMPLETE_LIMIT).map((result) => ({
          id: `${result.id ?? `${result.latitude}-${result.longitude}`}`,
          name: result.name,
          country: result.country ?? "",
          admin1: result.admin1 ?? "",
          latitude: result.latitude,
          longitude: result.longitude,
        }));

        setSuggestions(nextSuggestions);
        setShowSuggestions(nextSuggestions.length > 0 && isSearchFocused);
      } catch {
        if (!isCancelled) {
          setSuggestions([]);
          setShowSuggestions(false);
        }
      } finally {
        if (!isCancelled) {
          setIsLoadingSuggestions(false);
        }
      }
    }, 300);

    return () => {
      isCancelled = true;
      clearTimeout(timeoutId);
    };
  }, [query, isSearchFocused]);

  async function fetchWeather(searchTarget) {
    const requestId = ++latestRequestRef.current;
    const fromCoordinates = typeof searchTarget === "object" && searchTarget !== null;
    const rawQuery = fromCoordinates ? searchTarget.name ?? "" : searchTarget;
    const trimmedCity = String(rawQuery).trim();
    if (!trimmedCity && !fromCoordinates) return;

    setError("");
    setIsLoading(true);
    setShowSuggestions(false);

    try {
      let location = null;
      if (fromCoordinates) {
        location = searchTarget;
      } else {
        const ranked = await fetchRankedGeocodeResults(trimmedCity);
        location = ranked[0] ?? null;
      }

      if (!location) {
        throw new Error("City not found. Try another name.");
      }

      const weatherData = await fetchJsonWithRetry(
        `https://api.open-meteo.com/v1/forecast?latitude=${location.latitude}&longitude=${location.longitude}&forecast_days=${FORECAST_API_DAYS}&current=temperature_2m,apparent_temperature,relative_humidity_2m,windspeed_10m,weathercode,surface_pressure,visibility,cloudcover,dewpoint_2m&hourly=temperature_2m,apparent_temperature,precipitation_probability,precipitation,windspeed_10m,weathercode&daily=weathercode,temperature_2m_max,temperature_2m_min,precipitation_probability_max,precipitation_sum,windspeed_10m_max,uv_index_max,sunrise,sunset&timezone=auto&temperature_unit=${unit}&windspeed_unit=${unit === "celsius" ? "kmh" : "mph"}`
      );
      if (requestId !== latestRequestRef.current) return;
      setForecastDetailDay(null);
      setExpandedForecastDate(null);
      setWeather(weatherData);
      const locationLabel = `${location.name}${location.admin1 ? `, ${location.admin1}` : ""}${location.country ? `, ${location.country}` : ""}`;
      setActiveCity(locationLabel);
      setQuery(location.name ?? trimmedCity);
      setShowSuggestions(false);
      setActiveCoordinates({
        latitude: location.latitude,
        longitude: location.longitude,
      });
      fetchEnvironmentalData(location.latitude, location.longitude, requestId);

      if (location.name) {
        setRecentSearches((prev) => {
          const next = [
            location.name,
            ...prev.filter((item) => item.toLowerCase() !== location.name.toLowerCase()),
          ];
          return next.slice(0, MAX_RECENT_SEARCHES);
        });
      }
    } catch (err) {
      if (requestId !== latestRequestRef.current) return;
      setError("Unable to fetch weather right now. Please try again.");
      setWeather(null);
    } finally {
      if (requestId !== latestRequestRef.current) return;
      setIsLoading(false);
    }
  }

  async function fetchWeatherFromCoordinates(latitude, longitude) {
    const requestId = ++latestRequestRef.current;
    setError("");
    setIsLoading(true);
    setIsLocating(true);

    try {
      const preciseLatitude = roundCoordinate(latitude, 3);
      const preciseLongitude = roundCoordinate(longitude, 3);

      const weatherData = await fetchJsonWithRetry(
        `https://api.open-meteo.com/v1/forecast?latitude=${preciseLatitude}&longitude=${preciseLongitude}&forecast_days=${FORECAST_API_DAYS}&current=temperature_2m,apparent_temperature,relative_humidity_2m,windspeed_10m,weathercode,surface_pressure,visibility,cloudcover,dewpoint_2m&hourly=temperature_2m,apparent_temperature,precipitation_probability,precipitation,windspeed_10m,weathercode&daily=weathercode,temperature_2m_max,temperature_2m_min,precipitation_probability_max,precipitation_sum,windspeed_10m_max,uv_index_max,sunrise,sunset&timezone=auto&temperature_unit=${unit}&windspeed_unit=${unit === "celsius" ? "kmh" : "mph"}`
      );
      if (requestId !== latestRequestRef.current) return;
      setForecastDetailDay(null);
      setExpandedForecastDate(null);
      setWeather(weatherData);
      setActiveCoordinates({ latitude: preciseLatitude, longitude: preciseLongitude });
      fetchEnvironmentalData(preciseLatitude, preciseLongitude, requestId);
      const timezoneOverride = getTimezoneLocationOverride(weatherData?.timezone);
      const timezoneCity = getCityFromTimezone(weatherData?.timezone);

      if (timezoneOverride) {
        setActiveCity(timezoneOverride.label);
        setQuery(timezoneOverride.city);
        setShowSuggestions(false);
        return;
      }

      if (timezoneCity) {
        try {
          const cityLookup = await fetchJsonWithRetry(
            `https://geocoding-api.open-meteo.com/v1/search?name=${encodeURIComponent(timezoneCity)}&count=10&language=en&format=json`,
            1,
            8000
          );
          if (requestId !== latestRequestRef.current) return;

          const nearestMatch = pickNearestCity(cityLookup?.results, preciseLatitude, preciseLongitude);
          if (nearestMatch?.name) {
            const locationLabel = `${nearestMatch.name}${nearestMatch.admin1 ? `, ${nearestMatch.admin1}` : ""}${
              nearestMatch.country ? `, ${nearestMatch.country}` : ""
            }`;
            setActiveCity(locationLabel);
            setQuery(nearestMatch.name);
            setShowSuggestions(false);
          } else {
            setActiveCity(timezoneCity);
            setQuery(timezoneCity);
            setShowSuggestions(false);
          }
        } catch {
          if (requestId !== latestRequestRef.current) return;
          setActiveCity(timezoneCity);
          setQuery(timezoneCity);
          setShowSuggestions(false);
        }
      } else {
        setActiveCity("Nearby Area");
      }
    } catch (err) {
      if (requestId !== latestRequestRef.current) return;
      setError("Unable to fetch weather for your location right now.");
    } finally {
      if (requestId !== latestRequestRef.current) return;
      setIsLoading(false);
      setIsLocating(false);
    }
  }

  function onSearchSubmit(event) {
    event.preventDefault();
    fetchWeather(query);
  }

  function selectSuggestion(suggestion) {
    setQuery(suggestion.name);
    setShowSuggestions(false);
    setSuggestions([]);
    setIsSearchFocused(false);
    if (document.activeElement instanceof HTMLElement) {
      document.activeElement.blur();
    }
    fetchWeather(suggestion);
  }

  useEffect(() => {
    if (activeCoordinates) {
      fetchWeatherFromCoordinates(activeCoordinates.latitude, activeCoordinates.longitude);
      return;
    }
    if (activeCity) {
      const fallbackName = activeCity.split(",")[0] ?? "";
      if (fallbackName) {
        fetchWeather(fallbackName);
      }
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [unit]);

  useEffect(() => {
    if (!("geolocation" in navigator)) return;
    let isCancelled = false;
    setIsLocating(true);
    navigator.geolocation.getCurrentPosition(
      ({ coords }) => {
        if (isCancelled) return;
        fetchWeatherFromCoordinates(coords.latitude, coords.longitude);
      },
      () => {
        if (!isCancelled) {
          setIsLocating(false);
        }
      },
      {
        enableHighAccuracy: true,
        timeout: 12000,
        maximumAge: 0,
      }
    );

    return () => {
      isCancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const forecastWeekGroups = chunkForecastDays(forecastCards);

  function toggleForecastDay(dayDate) {
    const expandedNext = expandedForecastDate === dayDate ? null : dayDate;
    setExpandedForecastDate(expandedNext);
    setForecastDetailDay(expandedNext);
  }

  return (
    <main className={`app-shell theme-${theme} min-h-screen bg-gradient-to-b from-sky-950 to-slate-950 text-slate-100`}>
      <div className="mx-auto grid max-w-7xl grid-cols-1 gap-6 px-6 py-10 lg:grid-cols-[260px_minmax(0,1fr)]">
        <aside className="hidden lg:block">
          <div className="glass-panel sticky top-6 animate-fade-in rounded-xl p-4">
            <p className="text-xs uppercase tracking-wide text-slate-400">Current Location</p>
            <h2 className="mt-1 text-lg font-semibold text-slate-100">{activeCity || "Searching..."}</h2>
            {weather?.current ? (
              <div className="mt-3 space-y-2 text-sm">
                <p className="text-slate-200">
                  <span className="mr-2 text-lg">{getWeatherEmoji(weather.current.weathercode)}</span>
                  {getWeatherDescription(weather.current.weathercode)}
                </p>
                <p className="text-slate-100">
                  Temp: {Math.round(weather.current.temperature_2m)}
                  {unitSymbol}
                </p>
                <p className="text-slate-300">
                  Feels: {Math.round(weather.current.apparent_temperature)}
                  {unitSymbol}
                </p>
                <p className="text-slate-300">
                  Wind: {Math.round(weather.current.windspeed_10m)} {windUnit}
                </p>
              </div>
            ) : (
              <p className="mt-3 text-sm text-slate-400">Waiting for weather data...</p>
            )}
          </div>
        </aside>
        <div className="flex flex-col gap-6">
        <header className="space-y-2">
          <div className="flex items-start justify-between gap-3">
            <div>
              <h1 className="text-4xl font-bold tracking-tight">Weather Dashboard</h1>
              <p className="text-slate-300">
                Search any city for current weather, hourly charts, and a {FORECAST_DAILY_DAYS_SHOWN}-day outlook (forecast data
                span up to {FORECAST_API_DAYS}&nbsp;days from the weather model).
              </p>
            </div>
            <button
              className="rounded-lg border border-slate-600 bg-slate-900/70 px-3 py-2 text-sm font-semibold text-slate-100 transition hover:border-sky-400"
              onClick={() => setTheme((prev) => (prev === "dark" ? "light" : "dark"))}
              type="button"
            >
              {theme === "dark" ? "Light mode" : "Dark mode"}
            </button>
          </div>
        </header>

        <section className="animate-fade-in relative z-30 rounded-xl border border-sky-700/40 bg-slate-900/40 p-5">
          <form className="flex flex-col gap-3 sm:flex-row" onSubmit={onSearchSubmit}>
            <div className="relative w-full" ref={searchAreaRef}>
              <input
                className="w-full rounded-lg border border-slate-600 bg-slate-900/80 px-4 py-3 text-slate-100 outline-none transition-all duration-200 focus:border-sky-400"
                placeholder="Search city (e.g. St Johns Newfoundland, London)"
                value={query}
                aria-autocomplete="list"
                aria-controls="city-suggestions-list"
                aria-expanded={showSuggestions}
                aria-label="Search city"
                onChange={(event) => {
                  setQuery(event.target.value);
                  setIsSearchFocused(true);
                  if (event.target.value.trim().length >= 2) {
                    setShowSuggestions(true);
                  }
                }}
                onFocus={() => {
                  setIsSearchFocused(true);
                  setShowSuggestions(suggestions.length > 0);
                }}
                onBlur={() => {
                  setIsSearchFocused(false);
                }}
                onKeyDown={(event) => {
                  if (event.key === "Escape") {
                    setShowSuggestions(false);
                    setIsSearchFocused(false);
                  }
                }}
              />
              {showSuggestions ? (
                <div
                  className="absolute z-50 mt-1 max-h-72 w-full overflow-y-auto rounded-lg border border-slate-700 bg-slate-900 shadow-xl"
                  id="city-suggestions-list"
                  role="listbox"
                >
                  {suggestions.map((suggestion) => (
                    <button
                      className="block w-full border-b border-slate-800 px-4 py-3 text-left text-sm text-slate-200 transition last:border-none hover:bg-slate-800"
                      key={suggestion.id}
                      role="option"
                      aria-label={`${suggestion.name}${suggestion.admin1 ? `, ${suggestion.admin1}` : ""}${
                        suggestion.country ? `, ${suggestion.country}` : ""
                      }`}
                      onMouseDown={(event) => {
                        event.preventDefault();
                        selectSuggestion(suggestion);
                      }}
                      type="button"
                    >
                      <span className="font-medium">{suggestion.name}</span>
                      <span className="text-slate-400">
                        {suggestion.admin1 ? `, ${suggestion.admin1}` : ""}
                        {suggestion.country ? `, ${suggestion.country}` : ""}
                      </span>
                    </button>
                  ))}
                </div>
              ) : null}
              {isLoadingSuggestions ? (
                <p className="mt-1 text-xs text-slate-400">Loading suggestions...</p>
              ) : null}
            </div>
            <button
              className="rounded-lg bg-sky-500 px-4 py-3 font-semibold text-slate-950 transition-all duration-200 hover:scale-[1.02] hover:bg-sky-400 disabled:cursor-not-allowed disabled:opacity-50"
              type="submit"
              disabled={isLoading}
            >
              {isLoading ? "Searching..." : "Search"}
            </button>
            <button
              className="rounded-lg border border-slate-600 bg-slate-900/80 px-4 py-3 text-sm font-semibold text-slate-100 transition-all duration-200 hover:scale-[1.02] hover:border-sky-400 disabled:cursor-not-allowed disabled:opacity-50"
              disabled={isLocating}
              onClick={() => {
                if (!("geolocation" in navigator)) {
                  setError("Geolocation is not supported in this browser.");
                  return;
                }
                navigator.geolocation.getCurrentPosition(
                  ({ coords }) => {
                    fetchWeatherFromCoordinates(coords.latitude, coords.longitude);
                  },
                  () => {
                    setError("Location permission denied. Enable location access and try again.");
                  },
                  {
                    enableHighAccuracy: true,
                    timeout: 12000,
                    maximumAge: 0,
                  }
                );
              }}
              type="button"
            >
              {isLocating ? "Locating..." : "Use My Location"}
            </button>
          </form>

          {recentSearches.length > 0 ? (
            <div className="mt-4 flex flex-wrap gap-2">
              {recentSearches.map((city) => (
                <div
                  key={city}
                  className="group inline-flex items-center gap-1 rounded-full border border-sky-400/40 bg-sky-900/30 px-2 py-1 text-sm text-sky-100"
                >
                  <button
                    className="px-1 transition hover:text-white"
                    onClick={() => {
                      setQuery(city);
                      fetchWeather(city);
                    }}
                    type="button"
                  >
                    {city}
                  </button>
                  <button
                    aria-label={`Remove ${city} from recent searches`}
                    className="rounded-full px-1 text-sky-300 transition hover:bg-sky-800/60 hover:text-white"
                    onClick={() =>
                      setRecentSearches((prev) => {
                        const next = prev.filter((item) => item.toLowerCase() !== city.toLowerCase());
                        showToast(`Removed ${city} from recent searches.`, "info");
                        return next;
                      })
                    }
                    type="button"
                  >
                    ×
                  </button>
                </div>
              ))}
              <button
                className="rounded-full border border-rose-400/40 bg-rose-900/20 px-3 py-1 text-xs font-semibold text-rose-200 transition hover:border-rose-300 hover:bg-rose-800/30"
                onClick={() => {
                  setRecentSearches([]);
                  showToast("Cleared recent searches.", "info");
                }}
                type="button"
              >
                Clear All
              </button>
            </div>
          ) : null}
        </section>

        {error ? (
          <section className="rounded-xl border border-rose-500/50 bg-rose-900/20 p-4 text-rose-100">{error}</section>
        ) : null}

        {weather?.current ? (
          <section className="glass-panel animate-fade-in rounded-xl p-5">
            <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
              <h2 className="text-2xl font-semibold">{activeCity || "Current Weather"}</h2>
              <div className="inline-flex w-fit rounded-lg border border-slate-700 bg-slate-950/50 p-1">
                <button
                  className={`rounded-md px-3 py-1 text-sm ${unit === "celsius" ? "bg-sky-500 text-slate-950" : "text-slate-300"}`}
                  onClick={() => setUnit("celsius")}
                  type="button"
                >
                  °C
                </button>
                <button
                  className={`rounded-md px-3 py-1 text-sm ${unit === "fahrenheit" ? "bg-sky-500 text-slate-950" : "text-slate-300"}`}
                  onClick={() => setUnit("fahrenheit")}
                  type="button"
                >
                  °F
                </button>
              </div>
            </div>
            <p className="mt-1 text-slate-300">
              <span className="mr-2 text-xl">{getWeatherEmoji(weather.current.weathercode)}</span>
              {getWeatherDescription(weather.current.weathercode)}
            </p>
            {forecastDetailDay ? (
              <p className="mt-3 rounded-lg border border-sky-500/35 bg-sky-950/45 px-3 py-2 text-sm text-sky-100/95">
                Hourly charts and the day summary below follow{" "}
                <span className="font-semibold text-slate-50">{formatDisplayDate(forecastDetailDay)}</span>. This panel still
                shows current conditions right now.
              </p>
            ) : null}

            <div className="mt-4 grid grid-cols-2 gap-4 sm:grid-cols-4">
              <div className="rounded-lg border border-slate-700 bg-slate-950/50 p-3">
                <p className="text-xs uppercase tracking-wide text-slate-400">Temp</p>
                <p className="mt-1 text-xl font-semibold">
                  {Math.round(weather.current.temperature_2m)}
                  {unitSymbol}
                </p>
              </div>
              <div className="rounded-lg border border-slate-700 bg-slate-950/50 p-3">
                <p className="text-xs uppercase tracking-wide text-slate-400">Feels Like</p>
                <p className="mt-1 text-xl font-semibold">
                  {Math.round(weather.current.apparent_temperature)}
                  {unitSymbol}
                </p>
              </div>
              <div className="rounded-lg border border-slate-700 bg-slate-950/50 p-3">
                <p className="text-xs uppercase tracking-wide text-slate-400">Humidity</p>
                <p className="mt-1 text-xl font-semibold">{weather.current.relative_humidity_2m}%</p>
              </div>
              <div className="rounded-lg border border-slate-700 bg-slate-950/50 p-3">
                <p className="text-xs uppercase tracking-wide text-slate-400">Wind</p>
                <p className="mt-1 text-xl font-semibold">
                  {Math.round(weather.current.windspeed_10m)} {windUnit}
                </p>
              </div>
            </div>

            <div className="mt-4 grid grid-cols-2 gap-4 sm:grid-cols-3 lg:grid-cols-5">
              <div className="rounded-lg border border-slate-700 bg-slate-950/40 p-3">
                <p className="text-xs uppercase tracking-wide text-slate-400">Pressure</p>
                <p className="mt-1 font-semibold">{Math.round(weather.current.surface_pressure ?? 0)} hPa</p>
              </div>
              <div className="rounded-lg border border-slate-700 bg-slate-950/40 p-3">
                <p className="text-xs uppercase tracking-wide text-slate-400">Visibility</p>
                <p className="mt-1 font-semibold">{Math.round((weather.current.visibility ?? 0) / 1000)} km</p>
              </div>
              <div className="rounded-lg border border-slate-700 bg-slate-950/40 p-3">
                <p className="text-xs uppercase tracking-wide text-slate-400">Cloud Cover</p>
                <p className="mt-1 font-semibold">{Math.round(weather.current.cloudcover ?? 0)}%</p>
              </div>
              <div className="rounded-lg border border-slate-700 bg-slate-950/40 p-3">
                <p className="text-xs uppercase tracking-wide text-slate-400">Dew Point</p>
                <p className="mt-1 font-semibold">
                  {Math.round(weather.current.dewpoint_2m ?? 0)}
                  {unitSymbol}
                </p>
              </div>
              <div className="rounded-lg border border-slate-700 bg-slate-950/40 p-3">
                <p className="text-xs uppercase tracking-wide text-slate-400">
                  UV (day max{dayAtAGlance?.dateLabel ? ` · ${formatDisplayDate(dayAtAGlance.dateLabel)}` : ""})
                </p>
                <p className="mt-1 font-semibold">{dayAtAGlance?.uvMax?.toFixed?.(1) ?? "N/A"}</p>
              </div>
            </div>
          </section>
        ) : null}

        {currentAqi ? (
          <section className="glass-panel animate-fade-in rounded-xl p-5">
            <h2 className="text-xl font-semibold">Air Quality & Pollen</h2>
            {forecastDetailDay ? (
              <p className="mt-2 text-xs text-slate-400">
                These readings reflect current conditions nearby, not the weather for {formatDisplayDate(forecastDetailDay)}.
              </p>
            ) : null}
            <div className="mt-3 grid grid-cols-2 gap-3 sm:grid-cols-4">
              <div className="rounded-lg border border-slate-700 bg-slate-950/40 p-3">
                <p className="text-xs text-slate-400">US AQI</p>
                <p className="mt-1 font-semibold">{Math.round(currentAqi.usAqi ?? 0)}</p>
              </div>
              <div className="rounded-lg border border-slate-700 bg-slate-950/40 p-3">
                <p className="text-xs text-slate-400">EU AQI</p>
                <p className="mt-1 font-semibold">{Math.round(currentAqi.euAqi ?? 0)}</p>
              </div>
              <div className="rounded-lg border border-slate-700 bg-slate-950/40 p-3">
                <p className="text-xs text-slate-400">PM2.5</p>
                <p className="mt-1 font-semibold">{(currentAqi.pm25 ?? 0).toFixed(1)} ug/m3</p>
              </div>
              <div className="rounded-lg border border-slate-700 bg-slate-950/40 p-3">
                <p className="text-xs text-slate-400">PM10</p>
                <p className="mt-1 font-semibold">{(currentAqi.pm10 ?? 0).toFixed(1)} ug/m3</p>
              </div>
              <div className="rounded-lg border border-slate-700 bg-slate-950/40 p-3">
                <p className="text-xs text-slate-400">Ozone</p>
                <p className="mt-1 font-semibold">{(currentAqi.ozone ?? 0).toFixed(0)} ug/m3</p>
              </div>
              <div className="rounded-lg border border-slate-700 bg-slate-950/40 p-3">
                <p className="text-xs text-slate-400">NO2</p>
                <p className="mt-1 font-semibold">{(currentAqi.no2 ?? 0).toFixed(0)} ug/m3</p>
              </div>
              <div className="rounded-lg border border-slate-700 bg-slate-950/40 p-3">
                <p className="text-xs text-slate-400">SO2</p>
                <p className="mt-1 font-semibold">{(currentAqi.so2 ?? 0).toFixed(0)} ug/m3</p>
              </div>
              <div className="rounded-lg border border-slate-700 bg-slate-950/40 p-3">
                <p className="text-xs text-slate-400">Pollen (Grass)</p>
                <p className="mt-1 font-semibold">{(currentAqi.pollen.grass ?? 0).toFixed(0)}</p>
              </div>
            </div>
          </section>
        ) : null}

        <section className="glass-panel animate-fade-in rounded-xl p-5">
          <h2 className="text-xl font-semibold">Weather Alerts</h2>
          {alerts.length > 0 ? (
            <div className="mt-3 space-y-2">
              {alerts.map((alertItem) => (
                <article key={alertItem.id} className="rounded-lg border border-amber-500/40 bg-amber-900/20 p-3">
                  <p className="font-semibold text-amber-100">{alertItem.properties?.event ?? "Weather Alert"}</p>
                  <p className="text-sm text-amber-200/90">{alertItem.properties?.headline ?? "No headline available."}</p>
                </article>
              ))}
            </div>
          ) : forecastAlerts.length > 0 ? (
            <div className="mt-3 space-y-2">
              {forecastAlerts.map((alertItem) => (
                <article key={alertItem.id} className="rounded-lg border border-amber-500/40 bg-amber-900/20 p-3">
                  <p className="font-semibold text-amber-100">{alertItem.event}</p>
                  <p className="text-sm text-amber-200/90">{alertItem.headline}</p>
                </article>
              ))}
            </div>
          ) : (
            <p className="mt-2 text-sm text-slate-300">
              {alertsUnavailable
                ? "Live alerts feed is unavailable for this region/source right now."
                : "No active weather alerts currently reported."}
            </p>
          )}
        </section>

        {forecastCards.length > 0 ? (
          <section className="glass-panel animate-fade-in rounded-xl border border-slate-700/50 p-5 sm:p-6">
            <div className="flex flex-col gap-3 border-b border-slate-700/60 pb-4 sm:flex-row sm:items-end sm:justify-between">
              <div>
                <h2 className="text-2xl font-semibold">{FORECAST_DAILY_DAYS_SHOWN}-day forecast</h2>
                <p className="mt-1 max-w-2xl text-sm text-slate-400">
                  Split into calendar weeks &mdash; <span className="text-slate-300">seven days per row</span> on desktop, swipe on
                  small screens. Weekends pick up a violet tint so you do not rely on scanning text.
                </p>
                <p className="mt-2 max-w-2xl text-xs text-slate-500">
                  Expand any day below to steer hourly charts beneath; collapse again to revert to rolling 24&nbsp;h anchored to your current clock hour.
                </p>
              </div>
              <div className="flex flex-wrap gap-2 text-[10px] text-slate-500">
                <span className="rounded-full border border-slate-600/70 bg-slate-950/50 px-2 py-1">Week 1 = first strip</span>
                <span className="rounded-full border border-indigo-500/30 bg-indigo-950/30 px-2 py-1 text-indigo-200/90">
                  Sat/Sun tinted
                </span>
              </div>
            </div>

            <div className="mt-6 flex flex-col gap-10">
              {forecastWeekGroups.map((weekDays, weekIndex) => {
                const weekKey = weekDays[0]?.date ?? `wk-${weekIndex}`;
                const rangeSubtitle = formatForecastWeekRange(
                  weekDays[0]?.date ?? "",
                  weekDays[weekDays.length - 1]?.date ?? weekDays[0]?.date ?? ""
                );
                return (
                  <div key={weekKey} className="space-y-3">
                    <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
                      <div className="flex flex-wrap items-baseline gap-2 sm:gap-3">
                        <span className="rounded-md border border-sky-500/40 bg-sky-950/35 px-2 py-1 text-[11px] font-bold uppercase tracking-wide text-sky-200">
                          Week {weekIndex + 1}
                        </span>
                        <h3 className="text-lg font-semibold text-slate-100">{rangeSubtitle}</h3>
                        <span className="text-xs text-slate-500">
                          Days {weekIndex * FORECAST_DAYS_PER_WEEK_ROW + 1}&ndash;
                          {weekIndex * FORECAST_DAYS_PER_WEEK_ROW + weekDays.length} of this outlook
                        </span>
                      </div>
                      <span className="hidden text-[11px] text-slate-500 lg:inline">One row mirrors a calendar week</span>
                    </div>

                    <div
                      aria-label={`Forecast week ${weekIndex + 1}, ${rangeSubtitle}`}
                      className="flex snap-x snap-proximity flex-row gap-3 overflow-x-auto pb-1 [scrollbar-width:thin] [-webkit-overflow-scrolling:touch] lg:grid lg:snap-none lg:grid-cols-7 lg:gap-3 lg:overflow-visible lg:pb-0"
                      role="group"
                    >
                      {weekDays.map((day) => (
                        <ForecastWeekDayCard
                          key={day.date}
                          anchorDateLabel={weather?.daily?.time?.[0]}
                          day={day}
                          expandedForecastDate={expandedForecastDate}
                          forecastDetailDay={forecastDetailDay}
                          onToggleDay={toggleForecastDay}
                          unitSymbol={unitSymbol}
                          windUnit={windUnit}
                        />
                      ))}
                    </div>
                  </div>
                );
              })}
            </div>
          </section>
        ) : null}

        {forecastDetailDay && weather?.hourly?.time?.length ? (
          <div className="rounded-lg border border-amber-500/35 bg-amber-950/20 px-3 py-2 text-center text-xs text-amber-100/90">
            Showing the full hourly day for {formatDisplayDate(forecastDetailDay)}. Tap that forecast card once more to collapse
            and return to rolling 24&nbsp;h anchored to your current clock hour.
          </div>
        ) : null}

        {feelsLikeTrend && hourlyChart && hourlyCards.length > 0 ? (
          <>
            <div className="animate-fade-in rounded-lg border border-slate-700 bg-slate-900/50 p-3">
              <p className="text-[11px] text-slate-500">Time window for the feels-like and hourly chart sections below.</p>
              <div className="mt-2 flex flex-wrap gap-2" role="group" aria-label="Hourly coverage scope">
                <button
                  type="button"
                  aria-pressed={hourlyCoverageMode === "sliding"}
                  className={`rounded-full border px-3 py-1.5 text-xs font-semibold transition ${
                    hourlyCoverageMode === "sliding"
                      ? "border-sky-500/65 bg-sky-950/50 text-sky-100 shadow-sm shadow-sky-900/40"
                      : "border-slate-600 bg-slate-950/35 text-slate-400 hover:border-slate-500 hover:text-slate-200"
                  }`}
                  onClick={() => setHourlyCoverageMode("sliding")}
                >
                  12-hour window
                </button>
                <button
                  type="button"
                  aria-pressed={hourlyCoverageMode === "fullday"}
                  className={`rounded-full border px-3 py-1.5 text-xs font-semibold transition ${
                    hourlyCoverageMode === "fullday"
                      ? "border-violet-500/65 bg-violet-950/40 text-violet-100 shadow-sm shadow-violet-950/40"
                      : "border-slate-600 bg-slate-950/35 text-slate-400 hover:border-slate-500 hover:text-slate-200"
                  }`}
                  onClick={() => setHourlyCoverageMode("fullday")}
                >
                  Full day (24 h)
                </button>
              </div>
              {hourlyCoverageMode === "sliding" && showHourlyWindowSlider ? (
                <>
                  <p className="mt-3 text-[11px] text-slate-500">
                    The 12-hour window defaults to beginning at your current clock hour, floored on the hourly grid so it never
                    jumps ahead to the next forecast slot.
                  </p>
                  <div className="mt-2 flex items-center justify-between text-xs text-slate-300">
                    <span>Window start: {formatHourLabel(visibleHourlyCards[0]?.time ?? hourlyCards[0]?.time)}</span>
                    <span>
                      Showing {hourlyVisibleWindowSize} of {hourlyCards.length} hrs
                    </span>
                  </div>
                  <input
                    className="app-range mt-2 w-full"
                    max={Math.max(0, hourlyCards.length - hourlyVisibleWindowSize)}
                    min={0}
                    onChange={(event) => setHourlyWindowStart(Number(event.target.value))}
                    step={1}
                    type="range"
                    value={hourlyWindowStart}
                  />
                </>
              ) : null}
              {hourlyCoverageMode === "sliding" && !showHourlyWindowSlider ? (
                <p className="mt-3 text-xs text-slate-400">
                  Showing all {hourlyCards.length} hours in this stream (starting from the beginning of your current clock hour).
                  Lavender dashed line and dot track the precise time-of-day inside the chart.
                </p>
              ) : null}
              {hourlyCoverageMode === "fullday" ? (
                <p className="mt-3 text-xs text-slate-400">
                  Midnight → midnight for{" "}
                  {forecastDetailDay
                    ? formatDisplayDate(forecastDetailDay)
                    : weather?.daily?.time?.[0]
                      ? formatDisplayDate(weather.daily.time[0])
                      : "this day"}
                  . A lavender vertical line and circle mark exactly where “now” falls along that calendar day whenever it is visible
                  in this window.
                </p>
              ) : null}
            </div>

            <section className="glass-panel animate-fade-in mt-4 rounded-xl p-5">
              <h2 className="text-xl font-semibold">
                {forecastDetailDay
                  ? `${formatDisplayDate(forecastDetailDay)} — feels like vs actual`
                  : hourlyCoverageMode === "fullday" && weather?.daily?.time?.[0]
                    ? `Feels like vs actual (${formatDisplayDate(weather.daily.time[0])}, midnight → midnight)`
                    : "Feels like vs actual (rolling from current clock hour)"}
              </h2>
              <p className="mt-1 text-xs text-slate-500">
                Min / average / max reflect the visible hours; only the chart area scrolls sideways.
              </p>
              <div className="mt-3 grid grid-cols-1 gap-2 text-sm sm:grid-cols-3 sm:gap-3">
              <div className="rounded-lg border border-slate-700 bg-slate-950/40 p-3">
                <p className="text-slate-400">Min Feels Like</p>
                <p className="font-semibold text-base tabular-nums tracking-tight sm:text-base">
                  {Math.round(feelsLikeTrend.min)}
                  {unitSymbol}
                </p>
              </div>
              <div className="rounded-lg border border-slate-700 bg-slate-950/40 p-3">
                <p className="text-slate-400">
                  <span className="sm:hidden">Avg Feels Like</span>
                  <span className="hidden sm:inline">Average Feels Like</span>
                </p>
                <p className="font-semibold text-base tabular-nums tracking-tight sm:text-base">
                  {Math.round(feelsLikeTrend.avg)}
                  {unitSymbol}
                </p>
              </div>
              <div className="rounded-lg border border-slate-700 bg-slate-950/40 p-3">
                <p className="text-slate-400">Max Feels Like</p>
                <p className="font-semibold text-base tabular-nums tracking-tight sm:text-base">
                  {Math.round(feelsLikeTrend.max)}
                  {unitSymbol}
                </p>
              </div>
              </div>
              <div className="chart-scrollbar mt-3 overflow-x-auto pb-1 [-webkit-overflow-scrolling:touch]">
              <div className="glass-subpanel inline-block rounded-xl p-3">
                <div className="relative" style={{ width: feelsLikeTrend.width }}>
              <svg
                className="block w-full shrink-0"
                height={feelsLikeTrend.height}
                viewBox={`0 0 ${feelsLikeTrend.width} ${feelsLikeTrend.height}`}
                preserveAspectRatio="xMidYMid meet"
              >
                {feelsLikeTrend.yTicks.map((tick, index) => (
                  <g key={`feels-temp-tick-${index}`}>
                    <line
                      x1={feelsLikeTrend.padding - 6}
                      y1={tick.y}
                      x2={feelsLikeTrend.width - feelsLikeTrend.padding}
                      y2={tick.y}
                      stroke="rgba(71,85,105,0.35)"
                      strokeDasharray="3 4"
                    />
                    <text
                      x={feelsLikeTrend.padding - 10}
                      y={tick.y + Math.round(CHART_AXIS_FONT_PX * 0.35)}
                      fill={CHART_AXIS_FILL}
                      fontSize={CHART_AXIS_FONT_PX}
                      textAnchor="end"
                    >
                      {Math.round(tick.value)}
                      {unitSymbol}
                    </text>
                  </g>
                ))}
                <line
                  x1={feelsLikeTrend.padding}
                  y1={feelsLikeTrend.height - feelsLikeTrend.padding}
                  x2={feelsLikeTrend.width - feelsLikeTrend.padding}
                  y2={feelsLikeTrend.height - feelsLikeTrend.padding}
                  stroke="#334155"
                />
                <line
                  x1={feelsLikeTrend.padding}
                  y1={feelsLikeTrend.padding}
                  x2={feelsLikeTrend.padding}
                  y2={feelsLikeTrend.height - feelsLikeTrend.padding}
                  stroke="#334155"
                />
                {visibleHourlyCards.map((hour, index) => {
                  const x = feelsLikeTrend.padding + index * feelsLikeTrend.stepX;
                  return (
                    <line
                      key={`feels-grid-${hour.time}`}
                      x1={x}
                      y1={feelsLikeTrend.padding}
                      x2={x}
                      y2={feelsLikeTrend.height - feelsLikeTrend.padding}
                      stroke="rgba(148,163,184,0.18)"
                    />
                  );
                })}
                <polygon points={feelsLikeTrend.areaPoints} fill="rgba(245, 158, 11, 0.2)" />
                <polyline
                  fill="none"
                  points={feelsLikeTrend.actualPoints}
                  stroke="#38bdf8"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  strokeWidth={hoverFeelsSeries === "actual" ? 3.5 : 2}
                />
                <polyline
                  fill="none"
                  points={feelsLikeTrend.feelsPoints}
                  stroke="#f59e0b"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  strokeWidth={hoverFeelsSeries === "feels" ? 4.5 : 3}
                />
                <rect
                  style={{ touchAction: "none" }}
                  x={feelsLikeTrend.padding}
                  y={feelsLikeTrend.padding}
                  width={feelsLikeTrend.width - feelsLikeTrend.padding * 2}
                  height={feelsLikeTrend.height - feelsLikeTrend.padding * 2}
                  fill="transparent"
                  onMouseLeave={() => {
                    setHoverFeelsIndex(null);
                    setHoverFeelsScreenPos(null);
                    setHoverFeelsSeries(null);
                  }}
                  onMouseMove={(event) =>
                    chartPointerUpdateFeels(event.clientX, event.clientY, event.currentTarget)
                  }
                  onTouchCancel={() => {
                    setHoverFeelsIndex(null);
                    setHoverFeelsScreenPos(null);
                    setHoverFeelsSeries(null);
                  }}
                  onTouchMove={(event) => {
                    event.preventDefault();
                    const t = event.touches[0];
                    if (!t) return;
                    chartPointerUpdateFeels(t.clientX, t.clientY, event.currentTarget);
                  }}
                  onTouchStart={(event) => {
                    const t = event.touches[0];
                    if (!t) return;
                    chartPointerUpdateFeels(t.clientX, t.clientY, event.currentTarget);
                  }}
                />
                {hoverFeelsIndex !== null ? (
                  <line
                    x1={feelsLikeTrend.padding + hoverFeelsIndex * feelsLikeTrend.stepX}
                    y1={feelsLikeTrend.padding}
                    x2={feelsLikeTrend.padding + hoverFeelsIndex * feelsLikeTrend.stepX}
                    y2={feelsLikeTrend.height - feelsLikeTrend.padding}
                    stroke="#cbd5e1"
                    strokeDasharray="4 3"
                  />
                ) : null}
                {hoverFeelsIndex !== null &&
                feelsLikeTrend.feelsCoords[hoverFeelsIndex] &&
                feelsLikeTrend.actualCoords[hoverFeelsIndex] ? (
                  <g pointerEvents="none">
                    <circle
                      cx={feelsLikeTrend.actualCoords[hoverFeelsIndex].x}
                      cy={feelsLikeTrend.actualCoords[hoverFeelsIndex].y}
                      fill="#38bdf8"
                      r={hoverFeelsSeries === "actual" ? 6.5 : hoverFeelsSeries ? 3.5 : 4.25}
                      stroke="rgba(15, 23, 42, 0.88)"
                      strokeWidth="1.5"
                    />
                    <circle
                      cx={feelsLikeTrend.feelsCoords[hoverFeelsIndex].x}
                      cy={feelsLikeTrend.feelsCoords[hoverFeelsIndex].y}
                      fill="#f59e0b"
                      r={hoverFeelsSeries === "feels" ? 6.5 : hoverFeelsSeries ? 3.5 : 4.25}
                      stroke="rgba(15, 23, 42, 0.88)"
                      strokeWidth="1.5"
                    />
                  </g>
                ) : null}
                {chartNowMarkerSvgX !== null ? (
                  <g pointerEvents="none" aria-hidden="true">
                    <title>Current time</title>
                    <line
                      x1={chartNowMarkerSvgX}
                      x2={chartNowMarkerSvgX}
                      y1={feelsLikeTrend.padding}
                      y2={feelsLikeTrend.height - feelsLikeTrend.padding}
                      stroke={CHART_NOW_STROKE}
                      strokeDasharray="5 8"
                      strokeWidth={1.25}
                      opacity={0.92}
                    />
                    <circle
                      cx={chartNowMarkerSvgX}
                      cy={feelsLikeTrend.height - feelsLikeTrend.padding}
                      fill={CHART_NOW_DOT}
                      r={4}
                      stroke="rgba(15, 23, 42, 0.65)"
                      strokeWidth={1}
                    />
                  </g>
                ) : null}
                <g pointerEvents="none" aria-hidden="true">
                  {visibleHourlyCards.map((hour, index) => {
                    const x = feelsLikeTrend.padding + index * feelsLikeTrend.stepX;
                    const y = feelsLikeTrend.height - feelsLikeTrend.padding / 2;
                    return (
                      <text
                        key={`feels-x-hour-${hour.time}`}
                        dominantBaseline="middle"
                        fill={CHART_AXIS_FILL}
                        fontSize={CHART_X_AXIS_FONT_PX}
                        textAnchor="middle"
                        x={x}
                        y={y}
                      >
                        {formatChartAxisHour(hour.time)}
                      </text>
                    );
                  })}
                </g>
              </svg>
              {hoveredFeelsHour && hoverFeelsScreenPos ? (
                <div
                  className="chart-tooltip pointer-events-none absolute z-10 min-w-[10.5rem] max-w-[15rem] rounded-md px-2.5 py-2 text-sm leading-snug lg:text-[11px]"
                  style={{ left: hoverFeelsScreenPos.x, top: hoverFeelsScreenPos.y }}
                >
                  <p className="border-b border-slate-500/40 pb-1 font-semibold">
                    {formatHourLabel(hoveredFeelsHour.time)} {getWeatherEmoji(hoveredFeelsHour.weatherCode)}
                  </p>
                  <div className="mt-1.5 space-y-1">
                    <p className={hoverFeelsSeries === "feels" ? "font-semibold" : "opacity-[0.88]"}>
                      <span className="text-amber-400">Feels like</span>{" "}
                      <span>
                        {Math.round(hoveredFeelsHour.apparentTemp ?? hoveredFeelsHour.temp)}
                        {unitSymbol}
                      </span>
                    </p>
                    <p className={hoverFeelsSeries === "actual" ? "font-semibold" : "opacity-[0.88]"}>
                      <span className="text-sky-400">Actual temp</span>{" "}
                      <span>
                        {Math.round(hoveredFeelsHour.temp)}
                        {unitSymbol}
                      </span>
                    </p>
                    <p className="opacity-[0.88]">
                      <span className="text-emerald-400">Wind</span>{" "}
                      <span>
                        {Math.round(hoveredFeelsHour.windspeed ?? 0)} {windUnit}
                      </span>
                    </p>
                    <p className="opacity-[0.88]">
                      <span className="text-sky-400">Precip</span>{" "}
                      <span>
                        {(hoveredFeelsHour.precipitation ?? 0).toFixed(1)} mm · {hoveredFeelsHour.precipitationProbability ?? 0}%
                      </span>
                    </p>
                  </div>
                </div>
              ) : null}
                </div>
              </div>
              </div>
              <p className="mt-2 text-xs text-slate-400">Orange = feels like, Blue = actual temperature</p>
              <p className="mt-2 text-xs text-slate-500 lg:hidden">
                Scroll sideways for the full chart, then drag along it to inspect each hour.
              </p>
            </section>

            <section className="glass-panel animate-fade-in mt-4 rounded-xl p-5">
              <h2 className="text-xl font-semibold">
                {forecastDetailDay
                  ? `${formatDisplayDate(forecastDetailDay)} — hourly charts`
                  : hourlyCoverageMode === "fullday" && weather?.daily?.time?.[0]
                    ? `Hourly — full day (${formatDisplayDate(weather.daily.time[0])})`
                    : "Hourly charts (rolling from current clock hour)"}
              </h2>
              <p className="mt-1 text-xs text-slate-500">
                High / low use the visible window; only the plot below scrolls horizontally.
              </p>
                <div className="mt-3 flex flex-wrap gap-3 text-sm">
                  <span className="rounded-full border border-rose-400/40 bg-rose-900/20 px-3 py-1 text-rose-200">
                    Temperature
                  </span>
                  <span className="rounded-full border border-emerald-400/40 bg-emerald-900/20 px-3 py-1 text-emerald-200">
                    Wind
                  </span>
                  <span className="rounded-full border border-sky-400/40 bg-sky-900/20 px-3 py-1 text-sky-200">
                    Precipitation
                  </span>
                </div>
                      <div className="mt-3 grid grid-cols-1 gap-2 sm:grid-cols-2">
                        <div className="rounded-lg border border-rose-500/40 bg-rose-900/20 p-2 text-sm text-rose-100">
                          <p className="text-xs uppercase tracking-wide text-rose-200">High</p>
                          <p className="font-semibold text-[1.05rem] tabular-nums leading-snug sm:text-base">
                            {Math.round(hourlyChart.tempMax)}
                            {unitSymbol} at{" "}
                            {hourlyChart.tempMaxTime ? formatHourLabel(hourlyChart.tempMaxTime) : "--"}
                          </p>
                        </div>
                        <div className="rounded-lg border border-cyan-500/40 bg-cyan-900/20 p-2 text-sm text-cyan-100">
                          <p className="text-xs uppercase tracking-wide text-cyan-200">Low</p>
                          <p className="font-semibold text-[1.05rem] tabular-nums leading-snug sm:text-base">
                            {Math.round(hourlyChart.tempMin)}
                            {unitSymbol} at{" "}
                            {hourlyChart.tempMinTime ? formatHourLabel(hourlyChart.tempMinTime) : "--"}
                          </p>
                        </div>
                      </div>
                <div className="chart-scrollbar mt-3 overflow-x-auto pb-1 [-webkit-overflow-scrolling:touch]">
                  <div className="glass-subpanel inline-block rounded-xl p-3">
                      <div className="relative" style={{ width: hourlyChart.width }}>
                        <svg
                          className="w-full"
                          height={hourlyChart.height}
                          viewBox={`0 0 ${hourlyChart.width} ${hourlyChart.height}`}
                        >
                          {hourlyChart.yTicks.map((tick, index) => (
                            <g key={`hour-temp-tick-${index}`}>
                              <line
                                x1={hourlyChart.padding - 6}
                                y1={tick.y}
                                x2={hourlyChart.width - hourlyChart.padding}
                                y2={tick.y}
                                stroke="rgba(71,85,105,0.35)"
                                strokeDasharray="3 4"
                              />
                              <text
                                x={hourlyChart.padding - 10}
                                y={tick.y + Math.round(CHART_AXIS_FONT_PX * 0.35)}
                                fill={CHART_AXIS_FILL}
                                fontSize={CHART_AXIS_FONT_PX}
                                textAnchor="end"
                              >
                                {Math.round(tick.value)}
                                {unitSymbol}
                              </text>
                            </g>
                          ))}
                          {visibleHourlyCards.map((hour, index) => {
                            const x = hourlyChart.padding + index * hourlyChart.stepX;
                            return (
                              <line
                                key={`hour-grid-${hour.time}`}
                                x1={x}
                                y1={hourlyChart.padding}
                                x2={x}
                                y2={hourlyChart.height - hourlyChart.padding}
                                stroke="rgba(148,163,184,0.18)"
                              />
                            );
                          })}
                          <line
                            x1={hourlyChart.padding}
                            y1={hourlyChart.height - hourlyChart.padding}
                            x2={hourlyChart.width - hourlyChart.padding}
                            y2={hourlyChart.height - hourlyChart.padding}
                            stroke="#334155"
                          />
                          <line
                            x1={hourlyChart.padding}
                            y1={hourlyChart.padding}
                            x2={hourlyChart.padding}
                            y2={hourlyChart.height - hourlyChart.padding}
                            stroke="#334155"
                          />
                          <polyline
                            fill="none"
                            points={hourlyChart.tempPoints}
                            stroke="#ef4444"
                            strokeLinecap="round"
                            strokeLinejoin="round"
                            strokeWidth={hoverHourlySeries === "temp" ? 5 : 3}
                          />
                          <polyline
                            fill="none"
                            points={hourlyChart.windPoints}
                            stroke="#22c55e"
                            strokeLinecap="round"
                            strokeLinejoin="round"
                            strokeWidth={hoverHourlySeries === "wind" ? 5 : 3}
                          />
                          <polyline
                            fill="none"
                            points={hourlyChart.precipPoints}
                            stroke="#38bdf8"
                            strokeLinecap="round"
                            strokeLinejoin="round"
                            strokeWidth={hoverHourlySeries === "precip" ? 5 : 3}
                          />
                          {(() => {
                            const usableHeight = hourlyChart.height - hourlyChart.padding * 2;
                            const maxRatio =
                              (hourlyChart.tempMax - hourlyChart.tempDomain.min) /
                              (hourlyChart.tempDomain.max - hourlyChart.tempDomain.min);
                            const minRatio =
                              (hourlyChart.tempMin - hourlyChart.tempDomain.min) /
                              (hourlyChart.tempDomain.max - hourlyChart.tempDomain.min);

                            const maxX = hourlyChart.padding + hourlyChart.tempMaxIndex * hourlyChart.stepX;
                            const minX = hourlyChart.padding + hourlyChart.tempMinIndex * hourlyChart.stepX;
                            const maxY = hourlyChart.height - hourlyChart.padding - maxRatio * usableHeight;
                            const minY = hourlyChart.height - hourlyChart.padding - minRatio * usableHeight;

                            return (
                              <>
                                <circle cx={maxX} cy={maxY} r="5" fill="#ef4444" />
                                <circle cx={minX} cy={minY} r="5" fill="#ef4444" />
                              </>
                            );
                          })()}
                          <rect
                            style={{ touchAction: "none" }}
                            x={hourlyChart.padding}
                            y={hourlyChart.padding}
                            width={hourlyChart.width - hourlyChart.padding * 2}
                            height={hourlyChart.height - hourlyChart.padding}
                            fill="transparent"
                            onMouseLeave={() => {
                              setHoverHourlyIndex(null);
                              setHoverScreenPos(null);
                              setHoverHourlySeries(null);
                            }}
                            onMouseMove={(event) =>
                              chartPointerUpdateHourly(event.clientX, event.clientY, event.currentTarget)
                            }
                            onTouchCancel={() => {
                              setHoverHourlyIndex(null);
                              setHoverScreenPos(null);
                              setHoverHourlySeries(null);
                            }}
                            onTouchMove={(event) => {
                              event.preventDefault();
                              const t = event.touches[0];
                              if (!t) return;
                              chartPointerUpdateHourly(t.clientX, t.clientY, event.currentTarget);
                            }}
                            onTouchStart={(event) => {
                              const t = event.touches[0];
                              if (!t) return;
                              chartPointerUpdateHourly(t.clientX, t.clientY, event.currentTarget);
                            }}
                          />
                          {hoveredHour && hoverHourlyIndex !== null ? (
                            <g>
                              <line
                                x1={hourlyChart.padding + hoverHourlyIndex * hourlyChart.stepX}
                                y1={hourlyChart.padding}
                                x2={hourlyChart.padding + hoverHourlyIndex * hourlyChart.stepX}
                                y2={hourlyChart.height - hourlyChart.padding}
                                stroke="#94a3b8"
                                strokeDasharray="4 3"
                              />
                            </g>
                          ) : null}
                          {hoverHourlyIndex !== null &&
                          hourlyChart.tempCoords[hoverHourlyIndex] &&
                          hourlyChart.windCoords[hoverHourlyIndex] &&
                          hourlyChart.precipCoords[hoverHourlyIndex] ? (
                            <g pointerEvents="none">
                              {[
                                { key: "temp", fill: "#ef4444", coord: hourlyChart.tempCoords[hoverHourlyIndex] },
                                { key: "wind", fill: "#22c55e", coord: hourlyChart.windCoords[hoverHourlyIndex] },
                                { key: "precip", fill: "#38bdf8", coord: hourlyChart.precipCoords[hoverHourlyIndex] },
                              ].map((item) => (
                                <circle
                                  key={`hourly-hover-${item.key}`}
                                  cx={item.coord.x}
                                  cy={item.coord.y}
                                  fill={item.fill}
                                  r={hoverHourlySeries === item.key ? 6.5 : hoverHourlySeries ? 3.5 : 4.25}
                                  stroke="rgba(15, 23, 42, 0.88)"
                                  strokeWidth="1.5"
                                />
                              ))}
                            </g>
                          ) : null}
                          {chartNowMarkerSvgX !== null ? (
                            <g pointerEvents="none" aria-hidden="true">
                              <title>Current time</title>
                              <line
                                x1={chartNowMarkerSvgX}
                                x2={chartNowMarkerSvgX}
                                y1={hourlyChart.padding}
                                y2={hourlyChart.height - hourlyChart.padding}
                                opacity={0.92}
                                stroke={CHART_NOW_STROKE}
                                strokeDasharray="5 8"
                                strokeWidth={1.25}
                              />
                              <circle
                                cx={chartNowMarkerSvgX}
                                cy={hourlyChart.height - hourlyChart.padding}
                                fill={CHART_NOW_DOT}
                                r={4}
                                stroke="rgba(15, 23, 42, 0.65)"
                                strokeWidth={1}
                              />
                            </g>
                          ) : null}
                          <g pointerEvents="none" aria-hidden="true">
                            {visibleHourlyCards.map((hour, index) => {
                              const x = hourlyChart.padding + index * hourlyChart.stepX;
                              const y = hourlyChart.height - hourlyChart.padding / 2;
                              return (
                                <text
                                  key={`hourly-x-hour-${hour.time}`}
                                  dominantBaseline="middle"
                                  fill={CHART_AXIS_FILL}
                                  fontSize={CHART_X_AXIS_FONT_PX}
                                  textAnchor="middle"
                                  x={x}
                                  y={y}
                                >
                                  {formatChartAxisHour(hour.time)}
                                </text>
                              );
                            })}
                          </g>
                        </svg>
                        {hoveredHour && hoverScreenPos ? (
                          <div
                            className="chart-tooltip pointer-events-none absolute z-10 min-w-[10.5rem] max-w-[15rem] rounded-md px-2.5 py-2 text-sm leading-snug lg:text-[11px]"
                            style={{ left: hoverScreenPos.x, top: hoverScreenPos.y }}
                          >
                            <p className="border-b border-slate-500/40 pb-1 font-semibold">
                              {formatHourLabel(hoveredHour.time)} {getWeatherEmoji(hoveredHour.weatherCode)}
                            </p>
                            <div className="mt-1.5 space-y-1">
                              <p className={hoverHourlySeries === "temp" ? "font-semibold" : "opacity-[0.88]"}>
                                <span className="text-rose-400">Temp</span>{" "}
                                <span>
                                  {Math.round(hoveredHour.temp)}
                                  {unitSymbol}
                                </span>
                              </p>
                              <p className={hoverHourlySeries === "wind" ? "font-semibold" : "opacity-[0.88]"}>
                                <span className="text-emerald-400">Wind</span>{" "}
                                <span>
                                  {Math.round(hoveredHour.windspeed ?? 0)} {windUnit}
                                </span>
                              </p>
                              <p className={hoverHourlySeries === "precip" ? "font-semibold" : "opacity-[0.88]"}>
                                <span className="text-sky-400">Precip</span>{" "}
                                <span>
                                  {(hoveredHour.precipitation ?? 0).toFixed(1)} mm ·{" "}
                                  {hoveredHour.precipitationProbability ?? 0}%
                                </span>
                              </p>
                              <p className="border-t border-slate-500/30 pt-1 text-xs opacity-80 lg:text-[10px]">
                                Feels {Math.round(hoveredHour.apparentTemp ?? hoveredHour.temp)}
                                {unitSymbol}
                              </p>
                            </div>
                          </div>
                        ) : null}
                      </div>
                </div>
                </div>
                      <div
                        aria-live={hoveredHour ? "polite" : undefined}
                        className="hourly-hover-bar"
                        data-open={hoveredHour !== null}
                      >
                        <div className="hourly-hover-bar__inner">
                          {hourlyHoverBarDisplayHour ? (
                            <div className="hourly-hover-bar__content rounded-lg border border-slate-700 bg-slate-950/50 p-3 text-base text-slate-200 lg:text-sm">
                              <p className="font-semibold">
                                {formatHourLabel(hourlyHoverBarDisplayHour.time)}{" "}
                                {getWeatherEmoji(hourlyHoverBarDisplayHour.weatherCode)}
                              </p>
                              <p>
                                Temp: {Math.round(hourlyHoverBarDisplayHour.temp)}
                                {unitSymbol} | Feels like:{" "}
                                {Math.round(
                                  hourlyHoverBarDisplayHour.apparentTemp ?? hourlyHoverBarDisplayHour.temp
                                )}
                                {unitSymbol}
                              </p>
                              <p>
                                Wind: {Math.round(hourlyHoverBarDisplayHour.windspeed ?? 0)} {windUnit} | Precip:{" "}
                                {(hourlyHoverBarDisplayHour.precipitation ?? 0).toFixed(1)} mm (
                                {hourlyHoverBarDisplayHour.precipitationProbability ?? 0}%)
                              </p>
                            </div>
                          ) : null}
                        </div>
                      </div>
                      <p className="mt-2 text-xs text-slate-500 lg:hidden">
                        Drag on the chart for an hour; details show below and in the tooltip.
                      </p>
                      <div className="mt-2">
                        <button
                          aria-controls="hourly-more-info"
                          aria-expanded={showHourlyDetails}
                          className="rounded-md border border-slate-600 bg-slate-900/70 px-3 py-1.5 text-xs font-semibold text-slate-100 transition hover:border-sky-400"
                          onClick={() => setShowHourlyDetails((prev) => !prev)}
                          type="button"
                        >
                          {showHourlyDetails ? "Hide more info" : "More info"}
                        </button>
                      </div>
                      <div
                        aria-hidden={!showHourlyDetails}
                        className="hourly-more-info-panel"
                        data-open={showHourlyDetails}
                        id="hourly-more-info"
                      >
                        <div className="hourly-more-info-panel__inner">
                          <div className="hourly-more-info-panel__content mt-2 grid grid-cols-2 gap-2 text-xs text-slate-300 sm:grid-cols-4 lg:grid-cols-6">
                            {visibleHourlyCards.map((hour) => (
                              <div key={hour.time} className="rounded-lg border border-slate-800 bg-slate-950/40 p-2">
                                <p className="font-semibold text-slate-200">{formatHourLabel(hour.time)}</p>
                                <p>
                                  Temp: {Math.round(hour.temp)}
                                  {unitSymbol}
                                </p>
                                <p>
                                  Wind: {Math.round(hour.windspeed ?? 0)} {windUnit}
                                </p>
                                <p>Precip: {(hour.precipitation ?? 0).toFixed(1)} mm</p>
                                <p>Chance: {hour.precipitationProbability ?? 0}%</p>
                              </div>
                            ))}
                          </div>
                        </div>
                      </div>
          </section>
          </>
        ) : null}

        {dayAtAGlance ? (
          <section className="glass-panel animate-fade-in rounded-xl p-5">
            <h2 className="text-xl font-semibold">
              {forecastDetailDay ? `${formatDisplayDate(forecastDetailDay)} at a glance` : "Today at a glance"}
            </h2>
            {!forecastDetailDay ? (
              <p className="mt-1 text-xs text-slate-400">
                Matches the rolling 24&nbsp;h hourly strip anchored to your current clock hour.{" "}
                <span className="text-slate-500">Tip:</span> expand a forecast day above to pivot charts to that date.
              </p>
            ) : (
              <p className="mt-1 text-xs text-slate-400">Daily rollup for this date (same summary as forecast cards).</p>
            )}
            <div className="mt-3 grid grid-cols-2 gap-3 sm:grid-cols-4">
              <div className="rounded-lg border border-slate-700 bg-slate-950/40 p-3">
                <p className="text-xs text-slate-400">High / Low</p>
                <p className="mt-1 font-semibold">
                  {Math.round(dayAtAGlance.tempMax ?? 0)}
                  {unitSymbol} / {Math.round(dayAtAGlance.tempMin ?? 0)}
                  {unitSymbol}
                </p>
              </div>
              <div className="rounded-lg border border-slate-700 bg-slate-950/40 p-3">
                <p className="text-xs text-slate-400">Precip Chance</p>
                <p className="mt-1 font-semibold">{Math.round(dayAtAGlance.precipitationProbabilityMax ?? 0)}%</p>
              </div>
              <div className="rounded-lg border border-slate-700 bg-slate-950/40 p-3">
                <p className="text-xs text-slate-400">Precip Total</p>
                <p className="mt-1 font-semibold">{(dayAtAGlance.precipitationSum ?? 0).toFixed(1)} mm</p>
              </div>
              <div className="rounded-lg border border-slate-700 bg-slate-950/40 p-3">
                <p className="text-xs text-slate-400">Max Wind</p>
                <p className="mt-1 font-semibold">
                  {Math.round(dayAtAGlance.windMax ?? 0)} {windUnit}
                </p>
              </div>
              <div className="rounded-lg border border-slate-700 bg-slate-950/40 p-3">
                <p className="text-xs text-slate-400">Sunrise</p>
                <p className="mt-1 font-semibold">{dayAtAGlance.sunrise ? formatTimeLabel(dayAtAGlance.sunrise) : "N/A"}</p>
              </div>
              <div className="rounded-lg border border-slate-700 bg-slate-950/40 p-3">
                <p className="text-xs text-slate-400">Sunset</p>
                <p className="mt-1 font-semibold">{dayAtAGlance.sunset ? formatTimeLabel(dayAtAGlance.sunset) : "N/A"}</p>
              </div>
            </div>
          </section>
        ) : null}

        {dayRundownText ? (
          <section
            aria-label="Day rundown"
            className="glass-panel animate-fade-in rounded-xl border border-slate-600/50 p-4"
            role="region"
          >
            <h3 className="text-xs font-semibold uppercase tracking-wide text-slate-400">Day rundown</h3>
            <p className="mt-2 text-sm leading-relaxed text-slate-200">{dayRundownText}</p>
            <p className="mt-2 text-[11px] text-slate-500">
              {forecastDetailDay
                ? `Based on the hourly model for ${formatDisplayDate(forecastDetailDay)} plus the daily summary for that date.`
                : "Based on your next 24 forecast hours plus today’s daily summary."}
            </p>
          </section>
        ) : null}

        {activeCoordinates ? (
          <section className="animate-fade-in space-y-3">
            <h2 className="text-2xl font-semibold">Weather Map</h2>
            <div className="overflow-hidden rounded-xl border border-sky-700/40 bg-slate-900/50">
              <iframe
                className="h-[430px] w-full"
                loading="lazy"
                src={mapUrl}
                title="Weather map"
              />
            </div>
          </section>
        ) : null}
        </div>
      </div>
      {toast ? (
        <div className={`toast toast-${toast.kind}`}>
          {toast.message}
        </div>
      ) : null}
    </main>
  );
}
