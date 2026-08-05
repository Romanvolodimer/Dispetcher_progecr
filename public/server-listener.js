// ---- робота з усіма картами
const cards = [1, 2, 3, 4, 5];

// ---- підключення WebSocket
const ws = new WebSocket(
  `${location.protocol === "https:" ? "wss" : "ws"}://${location.host}`,
);

ws.onopen = () => {
  cards.forEach((id) => addLog(id, "🔌 Підключено до сервера"));
  ws.send(JSON.stringify({ type: "getConfigAll" }));
};

ws.onmessage = (ev) => {
  const data = JSON.parse(ev.data);

  if (data.type === "metric") {
    const id = data.id;
    const valEl = document.getElementById(`val${id}`);
    const v = data.value;

    valEl.textContent = isNaN(v) ? "—" : v;
    valEl.dataset.value = v; // збережемо останнє значення
    document.getElementById(`status${id}`).textContent = `Оновлено: ${new Date(
      data.ts,
    ).toLocaleString()}`;

    // ---- розсилаємо подію для другого скрипта
    document.dispatchEvent(
      new CustomEvent("metricUpdate", {
        detail: { id, value: v, ts: data.ts },
      }),
    );
  }

  if (data.type === "error") addLog(data.id, `❌ Помилка: ${data.message}`);
  if (data.type === "info") addLog(data.id, `ℹ️ ${data.message}`);
};

ws.onclose = () => {
  cards.forEach((id) => addLog(id, "🔴 З'єднання розірвано"));
};

// ---- антизасинання
setInterval(
  () => {
    fetch("/ping", { cache: "no-store" }).catch(() => {});
  },
  4 * 60 * 1000,
);
