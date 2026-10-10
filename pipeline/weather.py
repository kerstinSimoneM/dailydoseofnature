"""Deterministic five-bucket weather taxonomy for pack generation."""

SNOW_CODES = {56, 57, 66, 67, 71, 73, 75, 77, 85, 86}
HEAVY_RAIN_CODES = {65, 82, 95, 96, 99}
LIGHT_RAIN_CODES = {51, 53, 55, 61, 63, 80, 81}


def weather_bucket(
    *,
    temperature_c: float,
    precipitation_mm: float,
    snowfall_mm: float,
    weather_code: int,
    cloud_cover_pct: float,
) -> str:
    """Classify nearest-hour weather, applying precedence in the specification."""
    if snowfall_mm > 0 or weather_code in SNOW_CODES or temperature_c <= 0:
        return "snow_frost_ice"
    if precipitation_mm >= 2.5 or weather_code in HEAVY_RAIN_CODES:
        return "heavy_rain"
    if precipitation_mm >= 0.1 or weather_code in LIGHT_RAIN_CODES:
        return "light_rain"
    if cloud_cover_pct >= 60 or weather_code in {45, 48}:
        return "dry_overcast"
    return "dry_sunny"
