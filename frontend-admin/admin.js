const API_BASE = "https://api.riseeritrea.com/api";

const appEl = document.getElementById("app");
const yearEl = document.getElementById("year");
if (yearEl) yearEl.textContent = new Date().getFullYear();

const navLogin = document.getElementById("navLogin");
const navRegister = document.getElementById("navRegister");
const navLogout = document.getElementById("navLogout");

const COURSE_ORDER = ["foundation", "growth", "excellence"];

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
  if (!res.ok) throw new Error(typeof data.error === "string" ? data.error : "Request failed");
  return data;
}

function setHash(h) { location.hash = h; }
function parts() { return (location.hash || "#/").replace("#/", "").split("/"); }

let state = {
  user: null,
  courses: [],
  lessons: {},          // { [courseId]: lessons[] }
  progress: {},         // { [courseId]: byLessonIndex{} }
};

function updateNav() {
  const loggedIn = !!state.user;
  if (navLogin) navLogin.style.display = loggedIn ? "none" : "inline-block";
  if (navRegister) navRegister.style.display = loggedIn ? "none" : "inline-block";
  if (navLogout) navLogout.style.display = loggedIn ? "inline-block" : "none";
}

async function loadMe() {
  const r = await api("/auth/me");
  state.user = r.user;
  updateNav();
}

if (navLogout) {
  navLogout.addEventListener("click", async () => {
    try { await api("/auth/logout", { method: "POST" }); } catch {}
    state.user = null;
    updateNav();
    setHash("#/login");
    render();
  });
}

async function loadCourses() {
  const r = await api("/courses");
  // expected: { courses:[{id,name}] } but we’ll normalize
  const courses = r.courses || r || [];
  state.courses = courses
    .map(c => ({ id: c.id, name: c.name || c.id }))
    .sort((a, b) => COURSE_ORDER.indexOf(a.id) - COURSE_ORDER.indexOf(b.id));
}

async function loadLessons(courseId) {
  const rEn = await api(`/lessons/${courseId}?lang=en`);
  const lessons = rEn.lessons || [];
  state.lessons[courseId] = lessons.sort((a, b) => a.lessonIndex - b.lessonIndex);
}

async function loadProgress(courseId) {
  const r = await api(`/progress/course/${courseId}`);
  state.progress[courseId] = r.byLessonIndex || {};
}

function progressPercent(courseId) {
  const lessons = state.lessons[courseId] || [];
  const prog = state.progress[courseId] || {};
  if (!lessons.length) return 0;
  let done = 0;
  for (const l of lessons) if (prog[l.lessonIndex]?.completed) done++;
  return Math.round((done / lessons.length) * 100);
}

function renderProgressBar(pct) {
  return `
    <div style="margin:10px 0;">
      <div class="small">Progress: <b>${pct}%</b></div>
      <div style="height:10px;border-radius:999px;background:rgba(255,255,255,0.15);overflow:hidden;">
        <div style="height:10px;width:${pct}%;background:rgba(255,255,255,0.65);"></div>
      </div>
    </div>
  `;
}

window.addEventListener("hashchange", render);

async function render() {
  try { await loadMe(); } catch { state.user = null; updateNav(); }

  const [page, p1, p2] = parts();

  if (!state.user) {
    if (page !== "register") {
      setHash("#/login");
      return renderLogin();
    }
    return renderRegister();
  }

  if (!page || page === "courses") return renderCourses();
  if (page === "lesson") return renderLesson(p1, Number(p2));

  setHash("#/courses");
  return renderCourses();
}

// -------------------- AUTH PAGES --------------------

function renderLogin() {
  appEl.innerHTML = `
    <div class="card">
      <div class="h1">Login</div>
      <label>Email</label>
      <input id="email" type="email" />
      <label>Password</label>
      <input id="password" type="password" />
      <div style="height:10px"></div>
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
      updateNav();
      setHash("#/courses");
      render();
    } catch (e) {
      msg.textContent = "Login failed: " + e.message;
    }
  };
}

function renderRegister() {
  appEl.innerHTML = `
    <div class="card">
      <div class="h1">Register</div>
      <label>Name</label>
      <input id="name" type="text" />
      <label>Email</label>
      <input id="email" type="email" />
      <label>Password</label>
      <input id="password" type="password" />
      <div style="height:10px"></div>
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
      updateNav();
      setHash("#/courses");
      render();
    } catch (e) {
      msg.textContent = "Register failed: " + e.message;
    }
  };
}

// -------------------- COURSES --------------------

async function renderCourses() {
  appEl.innerHTML = `<div class="card"><div class="h1">Loading...</div></div>`;

  await loadCourses();

  // preload lessons+progress
  for (const c of state.courses) {
    await loadLessons(c.id);
    await loadProgress(c.id);
  }

  const cards = state.courses.map(c => {
    const pct = progressPercent(c.id);
    const lessons = state.lessons[c.id] || [];
    const nextLesson = findNextLessonIndex(c.id);
    return `
      <div class="card">
        <div class="h2">${escapeHtml(c.name)}</div>
        ${renderProgressBar(pct)}
        <div class="small">${lessons.length} lessons</div>
        <div style="height:10px"></div>
        <button class="btn primary" onclick="location.hash='#/lesson/${c.id}/${nextLesson}'">
          Continue
        </button>
      </div>
    `;
  }).join("");

  appEl.innerHTML = `
    <div class="card">
      <div class="h1">Lessons</div>
      <div class="small">Choose a level and continue learning.</div>
    </div>
    <div class="grid two">
      ${cards}
    </div>
  `;
}

function findNextLessonIndex(courseId) {
  const lessons = state.lessons[courseId] || [];
  const prog = state.progress[courseId] || {};
  for (const l of lessons) {
    if (!prog[l.lessonIndex]?.completed) return l.lessonIndex;
  }
  return lessons.length ? lessons[lessons.length - 1].lessonIndex : 0;
}

// -------------------- LESSON PAGE (Back/Next + Save) --------------------

async function renderLesson(courseId, lessonIndex) {
  if (!courseId) return setHash("#/courses");

  if (!state.lessons[courseId]) await loadLessons(courseId);
  if (!state.progress[courseId]) await loadProgress(courseId);

  const lessons = state.lessons[courseId] || [];
  const prog = state.progress[courseId] || {};

  const lesson = lessons.find(x => x.lessonIndex === lessonIndex);
  if (!lesson) {
    setHash("#/courses");
    return;
  }

  const pct = progressPercent(courseId);

  const prevIndex = lessonIndex > 0 ? lessonIndex - 1 : null;
  const nextIndex = lessonIndex < lessons.length - 1 ? lessonIndex + 1 : null;

  const existingReflection = prog[lessonIndex]?.reflectionText || "";

  appEl.innerHTML = `
    <div class="card">
      <div class="row" style="justify-content:space-between;align-items:center;">
        <div>
          <div class="small">Course: <b>${escapeHtml(courseId)}</b></div>
          <div class="h1">${escapeHtml(lesson.title)}</div>
        </div>
        <button class="btn" onclick="location.hash='#/courses'">Back to levels</button>
      </div>

      ${renderProgressBar(pct)}

      <div class="p">${escapeHtml(lesson.learnText || "")}</div>

      <div style="height:10px"></div>
      <div class="h2">Task</div>
      <div class="p">${escapeHtml(lesson.task || "")}</div>

      <div style="height:10px"></div>
      <div class="h2">Reflection</div>
      <textarea id="reflection" style="width:100%;min-height:120px;">${escapeHtml(existingReflection)}</textarea>

      <div style="height:12px"></div>

      <div class="row" style="gap:10px;justify-content:space-between;">
        <button class="btn" id="prevBtn" ${prevIndex === null ? "disabled" : ""}>⬅ Previous</button>
        <button class="btn ok" id="saveBtn">Save & Complete ✅</button>
        <button class="btn" id="nextBtn" ${nextIndex === null ? "disabled" : ""}>Next ➡</button>
      </div>

      <div class="small" id="msg" style="margin-top:10px"></div>
    </div>
  `;

  const msg = document.getElementById("msg");

  document.getElementById("prevBtn").onclick = () => {
    if (prevIndex !== null) setHash(`#/lesson/${courseId}/${prevIndex}`);
  };

  document.getElementById("nextBtn").onclick = () => {
    if (nextIndex !== null) setHash(`#/lesson/${courseId}/${nextIndex}`);
  };

  document.getElementById("saveBtn").onclick = async () => {
    msg.textContent = "Saving...";
    const reflection = document.getElementById("reflection").value;

    try {
      await api("/progress/update", {
        method: "POST",
        body: { courseId, lessonIndex, completed: true, reflection }
      });

      await loadProgress(courseId);
      msg.textContent = "Saved ✅";

      // auto go next if exists
      if (nextIndex !== null) setHash(`#/lesson/${courseId}/${nextIndex}`);
    } catch (e) {
      msg.textContent = "Save failed: " + e.message;
    }
  };
}

// boot
(function boot() {
  updateNav();
  if (!location.hash) setHash("#/login");
  render();
})();
