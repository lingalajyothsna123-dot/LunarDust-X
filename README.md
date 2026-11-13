# LunarDust-X – Intelligent Lunar Dust Prediction and Monitoring System

> **Educational prototype.** The model is trained on a **simulated** dataset. It is NOT based on real NASA or lunar mission measurements.

## Abstract
Lunar dust is fine, sharp and electrostatically charged. When a rover moves, it lifts dust that can cover solar panels and disturb sensors. LunarDust-X is a machine learning web application that predicts a rover's likely dust level (Low, Medium or High) from two inputs: rover speed and surface slope. A Decision Tree Classifier is trained on a simulated dataset, served through a FastAPI backend, and shown on a responsive space-themed dashboard with charts and a particle visualization.

## Problem Statement
Rover movement can raise dust that harms equipment. Operators need a quick, understandable way to estimate dust risk from basic movement conditions.

## Objectives
- Build a classifier predicting Low / Medium / High dust from speed and slope.
- Expose the model through a validated REST API.
- Present results on an interactive, responsive dashboard.
- Report honest model evaluation (accuracy, confusion matrix) and limitations.

## Existing System
Dust effects are usually studied through physical experiments and mission reports, then handled with manual rules of thumb. There is no simple interactive tool for quick estimation by students or beginners.

## Proposed System
A lightweight ML pipeline plus web dashboard: the user enters speed and slope, the API loads the trained model, predicts, and the dashboard shows the result, risk level, probabilities and history.

## Technologies Used
Python, Pandas, NumPy, Scikit-learn (Decision Tree), Joblib, FastAPI, Uvicorn, HTML, CSS, JavaScript, Chart.js.

## System Architecture
```
 +-----------------+   HTTP GET /predict    +---------------------+   loads   +-----------------+
 |  Browser (UI)   | ---------------------> |  FastAPI + Uvicorn  | --------> | dust_model.pkl  |
 | HTML/CSS/JS     | <--------------------- |  backend/main.py    | <-------- | (Decision Tree) |
 | Chart.js        |   JSON response        +---------------------+  predict  +-----------------+
 +-----------------+                                                                  ^
                                                                                      | created by
                                                                          ml/train_model.py + dataset.csv
```

## Data Flow Diagram
```
User -> [enter speed, slope] -> [Validate in browser] -> [GET /predict]
     -> [Validate in API (ranges)] -> [Build DataFrame] -> [model.predict]
     -> [JSON: level, risk, explanation, probabilities]
     -> [Update result card, risk badge, charts, history, particle animation]
```

## Module Descriptions
| Module | File | Purpose |
|---|---|---|
| Dataset & training | `ml/train_model.py` | Generates simulated data, trains, evaluates, saves model |
| Dataset | `ml/dataset.csv` | 1000 simulated records |
| Model | `ml/dust_model.pkl` | Saved Decision Tree |
| Metrics | `ml/metrics.json` | Accuracy, confusion matrix, feature importance |
| Backend | `backend/main.py` | API endpoints, validation, model loading |
| Frontend | `frontend/*` | Dashboard, API calls, charts |

## Machine Learning Workflow
1. Generate data with `numpy` random seed 42.
2. 80/20 stratified train/test split (`random_state=42`).
3. Train `DecisionTreeClassifier(max_depth=5)`.
4. Evaluate with accuracy, confusion matrix, precision/recall.
5. Save with `joblib`; serve through the API.

## Dataset Description
1000 rows, columns: `speed` (0–15 km/h), `slope` (0–30°), `dust_level` (Low/Medium/High).
Label rule: `score = 0.6*(speed/15) + 0.4*(slope/30) + noise(0, 0.05)`; score < 0.33 → Low, < 0.60 → Medium, otherwise High.
Typical result: about 87% test accuracy (see the console output after training for your exact run).

## Installation and Run (Windows 11, PowerShell, VS Code)
```powershell
# 1. Create folders (skip if you copied the project)
mkdir LunarDust-X; cd LunarDust-X
mkdir backend, frontend, ml

# 2. Create and activate a virtual environment
python -m venv venv
.\venv\Scripts\Activate.ps1
# If you see a "running scripts is disabled" error, run once:
# Set-ExecutionPolicy -Scope CurrentUser RemoteSigned

# 3. Install dependencies
pip install -r backend/requirements.txt

# 4. Train the model (creates dataset.csv, dust_model.pkl, metrics.json)
python ml/train_model.py

# 5. Start the server (from the project root)
uvicorn backend.main:app --reload
```
Then open **http://127.0.0.1:8000/app/** for the dashboard, and **http://127.0.0.1:8000/docs** for Swagger.
(You may also open `frontend/index.html` directly; it will call the server at 127.0.0.1:8000.)

Test an API call in a second PowerShell window:
```powershell
Invoke-RestMethod "http://127.0.0.1:8000/predict?speed=8&slope=15"
```

## API Details
| Endpoint | Description |
|---|---|
| `GET /` | Welcome message |
| `GET /health` | Server and model status |
| `GET /predict?speed=8&slope=15` | Prediction (speed 0–15, slope 0–30; otherwise HTTP 422) |
| `GET /model-info` | Accuracy, confusion matrix, feature importance |
| `GET /docs` | Swagger documentation |

Example response:
```json
{"predicted_dust_level":"Medium Dust","input_speed":8.0,"input_slope":15.0,
 "risk_category":"Moderate Risk","explanation":"Moderate speed or slope raises a noticeable dust cloud...",
 "probabilities":{"High Dust":0.23,"Low Dust":0.0,"Medium Dust":0.77}}
```

## Expected Output
Low speed/slope → Low Dust (green); medium values → Medium Dust (amber); high values → High Dust (red). Charts and the session history update after every prediction.

## Advantages
Simple, fast, explainable (a decision tree can be read as if-else rules), beginner friendly, fully open-source.

## Applications
Teaching ML and APIs, mission-planning demos, dust-risk awareness, prototype for future sensor-based systems.

## Limitations
- Data is simulated; the labels come from a rule I defined, so the model mostly learns that rule back.
- Only two features; real dust depends on wheel design, soil properties, gravity, charging, etc.
- Accuracy (~87%) is measured on the same simulated rule, so it says nothing about real lunar accuracy.
- Not suitable for real mission decisions.

## Future Enhancements and Scope
Use real experimental or published data, add features (soil type, wheel size, temperature), compare Random Forest/Gradient Boosting, add live sensor input, user login and database storage, cloud deployment.

## Conclusion
LunarDust-X demonstrates a complete ML application: data, model, evaluation, API and dashboard. It is a solid learning prototype and a base for future work with real data.

## 3D Moon Rover Simulation (upgrade)
Open **http://127.0.0.1:8000/app/** after starting the backend. The 3D page (`frontend/index.html`, `moon.css`, `moon.js`, Three.js) sends the rover's live speed (0-15 km/h) and the terrain slope (0-30 degrees) to `GET /predict` and shows the returned Low / Medium / High dust level. If the backend is offline the dashboard shows "NO DATA"; predictions are never faked. The original dashboard is kept at `frontend/classic.html`; the original files are in `backup_before_3d_upgrade/`.
Controls: W/S or Up/Down = drive, A/D or Left/Right = steer, Shift = boost, Space = brake, X = dust shield, P = pause, R = reset, drag = orbit camera, wheel = zoom.
