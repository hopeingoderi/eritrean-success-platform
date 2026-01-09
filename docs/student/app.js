// ================= CONFIG =================
const API_BASE = "http://localhost:4000/api"; 
// later change to: https://YOUR-SERVICE.onrender.com/api

const app = document.getElementById("app");

// ================= ROUTER =================
function go(page, param) {
  location.hash = param ? `#${page}/${param}` : `#${page}`;
  render();
}

window.addEventListener("hashchange", render);

// ================= API =================
async function api(path, method="GET", body) {
  const res = await fetch(API_BASE + path, {
    method,
    headers: { "Content-Type": "application/json" },
    credentials: "include",
    body: body ? JSON.stringify(body) : undefined
  });
  return res.json();
}

// ================= AUTH =================
async function logout() {
  await api("/auth/logout", "POST");
  go("login");
}

// ================= PAGES =================
async function render() {
  const hash = location.hash.replace("#", "");
  const [page, param] = hash.split("/");

  if (!page || page === "login") return loginPage();
  if (page === "register") return registerPage();
  if (page === "dashboard") return dashboard();
  if (page === "course") return coursePage(param);
  if (page === "lesson") return lessonPage(param);
}

// ---------- LOGIN ----------
function loginPage() {
  app.innerHTML = `
    <div class="card">
      <h2>Login</h2>
      <input id="email" placeholder="Email">
      <input id="password" type="password" placeholder="Password">
      <button class="primary" onclick="login()">Login</button>
    </div>
  `;
}

async function login() {
  const email = emailInput().value;
  const password = passwordInput().value;

  const r = await api("/auth/login", "POST", { email, password });
  if (r.user) go("dashboard");
  else alert("Login failed");
}

function emailInput(){ return document.getElementById("email"); }
function passwordInput(){ return document.getElementById("password"); }

// ---------- REGISTER ----------
function registerPage() {
  app.innerHTML = `
    <div class="card">
      <h2>Register</h2>
      <input id="name" placeholder="Name">
      <input id="email" placeholder="Email">
      <input id="password" type="password" placeholder="Password">
      <button class="primary" onclick="register()">Create Account</button>
    </div>
  `;
}

async function register() {
  const name = document.getElementById("name").value;
  const email = emailInput().value;
  const password = passwordInput().value;

  const r = await api("/auth/register", "POST", { name, email, password });
  if (r.user) go("dashboard");
  else alert("Register failed");
}

// ---------- DASHBOARD ----------
async function dashboard() {
  const r = await api("/courses");
  app.innerHTML = `<h2>Your Levels</h2>`;

  r.courses.forEach(c => {
    app.innerHTML += `
      <div class="card">
        <h3>${c.title}</h3>
        <p class="small">${c.intro}</p>
        <button class="primary" onclick="go('course','${c.id}')">Open</button>
      </div>
    `;
  });
}

// ---------- COURSE ----------
async function coursePage(courseId) {
  const r = await api(`/lessons/${courseId}`);
  app.innerHTML = `<h2>Lessons</h2>`;

  r.lessons.forEach(l => {
    app.innerHTML += `
      <div class="lesson">
        <b>${l.title}</b>
        <div class="small">${l.task}</div>
        <button onclick="go('lesson','${courseId}|${l.lessonIndex}')">Open</button>
      </div>
    `;
  });
}

// ---------- LESSON ----------
async function lessonPage(param) {
  const [courseId, index] = param.split("|");
  const r = await api(`/lessons/${courseId}`);
  const lesson = r.lessons[index];

  app.innerHTML = `
    <div class="card">
      <h2>${lesson.title}</h2>
      <p>${lesson.learnText}</p>

      <h3>Task</h3>
      <p>${lesson.task}</p>

      <h3>Reflection</h3>
      <textarea id="reflection"></textarea>

      <button class="primary" onclick="save('${courseId}',${index})">
        Save & Complete
      </button>
    </div>
  `;
}

async function save(courseId, lessonIndex) {
  const reflection = document.getElementById("reflection").value;
  await api("/progress/update", "POST", {
    courseId,
    lessonIndex,
    completed: true,
    reflection
  });
  alert("Saved!");
  go("course", courseId);
}

// ================= START =================
render();
