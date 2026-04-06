import torch
import torch.nn as nn
import torch.nn.functional as F
from torchvision import models

class RoofNetV3(nn.Module):
    def __init__(self, num_seg_classes=4, num_reg_outputs=6):
        super().__init__()
        backbone = models.resnet50(weights=models.ResNet50_Weights.DEFAULT)
        layers = list(backbone.children())[:-2]
        self.encoder = nn.Sequential(*layers)  # Output: 2048 x 16 x 16
        
        # Matches saved checkpoint: Conv2d(2048,512,3) -> ReLU -> Conv2d(512,4,1)
        self.seg_head = nn.Sequential(
            nn.Conv2d(2048, 512, 3, padding=1),
            nn.ReLU(inplace=True),
            nn.Conv2d(512, num_seg_classes, 1),
        )
        
        # Matches saved checkpoint: Pool -> Flatten -> Linear(2048,256) -> ReLU -> Linear(256,6)
        self.reg_head = nn.Sequential(
            nn.AdaptiveAvgPool2d(1),
            nn.Flatten(),
            nn.Linear(2048, 256),
            nn.ReLU(inplace=True),
            nn.Linear(256, num_reg_outputs),
        )
    
    def forward(self, x):
        features = self.encoder(x)
        seg_logits = self.seg_head(features)
        seg_logits = F.interpolate(seg_logits, size=(512, 512), mode='bilinear', align_corners=False)
        reg_out = self.reg_head(features)
        return seg_logits, reg_out
