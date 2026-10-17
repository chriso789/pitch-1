from app.vision import detect_damage


def test_no_model_returns_no_findings(monkeypatch):
    monkeypatch.delenv("PITCH_VISION_MODEL_PATH", raising=False)
    out = detect_damage(b"not-an-image")
    assert out["status"] == "model_not_trained"
    assert out["detections"] == []


def test_untrained_classes_never_reported(monkeypatch, tmp_path):
    monkeypatch.setenv("PITCH_VISION_MODEL_PATH", str(tmp_path / "missing.onnx"))
    monkeypatch.setenv("PITCH_VISION_TRAINED_CLASSES", "")
    assert detect_damage(b"x")["detections"] == []
