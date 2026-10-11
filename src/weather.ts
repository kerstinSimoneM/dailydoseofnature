import { z } from 'zod';
import { weatherBucket as classifyWeather } from './weatherRules';
import type { Weather } from './data';

export const BERLIN_WEATHER_LOCATION = Object.freeze({ latitude: 52.52, longitude: 13.405 });
const CACHE_KEY = 'nature-berlin-forecast-v1';
const MAX_CACHE_AGE_MS = 3 * 60 * 60 * 1000;
const HOURLY_FIELDS = [
  'temperature_2m',
  'precipitation',
  'snowfall',
  'weather_code',
  'cloud_cover',
  'wind_gusts_10m',
] as const;

const forecastSchema = z.object({
  hourly: z.object({
    time: z.array(z.number()),
    temperature_2m: z.array(z.number()),
    precipitation: z.array(z.number()),
    snowfall: z.array(z.number()),
    weather_code: z.array(z.number().int()),
    cloud_cover: z.array(z.number()),
    wind_gusts_10m: z.array(z.number()),
  }),
});

export type ForecastHour = {
  time: string;
  temperatureC: number;
  precipitationMm: number;
  snowfallMm: number;
  weatherCode: number;
  cloudCoverPct: number;
  gustKmh: number;
};

type ForecastCache = { fetchedAt: number; hours: ForecastHour[] };
export type ForecastResult = {
  hours: ForecastHour[];
  fetchedAt: number;
  source: 'live' | 'cached' | 'stale';
  cacheWarning?: string;
};
export type OutingWeather = {
  bucket: Weather;
  thunderstorm: boolean;
  icy: boolean;
  heat: boolean;
  hasForecast: boolean;
};

const cacheSchema = z.object({
  fetchedAt: z.number().finite(),
  hours: z.array(z.object({
    time: z.string(),
    temperatureC: z.number(),
    precipitationMm: z.number(),
    snowfallMm: z.number(),
    weatherCode: z.number().int(),
    cloudCoverPct: z.number(),
    gustKmh: z.number(),
  })),
});

function readCache(storage: Storage): ForecastCache | null {
  const raw = storage.getItem(CACHE_KEY);
  if (!raw) return null;
  const parsed: unknown = JSON.parse(raw);
  return cacheSchema.parse(parsed);
}

function convertResponse(value: unknown): ForecastHour[] {
  const parsed = forecastSchema.parse(value);
  const { hourly } = parsed;
  const lengths = HOURLY_FIELDS.map((field) => hourly[field].length);
  if (lengths.some((length) => length !== hourly.time.length)) {
    throw new Error('Open-Meteo returned misaligned hourly forecast fields.');
  }
  return hourly.time.map((time, index) => ({
    time: new Date(time * 1000).toISOString(),
    temperatureC: hourly.temperature_2m[index],
    precipitationMm: hourly.precipitation[index],
    snowfallMm: hourly.snowfall[index],
    weatherCode: hourly.weather_code[index],
    cloudCoverPct: hourly.cloud_cover[index],
    gustKmh: hourly.wind_gusts_10m[index],
  }));
}

export function berlinForecastUrl(): URL {
  const url = new URL('https://api.open-meteo.com/v1/forecast');
  url.search = new URLSearchParams({
    latitude: String(BERLIN_WEATHER_LOCATION.latitude),
    longitude: String(BERLIN_WEATHER_LOCATION.longitude),
    hourly: HOURLY_FIELDS.join(','),
    forecast_days: '3',
    timezone: 'Europe/Berlin',
    timeformat: 'unixtime',
    temperature_unit: 'celsius',
    wind_speed_unit: 'kmh',
    precipitation_unit: 'mm',
  }).toString();
  return url;
}

function forecastRequestUrl(): URL | string {
  const forecastUrl = berlinForecastUrl();
  if (import.meta.env.DEV) return `/api/weather${forecastUrl.search}`;
  return forecastUrl;
}

export async function getBerlinForecast(
  now = Date.now(),
  fetcher: typeof fetch = fetch,
  storage?: Storage,
): Promise<ForecastResult> {
  let cacheStorage: Storage | undefined;
  let cached: ForecastCache | null = null;
  let cacheWarning: string | undefined;
  try {
    cacheStorage = storage ?? globalThis.localStorage;
    cached = readCache(cacheStorage);
  } catch (error) {
    cacheWarning = error instanceof Error ? error.message : String(error);
  }

  try {
    const controller = new AbortController();
    const timeout = globalThis.setTimeout(() => controller.abort(), 20_000);
    try {
      const response = await fetcher(forecastRequestUrl(), { signal: controller.signal, credentials: 'omit' });
      if (!response.ok) throw new Error(`Open-Meteo request failed (${response.status}).`);
      const hours = convertResponse(await response.json());
      const cache = { fetchedAt: now, hours };
      try {
        cacheStorage?.setItem(CACHE_KEY, JSON.stringify(cache));
      } catch (error) {
        cacheWarning = error instanceof Error ? error.message : String(error);
      }
      return { ...cache, source: 'live', ...(cacheWarning ? { cacheWarning } : {}) };
    } finally {
      globalThis.clearTimeout(timeout);
    }
  } catch (networkError) {
    if (cached) {
      return {
        ...cached,
        source: now - cached.fetchedAt <= MAX_CACHE_AGE_MS ? 'cached' : 'stale',
      };
    }
    const detail = networkError instanceof Error ? networkError.message : String(networkError);
    throw new Error(cacheWarning
      ? `Open-Meteo forecast request failed: ${detail}. Forecast cache is also unavailable: ${cacheWarning}`
      : `Open-Meteo forecast request failed: ${detail}`);
  }
}

export function outingWeather(
  forecast: ForecastResult | null,
  start: Date,
  durationMinutes: number,
): OutingWeather {
  if (!forecast) return { bucket: 'dry_sunny', thunderstorm: false, icy: false, heat: false, hasForecast: false };
  const end = new Date(start.getTime() + Math.max(5, Math.min(360, durationMinutes)) * 60_000);
  const selected = forecast.hours.filter((hour) => {
    const time = new Date(hour.time).getTime();
    return time >= start.getTime() - 3 * 60 * 60_000 && time < end.getTime();
  });
  if (!selected.length) return { bucket: 'dry_sunny', thunderstorm: false, icy: false, heat: false, hasForecast: false };

  const weighted = new Map<Weather, number>();
  let thunderstorm = false;
  let icy = false;
  let heat = false;
  for (let index = 0; index < selected.length; index += 1) {
    const hour = selected[index];
    const previousHours = selected.slice(Math.max(0, index - 3), index + 1);
    const rollingPrecipitation = previousHours.reduce((total, value) => total + value.precipitationMm, 0);
    const bucket = classifyWeather({
      temperatureC: hour.temperatureC,
      precipitationMm: Math.max(hour.precipitationMm, rollingPrecipitation),
      snowfallMm: hour.snowfallMm,
      weatherCode: hour.weatherCode,
      cloudCoverPct: hour.cloudCoverPct,
    });
    const hourStart = new Date(hour.time).getTime();
    const weight = Math.max(0, Math.min(end.getTime(), hourStart + 60 * 60_000) - Math.max(start.getTime(), hourStart));
    if (weight > 0) {
      weighted.set(bucket, (weighted.get(bucket) ?? 0) + weight);
      thunderstorm ||= (hour.weatherCode >= 95 && hour.weatherCode <= 99) || hour.gustKmh >= 60;
      icy ||= (hour.temperatureC <= 0 && (hour.precipitationMm > 0 || hour.snowfallMm > 0)) || [56, 57, 66, 67].includes(hour.weatherCode);
      heat ||= hour.temperatureC >= 32;
    }
  }
  const bucket = [...weighted.entries()].sort((left, right) => right[1] - left[1])[0]?.[0] ?? 'dry_sunny';
  return { bucket, thunderstorm, icy, heat, hasForecast: true };
}

export function currentForecastWeather(forecast: ForecastResult | null, now = Date.now()): Weather | null {
  const currentHour = currentForecastHour(forecast, now);
  if (!currentHour) return null;
  if (currentHour.weatherCode >= 95 && currentHour.weatherCode <= 99) return 'thunderstorm';
  return classifyWeather({
    temperatureC: currentHour.temperatureC,
    precipitationMm: currentHour.precipitationMm,
    snowfallMm: currentHour.snowfallMm,
    weatherCode: currentHour.weatherCode,
    cloudCoverPct: currentHour.cloudCoverPct,
  });
}

export function currentForecastHour(forecast: ForecastResult | null, now = Date.now()): ForecastHour | null {
  if (!forecast?.hours.length) return null;
  const currentHour = forecast.hours.reduce((closest, hour) =>
    Math.abs(Date.parse(hour.time) - now) < Math.abs(Date.parse(closest.time) - now) ? hour : closest,
  );
  if (Math.abs(Date.parse(currentHour.time) - now) > 90 * 60_000) return null;
  return currentHour;
}

export function forecastAgeLabel(forecast: ForecastResult, now = Date.now()): string {
  const minutes = Math.max(0, Math.floor((now - forecast.fetchedAt) / 60_000));
  if (minutes < 1) return 'just now';
  if (minutes < 60) return `${minutes} min ago`;
  return `${Math.floor(minutes / 60)} h ago`;
}

export function weatherCacheMaxAgeMs(): number {
  return MAX_CACHE_AGE_MS;
}
