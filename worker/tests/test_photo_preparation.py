"""Software contracts only. Synthetic images never establish roof recognition."""
import io
import os
import tempfile
import unittest
from pathlib import Path
from unittest.mock import patch
import numpy as np
from PIL import Image
from worker.training.prepare_photos import quality, tensor, polygon_from_mask, pool_embedding, model_paths, LocalProcessor


class PreparationTests(unittest.TestCase):
    def test_bad_quality_is_not_normal_or_damage(self):
        q = quality(Image.new('RGB', (256, 256)))
        self.assertFalse(q['assessable'])
        self.assertEqual(q['brightness'], 0)
        self.assertEqual(len(q['dhash']), 16)

    def test_preprocessing_matches_browser_normalization(self):
        t = tensor(Image.new('RGB', (10, 10), (255, 0, 0)), 224)
        self.assertEqual(t.shape, (1, 3, 224, 224))
        self.assertAlmostEqual(float(t[0, 0, 0, 0]), (1-.485)/.229, places=5)

    def test_invalid_small_mask_cannot_create_outline(self):
        mask = np.zeros((256, 256), dtype=np.float32)
        self.assertIsNone(polygon_from_mask(mask))
        mask[20:80, 20:80] = 1
        polygon = polygon_from_mask(mask)
        self.assertGreaterEqual(len(polygon), 3)
        emb = pool_embedding(np.ones((256, 384), dtype=np.float32), polygon)
        self.assertEqual(len(emb), 384)
        self.assertAlmostEqual(float(np.linalg.norm(emb)), 1, places=5)

    def test_models_must_be_locally_integrity_verified(self):
        with tempfile.TemporaryDirectory() as tmp, patch.dict(os.environ, {}, clear=True):
            with self.assertRaisesRegex(ValueError, 'Verified local'): model_paths(Path(tmp))

    def test_quality_failure_skips_model_execution(self):
        processor = LocalProcessor.__new__(LocalProcessor)
        processor.sessions = {}  # Would fail if unassessable images reached inference.
        image = io.BytesIO(); Image.new('RGB', (64, 64)).save(image, format='PNG')
        result = processor.prepare(image.getvalue())
        self.assertEqual(result['status'], 'unassessable')
        self.assertEqual(result['regions'], [])
        self.assertEqual(len(result['sha256']), 64)


if __name__ == '__main__': unittest.main()