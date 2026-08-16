// ======================================================
// SERVER LISTENER
// ======================================================

const cards = [1, 2, 3, 4, 5];

let ws = null;
let reconnectTimer = null;

const RECONNECT_DELAY = 3000;

// ======================================================
// ПІДКЛЮЧЕННЯ WEBSOCKET
// ======================================================

function connectWebSocket() {
  if (
    ws &&
    (ws.readyState === WebSocket.OPEN || ws.readyState === WebSocket.CONNECTING)
  ) {
    return;
  }

  console.log("🔌 Підключення до WebSocket...");

  ws = new WebSocket(
    `${location.protocol === "https:" ? "wss" : "ws"}://${location.host}`,
  );

  // ====================================================
  // ПІДКЛЮЧЕНО
  // ====================================================

  ws.onopen = () => {
    console.log("🟢 WebSocket підключено");

    cards.forEach((id) => {
      addLog(id, "🟢 Підключено до сервера");
    });

    ws.send(
      JSON.stringify({
        type: "getConfigAll",
      }),
    );
  };

  // ====================================================
  // ПОВІДОМЛЕННЯ ВІД СЕРВЕРА
  // ====================================================

  ws.onmessage = (ev) => {
    let data;

    try {
      data = JSON.parse(ev.data);
    } catch (error) {
      console.error("❌ Некоректне повідомлення WebSocket:", ev.data);
      return;
    }

    // ==================================================
    // КОНФІГУРАЦІЯ
    // ==================================================

    if (data.type === "configAll") {
      if (Array.isArray(data.cards)) {
        data.cards.forEach((cfg) => {
          const id = cfg.id;

          const thresholdEl = document.getElementById(`thr${id}`);

          const thresholdInput = document.getElementById(`thresholdInput${id}`);

          const intervalEl = document.getElementById(`interval${id}`);

          const intervalInput = document.getElementById(`intervalInput${id}`);

          if (thresholdEl) {
            thresholdEl.textContent = cfg.threshold ?? 0;
          }

          if (thresholdInput) {
            thresholdInput.value = cfg.threshold ?? 0;
          }

          if (intervalEl) {
            intervalEl.textContent = `${Math.round(
              (cfg.pollIntervalMs || 10000) / 1000,
            )} с`;
          }

          if (intervalInput) {
            intervalInput.value = Math.round(
              (cfg.pollIntervalMs || 10000) / 1000,
            );
          }
        });
      }

      return;
    }

    // ==================================================
    // ЗНАЧЕННЯ РЕГІСТРА
    // ==================================================

    if (data.type === "metric") {
      const id = data.id;

      const valEl = document.getElementById(`val${id}`);

      const statusEl = document.getElementById(`status${id}`);

      const value = Number(data.value);

      if (valEl) {
        valEl.textContent = Number.isNaN(value) ? "—" : value;

        // Останнє отримане значення
        valEl.dataset.value = data.value;
      }

      if (statusEl) {
        statusEl.textContent = data.ts
          ? `Оновлено: ${new Date(data.ts).toLocaleString()}`
          : "Оновлено";
      }

      // Передаємо дані frontend-logic.js
      document.dispatchEvent(
        new CustomEvent("metricUpdate", {
          detail: {
            id,
            value,
            threshold: data.threshold,
            ts: data.ts,
          },
        }),
      );

      return;
    }

    // ==================================================
    // WARNING
    // ==================================================

    if (data.type === "warning") {
      const id = data.id;

      addLog(id, `🟡 ${data.message || "Регістр тимчасово недоступний"}`);

      document.dispatchEvent(
        new CustomEvent("serverWarning", {
          detail: {
            id,
            message: data.message || "Регістр тимчасово недоступний",
          },
        }),
      );

      return;
    }

    // ==================================================
    // RECONNECTING / RELOGIN
    // ==================================================

    if (data.type === "reconnecting" || data.type === "relogin") {
      const id = data.id;

      addLog(id, `🔄 ${data.message || "Відновлення з'єднання..."}`);

      document.dispatchEvent(
        new CustomEvent("serverReconnecting", {
          detail: {
            id,
            message: data.message || "Відновлення з'єднання...",
          },
        }),
      );

      return;
    }

    // ==================================================
    // RELOGIN SUCCESS
    // ==================================================

    if (data.type === "reloginSuccess") {
      const id = data.id;

      addLog(id, "🟢 Авторизацію відновлено");

      document.dispatchEvent(
        new CustomEvent("serverReconnected", {
          detail: {
            id,
            message: data.message || "Авторизацію відновлено",
          },
        }),
      );

      return;
    }

    // ==================================================
    // УСТАНОВКА НЕДОСТУПНА
    // ==================================================

    if (data.type === "unavailable") {
      const id = data.id;

      addLog(id, `🔴 ${data.message || "Установка недоступна"}`);

      document.dispatchEvent(
        new CustomEvent("serverUnavailable", {
          detail: {
            id,
            message: data.message || "Установка недоступна",
          },
        }),
      );

      return;
    }

    // ==================================================
    // INFO
    // ==================================================

    if (data.type === "info") {
      addLog(data.id, `ℹ️ ${data.message}`);

      return;
    }

    // ==================================================
    // ERROR
    // ==================================================

    if (data.type === "error") {
      addLog(data.id, `❌ ${data.message}`);

      return;
    }
  };

  // ====================================================
  // WEBSOCKET ПОМИЛКА
  // ====================================================

  ws.onerror = (error) => {
    console.warn("⚠️ WebSocket помилка", error);
  };

  // ====================================================
  // WEBSOCKET ВІДКЛЮЧЕНО
  // ====================================================

  ws.onclose = () => {
    console.warn("🔴 WebSocket відключено");

    cards.forEach((id) => {
      addLog(id, "🔄 З'єднання з сервером втрачено");
    });

    document.dispatchEvent(new CustomEvent("websocketDisconnected"));

    if (reconnectTimer) {
      clearTimeout(reconnectTimer);
    }

    reconnectTimer = setTimeout(() => {
      reconnectTimer = null;

      connectWebSocket();
    }, RECONNECT_DELAY);
  };
}

// ======================================================
// ВІДПРАВКА ПОВІДОМЛЕННЯ СЕРВЕРУ
// ======================================================

function sendWS(data) {
  if (!ws || ws.readyState !== WebSocket.OPEN) {
    console.warn("⚠️ WebSocket не підключений");

    return false;
  }

  ws.send(JSON.stringify(data));

  return true;
}

// ======================================================
// РУЧНИЙ RELOGIN ВСІХ УСТАНОВОК
// ======================================================

document.addEventListener("reloginAllClick", () => {
  console.log("🔄 FRONTEND: запит на перелогін усіх установок");

  const confirmed = confirm("Перелогінити всі установки?");

  if (!confirmed) {
    return;
  }

  cards.forEach((id) => {
    addLog(id, "🔄 Запущено перелогін усіх установок");
  });

  const sent = sendWS({
    type: "reloginAll",
  });

  if (!sent) {
    cards.forEach((id) => {
      addLog(
        id,
        "❌ Не вдалося відправити команду перелогіну: WebSocket не підключений",
      );
    });
  }
});

// ======================================================
// РУЧНА ПЕРЕВІРКА
// ======================================================

document.addEventListener("manualCheck", (event) => {
  sendWS({
    type: "checkNow",
    id: event.detail?.id,
  });
});

// ======================================================
// СТАРТ
// ======================================================

connectWebSocket();
