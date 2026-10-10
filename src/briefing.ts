import { speciesDisplayName, type Language } from './data';
import type { Mission } from './engine';

const CONDUCT = {
  en: 'Put your phone away and notice the world around you.',
  de: 'Steck dein Handy weg und nimm deine Umgebung wahr.',
  fr: 'Range ton téléphone et observe le monde qui t’entoure.',
} satisfies Record<Language, string>;

const TEMPLATE = {
  en: (names: string[], distance: string, walk: number, direction: string) =>
    `Take the gentler path toward ${names.join(' and ')}. It is ${distance} ${direction} in a straight line one way; allow about ${walk} minutes for the estimated round-trip walk. Let the small details come to you; no need to find everything. ${CONDUCT.en}`,
  de: (names: string[], distance: string, walk: number, direction: string) =>
    `Nimm den ruhigen Weg zu ${names.join(' und ')}. Luftlinie liegt das Ziel ${distance} ${direction} entfernt; plane etwa ${walk} Minuten für den geschätzten Hin- und Rückweg ein. Lass die kleinen Entdeckungen zu dir kommen. ${CONDUCT.de}`,
  fr: (names: string[], distance: string, walk: number, direction: string) =>
    `Prends le chemin tranquille vers ${names.join(' et ')}. C’est à ${distance} ${direction} à vol d’oiseau dans un sens ; prévois environ ${walk} minutes pour l’aller-retour estimé. Laisse les petits détails venir à toi. ${CONDUCT.fr}`,
};

const ALLOWED_PLACEHOLDERS = new Set<string>(['dist', 'walk_min', 'dir']);

export function templateBriefing(
  mission: Mission,
  language: Language,
  distance: string,
  direction: string,
): string {
  if (mission.distanceKm === 0) {
    return {
      en: `No destination fits this short outing, so stay at your starting area and use all ${mission.observeMinutes} minutes to notice nature nearby. These are prompts, not guaranteed sightings. ${CONDUCT.en}`,
      de: `Für diesen kurzen Ausflug passt kein Ziel. Bleib im Startgebiet und nutze die ${mission.observeMinutes} Minuten, um die Natur in deiner Nähe zu entdecken. Die Arten sind Ideen, keine garantierten Funde. ${CONDUCT.de}`,
      fr: `Aucune destination ne convient à cette courte sortie : reste dans ta zone de départ et profite des ${mission.observeMinutes} minutes pour observer la nature autour de toi. Ce sont des pistes, pas des observations garanties. ${CONDUCT.fr}`,
    }[language];
  }
  const names: string[] = mission.targets.slice(0, 2).map((entry) => speciesDisplayName(entry, language).name);
  return TEMPLATE[language](names, distance, mission.walkMinutes, direction);
}

export function llmMissionPayload(mission: Mission): string {
  return JSON.stringify({
    distance: '{{dist}}',
    direction: '{{dir}}',
    walkMinutes: '{{walk_min}}',
    habitat: mission.anchor.habitat,
    weather: mission.context,
    targets: mission.targets.map((item) => ({ placeholder: `{{species:${item.id}}}` })),
    gems: mission.gems.map((item) => ({ placeholder: `{{species:${item.id}}}` })),
    fieldcraft: mission.targets.map((item) => item.fieldcraft.en),
  });
}

export function validateBriefing(text: string, mission: Mission): boolean {
  if (text.trim().split(/\s+/).filter(Boolean).length > 120) return false;
  if (!/put your phone away/i.test(text)) return false;
  const withoutTokens = text.replace(/\{\{[^{}]+\}\}/g, '');
  if (/\d/.test(withoutTokens)) return false;
  if (/\{\{[^{}]*\}\}/.test(withoutTokens)) return false;
  const placeholders = text.match(/\{\{[^{}]+\}\}/g) ?? [];
  if (!placeholders.length) return false;
  for (const required of ['{{dist}}', '{{walk_min}}', '{{dir}}']) {
    if (!text.includes(required)) return false;
  }
  const knownSpecies = new Set<string>([...mission.targets, ...mission.gems].map((item) => item.id));
  for (const token of placeholders) {
    const speciesPlaceholder = /^\{\{species:([a-z0-9-]+)\}\}$/.exec(token);
    if (speciesPlaceholder) {
      if (!speciesPlaceholder[1] || !knownSpecies.has(speciesPlaceholder[1])) return false;
      continue;
    }
    const simplePlaceholder = /^\{\{([a-z_]+)\}\}$/.exec(token);
    if (!simplePlaceholder?.[1] || !ALLOWED_PLACEHOLDERS.has(simplePlaceholder[1])) return false;
  }
  if (!placeholders.some((token) => token.startsWith('{{species:'))) return false;
  const lowerText = text.toLocaleLowerCase();
  const namedSpecies = [...mission.targets, ...mission.gems].some((item) =>
    Object.values(item.names).some((name) => lowerText.includes(name.toLocaleLowerCase())),
  );
  return !namedSpecies;
}

export function substituteBriefing(
  text: string,
  mission: Mission,
  distance: string,
  direction: string,
): string {
  const speciesNames = new Map([...mission.targets, ...mission.gems].map((item) => [item.id, speciesDisplayName(item, 'en').name]));
  return text
    .replace(/\{\{species:([a-z0-9-]+)\}\}/g, (token, id: string) => speciesNames.get(id) ?? token)
    .replaceAll('{{dist}}', distance)
    .replaceAll('{{walk_min}}', String(mission.walkMinutes))
    .replaceAll('{{dir}}', direction);
}

export function conductLine(language: Language): string {
  return CONDUCT[language];
}

export function missionSpeciesIds(mission: Mission): string[] {
  return [...mission.targets, ...mission.gems].map((item) => item.id);
}
