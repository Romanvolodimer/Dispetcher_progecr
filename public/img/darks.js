document.addEventListener("DOMContentLoaded", () => {
  // Отримуємо чекбокс
  const toggleCheckbox = document.getElementById("theme-checkbox");
  const body = document.body;

  // Функція, яка виконує перемикання
  function toggleTheme() {
    if (toggleCheckbox.checked) {
      // Вмикаємо нічний режим (checked = true)
      body.classList.remove("light-mode");
      body.classList.add("dark-mode");
      localStorage.setItem("theme", "dark-mode");
    } else {
      // Вмикаємо денний режим (checked = false)
      body.classList.remove("dark-mode");
      body.classList.add("light-mode");
      localStorage.setItem("theme", "light-mode");
    }
  }

  // Обробник події зміни стану чекбокса
  if (toggleCheckbox) {
    toggleCheckbox.addEventListener("change", toggleTheme);
  }

  // Завантаження останнього вибору користувача при старті
  const savedTheme = localStorage.getItem("theme");
  if (savedTheme === "dark-mode") {
    body.classList.remove("light-mode");
    body.classList.add("dark-mode");
    toggleCheckbox.checked = true; // Встановлюємо стан чекбокса
  } else {
    body.classList.add("light-mode");
    toggleCheckbox.checked = false;
  }
});
