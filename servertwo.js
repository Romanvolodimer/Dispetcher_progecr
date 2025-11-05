import express from "express";
import { WebSocketServer } from "ws";
import puppeteer from "puppeteer";
import dotenv from "dotenv";
import path from "path";
import { fileURLToPath } from "url";

dotenv.config();
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

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
];

const missing = requiredEnv.filter(
  (k) => !process.env[k] || process.env[k].trim() === ""
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
} = process.env;

let TH = Number(process.env.THRESHOLD || "0");
let INTERVAL_MS = Number(process.env.POLL_INTERVAL || "15") * 1000;
const PORT = Number(process.env.PORT || 3000);

const app = express();
app.use(express.static(path.join(__dirname, "public")));
app.get("/ping", (_req, res) => res.status(200).send("ok"));

const server = app.listen(PORT, () => {
  console.log(`✅ Веб інтерфейс: http://localhost:${PORT}`);
});

const wss = new WebSocketServer({ server });

function broadcast(obj) {
  const data = JSON.stringify(obj);
  wss.clients.forEach((c) => {
    try {
      c.send(data);
    } catch {}
  });
}

function sendConfig(ws) {
  ws?.send(
    JSON.stringify({
      type: "config",
      threshold: TH,
      pollIntervalMs: INTERVAL_MS,
    })
  );
}

(async () => {
  const browser = await puppeteer.launch({
    headless: "new",
    args: ["--no-sandbox", "--disable-setuid-sandbox"],
  });

  // === 1. Перша система ===
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

  // === 2. Друга система ===
  const login2 = LOGIN_URL_2;
  const base2 = login2.replace("/login.php", "");
  const pageLogin2 = await browser.newPage();
  console.log("🔐 Логін у систему 2...");
  await pageLogin2.goto(login2, { waitUntil: "networkidle2" });
  await pageLogin2.type(USERNAME_SELECTOR_2, USERNAME_2);
  await pageLogin2.type(PASSWORD_SELECTOR_2, PASSWORD_2);
  await Promise.all([
    pageLogin2.click(SUBMIT_SELECTOR_2),
    pageLogin2.waitForNavigation({ waitUntil: "networkidle2" }),
  ]);
  console.log("✅ Авторизація 2 успішна");

  // сторінки з метриками
  const page2 = await browser.newPage();
  const page3 = await browser.newPage();
  await page2.goto(`${base2}/screen.php?id=1`, { waitUntil: "networkidle2" });
  await page3.goto(`${base2}/screen.php?id=2`, { waitUntil: "networkidle2" });

  console.log("✅ Всі сторінки відкрито. Починаємо моніторинг...");

  async function checkMetric(page, selector, label) {
    try {
      await page.waitForSelector(selector, { timeout: 15000 });
      const raw = await page.$eval(selector, (el) =>
        (el.innerText || el.textContent || "").trim()
      );
      const num = Number(
        String(raw)
          .replace(/[^\d.,-]/g, "")
          .replace(",", ".")
      );
      const ts = new Date().toISOString();
      broadcast({ type: label, value: num, raw, threshold: TH, ts });
      console.log(`${label}: ${num}`);
      if (!Number.isNaN(num) && num < TH) {
        broadcast({
          type: "alert",
          source: label,
          value: num,
          threshold: TH,
          ts,
        });
      }
    } catch (err) {
      broadcast({
        type: "error",
        source: label,
        message: err.message,
        ts: new Date().toISOString(),
      });
    }
  }

  async function checkAll() {
    await checkMetric(page1, METRIC_SELECTOR_1, "metric1");
    await checkMetric(page2, METRIC_SELECTOR_2A, "metric2");
    await checkMetric(page3, METRIC_SELECTOR_2B, "metric3");
  }

  await checkAll();
  let intervalHandle = setInterval(checkAll, INTERVAL_MS);

  function resetInterval(newMs) {
    if (intervalHandle) clearInterval(intervalHandle);
    intervalHandle = setInterval(checkAll, newMs);
  }

  wss.on("connection", (ws) => {
    sendConfig(ws);
    ws.on("message", (msg) => {
      try {
        const data = JSON.parse(msg.toString());
        if (data.type === "setThreshold") {
          const v = Number(data.value);
          if (!Number.isNaN(v)) {
            TH = v;
            broadcast({
              type: "config",
              threshold: TH,
              pollIntervalMs: INTERVAL_MS,
            });
            broadcast({ type: "info", message: `Поріг оновлено до ${TH}` });
          }
        }
        if (data.type === "setPollIntervalMs") {
          const v = Number(data.value);
          if (!Number.isNaN(v) && v >= 1000) {
            INTERVAL_MS = v;
            resetInterval(INTERVAL_MS);
            broadcast({
              type: "config",
              threshold: TH,
              pollIntervalMs: INTERVAL_MS,
            });
            broadcast({
              type: "info",
              message: `Інтервал опитування ${Math.round(
                INTERVAL_MS / 1000
              )} с`,
            });
          }
        }
        if (data.type === "checkNow") checkAll();
      } catch {}
    });
  });

  process.on("SIGINT", async () => {
    console.log("\n🛑 Зупинка…");
    try {
      await browser.close();
    } catch {}
    process.exit(0);
  });
})();
