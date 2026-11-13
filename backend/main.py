"""
LunarDust-X - FastAPI backend.
Endpoints: GET /  GET /health  GET /predict  GET /model-info  GET /docs (automatic)
Run from the project root:  uvicorn backend.main:app --reload
"""
import json
from pathlib import Path

import joblib
import pandas as pd
from fastapi import FastAPI, HTTPException, Query
from fastapi.middleware.cors import CORSMiddleware
from fastapi.staticfiles import StaticFiles

ROOT = Path(__file__).resolve().parent.parent
MODEL_PATH = ROOT / "ml" / "dust_model.pkl"
METRICS_PATH = ROOT / "ml" / "metrics.json"
FRONTEND_DIR = ROOT / "frontend"

app = FastAPI(title="LunarDust-X API",
              description="Educational lunar dust prediction (simulated dataset).",
              version="1.0.0")

# Allow the HTML page (opened from a file or another port) to call this API.
app.add_middleware(CORSMiddleware, allow_origins=["*"],
                   allow_methods=["*"], allow_headers=["*"])

# Load the trained model once when the server starts.
model = joblib.load(MODEL_PATH) if MODEL_PATH.exists() else None

RISK = {"Low Dust": "Low Risk", "Medium Dust": "Moderate Risk", "High Dust": "High Risk"}
EXPLAIN = {
    "Low Dust": "Slow, gentle movement lifts very little dust. Sensors and solar panels stay safe.",
    "Medium Dust": "Moderate speed or slope raises a noticeable dust cloud. Monitor panels and sensors.",
    "High Dust": "Fast movement on a steep surface throws up a lot of dust. Reduce speed to protect equipment.",
}


@app.get("/")
def welcome():
    return {"message": "Welcome to the LunarDust-X API",
            "endpoints": ["/health", "/predict?speed=5&slope=10", "/model-info", "/docs"],
            "dashboard": "/app/",
            "disclaimer": "Prototype trained on a simulated dataset, not real lunar data."}


@app.get("/health")
def health():
    return {"status": "ok", "model_loaded": model is not None}


@app.get("/predict")
def predict(speed: float = Query(..., ge=0, le=15, description="Rover speed in km/h (0-15)"),
            slope: float = Query(..., ge=0, le=30, description="Surface slope in degrees (0-30)")):
    if model is None:
        raise HTTPException(503, "Model not found. Run: python ml/train_model.py")
    # Use a DataFrame so column names match the training data.
    X = pd.DataFrame([[speed, slope]], columns=["speed", "slope"])
    level = str(model.predict(X)[0])
    probs = model.predict_proba(X)[0]
    return {"predicted_dust_level": level,
            "input_speed": speed,
            "input_slope": slope,
            "risk_category": RISK[level],
            "explanation": EXPLAIN[level],
            "probabilities": {c: round(float(p), 3) for c, p in zip(model.classes_, probs)}}


@app.get("/model-info")
def model_info():
    if not METRICS_PATH.exists():
        raise HTTPException(503, "metrics.json missing. Run: python ml/train_model.py")
    return json.loads(METRICS_PATH.read_text())


# Serve the dashboard at /app/ too (so no CORS/file:// problems).
app.mount("/app", StaticFiles(directory=FRONTEND_DIR, html=True), name="frontend")
