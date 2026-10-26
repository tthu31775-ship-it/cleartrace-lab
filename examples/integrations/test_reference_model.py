"""Protocol validation tests for the runnable reference adapter."""
import copy
import unittest

from reference_model import predict


def payload():
    return {"schemaVersion": "1.0", "taskId": "test-task", "modelId": "external", "accounts": [{
        "accountId": "sample-001",
        "features": {"postsCount": 8, "followersCount": 20, "followingCount": 16,
                     "accountAgeDays": 400, "duplicateRatio": 0.1, "burstRatio": 0.1,
                     "nightRatio": 0.1, "avgIntervalSeconds": 1200},
    }]}


class AdapterContractTests(unittest.TestCase):
    def test_one_result_for_each_id(self):
        body = payload()
        second = copy.deepcopy(body["accounts"][0])
        second["accountId"] = "sample-002"
        body["accounts"].append(second)
        response = predict(body)
        self.assertEqual([r["accountId"] for r in response["results"]], ["sample-001", "sample-002"])
        self.assertTrue(response["modelVersion"])
        for result in response["results"]:
            self.assertGreaterEqual(result["score"], 0)
            self.assertLessEqual(result["score"], 100)
            self.assertIsInstance(result["reasons"], list)

    def test_duplicate_account_id_rejected(self):
        body = payload()
        body["accounts"].append(copy.deepcopy(body["accounts"][0]))
        with self.assertRaises(ValueError):
            predict(body)

    def test_nonfinite_or_boolean_feature_rejected(self):
        for value in (float("nan"), float("inf"), True):
            body = payload()
            body["accounts"][0]["features"]["postsCount"] = value
            with self.assertRaises(ValueError):
                predict(body)

    def test_ratio_range_rejected(self):
        for value in (-0.1, 1.1):
            body = payload()
            body["accounts"][0]["features"]["duplicateRatio"] = value
            with self.assertRaises(ValueError):
                predict(body)

    def test_missing_required_feature_rejected(self):
        body = payload()
        del body["accounts"][0]["features"]["accountAgeDays"]
        with self.assertRaises(ValueError):
            predict(body)

    def test_version_and_empty_input_rejected(self):
        for body in ({"schemaVersion": "2.0", "accounts": []}, {"schemaVersion": "1.0", "accounts": []}):
            with self.assertRaises(ValueError):
                predict(body)

    def test_optional_graph_and_text_inputs_accepted(self):
        body = payload()
        body["accounts"][0]["relatedIds"] = ["sample-002"]
        body["accounts"][0]["textSamples"] = ["用于联调的合成文本"]
        self.assertEqual(predict(body)["results"][0]["accountId"], "sample-001")

    def test_malformed_optional_inputs_rejected(self):
        for name, value in (("relatedIds", "not-an-array"), ("textSamples", [1]),
                            ("textSamples", ["x" * 1001])):
            body = payload()
            body["accounts"][0][name] = value
            with self.assertRaises(ValueError):
                predict(body)


if __name__ == "__main__":
    unittest.main()
