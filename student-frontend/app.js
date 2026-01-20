// student-frontend/app.js
// =====================================================
// Student App — Auth + Courses + Lessons + Progress
// =====================================================

const API_BASE = "https://api.riseeritrea.com/api";
const app = document.getElementById("app");

// ------------------ HELPERS ------------------
async function api(path, opts = {}) {
  const res = await fetch(API_BASE + path, {
    credentials: "include",
    headers: { "Content-Type": "application/json" },
    ...opts,
    body: opts.body ? JSON.stringify(opts.body) : undefined
  });
  return res.json();
}

function h(html) {
  app.innerHTML = html;
}

// ------------------ STATE ------------------
let state = {
  user: null,
  courseId: null,
  lessons: [],
  lessonIndex: 0,
  progress: {}
};

// ------------------ AUTH ------------------
async function loadMe() {
  const r = await api("/auth/me");
  state.user = r.user || null;
}

async function login(email, password) {
  const r = await api("/auth/login", {
    method: "POST",
    body: { email, password }
  });
  state.user = r.user;
  renderDashboard();
}

async function register(name, email, password) {
  const r = await api("/auth/register", {
    method: "POST",
    body: { name, email, password }
  });
  state.user = r.user;
  renderDashboard();
}

async function logout() {
  await api("/auth/logout", { method: "POST" });
  state.user = null;
  renderAuth();
}

// ------------------ RENDER AUTH ------------------
function renderAuth() {
  h(`
    <h2>Welcome</h2>

    <button onclick="showLogin()">Login</button>
    <button onclick="showRegister()">Register</button>

    <div id="authForm"></div>
  `);
}

window.showLogin = () => {
  document.getElementById("authForm").innerHTML = `
    <h3>Login</h3>
    <input id="email" placeholder="Email" />
    <input id="password" type="password" placeholder="Password" />
    <button onclick="doLogin()">Login</button>
  `;
};

window.showRegister = () => {
  document.getElementById("authForm").innerHTML = `
    <h3>Register</h3>
    <input id="name" placeholder="Name" />
    <input id="email" placeholder="Email" />
    <input id="password" type="password" placeholder="Password" />
    <button onclick="doRegister()">Register</button>
  `;
};

window.doLogin = () =>
  login(
    email.value.trim(),
    password.value.trim()
  );

window.doRegister = () =>
  register(
    name.value.trim(),
    email.value.trim(),
    password.value.trim()
  );

// ------------------ DASHBOARD ------------------
function renderDashboard() {
  h(`
    <div class="topbar">
      <span>Hello ${state.user.name}</span>
      <button onclick="logout()">Logout</button>
    </div>

    <h2>Your Levels</h2>

    ${renderCourseCard("foundation", "Level 1: Foundation")}
    ${renderCourseCard("growth", "Level 2: Growth")}
    ${renderCourseCard("excellence", "Level 3: Excellence")}
  `);
}

function renderCourseCard(id, title) {
  return `
    <div class="course">
      <h3>${title}</h3>
      <button onclick="openCourse('${id}')">Open</button>
    </div>
  `;
}

// ------------------ COURSE / LESSONS ------------------
window.openCourse = async (courseId) => {
  state.courseId = courseId;
  state.lessonIndex = 0;

  const r = await api(`/lessons/${courseId}?lang=en`);
  state.lessons = r.lessons || [];

  const p = await api(`/progress/${courseId}`);
  state.progress = p || {};

  renderLesson();
};

function renderLesson() {
  const l = state.lessons[state.lessonIndex];
  if (!l) return;

  const percent = Math.round(
    ((state.lessonIndex) / state.lessons.length) * 100
  );

  h(`
    <button onclick="renderDashboard()">← Back to Levels</button>

    <h2>${l.title}</h2>
    <p>${l.learnText}</p>

    <div class="progress">
      <div class="bar" style="width:${percent}%"></div>
    </div>

    <div class="nav">
      <button onclick="prevLesson()" ${state.lessonIndex === 0 ? "disabled" : ""}>Back</button>
      <button onclick="saveProgress()">Save</button>
      <button onclick="nextLesson()">Next</button>
    </div>
  `);
}

window.prevLesson = () => {
  if (state.lessonIndex > 0) {
    state.lessonIndex--;
    renderLesson();
  }
};

window.nextLesson = () => {
  if (state.lessonIndex < state.lessons.length - 1) {
    state.lessonIndex++;
    renderLesson();
  }
};

window.saveProgress = async () => {
  await api("/progress/save", {
    method: "POST",
    body: {
      courseId: state.courseId,
      lessonIndex: state.lessonIndex
    }
  });
  alert("Progress saved ✅");
};

// ------------------ BOOT ------------------
(async function boot() {
  await loadMe();
  state.user ? renderDashboard() : renderAuth();
})();
