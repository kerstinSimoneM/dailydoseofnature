import SunCalc from 'suncalc';
import { cellToParent, getResolution, latLngToCell } from 'h3-js';
import { anchors, species, type Anchor, type Language, type Species, type Weather } from './data';

export type Coordinates = { lat: number; lng: number };
export type Season = 'spring' | 'summer' | 'autumn' | 'winter';
export type SafetyHazards = { thunderstorm?: boolean; icy?: boolean; heat?: boolean };
export type MissionCatalog = {
  anchors: Anchor[];
  species: Species[];
  builtAt?: string;
  speciesLocation?: 'origin' | 'destination' | 'both';
};
export type Mission = {
  anchor: Anchor;
  distanceKm: number;
  bearing: number;
  walkMinutes: number;
  observeMinutes: number;
  stops: Anchor[];
  targets: Species[];
  gems: Species[];
  safety: string | null;
  context: Weather;
  h3Cell: string;
  nearbyEvidenceCell: string | null;
  freshness: string;
  dataBuiltAt: string | null;
  season: Season;
  timeBudgetMinutes: number;
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
  const walking = total >= 25
    ? Math.min(total * walkFraction, total - 10)
    : total * walkFraction;
  const observing = total - walking;
  const radiusKm = ((walking / 2) * pace) / detour / 1000;
  return {
    total,
    walkMinutes: Math.round(walking),
    observeMinutes: Math.round(observing),
    radiusKm,
    tier: total < 15 ? 'doorstep' : total <= 180 ? 'destination' : 'multi-stop',
  } as const;
}

export function estimateRoundTripWalkMinutes(distanceKm: number, pace = 75, detour = 1.35): number {
  if (distanceKm <= 0) return 0;
  return Math.ceil((distanceKm * 2 * detour * 1_000) / pace);
}

export function monthLift(month: number, activeMonths: number[]): number {
  const active = new Set(activeMonths);
  const previous = month === 1 ? 12 : month - 1;
  const next = month === 12 ? 1 : month + 1;
  return Number((0.25 * Number(active.has(previous)) + 0.5 * Number(active.has(month)) + 0.25 * Number(active.has(next))).toFixed(2));
}

function illustrativeContextLift(
  entry: Species,
  anchor: Anchor,
  weather: Weather,
  period: ReturnType<typeof timeOfDay>,
  minutes: number,
): number {
  const wet = weather === 'light_rain' || weather === 'heavy_rain';
  const daylight = period === 'dawn' || period === 'late_morning' || period === 'afternoon';
  let lift = 1;

  if (entry.group === 'Bird' && (period === 'dawn' || period === 'late_morning')) lift *= 1.7;
  if (entry.group === 'Mammal' && (period === 'dusk' || period === 'night')) lift *= 1.8;
  if (entry.group === 'Fungi' && wet) lift *= 1.8;
  if ((entry.group === 'Plant' || entry.group === 'Invertebrate') && daylight && weather === 'dry_sunny') lift *= 1.7;
  if (entry.group === 'Bird' && weather === 'snow_frost_ice') lift *= 1.6;
  if (minutes < 20 && (entry.group === 'Bird' || entry.group === 'Plant')) lift *= 1.35;
  if (minutes >= 90 && (entry.group === 'Mammal' || entry.group === 'Fungi' || entry.group === 'Invertebrate')) lift *= 1.35;

  const anchorWords = anchor.habitat.toLocaleLowerCase().match(/[a-z]{4,}/g) ?? [];
  const habitatWords = entry.habitats.flatMap((habitat) => habitat.toLocaleLowerCase().match(/[a-z]{4,}/g) ?? []);
  const overlap = new Set(anchorWords.filter((word) => habitatWords.includes(word))).size;
  return lift * (1 + Math.min(0.3, overlap * 0.1));
}

export function safetyMessage(
  weather: Weather,
  location: Coordinates,
  when: Date,
  totalMinutes: number,
  language: Language,
  hazards: SafetyHazards = {},
): string | null {
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
  if (weather === 'thunderstorm' || hazards.thunderstorm) return labels.storm;
  if (weather === 'snow_frost_ice' || hazards.icy) return labels.ice;
  let nightMinutes = 0;
  const totalMs = Math.max(0, Math.min(360, totalMinutes)) * 60_000;
  for (let elapsed = 0; elapsed < totalMs; elapsed += 60 * 60_000) {
    const intervalMinutes = Math.min(60, (totalMs - elapsed) / 60_000);
    if (timeOfDay(new Date(when.getTime() + elapsed), location) === 'night') nightMinutes += intervalMinutes;
  }
  if (totalMinutes > 0 && nightMinutes / totalMinutes > 0.5) return labels.night;
  if (hazards.heat) return labels.heat;
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
  hazards: SafetyHazards = {},
  freshness = 'Seasonal starter guide · illustrative, not live sighting data',
  catalog: MissionCatalog = { anchors, species },
): Mission {
  const icy = weather === 'snow_frost_ice' || hazards.icy;
  const budget = missionBudget(totalMinutes, icy ? walkFraction * 0.5 : walkFraction, pace);
  const rankedAnchors = catalog.anchors
    .map((anchor) => ({ anchor, distanceKm: haversineKm(location, anchor) }))
    .sort((a, b) => a.distanceKm - b.distanceKm);
  const eligible = rankedAnchors.filter(({ anchor, distanceKm }) =>
    anchor.access === 'public' &&
    distanceKm <= budget.radiusKm &&
    estimateRoundTripWalkMinutes(distanceKm, pace) <= budget.walkMinutes,
  );
  const nightShare = Array.from({ length: Math.ceil(budget.total / 60) }, (_, hour) => {
    const part = Math.min(60, budget.total - hour * 60);
    return timeOfDay(new Date(when.getTime() + hour * 60 * 60_000), location) === 'night' ? part : 0;
  }).reduce((sum, value) => sum + value, 0) / Math.max(budget.total, 1);
  const safetyEligible = weather === 'thunderstorm' || hazards.thunderstorm
    ? eligible.filter(({ anchor }) => anchor.id === 'street-trees')
    : icy
      ? eligible.filter(({ anchor }) => anchor.lit)
      : hazards.heat
        ? eligible.filter(({ anchor }) => anchor.id === 'tiergarten' || anchor.id === 'spree')
      : eligible;
  const safeForNight = nightShare > 0.5
    ? safetyEligible.filter(({ anchor }) => anchor.lit && !anchor.habitat.includes('woodland'))
    : safetyEligible;
  const chooseReachable = (items: typeof rankedAnchors) => [...items].sort((a, b) => b.distanceKm - a.distanceKm);
  const chosen = chooseReachable(safeForNight);
  const anchor = chosen[0]?.anchor ?? {
    id: 'nearby-start',
    name: { en: 'Nature near your start', de: 'Natur am Startgebiet', fr: 'Nature près du départ' }[language],
    lat: location.lat,
    lng: location.lng,
    habitat: 'no destination fits this outing; notice nature from the starting area',
    lit: false,
    access: 'starting-area',
  };
  const distanceKm = haversineKm(location, anchor);
  const walkMinutes = estimateRoundTripWalkMinutes(distanceKm, pace);
  const spatialPoint = catalog.speciesLocation === 'destination' ? anchor : location;
  const month = when.getMonth() + 1;
  const season = month >= 3 && month <= 5
    ? 'spring'
    : month >= 6 && month <= 8
      ? 'summer'
      : month >= 9 && month <= 11
        ? 'autumn'
        : 'winter';

  const spatialRate = (entry: Species, point: Coordinates): number => {
    const exactRate = [8, 7, 6, 5].map((resolution) =>
      entry.cell_rates?.[latLngToCell(point.lat, point.lng, resolution)]?.rate,
    ).find((rate) => rate !== undefined);
    if (exactRate !== undefined) return exactRate;
    const parentRate = Object.entries(entry.cell_rates ?? {})
      .find(([cell]) => getResolution(cell) >= 7 && cellToParent(cell, 7) === cellToParent(
        latLngToCell(point.lat, point.lng, 8),
        7,
      ))?.[1].parent_rate;
    return parentRate ?? entry.baseline_rate ?? 1;
  };
  const hourPeriod = timeOfDay(when, location);
  const hasReleaseSignals = Boolean(catalog.builtAt || catalog.species.some((entry) =>
    entry.cell_rates || entry.time_lifts || entry.weather_lifts,
  ));
  const nearbyEvidenceCell = anchor.id === 'nearby-start' && catalog.speciesLocation === 'both'
    ? latLngToCell(location.lat, location.lng, 6)
    : null;
  const eligibleSpecies = catalog.species
    .map((entry) => {
      const namedMonth = new Intl.DateTimeFormat('en', { month: 'long' })
        .format(new Date(2024, month - 1, 1)).toLocaleLowerCase('en');
      const seasonalLift = entry.month_lifts?.[namedMonth] ?? monthLift(month, entry.months);
      const placeLift = catalog.speciesLocation === 'both'
        ? Math.sqrt(spatialRate(entry, location) * spatialRate(entry, anchor))
        : spatialRate(entry, spatialPoint);
      const timeLift = entry.time_lifts?.[hourPeriod]?.lift ?? 1;
      const weatherLift = entry.weather_lifts?.[weather]?.lift ?? 1;
      const illustrativeLift = hasReleaseSignals ? 1 : illustrativeContextLift(entry, anchor, weather, hourPeriod, budget.total);
      return { entry, lift: placeLift * seasonalLift * timeLift * weatherLift * illustrativeLift };
    })
    .filter(({ entry }) =>
      nearbyEvidenceCell === null || Boolean(entry.cell_rates?.[nearbyEvidenceCell]?.support),
    )
    .sort((a, b) => b.lift - a.lift || a.entry.id.localeCompare(b.entry.id));
  const groupBalanced: Species[] = [];
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
    distanceKm,
    bearing,
    walkMinutes,
    observeMinutes: Math.max(0, budget.total - walkMinutes),
    stops: [anchor],
    targets: groupBalanced,
    gems,
    safety: safetyMessage(weather, location, when, budget.total, language, hazards),
    context: weather,
    // Computed locally for coarse backoff; never persisted or sent over the network.
    h3Cell: latLngToCell(location.lat, location.lng, 8),
    nearbyEvidenceCell,
    freshness,
    dataBuiltAt: catalog.builtAt ?? null,
    season,
    timeBudgetMinutes: budget.total,
  };
}

export function formatDistance(km: number, language: Language) {
  const meters = Math.round(km * 1000);
  if (language === 'de') return meters < 1000 ? `${meters} m` : `${(km).toFixed(1).replace('.', ',')} km`;
  if (language === 'fr') return meters < 1000 ? `${meters} m` : `${km.toFixed(1).replace('.', ',')} km`;
  return meters < 1000 ? `${meters} m` : `${km.toFixed(1)} km`;
}
