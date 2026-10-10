import unittest

from weather import weather_bucket


def classify(**overrides):
    conditions = {
        "temperature_c": 12,
        "precipitation_mm": 0,
        "snowfall_mm": 0,
        "weather_code": 0,
        "cloud_cover_pct": 15,
    }
    conditions.update(overrides)
    return weather_bucket(**conditions)


class WeatherTests(unittest.TestCase):
    def test_precipitation_boundaries(self):
        self.assertEqual(classify(precipitation_mm=0.099), "dry_sunny")
        self.assertEqual(classify(precipitation_mm=0.1), "light_rain")
        self.assertEqual(classify(precipitation_mm=2.499), "light_rain")
        self.assertEqual(classify(precipitation_mm=2.5), "heavy_rain")

    def test_snow_temperature_and_code_precede_rain(self):
        self.assertEqual(classify(temperature_c=0, precipitation_mm=5), "snow_frost_ice")
        self.assertEqual(classify(weather_code=56, precipitation_mm=5), "snow_frost_ice")
        self.assertEqual(classify(snowfall_mm=0.01, precipitation_mm=0.1), "snow_frost_ice")

    def test_rain_codes_and_overcast(self):
        self.assertEqual(classify(weather_code=95), "heavy_rain")
        self.assertEqual(classify(weather_code=51), "light_rain")
        self.assertEqual(classify(weather_code=45), "dry_overcast")
        self.assertEqual(classify(cloud_cover_pct=60), "dry_overcast")

    def test_clear_weather_is_dry_sunny(self):
        self.assertEqual(classify(cloud_cover_pct=59.9), "dry_sunny")


if __name__ == "__main__":
    unittest.main()
