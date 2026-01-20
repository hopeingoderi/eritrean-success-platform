// student/app.js
// ============================================================
// Student Frontend (works with YOUR current student/index.html)
// - Uses go('login') / go('register') / logout() from HTML
// - Fixes navbar visibility (Login/Register vs Logout)
// - Fixes "undefined" courses by mapping API fields correctly
// - Sorts courses: foundation -> growth -> excellence
// - Adds course progress bar
// - Adds lesson page with Back / Next / Return + Save & Complete
// ============================================================

// ================= CONFIG =================
const API_BASE = "https://api.riseeritrea.com/api"; // ✅ correct

// ================= DOM =================
const appEl = document.getElementById("app");
const navEl = document.getElementById("nav");

// ================= STATE =================
const state = {
  user: null,
  lang: "en", // "en" | "ti"
  courses: [],
  lessonsByCourse: {},     // courseId -> lessons[]
  progressByCourse: {},    // courseId -> { byLessonIndex: { [idx]: {completed, reflectionText} } }
};

// ================= HELPERS =================
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
    credentials: "include",
    body: body ? JSON.stringify(body) : undefined,
  });

  const data = await res.json().catch(() => ({}));

  if (!res.ok) {
    const msg = typeof data.error === "string" ? data.error : "Request failed";
    throw new Error(msg);
  }
  return data;
}

function isLoggedIn() {
  return !!state.user;
}

// Nav buttons are currently inline in HTML; we will hide/show them here.
function setNavVisibility() {
  if (!navEl) return;
  const buttons = navEl.querySelectorAll("button");
  if (buttons.length < 3) return;

  const btnLogin = buttons[0];
  const btnRegister = buttons[1];
  const btnLogout = buttons[2];

  if (state.user) {
    btnLogin.style.display = "none";
    btnRegister.style.display = "none";
    btnLogout.style.display = "inline-block";
  } else {
    btnLogin.style.display = "inline-block";
    btnRegister.style.display = "inline-block";
    btnLogout.style.display = "none";
  }
}

async function loadMe() {
  const r = await api("/auth/me");
  state.user = r.user;
  setNavVisibility();
}

function courseTitle(c) {
  // API returns title_en/title_ti
  if (state.lang === "ti") return c.title_ti || c.title_en || c.id;
  return c.title_en || c.title_ti || c.id;
}

function courseDesc(c) {
  // API returns description_en/description_ti
  if (state.lang === "ti") return c.description_ti || c.description_en || "";
  return c.description_en || c.description_ti || "";
}

function sortCourses(list) {
  const order = { foundation: 1, growth: 2, excellence: 3 };
  return [...list].sort((a, b) => {
    const ao = (typeof a.order === "number" ? a.order : order[a.id] || 999);
    const bo = (typeof b.order === "number" ? b.order : order[b.id] || 999);
    return ao - bo;
  });
}

async function loadCourses() {
  const r = await api(`/courses?lang=${state.lang}`);
  state.courses = sortCourses(Array.isArray(r.courses) ? r.courses : []);
}

async function loadLessons(courseId) {
  const r = await api(`/lessons/${courseId}?lang=${state.lang}`);
  state.lessonsByCourse[courseId] = Array.isArray(r.lessons) ? r.lessons : [];
}

async function loadProgress(courseId) {
  const r = await api(`/progress/course/${courseId}`);
  // expected shape: { byLessonIndex: { "0": {completed, reflectionText}, ... } }
  state.progressByCourse[courseId] = r || { byLessonIndex: {} };
}

function getProgress(courseId, lessonIndex) {
  return (
    state.progressByCourse?.[courseId]?.byLessonIndex?.[lessonIndex] || {
      completed: false,
      reflectionText: "",
    }
  );
}

// ================= ROUTING (simple, hash-based) =================
function go(page) {
  // page can be: 'login', 'register', 'dashboard'
  location.hash = `#${page}`;
  render();
}

// Expose go() because your HTML calls it
window.go = go;

// ================= RENDER =================
async function render() {
  // try to load session (does not crash if not logged in)
  try {
    await loadMe();
  } catch {
    state.user = null;
    setNavVisibility();
  }

  const hash = (location.hash || "#dashboard").replace("#", "");
  const [page, a, b] = hash.split("/");

  // Public pages
  if (page === "login") return renderLogin();
  if (page === "register") return renderRegister();

  // Everything else requires login
  if (!isLoggedIn()) {
    location.hash = "#login";
    return renderLogin();
  }

  // Protected pages
  if (page === "dashboard" || page === "") return renderDashboard();
  if (page === "course") return renderCourse(a);
  if (page === "lesson") return renderLesson(a, b);

  // fallback
  location.hash = "#dashboard";
  return renderDashboard();
}

// ================= LOGIN =================
function renderLogin() {
  appEl.innerHTML = `
    <div class="card">
      <div class="h1">Login</div>

      <label>Email</label>
      <input id="email" type="email" placeholder="you@example.com" />

      <label>Password</label>
      <input id="password" type="password" placeholder="••••••••" />

      <div style="height:12px"></div>
      <button class="btn primary" id="loginBtn">Login</button>
      <div class="small" id="msg" style="margin-top:10px"></div>
    </div>
  `;

  document.getElementById("loginBtn").onclick = async () => {
    const email = document.getElementById("email").value.trim();
    const password = document.getElementById("password").value.trim();
    const msg = document.getElementById("msg");
    msg.textContent = "";

    try {
      const r = await api("/auth/login", {
        method: "POST",
        body: { email, password },
      });
      state.user = r.user;
      setNavVisibility();
      location.hash = "#dashboard";
      render();
    } catch (e) {
      msg.textContent = "Login failed: " + e.message;
    }
  };
}

// ================= REGISTER =================
function renderRegister() {
  appEl.innerHTML = `
    <div class="card">
      <div class="h1">Register</div>

      <label>Name</label>
      <input id="name" type="text" placeholder="Your name" />

      <label>Email</label>
      <input id="email" type="email" placeholder="you@example.com" />

      <label>Password</label>
      <input id="password" type="password" placeholder="min 6 characters" />

      <div style="height:12px"></div>
      <button class="btn primary" id="regBtn">Create account</button>
      <div class="small" id="msg" style="margin-top:10px"></div>
    </div>
  `;

  document.getElementById("regBtn").onclick = async () => {
    const name = document.getElementById("name").value.trim();
    const email = document.getElementById("email").value.trim();
    const password = document.getElementById("password").value.trim();
    const msg = document.getElementById("msg");
    msg.textContent = "";

    try {
      const r = await api("/auth/register", {
        method: "POST",
        body: { name, email, password },
      });
      state.user = r.user;
      setNavVisibility();
      location.hash = "#dashboard";
      render();
    } catch (e) {
      msg.textContent = "Register failed: " + e.message;
    }
  };
}

// ================= DASHBOARD =================
async function renderDashboard() {
  appEl.innerHTML = `
    <div class="card">
      <div class="row">
        <div>
          <div class="h1">Your Levels</div>
          <div class="small">Welcome, <b>${escapeHtml(state.user?.name || "")}</b></div>
        </div>
        <div class="row" style="justify-content:flex-end; gap:8px;">
          <button class="btn" id="langEn">English</button>
          <button class="btn" id="langTi">ትግርኛ</button>
        </div>
      </div>
    </div>

    <div id="coursesWrap"></div>
  `;

  document.getElementById("langEn").onclick = async () => {
    state.lang = "en";
    await loadCourses();
    renderDashboard();
  };
  document.getElementById("langTi").onclick = async () => {
    state.lang = "ti";
    await loadCourses();
    renderDashboard();
  };

  const wrap = document.getElementById("coursesWrap");
  wrap.innerHTML = `<div class="card"><div class="small">Loading courses...</div></div>`;

  try {
    await loadCourses();
  } catch (e) {
    wrap.innerHTML = `<div class="card"><div class="small">Failed to load courses: ${escapeHtml(e.message)}</div></div>`;
    return;
  }

  wrap.innerHTML = state.courses
    .map(
      (c) => `
      <div class="card">
        <div class="h2">${escapeHtml(courseTitle(c))}</div>
        <div class="p">${escapeHtml(courseDesc(c))}</div>
        <button class="btn primary" data-open="${escapeHtml(c.id)}">Open</button>
      </div>
    `
    )
    .join("");

  wrap.querySelectorAll("[data-open]").forEach((btn) => {
    btn.addEventListener("click", () => {
      const courseId = btn.getAttribute("data-open");
      location.hash = `#course/${courseId}`;
      render();
    });
  });
}

// ================= COURSE PAGE =================
async function renderCourse(courseId) {
  if (!courseId) {
    location.hash = "#dashboard";
    return render();
  }

  appEl.innerHTML = `
    <div class="card">
      <div class="row">
        <div>
          <div class="h1">Lessons</div>
          <div class="small">Course: <b>${escapeHtml(courseId)}</b></div>
        </div>
        <div class="row" style="justify-content:flex-end; gap:8px;">
          <button class="btn" id="backDash">Back</button>
        </div>
      </div>

      <div style="height:10px"></div>
      <div id="courseProgress"></div>
    </div>

    <div id="lessonsWrap"></div>
  `;

  document.getElementById("backDash").onclick = () => {
    location.hash = "#dashboard";
    render();
  };

  const lessonsWrap = document.getElementById("lessonsWrap");
  lessonsWrap.innerHTML = `<div class="card"><div class="small">Loading lessons...</div></div>`;

  try {
    await loadLessons(courseId);
    await loadProgress(courseId);
  } catch (e) {
    lessonsWrap.innerHTML = `<div class="card"><div class="small">Failed: ${escapeHtml(e.message)}</div></div>`;
    return;
  }

  const lessons = state.lessonsByCourse[courseId] || [];
  const pmap = state.progressByCourse?.[courseId]?.byLessonIndex || {};

  const total = lessons.length || 0;
  const completed = Object.values(pmap).filter((x) => x && x.completed).length;
  const pct = total > 0 ? Math.round((completed / total) * 100) : 0;

  document.getElementById("courseProgress").innerHTML = `
    <div class="small">Progress: <b>${completed}</b> / ${total} (${pct}%)</div>
    <div class="progressWrap" style="margin-top:8px;">
      <div class="progressBar" style="width:${pct}%"></div>
    </div>
  `;

  lessonsWrap.innerHTML = lessons
    .sort((a, b) => (a.lessonIndex ?? 0) - (b.lessonIndex ?? 0))
    .map((l) => {
      const idx = l.lessonIndex ?? 0;
      const done = !!pmap[idx]?.completed;
      return `
        <div class="card">
          <div class="row">
            <div>
              <div class="h2">${escapeHtml(l.title || `Lesson ${idx + 1}`)}</div>
              <div class="small">Lesson ${idx + 1} ${done ? "✅ Completed" : ""}</div>
            </div>
            <button class="btn secondary" data-open-lesson="${idx}">Open</button>
          </div>
        </div>
      `;
    })
    .join("");

  lessonsWrap.querySelectorAll("[data-open-lesson]").forEach((btn) => {
    btn.addEventListener("click", () => {
      const idx = btn.getAttribute("data-open-lesson");
      location.hash = `#lesson/${courseId}/${idx}`;
      render();
    });
  });
}

// ================= LESSON PAGE =================
async function renderLesson(courseId, lessonIndexStr) {
  const lessonIndex = Number(lessonIndexStr);
  if (!courseId || !Number.isFinite(lessonIndex)) {
    location.hash = "#dashboard";
    return render();
  }

  appEl.innerHTML = `
    <div class="card">
      <div class="row">
        <div>
          <div class="h1">Lesson ${lessonIndex + 1}</div>
          <div class="small">Course: <b>${escapeHtml(courseId)}</b></div>
        </div>
        <div class="row" style="justify-content:flex-end; gap:8px;">
          <button class="btn" id="returnCourse">Return</button>
        </div>
      </div>
      <div style="height:10px"></div>
      <div id="lessonProgress"></div>
    </div>

    <div class="card" id="lessonCard">
      <div class="small">Loading...</div>
    </div>
  `;

  document.getElementById("returnCourse").onclick = () => {
    location.hash = `#course/${courseId}`;
    render();
  };

  try {
    if (!state.lessonsByCourse[courseId]) await loadLessons(courseId);
    await loadProgress(courseId);
  } catch (e) {
    document.getElementById("lessonCard").innerHTML = `<div class="small">Failed: ${escapeHtml(e.message)}</div>`;
    return;
  }

  const lessons = state.lessonsByCourse[courseId] || [];
  const lesson = lessons.find((x) => x.lessonIndex === lessonIndex);

  if (!lesson) {
    document.getElementById("lessonCard").innerHTML = `<div class="small">Lesson not found.</div>`;
    return;
  }

  // progress bar
  const pmap = state.progressByCourse?.[courseId]?.byLessonIndex || {};
  const total = lessons.length;
  const completed = Object.values(pmap).filter((x) => x && x.completed).length;
  const pct = total > 0 ? Math.round((completed / total) * 100) : 0;

  document.getElementById("lessonProgress").innerHTML = `
    <div class="small">Course progress: <b>${completed}</b> / ${total} (${pct}%)</div>
    <div class="progressWrap" style="margin-top:8px;">
      <div class="progressBar" style="width:${pct}%"></div>
    </div>
  `;

  const prevExists = lessons.some((x) => x.lessonIndex === lessonIndex - 1);
  const nextExists = lessons.some((x) => x.lessonIndex === lessonIndex + 1);

  const existing = getProgress(courseId, lessonIndex);

  document.getElementById("lessonCard").innerHTML = `
    <div class="h2">${escapeHtml(lesson.title || "")}</div>

    <hr/>

    <div class="h2">Learn</div>
    <div class="p">${escapeHtml(lesson.learnText || "")}</div>

    <div style="height:10px"></div>

    <div class="h2">Task</div>
    <div class="p">${escapeHtml(lesson.task || "")}</div>

    <hr/>

    <div class="h2">Reflection</div>
    <textarea id="reflection" placeholder="Write your reflection...">${escapeHtml(existing.reflectionText || "")}</textarea>

    <div style="height:10px"></div>

    <div class="row" style="justify-content:flex-start; gap:8px;">
      <button class="btn" id="prevBtn" ${prevExists ? "" : "disabled"}>Back</button>
      <button class="btn" id="nextBtn" ${nextExists ? "" : "disabled"}>Next</button>
      <button class="btn primary" id="saveBtn">Save & Complete</button>
    </div>

    <div class="small" id="saveMsg" style="margin-top:10px"></div>
  `;

  document.getElementById("prevBtn").onclick = () => {
    if (!prevExists) return;
    location.hash = `#lesson/${courseId}/${lessonIndex - 1}`;
    render();
  };

  document.getElementById("nextBtn").onclick = () => {
    if (!nextExists) return;
    location.hash = `#lesson/${courseId}/${lessonIndex + 1}`;
    render();
  };

  document.getElementById("saveBtn").onclick = async () => {
    const msg = document.getElementById("saveMsg");
    msg.textContent = "Saving...";

    const reflection = document.getElementById("reflection").value || "";

    try {
      await api("/progress/update", {
        method: "POST",
        body: {
          courseId,
          lessonIndex,
          reflection,
          completed: true,
        },
      });

      msg.textContent = "Saved ✅";
      await loadProgress(courseId);

      // optional: auto next
      if (nextExists) {
        setTimeout(() => {
          location.hash = `#lesson/${courseId}/${lessonIndex + 1}`;
          render();
        }, 300);
      }
    } catch (e) {
      msg.textContent = "Save failed: " + e.message;
    }
  };
}

// ================= LOGOUT (HTML calls logout()) =================
async function logout() {
  try {
    await api("/auth/logout", { method: "POST" });
  } catch {}

  state.user = null;
  setNavVisibility();
  location.hash = "#login";
  render();
}

// Expose logout() because your HTML calls it
window.logout = logout;

// ================= BOOT =================
window.addEventListener("hashchange", render);

(function boot() {
  if (!location.hash) location.hash = "#dashboard";
  render();
})();
