import sys, os
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)) + '/..')
import torch
from torch.utils.data import DataLoader
from ml.dataset_v2 import RoofDatasetV2
from ml.model_v3 import RoofNetV3
from ml.loss_v2 import RoofLossV2

def train(data_dir='/mnt/documents/roof-training', epochs=80, batch_size=4, lr=2e-4, save_path='/mnt/documents/roofnet_v3.pth'):
    ds = RoofDatasetV2(data_dir)
    n_val = max(1, len(ds) // 5)
    n_train = len(ds) - n_val
    train_ds, val_ds = torch.utils.data.random_split(ds, [n_train, n_val], generator=torch.Generator().manual_seed(42))
    
    train_dl = DataLoader(train_ds, batch_size=batch_size, shuffle=True, num_workers=0)
    val_dl = DataLoader(val_ds, batch_size=batch_size, shuffle=False, num_workers=0)
    
    model = RoofNetV3()
    criterion = RoofLossV2()
    optimizer = torch.optim.AdamW(model.parameters(), lr=lr, weight_decay=1e-4)
    scheduler = torch.optim.lr_scheduler.CosineAnnealingLR(optimizer, T_max=epochs)
    
    best_val = float('inf')
    for epoch in range(1, epochs + 1):
        model.train()
        train_loss = 0
        for imgs, masks, regs in train_dl:
            seg_logits, reg_pred = model(imgs)
            loss, sl, rl = criterion(seg_logits, masks, reg_pred, regs)
            optimizer.zero_grad()
            loss.backward()
            optimizer.step()
            train_loss += loss.item()
        scheduler.step()
        
        model.eval()
        val_loss = 0
        with torch.no_grad():
            for imgs, masks, regs in val_dl:
                seg_logits, reg_pred = model(imgs)
                loss, _, _ = criterion(seg_logits, masks, reg_pred, regs)
                val_loss += loss.item()
        
        avg_t = train_loss / len(train_dl)
        avg_v = val_loss / len(val_dl)
        print(f'Epoch {epoch}/{epochs} | Train: {avg_t:.4f} | Val: {avg_v:.4f}')
        
        if avg_v < best_val:
            best_val = avg_v
            torch.save(model.state_dict(), save_path)
            print(f'  -> Saved best model (val={best_val:.4f})')
    
    print(f'Training complete. Best val loss: {best_val:.4f}')
    return model

if __name__ == '__main__':
    train()
