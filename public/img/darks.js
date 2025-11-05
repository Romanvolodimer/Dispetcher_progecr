document.addEventListener("DOMContentLoaded", () => {
  // Змінюємо ID на theme-checkbox
  const toggleCheckbox = document.getElementById("theme-checkbox");
  const body = document.body;
  const toggleLabel = document.getElementById("toggle-label");

  // Функція, яка виконує перемикання
  function toggleTheme() {
    if (toggleCheckbox.checked) {
      // Вмикаємо нічний режим
      body.classList.remove("light-mode");
      body.classList.add("dark-mode");
      toggleLabel.textContent = "Денний режим ☀️";
      localStorage.setItem("theme", "dark-mode");
    } else {
      // Вмикаємо денний режим
      body.classList.remove("dark-mode");
      body.classList.add("light-mode");
      toggleLabel.textContent = "Нічний режим 🌙";
      localStorage.setItem("theme", "light-mode");
    }
  }

  // Обробник події зміни стану чекбокса
  toggleCheckbox.addEventListener("change", toggleTheme);

  // Завантаження останнього вибору користувача при старті
  const savedTheme = localStorage.getItem("theme");
  if (savedTheme === "dark-mode") {
    body.classList.remove("light-mode");
    body.classList.add("dark-mode");
    toggleCheckbox.checked = true; // Важливо: встановлюємо стан чекбокса
    toggleLabel.textContent = "Денний режим ☀️";
  } else {
    body.classList.add("light-mode");
    toggleCheckbox.checked = false;
    toggleLabel.textContent = "Нічний режим 🌙";
  }
});
