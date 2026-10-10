import { describe, expect, it } from 'vitest';
import { latLngToCell } from 'h3-js';
import { pickerCells, species, speciesDisplayName } from './data';

describe('Berlin area picker', () => {
  it('provides 28 unique, geographically spread grid areas', () => {
    expect(pickerCells).toHaveLength(28);
    expect(new Set(pickerCells.map(({ id }) => id)).size).toBe(28);
    expect(new Set(pickerCells.map(({ name }) => name)).size).toBe(28);
    expect(new Set(pickerCells.map(({ lat, lng }) => `${lat},${lng}`)).size).toBe(28);
    expect(new Set(pickerCells.map(({ lat, lng }) => latLngToCell(lat, lng, 6))).size).toBeGreaterThan(7);
    expect(Math.min(...pickerCells.map(({ lat }) => lat))).toBeLessThan(52.48);
    expect(Math.max(...pickerCells.map(({ lat }) => lat))).toBeGreaterThan(52.55);
    expect(Math.min(...pickerCells.map(({ lng }) => lng))).toBeLessThan(13.34);
    expect(Math.max(...pickerCells.map(({ lng }) => lng))).toBeGreaterThan(13.47);
  });

  describe('speciesDisplayName', () => {
    it('prefers the selected language and identifies a fallback common name', () => {
      const item = {
        ...species[0],
        scientific_name: 'Erithacus rubecula',
        common_names: { de: 'Rotkehlchen' },
        names: {
          en: 'Erithacus rubecula',
          de: 'Rotkehlchen',
          fr: 'Erithacus rubecula',
        },
      };

      expect(speciesDisplayName(item, 'de')).toEqual({
        name: 'Rotkehlchen',
        commonNameLanguage: 'de',
      });
      expect(speciesDisplayName(item, 'en')).toEqual({
        name: 'Rotkehlchen',
        commonNameLanguage: 'de',
      });
    });

    it('uses the scientific name when no vernacular name is available', () => {
      const item = {
        ...species[0],
        scientific_name: 'Erithacus rubecula',
        names: {
          en: 'Erithacus rubecula',
          de: 'Erithacus rubecula',
          fr: 'Erithacus rubecula',
        },
      };

      expect(speciesDisplayName(item, 'en')).toEqual({
        name: 'Erithacus rubecula',
        commonNameLanguage: null,
      });
    });
  });

  it('includes a central default area that matches the selected map cell', () => {
    const defaultArea = pickerCells.find(({ id }) => id === 'area-3-3');

    expect(defaultArea?.name).toBe('Central-north Central');
    expect(defaultArea?.lat).toBeCloseTo(52.5265);
    expect(defaultArea?.lng).toBe(13.405);
  });
});
