import unittest

from src.discount import apply_discount


class TestDiscount(unittest.TestCase):
    def test_applies_discount(self):
        self.assertEqual(apply_discount(100, 0.1), 90)


if __name__ == "__main__":
    unittest.main()
