// ---- звук
let audioCtx;
let muted = false;

function beep(durationMs = 1200, freq = 660) {
  if (muted) return;
  if (!audioCtx)
    audioCtx = new (window.AudioContext || window.webkitAudioContext)();
  const o = audioCtx.createOscillator();
  const g = audioCtx.createGain();
  o.connect(g).connect(audioCtx.destination);
  o.type = "sine";
  o.frequency.value = freq;
  g.gain.setValueAtTime(0.001, audioCtx.currentTime);
  g.gain.exponentialRampToValueAtTime(0.2, audioCtx.currentTime + 0.05);
  o.start();
  setTimeout(() => {
    g.gain.exponentialRampToValueAtTime(0.0001, audioCtx.currentTime + 0.02);
    o.stop(audioCtx.currentTime + 0.05);
  }, durationMs);
}

// ---- функція логування
function addLog(id, msg) {
  const t = new Date().toLocaleTimeString();
  const logEl = document.getElementById(`log${id}`);
  if (logEl) logEl.textContent = `[${t}] ${msg}\n` + logEl.textContent;
}

// ---- робота з усіма картами
const cards = [1, 2, 3];

const ws = new WebSocket(
  `${location.protocol === "https:" ? "wss" : "ws"}://${location.host}`
);

ws.onopen = () => {
  cards.forEach((id) => addLog(id, "🔌 Підключено до сервера"));
  ws.send(JSON.stringify({ type: "getConfigAll" }));
};

ws.onmessage = (ev) => {
  const data = JSON.parse(ev.data);

  // ---- отримали налаштування всіх карт
  if (data.type === "configAll") {
    data.cards.forEach((cfg) => {
      const id = cfg.id;
      document.getElementById(`thr${id}`).textContent = cfg.threshold;
      document.getElementById(`thresholdInput${id}`).value = cfg.threshold;
      document.getElementById(`intervalInput${id}`).value = Math.round(
        cfg.pollIntervalMs / 1000
      );
      document.getElementById(`interval${id}`).textContent = `${Math.round(
        cfg.pollIntervalMs / 1000
      )} с`;
    });
  }

  // ---- окреме оновлення метрики
  if (data.type === "metric") {
    const id = data.id;
    const valEl = document.getElementById(`val${id}`);
    const thrEl = document.getElementById(`thr${id}`);
    const v = data.value;

    thrEl.textContent = data.threshold;
    valEl.textContent = isNaN(v) ? "—" : v;
    const bad = !isNaN(v) && v < data.threshold;
    valEl.classList.toggle("bad", bad);
    valEl.classList.toggle("ok", !bad);

    document.getElementById(`status${id}`).textContent = `Оновлено: ${new Date(
      data.ts
    ).toLocaleString()}`;
  }

  // ---- попередження / повідомлення
  if (data.type === "alert") {
    addLog(data.id, `⚠️ Значення ${data.value} нижче порогу ${data.threshold}`);
    beep();
  }
  if (data.type === "error") addLog(data.id, `❌ Помилка: ${data.message}`);
  if (data.type === "info") addLog(data.id, `ℹ️ ${data.message}`);
};

ws.onclose = () => {
  cards.forEach((id) => addLog(id, "🔴 З'єднання розірвано"));
};

// ---- керування звуком
document.getElementById("mute").onclick = () => {
  muted = true;
  cards.forEach((id) => addLog(id, "🔇 Звук вимкнено"));
};
document.getElementById("unmute").onclick = () => {
  muted = false;
  cards.forEach((id) => addLog(id, "🔊 Звук увімкнено"));
};

// ---- обробка кнопок для кожної карти
cards.forEach((id) => {
  document.getElementById(`test${id}`).onclick = () => beep();
  document.getElementById(`saveThreshold${id}`).onclick = () => {
    const v = Number(document.getElementById(`thresholdInput${id}`).value);
    if (!Number.isNaN(v))
      ws.send(JSON.stringify({ type: "setThreshold", id, value: v }));
  };
  document.getElementById(`saveInterval${id}`).onclick = () => {
    const sec = Number(document.getElementById(`intervalInput${id}`).value);
    if (!Number.isNaN(sec) && sec >= 1)
      ws.send(
        JSON.stringify({ type: "setPollIntervalMs", id, value: sec * 1000 })
      );
  };
  document.getElementById(`checkNow${id}`).onclick = () =>
    ws.send(JSON.stringify({ type: "checkNow", id }));
});

// ---- антизасинання
const PING_INTERVAL_MS = 4 * 60 * 1000;
setInterval(() => {
  fetch("/ping", { cache: "no-store" })
    .then(() => console.log(`[ping] ${new Date().toLocaleTimeString()}`))
    .catch((err) => console.warn("[ping error]", err));
}, PING_INTERVAL_MS);

// перший скрипт

// ---- звук (спільний для всіх карт)
// let audioCtx;
const state = {
  1: { muted: false },
  2: { muted: false },
  3: { muted: false },
};

function beep(cardId, durationMs = 1200, freq = 660) {
  if (state[cardId].muted) return;
  if (!audioCtx)
    audioCtx = new (window.AudioContext || window.webkitAudioContext)();
  const o = audioCtx.createOscillator();
  const g = audioCtx.createGain();
  o.connect(g).connect(audioCtx.destination);
  o.type = "sine";
  o.frequency.value = freq;
  g.gain.setValueAtTime(0.001, audioCtx.currentTime);
  g.gain.exponentialRampToValueAtTime(0.2, audioCtx.currentTime + 0.05);
  o.start();
  setTimeout(() => {
    g.gain.exponentialRampToValueAtTime(0.0001, audioCtx.currentTime + 0.02);
    o.stop(audioCtx.currentTime + 0.05);
  }, durationMs);
}

// ---- функція ініціалізації карти
function initCard(cardId) {
  const valEl = document.getElementById(`val${cardId}`);
  const thrEl = document.getElementById(`thr${cardId}`);
  const intervalEl = document.getElementById(`interval${cardId}`);
  const statusEl = document.getElementById(`status${cardId}`);
  const logEl = document.getElementById(`log${cardId}`);
  const thresholdInput = document.getElementById(`thresholdInput${cardId}`);
  const intervalInput = document.getElementById(`intervalInput${cardId}`);

  function addLog(msg) {
    const t = new Date().toLocaleTimeString();
    logEl.textContent = `[${t}] ${msg}\n` + logEl.textContent;
  }

  // кнопки керування
  document.getElementById(`test${cardId}`).onclick = () => beep(cardId);
  document.getElementById(`mute${cardId}`).onclick = () => {
    state[cardId].muted = true;
    addLog("🔇 Звук вимкнено");
  };
  document.getElementById(`unmute${cardId}`).onclick = () => {
    state[cardId].muted = false;
    addLog("🔊 Звук увімкнено");
  };
  document.getElementById(`checkNow${cardId}`).onclick = () =>
    ws.send(JSON.stringify({ type: "checkNow", cardId }));

  // ---- WS для цієї карти
  const ws = new WebSocket(
    `${location.protocol === "https:" ? "wss" : "ws"}://${
      location.host
    }?card=${cardId}`
  );

  ws.onopen = () => {
    statusEl.textContent = "Підключено до сервера";
    ws.send(JSON.stringify({ type: "getConfig", cardId }));
  };

  ws.onmessage = (ev) => {
    const data = JSON.parse(ev.data);

    if (data.type === "config") {
      if (typeof data.threshold === "number") {
        thrEl.textContent = data.threshold;
        thresholdInput.value = data.threshold;
      }
      if (typeof data.pollIntervalMs === "number") {
        intervalEl.textContent = `${Math.round(data.pollIntervalMs / 1000)} с`;
        intervalInput.value = Math.round(data.pollIntervalMs / 1000);
      }
    }

    if (data.type === "metric") {
      const v = data.value;
      thrEl.textContent = data.threshold;
      valEl.textContent = isNaN(v) ? "—" : v;
      const bad = !isNaN(v) && v < data.threshold;
      valEl.classList.toggle("bad", bad);
      valEl.classList.toggle("ok", !bad);
      statusEl.textContent = `Оновлено: ${new Date(data.ts).toLocaleString()}`;
    }

    if (data.type === "alert") {
      addLog(`⚠️ Значення ${data.value} нижче порогу ${data.threshold}`);
      beep(cardId);
    }

    if (data.type === "error") addLog(`❌ Помилка: ${data.message}`);
    if (data.type === "info") addLog(`ℹ️ ${data.message}`);
  };

  ws.onclose = () => {
    statusEl.textContent = "З'єднання розірвано";
  };

  // ---- Керування порогом / інтервалом
  document.getElementById(`saveThreshold${cardId}`).onclick = () => {
    const v = Number(thresholdInput.value);
    if (!Number.isNaN(v))
      ws.send(JSON.stringify({ type: "setThreshold", value: v, cardId }));
  };
  document.getElementById(`saveInterval${cardId}`).onclick = () => {
    const sec = Number(intervalInput.value);
    if (!Number.isNaN(sec) && sec >= 1) {
      ws.send(
        JSON.stringify({ type: "setPollIntervalMs", value: sec * 1000, cardId })
      );
    }
  };
}

// ---- ініціалізація трьох карт
[1, 2, 3].forEach(initCard);

// ---- “антизасинання” (пінг бекенду)
const PING_INTERVAL_MS = 4 * 60 * 1000;
setInterval(() => {
  fetch("/ping", { cache: "no-store" })
    .then(() => console.log(`[ping] ${new Date().toLocaleTimeString()}`))
    .catch((err) => console.warn("[ping error]", err));
}, PING_INTERVAL_MS);
