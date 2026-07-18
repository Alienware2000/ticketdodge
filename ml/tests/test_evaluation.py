import unittest

import numpy as np

from parking_ml.evaluation import evaluate_citation_forecast, zinb_log_probability


class CitationEvaluationTests(unittest.TestCase):
    def test_scores_a_valid_held_out_forecast(self) -> None:
        metrics = evaluate_citation_forecast(
            target=[0, 0, 1, 3, 8],
            zero_probability=[0.8, 0.8, 0.5, 0.2, 0.1],
            mean=[0.2, 0.3, 1.0, 2.5, 7.0],
            dispersion=[1.0, 1.0, 1.2, 2.0, 2.5],
        )
        self.assertEqual(metrics.cells, 5)
        self.assertGreater(metrics.negative_log_likelihood, 0)
        self.assertGreaterEqual(metrics.peak_recall, 0)
        self.assertLessEqual(metrics.peak_recall, 1)
        self.assertEqual(metrics.to_dict()["cells"], 5)

    def test_rejects_invalid_probability(self) -> None:
        with self.assertRaisesRegex(ValueError, "strictly between"):
            zinb_log_probability(np.array([0]), np.array([1.0]), np.array([1.0]), np.array([1.0]))


if __name__ == "__main__":
    unittest.main()
