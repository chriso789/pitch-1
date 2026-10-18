"""Synthetic CPU execution: no recognition-accuracy claims."""
import hashlib
import json
import tempfile
import unittest
from pathlib import Path
from PIL import Image
from worker.training.train_detector import load_manifest, train


class DamageTrainingTests(unittest.TestCase):
    def dataset(self, root):
        (root / 'images').mkdir()
        photos = []
        for i, split in enumerate(('train', 'train', 'val', 'test')):
            file = root / 'images' / f'{i}.png'
            Image.new('RGB', (64, 64), (120+i, 140, 160)).save(file)
            photos.append({'photoId': str(i), 'propertyId': f'property-{i}', 'fileName': file.name,
                'width': 64, 'height': 64, 'sha256': hashlib.sha256(file.read_bytes()).hexdigest(),
                'status': 'approved', 'labeledBy': 'inspector-a', 'approvedBy': 'inspector-b',
                'regions': [] if i == 1 else [{'cls': 'cracked_tile', 'polygon': [{'x': .1, 'y': .1}, {'x': .5, 'y': .1}, {'x': .5, 'y': .5}, {'x': .1, 'y': .5}]}]})
        ds = {'version': 'synthetic-v1', 'classes': ['cracked_tile'], 'photos': photos,
              'split': {str(i): s for i, s in enumerate(('train', 'train', 'val', 'test'))}}
        (root / 'manifest.json').write_text(json.dumps(ds))
        return ds

    def test_cpu_train_resume_and_heldout_export(self):
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp); self.dataset(root)
            result = train(root, root/'run', size=64, smoke=True)
            self.assertEqual(result['status'], 'synthetic_software_test')
            self.assertEqual(len(result['losses']), 2)
            self.assertFalse(result['customer_deployment'])
            resumed = train(root, root/'run', resume=True, size=64, smoke=True)
            self.assertEqual(resumed['epochs'], 2)
            report = json.loads((root/'run/heldout_predictions.json').read_text())
            self.assertEqual(report['checkpoint_sha256'], resumed['checkpoint_sha256'])
            self.assertTrue(all(p['photoId'] == '3' for p in report['predictions']))

    def test_rejects_self_approval_and_property_leakage(self):
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp); ds = self.dataset(root)
            ds['photos'][0]['approvedBy'] = 'inspector-a'
            (root/'manifest.json').write_text(json.dumps(ds))
            with self.assertRaisesRegex(ValueError, 'Independent'): load_manifest(root)
            ds['photos'][0]['approvedBy'] = 'inspector-b'
            ds['photos'][3]['propertyId'] = 'property-0'
            (root/'manifest.json').write_text(json.dumps(ds))
            with self.assertRaisesRegex(ValueError, 'Property leakage'): load_manifest(root)

    def test_rejects_modified_original(self):
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp); self.dataset(root)
            (root/'images/0.png').write_bytes(b'changed')
            with self.assertRaisesRegex(ValueError, 'integrity'): load_manifest(root)


if __name__ == '__main__': unittest.main()