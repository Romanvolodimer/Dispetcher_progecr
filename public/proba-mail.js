// proba-mail.js (ОБ'ЄДНАНИЙ ФРОНТЕНД-СКРИПТ З ВИПРАВЛЕННЯМ)

// 💡 ВСЯ ЛОГІКА ОБГОРНУТА ТУТ: Код виконується лише після повного завантаження DOM
document.addEventListener("DOMContentLoaded", () => {
  // ---- Спільний стан для звуку та керування
  let audioCtx = null;
  const cards = [1, 2, 3];

  // 💡 КЛЮЧОВА ЗМІНА 1: Стан для керування звуком
  const cardMuteState = {
    1: { muted: false },
    2: { muted: false },
    3: { muted: false },
  };

  // 💡 КЛЮЧОВА ЗМІНА 2: Стан для порогів, LRV ТА КЕРУВАННЯ КНОПКАМИ
  const CARD_STATE = {
    1: {
      threshold: 0,
      lrv: 0,
      lastAction: null,
      resetHour: new Date().getHours() + 1,
    },
    2: {
      threshold: 0,
      lrv: 0,
      lastAction: null,
      resetHour: new Date().getHours() + 1,
    },
    3: {
      threshold: 0,
      lrv: 0,
      lastAction: null,
      resetHour: new Date().getHours() + 1,
    },
  };

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
    if (cardMuteState[cardId]?.muted) return; // Використовуємо cardMuteState
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
          audioCtx.currentTime + 0.02
        );
        o.stop(audioCtx.currentTime + 0.05);
      }, durationMs);
    } catch (err) {
      console.error("beep error:", err);
    }
  }

  // ---- функція логування
  function addLog(id, msg) {
    const t = new Date().toLocaleTimeString();
    const logEl = document.getElementById(`log${id}`);
    if (!logEl) return;

    // Створюємо новий елемент, щоб уникнути проблеми з textContent/innerHTML
    const line = document.createElement("div");
    line.textContent = `[${t}] ${msg}`;
    logEl.prepend(line);

    // Обмеження до 10 логів
    while (logEl.children.length > 10) {
      logEl.removeChild(logEl.lastChild);
    }
  }

  // --- Функція для надсилання нового порогу (для поля вводу: оновлює запасний поріг) ---
  function sendSetThreshold(id, value) {
    const v = Number(value);
    if (!Number.isNaN(v)) {
      ws.send(JSON.stringify({ type: "setThreshold", id, value: v }));
      addLog(id, `Відправлено запит на зміну запасного порогу: ${v} кВт`);
    } else {
      addLog(id, `Помилка: Невірне числове значення для порогу.`);
    }
  }

  // --- Функція для керування активністю кнопок + та - (КЛЮЧОВА ЛОГІКА) ---
  function updateButtonStates(cardId) {
    const state = CARD_STATE[cardId];
    const plusBtn = document.getElementById(`setPositiveThreshold${cardId}`);
    const minusBtn = document.getElementById(`setNegativeThreshold${cardId}`);

    // Перевірка на існування елементів
    if (!plusBtn || !minusBtn) return;

    // 💡 ЛОГІКА СКИДАННЯ КОЖНУ ГОДИНУ
    const currentHour = new Date().getHours() + 1;

    // Якщо час змінився, скидаємо стан
    if (state.resetHour !== currentHour) {
      state.lastAction = null;
      state.resetHour = currentHour;
      addLog(
        cardId,
        `🔄 Скидання стану коригування: нова година (${currentHour}).`
      );
    }

    // ЛОГІКА АЛЬТЕРНУВАННЯ
    if (state.lastAction === "+") {
      // Якщо остання дія була +, дозволяємо лише -
      plusBtn.disabled = true;
      minusBtn.disabled = false;
    } else if (state.lastAction === "-") {
      // Якщо остання дія була -, дозволяємо лише +
      plusBtn.disabled = false;
      minusBtn.disabled = true;
    } else {
      // Початковий стан або після скидання: обидві доступні
      plusBtn.disabled = false;
      minusBtn.disabled = false;
    }
  }

  // ---- робота з усіма картами / WebSocket
  const ws = new WebSocket(
    `${location.protocol === "https:" ? "wss" : "ws"}://${location.host}`
  );

  ws.onopen = () => {
    cards.forEach((id) => addLog(id, "🔌 Підключено до сервера"));
    ws.send(JSON.stringify({ type: "getConfigAll" }));
  };

  ws.onmessage = (ev) => {
    const data = JSON.parse(ev.data);
    const id = data.id;

    // ---- отримали налаштування всіх карт
    if (data.type === "configAll") {
      data.cards.forEach((cfg) => {
        const cardId = cfg.id;
        const thrInput = document.getElementById(`thresholdInput${cardId}`);
        const intInput = document.getElementById(`intervalInput${cardId}`);
        const thrEl = document.getElementById(`thr${cardId}`);

        // 💡 Оновлюємо внутрішній стан CARD_STATE
        CARD_STATE[cardId].threshold = cfg.threshold;

        if (thrInput) thrInput.value = cfg.threshold;
        if (intInput) intInput.value = Math.round(cfg.pollIntervalMs / 1000);

        // ✅ Оновлення UI
        if (thrEl) thrEl.textContent = cfg.threshold;
        document.getElementById(
          `interval${cardId}`
        ).textContent = `${Math.round(cfg.pollIntervalMs / 1000)} с`;

        // 💡 Оновлюємо стан кнопок після отримання конфігурації (може бути після коригування)
        updateButtonStates(cardId);
      });
    }

    // ---- окреме оновлення метрики (КЛЮЧОВА ЛОГІКА)
    if (data.type === "metric") {
      const valEl = document.getElementById(`val${id}`);
      const thrEl = document.getElementById(`thr${id}`);
      const inputEl = document.getElementById(`thresholdInput${id}`);
      const statusEl = document.getElementById(`status${id}`);
      const v = data.value;
      const thresholdKW = data.threshold; // Змінна для зручності

      // 💡 Зберігаємо актуальний поріг та LRV, отримані з бекенду (в КВТ)
      CARD_STATE[id].threshold = thresholdKW;
      // 💡 LRV (Capacity Value) тепер використовується як крок
      CARD_STATE[id].lrv = data.lrv !== undefined ? data.lrv : 0;

      // 💡 Оновлюємо поріг на сторінці динамічним значенням з бекенду/БД
      if (thrEl) thrEl.textContent = thresholdKW;
      if (inputEl) inputEl.value = thresholdKW; // Оновлюємо поле вводу

      if (valEl) valEl.textContent = isNaN(v) ? "—" : v.toFixed(2); // Додано .toFixed(2)

      const tolerance = 100; // Допустиме відхилення: +- 100 (кВт)
      const lowerBound = thresholdKW - tolerance;
      const upperBound = thresholdKW + tolerance;

      // 💡 Порівняння з динамічним порогом (вище або нижче ±100)
      const bad = !isNaN(v) && (v < lowerBound || v > upperBound);
      if (valEl) {
        valEl.classList.toggle("bad", bad);
        valEl.classList.toggle("ok", !bad);
      }

      // ✅ Оновлення статусу
      if (statusEl) {
        if (!isNaN(v) && v < lowerBound) {
          statusEl.textContent = `🚨 НИЖЧЕ КРИТИЧНОГО ПОРОГУ (${lowerBound} кВт)! Оновлено: ${new Date(
            data.ts
          ).toLocaleString()}`;
        } else if (!isNaN(v) && v > upperBound) {
          statusEl.textContent = `🚨 ВИЩЕ КРИТИЧНОГО ПОРОГУ (${upperBound} кВт)! Оновлено: ${new Date(
            data.ts
          ).toLocaleString()}`;
        } else {
          statusEl.textContent = `✅ ОК. Поріг: ${thresholdKW} кВт (±${tolerance}). Оновлено: ${new Date(
            data.ts
          ).toLocaleString()}`;
        }
      }

      // ✅ Оновлення логу
      addLog(
        id,
        `Оновлення. Значення: ${v.toFixed(2)} кВт, Поріг: ${thresholdKW} кВт.`
      );

      // 💡 ВИКЛИК ОНОВЛЕННЯ СТАНУ КНОПОК
      updateButtonStates(id);
    }

    // ---- попередження / повідомлення
    if (data.type === "alert") {
      // ✅ ВИПРАВЛЕНО: Оновлення логу з одиницями
      addLog(
        id,
        `⚠️ Значення ${data.value.toFixed(2)} кВт вийшло за межі порогу ${
          data.threshold
        } кВт (±100)`
      );
      beep(id);

      // Логіка миготіння
      const card = document.getElementById(`card${id}`);
      if (card) {
        let blinkCount = 0;
        const blinkInterval = setInterval(() => {
          card.classList.toggle("alert");
          blinkCount++;
          if (blinkCount >= 6) {
            clearInterval(blinkInterval);
            card.classList.remove("alert");
          }
        }, 500);
      }
    }

    if (data.type === "error") addLog(id, `❌ Помилка: ${data.message}`);

    // 💡 Викликаємо оновлення стану кнопок після отримання інформації про успішне коригування
    if (data.type === "info") {
      addLog(id, `ℹ️ ${data.message}`);
      updateButtonStates(id);
    }
  };

  ws.onclose = () => {
    cards.forEach((id) => addLog(id, "🔴 З'єднання розірвано"));
  };

  // ---- обробка кнопок для кожної карти
  cards.forEach((id) => {
    // 💡 ДОДАНО ПЕРЕВІРКИ, ЩОБ УНИКНУТИ ОШИБОК, ЯКЩО HTML НЕПОВНИЙ

    const testBtn = document.getElementById(`test${id}`);
    const muteBtn = document.getElementById(`mute${id}`);
    const unmuteBtn = document.getElementById(`unmute${id}`);
    const saveThrBtn = document.getElementById(`saveThreshold${id}`);
    const saveIntBtn = document.getElementById(`saveInterval${id}`);
    const checkNowBtn = document.getElementById(`checkNow${id}`);
    const thrInput = document.getElementById(`thresholdInput${id}`);
    const intInput = document.getElementById(`intervalInput${id}`);

    // 💡 КЛЮЧОВА ЗМІНА 4: Отримання кнопок + та -
    const plusBtn = document.getElementById(`setPositiveThreshold${id}`);
    const minusBtn = document.getElementById(`setNegativeThreshold${id}`);

    // Тест звуку
    if (testBtn)
      testBtn.onclick = () => {
        ensureAudioContext();
        addLog(id, "🔊 Тест звуку");
        beep(id, 180, 1200);
        setTimeout(() => beep(id, 180, 900), 220);
        setTimeout(() => beep(id, 220, 600), 460);
      };

    // Mute / Unmute
    if (muteBtn)
      muteBtn.onclick = () => {
        cardMuteState[id].muted = true;
        addLog(id, "🔇 Звук вимкнено");
      };
    if (unmuteBtn)
      unmuteBtn.onclick = () => {
        cardMuteState[id].muted = false;
        addLog(id, "🔊 Звук увімкнено");
      };

    // Зберегти Порогове значення (для запасного/fallback порогу)
    if (saveThrBtn && thrInput)
      saveThrBtn.onclick = () => {
        const v = Number(thrInput.value);
        if (!Number.isNaN(v)) {
          sendSetThreshold(id, v);
        }
      };

    // 💡 Обробник кнопки ПЛЮС (+) - Надсилає запит на збільшення порогу на (+ LRV)
    if (plusBtn) {
      plusBtn.onclick = () => {
        // Надсилаємо запит на коригування з позитивним знаком (бекенд знайде LRV)
        ws.send(
          JSON.stringify({ type: "adjustThreshold", cardId: id, adjustment: 1 })
        );

        // 2. Оновлюємо внутрішній стан, щоб заблокувати кнопку +
        CARD_STATE[id].lastAction = "+";

        // 3. Оновлюємо UI (кнопки)
        updateButtonStates(id);

        // 4. Логування
        addLog(id, `Відправлено запит на збільшення порогу (+ LRV).`);
      };
    }

    // 💡 Обробник кнопки МІНУС (-) - Надсилає запит на зменшення порогу на (- LRV)
    if (minusBtn) {
      minusBtn.onclick = () => {
        // Надсилаємо запит на коригування з негативним знаком (бекенд знайде LRV)
        ws.send(
          JSON.stringify({
            type: "adjustThreshold",
            cardId: id,
            adjustment: -1,
          })
        );

        // 2. Оновлюємо внутрішній стан, щоб заблокувати кнопку -
        CARD_STATE[id].lastAction = "-";

        // 3. Оновлюємо UI (кнопки)
        updateButtonStates(id);

        // 4. Логування
        addLog(id, `Відправлено запит на зменшення порогу (- LRV).`);
      };
    }

    // Зберегти Інтервал
    if (saveIntBtn && intInput)
      saveIntBtn.onclick = () => {
        const sec = Number(intInput.value);
        if (!Number.isNaN(sec) && sec >= 1)
          ws.send(
            JSON.stringify({ type: "setPollIntervalMs", id, value: sec * 1000 })
          );
      };

    // Опитати зараз
    if (checkNowBtn)
      checkNowBtn.onclick = () =>
        ws.send(JSON.stringify({ type: "checkNow", id }));

    // Ініціалізація стану кнопок при завантаженні
    updateButtonStates(id);
  });

  // ---- антизасинання
  const PING_INTERVAL_MS = 4 * 60 * 1000;
  setInterval(() => {
    fetch("/ping", { cache: "no-store" })
      .then(() => {})
      .catch((err) => console.warn("[ping error]", err));
  }, PING_INTERVAL_MS);
});

// --- ЛОГІКА АВТОМАТИЧНОГО ПЕРЕЗАВАНТАЖЕННЯ ТА ПІДТВЕРДЖЕННЯ АКТИВНОСТІ ---

// Інтервал, через який з'явиться модальне вікно (60 хвилин)
const MODAL_INTERVAL_MS = 60 * 60 * 1000;

// Елементи модального вікна та аудіо
const modal = document.getElementById("activityModal");
const refreshButton = document.getElementById("modalRefreshButton");
const alertSound = document.getElementById("alertSound");

let modalTimer;

/**
 * 💡 ФУНКЦІЯ ВІДТВОРЕННЯ ЗВУКУ
 * Спроба відтворити аудіо, обходячи обмеження браузера.
 */
function playAlertSound() {
  if (alertSound) {
    // Зупиняємо попереднє відтворення, якщо воно ще триває
    alertSound.pause();
    alertSound.currentTime = 0;

    // Відтворюємо звук
    alertSound.play().catch((error) => {
      // Браузери часто блокують відтворення без попередньої взаємодії користувача.
      console.warn("❌ Помилка відтворення звуку: ", error);
      console.warn(
        "Впевніться, що користувач взаємодіяв зі сторінкою хоча б один раз."
      );
    });
  }
}

function startModalTimer() {
  // Очистити попередній таймер, якщо він існує
  if (modalTimer) {
    clearTimeout(modalTimer);
  }

  modalTimer = setTimeout(() => {
    // Час вийшов, показуємо модальне вікно
    if (modal) modal.classList.remove("modal-hidden");

    // 💡 КЛЮЧОВА ЗМІНА: Викликаємо відтворення звуку
    playAlertSound();
  }, MODAL_INTERVAL_MS);

  console.log(
    `[Frontend] Таймер активності встановлено на ${
      MODAL_INTERVAL_MS / 60000
    } хвилин.`
  );
}

// Запускаємо таймер одразу після завантаження сторінки
document.addEventListener("DOMContentLoaded", startModalTimer);

// Обробник натискання кнопки
if (refreshButton) {
  refreshButton.onclick = () => {
    console.log(
      "[Frontend] Оператор підтвердив активність. Оновлення сторінки..."
    );

    // Перезавантажуємо сторінку
    window.location.reload();
  };
}
