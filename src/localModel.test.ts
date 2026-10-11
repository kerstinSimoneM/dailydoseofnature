import { afterEach, describe, expect, it, vi } from 'vitest';
import { requestModelStoragePersistence } from './localModel';

describe('local model storage persistence', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('continues when the browser declines persistent storage', async () => {
    vi.stubGlobal('navigator', {
      storage: { persist: vi.fn().mockResolvedValue(false) },
    });

    await expect(requestModelStoragePersistence()).resolves.toBe(false);
  });

  it('continues when the browser does not support persistent storage requests', async () => {
    vi.stubGlobal('navigator', { storage: {} });

    await expect(requestModelStoragePersistence()).resolves.toBe(false);
  });
});
