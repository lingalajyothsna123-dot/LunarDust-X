"""
LunarDust-X - Machine Learning training script.

Steps:
 1. Generate a SIMULATED dataset (dataset.csv) using a documented rule + noise.
 2. Split into train/test sets (fixed random_state => reproducible).
 3. Train a Decision Tree Classifier.
 4. Evaluate: accuracy, confusion matrix, classification report.
 5. Save the model (dust_model.pkl) and metrics (metrics.json).

Run from the project root:   python ml/train_model.py
"""
import json
from pathlib import Path

import joblib
import numpy as np
import pandas as pd
from sklearn.metrics import accuracy_score, classification_report, confusion_matrix
from sklearn.model_selection import train_test_split
from sklearn.tree import DecisionTreeClassifier

BASE = Path(__file__).resolve().parent
SEED = 42
N_SAMPLES = 1000
LABELS = ["Low Dust", "Medium Dust", "High Dust"]   # order used everywhere


def generate_dataset(n=N_SAMPLES, seed=SEED):
    """Simulated data: faster speed and steeper slope => more dust.
    This is NOT real lunar/NASA data. Noise mimics measurement variation."""
    rng = np.random.default_rng(seed)
    speed = rng.uniform(0, 15, n).round(2)     # km/h
    slope = rng.uniform(0, 30, n).round(2)     # degrees
    score = 0.6 * (speed / 15) + 0.4 * (slope / 30) + rng.normal(0, 0.05, n)
    level = np.where(score < 0.33, 0, np.where(score < 0.60, 1, 2))
    return pd.DataFrame({"speed": speed, "slope": slope,
                         "dust_level": [LABELS[i] for i in level]})


def main():
    df = generate_dataset()
    df.to_csv(BASE / "dataset.csv", index=False)
    print("Dataset saved:", df.shape)
    print(df["dust_level"].value_counts().to_string(), "\n")

    X, y = df[["speed", "slope"]], df["dust_level"]
    X_train, X_test, y_train, y_test = train_test_split(
        X, y, test_size=0.2, random_state=SEED, stratify=y)

    # max_depth limits the tree so it does not just memorise the noise (overfitting)
    model = DecisionTreeClassifier(max_depth=5, random_state=SEED)
    model.fit(X_train, y_train)

    pred = model.predict(X_test)
    acc = accuracy_score(y_test, pred)
    cm = confusion_matrix(y_test, pred, labels=LABELS)
    print(f"Accuracy: {acc:.4f}")
    print("Confusion matrix (rows=actual, cols=predicted):\n", cm)
    print(classification_report(y_test, pred, labels=LABELS))

    joblib.dump(model, BASE / "dust_model.pkl")
    metrics = {
        "model": "DecisionTreeClassifier(max_depth=5)",
        "accuracy": round(float(acc), 4),
        "train_samples": int(len(X_train)),
        "test_samples": int(len(X_test)),
        "labels": LABELS,
        "confusion_matrix": cm.tolist(),
        "feature_importance": {f: round(float(v), 4) for f, v in
                               zip(X.columns, model.feature_importances_)},
        "note": "Trained on a simulated dataset, not real lunar measurements.",
    }
    (BASE / "metrics.json").write_text(json.dumps(metrics, indent=2))
    print("Saved dust_model.pkl and metrics.json")


if __name__ == "__main__":
    main()
