import unittest

from effort import cell_rates, shrunk_lifts


class EffortTests(unittest.TestCase):
    def test_uniform_species_share_has_same_rate_with_hundredfold_effort(self):
        rates = cell_rates(
            {"quiet": 1, "busy": 100},
            {"quiet": 10, "busy": 1000},
            {"quiet": 0.1, "busy": 0.1},
        )
        self.assertAlmostEqual(rates["quiet"]["rate"], rates["busy"]["rate"])

    def test_sparse_temporal_bucket_is_shrunk_towards_effort(self):
        lifts = shrunk_lifts({"night": 1, "day": 9}, {"night": 10, "day": 90})
        self.assertAlmostEqual(lifts["night"]["lift"], 1.0)
        self.assertTrue(lifts["night"]["low_confidence"])

    def test_zero_effort_returns_no_rates(self):
        self.assertEqual(shrunk_lifts({"day": 2}, {"day": 0}), {})

    def test_negative_counts_are_rejected(self):
        with self.assertRaises(ValueError):
            cell_rates({"park": -1}, {"park": 10}, {"park": 0.1})


if __name__ == "__main__":
    unittest.main()
