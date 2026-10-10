import type { Weather } from './data';

const SNOW_CODES = new Set([56, 57, 66, 67, 71, 73, 75, 77, 85, 86]);
const HEAVY_RAIN_CODES = new Set([65, 82, 95, 96, 99]);
const LIGHT_RAIN_CODES = new Set([51, 53, 55, 61, 63, 80, 81]);

export function weatherBucket(input: {
  temperatureC: number;
  precipitationMm: number;
  snowfallMm: number;
  weatherCode: number;
  cloudCoverPct: number;
}): Weather {
  if (input.snowfallMm > 0 || SNOW_CODES.has(input.weatherCode) || input.temperatureC <= 0) return 'snow_frost_ice';
  if (input.precipitationMm >= 2.5 || HEAVY_RAIN_CODES.has(input.weatherCode)) return 'heavy_rain';
  if (input.precipitationMm >= 0.1 || LIGHT_RAIN_CODES.has(input.weatherCode)) return 'light_rain';
  if (input.cloudCoverPct >= 60 || [45, 48].includes(input.weatherCode)) return 'dry_overcast';
  return 'dry_sunny';
}
