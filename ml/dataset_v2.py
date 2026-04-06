import os, json
import torch
from torch.utils.data import Dataset
from torchvision import transforms
from PIL import Image
import numpy as np

CLASSES = ['ridge', 'valley', 'hip', 'eave']

class RoofDatasetV2(Dataset):
    def __init__(self, data_dir, transform=None):
        self.data_dir = data_dir
        self.img_dir = os.path.join(data_dir, 'images')
        self.mask_dir = os.path.join(data_dir, 'masks')
        with open(os.path.join(data_dir, 'labels.json')) as f:
            self.labels = json.load(f)
        self.ids = sorted(self.labels.keys())
        self.transform = transform or transforms.Compose([
            transforms.ToTensor(),
            transforms.Normalize([0.485, 0.456, 0.406], [0.229, 0.224, 0.225]),
        ])
    
    def __len__(self):
        return len(self.ids)
    
    def __getitem__(self, idx):
        sid = self.ids[idx]
        img = Image.open(os.path.join(self.img_dir, f'{sid}.png')).convert('RGB')
        img = self.transform(img)
        
        masks = []
        for cls in CLASSES:
            p = os.path.join(self.mask_dir, f'{sid}_{cls}.png')
            if os.path.exists(p):
                m = np.array(Image.open(p).convert('L'), dtype=np.float32) / 255.0
            else:
                m = np.zeros((512, 512), dtype=np.float32)
            masks.append(m)
        mask = torch.tensor(np.stack(masks))
        
        lbl = self.labels[sid]
        reg = torch.tensor([
            lbl.get('area', 0) / 1000.0,
            lbl.get('ridge', 0) / 100.0,
            lbl.get('valley', 0) / 100.0,
            lbl.get('hip', 0) / 100.0,
            lbl.get('eave', 0) / 100.0,
            lbl.get('pitch', 0),
        ], dtype=torch.float32)
        
        return img, mask, reg
