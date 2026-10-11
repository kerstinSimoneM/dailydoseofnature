import { describe, expect, it } from 'vitest';
import { BERLIN_WEATHER_LOCATION, berlinForecastUrl, currentForecastHour, currentForecastWeather, getBerlinForecast, outingWeather, weatherCacheMaxAgeMs } from './weather';
import { weatherBucket } from './weatherRules';

function fixtureHour(time: string, values: Partial<{
  temperatureC: number; precipitationMm: number; snowfallMm: number;
  weatherCode: number; cloudCoverPct: number; gustKmh: number;
}> = {}) {
  return {
    time,
    temperatureC: values.temperatureC ?? 12,
    precipitationMm: values.precipitationMm ?? 0,
    snowfallMm: values.snowfallMm ?? 0,
    weatherCode: values.weatherCode ?? 0,
    cloudCoverPct: values.cloudCoverPct ?? 15,
    gustKmh: values.gustKmh ?? 15,
  };
}

describe('weather buckets', () => {
  it('implements exact rain boundaries and rule precedence', () => {
    expect(weatherBucket({ temperatureC: 12, precipitationMm: 0.099, snowfallMm: 0, weatherCode: 0, cloudCoverPct: 10 })).toBe('dry_sunny');
    expect(weatherBucket({ temperatureC: 12, precipitationMm: 0.1, snowfallMm: 0, weatherCode: 0, cloudCoverPct: 10 })).toBe('light_rain');
    expect(weatherBucket({ temperatureC: 12, precipitationMm: 2.5, snowfallMm: 0, weatherCode: 0, cloudCoverPct: 10 })).toBe('heavy_rain');
    expect(weatherBucket({ temperatureC: 0, precipitationMm: 8, snowfallMm: 0, weatherCode: 95, cloudCoverPct: 100 })).toBe('snow_frost_ice');
    expect(weatherBucket({ temperatureC: 12, precipitationMm: 0, snowfallMm: 0, weatherCode: 45, cloudCoverPct: 10 })).toBe('dry_overcast');
  });

  it('builds requests for the fixed Berlin centre and only the allowlisted weather origin', () => {
    const url = berlinForecastUrl();
    expect(url.origin).toBe('https://api.open-meteo.com');
    expect(url.searchParams.get('latitude')).toBe(String(BERLIN_WEATHER_LOCATION.latitude));
    expect(url.searchParams.get('longitude')).toBe(String(BERLIN_WEATHER_LOCATION.longitude));
    expect(url.searchParams.get('timezone')).toBe('Europe/Berlin');
  });

  it('uses only fixed coordinates in the fetch and caches forecast values locally', async () => {
    const memory = new Map<string, string>();
    const storage = {
      getItem: (key: string) => memory.get(key) ?? null,
      setItem: (key: string, value: string) => { memory.set(key, value); },
    } as Storage;
    const requestedUrls: string[] = [];
    const fetcher = async (input: RequestInfo | URL) => {
      requestedUrls.push(String(input));
      return new Response(JSON.stringify({
        hourly: {
          time: [Math.floor(Date.parse('2026-10-10T20:00:00Z') / 1000), Math.floor(Date.parse('2026-10-10T21:00:00Z') / 1000)],
          temperature_2m: [11, 10], precipitation: [0, 0], snowfall: [0, 0],
          weather_code: [0, 0], cloud_cover: [5, 10], wind_gusts_10m: [20, 20],
        },
      }), { status: 200 });
    };
    const forecast = await getBerlinForecast(Date.parse('2026-10-10T19:00:00Z'), fetcher as typeof fetch, storage);
    const requestedUrl = new URL(requestedUrls[0], 'https://local.test');
    expect(requestedUrl.pathname).toBe('/api/weather');
    expect(requestedUrl.searchParams.get('latitude')).toBe('52.52');
    expect(requestedUrl.searchParams.get('longitude')).toBe('13.405');
    expect(memory.get('nature-berlin-forecast-v1')).not.toContain('coordinates');
    expect(forecast.source).toBe('live');
    expect(weatherCacheMaxAgeMs()).toBe(3 * 60 * 60 * 1000);
  });

  it('detects thunderstorms, ice, heat, and rolling precipitation for an outing', () => {
    const start = new Date('2026-06-21T12:00:00Z');
    const forecast = {
      fetchedAt: start.getTime(),
      source: 'live' as const,
      hours: [
        fixtureHour('2026-06-21T12:00:00Z', { precipitationMm: 1, weatherCode: 80, temperatureC: 33, gustKmh: 61 }),
        fixtureHour('2026-06-21T13:00:00Z', { precipitationMm: 1, weatherCode: 95, temperatureC: 33 }),
        fixtureHour('2026-06-21T14:00:00Z', { precipitationMm: 3, weatherCode: 65, temperatureC: 33 }),
      ],
    };
    const outing = outingWeather(forecast, start, 180);
    expect(outing.bucket).toBe('heavy_rain');
    expect(outing.thunderstorm).toBe(true);
    expect(outing.heat).toBe(true);
  });

  it('reports the current forecast hour independently of the planned outing duration', () => {
    const now = Date.parse('2026-06-21T12:30:00Z');
    const forecast = {
      fetchedAt: now,
      source: 'live' as const,
      hours: [
        fixtureHour('2026-06-21T12:00:00Z', { weatherCode: 3, cloudCoverPct: 85 }),
        fixtureHour('2026-06-21T13:00:00Z', { weatherCode: 61, precipitationMm: 0.5 }),
      ],
    };
    expect(currentForecastWeather(forecast, now)).toBe('dry_overcast');
    expect(currentForecastHour(forecast, now)?.temperatureC).toBe(12);
    expect(outingWeather(forecast, new Date(now), 120).bucket).not.toBe(currentForecastWeather(forecast, now));
    expect(currentForecastWeather(null, now)).toBeNull();
  });

  it('marks stale cache data as stale and preserves it when the network is unavailable', async () => {
    const fetchedAt = Date.parse('2026-10-10T10:00:00Z');
    const memory = new Map([['nature-berlin-forecast-v1', JSON.stringify({ fetchedAt, hours: [fixtureHour('2026-10-10T10:00:00Z')] })]]);
    const storage = { getItem: (key: string) => memory.get(key) ?? null } as Storage;
    const result = await getBerlinForecast(fetchedAt + 4 * 60 * 60 * 1000, async () => { throw new Error('offline'); }, storage);
    expect(result.source).toBe('stale');
    expect(result.hours).toHaveLength(1);
  });

  it('still returns live weather when Safari storage cannot be read or written', async () => {
    const storage = {
      getItem: () => { throw new DOMException('Storage access is denied', 'SecurityError'); },
      setItem: () => { throw new DOMException('Storage access is denied', 'SecurityError'); },
    } as unknown as Storage;
    const fetcher = async () => new Response(JSON.stringify({
      hourly: {
        time: [Math.floor(Date.parse('2026-10-11T10:00:00Z') / 1000)],
        temperature_2m: [12], precipitation: [0], snowfall: [0],
        weather_code: [1], cloud_cover: [10], wind_gusts_10m: [12],
      },
    }), { status: 200 });

    const forecast = await getBerlinForecast(Date.parse('2026-10-11T10:00:00Z'), fetcher as typeof fetch, storage);

    expect(forecast.source).toBe('live');
    expect(forecast.hours).toHaveLength(1);
    expect(forecast.cacheWarning).toContain('Storage access is denied');
  });

  it('preserves the network failure detail when neither cache nor forecast is available', async () => {
    const storage = { getItem: () => null } as unknown as Storage;

    await expect(getBerlinForecast(
      Date.now(),
      async () => { throw new TypeError('Load failed'); },
      storage,
    )).rejects.toThrow('Open-Meteo forecast request failed: Load failed');
  });
});
