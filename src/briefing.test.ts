import { describe, expect, it } from 'vitest';
import { buildMission } from './engine';
import { llmMissionPayload, substituteBriefing, templateBriefing, validateBriefing } from './briefing';

const mission = buildMission({ lat: 52.52, lng: 13.405 }, 40, 'dry_sunny', new Date('2026-06-15T12:00:00+02:00'));

describe('template and local model briefing guard', () => {
  it('creates a translated template with the phone-away reminder', () => {
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

  it('sends only non-location mission fields to the model', () => {
    const payload = llmMissionPayload(mission);
    expect(payload).not.toContain(mission.h3Cell);
    expect(payload).not.toContain(String(mission.anchor.lat));
    expect(payload).not.toContain('Great tit');
    expect(payload).toContain('{{dist}}');
  });

  it('accepts known placeholders and substitutes them only in the app', () => {
    const target = mission.targets[0];
    const text = `Look softly for {{species:${target.id}}} on the way {{dist}} {{dir}}. Walk about {{walk_min}} minutes. Put your phone away and notice the world around you.`;
    expect(validateBriefing(text, mission)).toBe(true);
    expect(substituteBriefing(text, mission, '300 m', 'NE')).toContain(target.names.en);
  });

  it('rejects invented names, numbers, unknown placeholders, and long output', () => {
    const target = mission.targets[0];
    const good = `Look for {{species:${target.id}}} {{dist}} {{dir}} {{walk_min}}. Put your phone away and notice the world around you.`;
    expect(validateBriefing(good.replace('Look for', 'Look for Great tit'), mission)).toBe(false);
    expect(validateBriefing(good.replace('Look for', 'Look for 42'), mission)).toBe(false);
    expect(validateBriefing(good.replace('{{dir}}', '{{location}}'), mission)).toBe(false);
    expect(validateBriefing(`${good} ${'word '.repeat(130)}`, mission)).toBe(false);
  });
});
