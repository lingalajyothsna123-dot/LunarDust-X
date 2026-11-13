// LunarDust-X dashboard logic: validation, API calls, charts, history, particle animation.
// When opened via http://127.0.0.1:8000/app/ the API is on the same origin;
// when opened as a plain file, fall back to the local server address.
const API = location.protocol.startsWith("http") ? location.origin : "http://127.0.0.1:8000";
const LEVELS = ["Low Dust", "Medium Dust", "High Dust"];
const COLORS = ["#34d399", "#fbbf24", "#f87171"];

const $ = (id) => document.getElementById(id);
const speedEl = $("speed"), slopeEl = $("slope"), errEl = $("error");
const history = [];
let probChart, histChart, impChart, density = 0.1;

// ---------- Charts ----------
Chart.defaults.color = "#9aa0c8";
function initCharts() {
  probChart = new Chart($("probChart"), {
    type: "doughnut",
    data: { labels: LEVELS, datasets: [{ data: [0, 0, 0], backgroundColor: COLORS, borderWidth: 0 }] },
    options: { maintainAspectRatio: false, cutout: "62%" }
  });
  histChart = new Chart($("histChart"), {
    type: "line",
    data: { labels: [], datasets: [
      { label: "Dust level (1=Low,3=High)", data: [], borderColor: "#a78bfa", backgroundColor: "#a78bfa",
        tension: .3, yAxisID: "y" },
      { label: "Speed (km/h)", data: [], borderColor: "#38bdf8", borderDash: [5, 4], tension: .3, yAxisID: "y1" }] },
    options: { maintainAspectRatio: false, scales: {
      y: { min: 0, max: 4, ticks: { stepSize: 1, callback: v => ["", "Low", "Medium", "High", ""][v] } },
      y1: { position: "right", min: 0, max: 15, grid: { drawOnChartArea: false } } } }
  });
}

// ---------- Validation ----------
function validate() {
  const speed = parseFloat(speedEl.value), slope = parseFloat(slopeEl.value);
  if (speedEl.value === "" || slopeEl.value === "") return "Please enter both speed and slope.";
  if (isNaN(speed) || isNaN(slope)) return "Values must be numbers.";
  if (speed < 0 || speed > 15) return "Speed must be between 0 and 15 km/h.";
  if (slope < 0 || slope > 30) return "Slope must be between 0 and 30 degrees.";
  return null;
}

// ---------- Predict ----------
async function predict() {
  const msg = validate();
  errEl.textContent = msg || "";
  if (msg) return;
  const speed = parseFloat(speedEl.value), slope = parseFloat(slopeEl.value);
  $("loader").classList.remove("hidden");
  $("predictBtn").disabled = true;
  try {
    const res = await fetch(`${API}/predict?speed=${speed}&slope=${slope}`);
    const data = await res.json();
    if (!res.ok) throw new Error(typeof data.detail === "string" ? data.detail : "Invalid input sent to the server.");
    showResult(data);
  } catch (e) {
    errEl.textContent = e instanceof TypeError ? "Cannot reach the server. Is uvicorn running?" : e.message;
  } finally {
    $("loader").classList.add("hidden");
    $("predictBtn").disabled = false;
  }
}

function showResult(d) {
  const idx = LEVELS.indexOf(d.predicted_dust_level);
  const cls = ["c-Low", "c-Medium", "c-High"][idx];
  $("resultBox").className = "";
  $("resultBox").innerHTML = `<div class="big ${cls}">${d.predicted_dust_level}</div>
    <div class="meta">Speed: ${d.input_speed} km/h &bull; Slope: ${d.input_slope}&deg; &bull; ${d.risk_category}</div>
    <p>${d.explanation}</p>`;
  document.querySelectorAll(".risk").forEach(r => r.classList.toggle("active", r.dataset.level === d.predicted_dust_level));
  probChart.data.datasets[0].data = LEVELS.map(l => d.probabilities[l] || 0);
  probChart.update();
  history.push({ speed: d.input_speed, slope: d.input_slope, level: d.predicted_dust_level });
  updateHistory();
  density = [0.08, 0.35, 0.8][idx];
}

function updateHistory() {
  histChart.data.labels = history.map((_, i) => "#" + (i + 1));
  histChart.data.datasets[0].data = history.map(h => LEVELS.indexOf(h.level) + 1);
  histChart.data.datasets[1].data = history.map(h => h.speed);
  histChart.update();
  $("histTable").querySelector("tbody").innerHTML = history.slice().reverse().map((h, i) =>
    `<tr><td>${history.length - i}</td><td>${h.speed}</td><td>${h.slope}</td><td>${h.level}</td></tr>`).join("");
}

function resetAll() {
  speedEl.value = slopeEl.value = ""; errEl.textContent = "";
  history.length = 0; updateHistory();
  probChart.data.datasets[0].data = [0, 0, 0]; probChart.update();
  $("resultBox").className = "placeholder";
  $("resultBox").innerHTML = "Enter values and press <b>Predict Dust Level</b>.";
  document.querySelectorAll(".risk").forEach(r => r.classList.remove("active"));
  density = 0.1;
}

// ---------- Server status + model performance ----------
async function loadServerInfo() {
  const st = $("status");
  try {
    const h = await (await fetch(`${API}/health`)).json();
    st.className = "status " + (h.model_loaded ? "ok" : "bad");
    $("statusText").textContent = h.model_loaded ? "Server online - model loaded" : "Server online - model missing (run train_model.py)";
    const m = await (await fetch(`${API}/model-info`)).json();
    $("stats").innerHTML = [[(m.accuracy * 100).toFixed(1) + "%", "Test accuracy"], [m.train_samples, "Train rows"], [m.test_samples, "Test rows"]]
      .map(([v, l]) => `<div class="stat"><b>${v}</b><span>${l}</span></div>`).join("");
    $("cmTable").innerHTML = "<tr><th></th>" + m.labels.map(l => `<th>${l.split(" ")[0]}</th>`).join("") + "</tr>" +
      m.confusion_matrix.map((row, i) => `<tr><th>${m.labels[i].split(" ")[0]}</th>${row.map(v => `<td>${v}</td>`).join("")}</tr>`).join("");
    impChart = new Chart($("impChart"), { type: "bar",
      data: { labels: ["Speed", "Slope"], datasets: [{ data: [m.feature_importance.speed, m.feature_importance.slope], backgroundColor: ["#7c3aed", "#2563eb"] }] },
      options: { indexAxis: "y", maintainAspectRatio: false, plugins: { legend: { display: false } } } });
  } catch (e) {
    st.className = "status bad";
    $("statusText").textContent = "Server offline - start it with uvicorn";
  }
}

// ---------- Dust particle animation ----------
function startDust() {
  const c = $("dustCanvas"), ctx = c.getContext("2d");
  const parts = Array.from({ length: 160 }, () => ({ x: Math.random(), y: Math.random(), r: Math.random() * 2 + .5, v: Math.random() * .4 + .1, a: Math.random() }));
  function resize() { c.width = c.clientWidth; c.height = 220; }
  resize(); window.addEventListener("resize", resize);
  (function loop() {
    ctx.clearRect(0, 0, c.width, c.height);
    ctx.fillStyle = "#4a4560"; ctx.beginPath();          // lunar ground
    ctx.moveTo(0, 190); ctx.quadraticCurveTo(c.width / 2, 165, c.width, 190); ctx.lineTo(c.width, 220); ctx.lineTo(0, 220); ctx.fill();
    const n = Math.floor(parts.length * density);
    for (let i = 0; i < n; i++) {
      const p = parts[i];
      p.y -= p.v / 100; p.x += (Math.random() - .5) * .002;
      if (p.y < 0.1) { p.y = .85; p.x = Math.random(); }
      ctx.fillStyle = `rgba(210,200,230,${0.25 + p.a * .5})`;
      ctx.beginPath(); ctx.arc(p.x * c.width, p.y * c.height, p.r * (1 + density), 0, 6.3); ctx.fill();
    }
    requestAnimationFrame(loop);
  })();
}

// ---------- Events ----------
$("predictBtn").addEventListener("click", predict);
$("resetBtn").addEventListener("click", resetAll);
$("sampleBtn").addEventListener("click", () => {
  speedEl.value = (Math.random() * 15).toFixed(1);
  slopeEl.value = (Math.random() * 30).toFixed(1);
  errEl.textContent = "";
});
[speedEl, slopeEl].forEach(el => el.addEventListener("keydown", e => { if (e.key === "Enter") predict(); }));

initCharts(); startDust(); loadServerInfo();
