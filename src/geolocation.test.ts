import { describe, expect, it, vi } from 'vitest';
import {
  LocationRequestError,
  MAX_LOCATION_ACCURACY_METERS,
  requestDeviceLocation,
} from './geolocation';

function position(latitude: number, longitude: number, accuracy: number): GeolocationPosition {
  return {
    coords: { latitude, longitude, accuracy } as GeolocationCoordinates,
    timestamp: Date.now(),
    toJSON: () => ({}),
  };
}

describe('device geolocation', () => {
  it('requests a quick cached location and accepts coarse fixes within one kilometre', async () => {
    const getCurrentPosition = vi.fn((
      success: PositionCallback,
      _failure?: PositionErrorCallback | null,
      _options?: PositionOptions,
    ) => {
      success(position(52.52, 13.405, 850));
    });
    const fix = await requestDeviceLocation({ getCurrentPosition });
    expect(fix).toEqual({
      coordinates: { lat: 52.52, lng: 13.405 },
      accuracyMeters: 850,
    });
    expect(getCurrentPosition.mock.calls[0][2]).toEqual({
      enableHighAccuracy: false,
      timeout: 10_000,
      maximumAge: 60_000,
    });
  });

  it('retries an imprecise fix with fresh high-accuracy positioning', async () => {
    let attempt = 0;
    const getCurrentPosition = vi.fn((
      success: PositionCallback,
      _failure?: PositionErrorCallback | null,
      _options?: PositionOptions,
    ) => {
      success(position(52.52, 13.405, attempt++ === 0 ? 1_200 : 35));
    });

    const fix = await requestDeviceLocation({ getCurrentPosition });

    expect(fix.accuracyMeters).toBe(35);
    expect(getCurrentPosition).toHaveBeenCalledTimes(2);
    expect(getCurrentPosition.mock.calls[1][2]).toEqual({
      enableHighAccuracy: true,
      timeout: 15_000,
      maximumAge: 0,
    });
  });

  it('retries temporary browser location failures but does not retry denied permission', async () => {
    const getCurrentPosition = vi.fn((
      _success: PositionCallback,
      failure?: PositionErrorCallback | null,
    ) => failure?.({ code: 3, message: 'timeout' } as GeolocationPositionError));
    await expect(requestDeviceLocation({ getCurrentPosition })).rejects.toMatchObject({ reason: 'timeout' });
    expect(getCurrentPosition).toHaveBeenCalledTimes(2);

    const denied = vi.fn((
      _success: PositionCallback,
      failure?: PositionErrorCallback | null,
    ) => failure?.({ code: 1, message: 'denied' } as GeolocationPositionError));
    await expect(requestDeviceLocation({ getCurrentPosition: denied })).rejects.toMatchObject({ reason: 'permission-denied' });
    expect(denied).toHaveBeenCalledTimes(1);
  });

  it('rejects fixes that are too imprecise or contain invalid coordinates', async () => {
    expect(MAX_LOCATION_ACCURACY_METERS).toBe(1_000);
    const inaccurate = requestDeviceLocation({
      getCurrentPosition: (success) => success(position(52.52, 13.405, 1_001)),
    });
    await expect(inaccurate).rejects.toMatchObject({ reason: 'inaccurate' });

    const invalid = requestDeviceLocation({
      getCurrentPosition: (success) => success(position(91, 13.405, 20)),
    });
    await expect(invalid).rejects.toMatchObject({ reason: 'unavailable' });
  });

  it('distinguishes denied permission, unavailable fixes, and timeouts', async () => {
    for (const [code, reason] of [[1, 'permission-denied'], [2, 'unavailable'], [3, 'timeout']] as const) {
      const request = requestDeviceLocation({
        getCurrentPosition: (_success, failure) => {
          failure?.({ code, message: 'browser location failure' } as GeolocationPositionError);
        },
      });
      await expect(request).rejects.toMatchObject({ reason });
    }
  });

  it('reports browsers without the geolocation API', async () => {
    await expect(requestDeviceLocation(undefined)).rejects.toBeInstanceOf(LocationRequestError);
    await expect(requestDeviceLocation(undefined)).rejects.toMatchObject({ reason: 'unsupported' });
  });
});
