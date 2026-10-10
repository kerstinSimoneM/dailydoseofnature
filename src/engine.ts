import SunCalc from 'suncalc';
import { latLngToCell } from 'h3-js';
import { anchors, species, type Language, type Weather } from './data';

export type Coordinates = { lat: number; lng: number };
export type Mission = {
  anchor: (typeof anchors)[number];
  distanceKm: number;
  bearing: number;
  walkMinutes: number;
  observeMinutes: number;
  stops: (typeof anchors)[number][];
  targets: typeof species;
  gems: typeof species;
  safety: string | null;
  context: Weather;
  h3Cell: string;
};

export function haversineKm(from: Coordinates, to: Coordinates): number {
  const rad = (degrees: number) => (degrees * Math.PI) / 180;
  const latDelta = rad(to.lat - from.lat);
  const lngDelta = rad(to.lng - from.lng);
  const a =
    Math.sin(latDelta / 2) ** 2 +
    Math.cos(rad(from.lat)) * Math.cos(rad(to.lat)) * Math.sin(lngDelta / 2) ** 2;
  return 6371 * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

export function bearingDegrees(from: Coordinates, to: Coordinates): number {
  const rad = (degrees: number) => (degrees * Math.PI) / 180;
  const y = Math.sin(rad(to.lng - from.lng)) * Math.cos(rad(to.lat));
  const x =
    Math.cos(rad(from.lat)) * Math.sin(rad(to.lat)) -
    Math.sin(rad(from.lat)) * Math.cos(rad(to.lat)) * Math.cos(rad(to.lng - from.lng));
  return (Math.atan2(y, x) * 180 / Math.PI + 360) % 360;
}

export function cardinalDirection(degrees: number, language: Language): string {
  const directions = {
    en: ['N', 'NE', 'E', 'SE', 'S', 'SW', 'W', 'NW'],
    de: ['N', 'NO', 'O', 'SO', 'S', 'SW', 'W', 'NW'],
    fr: ['N', 'NE', 'E', 'SE', 'S', 'SO', 'O', 'NO'],
  }[language];
  return directions[Math.round(degrees / 45) % 8];
}

export function timeOfDay(date: Date, location: Coordinates): 'dawn' | 'late_morning' | 'afternoon' | 'dusk' | 'night' {
  const { sunrise, sunset } = SunCalc.getTimes(date, location.lat, location.lng);
  const minutes = date.getHours() * 60 + date.getMinutes();
  const sunriseMins = sunrise.getHours() * 60 + sunrise.getMinutes();
  const sunsetMins = sunset.getHours() * 60 + sunset.getMinutes();
  if (minutes >= sunriseMins - 45 && minutes < sunriseMins + 120) return 'dawn';
  if (minutes >= sunriseMins + 120 && minutes < 13 * 60) return 'late_morning';
  if (minutes >= 13 * 60 && minutes < sunsetMins - 90) return 'afternoon';
  if (minutes >= sunsetMins - 90 && minutes < sunsetMins + 60) return 'dusk';
  return 'night';
}

export function missionBudget(totalMinutes: number, walkFraction = 0.6, pace = 75, detour = 1.35) {
  const total = Math.min(360, Math.max(5, totalMinutes));
  const walking = total * walkFraction;
  const observing = total >= 25 ? Math.max(10, total - walking) : total - walking;
  const radiusKm = ((walking / 2) * pace) / detour / 1000;
  return {
    total,
    walkMinutes: Math.round(walking),
    observeMinutes: Math.round(observing),
    radiusKm,
    tier: total < 15 ? 'doorstep' : total <= 180 ? 'destination' : 'multi-stop',
  } as const;
}

export function monthLift(month: number, activeMonths: number[]): number {
  const active = new Set(activeMonths);
  const previous = month === 1 ? 12 : month - 1;
  const next = month === 12 ? 1 : month + 1;
  return Number((0.25 * Number(active.has(previous)) + 0.5 * Number(active.has(month)) + 0.25 * Number(active.has(next))).toFixed(2));
}

export function safetyMessage(weather: Weather, location: Coordinates, when: Date, totalMinutes: number, language: Language): string | null {
  const labels = {
    en: {
      storm: 'Thunder is in the forecast: stay indoors until it has passed. Take this short, sheltered street-tree wander only when it is safe.',
      ice: 'Slippery conditions are possible: stick to paved, well-lit paths and take it slow.',
      night: 'Most of your outing is after dark: choose a familiar, lit path and leave wooded trails for daylight.',
      heat: 'It may be hot: keep to shade, bring water, and take breaks.',
    },
    de: {
      storm: 'Bei Gewitter bleib drinnen, bis es vorbei ist. Geh erst danach und nur wenn es sicher ist auf einen kurzen, geschützten Spaziergang.',
      ice: 'Es kann glatt sein: bleib auf beleuchteten, befestigten Wegen und geh langsam.',
      night: 'Der größte Teil ist nach Einbruch der Dunkelheit: wähle einen vertrauten, beleuchteten Weg.',
      heat: 'Es kann heiß werden: suche Schatten, nimm Wasser mit und mach Pausen.',
    },
    fr: {
      storm: 'En cas d’orage, reste à l’intérieur jusqu’à ce qu’il soit passé. Cette courte balade abritée attendra que ce soit sûr.',
      ice: 'Le sol peut être glissant : reste sur des chemins pavés et éclairés, sans te presser.',
      night: 'La sortie se fera surtout de nuit : choisis un chemin éclairé et familier.',
      heat: 'Il peut faire chaud : reste à l’ombre, emporte de l’eau et fais des pauses.',
    },
  }[language];
  if (weather === 'thunderstorm') return labels.storm;
  if (weather === 'snow_frost_ice') return labels.ice;
  let nightMinutes = 0;
  const totalMs = Math.max(0, Math.min(360, totalMinutes)) * 60_000;
  for (let elapsed = 0; elapsed < totalMs; elapsed += 60 * 60_000) {
    const intervalMinutes = Math.min(60, (totalMs - elapsed) / 60_000);
    if (timeOfDay(new Date(when.getTime() + elapsed), location) === 'night') nightMinutes += intervalMinutes;
  }
  if (totalMinutes > 0 && nightMinutes / totalMinutes > 0.5) return labels.night;
  return null;
}

export function buildMission(
  location: Coordinates,
  totalMinutes: number,
  weather: Weather,
  when = new Date(),
  walkFraction = 0.6,
  pace = 75,
  language: Language = 'en',
): Mission {
  const budget = missionBudget(totalMinutes, walkFraction, pace);
  const rankedAnchors = anchors
    .map((anchor) => ({ anchor, distanceKm: haversineKm(location, anchor) }))
    .sort((a, b) => a.distanceKm - b.distanceKm);
  const nearest = rankedAnchors[0];
  const eligible = rankedAnchors.filter(({ anchor, distanceKm }) => distanceKm <= budget.radiusKm && anchor.access === 'public');
  const nightShare = Array.from({ length: Math.ceil(totalMinutes / 60) }, (_, hour) => {
    const part = Math.min(60, totalMinutes - hour * 60);
    return timeOfDay(new Date(when.getTime() + hour * 60 * 60_000), location) === 'night' ? part : 0;
  }).reduce((sum, value) => sum + value, 0) / Math.max(totalMinutes, 1);
  const fallbackNightAnchor = rankedAnchors.find(({ anchor }) => anchor.id === 'street-trees');
  const safetyEligible = weather === 'thunderstorm'
    ? eligible.filter(({ anchor }) => anchor.id === 'street-trees')
    : weather === 'snow_frost_ice'
      ? eligible.filter(({ anchor }) => anchor.lit)
      : eligible;
  const safeForNight = nightShare > 0.5
    ? safetyEligible.filter(({ anchor }) => anchor.lit && !anchor.habitat.includes('woodland'))
    : safetyEligible;
  const chosen = safeForNight.length > 0
    ? safeForNight
    : (nightShare > 0.5 || weather === 'thunderstorm' || weather === 'snow_frost_ice') && fallbackNightAnchor
      ? [fallbackNightAnchor]
      : safetyEligible.length > 0 ? safetyEligible : [nearest];
  const anchor = chosen[0].anchor;
  const month = when.getMonth() + 1;

  const eligibleSpecies = species
    .map((entry) => ({ entry, lift: monthLift(month, entry.months) }))
    .sort((a, b) => b.lift - a.lift || a.entry.id.localeCompare(b.entry.id));
  const groupBalanced: typeof species = [];
  for (const candidate of eligibleSpecies) {
    if (groupBalanced.filter((selected) => selected.group === candidate.entry.group).length < 2) {
      groupBalanced.push(candidate.entry);
    }
    if (groupBalanced.length === 3) break;
  }
  const gems = eligibleSpecies
    .map(({ entry }) => entry)
    .filter((entry) => !groupBalanced.some((selected) => selected.id === entry.id))
    .slice(0, 2);
  const bearing = bearingDegrees(location, anchor);

  return {
    anchor,
    distanceKm: nearest.distanceKm,
    bearing,
    walkMinutes: budget.walkMinutes,
    observeMinutes: budget.observeMinutes,
    stops: chosen.slice(0, budget.tier === 'multi-stop' ? 3 : 1).map((item) => item.anchor),
    targets: groupBalanced,
    gems,
    safety: safetyMessage(weather, location, when, budget.total, language),
    context: weather,
    // Computed locally for coarse backoff; never persisted or sent over the network.
    h3Cell: latLngToCell(location.lat, location.lng, 8),
  };
}

export function formatDistance(km: number, language: Language) {
  const meters = Math.round(km * 1000);
  if (language === 'de') return meters < 1000 ? `${meters} m` : `${(km).toFixed(1).replace('.', ',')} km`;
  if (language === 'fr') return meters < 1000 ? `${meters} m` : `${km.toFixed(1).replace('.', ',')} km`;
  return meters < 1000 ? `${meters} m` : `${km.toFixed(1)} km`;
}
