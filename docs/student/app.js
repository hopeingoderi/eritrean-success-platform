// ================= API BASE =================
const API_BASE = (() => {
  const host = window.location.hostname;
  if (host === "riseeritrea.com" || host === "www.riseeritrea.com") {
    return "https://api.riseeritrea.com/api";
  }
  return "http://localhost:4000/api";
})();

// ================= STATE =================
const appEl = document.getElementById("app");
const navEl = document.getElementById("nav");

const state = {
  user: null,
  lang: "en",
  courses: [],
  lessonsByCourse: {},
  progressByCourse: {},
  examStatusByCourse: {}
};

// ================= HELPERS =================
function getLang() {
  const saved = localStorage.getItem("lang");
  return (saved === "ti" || saved === "en") ? saved : "en";
}

function setLang(lang) {
  const v = (lang === "ti" || lang === "en") ? lang : "en";
  localStorage.setItem("lang", v);
  return v;
}

function escapeHtml(str = "") {
  return String(str).replace(/[&<>"']/g, m => ({
    "&": "&amp;", "<": "&lt;", ">": "&gt;",
    '"': "&quot;", "'": "&#39;"
  }[m]));
}

async function api(path, { method = "GET", body } = {}) {
  const res = await fetch(`${API_BASE}${path}?lang=${state.lang}`, {
    method,
    headers: { "Content-Type": "application/json" },
    credentials: "include",
    body: body ? JSON.stringify(body) : undefined
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error || "Request failed");
  return data;
}

function setHash(h) {
  if (location.hash !== h) location.hash = h;
}

function routeParts() {
  return (location.hash || "#/dashboard").replace("#/", "").split("/");
}

function isLoggedIn() {
  return !!state.user;
}

// ================= NAV =================
function updateNav() {
  if (!navEl) return;
  const buttons = navEl.querySelectorAll("button");
  buttons.forEach(btn => btn.style.display = "none");

  if (state.user) {
    navEl.querySelector(".danger").style.display = "inline-block";
  } else {
    buttons[0].style.display = "inline-block";
    buttons[1].style.display = "inline-block";
  }
}

window.go = (page) => setHash(`#/${page}`);

window.logout = async () => {
  try { await api("/auth/logout", { method: "POST" }); } catch {}
  state.user = null;
  updateNav();
  setHash("#/login");
  render();
};

// ================= LOADERS =================
async function loadMe() {
  const r = await api("/auth/me");
  state.user = r.user;
}

async function loadCourses() {
  const r = await api("/courses");
  state.courses = r.courses || [];
}

async function loadLessons(courseId) {
  const r = await api(`/lessons/${courseId}`);
  state.lessonsByCourse[courseId] = r.lessons || [];
}

async function loadProgress(courseId) {
  const r = await api(`/progress/course/${courseId}`);
  state.progressByCourse[courseId] = r || {};
}

async function loadExamStatus(courseId) {
  state.examStatusByCourse[courseId] =
    await api(`/exams/status/${courseId}`);
}

// ================= ROUTER =================
window.addEventListener("hashchange", render);

async function render() {
  try { await loadMe(); } catch { state.user = null; }
  updateNav();

  const [page, a, b] = routeParts();

  if (page === "login") return renderLogin();
  if (page === "register") return renderRegister();

  if (!isLoggedIn()) {
    setHash("#/login");
    return renderLogin();
  }

  if (page === "dashboard") return renderDashboard();
  if (page === "course") return renderCourse(a);
  if (page === "lesson") return renderLesson(a, Number(b));
  if (page === "exam") return renderExam(a);
  if (page === "cert") return renderCert(a);

  setHash("#/dashboard");
}

// ================= LOGIN =================
function renderLogin() {
  appEl.innerHTML = `
    <div class="card">
      <h1>Login</h1>
      <input id="email" placeholder="Email" />
      <input id="password" type="password" placeholder="Password" />
      <button class="btn primary" id="loginBtn">Login</button>
      <div id="msg" class="small"></div>
    </div>
  `;
  document.getElementById("loginBtn").onclick = async () => {
    try {
      await api("/auth/login", {
        method: "POST",
        body: {
          email: email.value,
          password: password.value
        }
      });
      setHash("#/dashboard");
      render();
    } catch (e) {
      msg.textContent = e.message;
    }
  };
}

// ================= REGISTER =================
function renderRegister() {
  appEl.innerHTML = `
    <div class="card">
      <h1>Register</h1>
      <input id="name" placeholder="Name" />
      <input id="email" placeholder="Email" />
      <input id="password" type="password" placeholder="Password" />
      <button class="btn primary" id="regBtn">Create account</button>
      <div id="msg" class="small"></div>
    </div>
  `;
  regBtn.onclick = async () => {
    try {
      await api("/auth/register", {
        method: "POST",
        body: {
          name: name.value,
          email: email.value,
          password: password.value
        }
      });
      setHash("#/dashboard");
      render();
    } catch (e) {
      msg.textContent = e.message;
    }
  };
}

// ================= DASHBOARD =================
async function renderDashboard() {
  await loadCourses();

  appEl.innerHTML = `
    <div class="card">
      <h1>Your Levels</h1>
      <div class="row">
        <button class="btn" id="en">English</button>
        <button class="btn" id="ti">ትግርኛ</button>
      </div>
    </div>
    ${state.courses.map(c => `
      <div class="card">
        <h2>${escapeHtml(c.title)}</h2>
        <p>${escapeHtml(c.intro)}</p>
        <button class="btn primary" onclick="setHash('#/course/${c.id}')">Open lessons</button>
        <button class="btn" onclick="setHash('#/exam/${c.id}')">Final exam</button>
        <button class="btn" onclick="setHash('#/cert/${c.id}')">Certificate</button>
      </div>
    `).join("")}
  `;

  en.onclick = () => { state.lang = setLang("en"); render(); };
  ti.onclick = () => { state.lang = setLang("ti"); render(); };
}

// ================= COURSE =================
async function renderCourse(courseId) {
  await loadLessons(courseId);
  await loadProgress(courseId);

  const lessons = state.lessonsByCourse[courseId];

  appEl.innerHTML = `
    <div class="card">
      <h1>Lessons</h1>
      ${lessons.map(l => `
        <div class="card">
          <h2>${escapeHtml(l.title)}</h2>
          <button class="btn primary"
            onclick="setHash('#/lesson/${courseId}/${l.lessonIndex}')">
            Open
          </button>
        </div>
      `).join("")}
    </div>
  `;
}

// ================= LESSON =================
async function renderLesson(courseId, lessonIndex) {
  if (!state.lessonsByCourse[courseId]) await loadLessons(courseId);
  await loadProgress(courseId);

  const lesson = state.lessonsByCourse[courseId]
    .find(l => l.lessonIndex === lessonIndex);

  appEl.innerHTML = `
    <div class="card">
      <h1>${escapeHtml(lesson.title)}</h1>
      <h3>Learn</h3>
      <p>${escapeHtml(lesson.learnText)}</p>
      <h3>Task</h3>
      <p>${escapeHtml(lesson.task)}</p>
      <textarea id="reflection" placeholder="Write your reflection..."></textarea>
      <button class="btn primary" id="saveBtn">Save & Complete</button>
      <button class="btn" onclick="setHash('#/course/${courseId}')">Return</button>
    </div>
  `;

  saveBtn.onclick = async () => {
    await api("/progress/update", {
      method: "POST",
      body: {
        courseId,
        lessonIndex,
        completed: true,
        reflection: reflection.value
      }
    });
    render();
  };
}

// ================= EXAM =================
async function renderExam(courseId) {
  const r = await api(`/exams/${courseId}`);
  appEl.innerHTML = `<div class="card"><h1>Exam</h1></div>`;
}

// ================= CERTIFICATE =================
async function renderCert(courseId) {
  const r = await api(`/certificates/status/${courseId}`);
  appEl.innerHTML = `
    <div class="card">
      <h1>Certificate</h1>
      ${r.issued
        ? `<a class="btn primary" target="_blank"
            href="${API_BASE}/certificates/${courseId}/pdf">Download PDF</a>`
        : `<p>Not eligible yet</p>`
      }
    </div>
  `;
}

// ================= BOOT =================
(function boot() {
  if (!location.hash) setHash("#/dashboard");
  state.lang = getLang();
  updateNav();
  render();
})();