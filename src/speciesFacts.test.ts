import { describe, expect, it } from 'vitest';
import pack from '../public/data/berlin-pack.json';
import speciesFacts from './speciesFacts.json';

describe('species facts', () => {
  const known = new Set((pack.species as { scientific_name?: string }[]).map((item) => item.scientific_name));

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
