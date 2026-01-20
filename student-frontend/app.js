// student-frontend/app.js
// ============================================================
// Student Frontend SPA
// Fixes included:
// 1) Course order: foundation -> growth -> excellence
// 2) Auth UI logic: show Login/Register when logged out, show Logout when logged in
// 3) Hash router for pages
// 4) Uses credentials cookies (session) correctly
// ============================================================

// ================= CONFIG =================
const API_BASE = "https://api.riseeritrea.com/api"; // ✅ correct (no double https)

// Course ordering
const COURSE_ORDER = ["foundation", "growth", "excellence"];

function sortCoursesByLevel(courses) {
  return [...(courses || [])].sort((a, b) => {
    const ai = COURSE_ORDER.indexOf(a.id);
    const bi = COURSE_ORDER.indexOf(b.id);
    return (ai === -1 ? 999 : ai) - (bi === -1 ? 999 : bi);
  });
}

// ================= DOM =================
const appEl = document.getElementById("app");

// Optional nav buttons if your HTML has them
const navLogin = document.getElementById("loginBtn") || document.getElementById("navLogin");
const navRegister = document.getElementById("registerBtn") || document.getElementById("navRegister");
const navLogout = document.getElementById("logoutBtn") || document.getElementById("navLogout");

// ================= HELPERS =================
function escapeHtml(str = "") {
  return String(str).replace(/[&<>"']/g, (m) => ({
    "&": "&amp;",
    "<": "&lt;",
    ">": "&gt;",
    '"': "&quot;",
    "'": "&#39;"
  }[m]));
}

async function api(path, { method = "GET", body } = {}) {
  const res = await fetch(API_BASE + path, {
    method,
    headers: { "Content-Type": "application/json" },
    credentials: "include",
    body: body ? JSON.stringify(body) : undefined
  });

  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    const msg = typeof data.error === "string" ? data.error : "Request failed";
    throw new Error(msg);
  }
  return data;
}

function setHash(h) {
  location.hash = h;
}

function routeParts() {
  const raw = location.hash || "#/dashboard";
  return raw.replace("#/", "").split("/").filter(Boolean);
}

// ================= STATE =================
const state = {
  user: null,
  courses: [],
  lang: "en"
};

// ================= AUTH UI LOGIC =================
function applyAuthNav() {
  // If buttons exist in index.html, toggle them
  const loggedIn = !!state.user;

  if (navLogin) navLogin.style.display = loggedIn ? "none" : "inline-block";
  if (navRegister) navRegister.style.display = loggedIn ? "none" : "inline-block";
  if (navLogout) navLogout.style.display = loggedIn ? "inline-block" : "none";
}

// Attach handlers (if buttons exist)
if (navLogin) navLogin.addEventListener("click", () => setHash("#/login"));
if (navRegister) navRegister.addEventListener("click", () => setHash("#/register"));
if (navLogout) {
  navLogout.addEventListener("click", async () => {
    try { await api("/auth/logout", { method: "POST" }); } catch {}
    state.user = null;
    applyAuthNav();
    setHash("#/login");
    render();
  });
}

// Load current user
async function loadMe() {
  const r = await api("/auth/me");
  state.user = r.user;
  applyAuthNav();
}

// ================= DATA LOADERS =================
async function loadCourses() {
  const r = await api("/courses");
  state.courses = sortCoursesByLevel(r.courses || []);
}

// ================= RENDERERS =================
function renderShell(innerHtml) {
  // If your project already has a header in index.html, we only render page content.
  // If not, we render a simple header here.
  const hasExternalNav = !!(navLogin || navRegister || navLogout);

  const header = hasExternalNav
    ? ""
    : `
      <div class="card">
        <div class="row" style="justify-content:space-between; align-items:center;">
          <div>
            <div class="h1">Eritrean Success Journey</div>
            <div class="small">Learn • Grow • Believe • Succeed</div>
          </div>
          <div class="row" style="gap:8px;">
            ${state.user ? `
              <button class="btn" id="inlineLogout">Logout</button>
            ` : `
              <button class="btn" id="inlineLogin">Login</button>
              <button class="btn" id="inlineRegister">Register</button>
            `}
          </div>
        </div>
      </div>
    `;

  appEl.innerHTML = `
    ${header}
    ${innerHtml}
  `;

  // Wire inline nav if used
  const inlineLogin = document.getElementById("inlineLogin");
  const inlineRegister = document.getElementById("inlineRegister");
  const inlineLogout = document.getElementById("inlineLogout");

  if (inlineLogin) inlineLogin.onclick = () => setHash("#/login");
  if (inlineRegister) inlineRegister.onclick = () => setHash("#/register");
  if (inlineLogout) {
    inlineLogout.onclick = async () => {
      try { await api("/auth/logout", { method: "POST" }); } catch {}
      state.user = null;
      applyAuthNav();
      setHash("#/login");
      render();
    };
  }
}

function renderLogin() {
  renderShell(`
    <div class="card">
      <div class="h2">Login</div>

      <label>Email</label>
      <input id="email" type="email" placeholder="you@example.com" />

      <label>Password</label>
      <input id="password" type="password" placeholder="••••••••" />

      <div style="height:12px"></div>
      <button class="btn primary" id="doLogin">Login</button>
      <div class="small" id="msg" style="margin-top:10px"></div>

      <div style="height:10px"></div>
      <div class="small">
        No account? <a href="#/register">Register</a>
      </div>
    </div>
  `);

  document.getElementById("doLogin").onclick = async () => {
    const email = document.getElementById("email").value.trim();
    const password = document.getElementById("password").value.trim();
    const msg = document.getElementById("msg");
    msg.textContent = "";

    try {
      const r = await api("/auth/login", { method: "POST", body: { email, password } });
      state.user = r.user;
      applyAuthNav();
      setHash("#/dashboard");
      render();
    } catch (e) {
      msg.textContent = "Login failed: " + e.message;
    }
  };
}

function renderRegister() {
  renderShell(`
    <div class="card">
      <div class="h2">Register</div>

      <label>Name</label>
      <input id="name" type="text" placeholder="Your name" />

      <label>Email</label>
      <input id="email" type="email" placeholder="you@example.com" />

      <label>Password</label>
      <input id="password" type="password" placeholder="Min 6 characters" />

      <div style="height:12px"></div>
      <button class="btn primary" id="doRegister">Create account</button>
      <div class="small" id="msg" style="margin-top:10px"></div>

      <div style="height:10px"></div>
      <div class="small">
        Already have an account? <a href="#/login">Login</a>
      </div>
    </div>
  `);

  document.getElementById("doRegister").onclick = async () => {
    const name = document.getElementById("name").value.trim();
    const email = document.getElementById("email").value.trim();
    const password = document.getElementById("password").value.trim();
    const msg = document.getElementById("msg");
    msg.textContent = "";

    try {
      const r = await api("/auth/register", { method: "POST", body: { name, email, password } });
      state.user = r.user;
      applyAuthNav();
      setHash("#/dashboard");
      render();
    } catch (e) {
      msg.textContent = "Register failed: " + e.message;
    }
  };
}

function renderDashboard() {
  const courses = sortCoursesByLevel(state.courses);

  const cards = courses.map(c => {
    const title = (state.lang === "ti" ? c.title_ti : c.title_en) || c.id;
    const desc = (state.lang === "ti" ? c.description_ti : c.description_en) || "";

    return `
      <div class="card">
        <div class="h2">${escapeHtml(title)}</div>
        <div class="small">${escapeHtml(desc)}</div>
        <div style="height:10px"></div>
        <button class="btn ok" data-open-course="${escapeHtml(c.id)}">Open</button>
      </div>
    `;
  }).join("");

  renderShell(`
    <div class="card">
      <div class="row" style="justify-content:space-between; align-items:center;">
        <div>
          <div class="h2">Your Levels</div>
          <div class="small">Order is fixed: Foundation → Growth → Excellence</div>
        </div>

        <div class="row" style="gap:8px;">
          <button class="btn" id="langBtn">${state.lang === "en" ? "TI" : "EN"}</button>
        </div>
      </div>
    </div>

    ${cards || `<div class="card"><div class="small">No courses found.</div></div>`}
  `);

  document.getElementById("langBtn").onclick = () => {
    state.lang = (state.lang === "en") ? "ti" : "en";
    render();
  };

  document.querySelectorAll("[data-open-course]").forEach(btn => {
    btn.addEventListener("click", () => {
      const courseId = btn.getAttribute("data-open-course");
      setHash(`#/course/${courseId}`);
    });
  });
}

async function renderCourse(courseId) {
  // Load lessons list from API
  const r = await api(`/lessons/${courseId}?lang=${state.lang}`);
  const lessons = (r.lessons || []).sort((a, b) => a.lessonIndex - b.lessonIndex);

  const rows = lessons.map(l => `
    <div class="card">
      <div class="h2">${escapeHtml(l.title || "")}</div>
      <div class="small">Lesson ${l.lessonIndex + 1}</div>
      <div style="height:10px"></div>
      <button class="btn ok" data-open-lesson="${courseId}|${l.lessonIndex}">Open lesson</button>
    </div>
  `).join("");

  renderShell(`
    <div class="card">
      <div class="row" style="justify-content:space-between; align-items:center;">
        <div class="h2">Lessons: ${escapeHtml(courseId)}</div>
        <div class="row" style="gap:8px;">
          <button class="btn" id="backDash">Back</button>
          <button class="btn" id="langBtn">${state.lang === "en" ? "TI" : "EN"}</button>
        </div>
      </div>
    </div>

    ${rows || `<div class="card"><div class="small">No lessons found.</div></div>`}
  `);

  document.getElementById("backDash").onclick = () => setHash("#/dashboard");
  document.getElementById("langBtn").onclick = () => {
    state.lang = (state.lang === "en") ? "ti" : "en";
    render();
  };

  document.querySelectorAll("[data-open-lesson]").forEach(btn => {
    btn.addEventListener("click", () => {
      const [cId, idx] = btn.getAttribute("data-open-lesson").split("|");
      setHash(`#/lesson/${cId}/${idx}`);
    });
  });
}

async function renderLesson(courseId, lessonIndex) {
  lessonIndex = Number(lessonIndex);

  // Load all lessons (so we can show next/back correctly)
  const r = await api(`/lessons/${courseId}?lang=${state.lang}`);
  const lessons = (r.lessons || []).sort((a, b) => a.lessonIndex - b.lessonIndex);
  const current = lessons.find(x => x.lessonIndex === lessonIndex);

  if (!current) {
    renderShell(`
      <div class="card">
        <div class="h2">Lesson not found</div>
        <button class="btn" onclick="location.hash='#/course/${courseId}'">Back</button>
      </div>
    `);
    return;
  }

  const hasPrev = lessons.some(x => x.lessonIndex === lessonIndex - 1);
  const hasNext = lessons.some(x => x.lessonIndex === lessonIndex + 1);

  renderShell(`
    <div class="card">
      <div class="row" style="justify-content:space-between; align-items:center;">
        <div>
          <div class="h2">${escapeHtml(current.title || "")}</div>
          <div class="small">${escapeHtml(courseId)} • Lesson ${lessonIndex + 1}</div>
        </div>
        <div class="row" style="gap:8px;">
          <button class="btn" id="langBtn">${state.lang === "en" ? "TI" : "EN"}</button>
          <button class="btn" id="backToLessons">Lessons</button>
        </div>
      </div>
    </div>

    <div class="card">
      <div class="h2">Learn</div>
      <div class="p">${escapeHtml(current.learnText || "")}</div>
    </div>

    <div class="card">
      <div class="h2">Task</div>
      <div class="p">${escapeHtml(current.task || "")}</div>
    </div>

    <div class="card">
      <div class="h2">Reflection</div>
      <textarea id="reflection" placeholder="Write your reflection..."></textarea>

      <div style="height:10px"></div>

      <div class="row" style="justify-content:space-between; gap:10px; flex-wrap:wrap;">
        <div class="row" style="gap:8px; flex-wrap:wrap;">
          <button class="btn" id="prevBtn" ${hasPrev ? "" : "disabled"}>⬅ Back</button>
          <button class="btn" id="nextBtn" ${hasNext ? "" : "disabled"}>Next ➡</button>
        </div>

        <button class="btn ok" id="saveBtn">Save & Complete ✅</button>
      </div>

      <div class="small" id="msg" style="margin-top:10px"></div>
    </div>
  `);

  document.getElementById("langBtn").onclick = () => {
    state.lang = (state.lang === "en") ? "ti" : "en";
    render();
  };

  document.getElementById("backToLessons").onclick = () => setHash(`#/course/${courseId}`);

  document.getElementById("prevBtn").onclick = () => {
    if (!hasPrev) return;
    setHash(`#/lesson/${courseId}/${lessonIndex - 1}`);
  };

  document.getElementById("nextBtn").onclick = () => {
    if (!hasNext) return;
    setHash(`#/lesson/${courseId}/${lessonIndex + 1}`);
  };

  document.getElementById("saveBtn").onclick = async () => {
    const msg = document.getElementById("msg");
    msg.textContent = "Saving...";
    const reflection = document.getElementById("reflection").value || "";

    try {
      await api("/progress/update", {
        method: "POST",
        body: {
          courseId,
          lessonIndex,
          completed: true,
          reflection
        }
      });
      msg.textContent = "Saved ✅";
      alert("Saved!");
    } catch (e) {
      msg.textContent = "Save failed: " + e.message;
    }
  };
}

// ================= ROUTER =================
window.addEventListener("hashchange", render);

async function render() {
  // Always refresh auth state so nav is correct
  try { await loadMe(); } catch { state.user = null; applyAuthNav(); }

  const parts = routeParts();
  const page = parts[0] || "dashboard";

  // If not logged in: only allow login/register
  if (!state.user && page !== "login" && page !== "register") {
    setHash("#/login");
    return renderLogin();
  }

  if (page === "login") return renderLogin();
  if (page === "register") return renderRegister();

  // Logged-in pages
  await loadCourses();

  if (page === "dashboard") return renderDashboard();

  if (page === "course") {
    const courseId = parts[1];
    if (!courseId) return renderDashboard();
    return renderCourse(courseId);
  }

  if (page === "lesson") {
    const courseId = parts[1];
    const lessonIndex = parts[2];
    if (!courseId || lessonIndex === undefined) return renderDashboard();
    return renderLesson(courseId, lessonIndex);
  }

  return renderDashboard();
}

// ================= BOOT =================
(function boot() {
  if (!location.hash) setHash("#/dashboard");
  render();
})();
