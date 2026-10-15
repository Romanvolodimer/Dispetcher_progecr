let selectedInstallation = null;
let currentSelectedDate = null;

// 💡 ДОДАНО: Спрощена функція логування для цього файлу
function addLog(id, msg) {
  console.log(`[LOG ${id}] ${msg}`);
}

// --- 1. Логіка Вибору Установки ---
function selectInstallation(name) {
  selectedInstallation = name;
  document.getElementById("calendar-header").textContent = `Установка: ${name}`;

  // Активне підсвічування кнопки
  document.querySelectorAll(".install-btn").forEach((btn) => {
    btn.classList.remove("active");
  });
  document
    .querySelector(`.install-btn[data-name="${name}"]`)
    .classList.add("active");

  // Показати Календар
  document.getElementById("calendar-view").style.display = "block";
  generateCalendar();
}

// --- 2. Логіка Генерації Календаря ---
function generateCalendar() {
  const today = new Date();
  const currentMonth = today.getMonth();
  const currentYear = today.getFullYear();
  const daysInMonth = new Date(currentYear, currentMonth + 1, 0).getDate();

  const calendarGrid = document.getElementById("calendar-grid");
  calendarGrid.innerHTML = ""; // Очистити попередній календар

  // Додаємо дні тижня (опціонально, але корисно)
  const daysOfWeek = ["Пн", "Вт", "Ср", "Чт", "Пт", "Сб", "Нд"];
  daysOfWeek.forEach((dayName) => {
    const header = document.createElement("div");
    header.textContent = dayName;
    header.style.fontWeight = "bold";
    calendarGrid.appendChild(header);
  });

  // Генерація днів
  for (let day = 1; day <= daysInMonth; day++) {
    const date = new Date(currentYear, currentMonth, day);
    const dateString = `${currentYear}-${String(currentMonth + 1).padStart(
      2,
      "0",
    )}-${String(day).padStart(2, "0")}`;

    const dayElement = document.createElement("div");
    dayElement.textContent = day;
    dayElement.classList.add("calendar-day");
    dayElement.onclick = () => openDataEntryWindow(dateString);

    calendarGrid.appendChild(dayElement);
  }
}

// --- 3. Логіка Модального Вікна ---
async function openDataEntryWindow(date) {
  // 💡 ЗРОБЛЕНО ASYNC
  if (!selectedInstallation) {
    alert("Спочатку оберіть установку!");
    return;
  }

  currentSelectedDate = date;
  const modal = document.getElementById("data-entry-modal");
  document.getElementById("modal-date-header").textContent =
    `Введення даних (${selectedInstallation}) за: ${date}`;

  // Генерація 24 полів вводу
  const container = document.getElementById("input-fields-container");
  container.innerHTML = "";

  for (let i = 1; i <= 24; i++) {
    const div = document.createElement("div");
    // 💡 Додано порожній атрибут value, щоб уникнути помилок при заповненні
    div.innerHTML = `<span class="input-hour-label">${String(i).padStart(
      2,
      "0",
    )}:</span> <input type="number" id="input-${i}" name="hour${i}" min="-6000" required value="">`;
    container.appendChild(div);
  }

  modal.style.display = "block";

  // --- КЛЮЧОВА ЗМІНА: ЗАВАНТАЖЕННЯ ДАНИХ ---
  try {
    addLog(0, `Завантаження даних для ${selectedInstallation} за ${date}...`);
    const response = await fetch(
      `/api/get-data?installation=${selectedInstallation}&date=${date}`,
    );
    const result = await response.json();

    if (response.ok && result.success && result.data && result.data.values) {
      const existingValues = result.data.values;

      // Заповнення полів вводу існуючими даними
      for (let i = 1; i <= 24; i++) {
        const hourKey = `hour${i}`;
        // Перевіряємо, чи є значення для цієї години
        if (
          existingValues.hasOwnProperty(hourKey) &&
          existingValues[hourKey] !== null
        ) {
          const inputElement = document.getElementById(`input-${i}`);
          if (inputElement) {
            inputElement.value = existingValues[hourKey];
          }
        }
      }
      addLog(0, `Дані за ${date} успішно завантажено.`);
    } else if (response.ok && result.success && !result.data) {
      addLog(0, `Дані за ${date} відсутні. Поля порожні.`);
    } else {
      addLog(
        0,
        `Помилка завантаження даних: ${result.message || "Невідома помилка"}`,
      );
    }
  } catch (error) {
    console.error("Помилка запиту даних:", error);
    addLog(0, `❌ Помилка з'єднання при завантаженні даних.`);
  }
}

function closeDataEntryWindow() {
  document.getElementById("data-entry-modal").style.display = "none";
}

// --- 4. Збір та Підготовка Даних для Бекенду ---
async function saveData() {
  // 💡 ЗРОБЛЕНО ASYNC
  const data = {
    installation: selectedInstallation,
    date: currentSelectedDate,
    values: {},
  };

  let allFieldsValid = true;

  // Збір даних з 24 полів
  for (let i = 1; i <= 24; i++) {
    const inputElement = document.getElementById(`input-${i}`);
    const value = Number(inputElement.value);

    // Перевірка на валідність та підсвічування
    if (isNaN(value) || inputElement.value.trim() === "") {
      allFieldsValid = false;
      inputElement.classList.add("input-error");
    } else {
      inputElement.classList.remove("input-error");
    }

    // Зберігаємо значення як число
    data.values[`hour${i}`] = value;
  }

  if (!allFieldsValid) {
    alert("Будь ласка, заповніть усі 24 поля коректними числовими значеннями.");
    return;
  }

  // --- КЛЮЧОВА ЗМІНА: ВІДПРАВКА ДАНИХ ЧЕРЕЗ FETCH ---
  try {
    addLog(0, `Відправка даних для ${data.installation} за ${data.date}...`);
    const response = await fetch("/api/save-data", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify(data),
    });

    const result = await response.json();

    if (response.ok && result.success) {
      alert(
        `✅ Дані для ${data.installation} за ${data.date} успішно збережено!`,
      );
      addLog(0, `Дані успішно збережено.`);
      closeDataEntryWindow();
    } else {
      alert(
        `❌ Помилка збереження даних: ${result.message || "Невідома помилка"}`,
      );
      addLog(
        0,
        `❌ Помилка збереження: ${result.message || "Невідома помилка"}`,
      );
    }
  } catch (error) {
    console.error("Помилка відправки даних:", error);
    alert("❌ Помилка з'єднання з сервером. Перевірте консоль.");
  }
}

// --- 5. Обробники подій ---
document.addEventListener("DOMContentLoaded", () => {
  // Обробник кнопок установ
  document.querySelectorAll(".install-btn").forEach((btn) => {
    btn.onclick = () => selectInstallation(btn.getAttribute("data-name"));
  });

  // Обробник кнопки збереження
  const saveBtn = document.getElementById("save-data-btn");
  if (saveBtn) {
    saveBtn.onclick = saveData;
  }

  // Обробник кнопки закриття
  const closeBtn = document.getElementById("close-modal-btn");
  if (closeBtn) {
    closeBtn.onclick = closeDataEntryWindow;
  }

  // Обробник кнопки закриття (X)
  const closeSpan = document.querySelector(".data-entry-modal .close");
  if (closeSpan) {
    closeSpan.onclick = closeDataEntryWindow;
  }

  // Ініціалізація: генерація календаря
  generateCalendar();
});
