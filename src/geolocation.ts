export type Coordinates = { lat: number; lng: number };
export type LocationFix = { coordinates: Coordinates; accuracyMeters: number };
export type LocationFailure = 'unsupported' | 'permission-denied' | 'unavailable' | 'timeout' | 'inaccurate';

export class LocationRequestError extends Error {
  constructor(readonly reason: LocationFailure) {
    super(`Could not get a usable device location: ${reason}.`);
    this.name = 'LocationRequestError';
  }
}

export const MAX_LOCATION_ACCURACY_METERS = 1_000;

type GeolocationProvider = Pick<Geolocation, 'getCurrentPosition'>;

export function requestDeviceLocation(provider: GeolocationProvider | undefined): Promise<LocationFix> {
  if (!provider) return Promise.reject(new LocationRequestError('unsupported'));

  const attempt = (options: PositionOptions): Promise<LocationFix> =>
    new Promise((resolve, reject) => {
      try {
        provider.getCurrentPosition(
          (position) => {
            const { latitude, longitude, accuracy } = position.coords;
            if (
              !Number.isFinite(latitude) || !Number.isFinite(longitude) ||
              !Number.isFinite(accuracy) || accuracy < 0 ||
              latitude < -90 || latitude > 90 || longitude < -180 || longitude > 180
            ) {
              reject(new LocationRequestError('unavailable'));
              return;
            }
            if (accuracy > MAX_LOCATION_ACCURACY_METERS) {
              reject(new LocationRequestError('inaccurate'));
              return;
            }
            resolve({ coordinates: { lat: latitude, lng: longitude }, accuracyMeters: accuracy });
          },
          (error) => {
            const reason: LocationFailure = error.code === 1
              ? 'permission-denied'
              : error.code === 3
                ? 'timeout'
                : 'unavailable';
            reject(new LocationRequestError(reason));
          },
          options,
        );
      } catch {
        reject(new LocationRequestError('unavailable'));
      }
    });

  return attempt({ enableHighAccuracy: false, timeout: 10_000, maximumAge: 60_000 }).catch((firstError: unknown) => {
    if (!(firstError instanceof LocationRequestError) || firstError.reason === 'permission-denied') {
      throw firstError;
    }
    return attempt({ enableHighAccuracy: true, timeout: 15_000, maximumAge: 0 });
  });
}
