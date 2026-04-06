import torch.nn as nn

class RoofLossV2(nn.Module):
    def __init__(self, seg_weight=1.0, reg_weight=1.2):
        super().__init__()
        self.seg_loss = nn.BCEWithLogitsLoss()
        self.reg_loss = nn.MSELoss()
        self.seg_weight = seg_weight
        self.reg_weight = reg_weight
    
    def forward(self, seg_logits, seg_targets, reg_pred, reg_targets):
        sl = self.seg_loss(seg_logits, seg_targets)
        rl = self.reg_loss(reg_pred, reg_targets)
        return self.seg_weight * sl + self.reg_weight * rl, sl.item(), rl.item()
