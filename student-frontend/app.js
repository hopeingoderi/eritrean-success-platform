// student-frontend/app.js
// ============================================================
// Student Frontend (SPA)
// Fixes:
// - Correct API_BASE
// - Courses not "undefined" (maps title_en/title_ti + description_en/description_ti)
// - Sort courses by order: foundation -> growth -> excellence
// - Proper Login/Register/Logout visibility
// - Lesson page: Back/Next/Return + Save & Complete
// - Progress bar from /progress/course/:courseId
// ============================================================

// ================= CONFIG =================
const API_BASE = "https://api.riseeritrea.com/api"; // ✅ correct

// ================= DOM =================
const appEl = document.getElementById("app");
const yearEl = document.getElementById("year");
if (yearEl) yearEl.textContent = new Date().getFullYear();

// header buttons (must exist in your index.html)
const btnLogin = document.getElementById("btnLogin");
const btnRegister = document.getElementById("btnRegister");
const btnLogout = document.getElementById("btnLogout");

// ================= STATE =================
const state = {
  user: null,
  lang: "en", // "en" | "ti"
  courses: [],
  lessonsByCourse: {},       // courseId -> lessons[]
  progressByCourse: {},      // courseId -> { byLessonIndex: {...} }
};

// ================= HELPERS =================
function escapeHtml(str = "") {
  return String(str).replace(/[&<>"']/g, (m) => ({
    "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;"
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
  if (location.hash !== h) location.hash = h;
}

function routeParts() {
  return (location.hash || "#/dashboard").replace("#/", "").split("/");
}

function courseTitle(c) {
  return state.lang === "ti" ? (c.title_ti || c.title_en || "") : (c.title_en || c.title_ti || "");
}

function courseDesc(c) {
  return state.lang === "ti"
    ? (c.description_ti || c.description_en || "")
    : (c.description_en || c.description_ti || "");
}

function lessonTitle(lesson) {
  // lessons endpoint already returns { title, learnText, task, quiz }
  return lesson?.title || "";
}

function progressFor(courseId, lessonIndex) {
  const p = state.progressByCourse[courseId]?.byLessonIndex?.[lessonIndex];
  return p || { completed: false, reflectionText: "" };
}

function isLoggedIn() {
  return !!state.user;
}

// ================= AUTH UI LOGIC =================
function updateAuthButtons() {
  if (!btnLogin || !btnRegister || !btnLogout) return;

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
  // /auth/me returns { user: null } or { user: {...} }
  const r = await api("/auth/me");
  state.user = r.user;
  updateAuthButtons();
}

// ================= DATA LOADERS =================
async function loadCourses() {
  const r = await api(`/courses?lang=${state.lang}`);
  // expected: { courses: [{id, order, title_en, title_ti, description_en, description_ti}, ...] }
  state.courses = Array.isArray(r.courses) ? r.courses : [];

  // ✅ sort by "order" if exists, else fallback by known ids
  const fallbackOrder = { foundation: 1, growth: 2, excellence: 3 };
  state.courses.sort((a, b) => {
    const ao = (typeof a.order === "number" ? a.order : fallbackOrder[a.id] || 999);
    const bo = (typeof b.order === "number" ? b.order : fallbackOrder[b.id] || 999);
    return ao - bo;
  });
}

async function loadLessons(courseId) {
  // /lessons/:courseId requires auth
  const r = await api(`/lessons/${courseId}?lang=${state.lang}`);
  const lessons = Array.isArray(r.lessons) ? r.lessons : [];
  state.lessonsByCourse[courseId] = lessons;
}

async function loadProgress(courseId) {
  // /progress/course/:courseId requires auth
  const r = await api(`/progress/course/${courseId}`);
  state.progressByCourse[courseId] = r;
}

// ================= RENDER PAGES =================
async function render() {
  // always try load me (doesn't crash if not logged in)
  try { await loadMe(); } catch { state.user = null; updateAuthButtons(); }

  const parts = routeParts();
  const page = parts[0] || "dashboard";

  if (page === "login") return renderLogin();
  if (page === "register") return renderRegister();

  // protected pages
  if (!isLoggedIn()) {
    setHash("#/login");
    return renderLogin();
  }

  if (page === "dashboard") return renderDashboard();
  if (page === "course") return renderCourse(parts[1]);           // #/course/:courseId
  if (page === "lesson") return renderLesson(parts[1], parts[2]); // #/lesson/:courseId/:lessonIndex

  // fallback
  setHash("#/dashboard");
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
      const r = await api("/auth/login", { method: "POST", body: { email, password } });
      state.user = r.user;
      updateAuthButtons();
      setHash("#/dashboard");
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
      const r = await api("/auth/register", { method: "POST", body: { name, email, password } });
      state.user = r.user;
      updateAuthButtons();
      setHash("#/dashboard");
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
      <div class="row" style="justify-content:space-between; align-items:center;">
        <div>
          <div class="h1">Your Levels</div>
          <div class="small">Welcome, <b>${escapeHtml(state.user?.name || "")}</b></div>
        </div>

        <div class="row" style="gap:8px;">
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

  // load courses
  try {
    await loadCourses();
  } catch (e) {
    document.getElementById("coursesWrap").innerHTML =
      `<div class="card"><div class="small">Failed to load courses: ${escapeHtml(e.message)}</div></div>`;
    return;
  }

  // render courses
  const html = state.courses.map(c => {
    const title = courseTitle(c);
    const desc = courseDesc(c);
    return `
      <div class="card">
        <div class="h2">${escapeHtml(title)}</div>
        <div class="p">${escapeHtml(desc)}</div>
        <button class="btn ok" data-open-course="${escapeHtml(c.id)}">Open</button>
      </div>
    `;
  }).join("");

  const wrap = document.getElementById("coursesWrap");
  wrap.innerHTML = html || `<div class="card"><div class="small">No courses found.</div></div>`;

  // attach handlers
  wrap.querySelectorAll("[data-open-course]").forEach(btn => {
    btn.addEventListener("click", () => {
      const id = btn.getAttribute("data-open-course");
      setHash(`#/course/${id}`);
      render();
    });
  });
}

// ================= COURSE PAGE =================
async function renderCourse(courseId) {
  if (!courseId) {
    setHash("#/dashboard");
    return render();
  }

  appEl.innerHTML = `
    <div class="card">
      <div class="row" style="justify-content:space-between; align-items:center;">
        <div>
          <div class="h1">Lessons</div>
          <div class="small">Course: <b>${escapeHtml(courseId)}</b></div>
        </div>
        <div class="row" style="gap:8px;">
          <button class="btn" id="backDash">Back</button>
        </div>
      </div>
      <div id="courseProgress" style="margin-top:10px;"></div>
    </div>

    <div id="lessonsWrap"></div>
  `;

  document.getElementById("backDash").onclick = () => {
    setHash("#/dashboard");
    render();
  };

  try {
    await loadLessons(courseId);
    await loadProgress(courseId);
  } catch (e) {
    document.getElementById("lessonsWrap").innerHTML =
      `<div class="card"><div class="small">Failed to load lessons/progress: ${escapeHtml(e.message)}</div></div>`;
    return;
  }

  const lessons = state.lessonsByCourse[courseId] || [];
  const pmap = state.progressByCourse[courseId]?.byLessonIndex || {};

  const total = lessons.length;
  const completed = Object.values(pmap).filter(x => x && x.completed).length;
  const pct = total > 0 ? Math.round((completed / total) * 100) : 0;

  document.getElementById("courseProgress").innerHTML = `
    <div class="small">Progress: <b>${completed}</b> / ${total} (${pct}%)</div>
    <div style="height:10px; background:#1c2b3a; border-radius:8px; overflow:hidden; margin-top:6px;">
      <div style="height:10px; width:${pct}%; background:#4caf50;"></div>
    </div>
  `;

  const listHtml = lessons
    .sort((a, b) => a.lessonIndex - b.lessonIndex)
    .map(l => {
      const done = !!pmap[l.lessonIndex]?.completed;
      return `
        <div class="card">
          <div class="row" style="justify-content:space-between; align-items:center;">
            <div>
              <div class="h2">${escapeHtml(lessonTitle(l))}</div>
              <div class="small">Lesson ${l.lessonIndex + 1} ${done ? "✅" : ""}</div>
            </div>
            <button class="btn ok" data-open-lesson="${l.lessonIndex}">Open</button>
          </div>
        </div>
      `;
    }).join("");

  const wrap = document.getElementById("lessonsWrap");
  wrap.innerHTML = listHtml || `<div class="card"><div class="small">No lessons found.</div></div>`;

  wrap.querySelectorAll("[data-open-lesson]").forEach(btn => {
    btn.addEventListener("click", () => {
      const idx = btn.getAttribute("data-open-lesson");
      setHash(`#/lesson/${courseId}/${idx}`);
      render();
    });
  });
}

// ================= LESSON PAGE =================
async function renderLesson(courseId, lessonIndexStr) {
  if (!courseId) {
    setHash("#/dashboard");
    return render();
  }

  const lessonIndex = Number(lessonIndexStr);
  if (!Number.isFinite(lessonIndex)) {
    setHash(`#/course/${courseId}`);
    return render();
  }

  appEl.innerHTML = `
    <div class="card">
      <div class="row" style="justify-content:space-between; align-items:center;">
        <div>
          <div class="h1">Lesson</div>
          <div class="small">Course: <b>${escapeHtml(courseId)}</b> • Lesson: <b>${lessonIndex + 1}</b></div>
        </div>
        <div class="row" style="gap:8px;">
          <button class="btn" id="returnCourse">Return</button>
        </div>
      </div>

      <div id="lessonProgressBar" style="margin-top:10px;"></div>
    </div>

    <div class="card" id="lessonCard">
      <div class="small">Loading...</div>
    </div>
  `;

  document.getElementById("returnCourse").onclick = () => {
    setHash(`#/course/${courseId}`);
    render();
  };

  // ensure data exists
  try {
    if (!state.lessonsByCourse[courseId]) await loadLessons(courseId);
    await loadProgress(courseId);
  } catch (e) {
    document.getElementById("lessonCard").innerHTML =
      `<div class="small">Failed to load: ${escapeHtml(e.message)}</div>`;
    return;
  }

  const lessons = state.lessonsByCourse[courseId] || [];
  const lesson = lessons.find(x => x.lessonIndex === lessonIndex);

  if (!lesson) {
    document.getElementById("lessonCard").innerHTML =
      `<div class="small">Lesson not found.</div>`;
    return;
  }

  const total = lessons.length;
  const doneCount = Object.values(state.progressByCourse[courseId]?.byLessonIndex || {})
    .filter(x => x && x.completed).length;
  const pct = total > 0 ? Math.round((doneCount / total) * 100) : 0;

  document.getElementById("lessonProgressBar").innerHTML = `
    <div class="small">Course progress: <b>${doneCount}</b> / ${total} (${pct}%)</div>
    <div style="height:10px; background:#1c2b3a; border-radius:8px; overflow:hidden; margin-top:6px;">
      <div style="height:10px; width:${pct}%; background:#4caf50;"></div>
    </div>
  `;

  const p = progressFor(courseId, lessonIndex);

  const prevExists = lessons.some(x => x.lessonIndex === lessonIndex - 1);
  const nextExists = lessons.some(x => x.lessonIndex === lessonIndex + 1);

  document.getElementById("lessonCard").innerHTML = `
    <div class="h2">${escapeHtml(lesson.title || "")}</div>

    <div style="height:10px"></div>
    <div class="h3">Learn</div>
    <div class="p">${escapeHtml(lesson.learnText || "")}</div>

    <div style="height:10px"></div>
    <div class="h3">Task</div>
    <div class="p">${escapeHtml(lesson.task || "")}</div>

    <div style="height:10px"></div>
    <div class="h3">Reflection</div>
    <textarea id="reflection" placeholder="Write your reflection...">${escapeHtml(p.reflectionText || "")}</textarea>

    <div style="height:10px"></div>

    <div class="row" style="gap:8px; flex-wrap:wrap;">
      <button class="btn" id="prevBtn" ${prevExists ? "" : "disabled"}>Back</button>
      <button class="btn" id="nextBtn" ${nextExists ? "" : "disabled"}>Next</button>
      <button class="btn ok" id="saveBtn">Save & Complete</button>
    </div>

    <div class="small" id="saveMsg" style="margin-top:10px;"></div>
  `;

  document.getElementById("prevBtn").onclick = () => {
    if (!prevExists) return;
    setHash(`#/lesson/${courseId}/${lessonIndex - 1}`);
    render();
  };

  document.getElementById("nextBtn").onclick = () => {
    if (!nextExists) return;
    setHash(`#/lesson/${courseId}/${lessonIndex + 1}`);
    render();
  };

  document.getElementById("saveBtn").onclick = async () => {
    const msg = document.getElementById("saveMsg");
    msg.textContent = "Saving...";

    const reflection = document.getElementById("reflection").value;

    try {
      await api("/progress/update", {
        method: "POST",
        body: {
          courseId,
          lessonIndex,
          reflection: reflection || "",
          completed: true
        }
      });

      msg.textContent = "Saved ✅";
      await loadProgress(courseId);

      // auto move to next if exists
      if (nextExists) {
        setTimeout(() => {
          setHash(`#/lesson/${courseId}/${lessonIndex + 1}`);
          render();
        }, 300);
      }
    } catch (e) {
      msg.textContent = "Save failed: " + e.message;
    }
  };
}

// ================= HEADER BUTTONS =================
if (btnLogin) btnLogin.addEventListener("click", () => { setHash("#/login"); render(); });
if (btnRegister) btnRegister.addEventListener("click", () => { setHash("#/register"); render(); });

if (btnLogout) {
  btnLogout.addEventListener("click", async () => {
    try { await api("/auth/logout", { method: "POST" }); } catch {}
    state.user = null;
    updateAuthButtons();
    setHash("#/login");
    render();
  });
}

// ================= ROUTER =================
window.addEventListener("hashchange", render);

// ================= BOOT =================
(function boot() {
  if (!location.hash) setHash("#/dashboard");
  render();
})();
