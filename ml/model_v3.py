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
        
        self.seg_head = nn.Sequential(
            nn.Conv2d(2048, 512, 3, padding=1),
            nn.BatchNorm2d(512),
            nn.ReLU(inplace=True),
            nn.Conv2d(512, 128, 3, padding=1),
            nn.BatchNorm2d(128),
            nn.ReLU(inplace=True),
            nn.Conv2d(128, num_seg_classes, 1),
        )
        
        self.reg_head = nn.Sequential(
            nn.AdaptiveAvgPool2d(1),
            nn.Flatten(),
            nn.Linear(2048, 512),
            nn.ReLU(inplace=True),
            nn.Dropout(0.3),
            nn.Linear(512, 128),
            nn.ReLU(inplace=True),
            nn.Linear(128, num_reg_outputs),
        )
    
    def forward(self, x):
        features = self.encoder(x)
        seg_logits = self.seg_head(features)
        seg_logits = F.interpolate(seg_logits, size=(512, 512), mode='bilinear', align_corners=False)
        reg_out = self.reg_head(features)
        return seg_logits, reg_out
