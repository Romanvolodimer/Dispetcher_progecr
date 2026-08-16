import express from "express";
import { WebSocketServer } from "ws";
import dotenv from "dotenv";
import path from "path";
import fs from "fs";
import { fileURLToPath } from "url";

import {
  saveInstallationData,
  getInstallationData,
  getHourlyThreshold,
  getCapacityValueForHour,
  updateHourlyThreshold,
  getCurrentDateTimeFromDB,
} from "./dbHandler.js";

dotenv.config();

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// ======================================================
// EXPRESS
// ======================================================

const app = express();

app.use(express.json());

app.use(express.static(path.join(__dirname, "public")));

// ======================================================
// EXISTING DB API
// ======================================================

app.post("/api/save-data", async (req, res) => {
  try {
    await saveInstallationData(req.body);

    res.status(200).json({
      success: true,
      message: "Дані успішно збережено!",
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      message: "Помилка сервера: " + error.message,
    });
  }
});

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

    res.status(200).json({
      success: true,
      data,
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      message: "Помилка сервера: " + error.message,
    });
  }
});

// ======================================================
// PING
// ======================================================

app.get("/ping", (_req, res) => {
  res.status(200).send("ok");
});

// ======================================================
// ENV
// ======================================================

const requiredEnv = [
  "LOGIN_URL_1",
  "USERNAME_1",
  "PASSWORD_1",

  "LOGIN_URL_2",
  "USERNAME_2",
  "PASSWORD_2",

  "LOGIN_URL_3",
  "USERNAME_3",
  "PASSWORD_3",
];

const missingEnv = requiredEnv.filter(
  (key) => !process.env[key] || !process.env[key].trim(),
);

if (missingEnv.length) {
  console.error("❌ У .env відсутні:");

  missingEnv.forEach((key) => {
    console.error(`   - ${key}`);
  });

  process.exit(1);
}

const {
  LOGIN_URL_1,
  USERNAME_1,
  PASSWORD_1,

  LOGIN_URL_2,
  USERNAME_2,
  PASSWORD_2,

  LOGIN_URL_3,
  USERNAME_3,
  PASSWORD_3,
} = process.env;

// ======================================================
// CONFIG
// ======================================================

let TH1 = Number(process.env.THRESHOLD_1 || "0");

let TH2 = Number(process.env.THRESHOLD_2 || "0");

let TH3 = Number(process.env.THRESHOLD_3 || "0");

let TH4 = Number(process.env.THRESHOLD_4 || "0");

let TH5 = Number(process.env.THRESHOLD_5 || "0");

let INTERVAL_MS = Number(process.env.POLL_INTERVAL || "10") * 1000;

// ======================================================
// NEW MONITORING SETTINGS
// ======================================================

const REGISTER_MISSING_LIMIT = Number(
  process.env.REGISTER_MISSING_LIMIT || "10",
);

const RELOGIN_MAX_ATTEMPTS = Number(process.env.RELOGIN_MAX_ATTEMPTS || "3");

const RELOGIN_DELAY_MS = Number(process.env.RELOGIN_DELAY_MS || "10000");

const POST_LOGIN_DELAY_MS = Number(process.env.POST_LOGIN_DELAY_MS || "3000");

const API_TIMEOUT_MS = Number(process.env.API_TIMEOUT_MS || "8000");

const PORT = Number(process.env.PORT || "3000");

// ======================================================
// CARDS
// ======================================================

const CARD_TO_INSTALLATION_MAP = {
  1: "КГУ1",
  2: "КГУ2",
  3: "КГУ3",
  4: "КГУ4",
  5: "КГУ5",
};

// ======================================================
// REGISTERS
// ======================================================

const SYSTEM_1_REGISTER = "18";

const SYSTEM_2_REGISTERS = {
  2: "1217",
  3: "752",
};

const SYSTEM_3_REGISTER = "19";

// ======================================================
// BASE URL
// ======================================================

function getBaseUrl(loginUrl) {
  return loginUrl.replace(/\/login\.php\/?$/, "").replace(/\/$/, "");
}

const BASE_URL_1 = getBaseUrl(LOGIN_URL_1);

const BASE_URL_2 = getBaseUrl(LOGIN_URL_2);

const BASE_URL_3 = getBaseUrl(LOGIN_URL_3);

// ======================================================
// CONNECTIONS
// ======================================================

const CONNECTIONS = process.env.WH_CONNECTIONS || "4,10,11";

// ======================================================
// USER AGENT
// ======================================================

const USER_AGENT =
  "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) " +
  "AppleWebKit/537.36 (KHTML, like Gecko) " +
  "Chrome/151.0.0.0 Safari/537.36";

// ======================================================
// SESSIONS
// ======================================================

const sessions = {
  1: null,
  2: null,
  3: null,
};

// ======================================================
// MONITORING STATE
// ======================================================

const monitorState = {
  1: {
    missingCount: 0,
    lastValue: undefined,
    lastDataAt: null,
    status: "unknown",
    reloginAttempts: 0,
    reloginInProgress: false,
  },

  2: {
    missingCount: 0,
    lastValue: undefined,
    lastDataAt: null,
    status: "unknown",
    reloginAttempts: 0,
    reloginInProgress: false,
  },

  3: {
    missingCount: 0,
    lastValue: undefined,
    lastDataAt: null,
    status: "unknown",
    reloginAttempts: 0,
    reloginInProgress: false,
  },

  4: {
    missingCount: 0,
    lastValue: undefined,
    lastDataAt: null,
    status: "unknown",
    reloginAttempts: 0,
    reloginInProgress: false,
  },

  5: {
    missingCount: 0,
    lastValue: undefined,
    lastDataAt: null,
    status: "unknown",
    reloginAttempts: 0,
    reloginInProgress: false,
  },
};

// ======================================================
// RAM
// ======================================================

let peakRSS = 0;
let peakContainerRAM = 0;

function printMemory() {
  const memory = process.memoryUsage();

  const rss = Math.round(memory.rss / 1024 / 1024);

  const heapUsed = Math.round(memory.heapUsed / 1024 / 1024);

  const heapTotal = Math.round(memory.heapTotal / 1024 / 1024);

  const external = Math.round(memory.external / 1024 / 1024);

  peakRSS = Math.max(peakRSS, rss);

  let containerCurrent = null;
  let containerMax = null;

  try {
    containerCurrent = Number(
      fs.readFileSync("/sys/fs/cgroup/memory.current", "utf8").trim(),
    );

    const maxRaw = fs.readFileSync("/sys/fs/cgroup/memory.max", "utf8").trim();

    if (maxRaw !== "max") {
      containerMax = Number(maxRaw);
    }

    const currentMB = Math.round(containerCurrent / 1024 / 1024);

    peakContainerRAM = Math.max(peakContainerRAM, currentMB);

    containerCurrent = currentMB;

    containerMax = containerMax ? Math.round(containerMax / 1024 / 1024) : null;
  } catch {
    containerCurrent = null;
  }

  const time = new Date().toLocaleTimeString("uk-UA");

  console.log(`\n[${time}] 💾 RAM`);

  console.log(
    `RSS: ${rss} MB | ` +
      `Heap: ${heapUsed}/${heapTotal} MB | ` +
      `External: ${external} MB`,
  );

  console.log(`PEAK RSS: ${peakRSS} MB`);

  if (containerCurrent !== null) {
    console.log(
      `CONTAINER: ${containerCurrent} MB` +
        (containerMax ? ` / ${containerMax} MB` : ""),
    );

    console.log(`PEAK CONTAINER: ${peakContainerRAM} MB`);
  }
}

// ======================================================
// DELAY
// ======================================================

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

// ======================================================
// FETCH WITH TIMEOUT
// ======================================================

async function fetchWithTimeout(url, options = {}, timeoutMs = API_TIMEOUT_MS) {
  const controller = new AbortController();

  const timer = setTimeout(() => controller.abort(), timeoutMs);

  try {
    return await fetch(url, {
      ...options,
      signal: controller.signal,
    });
  } finally {
    clearTimeout(timer);
  }
}

// ======================================================
// STATUS HELPERS
// ======================================================

function sendStatus(cardId, status, message) {
  broadcast({
    type:
      status === "warning"
        ? "warning"
        : status === "unavailable"
          ? "unavailable"
          : status === "reconnecting"
            ? "reconnecting"
            : "status",

    id: cardId,

    status,

    message,

    ts: new Date().toISOString(),
  });
}

// ======================================================
// VALUE CHANGE
// ======================================================

function processValue(cardId, value) {
  const state = monitorState[cardId];

  const previous = state.lastValue;

  state.lastValue = value;

  state.lastDataAt = Date.now();

  state.missingCount = 0;

  const wasProblem = state.status !== "ok";

  state.status = "ok";

  state.reloginAttempts = 0;

  if (previous === undefined) {
    console.log(
      `[${new Date().toLocaleTimeString("uk-UA")}] ` +
        `Карта ${cardId}: ${value}`,
    );
  } else if (previous !== value) {
    console.log(
      `[${new Date().toLocaleTimeString("uk-UA")}] ` +
        `🔄 Карта ${cardId}: ` +
        `${previous} → ${value}`,
    );
  }

  if (wasProblem) {
    sendStatus(cardId, "ok", "Зв'язок/показник відновлено");
  }
}

// ======================================================
// MISSING REGISTER
// ======================================================

function processMissingRegister(cardId) {
  const state = monitorState[cardId];

  state.missingCount++;

  if (state.missingCount < REGISTER_MISSING_LIMIT) {
    return;
  }

  if (state.status === "warning") {
    return;
  }

  if (state.status === "unavailable") {
    return;
  }

  state.status = "warning";

  const message =
    `Карта ${cardId}: ` +
    `регістр відсутній ` +
    `${state.missingCount} разів підряд`;

  console.warn(`⚠️ ${message}`);

  sendStatus(cardId, "warning", message);
}

// ======================================================
// API ERROR
// ======================================================

function processApiError(cardId, message) {
  const state = monitorState[cardId];

  console.error(`❌ Карта ${cardId}: ${message}`);

  sendStatus(cardId, "reconnecting", message);
}

// ======================================================
// BROADCAST
// ======================================================

let wss = null;
let server = null;

function broadcast(data) {
  if (!wss) {
    return;
  }

  const payload = JSON.stringify(data);

  wss.clients.forEach((client) => {
    try {
      if (client.readyState === 1) {
        client.send(payload);
      }
    } catch {}
  });
}

// ======================================================
// CONFIG
// ======================================================

function getCurrentConfig() {
  return {
    cards: [
      {
        id: 1,
        threshold: TH1,
        pollIntervalMs: INTERVAL_MS,
      },

      {
        id: 2,
        threshold: TH2,
        pollIntervalMs: INTERVAL_MS,
      },

      {
        id: 3,
        threshold: TH3,
        pollIntervalMs: INTERVAL_MS,
      },

      {
        id: 4,
        threshold: TH4,
        pollIntervalMs: INTERVAL_MS,
      },

      {
        id: 5,
        threshold: TH5,
        pollIntervalMs: INTERVAL_MS,
      },
    ],
  };
}

function sendConfigAll(ws) {
  ws?.send(
    JSON.stringify({
      type: "configAll",

      ...getCurrentConfig(),
    }),
  );
}

function sendConfigAllToEveryone() {
  if (!wss) {
    return;
  }

  wss.clients.forEach((client) => {
    if (client.readyState === 1) {
      sendConfigAll(client);
    }
  });
}

// ======================================================
// LOGIN
// ======================================================

async function loginSystem(systemId, baseUrl, username, password) {
  console.log(`🔐 Система ${systemId}: авторизація...`);

  const response = await fetchWithTimeout(
    `${baseUrl}/api/signin?_=${Date.now()}`,
    {
      method: "POST",

      headers: {
        "User-Agent": USER_AGENT,

        Accept: "application/json, text/javascript, */*; q=0.01",

        "Content-Type": "application/json",

        Origin: baseUrl,

        Referer: `${baseUrl}/login.php`,

        "X-Requested-With": "XMLHttpRequest",

        "X-WH-LOGIN": username,

        "X-WH-PASSWORD": password,
      },
    },
  );

  const text = await response.text();

  if (!response.ok) {
    throw new Error(`Login HTTP ${response.status}`);
  }

  let loginData = null;

  try {
    loginData = JSON.parse(text);
  } catch {}

  const sessionId = response.headers.get("x-wh-session-id");

  if (!sessionId) {
    throw new Error("X-WH-SESSION-ID не отримано");
  }

  const uid = loginData?.id || 2;

  // --------------------------------------------------
  // REGISTER SESSION
  // --------------------------------------------------

  const registerResponse = await fetchWithTimeout(
    `${baseUrl}/login.php?sid=${encodeURIComponent(
      sessionId,
    )}&uid=${encodeURIComponent(uid)}`,
    {
      method: "POST",

      headers: {
        "User-Agent": USER_AGENT,

        Accept: "*/*",

        Origin: baseUrl,

        Referer: `${baseUrl}/login.php`,

        "X-Requested-With": "XMLHttpRequest",

        Cookie: `X-WH-SESSION-ID=${sessionId}`,
      },
    },
  );

  if (!registerResponse.ok) {
    throw new Error(`Register session HTTP ${registerResponse.status}`);
  }

  sessions[systemId] = {
    sessionId,
    uid,
    createdAt: Date.now(),
  };

  console.log(`✅ Система ${systemId}: нова сесія отримана`);

  // Дуже важлива пауза після login
  await sleep(POST_LOGIN_DELAY_MS);

  return sessions[systemId];
}

// ======================================================
// RELOGIN
// ======================================================

async function reloginSystem(systemId, baseUrl, username, password) {
  const state = monitorState[systemId];

  if (state.reloginInProgress) {
    return false;
  }

  state.reloginInProgress = true;

  try {
    state.status = "reconnecting";

    sendStatus(
      systemId === 2 ? 2 : systemId,
      "reconnecting",
      "Відновлення сесії...",
    );

    for (let attempt = 1; attempt <= RELOGIN_MAX_ATTEMPTS; attempt++) {
      state.reloginAttempts = attempt;

      console.log(
        `🔄 Система ${systemId}: ` +
          `re-login ${attempt}/${RELOGIN_MAX_ATTEMPTS}`,
      );

      if (attempt > 1) {
        await sleep(RELOGIN_DELAY_MS);
      }

      try {
        sessions[systemId] = null;

        await loginSystem(systemId, baseUrl, username, password);

        // Перевіряємо API після паузи
        await requestData(baseUrl, sessions[systemId]);

        const regs = await getRegisters(
          systemId,
          baseUrl,
          username,
          password,
          false,
        );

        if (Object.keys(regs).length === 0) {
          throw new Error("API після re-login не повернув регістри");
        }

        console.log(`✅ Система ${systemId}: ` + `re-login успішний`);

        state.reloginAttempts = 0;

        state.status = "ok";

        return true;
      } catch (error) {
        console.error(
          `❌ Система ${systemId}: ` +
            `re-login ${attempt} не вдався: ` +
            error.message,
        );
      }
    }

    // ----------------------------------------------
    // 3 спроби не допомогли
    // ----------------------------------------------

    state.status = "unavailable";

    sendStatus(
      systemId === 2 ? 2 : systemId,
      "unavailable",
      `Установка недоступна. ` +
        `Не вдалося відновити API після ` +
        `${RELOGIN_MAX_ATTEMPTS} спроб.`,
    );

    return false;
  } finally {
    state.reloginInProgress = false;
  }
}

// ======================================================
// REQUEST DATA
// ======================================================

async function requestData(baseUrl, session) {
  if (!session) {
    throw new Error("Немає активної сесії");
  }

  const response = await fetchWithTimeout(`${baseUrl}/api/request-data`, {
    method: "POST",

    headers: {
      "User-Agent": USER_AGENT,

      Accept: "application/json, text/javascript, */*; q=0.01",

      "Content-Type": "application/x-www-form-urlencoded; charset=UTF-8",

      Origin: baseUrl,

      Referer: `${baseUrl}/screen.php?id=1`,

      "X-Requested-With": "XMLHttpRequest",

      "X-WH-CONNECTIONS": CONNECTIONS,

      Cookie: `X-WH-SESSION-ID=${session.sessionId}`,
    },

    body: '{"regs":true,"alerts":true,"messages":true}',
  });

  if (response.status === 401 || response.status === 403) {
    throw new Error(`SESSION_INVALID_${response.status}`);
  }

  if (!response.ok) {
    throw new Error(`request-data HTTP ${response.status}`);
  }
}

// ======================================================
// GET REGISTERS
// ======================================================

async function getRegisters(
  systemId,
  baseUrl,
  username,
  password,
  allowRelogin = true,
) {
  let session = sessions[systemId];

  if (!session) {
    session = await loginSystem(systemId, baseUrl, username, password);
  }

  try {
    await requestData(baseUrl, session);

    const response = await fetchWithTimeout(`${baseUrl}/lp?_=${Date.now()}`, {
      headers: {
        "User-Agent": USER_AGENT,

        Accept: "*/*",

        Referer: `${baseUrl}/screen.php?id=1`,

        "X-Requested-With": "XMLHttpRequest",

        Cookie: `X-WH-SESSION-ID=${session.sessionId}`,
      },
    });

    if (response.status === 401 || response.status === 403) {
      throw new Error(`SESSION_INVALID_${response.status}`);
    }

    if (!response.ok) {
      throw new Error(`/lp HTTP ${response.status}`);
    }

    const text = await response.text();

    let data;

    try {
      data = JSON.parse(text);
    } catch {
      throw new Error("/lp не повернув JSON");
    }

    return data.regs || {};
  } catch (error) {
    const isSessionError = String(error.message).startsWith("SESSION_INVALID_");

    if (isSessionError && allowRelogin) {
      const success = await reloginSystem(
        systemId,
        baseUrl,
        username,
        password,
      );

      if (!success) {
        throw new Error("Установка недоступна після re-login");
      }

      return getRegisters(systemId, baseUrl, username, password, false);
    }

    throw error;
  }
}

// ======================================================
// GET DB CONFIG
// ======================================================

async function getMetricConfig(cardId, fallbackThreshold) {
  const installationName = CARD_TO_INSTALLATION_MAP[cardId];

  const {
    date: currentDateString,

    hour: currentHour,
  } = await getCurrentDateTimeFromDB();

  console.log(
    `🔎 Карта ${cardId} | ${installationName} | DB DATE=${currentDateString} | DB HOUR=${currentHour}`,
  );

  let thresholdUsed = fallbackThreshold;

  let capacityValue = 1;

  try {
    const dynamicThreshold = await getHourlyThreshold(
      installationName,
      currentDateString,
      currentHour,
    );

    if (dynamicThreshold !== null && !Number.isNaN(dynamicThreshold)) {
      thresholdUsed = dynamicThreshold;

      if (cardId === 1) TH1 = dynamicThreshold;

      if (cardId === 2) TH2 = dynamicThreshold;

      if (cardId === 3) TH3 = dynamicThreshold;

      if (cardId === 4) TH4 = dynamicThreshold;

      if (cardId === 5) TH5 = dynamicThreshold;
    }
  } catch (error) {
    console.warn(`⚠️ Threshold ${installationName}: ` + error.message);
  }

  try {
    const value = await getCapacityValueForHour(
      installationName,
      currentDateString,
      //   currentHour,
    );

    if (value !== null && !Number.isNaN(value) && value > 0) {
      capacityValue = value;
    }
  } catch (error) {
    console.warn(`⚠️ LRV ${installationName}: ` + error.message);
  }

  return {
    thresholdUsed,
    capacityValue,
  };
}

// ======================================================
// SEND METRIC
// ======================================================

function sendMetric(cardId, value, threshold, lrv) {
  const ts = new Date().toISOString();

  broadcast({
    type: "metric",

    id: cardId,

    value,

    threshold,

    lrv,

    ts,
  });

  // ТВОЯ ІСНУЮЧА ЛОГІКА ±100 кВт
  if (value < threshold - 100 || value > threshold + 100) {
    broadcast({
      type: "alert",

      id: cardId,

      value,

      threshold,

      ts,
    });
  }
}

// ======================================================
// CARD 1
// ======================================================

async function checkSystem1() {
  try {
    const { thresholdUsed, capacityValue } = await getMetricConfig(1, TH1);

    const regs = await getRegisters(1, BASE_URL_1, USERNAME_1, PASSWORD_1);

    const raw = regs?.[SYSTEM_1_REGISTER]?.v;

    if (raw === undefined || raw === null) {
      processMissingRegister(1);

      return;
    }

    const value = Number(
      String(raw)
        .replace(/[^\d.,-]/g, "")
        .replace(",", "."),
    );

    if (Number.isNaN(value)) {
      throw new Error(`Некоректне значення register 18: ${raw}`);
    }

    processValue(1, value);

    sendMetric(1, value, thresholdUsed, capacityValue);
  } catch (error) {
    processApiError(1, error.message);
  }
}

// ======================================================
// CARD 2 + CARD 3
// ======================================================

async function checkSystem2() {
  try {
    const [config2, config3] = await Promise.all([
      getMetricConfig(2, TH2),

      getMetricConfig(3, TH3),
    ]);

    const regs = await getRegisters(2, BASE_URL_2, USERNAME_2, PASSWORD_2);

    // ==============================================
    // CARD 2
    // ==============================================

    const raw2 = regs?.[SYSTEM_2_REGISTERS[2]]?.v;

    if (raw2 === undefined || raw2 === null) {
      processMissingRegister(2);
    } else {
      const value2 = Number(
        String(raw2)
          .replace(/[^\d.,-]/g, "")
          .replace(",", "."),
      );

      if (!Number.isNaN(value2)) {
        processValue(2, value2);

        sendMetric(2, value2, config2.thresholdUsed, config2.capacityValue);
      }
    }

    // ==============================================
    // CARD 3
    // ==============================================

    const raw3 = regs?.[SYSTEM_2_REGISTERS[3]]?.v;

    if (raw3 === undefined || raw3 === null) {
      processMissingRegister(3);
    } else {
      const value3 = Number(
        String(raw3)
          .replace(/[^\d.,-]/g, "")
          .replace(",", "."),
      );

      if (!Number.isNaN(value3)) {
        processValue(3, value3);

        sendMetric(3, value3, config3.thresholdUsed, config3.capacityValue);
      }
    }
  } catch (error) {
    processApiError(2, error.message);

    processApiError(3, error.message);
  }
}

// ======================================================
// CARD 4
// ======================================================

async function checkSystem3() {
  try {
    const { thresholdUsed, capacityValue } = await getMetricConfig(4, TH4);

    const regs = await getRegisters(3, BASE_URL_3, USERNAME_3, PASSWORD_3);

    const raw = regs?.[SYSTEM_3_REGISTER]?.v;

    if (raw === undefined || raw === null) {
      processMissingRegister(4);

      return;
    }

    const value = Number(
      String(raw)
        .replace(/[^\d.,-]/g, "")
        .replace(",", "."),
    );

    if (Number.isNaN(value)) {
      throw new Error(`Некоректне значення register 19: ${raw}`);
    }

    processValue(4, value);

    sendMetric(4, value, thresholdUsed, capacityValue);
  } catch (error) {
    processApiError(4, error.message);
  }
}

// ======================================================
// CARD 5
// ======================================================

async function checkMetricHttp5() {
  try {
    const { thresholdUsed, capacityValue } = await getMetricConfig(5, TH5);

    const response = await fetchWithTimeout("http://195.189.214.49:18380/");

    if (!response.ok) {
      throw new Error(`HTTP ${response.status}`);
    }

    const text = await response.text();

    const match = text.match(/-?\d+/);

    if (!match) {
      throw new Error("На сторінці карти 5 не знайдено число");
    }

    const value = -Number(match[0]);

    processValue(5, value);

    sendMetric(5, value, thresholdUsed, capacityValue);
  } catch (error) {
    processApiError(5, error.message);
  }
}

// ======================================================
// CHECK ALL
// ======================================================

let checkRunning = false;

async function checkAll() {
  if (checkRunning) {
    return;
  }

  checkRunning = true;

  try {
    await checkSystem1();

    await checkSystem2();

    await checkSystem3();

    await checkMetricHttp5();
  } finally {
    checkRunning = false;
  }
}

// ======================================================
// POLLING
// ======================================================

let intervalHandle = null;

let monitoringActive = false;

function startMonitoring() {
  if (monitoringActive) {
    return;
  }

  monitoringActive = true;

  console.log("▶️ Моніторинг запущено");

  checkAll();

  intervalHandle = setInterval(checkAll, INTERVAL_MS);
}

function stopMonitoring() {
  if (!monitoringActive) {
    return;
  }

  monitoringActive = false;

  if (intervalHandle) {
    clearInterval(intervalHandle);

    intervalHandle = null;
  }

  console.log("⏸️ Моніторинг зупинено — немає відкритих клієнтів");
}

// ======================================================
// RESET INTERVAL
// ======================================================

function resetInterval(newMs) {
  INTERVAL_MS = newMs;

  if (!monitoringActive) {
    return;
  }

  if (intervalHandle) {
    clearInterval(intervalHandle);
  }

  intervalHandle = setInterval(checkAll, INTERVAL_MS);
}

// ======================================================
// RELOGIN ALL
// ======================================================

async function reloginAll() {
  console.log("\n🔄 РУЧНИЙ RE-LOGIN ВСІХ УСТАНОВОК");

  const systems = [
    {
      id: 1,
      baseUrl: BASE_URL_1,
      username: USERNAME_1,
      password: PASSWORD_1,
    },

    {
      id: 2,
      baseUrl: BASE_URL_2,
      username: USERNAME_2,
      password: PASSWORD_2,
    },

    {
      id: 3,
      baseUrl: BASE_URL_3,
      username: USERNAME_3,
      password: PASSWORD_3,
    },
  ];

  for (const system of systems) {
    await reloginSystem(
      system.id,
      system.baseUrl,
      system.username,
      system.password,
    );

    // Не створюємо одночасний login на всі системи
    await sleep(1000);
  }

  console.log("✅ Ручний RE-LOGIN всіх завершено");
}

// ======================================================
// WEBSOCKET
// ======================================================

function setupWebSocket() {
  wss = new WebSocketServer({
    server,
  });

  wss.on("connection", (ws) => {
    console.log("🔌 WebSocket клієнт підключився");

    // Як тільки відкрили frontend —
    // запускаємо моніторинг
    startMonitoring();

    sendConfigAll(ws);

    ws.on("message", async (msg) => {
      try {
        const data = JSON.parse(msg.toString());

        // ========================================
        // MANUAL RELOGIN ALL
        // ========================================

        if (data.type === "reloginAll") {
          await reloginAll();

          return;
        }

        // ========================================
        // SET THRESHOLD
        // ========================================

        if (data.type === "setThreshold") {
          const id = Number(data.id);

          const value = Number(data.value);

          if (id >= 1 && id <= 5 && !Number.isNaN(value)) {
            if (id === 1) TH1 = value;

            if (id === 2) TH2 = value;

            if (id === 3) TH3 = value;

            if (id === 4) TH4 = value;

            if (id === 5) TH5 = value;

            sendConfigAllToEveryone();
          }

          return;
        }

        // ========================================
        // SET POLL INTERVAL
        // ========================================

        if (data.type === "setPollIntervalMs") {
          const value = Number(data.value);

          if (!Number.isNaN(value) && value >= 1000) {
            resetInterval(value);

            sendConfigAllToEveryone();
          }

          return;
        }

        // ========================================
        // CHECK NOW
        // ========================================

        if (data.type === "checkNow") {
          await checkAll();

          return;
        }

        // ========================================
        // GET CONFIG
        // ========================================

        if (data.type === "getConfigAll") {
          sendConfigAll(ws);

          return;
        }

        // ========================================
        // ADJUST THRESHOLD
        // ========================================

        if (data.type === "adjustThreshold") {
          const cardId = Number(data.cardId);

          if (cardId < 1 || cardId > 4) {
            return;
          }

          const adjustmentSign = Math.sign(Number(data.adjustment));

          const installationName = CARD_TO_INSTALLATION_MAP[cardId];

          const {
            date: currentDateString,

            hour: currentHour,
          } = await getCurrentDateTimeFromDB();

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
            capacityValueMW = 1;
          }

          const adjustmentAmount = capacityValueMW * adjustmentSign;

          let currentThreshold = await getHourlyThreshold(
            installationName,
            currentDateString,
            currentHour,
          );

          if (currentThreshold === null || Number.isNaN(currentThreshold)) {
            if (cardId === 1) currentThreshold = TH1;

            if (cardId === 2) currentThreshold = TH2;

            if (cardId === 3) currentThreshold = TH3;

            if (cardId === 4) currentThreshold = TH4;
          }

          let newThreshold = currentThreshold + adjustmentAmount;

          if (newThreshold < 0) {
            newThreshold = 0;
          }

          await updateHourlyThreshold(
            installationName,
            currentDateString,
            currentHour,
            newThreshold,
          );

          if (cardId === 1) TH1 = newThreshold;

          if (cardId === 2) TH2 = newThreshold;

          if (cardId === 3) TH3 = newThreshold;

          if (cardId === 4) TH4 = newThreshold;

          sendConfigAllToEveryone();

          broadcast({
            type: "info",

            id: cardId,

            message: `Новий поріг: ${newThreshold} кВт`,
          });

          return;
        }
      } catch (error) {
        console.error("❌ WebSocket:", error.message);
      }
    });

    ws.on("close", () => {
      console.log("🔌 WebSocket клієнт відключився");

      // Якщо більше немає відкритих frontend —
      // повністю зупиняємо polling.
      if (wss.clients.size === 0) {
        stopMonitoring();
      }
    });
  });
}

// ======================================================
// START SERVER
// ======================================================

async function start() {
  console.log("========================================");

  console.log("🚀 TEST SERVER");

  console.log("========================================");

  console.log("Карта 1 → API → Система 1 → register 18");

  console.log("Карта 2 → API → Система 2 → register 1217");

  console.log("Карта 3 → API → Система 2 → register 752");

  console.log("Карта 4 → API → Система 3 → register 19");

  console.log("Карта 5 → старий HTTP");

  console.log(`Polling → ${INTERVAL_MS / 1000} сек`);

  console.log(`Missing register → ${REGISTER_MISSING_LIMIT} разів`);

  console.log(`Re-login attempts → ${RELOGIN_MAX_ATTEMPTS}`);

  console.log(`Re-login delay → ${RELOGIN_DELAY_MS / 1000} сек`);

  console.log("Puppeteer → ВИМКНЕНО");

  console.log("Render sleep → ДОЗВОЛЕНО");

  console.log("========================================");

  const httpServer = app.listen(PORT, () => {
    console.log(`✅ Тестовий сервер: http://localhost:${PORT}`);
  });

  server = httpServer;

  setupWebSocket();

  // RAM monitor НЕ запускає моніторинг.
  // Він просто показує пам'ять Node.
  setInterval(printMemory, 10000);
}

// ======================================================
// SHUTDOWN
// ======================================================

async function shutdown() {
  console.log("\n🛑 Зупинка test-server...");

  stopMonitoring();

  try {
    wss?.close();
  } catch {}

  try {
    server?.close();
  } catch {}

  process.exit(0);
}

process.on("SIGINT", shutdown);

process.on("SIGTERM", shutdown);

// ======================================================
// RUN
// ======================================================

start().catch((error) => {
  console.error("❌ КРИТИЧНА ПОМИЛКА:", error);

  process.exit(1);
});
