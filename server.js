import express from "express";
import { WebSocketServer } from "ws";
import puppeteer from "puppeteer";
import dotenv from "dotenv";
import path from "path";
import { fileURLToPath } from "url";

// 💡 ІМПОРТ: Додано updateHourlyThreshold для збереження коригування в БД
import {
  saveInstallationData,
  getInstallationData,
  getHourlyThreshold,
  getCapacityValueForHour,
  updateHourlyThreshold, // 💡 КЛЮЧОВА ЗМІНА: Нова функція для збереження порогу в БД
  getCurrentDateTimeFromDB, // 💡 ВИПРАВЛЕННЯ: Функція для отримання часу з БД
} from "./dbHandler.js";

dotenv.config();
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const app = express();
app.use(express.static(path.join(__dirname, "public")));

app.use(express.json());

// --- API МАРШРУТ 1: ЗБЕРЕЖЕННЯ ДАНИХ (POST) ---
app.post("/api/save-data", async (req, res) => {
  try {
    await saveInstallationData(req.body);
    res.status(200).json({ success: true, message: "Дані успішно збережено!" });
  } catch (error) {
    res
      .status(500)
      .json({ success: false, message: "Помилка сервера: " + error.message });
  }
});

// --- API МАРШРУТ 2: ОТРИМАННЯ ДАНИХ (GET) ---
app.get("/api/get-data", async (req, res) => {
  const { installation, date } = req.query;

  if (!installation || !date) {
    return res.status(400).json({
      success: false,
      message: "Необхідні параметри 'installation' та 'date'.",
    });
  }

  try {
    const data = await getInstallationData(installation, date);
    res.status(200).json({ success: true, data });
  } catch (error) {
    res
      .status(500)
      .json({ success: false, message: "Помилка сервера: " + error.message });
  }
});

// === Перевірка змінних ===
const requiredEnv = [
  "LOGIN_URL_1",
  "USERNAME_1",
  "PASSWORD_1",
  "USERNAME_SELECTOR_1",
  "PASSWORD_SELECTOR_1",
  "SUBMIT_SELECTOR_1",
  "METRIC_SELECTOR_1",
  "LOGIN_URL_2",
  "USERNAME_2",
  "PASSWORD_2",
  "USERNAME_SELECTOR_2",
  "PASSWORD_SELECTOR_2",
  "SUBMIT_SELECTOR_2",
  "METRIC_SELECTOR_2A",
  "METRIC_SELECTOR_2B",
  "LOGIN_URL_3",
  "USERNAME_3",
  "PASSWORD_3",
  "USERNAME_SELECTOR_3",
  "PASSWORD_SELECTOR_3",
  "SUBMIT_SELECTOR_3",
  "METRIC_SELECTOR_3",
  "PAGE_3",
];

const missing = requiredEnv.filter(
  (k) => !process.env[k] || process.env[k].trim() === "",
);
if (missing.length) {
  console.error("❌ У файлі .env відсутні або порожні такі змінні:");
  missing.forEach((k) => console.error(`   - ${k}`));
  process.exit(1);
}

const {
  LOGIN_URL_1,
  USERNAME_1,
  PASSWORD_1,
  USERNAME_SELECTOR_1,
  PASSWORD_SELECTOR_1,
  SUBMIT_SELECTOR_1,
  METRIC_SELECTOR_1,
  LOGIN_URL_2,
  USERNAME_2,
  PASSWORD_2,
  USERNAME_SELECTOR_2,
  PASSWORD_SELECTOR_2,
  SUBMIT_SELECTOR_2,
  METRIC_SELECTOR_2A,
  METRIC_SELECTOR_2B,
  LOGIN_URL_3,
  USERNAME_3,
  PASSWORD_3,
  USERNAME_SELECTOR_3,
  PASSWORD_SELECTOR_3,
  SUBMIT_SELECTOR_3,
  METRIC_SELECTOR_3,
  PAGE_3,
} = process.env;

// 💡 ПОЧАТКОВЕ ЗАВАНТАЖЕННЯ: Статичні/Запасні пороги
let TH1 = Number(process.env.THRESHOLD_1 || "0");
let TH2 = Number(process.env.THRESHOLD_2 || "0");
let TH3 = Number(process.env.THRESHOLD_3 || "0");
let TH4 = Number(process.env.THRESHOLD_4 || "0");

let INTERVAL_MS = Number(process.env.POLL_INTERVAL || "15") * 1000;
const PORT = Number(process.env.PORT || 3000);

// 💡 Зіставлення ID карт з назвами установок у БД
const CARD_TO_INSTALLATION_MAP = {
  1: "КГУ1",
  2: "КГУ2",
  3: "КГУ3",
  4: "КГУ4",
};

app.get("/ping", (_req, res) => res.status(200).send("ok"));

const server = app.listen(PORT, () => {
  console.log(`✅ Веб інтерфейс: http://localhost:${PORT}`);
});

const wss = new WebSocketServer({ server });

// --- надсилання WS-повідомлення всім клієнтам
function broadcast(obj) {
  const data = JSON.stringify(obj);
  wss.clients.forEach((c) => {
    try {
      c.send(data);
    } catch {}
  });
}

// --- надсилаємо конфіг усім клієнтам
function sendConfigAll(ws) {
  const cards = [
    { id: 1, threshold: TH1, pollIntervalMs: INTERVAL_MS },
    { id: 2, threshold: TH2, pollIntervalMs: INTERVAL_MS },
    { id: 3, threshold: TH3, pollIntervalMs: INTERVAL_MS },
    { id: 4, threshold: TH4, pollIntervalMs: INTERVAL_MS },
  ];
  ws?.send(JSON.stringify({ type: "configAll", cards }));
}

// === Основна логіка Puppeteer ===
(async () => {
  const browser = await puppeteer.launch({
    headless: "new",
    args: ["--no-sandbox", "--disable-setuid-sandbox"],
  });

  // --- 1. Перша система ---
  const page1 = await browser.newPage();
  await page1.goto(LOGIN_URL_1, { waitUntil: "networkidle2" });
  console.log("🔐 Логін у систему 1...");
  await page1.type(USERNAME_SELECTOR_1, USERNAME_1);
  await page1.type(PASSWORD_SELECTOR_1, PASSWORD_1);
  await Promise.all([
    page1.click(SUBMIT_SELECTOR_1),
    page1.waitForNavigation({ waitUntil: "networkidle2" }),
  ]);
  console.log("✅ Авторизація 1 успішна");

  // --- 2. Друга система ---
  const base2 = LOGIN_URL_2.replace("/login.php", "");
  const pageLogin2 = await browser.newPage();
  console.log("🔐 Логін у систему 2...");
  await pageLogin2.goto(LOGIN_URL_2, { waitUntil: "networkidle2" });
  await pageLogin2.type(USERNAME_SELECTOR_2, USERNAME_2);
  await pageLogin2.type(PASSWORD_SELECTOR_2, PASSWORD_2);
  await Promise.all([
    pageLogin2.click(SUBMIT_SELECTOR_2),
    pageLogin2.waitForNavigation({ waitUntil: "networkidle2" }),
  ]);
  console.log("✅ Авторизація 2 успішна");

  // === 3. Третя система ===
  const base3 = LOGIN_URL_3.replace("/login.php", "");
  const pageLogin3 = await browser.newPage();

  console.log("🔐 Логін у систему 3...");
  await pageLogin3.goto(LOGIN_URL_3, { waitUntil: "networkidle2" });

  await pageLogin3.type(USERNAME_SELECTOR_3, USERNAME_3);
  await pageLogin3.type(PASSWORD_SELECTOR_3, PASSWORD_3);

  await Promise.all([
    pageLogin3.click(SUBMIT_SELECTOR_3),
    pageLogin3.waitForNavigation({ waitUntil: "networkidle2" }),
  ]);

  console.log("✅ Авторизація 3 успішна");

  // сторінка метрики
  // сторінка метрики (СИСТЕМА 3)
  const page4 = await browser.newPage();

  // 🔍 ДЕБАГ
  console.log("LOGIN_URL_3:", LOGIN_URL_3);
  console.log("PAGE_3:", PAGE_3);

  const base3 = new URL(LOGIN_URL_3).origin;
  const url3 = new URL(PAGE_3, base3).href;

  console.log("➡️ FINAL URL:", url3);

  // 👉 перевірка перед переходом
  if (!PAGE_3) {
    throw new Error("❌ PAGE_3 не заданий в Render Environment");
  }

  await page4.goto(url3, { waitUntil: "networkidle2" });

  // --- Сторінки з метриками ---
  const page2 = await browser.newPage();
  const page3 = await browser.newPage();
  await page2.goto(`${base2}/screen.php?id=1`, { waitUntil: "networkidle2" });
  await page3.goto(`${base2}/screen.php?id=2`, { waitUntil: "networkidle2" });

  console.log("📊 Всі сторінки відкрито. Починаємо моніторинг...");

  // --- Отримання метрик ---
  async function checkMetric(page, selector, id, threshold) {
    const installationName = CARD_TO_INSTALLATION_MAP[id];

    // 💡 ВИПРАВЛЕНО: Отримуємо дату та годину з БД для уникнення проблем з часовими поясами
    const { date: currentDateString, hour: currentHour } =
      await getCurrentDateTimeFromDB();

    let thresholdUsed = threshold; // Починаємо із запасного (статичного) порогу
    let capacityValue = 0; // Для LRV (в МВт)

    // 1. Отримання динамічного порогу з БД
    try {
      const dynamicThreshold = await getHourlyThreshold(
        installationName,
        currentDateString,
        currentHour,
      );

      if (dynamicThreshold !== null && !Number.isNaN(dynamicThreshold)) {
        thresholdUsed = dynamicThreshold;

        // Оновлюємо статичний поріг THx
        if (id === 1) TH1 = dynamicThreshold;
        else if (id === 2) TH2 = dynamicThreshold;
        else if (id === 3) TH3 = dynamicThreshold;
      }
    } catch (dbError) {
      console.error(`❌ Помилка БД при отриманні порогу: ${dbError.message}`);
    }

    // 💡 ДОДАНО: Отримання Capacity Value для передачі на фронтенд (як LRV)
    try {
      const value = await getCapacityValueForHour(
        installationName,
        currentDateString,
        currentHour,
      );

      if (value !== null && !Number.isNaN(value) && value > 0) {
        capacityValue = value;
      } else {
        capacityValue = 1; // Запасне значення: 1 МВт
      }
    } catch (err) {
      console.warn(
        `⚠️ Помилка отримання Capacity Value для ${installationName}: ${err.message}. Використовується 1 МВт.`,
      );
      capacityValue = 1;
    }

    // 2. ІСНУЮЧА ЛОГІКА PUPPETEER
    try {
      await page.waitForSelector(selector, { timeout: 15000 });
      const raw = await page.$eval(selector, (el) =>
        (el.innerText || el.textContent || "").trim(),
      );
      const num = Number(
        String(raw)
          .replace(/[^\d.,-]/g, "")
          .replace(",", "."),
      );
      const ts = new Date().toISOString();

      broadcast({
        type: "metric",
        id,
        value: num,
        threshold: thresholdUsed,
        lrv: capacityValue,
        ts,
      });

      // 3. ПОРІВНЯННЯ ТА ALERT
      // ✅ ВИПРАВЛЕНО: Додано допустиме відхилення (Deadband) -100
      if (
        !Number.isNaN(num) &&
        (num < thresholdUsed - 100 || num > thresholdUsed + 100)
      ) {
        // ... логіка тривоги
        broadcast({
          type: "alert",
          id,
          value: num,
          threshold: thresholdUsed,
          ts,
        });
      }
    } catch (err) {
      broadcast({
        type: "error",
        id,
        message: err.message,
        ts: new Date().toISOString(),
      });
    }
  }

  // --- Опитування всіх метрик ---
  async function checkAll() {
    // THx передається як запасний (fallback) поріг
    await checkMetric(page1, METRIC_SELECTOR_1, 1, TH1);
    await checkMetric(page2, METRIC_SELECTOR_2A, 2, TH2);
    await checkMetric(page3, METRIC_SELECTOR_2B, 3, TH3);
    await checkMetric(page4, METRIC_SELECTOR_3, 4, TH4);
  }

  await checkAll();
  let intervalHandle = setInterval(checkAll, INTERVAL_MS);

  // --- Перезапуск інтервалу ---
  function resetInterval(newMs) {
    if (intervalHandle) clearInterval(intervalHandle);
    intervalHandle = setInterval(checkAll, newMs);
  }

  // --- WebSocket логіка ---
  wss.on("connection", (ws) => {
    sendConfigAll(ws);
    ws.on("message", async (msg) => {
      // 💡 ЗРОБЛЕНО ASYNC
      try {
        const data = JSON.parse(msg.toString());

        // 💡 ОБРОБНИК: adjustThreshold (+/-) - тепер оновлює БД
        if (data.type === "adjustThreshold") {
          const cardId = Number(data.cardId);
          const adjustmentSign = Math.sign(Number(data.adjustment));
          const installationName = CARD_TO_INSTALLATION_MAP[cardId];

          if (cardId >= 1 && cardId <= 3) {
            // 💡 ВИПРАВЛЕНО: Отримуємо дату та годину з БД для уникнення проблем з часовими поясами
            const { date: currentDateString, hour: currentHour } =
              await getCurrentDateTimeFromDB();

            try {
              // 1. Отримуємо базове значення розвантаження з БД (Capacity Value / LRV)
              let capacityValueMW = await getCapacityValueForHour(
                installationName,
                currentDateString,
                currentHour,
              );

              if (
                capacityValueMW === null ||
                Number.isNaN(capacityValueMW) ||
                capacityValueMW <= 0
              ) {
                capacityValueMW = 1; // Запас: 1 МВт
              }

              // 2. Розраховуємо фактичну величину коригування
              const adjustmentAmount = capacityValueMW * adjustmentSign; // Наприклад: +1 або -2

              // 3. Отримуємо поточний поріг
              let currentThreshold = await getHourlyThreshold(
                installationName,
                currentDateString,
                currentHour,
              );

              if (currentThreshold === null || Number.isNaN(currentThreshold)) {
                // Якщо не знайдено, використовуємо статичний поріг
                if (cardId === 1) currentThreshold = TH1;
                else if (cardId === 2) currentThreshold = TH2;
                else if (cardId === 3) currentThreshold = TH3;
              }

              let newThreshold = currentThreshold + adjustmentAmount;

              // Захист від від'ємних значень
              if (newThreshold < 0) {
                newThreshold = 0;
              }

              // 4. 🚀 КЛЮЧОВА ЗМІНА: ЗБЕРІГАЄМО НОВЕ ЗНАЧЕННЯ В БД
              await updateHourlyThreshold(
                installationName,
                currentDateString,
                currentHour,
                newThreshold,
              );

              // 5. Оновлюємо глобальні пороги (вони будуть перезаписані при наступному checkMetric,
              // але це забезпечує консистентність до наступного опитування)
              if (cardId === 1) TH1 = newThreshold;
              else if (cardId === 2) TH2 = newThreshold;
              else if (cardId === 3) TH3 = newThreshold;

              // 6. Надсилаємо оновлення клієнтам
              broadcast({
                type: "configAll",
                cards: [
                  { id: 1, threshold: TH1, pollIntervalMs: INTERVAL_MS },
                  { id: 2, threshold: TH2, pollIntervalMs: INTERVAL_MS },
                  { id: 3, threshold: TH3, pollIntervalMs: INTERVAL_MS },
                ],
              });

              broadcast({
                type: "info",
                id: cardId,
                message: `Поріг (${installationName}) змінено на ${
                  adjustmentAmount > 0 ? "+" : ""
                }${adjustmentAmount} (LRV). Новий поріг: ${newThreshold} кВт`,
              });
            } catch (dbError) {
              console.error(
                `❌ Помилка БД при коригуванні порогу: ${dbError.message}`,
              );
              broadcast({
                type: "error",
                id: cardId,
                message: `Помилка коригування: Не вдалося оновити поріг у базі даних.`,
              });
            }
          }
        }

        // 💡 ОБРОБНИК: setThreshold (Запасний/Fallback) - без змін
        if (data.type === "setThreshold") {
          const v = Number(data.value);
          if (!Number.isNaN(v)) {
            // Оновлюємо статичні (запасні) пороги
            if (data.id === 1) TH1 = v;
            if (data.id === 2) TH2 = v;
            if (data.id === 3) TH3 = v;
            if (data.id === 4) TH4 = v;

            broadcast({
              type: "configAll",
              cards: [
                { id: 1, threshold: TH1, pollIntervalMs: INTERVAL_MS },
                { id: 2, threshold: TH2, pollIntervalMs: INTERVAL_MS },
                { id: 3, threshold: TH3, pollIntervalMs: INTERVAL_MS },
                { id: 4, threshold: TH4, pollIntervalMs: INTERVAL_MS },
              ],
            });
            broadcast({
              type: "info",
              id: data.id,
              message: `Запасний поріг оновлено до ${v}`,
            });
          }
        }

        // 💡 ОБРОБНИК: setPollIntervalMs - без змін
        if (data.type === "setPollIntervalMs") {
          const v = Number(data.value);
          if (!Number.isNaN(v) && v >= 1000) {
            INTERVAL_MS = v;
            resetInterval(INTERVAL_MS);
            broadcast({
              type: "configAll",
              cards: [
                { id: 1, threshold: TH1, pollIntervalMs: INTERVAL_MS },
                { id: 2, threshold: TH2, pollIntervalMs: INTERVAL_MS },
                { id: 3, threshold: TH3, pollIntervalMs: INTERVAL_MS },
              ],
            });
            broadcast({
              type: "info",
              id: data.id,
              message: `Інтервал опитування оновлено до ${Math.round(
                INTERVAL_MS / 1000,
              )} с`,
            });
          }
        }

        if (data.type === "checkNow") checkAll();
        if (data.type === "getConfigAll") sendConfigAll(ws);
      } catch (err) {
        console.warn("WS parse error:", err);
      }
    });
  });

  // --- Завершення ---
  process.on("SIGINT", async () => {
    console.log("\n🛑 Зупинка…");
    try {
      await browser.close();
    } catch {}
    process.exit(0);
  });
})();
