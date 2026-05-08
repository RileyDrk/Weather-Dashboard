import { useEffect, useMemo, useRef, useState } from "react";

const MAX_RECENT_SEARCHES = 6;
const RECENT_SEARCHES_KEY = "weather-dashboard-recent-searches";
const AUTOCOMPLETE_LIMIT = 8;

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

function getTempMoodEmoji(temp, unit) {
  const celsiusTemp = unit === "fahrenheit" ? (temp - 32) * (5 / 9) : temp;
  if (celsiusTemp >= 28) return "🥵";
  if (celsiusTemp <= 0) return "🥶";
  return "😌";
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

function formatHourLabel(timestamp) {
  return new Intl.DateTimeFormat("en-US", {
    hour: "numeric",
    minute: "2-digit",
  }).format(new Date(timestamp));
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

function pickNearestCity(results, targetLatitude, targetLongitude) {
  if (!Array.isArray(results) || results.length === 0) return null;
  const cityCodes = new Set(["PPL", "PPLA", "PPLA2", "PPLA3", "PPLA4", "PPLC"]);

  const enriched = results
    .filter((item) => Number.isFinite(item?.latitude) && Number.isFinite(item?.longitude))
    .map((item) => ({
      item,
      distanceScore: getDistanceScore(targetLatitude, targetLongitude, item.latitude, item.longitude),
      population: item.population ?? 0,
      isCityCode: cityCodes.has(item.feature_code),
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
  const [isLocating, setIsLocating] = useState(false);
  const [toast, setToast] = useState(null);
  const [aqiData, setAqiData] = useState(null);
  const [alerts, setAlerts] = useState([]);
  const [alertsUnavailable, setAlertsUnavailable] = useState(false);
  const [hoverHourlyIndex, setHoverHourlyIndex] = useState(null);
  const [hoverScreenPos, setHoverScreenPos] = useState(null);
  const [hoverFeelsIndex, setHoverFeelsIndex] = useState(null);
  const [hoverFeelsScreenPos, setHoverFeelsScreenPos] = useState(null);
  const [hourlyWindowStart, setHourlyWindowStart] = useState(0);
  const hourlyWindowSize = 12;
  const [showHourlyDetails, setShowHourlyDetails] = useState(false);
  const latestRequestRef = useRef(0);
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
    return weather.daily.time.slice(0, 5).map((date, index) => ({
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

  const todayOverview = useMemo(() => {
    if (!weather?.daily?.time?.length) return null;
    return {
      tempMax: weather.daily.temperature_2m_max?.[0] ?? null,
      tempMin: weather.daily.temperature_2m_min?.[0] ?? null,
      precipitationSum: weather.daily.precipitation_sum?.[0] ?? null,
      precipitationProbabilityMax: weather.daily.precipitation_probability_max?.[0] ?? null,
      uvMax: weather.daily.uv_index_max?.[0] ?? null,
      windMax: weather.daily.windspeed_10m_max?.[0] ?? null,
      sunrise: weather.daily.sunrise?.[0] ?? null,
      sunset: weather.daily.sunset?.[0] ?? null,
    };
  }, [weather]);

  const forecastAlerts = useMemo(() => {
    const results = [];
    if (!weather?.daily?.time?.length) return results;

    const maxWind = weather.daily.windspeed_10m_max?.[0] ?? 0;
    const precipChance = weather.daily.precipitation_probability_max?.[0] ?? 0;
    const precipTotal = weather.daily.precipitation_sum?.[0] ?? 0;
    const uvMax = weather.daily.uv_index_max?.[0] ?? 0;
    const highTemp = weather.daily.temperature_2m_max?.[0] ?? 0;
    const lowTemp = weather.daily.temperature_2m_min?.[0] ?? 0;
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
        headline: `Temperature range may be extreme today (${Math.round(highTemp)}${unitSymbol} / ${Math.round(
          lowTemp
        )}${unitSymbol}).`,
      });
    }

    return results;
  }, [weather, windUnit, unitSymbol, unit]);

  const hourlyCards = useMemo(() => {
    if (!weather?.hourly?.time?.length) return [];

    const times = weather.hourly.time;
    const now = Date.now();
    let startIndex = times.findIndex((time) => new Date(time).getTime() >= now);
    if (startIndex < 0) startIndex = 0;

    return times.slice(startIndex, startIndex + 24).map((time, index) => {
      const i = startIndex + index;
      return {
        time,
        temp: weather.hourly.temperature_2m[i],
        apparentTemp: weather.hourly.apparent_temperature?.[i] ?? null,
        precipitationProbability: weather.hourly.precipitation_probability[i],
        precipitation: weather.hourly.precipitation[i],
        windspeed: weather.hourly.windspeed_10m[i],
        weatherCode: weather.hourly.weathercode?.[i] ?? null,
      };
    });
  }, [weather]);

  const currentAqi = useMemo(() => {
    if (!aqiData?.hourly?.time?.length) return null;
    const now = Date.now();
    const times = aqiData.hourly.time;
    let idx = times.findIndex((time) => new Date(time).getTime() >= now);
    if (idx < 0) idx = 0;
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

  const visibleHourlyCards = useMemo(() => {
    return hourlyCards.slice(hourlyWindowStart, hourlyWindowStart + hourlyWindowSize);
  }, [hourlyCards, hourlyWindowStart]);

  const feelsLikeTrend = useMemo(() => {
    if (!visibleHourlyCards.length) return null;
    const feelsValues = visibleHourlyCards.map((item) => item.apparentTemp ?? item.temp ?? 0);
    const actualValues = visibleHourlyCards.map((item) => item.temp ?? 0);
    const width = Math.max(1100, feelsValues.length * 50);
    const height = 280;
    const padding = 52;
    const combinedValues = [...feelsValues, ...actualValues];
    const min = Math.min(...combinedValues);
    const max = Math.max(...combinedValues);
    const avg = feelsValues.reduce((sum, value) => sum + value, 0) / feelsValues.length;
    const feelsPoints = buildLinePointsWithDomain(feelsValues, width, height, padding, min, max);
    const actualPoints = buildLinePointsWithDomain(actualValues, width, height, padding, min, max);
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
      stepX: (width - padding * 2) / Math.max(visibleHourlyCards.length - 1, 1),
      feelsPoints,
      actualPoints,
      areaPoints: `${padding},${height - padding} ${feelsPoints} ${width - padding},${height - padding}`,
      min,
      max,
      avg,
      yTicks,
    };
  }, [visibleHourlyCards]);

  const mapUrl = useMemo(() => {
    if (!activeCoordinates) return "";
    const { latitude, longitude } = activeCoordinates;
    return `https://embed.windy.com/embed2.html?lat=${latitude}&lon=${longitude}&detailLat=${latitude}&detailLon=${longitude}&width=650&height=420&zoom=6&level=surface&overlay=rain&product=ecmwf&menu=false&message=false&marker=true&calendar=now&pressure=false&type=map&location=coordinates&detail=false&metricWind=${unit === "celsius" ? "kmh" : "mph"}&metricTemp=${unit === "celsius" ? "c" : "f"}`;
  }, [activeCoordinates, unit]);

  const hourlyChart = useMemo(() => {
    if (!visibleHourlyCards.length) return null;

    const chartWidth = Math.max(900, visibleHourlyCards.length * 90);
    const chartHeight = 280;
    const padding = 52;

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

    return {
      width: chartWidth,
      height: chartHeight,
      padding,
      stepX: (chartWidth - padding * 2) / Math.max(visibleHourlyCards.length - 1, 1),
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
  }, [visibleHourlyCards]);

  const hoveredHour = hoverHourlyIndex !== null ? visibleHourlyCards[hoverHourlyIndex] : null;
  const hoveredFeelsHour = hoverFeelsIndex !== null ? visibleHourlyCards[hoverFeelsIndex] : null;

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
    const maxStart = Math.max(0, hourlyCards.length - hourlyWindowSize);
    if (hourlyWindowStart > maxStart) {
      setHourlyWindowStart(maxStart);
    }
  }, [hourlyCards, hourlyWindowStart]);

  useEffect(() => {
    // Reset hourly window to "current time" start whenever data refreshes.
    setHourlyWindowStart(0);
  }, [weather?.hourly?.time]);

  useEffect(() => {
    setHoverHourlyIndex(null);
    setHoverScreenPos(null);
    setHoverFeelsIndex(null);
    setHoverFeelsScreenPos(null);
  }, [hourlyWindowStart]);

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
        const data = await fetchJsonWithRetry(
          `https://geocoding-api.open-meteo.com/v1/search?name=${encodeURIComponent(trimmed)}&count=${AUTOCOMPLETE_LIMIT}&language=en&format=json`,
          1,
          8000
        );
        if (isCancelled) return;

        const nextSuggestions = (data?.results ?? []).map((result) => ({
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
        const geoData = await fetchJsonWithRetry(
          `https://geocoding-api.open-meteo.com/v1/search?name=${encodeURIComponent(trimmedCity)}&count=1&language=en&format=json`
        );
        location = geoData?.results?.[0];
      }

      if (!location) {
        throw new Error("City not found. Try another name.");
      }

      const weatherData = await fetchJsonWithRetry(
        `https://api.open-meteo.com/v1/forecast?latitude=${location.latitude}&longitude=${location.longitude}&current=temperature_2m,apparent_temperature,relative_humidity_2m,windspeed_10m,weathercode,surface_pressure,visibility,cloudcover,dewpoint_2m&hourly=temperature_2m,apparent_temperature,precipitation_probability,precipitation,windspeed_10m,weathercode&daily=weathercode,temperature_2m_max,temperature_2m_min,precipitation_probability_max,precipitation_sum,windspeed_10m_max,uv_index_max,sunrise,sunset&timezone=auto&temperature_unit=${unit}&windspeed_unit=${unit === "celsius" ? "kmh" : "mph"}`
      );
      if (requestId !== latestRequestRef.current) return;
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
        `https://api.open-meteo.com/v1/forecast?latitude=${preciseLatitude}&longitude=${preciseLongitude}&current=temperature_2m,apparent_temperature,relative_humidity_2m,windspeed_10m,weathercode,surface_pressure,visibility,cloudcover,dewpoint_2m&hourly=temperature_2m,apparent_temperature,precipitation_probability,precipitation,windspeed_10m,weathercode&daily=weathercode,temperature_2m_max,temperature_2m_min,precipitation_probability_max,precipitation_sum,windspeed_10m_max,uv_index_max,sunrise,sunset&timezone=auto&temperature_unit=${unit}&windspeed_unit=${unit === "celsius" ? "kmh" : "mph"}`
      );
      if (requestId !== latestRequestRef.current) return;
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
              <p className="text-slate-300">Search any city to view current weather and a 5-day forecast.</p>
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
                placeholder="Search city (e.g. St. John's, London, Tokyo)"
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
                <p className="text-xs uppercase tracking-wide text-slate-400">UV Index (Max)</p>
                <p className="mt-1 font-semibold">{todayOverview?.uvMax?.toFixed?.(1) ?? "N/A"}</p>
              </div>
            </div>
          </section>
        ) : null}

        {currentAqi ? (
          <section className="glass-panel animate-fade-in rounded-xl p-5">
            <h2 className="text-xl font-semibold">Air Quality & Pollen</h2>
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

        {feelsLikeTrend ? (
          <section className="glass-panel animate-fade-in rounded-xl p-5">
            <h2 className="text-xl font-semibold">Feels Like Trend (Next 24h)</h2>
            <div className="mt-3 rounded-lg border border-slate-700 bg-slate-900/50 p-3">
              <div className="flex items-center justify-between text-xs text-slate-300">
                <span>Window start: {formatHourLabel(visibleHourlyCards[0]?.time ?? hourlyCards[0]?.time)}</span>
                <span>Showing {hourlyWindowSize} hours</span>
              </div>
              <input
                className="app-range mt-2 w-full"
                max={Math.max(0, hourlyCards.length - hourlyWindowSize)}
                min={0}
                onChange={(event) => setHourlyWindowStart(Number(event.target.value))}
                step={1}
                type="range"
                value={hourlyWindowStart}
              />
            </div>
            <div className="mt-3 grid grid-cols-3 gap-3 text-sm">
              <div className="rounded-lg border border-slate-700 bg-slate-950/40 p-3">
                <p className="text-slate-400">Min Feels Like</p>
                <p className="font-semibold">
                  {Math.round(feelsLikeTrend.min)}
                  {unitSymbol}
                </p>
              </div>
              <div className="rounded-lg border border-slate-700 bg-slate-950/40 p-3">
                <p className="text-slate-400">Average Feels Like</p>
                <p className="font-semibold">
                  {Math.round(feelsLikeTrend.avg)}
                  {unitSymbol}
                </p>
              </div>
              <div className="rounded-lg border border-slate-700 bg-slate-950/40 p-3">
                <p className="text-slate-400">Max Feels Like</p>
                <p className="font-semibold">
                  {Math.round(feelsLikeTrend.max)}
                  {unitSymbol}
                </p>
              </div>
            </div>
            <div className="relative mt-3 overflow-hidden">
              <svg
                className="w-full"
                height={feelsLikeTrend.height}
                viewBox={`0 0 ${feelsLikeTrend.width} ${feelsLikeTrend.height}`}
                preserveAspectRatio="none"
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
                      x={feelsLikeTrend.padding - 8}
                      y={tick.y + 3}
                      fill="#94a3b8"
                      fontSize="11"
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
                <polyline fill="none" points={feelsLikeTrend.actualPoints} stroke="#38bdf8" strokeWidth="2" />
                <polyline fill="none" points={feelsLikeTrend.feelsPoints} stroke="#f59e0b" strokeWidth="3" />
                <rect
                  x={feelsLikeTrend.padding}
                  y={feelsLikeTrend.padding}
                  width={feelsLikeTrend.width - feelsLikeTrend.padding * 2}
                  height={feelsLikeTrend.height - feelsLikeTrend.padding * 2}
                  fill="transparent"
                  onMouseLeave={() => {
                    setHoverFeelsIndex(null);
                    setHoverFeelsScreenPos(null);
                  }}
                  onMouseMove={(event) => {
                    const bounds = event.currentTarget.getBoundingClientRect();
                    const localX = event.clientX - bounds.left;
                    const ratio = localX / bounds.width;
                    const idx = Math.min(
                      visibleHourlyCards.length - 1,
                      Math.max(0, Math.round(ratio * (visibleHourlyCards.length - 1)))
                    );
                    setHoverFeelsIndex(idx);
                    setHoverFeelsScreenPos({ x: localX + 12, y: 10 });
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
              </svg>
              {hoveredFeelsHour && hoverFeelsScreenPos ? (
                <div
                  className="pointer-events-none absolute z-10 rounded-md border border-slate-600 bg-slate-950/95 px-2 py-1 text-xs text-slate-100"
                  style={{ left: hoverFeelsScreenPos.x, top: hoverFeelsScreenPos.y }}
                >
                  <p className="font-semibold">
                    {formatHourLabel(hoveredFeelsHour.time)} {getWeatherEmoji(hoveredFeelsHour.weatherCode)}
                  </p>
                  <p>
                    Feels like: {Math.round(hoveredFeelsHour.apparentTemp ?? hoveredFeelsHour.temp)}
                    {unitSymbol}
                  </p>
                  <p>
                    Actual: {Math.round(hoveredFeelsHour.temp)}
                    {unitSymbol}
                  </p>
                </div>
              ) : null}
            </div>
            <svg
              className="mt-1 w-full"
              height={10}
              viewBox={`0 0 ${feelsLikeTrend.width} 10`}
              preserveAspectRatio="none"
            >
              {visibleHourlyCards.map((hour, index) => {
                const x = feelsLikeTrend.padding + index * feelsLikeTrend.stepX;
                return <line key={`feels-pointer-${hour.time}`} x1={x} y1={0} x2={x} y2={8} stroke="#7dd3fc" />;
              })}
            </svg>
            <div className="mt-1 grid grid-cols-4 gap-2 text-center text-[11px] text-slate-300 sm:grid-cols-6 lg:grid-cols-12">
              {visibleHourlyCards.map((hour) => (
                <div key={`feels-label-${hour.time}`} className="rounded border border-slate-800 bg-slate-950/30 px-1 py-1">
                  <p>{formatHourLabel(hour.time)}</p>
                  <p>{getTempMoodEmoji(hour.apparentTemp ?? hour.temp ?? 0, unit)}</p>
                </div>
              ))}
            </div>
            <p className="mt-2 text-xs text-slate-400">Orange = feels like, Blue = actual temperature</p>
          </section>
        ) : null}

        {todayOverview ? (
          <section className="glass-panel animate-fade-in rounded-xl p-5">
            <h2 className="text-xl font-semibold">Today at a Glance</h2>
            <div className="mt-3 grid grid-cols-2 gap-3 sm:grid-cols-4">
              <div className="rounded-lg border border-slate-700 bg-slate-950/40 p-3">
                <p className="text-xs text-slate-400">High / Low</p>
                <p className="mt-1 font-semibold">
                  {Math.round(todayOverview.tempMax ?? 0)}
                  {unitSymbol} / {Math.round(todayOverview.tempMin ?? 0)}
                  {unitSymbol}
                </p>
              </div>
              <div className="rounded-lg border border-slate-700 bg-slate-950/40 p-3">
                <p className="text-xs text-slate-400">Precip Chance</p>
                <p className="mt-1 font-semibold">{Math.round(todayOverview.precipitationProbabilityMax ?? 0)}%</p>
              </div>
              <div className="rounded-lg border border-slate-700 bg-slate-950/40 p-3">
                <p className="text-xs text-slate-400">Precip Total</p>
                <p className="mt-1 font-semibold">{(todayOverview.precipitationSum ?? 0).toFixed(1)} mm</p>
              </div>
              <div className="rounded-lg border border-slate-700 bg-slate-950/40 p-3">
                <p className="text-xs text-slate-400">Max Wind</p>
                <p className="mt-1 font-semibold">
                  {Math.round(todayOverview.windMax ?? 0)} {windUnit}
                </p>
              </div>
              <div className="rounded-lg border border-slate-700 bg-slate-950/40 p-3">
                <p className="text-xs text-slate-400">Sunrise</p>
                <p className="mt-1 font-semibold">{todayOverview.sunrise ? formatTimeLabel(todayOverview.sunrise) : "N/A"}</p>
              </div>
              <div className="rounded-lg border border-slate-700 bg-slate-950/40 p-3">
                <p className="text-xs text-slate-400">Sunset</p>
                <p className="mt-1 font-semibold">{todayOverview.sunset ? formatTimeLabel(todayOverview.sunset) : "N/A"}</p>
              </div>
            </div>
          </section>
        ) : null}

        {forecastCards.length > 0 ? (
          <section className="animate-fade-in space-y-3">
            <h2 className="text-2xl font-semibold">5-Day Forecast</h2>
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-5">
              {forecastCards.map((day) => (
                <button
                  key={day.date}
                  className={`rounded-xl border p-4 text-left transition-all duration-300 ${
                    expandedForecastDate === day.date
                      ? "scale-[1.02] border-sky-400 bg-slate-900/80 shadow-[0_0_0_1px_rgba(56,189,248,0.2)]"
                      : "border-sky-700/40 bg-slate-900/50 hover:border-sky-500/60 hover:-translate-y-0.5"
                  }`}
                  onClick={() =>
                    setExpandedForecastDate((prev) => (prev === day.date ? null : day.date))
                  }
                  type="button"
                >
                  <p className="text-sm text-slate-300">{formatDisplayDate(day.date)}</p>
                  <p className="mt-2 text-2xl">{getWeatherEmoji(day.code)}</p>
                  <p className="mt-1 text-lg font-semibold">{getWeatherDescription(day.code)}</p>
                  <p className="mt-3 text-slate-100">
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
                    className={`forecast-details mt-3 overflow-hidden border-t border-slate-700 pt-3 text-sm text-slate-200 ${
                      expandedForecastDate === day.date ? "is-open" : ""
                    }`}
                  >
                    <div className="space-y-1">
                      <p>
                        Max Wind: {Math.round(day.windMax ?? 0)} {windUnit}
                      </p>
                      <p>Precip Chance: {Math.round(day.precipitationProbabilityMax ?? 0)}%</p>
                      <p>Precip Total: {(day.precipitationSum ?? 0).toFixed(1)} mm</p>
                      <p>Sunrise: {day.sunrise ? formatTimeLabel(day.sunrise) : "N/A"}</p>
                      <p>Sunset: {day.sunset ? formatTimeLabel(day.sunset) : "N/A"}</p>
                    </div>
                  </div>
                  <p className="mt-2 text-xs text-slate-400">
                    {expandedForecastDate === day.date ? "Click to hide details" : "Click for details"}
                  </p>
                </button>
              ))}
            </div>
          </section>
        ) : null}

        {hourlyCards.length > 0 ? (
          <section className="animate-fade-in space-y-3">
            <h2 className="text-2xl font-semibold">Hourly Coverage (Next 24h)</h2>
            <div className="rounded-lg border border-slate-700 bg-slate-900/50 p-3">
              <div className="flex items-center justify-between text-xs text-slate-300">
                <span>Window start: {formatHourLabel(visibleHourlyCards[0]?.time ?? hourlyCards[0]?.time)}</span>
                <span>Showing {hourlyWindowSize} hours</span>
              </div>
              <input
                className="app-range mt-2 w-full"
                max={Math.max(0, hourlyCards.length - hourlyWindowSize)}
                min={0}
                onChange={(event) => setHourlyWindowStart(Number(event.target.value))}
                step={1}
                type="range"
                value={hourlyWindowStart}
              />
            </div>
            <div className="flex flex-wrap gap-3 text-sm">
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
            <div className="overflow-x-auto">
              <div className="glass-subpanel min-w-[900px] rounded-xl p-3">
                {hourlyChart ? (
                  <div className="mb-3 grid grid-cols-1 gap-2 sm:grid-cols-2">
                    <div className="rounded-lg border border-rose-500/40 bg-rose-900/20 p-2 text-sm text-rose-100">
                      <p className="text-xs uppercase tracking-wide text-rose-200">High</p>
                      <p className="font-semibold">
                        {Math.round(hourlyChart.tempMax)}
                        {unitSymbol} at {hourlyChart.tempMaxTime ? formatHourLabel(hourlyChart.tempMaxTime) : "--"}
                      </p>
                    </div>
                    <div className="rounded-lg border border-cyan-500/40 bg-cyan-900/20 p-2 text-sm text-cyan-100">
                      <p className="text-xs uppercase tracking-wide text-cyan-200">Low</p>
                      <p className="font-semibold">
                        {Math.round(hourlyChart.tempMin)}
                        {unitSymbol} at {hourlyChart.tempMinTime ? formatHourLabel(hourlyChart.tempMinTime) : "--"}
                      </p>
                    </div>
                  </div>
                ) : null}
                {hourlyChart ? (
                  <div className="relative">
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
                          x={hourlyChart.padding - 8}
                          y={tick.y + 3}
                          fill="#94a3b8"
                          fontSize="11"
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
                    <polyline fill="none" points={hourlyChart.tempPoints} stroke="#ef4444" strokeWidth="3" />
                    <polyline fill="none" points={hourlyChart.windPoints} stroke="#22c55e" strokeWidth="3" />
                    <polyline fill="none" points={hourlyChart.precipPoints} stroke="#38bdf8" strokeWidth="3" />

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
                      x={hourlyChart.padding}
                      y={hourlyChart.padding}
                      width={hourlyChart.width - hourlyChart.padding * 2}
                      height={hourlyChart.height - hourlyChart.padding}
                      fill="transparent"
                      onMouseLeave={() => {
                        setHoverHourlyIndex(null);
                        setHoverScreenPos(null);
                      }}
                      onMouseMove={(event) => {
                        const bounds = event.currentTarget.getBoundingClientRect();
                        const localX = event.clientX - bounds.left;
                        const ratio = localX / bounds.width;
                        const idx = Math.min(
                          visibleHourlyCards.length - 1,
                          Math.max(0, Math.round(ratio * (visibleHourlyCards.length - 1)))
                        );
                        setHoverHourlyIndex(idx);
                        setHoverScreenPos({ x: localX + 12, y: 16 });
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
                  </svg>
                  {hoveredHour && hoverScreenPos ? (
                    <div
                      className="pointer-events-none absolute z-10 rounded-md border border-slate-600 bg-slate-950/95 px-2 py-1 text-xs text-slate-100"
                      style={{ left: hoverScreenPos.x, top: hoverScreenPos.y }}
                    >
                      <p className="font-semibold">
                        {formatHourLabel(hoveredHour.time)} {getWeatherEmoji(hoveredHour.weatherCode)}
                      </p>
                      <p>
                        {Math.round(hoveredHour.temp)}
                        {unitSymbol} / {Math.round(hoveredHour.apparentTemp ?? hoveredHour.temp)}
                        {unitSymbol}
                      </p>
                    </div>
                  ) : null}
                  </div>
                ) : null}
                {hoveredHour ? (
                  <div className="mt-3 rounded-lg border border-slate-700 bg-slate-950/50 p-3 text-sm text-slate-200">
                    <p className="font-semibold">
                      {formatHourLabel(hoveredHour.time)} {getWeatherEmoji(hoveredHour.weatherCode)}
                    </p>
                    <p>
                      Temp: {Math.round(hoveredHour.temp)}
                      {unitSymbol} | Feels like: {Math.round(hoveredHour.apparentTemp ?? hoveredHour.temp)}
                      {unitSymbol}
                    </p>
                    <p>
                      Wind: {Math.round(hoveredHour.windspeed ?? 0)} {windUnit} | Precip: {(hoveredHour.precipitation ?? 0).toFixed(1)} mm ({hoveredHour.precipitationProbability ?? 0}%)
                    </p>
                  </div>
                ) : null}
                {hourlyChart ? (
                  <svg
                    className="mt-1 w-full"
                    height={10}
                    viewBox={`0 0 ${hourlyChart.width} 10`}
                    preserveAspectRatio="none"
                  >
                    {visibleHourlyCards.map((hour, index) => {
                      const x = hourlyChart.padding + index * hourlyChart.stepX;
                      return <line key={`hour-pointer-${hour.time}`} x1={x} y1={0} x2={x} y2={8} stroke="#7dd3fc" />;
                    })}
                  </svg>
                ) : null}
                <div className="mt-1 grid grid-cols-4 gap-2 text-center text-[11px] text-slate-300 sm:grid-cols-6 lg:grid-cols-12">
                  {visibleHourlyCards.map((hour) => (
                    <div key={`hour-label-${hour.time}`} className="rounded border border-slate-800 bg-slate-950/30 px-1 py-1">
                      <p>{formatHourLabel(hour.time)}</p>
                      <p>{getWeatherEmoji(hour.weatherCode)}</p>
                    </div>
                  ))}
                </div>

                <div className="mt-2">
                  <button
                    className="rounded-md border border-slate-600 bg-slate-900/70 px-3 py-1.5 text-xs font-semibold text-slate-100 transition hover:border-sky-400"
                    onClick={() => setShowHourlyDetails((prev) => !prev)}
                    type="button"
                  >
                    {showHourlyDetails ? "Hide more info" : "More info"}
                  </button>
                </div>
                {showHourlyDetails ? (
                  <div className="mt-2 grid grid-cols-2 gap-2 text-xs text-slate-300 sm:grid-cols-4 lg:grid-cols-6">
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
                ) : null}
              </div>
            </div>
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
