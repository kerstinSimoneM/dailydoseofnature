import { describe, expect, it } from 'vitest';
import { species } from './data';
import { loadNaturePack } from './dataPack';

function validPack() {
  const item = species[0];
  return {
    schemaVersion: 1,
    builtAt: '2026-06-15T00:00:00.000Z',
    usable: true,
    source: {
      datasetKey: '12345678-1234-4234-8234-123456789abc',
      downloadDoi: 'https://doi.org/10.1234/example',
      osmAttribution: '© OpenStreetMap contributors',
      osmLicence: 'ODbL',
      weatherSource: 'Open-Meteo fixed Berlin centre',
      weatherLicence: 'CC BY 4.0',
    },
    calibration: {
      passed: true,
      scenarios_scored: 1000,
      model_likely_hit_rate: 0.6,
      baseline_raw_cell_top3_hit_rate: 0.5,
      baseline_random_active_top3_hit_rate: 0.4,
    },
    quality: { dropped_share: 0.1 },
    anchors: [{
      id: 'osm-1',
      name: 'Example park',
      latitude: 52.52,
      longitude: 13.405,
      cell: '882a100d2dfffff',
      parent: '872a100d2ffffff',
      habitat_tags: { leisure: 'park', name: 'Example park' },
      lit: true,
      access: 'public',
    }],
    species: [{
      ...item,
      month_lifts: { june: 1 },
      time_lifts: { afternoon: { lift: 1 } },
      weather_lifts: { dry_sunny: { lift: 1 } },
      cell_rates: {
        '882a100d2dfffff': {
          rate: 0.1, support: 30, effort: 100, low_effort: false, parent_rate: 0.01,
        },
      },
      baseline_rate: 0.01,
      observation_count: 30,
      distinct_years: 3,
    }],
  };
}

describe('local Berlin data pack loader', () => {
  it('uses the starter guide when no same-origin pack has been released', async () => {
    const result = await loadNaturePack(async () => new Response('', { status: 404 }));
    expect(result).toBeNull();
    const spaFallback = await loadNaturePack(async () => new Response('<!doctype html>', {
      status: 200,
      headers: { 'content-type': 'text/html' },
    }));
    expect(spaFallback).toBeNull();
  });

  it('loads only a schema-valid, passing pack and maps its public anchors', async () => {
    const pack = validPack();
    const result = await loadNaturePack(async () => new Response(JSON.stringify(pack), { status: 200 }));
    expect(result?.builtAt).toBe(pack.builtAt);
    expect(result?.anchors[0]).toMatchObject({
      id: 'osm-1',
      name: 'Example park',
      habitat: 'park · Example park',
      access: 'public',
    });
    expect(result?.species[0].month_lifts?.june).toBe(1);
    expect(result?.evidence.type).toBe('validated-release');
  });

  it('loads an explicitly observational pilot without treating it as a calibrated release', async () => {
    const speciesPack = validPack().species;
    const pilot = {
      schemaVersion: 2,
      status: 'observational-pilot',
      builtAt: '2026-06-15T00:00:00.000Z',
      source: {
        datasetKey: '50c9509d-22c7-4a22-a47d-8c48425ef4a7',
        title: 'iNaturalist Research-grade Observations',
        doi: 'https://doi.org/10.15468/ab3s5x',
        queryUrl: 'https://api.gbif.org/v1/occurrence/search',
        observedFrom: '2023-01-01',
        observedTo: '2026-06-15',
        licenses: ['CC0_1_0', 'CC_BY_4_0'],
        gridResolution: 6,
        rawQueryCountsByYear: { '2023': 100, '2024': 100, '2025': 100 },
        acceptedRecordCount: 200,
        droppedRecordCount: 15,
        dropReasons: { uncertain_coordinates: 15 },
      },
      quality: {
        minimumTaxonRecords: 30,
        minimumDistinctCells: 5,
        minimumDistinctYears: 3,
        maximumCoordinateUncertaintyMetres: 1000,
        publishedTaxa: 1,
      },
      species: speciesPack,
    };
    const result = await loadNaturePack(async () => new Response(JSON.stringify(pilot), { status: 200 }));
    expect(result?.evidence).toMatchObject({
      type: 'observational-pilot',
      sourceTitle: 'iNaturalist Research-grade Observations',
      sourceDoi: 'https://doi.org/10.15468/ab3s5x',
      acceptedRecordCount: 200,
      publishedTaxa: 1,
    });
    expect(result?.anchors.length).toBeGreaterThan(1);
  });

  it('rejects packs whose held-out ranking does not beat both baselines', async () => {
    const pack = validPack();
    pack.calibration.model_likely_hit_rate = 0.5;
    await expect(loadNaturePack(async () => new Response(JSON.stringify(pack), { status: 200 })))
      .rejects.toThrow('did not pass both held-out ranking baselines');
  });
});
