import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import speciesFacts from './speciesFacts.json';

describe('species facts', () => {
  const pack = JSON.parse(readFileSync('public/data/berlin-pack.json', 'utf8')) as { species: { scientific_name?: string }[] };
  const known = new Set(pack.species.map((item) => item.scientific_name));

  it('only describes species that exist in the pack', () => {
    const unknown = Object.keys(speciesFacts).filter((name) => !known.has(name));
    expect(unknown).toEqual([]);
  });

  it('has a non-empty fact in every language', () => {
    for (const [name, fact] of Object.entries(speciesFacts)) {
      for (const lang of ['en', 'de', 'fr'] as const) {
        expect(fact[lang]?.trim().length, `${name} ${lang}`).toBeGreaterThan(10);
      }
    }
  });
});
