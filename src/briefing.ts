import { z } from 'zod';
import { speciesDisplayName, type Language, type Species } from './data';
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

export function templateBriefing(
  mission: Mission,
  language: Language,
  distance: string,
  direction: string,
): string {
  if (mission.distanceKm === 0) {
    return {
      en: `No destination fits this outing, so stay at your starting area and use all ${mission.observeMinutes} minutes to notice nature nearby. These are prompts, not guaranteed sightings. ${CONDUCT.en}`,
      de: `Für diesen Ausflug passt kein Ziel. Bleib im Startgebiet und nutze die ${mission.observeMinutes} Minuten, um die Natur in deiner Nähe zu entdecken. Die Arten sind Ideen, keine garantierten Funde. ${CONDUCT.de}`,
      fr: `Aucune destination ne convient pour cette sortie : reste dans ta zone de départ et profite des ${mission.observeMinutes} minutes pour observer la nature autour de toi. Ce sont des pistes, pas des observations garanties. ${CONDUCT.fr}`,
    }[language];
  }
  const names: string[] = mission.targets.slice(0, 2).map((entry) => speciesDisplayName(entry, language).name);
  return TEMPLATE[language](names, distance, mission.walkMinutes, direction);
}

export function llmMissionPayload(mission: Mission): string {
  const candidates = [...mission.targets, ...mission.gems];
  return JSON.stringify({
    season: mission.season,
    weather: mission.context,
    timeBudgetMinutes: mission.timeBudgetMinutes,
    noticingBudgetMinutes: mission.observeMinutes,
    habitat: mission.anchor.habitat,
    observations: candidates.map((item) => ({
      id: item.id,
      group: item.group,
      clue: item.fieldcraft.en,
    })),
  });
}

const compositionSchema = z.object({
  objective: z.string(),
  stepIds: z.array(z.string()),
});

export type ModelMissionComposition = {
  objective: string;
  steps: Species[];
  alternative: Species;
};

export function requiredObservationCount(mission: Mission): number {
  if (mission.observeMinutes <= 15) return 1;
  if (mission.observeMinutes <= 45) return 2;
  return 3;
}

export function templateMissionComposition(mission: Mission): ModelMissionComposition | null {
  if (mission.safety) return null;
  const candidates = [...mission.targets, ...mission.gems];
  if (candidates.length < 2) return null;

  const objective = mission.context === 'light_rain' || mission.context === 'heavy_rain'
    ? 'Notice how rain changes sounds and surfaces around you'
    : mission.context === 'dry_overcast'
      ? 'Look closely for quiet colours and shapes in this habitat'
      : mission.observeMinutes <= 15
        ? `Notice one small sign of ${mission.season} in this habitat`
        : mission.observeMinutes <= 45
          ? `Notice how ${mission.season} shapes this patch of nature`
          : `Compare several signs of ${mission.season} across this habitat`;
  const count = requiredObservationCount(mission);
  if (candidates.length <= count) return null;
  return {
    objective,
    steps: candidates.slice(0, count),
    alternative: candidates[count],
  };
}

export function validateModelObjective(objective: string, mission: Mission): boolean {
  const trimmed = objective.trim();
  const words = trimmed.split(/\s+/).filter(Boolean);
  if (words.length < 4 || words.length > 16) return false;
  if (!/^(?:notice|observe|compare|explore|discover|look|listen|find|trace|watch|follow|seek)\b/i.test(trimmed)) return false;
  if (/[0-9{}]|\n|[.!?].*[.!?]/.test(trimmed)) return false;
  if (/\b(?:touch|pick|collect|feed|chase|eat|climb|enter|guaranteed|must find)\b/i.test(trimmed)) return false;
  const lowerText = trimmed.toLocaleLowerCase('en');
  const candidates = [...mission.targets, ...mission.gems];
  if (candidates.some((item) =>
    [
      ...Object.values(item.names),
      ...Object.values(item.common_names ?? {}),
      item.scientific_name ?? '',
    ].some((name) => name && lowerText.includes(name.toLocaleLowerCase('en'))),
  )) return false;

  const seasonWords: SeasonWord[] = ['spring', 'summer', 'autumn', 'winter'];
  if (seasonWords.some((season) => lowerText.includes(season) && season !== mission.season)) return false;

  const habitatText = mission.anchor.habitat.toLocaleLowerCase('en');
  const locationClaims = ['forest', 'woodland', 'river', 'lake', 'pond', 'meadow', 'field', 'beach', 'ocean', 'mountain', 'garden', 'courtyard'];
  if (locationClaims.some((claim) => new RegExp(`\\b${claim}\\b`, 'i').test(lowerText) && !habitatText.includes(claim))) {
    return false;
  }

  type SeasonWord = Mission['season'];
  const clueText = candidates.map((item) => item.fieldcraft.en).join(' ').toLocaleLowerCase('en');
  const behaviorClaims = ['sound', 'hear', 'song', 'sing', 'chirp', 'nest', 'fruit', 'pollinat', 'flower', 'bloom', 'migrat', 'hibernat'];
  return !behaviorClaims.some((claim) =>
    new RegExp(`\\b${claim}\\w*\\b`, 'i').test(lowerText) &&
    !new RegExp(`\\b${claim}\\w*\\b`, 'i').test(clueText),
  );
}

export function parseModelMissionComposition(
  response: string,
  mission: Mission,
): { composition: ModelMissionComposition | null; issue: string | null } {
  const json = response.trim().replace(/^```(?:json)?\s*|\s*```$/gi, '');
  let decoded: unknown;
  try {
    decoded = JSON.parse(json);
  } catch {
    return { composition: null, issue: 'the response was not valid JSON' };
  }
  const parsed = compositionSchema.safeParse(decoded);
  if (!parsed.success) {
    const fields = typeof decoded === 'object' && decoded !== null && !Array.isArray(decoded)
      ? Object.keys(decoded).slice(0, 8).join(', ')
      : Array.isArray(decoded) ? 'a JSON array' : typeof decoded;
    return { composition: null, issue: `the response did not match the mission structure (received ${fields || 'no fields'})` };
  }

  const candidates = new Map([...mission.targets, ...mission.gems].map((item) => [item.id, item]));
  const { objective, stepIds } = parsed.data;
  if (!validateModelObjective(objective, mission)) {
    return { composition: null, issue: 'the objective was too long or included unsupported content' };
  }
  if (stepIds.length !== requiredObservationCount(mission) || new Set(stepIds).size !== stepIds.length) {
    return { composition: null, issue: 'the observation steps did not fit the time budget' };
  }
  if (stepIds.some((id) => !candidates.has(id))) {
    return { composition: null, issue: 'the response referenced an observation outside the supplied candidates' };
  }
  const steps: Species[] = [];
  for (const id of stepIds) {
    const step = candidates.get(id);
    if (!step) return { composition: null, issue: 'the response referenced an observation outside the supplied candidates' };
    steps.push(step);
  }
  const alternative = [...candidates.values()].find((candidate) => !stepIds.includes(candidate.id));
  if (!alternative) return { composition: null, issue: 'the alternative was not a supplied candidate' };
  return { composition: { objective: objective.trim(), steps, alternative }, issue: null };
}

export function modelCompositionFallback(reason: string): string {
  return `The local model ${reason}. Keep using the template note.`;
}
