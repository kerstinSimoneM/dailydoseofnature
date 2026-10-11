import { describe, expect, it } from 'vitest';
import { buildMission } from './engine';
import {
  llmMissionPayload, parseModelMissionComposition, requiredObservationCount,
  templateBriefing, templateMissionComposition, validateModelObjective,
} from './briefing';

const mission = buildMission({ lat: 52.52, lng: 13.405 }, 40, 'dry_sunny', new Date('2026-06-15T12:00:00+02:00'));

function validResponse(forMission = mission): string {
  const candidates = [...forMission.targets, ...forMission.gems];
  return JSON.stringify({
    objective: 'Discover small signs of summer in the neighborhood',
    stepIds: candidates.slice(0, requiredObservationCount(forMission)).map(({ id }) => id),
  });
}

describe('template and local model mission composition', () => {
  it('keeps a translated ready-made briefing available for fallback', () => {
    expect(templateBriefing(mission, 'en', '300 m', 'NE')).toContain('Put your phone away');
    expect(templateBriefing(mission, 'de', '300 m', 'NO')).toContain('Steck dein Handy weg');
    expect(templateBriefing(mission, 'fr', '300 m', 'NE')).toContain('Range ton téléphone');
  });

  it('explains a nearby noticing break when no destination fits the walk budget', () => {
    const nearbyMission = buildMission(
      { lat: 52.52, lng: 13.405 },
      5,
      'dry_sunny',
      new Date('2026-06-15T12:00:00+02:00'),
    );
    expect(templateBriefing(nearbyMission, 'en', '0 m', '')).toContain('No destination fits');
    expect(templateBriefing(nearbyMission, 'de', '0 m', '')).toContain('passt kein Ziel');
    expect(templateBriefing(nearbyMission, 'fr', '0 m', '')).toContain('Aucune destination ne convient');
  });

  it('sends season, weather, time budget, coarse habitat and candidate clues without location or names', () => {
    const payload = JSON.parse(llmMissionPayload(mission)) as Record<string, unknown>;
    expect(payload).toMatchObject({
      season: 'summer',
      weather: 'dry_sunny',
      timeBudgetMinutes: 40,
      habitat: mission.anchor.habitat,
    });
    expect(payload).toHaveProperty('observations');
    expect(llmMissionPayload(mission)).not.toContain(mission.h3Cell);
    expect(llmMissionPayload(mission)).not.toContain(String(mission.anchor.lat));
    expect(llmMissionPayload(mission)).not.toContain('Great tit');
  });

  it('adapts required observation count to the noticing-time budget', () => {
    const short = buildMission({ lat: 52.52, lng: 13.405 }, 5, 'dry_sunny', new Date('2026-06-15T12:00:00+02:00'));
    const long = buildMission({ lat: 52.52, lng: 13.405 }, 240, 'light_rain', new Date('2026-10-15T12:00:00+02:00'));
    expect(requiredObservationCount(short)).toBe(1);
    expect(requiredObservationCount(mission)).toBe(2);
    expect(requiredObservationCount(long)).toBe(3);
    expect(JSON.parse(llmMissionPayload(long))).toMatchObject({ season: 'autumn', weather: 'light_rain', timeBudgetMinutes: 240 });
  });

  it('provides a handcrafted objective-and-observation baseline for comparison', () => {
    const sunny = templateMissionComposition(mission);
    const rainyMission = buildMission(
      { lat: 52.52, lng: 13.405 },
      40,
      'light_rain',
      new Date('2026-06-15T12:00:00+02:00'),
    );
    const rainy = templateMissionComposition(rainyMission);
    expect(sunny?.objective).toContain('summer');
    expect(sunny?.steps).toHaveLength(2);
    expect(sunny?.alternative.id).not.toBe(sunny?.steps[0].id);
    expect(rainy?.objective).toContain('rain');
    expect(rainy?.steps).toHaveLength(2);
  });

  it('does not compose an outdoor mission when the deterministic planner raises a safety note', () => {
    const storm = buildMission(
      { lat: 52.52, lng: 13.405 },
      40,
      'thunderstorm',
      new Date('2026-06-15T12:00:00+02:00'),
    );
    expect(storm.safety).not.toBeNull();
    expect(templateMissionComposition(storm)).toBeNull();
  });

  it('parses a grounded composition and resolves observation IDs only to supplied species', () => {
    const result = parseModelMissionComposition(validResponse(), mission);
    expect(result.issue).toBeNull();
    expect(result.composition?.steps).toHaveLength(2);
    expect(result.composition?.steps.every((step) => [...mission.targets, ...mission.gems].includes(step))).toBe(true);
    expect(result.composition?.alternative.id).not.toBe(result.composition?.steps[0].id);
  });

  it('rejects malformed structures, unsupported IDs, duplicate steps and an invalid alternative', () => {
    expect(parseModelMissionComposition('not json', mission).issue).toContain('valid JSON');
    expect(parseModelMissionComposition('{"objective":"A short objective here","stepIds":"not-an-array"}', mission).issue)
      .toContain('mission structure');
    const invalid = JSON.parse(validResponse()) as { objective: string; stepIds: string[] };
    expect(parseModelMissionComposition(JSON.stringify({ ...invalid, stepIds: ['unknown', invalid.stepIds[1]] }), mission).issue)
      .toContain('outside the supplied candidates');
    expect(parseModelMissionComposition(JSON.stringify({ ...invalid, stepIds: [invalid.stepIds[0], invalid.stepIds[0]] }), mission).issue)
      .toContain('time budget');
    const result = parseModelMissionComposition(validResponse(), mission);
    expect(result.composition?.alternative.id).not.toBe(invalid.stepIds[0]);
  });

  it('rejects objectives with unsupported claims, species names, numbers or unsafe actions', () => {
    expect(validateModelObjective('Discover small signs of summer in the neighborhood', mission)).toBe(true);
    expect(validateModelObjective(`Find a ${mission.targets[0].names.en} and follow it through the park`, mission)).toBe(false);
    expect(validateModelObjective('Collect three tiny treasures in the park', mission)).toBe(false);
    expect(validateModelObjective('Look for 3 signs of nature in this place', mission)).toBe(false);
    expect(validateModelObjective('Notice the sounds of animals in the forest', mission)).toBe(false);
    expect(validateModelObjective('Notice small details around you in spring', mission)).toBe(false);
    expect(validateModelObjective('Notice quiet details around the street trees', mission)).toBe(true);
  });

  it('rejects step counts that do not match the outing time budget', () => {
    const nearbyMission = buildMission(
      { lat: 52.52, lng: 13.405 },
      5,
      'dry_sunny',
      new Date('2026-06-15T12:00:00+02:00'),
    );
    const result = parseModelMissionComposition(validResponse(nearbyMission), nearbyMission);
    expect(result.issue).toBeNull();
    expect(result.composition?.steps).toHaveLength(1);
    expect(parseModelMissionComposition(validResponse(), nearbyMission).issue).toContain('time budget');
  });
});
