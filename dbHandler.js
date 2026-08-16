import pkg from "pg";
const { Pool } = pkg;

// --- 1. Конфігурація PostgreSQL ---
const pool = new Pool({
  user: process.env.PG_USER,
  host: process.env.PG_HOST,
  database: process.env.PG_DATABASE,
  password: process.env.PG_PASSWORD,
  port: process.env.PG_PORT || 5432,
});

// --- 2. Функція перевірки часу бази даних ---
async function checkDatabaseTimezone() {
  const query = `
    SELECT 
      NOW() AS db_timestamp,
      CURRENT_DATE AS db_date,
      EXTRACT(HOUR FROM NOW()) AS db_hour_24,
      (EXTRACT(HOUR FROM NOW()) + 1) AS db_hour_1_24;
  `;

  try {
    const result = await pool.query(query);
    const row = result.rows[0];

    console.log("-----------------------------------------");
    console.log(`⏰ ЧАСОВА ДІАГНОСТИКА:`);
    console.log(
      `   - Час Node.js (EET): ${new Date().toLocaleString("uk-UA", {
        timeZone: "Europe/Kiev",
      })}`,
    );
    console.log(`   - ЧАС БД (PostgreSQL): ${row.db_timestamp}`);
    console.log(
      `   - БД дата (CURRENT_DATE): ${row.db_date.toISOString().split("T")[0]}`,
    );
    console.log(`   - БД година (0-23): ${Math.floor(row.db_hour_24)}`);
    console.log(`   - БД година (1-24): ${Math.floor(row.db_hour_1_24)}`);
    console.log("-----------------------------------------");

    // Якщо Node.js та БД знаходяться в одному часовому поясі (EET/UTC+2),
    // БД година (1-24) має збігатися з Node.js годиною + 1.
  } catch (error) {
    console.error("❌ Помилка під час перевірки часу БД:", error.message);
  }
}

// --- 2.1. 💡 ОНОВЛЕНА ФУНКЦІЯ: Отримання поточної дати та години в EET ---
/**
 * Отримує поточну дату та годину в часовому поясі EET (Europe/Kiev, UTC+2).
 * Використовує локальний час Node.js, оскільки дані зберігаються з урахуванням EET.
 * @returns {Promise<{date: string, hour: number}>} - Об'єкт з датою (YYYY-MM-DD) та годиною (1-24) в EET
 */
export async function getCurrentDateTimeFromDB() {
  try {
    // Поточний час у часовій зоні України
    const now = new Date();

    // Отримуємо дату в EET / Europe-Kyiv
    const eetDateString = now.toLocaleDateString("en-CA", {
      timeZone: "Europe/Kiev",
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
    });

    // ВАЖЛИВО:
    // hourCycle: "h23" гарантує години 00-23.
    // Без цього Intl інколи може повернути 24:xx опівночі.
    const eetTimeString = now.toLocaleTimeString("en-US", {
      timeZone: "Europe/Kiev",
      hour12: false,
      hourCycle: "h23",
      hour: "2-digit",
      minute: "2-digit",
    });

    const date = eetDateString.replace(/\//g, "-");

    const hourEET = parseInt(eetTimeString.split(":")[0], 10);

    // База використовує години 1-24:
    //
    // 00:00-00:59 → 1
    // 01:00-01:59 → 2
    // ...
    // 22:00-22:59 → 23
    // 23:00-23:59 → 24
    const hour = hourEET + 1;

    return {
      date,
      hour,
    };
  } catch (error) {
    console.error("❌ Помилка під час отримання часу EET:", error.message);

    // Fallback
    const now = new Date();

    const date = now
      .toLocaleDateString("en-CA", {
        timeZone: "Europe/Kiev",
        year: "numeric",
        month: "2-digit",
        day: "2-digit",
      })
      .replace(/\//g, "-");

    const hourEET = now.getHours();

    // const hour = hourEET + 1;

    return {
      date,
      hour,
    };
  }
}

// --- 3. 💡 ОНОВЛЕНА ФУНКЦІЯ: Ініціалізація Бази Даних (створення двох таблиць) ---
async function initializeDatabase() {
  const createInstallationTableQuery = `
        CREATE TABLE IF NOT EXISTS installation_data (
            id SERIAL PRIMARY KEY,
            installation_name VARCHAR(50) NOT NULL,
            record_date DATE NOT NULL,
            hour_of_day INT CHECK (hour_of_day >= 1 AND hour_of_day <= 24) NOT NULL,
            value NUMERIC NOT NULL,
            capacity_value NUMERIC DEFAULT 1, -- Залишаємо це поле, але не будемо його оновлювати
            
            UNIQUE (installation_name, record_date, hour_of_day) 
        );
    `;

  // 💡 ДОДАЄМО: Створення нової таблиці daily_capacity
  const createCapacityTableQuery = `
        CREATE TABLE IF NOT EXISTS daily_capacity (
            id SERIAL PRIMARY KEY,
            installation_name VARCHAR(255) NOT NULL,
            record_date DATE NOT NULL,
            capacity_value NUMERIC(10, 2) NOT NULL,
            
            UNIQUE (installation_name, record_date) 
        );
    `;

  try {
    await pool.query(createInstallationTableQuery);
    await pool.query(createCapacityTableQuery); // ✅ Створюємо нову таблицю
    console.log(
      "✅ Таблиці installation_data та daily_capacity перевірено/створено.",
    );
    await checkDatabaseTimezone();
  } catch (error) {
    console.error("❌ Помилка при створенні таблиць:", error.message);
    throw error;
  }
}

initializeDatabase();

// --- 4. Функція Читання Даних (GET) ---
export async function getInstallationData(installation, date) {
  const query = `
        SELECT hour_of_day, value, capacity_value
        FROM installation_data
        WHERE installation_name = $1 AND record_date = $2
        ORDER BY hour_of_day ASC;
    `;
  const params = [installation, date];

  try {
    const result = await pool.query(query, params);
    return result.rows;
  } catch (error) {
    console.error("❌ Помилка під час отримання даних:", error.message);
    throw error;
  }
} // --- 5. ОНОВЛЕНА ФУНКЦІЯ: Запис Даних (POST) ---
/**
 * Зберігає добове розвантаження в daily_capacity та погодинні значення в installation_data
 * в одній транзакції.
 */
export async function saveInstallationData(payload) {
  const { installation, date, values, capacity } = payload;

  // Перевірка на повноту даних
  for (let i = 1; i <= 24; i++) {
    if (!values[`hour${i}`]) {
      throw new Error("Неповні дані: відсутнє значення для години " + i);
    }
  }

  const client = await pool.connect();
  try {
    await client.query("BEGIN");

    // 💡 ВИПРАВЛЕНО: Видалено множник 1000.
    // capacity_value (добове розвантаження) залишається в МВт.
    const finalCapacityValue = Number(capacity) * 1000;

    // ===============================================
    // 1. ЗБЕРЕЖЕННЯ ДОБОВОГО CAPACITY (у daily_capacity)
    // ===============================================
    const capacityQuery = `
        INSERT INTO daily_capacity (installation_name, record_date, capacity_value)
        VALUES ($1, $2, $3)
        ON CONFLICT (installation_name, record_date) 
        DO UPDATE SET capacity_value = EXCLUDED.capacity_value;
    `;
    await client.query(capacityQuery, [installation, date, finalCapacityValue]);

    // ===============================================
    // 2. ЗБЕРЕЖЕННЯ ПОГОДИННИХ ДАНИХ (у installation_data)
    // ===============================================
    for (let i = 1; i <= 24; i++) {
      const inputThreshold = parseFloat(values[`hour${i}`]);

      // 💡 ВИПРАВЛЕНО: Зберігаємо значення без множення на 1000.
      // Припускаємо, що користувач вводить значення вже в кВт.
      const finalThresholdValue = inputThreshold; // Тут більше немає * 1000

      const hourlyDataQuery = `
        INSERT INTO installation_data (installation_name, record_date, hour_of_day, value)
        VALUES ($1, $2, $3, $4)
        ON CONFLICT (installation_name, record_date, hour_of_day) 
        DO UPDATE SET 
            value = EXCLUDED.value; 
        `;

      const params = [
        installation,
        date,
        i,
        finalThresholdValue, // Зберігаємо без множення
      ];
      await client.query(hourlyDataQuery, params);
    }

    await client.query("COMMIT");
  } catch (error) {
    await client.query("ROLLBACK");
    console.error("❌ Помилка під час збереження даних:", error.message);
    throw error;
  } finally {
    client.release();
  }
}
// --- 6. Функція Отримання погодинного динамічного порогу ---
export async function getHourlyThreshold(installation, date, hour) {
  // Шукаємо поточну годину І попередню (якщо поточна 1, то попередня 24)
  const previousHour = hour === 1 ? 24 : hour - 1;
  const hoursToCheck = [hour, previousHour];

  const query = `
      SELECT value
      FROM installation_data
      WHERE installation_name = $1 
        AND record_date = $2 
        AND hour_of_day = ANY($3::int[]) -- Шукаємо серед поточної та попередньої години
      ORDER BY hour_of_day DESC
      LIMIT 1;
  `;
  const params = [installation, date, hoursToCheck];

  try {
    const result = await pool.query(query, params);
    if (result.rows.length > 0) {
      return parseFloat(result.rows[0].value);
    }
    return null;
  } catch (error) {
    // Не виводимо помилку, оскільки це може бути тимчасове явище.
    // console.error("❌ Помилка під час отримання погодинного порогу:", error.message);
    return null;
  }
}

// --- 7. 💡 ОНОВЛЕНА ФУНКЦІЯ: Отримання значення розвантаження (capacity) ---
/**
 * Отримує добове значення ємності (capacity_value) з таблиці daily_capacity.
 * @param {string} installation - Назва установки
 * @param {string} date - Дата у форматі YYYY-MM-DD
 * @returns {Promise<number|null>} - Значення ємності або 1 (якщо не знайдено)
 */
export async function getCapacityValueForHour(installation, date) {
  // 💡 ЗМІНА: Тепер запит до нової таблиці daily_capacity, не використовуємо годину
  const query = `
        SELECT capacity_value
        FROM daily_capacity 
        WHERE installation_name = $1 
          AND record_date = $2 
        LIMIT 1;
    `;
  const params = [installation, date];

  try {
    const result = await pool.query(query, params);
    if (result.rows.length > 0 && result.rows[0].capacity_value !== null) {
      // Якщо знайдено, повертаємо число
      return parseFloat(result.rows[0].capacity_value);
    }
    // Якщо значення не знайдено, повертаємо 1 як безпечний дефолт
    return 1;
  } catch (error) {
    console.error(
      "❌ Помилка під час отримання значення ємності:",
      error.message,
    );
    // У разі помилки також повертаємо 1 як безпечний дефолт
    return 1;
  }
}

// --- 8. 🚀 НОВА ФУНКЦІЯ: Оновлення погодинного порогу після ручного коригування ---
/**
 * Оновлює або вставляє нове значення порогу (value) для конкретної години в таблиці installation_data.
 * Це використовується для ручного коригування з фронтенду.
 * @param {string} installation - Назва установки
 * @param {string} date - Дата у форматі YYYY-MM-DD
 * @param {number} hour - Година (1 до 24)
 * @param {number} newThreshold - Нове значення порогу в кВт
 */
export async function updateHourlyThreshold(
  installation,
  date,
  hour,
  newThreshold,
) {
  // Використовуємо INSERT ... ON CONFLICT DO UPDATE для ефективної вставки/оновлення
  const query = `
    INSERT INTO installation_data (installation_name, record_date, hour_of_day, value)
    VALUES ($1, $2, $3, $4)
    ON CONFLICT (installation_name, record_date, hour_of_day) 
    DO UPDATE SET 
      value = EXCLUDED.value;
  `;
  const params = [installation, date, hour, newThreshold];

  try {
    await pool.query(query, params);
    console.log(
      `✅ Успішно оновлено поріг для ${installation} ${date}, година ${hour} до ${newThreshold} кВт.`,
    );
  } catch (error) {
    console.error(
      `❌ Помилка під час оновлення погодинного порогу (${installation} ${date}, год ${hour}):`,
      error.message,
    );
    throw error;
  }
}
