import { z } from 'zod';

export type Language = 'en' | 'de' | 'fr';
export type Group = 'Bird' | 'Plant' | 'Mammal' | 'Invertebrate' | 'Fungi' | 'Herpetofauna' | 'Other';

export const speciesSchema = z.object({
  id: z.string(),
  group: z.enum(['Bird', 'Plant', 'Mammal', 'Invertebrate', 'Fungi', 'Herpetofauna', 'Other']),
  emoji: z.string(),
  names: z.record(z.enum(['en', 'de', 'fr']), z.string()),
  months: z.array(z.number().int().min(1).max(12)),
  habitats: z.array(z.string()),
  fieldcraft: z.record(z.enum(['en', 'de', 'fr']), z.string()),
  month_lifts: z.record(z.string(), z.number().nonnegative()).optional(),
  time_lifts: z.record(z.string(), z.object({ lift: z.number().nonnegative() })).optional(),
  weather_lifts: z.record(z.string(), z.object({ lift: z.number().nonnegative() })).optional(),
  cell_rates: z.record(z.string(), z.object({
    rate: z.number().nonnegative(),
    support: z.number().int().nonnegative(),
    effort: z.number().int().nonnegative(),
    low_effort: z.boolean(),
    parent_rate: z.number().nonnegative(),
  })).optional(),
  baseline_rate: z.number().nonnegative().optional(),
  active_seasons: z.record(z.string(), z.boolean()).optional(),
  observation_count: z.number().int().positive().optional(),
  distinct_years: z.number().int().positive().optional(),
  scientific_name: z.string().min(1).optional(),
  common_names: z.record(z.enum(['en', 'de', 'fr']), z.string().min(1)).optional(),
  licenses: z.array(z.enum(['CC0_1_0', 'CC_BY_4_0'])).optional(),
});

export type Species = z.infer<typeof speciesSchema>;

export function speciesDisplayName(item: Species, language: Language): {
  name: string;
  commonNameLanguage: Language | null;
} {
  const directName = item.common_names?.[language];
  if (directName) return { name: directName, commonNameLanguage: language };
  for (const fallbackLanguage of ['en', 'de', 'fr'] as const) {
    const commonName = item.common_names?.[fallbackLanguage];
    if (commonName) return { name: commonName, commonNameLanguage: fallbackLanguage };
  }
  return {
    name: item.names[language] || item.names.en || item.scientific_name || item.id,
    commonNameLanguage: item.scientific_name ? null : language,
  };
}

// Hand-written demo content keeps the prototype useful offline; it is not occurrence data.
export const species: Species[] = [
  { id: 'bird-robin', group: 'Bird', emoji: '🐦', names: { en: 'European robin', de: 'Rotkehlchen', fr: 'Rougegorge familier' }, months: [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12], habitats: ['hedges', 'woodland edge'], fieldcraft: { en: 'Listen for a clear, tinkling song from a low perch.', de: 'Achte auf den klaren, perlenden Gesang von einem niedrigen Ast.', fr: 'Écoute son chant limpide depuis une branche basse.' } },
  { id: 'bird-great-tit', group: 'Bird', emoji: '🐤', names: { en: 'Great tit', de: 'Kohlmeise', fr: 'Mésange charbonnière' }, months: [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12], habitats: ['trees', 'garden edges'], fieldcraft: { en: 'Look for a yellow belly and a neat black stripe.', de: 'Halte Ausschau nach gelbem Bauch und schwarzem Streifen.', fr: 'Repère son ventre jaune et sa fine bande noire.' } },
  { id: 'bird-blackbird', group: 'Bird', emoji: '🐦‍⬛', names: { en: 'Common blackbird', de: 'Amsel', fr: 'Merle noir' }, months: [2, 3, 4, 5, 6, 7, 8, 9, 10], habitats: ['lawns', 'shrubs'], fieldcraft: { en: 'Check open lawns at the edges of shrubs.', de: 'Suche auf offenen Rasenflächen am Rand von Gebüschen.', fr: 'Observe les pelouses près des buissons.' } },
  { id: 'bird-magpie', group: 'Bird', emoji: '🐦', names: { en: 'Eurasian magpie', de: 'Elster', fr: 'Pie bavarde' }, months: [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12], habitats: ['open spaces', 'trees'], fieldcraft: { en: 'Notice the blue-green shine on the wings in good light.', de: 'Im guten Licht schimmern die Flügel blaugrün.', fr: 'À la lumière, ses ailes brillent de reflets bleu-vert.' } },
  { id: 'plant-daisy', group: 'Plant', emoji: '🌼', names: { en: 'Common daisy', de: 'Gänseblümchen', fr: 'Pâquerette' }, months: [3, 4, 5, 6, 7, 8, 9, 10], habitats: ['short grass', 'lawns'], fieldcraft: { en: 'Find a sunny patch of short grass; look close at the tiny yellow centre.', de: 'Suche sonniges, kurzes Gras und betrachte die gelbe Mitte.', fr: 'Cherche une pelouse rase et observe son petit cœur jaune.' } },
  { id: 'plant-dandelion', group: 'Plant', emoji: '🌼', names: { en: 'Dandelion', de: 'Löwenzahn', fr: 'Pissenlit' }, months: [3, 4, 5, 6, 7, 8, 9, 10], habitats: ['lawns', 'pathsides'], fieldcraft: { en: 'Compare a fresh flower with a silvery seed clock nearby.', de: 'Vergleiche eine frische Blüte mit einer silbrigen Pusteblume.', fr: 'Compare une fleur fraîche à une boule de graines argentée.' } },
  { id: 'plant-oak', group: 'Plant', emoji: '🌳', names: { en: 'English oak', de: 'Stieleiche', fr: 'Chêne pédonculé' }, months: [4, 5, 6, 7, 8, 9, 10], habitats: ['woodland', 'parks'], fieldcraft: { en: 'Spot rounded leaf lobes and look for acorns beneath the canopy.', de: 'Erkenne die rundlichen Blattlappen und suche Eicheln am Boden.', fr: 'Repère ses lobes arrondis et cherche des glands sous la cime.' } },
  { id: 'plant-horse-chestnut', group: 'Plant', emoji: '🍃', names: { en: 'Horse chestnut', de: 'Rosskastanie', fr: 'Marronnier commun' }, months: [4, 5, 6, 7, 8, 9, 10], habitats: ['avenues', 'parks'], fieldcraft: { en: 'Look for a hand-shaped leaf with five to seven leaflets.', de: 'Suche nach einem handförmigen Blatt mit fünf bis sieben Fiedern.', fr: 'Cherche une feuille en main avec cinq à sept folioles.' } },
  { id: 'mammal-squirrel', group: 'Mammal', emoji: '🐿️', names: { en: 'Red squirrel', de: 'Eichhörnchen', fr: 'Écureuil roux' }, months: [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12], habitats: ['mature trees', 'parks'], fieldcraft: { en: 'Pause quietly beneath mature trees and watch the branches.', de: 'Warte ruhig unter alten Bäumen und beobachte die Äste.', fr: 'Arrête-toi sous de grands arbres et observe les branches.' } },
  { id: 'insect-bumblebee', group: 'Invertebrate', emoji: '🐝', names: { en: 'Buff-tailed bumblebee', de: 'Erdhummel', fr: 'Bourdon terrestre' }, months: [3, 4, 5, 6, 7, 8, 9, 10], habitats: ['flowers', 'meadows'], fieldcraft: { en: 'Watch flowers from a little distance; no need to touch or follow.', de: 'Beobachte Blüten aus etwas Abstand, ohne die Tiere zu verfolgen.', fr: 'Observe les fleurs à distance, sans toucher ni suivre les insectes.' } },
  { id: 'insect-ladybird', group: 'Invertebrate', emoji: '🐞', names: { en: 'Seven-spot ladybird', de: 'Siebenpunkt-Marienkäfer', fr: 'Coccinelle à sept points' }, months: [4, 5, 6, 7, 8, 9], habitats: ['tall grass', 'shrubs'], fieldcraft: { en: 'Scan leaf tops slowly for its familiar red-and-black pattern.', de: 'Suche langsam auf Blättern nach dem roten Muster mit schwarzen Punkten.', fr: 'Balaye doucement les feuilles à la recherche de ses points noirs.' } },
  { id: 'fungus-fly-agaric', group: 'Fungi', emoji: '🍄', names: { en: 'Fly agaric', de: 'Fliegenpilz', fr: 'Amanite tue-mouches' }, months: [8, 9, 10, 11], habitats: ['woodland floor', 'birch trees'], fieldcraft: { en: 'Admire from the path: never pick or eat wild fungi.', de: 'Bewundere ihn vom Weg aus und pflücke oder esse keine Pilze.', fr: 'Admire-le depuis le sentier : ne cueille ni ne mange de champignon.' } },
];

species.forEach((item) => speciesSchema.parse(item));

export type Anchor = {
  id: string;
  name: string;
  lat: number;
  lng: number;
  habitat: string;
  lit: boolean;
  access: string;
  cell?: string;
  parent?: string;
};

export const anchors: Anchor[] = [
  { id: 'street-trees', name: 'Mitte leafy streets', lat: 52.5228, lng: 13.4092, habitat: 'sheltered street trees & planted courtyards', lit: true, access: 'public' },
  { id: 'tiergarten', name: 'Tiergarten', lat: 52.5145, lng: 13.3501, habitat: 'shaded paths & open lawns', lit: true, access: 'public' },
  { id: 'f-hain', name: 'Volkspark Friedrichshain', lat: 52.5274, lng: 13.4324, habitat: 'old trees & meadow edges', lit: true, access: 'public' },
  { id: 'treptower', name: 'Treptower Park', lat: 52.4875, lng: 13.4692, habitat: 'riverbank & open parkland', lit: true, access: 'public' },
  { id: 'hasenheide', name: 'Volkspark Hasenheide', lat: 52.4857, lng: 13.4157, habitat: 'meadows & mature trees', lit: true, access: 'public' },
  { id: 'tempelhof', name: 'Tempelhofer Feld', lat: 52.4731, lng: 13.4032, habitat: 'wide open grassland', lit: false, access: 'public' },
  { id: 'spree', name: 'Spree riverside path', lat: 52.5203, lng: 13.4062, habitat: 'riverside path & planted edges with water nearby', lit: true, access: 'public' },
];

const pickerAreaRows = [
  { y: 30, band: 'North', x: [120, 165, 210] },
  { y: 65, band: 'North-central', x: [75, 115, 155, 195, 235, 275] },
  { y: 100, band: 'Central-north', x: [62, 112, 160, 208, 267] },
  { y: 135, band: 'Central-south', x: [58, 98, 138, 178, 218, 258] },
  { y: 170, band: 'South-central', x: [80, 120, 160, 200, 240] },
  { y: 195, band: 'South', x: [140, 180, 220] },
] as const;

const pickerSectors: Record<number, readonly string[]> = {
  3: ['West-central', 'Central', 'East-central'],
  5: ['West', 'West-central', 'Central', 'East-central', 'East'],
  6: ['West', 'West-central', 'Central-west', 'Central-east', 'East-central', 'East'],
};

export const pickerCells = pickerAreaRows.flatMap((row, rowIndex) =>
  row.x.map((x, columnIndex) => ({
    id: `area-${rowIndex + 1}-${columnIndex + 1}`,
    name: `${row.band} ${pickerSectors[row.x.length][columnIndex]}`,
    lat: 52.52 - (row.y - 110) * 0.00065,
    lng: 13.405 + (x - 160) * 0.00085,
    x,
    y: row.y,
  })),
);

export const weatherOptions = [
  'dry_sunny',
  'dry_overcast',
  'light_rain',
  'heavy_rain',
  'snow_frost_ice',
  'thunderstorm',
] as const;
export type Weather = (typeof weatherOptions)[number];
