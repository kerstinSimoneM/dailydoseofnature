import { describe, expect, it } from 'vitest';
import { bearingDegrees, buildMission, cardinalDirection, haversineKm, missionBudget, monthLift, timeOfDay } from './engine';

describe('mission planning helpers', () => {
  it('clamps outing length and calculates doorstep, destination, and multi-stop tiers', () => {
    expect(missionBudget(10).tier).toBe('doorstep');
    expect(missionBudget(40).tier).toBe('destination');
    expect(missionBudget(240).tier).toBe('multi-stop');
    expect(missionBudget(500).total).toBe(360);
    expect(missionBudget(40).observeMinutes).toBeGreaterThanOrEqual(10);
  });

  it('smooths activity across the December/January boundary', () => {
    expect(monthLift(1, [12])).toBe(0.25);
    expect(monthLift(12, [1, 12])).toBe(0.75);
  });

  it('calculates distance and cardinal direction', () => {
    expect(haversineKm({ lat: 0, lng: 0 }, { lat: 0, lng: 1 })).toBeGreaterThan(100);
    expect(cardinalDirection(bearingDegrees({ lat: 52.52, lng: 13.4 }, { lat: 52.53, lng: 13.4 }), 'en')).toBe('N');
  });

  it('uses local sunrise and sunset for time-of-day labels', () => {
    const berlin = { lat: 52.52, lng: 13.405 };
    expect(timeOfDay(new Date('2026-12-20T08:15:00+01:00'), berlin)).toBe('dawn');
    expect(timeOfDay(new Date('2026-06-21T21:30:00+02:00'), berlin)).toBe('dusk');
  });

  it('keeps thunderstorm and mostly-night missions on the local street-tree anchor', () => {
    const berlin = { lat: 52.52, lng: 13.405 };
    const storm = buildMission(berlin, 40, 'thunderstorm', new Date('2026-06-21T15:00:00+02:00'));
    expect(storm.anchor.id).toBe('street-trees');
    expect(storm.safety).toContain('stay indoors');

    const night = buildMission(berlin, 120, 'dry_sunny', new Date('2026-12-20T18:00:00+01:00'));
    expect(night.safety).toContain('after dark');
    expect(night.stops.every((anchor) => anchor.lit && !anchor.habitat.includes('woodland'))).toBe(true);
  });
});
