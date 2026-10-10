import { z } from 'zod';
import { anchors as starterAnchors, speciesSchema, type Anchor, type Species } from './data';

const anchorSchema = z.object({
  id: z.string().min(1),
  name: z.string().min(1),
  latitude: z.number().min(-90).max(90),
  longitude: z.number().min(-180).max(180),
  cell: z.string().min(1),
  parent: z.string().min(1),
  habitat_tags: z.record(z.string(), z.string()),
  lit: z.boolean(),
  access: z.literal('public'),
});

const speciesPackSchema = speciesSchema.extend({
  month_lifts: z.record(z.string(), z.number().nonnegative()),
  time_lifts: z.record(z.string(), z.object({ lift: z.number().nonnegative() })),
  weather_lifts: z.record(z.string(), z.object({ lift: z.number().nonnegative() })),
  cell_rates: z.record(z.string(), z.object({
    rate: z.number().nonnegative(),
    support: z.number().int().nonnegative(),
    effort: z.number().int().nonnegative(),
    low_effort: z.boolean(),
    parent_rate: z.number().nonnegative(),
  })),
  baseline_rate: z.number().nonnegative(),
  observation_count: z.number().int().positive(),
  distinct_years: z.number().int().positive(),
});

const observationalSpeciesSchema = speciesPackSchema.extend({
  time_lifts: z.record(z.string(), z.object({ lift: z.number().nonnegative() })).optional(),
  weather_lifts: z.record(z.string(), z.object({ lift: z.number().nonnegative() })).optional(),
});

const releasePackSchema = z.object({
  schemaVersion: z.literal(1),
  builtAt: z.string().datetime({ offset: true }),
  usable: z.literal(true),
  source: z.object({
    datasetKey: z.string().uuid(),
    downloadDoi: z.string().url(),
    osmAttribution: z.string().min(1),
    osmLicence: z.literal('ODbL'),
    weatherSource: z.string().min(1),
    weatherLicence: z.literal('CC BY 4.0'),
  }),
  calibration: z.object({
    passed: z.literal(true),
    scenarios_scored: z.number().int().min(1000),
    model_likely_hit_rate: z.number().min(0).max(1),
    baseline_raw_cell_top3_hit_rate: z.number().min(0).max(1),
    baseline_random_active_top3_hit_rate: z.number().min(0).max(1),
  }),
  quality: z.object({ dropped_share: z.number().min(0).max(1) }),
  anchors: z.array(anchorSchema).min(1),
  species: z.array(speciesPackSchema).min(1),
});

const observationalPilotSchema = z.object({
  schemaVersion: z.literal(2),
  status: z.literal('observational-pilot'),
  builtAt: z.string().datetime({ offset: true }),
  source: z.object({
    datasetKey: z.string().uuid(),
    title: z.string().min(1),
    doi: z.string().url(),
    queryUrl: z.string().url(),
    observedFrom: z.string().date(),
    observedTo: z.string().date(),
    licenses: z.array(z.enum(['CC0_1_0', 'CC_BY_4_0'])).min(1),
    gridResolution: z.literal(6),
    rawQueryCountsByYear: z.record(z.string(), z.number().int().nonnegative()),
    acceptedRecordCount: z.number().int().positive(),
    droppedRecordCount: z.number().int().nonnegative(),
    dropReasons: z.record(z.string(), z.number().int().nonnegative()),
  }),
  quality: z.object({
    minimumTaxonRecords: z.number().int().positive(),
    minimumDistinctCells: z.number().int().positive(),
    minimumDistinctYears: z.number().int().positive(),
    maximumCoordinateUncertaintyMetres: z.number().positive(),
    publishedTaxa: z.number().int().positive(),
  }),
  species: z.array(observationalSpeciesSchema).min(1),
});

export type NaturePack = {
  builtAt: string;
  anchors: Anchor[];
  species: Species[];
  evidence: {
    type: 'observational-pilot' | 'validated-release';
    sourceTitle: string;
    sourceDoi: string;
    observedFrom?: string;
    observedTo?: string;
    acceptedRecordCount?: number;
    publishedTaxa?: number;
  };
};

export async function loadNaturePack(fetcher: typeof fetch = fetch): Promise<NaturePack | null> {
  const controller = new AbortController();
  const timeout = globalThis.setTimeout(() => controller.abort(), 8_000);
  let response: Response;
  try {
    response = await fetcher('/data/berlin-pack.json', {
      credentials: 'same-origin',
      cache: 'no-cache',
      signal: controller.signal,
    });
  } finally {
    globalThis.clearTimeout(timeout);
  }
  if (response.status === 404) return null;
  if (!response.ok) throw new Error(`The local Berlin data pack could not be loaded (${response.status}).`);
  if (response.headers.get('content-type')?.includes('text/html')) return null;
  const rawPack = await response.json();
  if (
    typeof rawPack === 'object' &&
    rawPack !== null &&
    'schemaVersion' in rawPack &&
    rawPack.schemaVersion === 2
  ) {
    const pack = observationalPilotSchema.parse(rawPack);
    return {
      builtAt: pack.builtAt,
      anchors: starterAnchors,
      species: pack.species,
      evidence: {
        type: 'observational-pilot',
        sourceTitle: pack.source.title,
        sourceDoi: pack.source.doi,
        observedFrom: pack.source.observedFrom,
        observedTo: pack.source.observedTo,
        acceptedRecordCount: pack.source.acceptedRecordCount,
        publishedTaxa: pack.quality.publishedTaxa,
      },
    };
  }
  const pack = releasePackSchema.parse(rawPack);
  if (
    pack.calibration.model_likely_hit_rate <= pack.calibration.baseline_raw_cell_top3_hit_rate ||
    pack.calibration.model_likely_hit_rate <= pack.calibration.baseline_random_active_top3_hit_rate
  ) {
    throw new Error('The Berlin data pack did not pass both held-out ranking baselines.');
  }
  const anchors: Anchor[] = pack.anchors.map((anchor) => ({
    id: anchor.id,
    name: anchor.name,
    lat: anchor.latitude,
    lng: anchor.longitude,
    habitat: Object.values(anchor.habitat_tags).filter(Boolean).join(' · ') || 'public green space',
    lit: anchor.lit,
    access: anchor.access,
    cell: anchor.cell,
    parent: anchor.parent,
  }));
  return {
    builtAt: pack.builtAt,
    anchors,
    species: pack.species,
    evidence: {
      type: 'validated-release',
      sourceTitle: 'Validated GBIF, OSM, and Open-Meteo release pack',
      sourceDoi: pack.source.downloadDoi,
    },
  };
}
