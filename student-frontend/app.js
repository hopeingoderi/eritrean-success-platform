// student-frontend/app.js
// ============================================================
// Student Frontend
// Fixes:
// 1) Login/Register/Logout buttons show correctly depending on session
// 2) Lessons page includes Back/Next + Save & Complete buttons
// 3) Progress bar shown on course and lesson pages
// 4) Works on mobile (no hidden buttons / no missing handlers)
// ============================================================

const API_BASE = "https://api.riseeritrea.com/api"; // ✅ correct

// ---------- DOM ----------
const appEl = document.getElementById("app");
const yearEl = document.getElementById("year");
if (yearEl) yearEl.textContent = new Date().getFullYear();

// If your header buttons exist, we will use them.
// If not, we will render a header inside #app.
const headerEls = {
  loginBtn: document.getElementById("loginBtn"),
  registerBtn: document.getElementById("registerBtn"),
  logoutBtn: document.getElementById("logoutBtn"),
};

function escapeHtml(str = "") {
  return String(str).replace(/[&<>"']/g, (m) => ({
    "&": "&amp;",
    "<": "&lt;",
    ">": "&gt;",
    '"': "&quot;",
    "'": "&#39;",
  }[m]));
}

async function api(path, { method = "GET", body } = {}) {
  const res = await fetch(API_BASE + path, {
    method,
    headers: { "Content-Type": "application/json" },
    credentials: "include", // ✅ needed for sessions
    body: body ? JSON.stringify(body) : undefined,
  });

  const data = await res.json().catch(() => ({}));

  if (!res.ok) {
    const msg =
      typeof data.error === "string"
        ? data.error
        : "Request failed";
    throw new Error(msg);
  }
  return data;
}

// ---------- STATE ----------
let state = {
  user: null,
  lang: "en", // "en" | "ti"
  courseId: "foundation",
  lessons: [], // loaded lessons for current course & lang
  progressByLessonIndex: {}, // from /progress/course/:courseId
};

// ---------- ROUTER ----------
window.addEventListener("hashchange", render);

function routeParts() {
  return (location.hash || "#/").replace("#/", "").split("/");
}
function setHash(h) {
  location.hash = h;
}

// ---------- AUTH UI LOGIC ----------
function applyAuthButtonsVisibility() {
  // If header buttons exist, toggle them.
  const loggedIn = !!state.user;

  if (headerEls.loginBtn) headerEls.loginBtn.style.display = loggedIn ? "none" : "inline-block";
  if (headerEls.registerBtn) headerEls.registerBtn.style.display = loggedIn ? "none" : "inline-block";
  if (headerEls.logoutBtn) headerEls.logoutBtn.style.display = loggedIn ? "inline-block" : "none";

  // If buttons exist, attach handlers once (safe re-attach)
  if (headerEls.loginBtn) headerEls.loginBtn.onclick = () => setHash("#/login");
  if (headerEls.registerBtn) headerEls.registerBtn.onclick = () => setHash("#/register");
  if (headerEls.logoutBtn) headerEls.logoutBtn.onclick = logout;
}

async function loadMe() {
  const r = await api("/auth/me");
  state.user = r.user;
  applyAuthButtonsVisibility();
}

async function logout() {
  try { await api("/auth/logout", { method: "POST" }); } catch {}
  state.user = null;
  applyAuthButtonsVisibility();
  setHash("#/login");
  render();
}

// ---------- DATA ----------
async function loadLessons(courseId, lang) {
  const r = await api(`/lessons/${courseId}?lang=${lang}`);
  state.lessons = r.lessons || [];
}

async function loadProgress(courseId) {
  const r = await api(`/progress/course/${courseId}`);
  state.progressByLessonIndex = r.byLessonIndex || {};
}

// ---------- UI HELPERS ----------
function normalizeLessonIndexParam(x) {
  const n = Number(x);
  return Number.isFinite(n) ? n : 0;
}

function renderInlineHeaderIfMissing() {
  // If your HTML already has a header, do nothing.
  // Otherwise we create a simple header bar inside app.
  if (headerEls.loginBtn || headerEls.registerBtn || headerEls.logoutBtn) return;

  appEl.innerHTML = `
    <div class="card">
      <div class="row" style="justify-content:space-between;align-items:center;">
        <div>
          <div class="h1">Eritrean Success Journey</div>
          <div class="small">Learn • Grow • Believe • Succeed</div>
        </div>
        <div class="row" style="gap:8px;flex-wrap:wrap;">
          <button class="btn" id="loginBtnX">Login</button>
          <button class="btn" id="registerBtnX">Register</button>
          <button class="btn danger" id="logoutBtnX">Logout</button>
        </div>
      </div>
    </div>
    <div id="page"></div>
  `;

  // remap "appEl" to #page for page rendering
  const page = document.getElementById("page");

  headerEls.loginBtn = document.getElementById("loginBtnX");
  headerEls.registerBtn = document.getElementById("registerBtnX");
  headerEls.logoutBtn = document.getElementById("logoutBtnX");

  // move app rendering target
  appEl._page = page;
  applyAuthButtonsVisibility();
}

function pageEl() {
  // if we created inline header wrapper, render pages into #page
  return appEl._page || appEl;
}

function progressSummary(courseId) {
  const total = state.lessons.length || 0;
  let completed = 0;
  for (const k of Object.keys(state.progressByLessonIndex || {})) {
    if (state.progressByLessonIndex[k]?.completed) completed++;
  }
  const pct = total > 0 ? Math.round((completed / total) * 100) : 0;
  return { total, completed, pct, courseId };
}

function progressBarHtml({ pct, completed, total }) {
  return `
    <div style="margin:10px 0 6px 0;">
      <div class="small">Progress: <b>${completed}</b> / <b>${total}</b> (${pct}%)</div>
      <div style="height:10px;background:rgba(255,255,255,0.12);border-radius:999px;overflow:hidden;">
        <div style="height:10px;width:${pct}%;background:rgba(255,255,255,0.6);"></div>
      </div>
    </div>
  `;
}

// ---------- PAGES ----------
function renderLogin() {
  const el = pageEl();
  el.innerHTML = `
    <div class="card">
      <div class="h1">Login</div>

      <label>Email</label>
      <input id="email" type="email" placeholder="you@example.com" />

      <label>Password</label>
      <input id="password" type="password" placeholder="••••••••" />

      <div style="height:12px"></div>
      <button class="btn primary" id="doLogin">Login</button>
      <div class="small" id="msg" style="margin-top:10px"></div>
    </div>
  `;

  document.getElementById("doLogin").onclick = async () => {
    const email = document.getElementById("email").value.trim();
    const password = document.getElementById("password").value.trim();
    const msg = document.getElementById("msg");
    msg.textContent = "";

    try {
      const r = await api("/auth/login", { method: "POST", body: { email, password } });
      state.user = r.user;
      applyAuthButtonsVisibility();
      setHash("#/courses");
      render();
    } catch (e) {
      msg.textContent = "Login failed: " + e.message;
    }
  };
}

function renderRegister() {
  const el = pageEl();
  el.innerHTML = `
    <div class="card">
      <div class="h1">Register</div>

      <label>Name</label>
      <input id="name" type="text" placeholder="Your name" />

      <label>Email</label>
      <input id="email" type="email" placeholder="you@example.com" />

      <label>Password</label>
      <input id="password" type="password" placeholder="••••••••" />

      <div style="height:12px"></div>
      <button class="btn primary" id="doRegister">Create account</button>
      <div class="small" id="msg" style="margin-top:10px"></div>
    </div>
  `;

  document.getElementById("doRegister").onclick = async () => {
    const name = document.getElementById("name").value.trim();
    const email = document.getElementById("email").value.trim();
    const password = document.getElementById("password").value.trim();
    const msg = document.getElementById("msg");
    msg.textContent = "";

    try {
      const r = await api("/auth/register", { method: "POST", body: { name, email, password } });
      state.user = r.user;
      applyAuthButtonsVisibility();
      setHash("#/courses");
      render();
    } catch (e) {
      msg.textContent = "Register failed: " + e.message;
    }
  };
}

async function renderCourses() {
  // Default course order (fix your “wrong order” issue)
  const courses = [
    { id: "foundation", title: "Foundation" },
    { id: "growth", title: "Growth" },
    { id: "excellence", title: "Excellence" },
  ];

  const el = pageEl();
  el.innerHTML = `
    <div class="card">
      <div class="row" style="justify-content:space-between;align-items:center;flex-wrap:wrap;">
        <div>
          <div class="h1">Lessons</div>
          <div class="small">Welcome ${state.user ? `<b>${escapeHtml(state.user.name || "")}</b>` : ""}</div>
        </div>

        <div class="row" style="gap:8px;flex-wrap:wrap;">
          <button class="btn" id="langBtn">Language: ${state.lang === "en" ? "English" : "Tigrinya"}</button>
        </div>
      </div>
    </div>

    <div class="grid two">
      ${courses.map(c => `
        <div class="card">
          <div class="h2">${c.title}</div>
          <div class="small">Course ID: ${escapeHtml(c.id)}</div>
          <div style="height:10px"></div>
          <button class="btn primary" data-course="${c.id}">Open</button>
        </div>
      `).join("")}
    </div>
  `;

  document.getElementById("langBtn").onclick = () => {
    state.lang = state.lang === "en" ? "ti" : "en";
    render();
  };

  [...el.querySelectorAll("button[data-course]")].forEach(btn => {
    btn.onclick = () => {
      const courseId = btn.getAttribute("data-course");
      setHash(`#/course/${courseId}`);
    };
  });
}

async function renderCourseLessons(courseId) {
  state.courseId = courseId;

  await loadLessons(courseId, state.lang);
  await loadProgress(courseId);

  const prog = progressSummary(courseId);

  const el = pageEl();
  el.innerHTML = `
    <div class="card">
      <div class="row" style="justify-content:space-between;align-items:center;flex-wrap:wrap;">
        <div>
          <div class="h1">${escapeHtml(courseId)}</div>
          <div class="small">Choose a lesson</div>
        </div>
        <div class="row" style="gap:8px;flex-wrap:wrap;">
          <button class="btn" id="backCourses">Back</button>
          <button class="btn" id="langBtn">Language: ${state.lang === "en" ? "English" : "Tigrinya"}</button>
        </div>
      </div>

      ${progressBarHtml(prog)}
    </div>

    <div class="card">
      ${state.lessons.map(l => {
        const done = !!state.progressByLessonIndex?.[l.lessonIndex]?.completed;
        return `
          <div class="row" style="justify-content:space-between;align-items:center;gap:10px;flex-wrap:wrap;">
            <div>
              <div><b>${escapeHtml(l.title || "")}</b></div>
              <div class="small">Lesson ${l.lessonIndex} ${done ? "✅ Completed" : ""}</div>
            </div>
            <button class="btn primary" data-lesson="${l.lessonIndex}">Open</button>
          </div>
          <hr/>
        `;
      }).join("")}
    </div>
  `;

  document.getElementById("backCourses").onclick = () => setHash("#/courses");
  document.getElementById("langBtn").onclick = () => {
    state.lang = state.lang === "en" ? "ti" : "en";
    render();
  };

  [...el.querySelectorAll("button[data-lesson]")].forEach(btn => {
    btn.onclick = () => {
      const idx = btn.getAttribute("data-lesson");
      setHash(`#/lesson/${courseId}/${idx}`);
    };
  });
}

async function renderLesson(courseId, lessonIndexParam) {
  state.courseId = courseId;
  const lessonIndex = normalizeLessonIndexParam(lessonIndexParam);

  await loadLessons(courseId, state.lang);
  await loadProgress(courseId);

  const lesson = state.lessons.find(x => x.lessonIndex === lessonIndex);
  if (!lesson) {
    const el = pageEl();
    el.innerHTML = `
      <div class="card">
        <div class="h1">Lesson not found</div>
        <button class="btn" id="back">Back</button>
      </div>
    `;
    document.getElementById("back").onclick = () => setHash(`#/course/${courseId}`);
    return;
  }

  const prog = progressSummary(courseId);
  const prevIdx = lessonIndex > 0 ? lessonIndex - 1 : null;
  const nextIdx = lessonIndex < state.lessons.length - 1 ? lessonIndex + 1 : null;

  const currentProgress = state.progressByLessonIndex?.[lessonIndex] || {};
  const existingReflection = currentProgress.reflectionText || "";

  const el = pageEl();
  el.innerHTML = `
    <div class="card">
      <div class="row" style="justify-content:space-between;align-items:center;gap:10px;flex-wrap:wrap;">
        <div>
          <div class="h1">${escapeHtml(lesson.title || "")}</div>
          <div class="small">${escapeHtml(courseId)} • Lesson ${lessonIndex}</div>
        </div>

        <div class="row" style="gap:8px;flex-wrap:wrap;">
          <button class="btn" id="backToList">Back to lessons</button>
          <button class="btn" id="langBtn">Language: ${state.lang === "en" ? "English" : "Tigrinya"}</button>
        </div>
      </div>

      ${progressBarHtml(prog)}
    </div>

    <div class="card">
      <div class="h2">Learn</div>
      <div class="p">${escapeHtml(lesson.learnText || "")}</div>

      <div style="height:12px"></div>
      <div class="h2">Task</div>
      <div class="p">${escapeHtml(lesson.task || "")}</div>

      <div style="height:12px"></div>
      <div class="h2">Reflection</div>
      <textarea id="reflection" placeholder="Write your reflection...">${escapeHtml(existingReflection)}</textarea>

      <div style="height:12px"></div>

      <div class="row" style="gap:10px;flex-wrap:wrap;">
        <button class="btn primary" id="saveBtn">Save</button>
        <button class="btn ok" id="completeBtn">Save & Complete ✅</button>
      </div>

      <div class="small" id="msg" style="margin-top:10px"></div>

      <hr/>

      <div class="row" style="justify-content:space-between;gap:10px;flex-wrap:wrap;">
        <button class="btn" id="prevBtn" ${prevIdx === null ? "disabled" : ""}>← Back</button>
        <button class="btn" id="nextBtn" ${nextIdx === null ? "disabled" : ""}>Next →</button>
      </div>
    </div>
  `;

  document.getElementById("backToList").onclick = () => setHash(`#/course/${courseId}`);
  document.getElementById("langBtn").onclick = () => {
    state.lang = state.lang === "en" ? "ti" : "en";
    render();
  };

  const msg = document.getElementById("msg");

  async function save(completed) {
    msg.textContent = "";
    const reflection = document.getElementById("reflection").value || "";

    try {
      await api("/progress/update", {
        method: "POST",
        body: {
          courseId,
          lessonIndex,
          reflection,
          completed: completed === true ? true : undefined
        }
      });

      msg.textContent = completed ? "Saved & completed ✅" : "Saved ✅";
      await loadProgress(courseId);
    } catch (e) {
      msg.textContent = "Save failed: " + e.message;
    }
  }

  document.getElementById("saveBtn").onclick = () => save(false);
  document.getElementById("completeBtn").onclick = () => save(true);

  document.getElementById("prevBtn").onclick = () => {
    if (prevIdx === null) return;
    setHash(`#/lesson/${courseId}/${prevIdx}`);
  };
  document.getElementById("nextBtn").onclick = () => {
    if (nextIdx === null) return;
    setHash(`#/lesson/${courseId}/${nextIdx}`);
  };
}

// ---------- MAIN RENDER ----------
async function render() {
  renderInlineHeaderIfMissing();

  try { await loadMe(); }
  catch { state.user = null; applyAuthButtonsVisibility(); }

  const parts = routeParts();
  const page = parts[0] || "";

  // Not logged in -> only login/register pages
  if (!state.user) {
    if (page === "register") return renderRegister();
    return renderLogin();
  }

  // Logged in routes
  if (page === "" || page === "courses") return renderCourses();

  if (page === "course") {
    const courseId = parts[1] || "foundation";
    return renderCourseLessons(courseId);
  }

  if (page === "lesson") {
    const courseId = parts[1] || "foundation";
    const lessonIndex = parts[2] || "0";
    return renderLesson(courseId, lessonIndex);
  }

  // fallback
  setHash("#/courses");
}

(function boot() {
  if (!location.hash) setHash("#/login");
  render();
})();
