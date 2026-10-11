import { describe, expect, it } from 'vitest';
import { latLngToCell } from 'h3-js';
import { bearingDegrees, buildMission, cardinalDirection, estimateRoundTripWalkMinutes, haversineKm, missionBudget, monthLift, safetyMessage, timeOfDay } from './engine';
import { anchors, pickerCells, species } from './data';

describe('mission planning helpers', () => {
  it('clamps outing length and calculates doorstep, destination, and multi-stop tiers', () => {
    expect(missionBudget(10).tier).toBe('doorstep');
    expect(missionBudget(40).tier).toBe('destination');
    expect(missionBudget(240).tier).toBe('multi-stop');
    expect(missionBudget(500).total).toBe(360);
    expect(missionBudget(40).observeMinutes).toBeGreaterThanOrEqual(10);
  });

  it('budgets one-way distance, round-trip walking, and noticing within the selected duration', () => {
    const budget = missionBudget(40, 0.8);
    const location = { lat: 52.52, lng: 13.405 };
    const mission = buildMission(
      location,
      40,
      'dry_sunny',
      new Date('2026-06-21T12:00:00Z'),
      0.8,
      75,
    );

    expect(estimateRoundTripWalkMinutes(0.422, 75)).toBe(16);
    expect(budget.walkMinutes + budget.observeMinutes).toBe(budget.total);
    expect(mission.walkMinutes + mission.observeMinutes).toBe(40);
    expect(mission.walkMinutes).toBeLessThanOrEqual(budget.walkMinutes);
    expect(mission.stops).toHaveLength(1);
    expect(estimateRoundTripWalkMinutes(mission.distanceKm, 75)).toBe(mission.walkMinutes);
  });

  it('stays at the starting area when no curated destination fits the round-trip time budget', () => {
    const location = { lat: 52.52, lng: 13.405 };
    const mission = buildMission(
      location,
      5,
      'dry_sunny',
      new Date('2026-06-21T12:00:00Z'),
      0.6,
      75,
    );

    expect(mission.anchor.id).toBe('nearby-start');
    expect(mission.distanceKm).toBe(0);
    expect(mission.walkMinutes).toBe(0);
    expect(mission.observeMinutes).toBe(5);
  });

  it('only suggests nearby pilot species with records in the selected coarse grid cell', () => {
    const location = { lat: 52.52, lng: 13.405 };
    const nearbyCell = latLngToCell(location.lat, location.lng, 6);
    const elsewhereCell = latLngToCell(52.61, 13.55, 6);
    const [observedHere, observedElsewhere] = species.slice(0, 2).map((item, index) => ({
      ...item,
      month_lifts: { june: 1 },
      cell_rates: {
        [index === 0 ? nearbyCell : elsewhereCell]: {
          rate: 0.5,
          support: 7,
          effort: 30,
          low_effort: true,
          parent_rate: 0.1,
        },
      },
      baseline_rate: 0.1,
      observation_count: 30,
      distinct_years: 3,
    }));
    const mission = buildMission(
      location,
      5,
      'dry_sunny',
      new Date('2026-06-21T12:00:00Z'),
      0.6,
      75,
      'en',
      {},
      'Observational pilot',
      { anchors: [], species: [observedHere, observedElsewhere], speciesLocation: 'both' },
    );

    expect(mission.nearbyEvidenceCell).toBe(nearbyCell);
    expect(mission.targets.map(({ id }) => id)).toContain(observedHere.id);
    expect(mission.targets.map(({ id }) => id)).not.toContain(observedElsewhere.id);
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
    expect(night.stops.every((anchor) =>
      anchor.id === 'nearby-start' || (anchor.lit && !anchor.habitat.includes('woodland')),
    )).toBe(true);
  });

  it('finds a real destination from nearly every preset area at the default outing length', () => {
    const afternoon = new Date('2026-06-21T12:00:00Z');
    const withDestination = pickerCells.filter((cell) =>
      buildMission(cell, 40, 'dry_sunny', afternoon).anchor.id !== 'nearby-start',
    );
    expect(withDestination.length).toBeGreaterThanOrEqual(pickerCells.length - 4);
  });

  it('keeps demo destinations within the total-trip budget across area, duration, time, and weather', () => {
    const berlin = { lat: 52.52, lng: 13.405 };
    const afternoon = new Date('2026-06-21T12:00:00Z');
    const shortSunny = buildMission(berlin, 10, 'dry_sunny', afternoon);
    const longSunny = buildMission(berlin, 240, 'dry_sunny', afternoon);
    const rainy = buildMission(berlin, 40, 'heavy_rain', afternoon);
    const dawn = buildMission(berlin, 40, 'dry_sunny', new Date('2026-12-20T08:15:00+01:00'));
    const west = buildMission({ lat: 52.515, lng: 13.30 }, 40, 'dry_sunny', afternoon);
    const east = buildMission({ lat: 52.515, lng: 13.49 }, 40, 'dry_sunny', afternoon);

    expect(shortSunny.anchor.id).not.toBe(longSunny.anchor.id);
    expect(shortSunny.targets.map((item) => item.id)).not.toEqual(rainy.targets.map((item) => item.id));
    expect(shortSunny.targets.map((item) => item.id)).not.toEqual(dawn.targets.map((item) => item.id));
    expect(west.anchor.lng).not.toBe(east.anchor.lng);
    expect(west.anchor.access).toBe('public');
    expect(east.anchor.access).toBe('public');
    expect(west.walkMinutes).toBeLessThanOrEqual(west.timeBudgetMinutes * 0.6);
    expect(east.walkMinutes).toBeLessThanOrEqual(east.timeBudgetMinutes * 0.6);
    expect(west.targets).toHaveLength(3);
    expect(east.targets).toHaveLength(3);
  });

  it('uses validated local likelihoods and seasonal, time, and weather lifts when supplied', () => {
    const location = { lat: 52.52, lng: 13.405 };
    const locationCell = latLngToCell(location.lat, location.lng, 8);
    const cellRate = { rate: 0.1, support: 10, effort: 100, low_effort: false, parent_rate: 0.01 };
    const catalogSpecies = species.slice(0, 2).map((item, index) => ({
      ...item,
      month_lifts: { june: 1 },
      time_lifts: { afternoon: { lift: 1 } },
      weather_lifts: { dry_sunny: { lift: 1 } },
      cell_rates: { [locationCell]: { ...cellRate, rate: index === 0 ? 0.001 : 0.5 } },
      baseline_rate: 0.01,
    }));
    const backedMission = buildMission(
      location,
      40,
      'dry_sunny',
      new Date('2026-06-15T12:00:00+02:00'),
      0.6,
      75,
      'en',
      {},
      'Forecast live',
      { anchors, species: catalogSpecies, builtAt: '2026-06-15T00:00:00.000Z' },
    );
    expect(backedMission.targets[0].id).toBe(catalogSpecies[1].id);
    expect(backedMission.dataBuiltAt).toBe('2026-06-15T00:00:00.000Z');
  });

  it('uses coarse observational pilot cells without inventing weather or time lifts', () => {
    const location = { lat: 52.52, lng: 13.405 };
    const cell = latLngToCell(location.lat, location.lng, 6);
    const candidates = species.slice(0, 2).map((item, index) => ({
      ...item,
      month_lifts: { june: 1 },
      cell_rates: {
        [cell]: { rate: index === 0 ? 0.2 : 0.01, support: 30, effort: 200, low_effort: false, parent_rate: 0.2 },
      },
      baseline_rate: 0.01,
      observation_count: 30,
      distinct_years: 3,
    }));
    const mission = buildMission(
      location,
      40,
      'heavy_rain',
      new Date('2026-06-15T12:00:00+02:00'),
      0.6,
      75,
      'en',
      {},
      'Observational pilot · not a probability',
      { anchors, species: candidates, builtAt: '2026-06-15T00:00:00.000Z' },
    );
    expect(mission.targets[0].id).toBe(candidates[0].id);
  });

  it('ranks observational pilot taxa at the reachable destination chosen for the outing length', () => {
    const location = { lat: 52.52, lng: 13.405 };
    const near = { ...anchors[0], lat: 52.5205, lng: 13.405, cell: 'near' };
    const far = { ...anchors[1], lat: 52.4857, lng: 13.4157, cell: 'far' };
    const nearCell = latLngToCell(near.lat, near.lng, 6);
    const farCell = latLngToCell(far.lat, far.lng, 6);
    const candidates = species.slice(0, 2).map((item, index) => ({
      ...item,
      month_lifts: { june: 1 },
      cell_rates: {
        [nearCell]: { rate: index === 0 ? 0.5 : 0.01, support: 30, effort: 100, low_effort: false, parent_rate: 0.1 },
        [farCell]: { rate: index === 0 ? 0.01 : 0.5, support: 30, effort: 100, low_effort: false, parent_rate: 0.1 },
      },
      baseline_rate: 0.1,
      observation_count: 30,
      distinct_years: 3,
    }));
    const catalog = { anchors: [near, far], species: candidates, speciesLocation: 'destination' as const };
    const when = new Date('2026-06-15T12:00:00+02:00');
    const short = buildMission(location, 10, 'dry_sunny', when, 0.6, 75, 'en', {}, 'Pilot', catalog);
    const long = buildMission(location, 240, 'dry_sunny', when, 0.6, 75, 'en', {}, 'Pilot', catalog);
    expect(short.anchor.id).toBe(near.id);
    expect(long.anchor.id).toBe(far.id);
    expect(short.targets[0].id).toBe(candidates[0].id);
    expect(long.targets[0].id).toBe(candidates[1].id);
  });

  it('uses the selected Berlin area as well as the reachable destination for pilot rankings', () => {
    const central = { lat: 52.52, lng: 13.405 };
    const west = { lat: 52.515, lng: 13.30 };
    const near = { ...anchors[0], lat: 52.5205, lng: 13.405 };
    const centralCell = latLngToCell(central.lat, central.lng, 6);
    const westCell = latLngToCell(west.lat, west.lng, 6);
    const candidates = species.slice(0, 2).map((item, index) => ({
      ...item,
      month_lifts: { june: 1 },
      cell_rates: {
        [centralCell]: { rate: index === 0 ? 0.5 : 0.01, support: 30, effort: 100, low_effort: false, parent_rate: 0.1 },
        [westCell]: { rate: index === 0 ? 0.01 : 0.5, support: 30, effort: 100, low_effort: false, parent_rate: 0.1 },
      },
      baseline_rate: 0.1,
      observation_count: 30,
      distinct_years: 3,
    }));
    const catalog = { anchors: [near], species: candidates, speciesLocation: 'both' as const };
    const when = new Date('2026-06-15T12:00:00+02:00');
    const centralMission = buildMission(central, 40, 'dry_sunny', when, 0.6, 75, 'en', {}, 'Pilot', catalog);
    const westMission = buildMission(west, 40, 'dry_sunny', when, 0.6, 75, 'en', {}, 'Pilot', catalog);
    expect(centralMission.targets[0].id).toBe(candidates[0].id);
    expect(westMission.targets[0].id).toBe(candidates[1].id);
  });

  it('sends the user to the reachable place with the strongest observed species, not just the farthest', () => {
    const location = { lat: 52.52, lng: 13.405 };
    const rich = { ...anchors[0], id: 'rich', lat: 52.5225, lng: 13.405 };
    const poor = { ...anchors[1], id: 'poor', lat: 52.5265, lng: 13.405 };
    const richCell = latLngToCell(rich.lat, rich.lng, 8);
    const poorCell = latLngToCell(poor.lat, poor.lng, 8);
    const candidates = species.slice(0, 3).map((item) => ({
      ...item,
      month_lifts: { june: 1 },
      cell_rates: {
        [richCell]: { rate: 0.5, support: 30, effort: 100, low_effort: false, parent_rate: 0.1 },
        [poorCell]: { rate: 0.01, support: 30, effort: 100, low_effort: false, parent_rate: 0.1 },
      },
      baseline_rate: 0.1,
      observation_count: 30,
      distinct_years: 3,
    }));
    const catalog = { anchors: [rich, poor], species: candidates, speciesLocation: 'both' as const };
    const mission = buildMission(location, 60, 'dry_sunny', new Date('2026-06-15T12:00:00+02:00'), 0.6, 75, 'en', {}, 'Pilot', catalog);
    expect(haversineKm(location, poor)).toBeGreaterThan(haversineKm(location, rich));
    expect(mission.anchor.id).toBe('rich');
  });
});

describe('after-dark safety', () => {
  const berlin = { lat: 52.52, lng: 13.405 };
  it('warns when darkness falls during the outing, 53 min after sunset', () => {
    expect(safetyMessage('dry_overcast', berlin, new Date('2026-10-11T19:16:00+02:00'), 40, 'en')).toMatch(/after dark/);
  });
  it('does not warn in daylight', () => {
    expect(safetyMessage('dry_overcast', berlin, new Date('2026-10-11T14:00:00+02:00'), 40, 'en')).toBeNull();
  });
});
