document.addEventListener("DOMContentLoaded", () => {
  // ---- ЗВУК: створюємо тільки після взаємодії
  let audioCtx = null;
  const mutedCards = {}; // mute для кожної картки

  function ensureAudioContext() {
    if (!audioCtx) {
      try {
        audioCtx = new (window.AudioContext || window.webkitAudioContext)();
      } catch (e) {
        console.error("AudioContext error:", e);
        audioCtx = null;
      }
    } else if (audioCtx.state === "suspended") {
      audioCtx.resume().catch((e) => console.warn("Audio resume failed:", e));
    }
  }

  function beep(cardId, durationMs = 850, freq = 660) {
    if (mutedCards[cardId]) return;
    ensureAudioContext();
    if (!audioCtx) return;
    try {
      const o = audioCtx.createOscillator();
      const g = audioCtx.createGain();
      o.connect(g).connect(audioCtx.destination);
      o.type = "sine";
      o.frequency.value = freq;
      g.gain.setValueAtTime(0.002, audioCtx.currentTime);
      g.gain.exponentialRampToValueAtTime(0.2, audioCtx.currentTime + 0.02);
      o.start();
      setTimeout(() => {
        g.gain.exponentialRampToValueAtTime(
          0.0001,
          audioCtx.currentTime + 0.02,
        );
        o.stop(audioCtx.currentTime + 0.05);
      }, durationMs);
    } catch (err) {
      console.error("beep error:", err);
    }
  }

  // ---- ЛОГ
  function addLog(id, text) {
    const log = document.getElementById(`log${id}`);
    if (!log) {
      console.warn(`log${id} not found`);
      return;
    }
    const line = document.createElement("div");
    line.textContent = `[${new Date().toLocaleTimeString()}] ${text}`;
    log.prepend(line);
  }

  // ---- ПОРОГИ
  // Основний поріг приходить із сервера.
  // Сервер бере його з PostgreSQL.

  const thresholds = {};

  function getThreshold(id) {
    return thresholds[id] ?? 0;
  }

  function setThreshold(id, value) {
    thresholds[id] = Number(value);

    const thrEl = document.getElementById(`thr${id}`);

    const inp = document.getElementById(`thresholdInput${id}`);

    if (thrEl) {
      thrEl.textContent = value;
    }

    if (inp) {
      inp.value = value;
    }

    addLog(id, `⚙️ Встановлено поріг: ${value}`);
  }
  // ---- ІНІЦІАЛІЗАЦІЯ (прикріплюємо обробники) ----
  const cards = [1, 2, 3, 4, 5];

  cards.forEach((id) => {
    // перевіряємо мінімальну наявність елементів
    const valEl = document.getElementById(`val${id}`);
    const thrEl = document.getElementById(`thr${id}`);
    const inputEl = document.getElementById(`thresholdInput${id}`);
    const saveBtn = document.getElementById(`saveThreshold${id}`);
    const testBtn = document.getElementById(`test${id}`);
    const muteBtn = document.getElementById(`mute${id}`);
    const unmuteBtn = document.getElementById(`unmute${id}`);
    const checkNowBtn = document.getElementById(`checkNow${id}`);

    if (!valEl) console.warn(`val${id} not found`);
    if (!thrEl) console.warn(`thr${id} not found`);
    if (!inputEl) console.warn(`thresholdInput${id} not found`);
    if (!saveBtn) console.warn(`saveThreshold${id} not found`);
    if (!testBtn) console.warn(`test${id} not found`);
    if (!muteBtn) console.warn(`mute${id} not found`);
    if (!unmuteBtn) console.warn(`unmute${id} not found`);
    if (!checkNowBtn) console.warn(`checkNow${id} not found`);

    // заповнюємо поріг у DOM
    const thr = getThreshold(id);
    if (thrEl) thrEl.textContent = thr;
    if (inputEl) inputEl.value = thr;

    // Кнопка збереження порога
    if (saveBtn) {
      saveBtn.addEventListener("click", (e) => {
        // ініціалізуємо аудіо як "жест" користувача (щоб дозволити пізніші звуки)
        ensureAudioContext();
        const v = Number(inputEl?.value);
        if (!Number.isNaN(v)) {
          setThreshold(id, v);
          // короткий підтверджуючий звук
          beep(id, 180, 900);
        } else {
          addLog(id, "⚠️ Неправильне значення порогу");
        }
      });
    }

    // Тест звуку
    if (testBtn) {
      testBtn.addEventListener("click", () => {
        ensureAudioContext();
        addLog(id, "🔊 Тест звуку");
        // три коротких тону (щоб краще чути)
        beep(id, 180, 1200);
        setTimeout(() => beep(id, 180, 900), 220);
        setTimeout(() => beep(id, 220, 600), 460);
      });
    }

    // Mute / Unmute (локально для картки)
    if (muteBtn) {
      muteBtn.addEventListener("click", () => {
        mutedCards[id] = true;
        addLog(id, "🔇 Звук вимкнено (локально для картки)");
        const status = document.getElementById(`status${id}`);
        if (status) status.textContent = "🔇 Звук вимкнено";
      });
    }
    if (unmuteBtn) {
      unmuteBtn.addEventListener("click", () => {
        mutedCards[id] = false;
        addLog(id, "🔊 Звук увімкнено (локально для картки)");
        const status = document.getElementById(`status${id}`);
        if (status) status.textContent = "🔊 Звук увімкнено";
      });
    }

    // Check now — шлемо event, або лог
    if (checkNowBtn) {
      checkNowBtn.addEventListener("click", () => {
        addLog(
          id,
          "🔄 Користувацький запит: опитати зараз (виклич WS або чекати сервер)",
        );
        // якщо хочеш, можна викликати ws.send({type:"checkNow", id}) — але тут нема ws в цьому файлі
        // dispatch event so server-listener may listen and forward to ws if implemented
        document.dispatchEvent(
          new CustomEvent("manualCheck", { detail: { id } }),
        );
      });
    }
  }); // cards.forEach

  // ---- ОБРОБКА ОНОВЛЕНЬ МЕТРИК
  // Слухаємо custom event, який надсилає server-listener.js
  document.addEventListener("metricUpdate", (ev) => {
    const { id, value, ts, threshold: serverThreshold } = ev.detail;
    const valEl = document.getElementById(`val${id}`);
    const statusEl = document.getElementById(`status${id}`);
    const previousBadState = {};
    const threshold =
      serverThreshold !== undefined && serverThreshold !== null
        ? Number(serverThreshold)
        : getThreshold(id);

    thresholds[id] = threshold;

    if (valEl) valEl.textContent = isNaN(value) ? "—" : value;
    if (statusEl)
      statusEl.textContent = `Оновлено: ${new Date(ts).toLocaleString()}`;

    const bad =
      !isNaN(value) && (value < threshold - 100 || value > threshold + 100);
    if (valEl) {
      valEl.classList.toggle("bad", bad);
      valEl.classList.toggle("ok", !bad);
    }

    // функція для безпечного додавання записів (максимум 10)
    const addLimitedLog = (msg) => {
      // Виклик функції для додавання самого повідомлення до логу (залишаємо як є)
      addLog(id, msg);

      const logEl = document.getElementById(`log${id}`);

      if (logEl) {
        const lines = logEl.querySelectorAll("div");

        if (lines.length > 10) {
          logEl.innerHTML = "";
        }
      }
    };

    if (bad) {
      addLimitedLog(`⚠️ Увага! Значення поза порогом (${threshold})`);

      // Звук тільки при переході
      // NORMAL → BAD

      if (previousBadState[id] !== true) {
        beep(id);
      }

      previousBadState[id] = true;

      const card = document.getElementById(`card${id}`);

      if (card) {
        card.classList.add("alert");
      }
    } else {
      // Якщо було аварійне значення,
      // а тепер повернулось у норму

      if (previousBadState[id] === true) {
        addLimitedLog(`✅ Значення ${value} повернулося в норму`);
      }

      previousBadState[id] = false;

      const card = document.getElementById(`card${id}`);

      if (card) {
        card.classList.remove("alert");
      }
    }
  });

  // ======================================================
  // WARNING — регістр тимчасово відсутній
  // ======================================================

  document.addEventListener("serverWarning", (ev) => {
    const { id, message } = ev.detail;

    const card = document.getElementById(`card${id}`);

    if (card) {
      card.classList.remove(
        "alert",
        "status-unavailable",
        "status-reconnecting",
      );

      card.classList.add("status-warning");
    }

    const status = document.getElementById(`status${id}`);

    if (status) {
      status.textContent = `🟡 ${message || "Регістр тимчасово недоступний"}`;
    }

    addLog(id, `🟡 ${message || "Регістр тимчасово недоступний"}`);
  });

  // ---- OPTIONAL: якщо server-listener не шле manualCheck, можна підписатись тут і перекинути в WS
  // document.addEventListener("manualCheck", (ev) => { ... })

  // ======================================================
  // RECONNECTING
  // ======================================================

  document.addEventListener("serverReconnecting", (ev) => {
    const { id, message } = ev.detail;

    const card = document.getElementById(`card${id}`);

    if (card) {
      card.classList.remove("alert", "status-warning", "status-unavailable");

      card.classList.add("status-reconnecting");
    }

    const status = document.getElementById(`status${id}`);

    if (status) {
      status.textContent = `🔄 ${message || "Відновлення з'єднання..."}`;
    }

    addLog(id, `🔄 ${message || "Відновлення з'єднання..."}`);
  });

  // ======================================================
  // RELOGIN SUCCESS
  // ======================================================

  document.addEventListener("serverReconnected", (ev) => {
    const { id, message } = ev.detail;

    const card = document.getElementById(`card${id}`);

    if (card) {
      card.classList.remove(
        "status-warning",
        "status-reconnecting",
        "status-unavailable",
      );
    }

    const status = document.getElementById(`status${id}`);

    if (status) {
      status.textContent = `🟢 ${message || "Авторизацію відновлено"}`;
    }

    addLog(id, `🟢 ${message || "Авторизацію відновлено"}`);
  });

  // ======================================================
  // UNAVAILABLE
  // ======================================================

  document.addEventListener("serverUnavailable", (ev) => {
    const { id, message } = ev.detail;

    const card = document.getElementById(`card${id}`);

    if (card) {
      card.classList.remove("status-warning", "status-reconnecting");

      card.classList.add("status-unavailable");
    }

    const status = document.getElementById(`status${id}`);

    if (status) {
      status.textContent = `🔴 ${message || "Установка недоступна"}`;
    }

    addLog(id, `🔴 ${message || "Установка недоступна"}`);

    // Звук аварії
    beep(id, 1000, 400);
  });

  console.log("Frontend logic initialized: thresholds:", thresholds);
});
