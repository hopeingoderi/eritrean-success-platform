// docs/student/app.js
// Student SPA (docs/student)

// ================= API BASE =================
const API_BASE = (() => {
  const host = window.location.hostname;
  if (host === "riseeritrea.com" || host === "www.riseeritrea.com") {
    return "https://api.riseeritrea.com/api";
  }
  return "http://localhost:4000/api";
})();

// ================= DOM =================
const appEl = document.getElementById("app");
const navEl = document.getElementById("nav");

// ================= STATE =================
const state = {
  user: null,
  lang: "en", // "en" | "ti"
  courses: [],
  lessonsByCourse: {},     // courseId -> lessons[]
  progressByCourse: {},    // courseId -> { courseId, byLessonIndex }
  progressStatus: null,    // { status: [{courseId,totalLessons,completedLessons,hasCertificate}] }
  examStatusByCourse: {},  // courseId -> { passed, score, ... }
};

// ================= HELPERS =================
function getLang() {
  const saved = localStorage.getItem("lang");
  return (saved === "ti" || saved === "en") ? saved : "en";
}
function setLang(lang) {
  const v = (lang === "ti" || lang === "en") ? lang : "en";
  localStorage.setItem("lang", v);
  state.lang = v;
  return v;
}

function escapeHtml(str = "") {
  return String(str).replace(/[&<>"']/g, (m) => ({
    "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;"
  }[m]));
}

function setHash(h) { if (location.hash !== h) location.hash = h; }
function routeParts() { return (location.hash || "#/dashboard").replace("#/", "").split("/"); }
function isLoggedIn() { return !!state.user; }

// ✅ robust query builder (won’t break when path already has ?)
function withLang(path) {
  // only add lang for endpoints that use it
  const needsLang =
    path.startsWith("/courses") ||
    path.startsWith("/lessons/") ||
    (path.startsWith("/exams/") && !path.includes("/submit"));

  if (!needsLang) return path;

  const sep = path.includes("?") ? "&" : "?";
  return `${path}${sep}lang=${encodeURIComponent(state.lang)}`;
}

async function api(path, { method = "GET", body } = {}) {
  const fullPath = withLang(path);

  const res = await fetch(API_BASE + fullPath, {
    method,
    headers: { "Content-Type": "application/json" },
    credentials: "include",
    body: body ? JSON.stringify(body) : undefined
  });

  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(typeof data.error === "string" ? data.error : "Request failed");
  return data;
}

// ✅ normalize lesson fields (backend may use learn/learnText + lesson_index/lessonIndex)
function normalizeLesson(raw = {}) {
  return {
    id: raw.id,
    courseId: raw.courseId || raw.course_id,
    lessonIndex: Number(raw.lessonIndex ?? raw.lesson_index ?? 0),
    title: raw.title ?? raw.title_en ?? raw.title_ti ?? "",
    learnText:
      raw.learn ?? raw.learnText ?? raw.learn_en ?? raw.learn_ti ?? raw.learnTi ?? raw.learnEn ?? "",
    task:
      raw.task ?? raw.taskText ?? raw.task_en ?? raw.task_ti ?? raw.taskTi ?? raw.taskEn ?? "",
    quiz: raw.quiz || null
  };
}

function progressFor(courseId, lessonIndex) {
  const p = state.progressByCourse[courseId]?.byLessonIndex?.[lessonIndex];
  return p || { completed: false, reflectionText: "" };
}

function courseFallbackOrder(courseId) {
  return ({ foundation: 1, growth: 2, excellence: 3 }[courseId] || 999);
}

function getProgressStatusRow(courseId) {
  const list = state.progressStatus?.status || [];
  return list.find(x => x.courseId === courseId) || null;
}

// ================= NAV =================
function updateNav() {
  if (!navEl) return;

  const btns = Array.from(navEl.querySelectorAll("button"));
  const loginBtn = btns.find(b => (b.textContent || "").toLowerCase().includes("login"));
  const regBtn   = btns.find(b => (b.textContent || "").toLowerCase().includes("register"));
  const outBtn   = btns.find(b => (b.textContent || "").toLowerCase().includes("logout"));

  if (state.user) {
    if (loginBtn) loginBtn.style.display = "none";
    if (regBtn) regBtn.style.display = "none";
    if (outBtn) outBtn.style.display = "inline-flex";
  } else {
    if (loginBtn) loginBtn.style.display = "inline-flex";
    if (regBtn) regBtn.style.display = "inline-flex";
    if (outBtn) outBtn.style.display = "none";
  }
}

window.go = function (page) {
  if (page === "login") setHash("#/login");
  else if (page === "register") setHash("#/register");
  else setHash("#/dashboard");
};

window.logout = async function () {
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
  updateNav();
}

async function loadCourses() {
  const r = await api("/courses");
  state.courses = Array.isArray(r.courses) ? r.courses : [];
  state.courses.sort((a, b) => courseFallbackOrder(a.id) - courseFallbackOrder(b.id));
}

async function loadLessons(courseId) {
  const r = await api(`/lessons/${courseId}`);
  const raw = Array.isArray(r.lessons) ? r.lessons : [];
  state.lessonsByCourse[courseId] = raw.map(normalizeLesson);
}

async function loadProgress(courseId) {
  const r = await api(`/progress/course/${courseId}`);
  state.progressByCourse[courseId] = r || {};
}

async function loadProgressStatus() {
  const r = await api("/progress/status");
  state.progressStatus = r || { status: [] };
  return state.progressStatus;
}

async function loadExamStatus(courseId) {
  const r = await api(`/exams/status/${courseId}`);
  state.examStatusByCourse[courseId] = r || { passed: false, score: null };
  return state.examStatusByCourse[courseId];
}

// ---- Certificate helpers (SAFE) ----
// We compute a reliable status even if /certificates/:courseId/status changes.
async function loadCertificateStatus(courseId) {
  // always refresh progressStatus + examStatus so UI never shows undefined
  await loadProgressStatus();
  const ex = await loadExamStatus(courseId);

  const row = getProgressStatusRow(courseId);
  const totalLessons = row?.totalLessons ?? 0;
  const completedLessons = row?.completedLessons ?? 0;
  const examPassed = !!ex?.passed;

  let certApi = {};
  try {
    certApi = await api(`/certificates/${courseId}/status`);
  } catch {
    certApi = {};
  }

  const issued = !!certApi.issued || !!row?.hasCertificate;
  const eligible = (certApi.eligible != null)
    ? !!certApi.eligible
    : (totalLessons > 0 && completedLessons >= totalLessons && examPassed);

  return { totalLessons, completedLessons, examPassed, issued, eligible };
}

async function claimCertificate(courseId) {
  return api(`/certificates/${courseId}/claim`, { method: "POST", body: {} });
}

// ================= ROUTER =================
window.addEventListener("hashchange", render);

async function render() {
  try { await loadMe(); } catch { state.user = null; updateNav(); }

  const parts = routeParts();
  const page = parts[0] || "dashboard";

  if (page === "login") return renderLogin();
  if (page === "register") return renderRegister();

  if (!isLoggedIn()) {
    setHash("#/login");
    return renderLogin();
  }

  if (page === "dashboard") return renderDashboard();
  if (page === "course") return renderCourse(parts[1]);
  if (page === "lesson") return renderLesson(parts[1], Number(parts[2]));
  if (page === "exam") return renderExam(parts[1]);
  if (page === "cert") return renderCert(parts[1]);

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
      updateNav();
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

      <label>First name</label>
      <input id="first_name" type="text" placeholder="First name" />

      <label>Last name</label>
      <input id="last_name" type="text" placeholder="Last name" />

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
    const first_name = document.getElementById("first_name").value.trim();
    const last_name  = document.getElementById("last_name").value.trim();
    const email      = document.getElementById("email").value.trim();
    const password   = document.getElementById("password").value.trim();

    const msg = document.getElementById("msg");
    msg.textContent = "";

    // ✅ VALIDATION
    if (!first_name || !last_name) {
      msg.textContent = "First and last name are required";
      return;
    }
    if (!email) {
      msg.textContent = "Email is required";
      return;
    }
    if (password.length < 6) {
      msg.textContent = "Password must be at least 6 characters";
      return;
    }

    try {
      const r = await api("/auth/register", {
        method: "POST",
        body: { first_name, last_name, email, password }
      });

      state.user = r.user;
      updateNav();
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
      <div class="row">
        <div>
          <div class="h1">Your Levels</div>
          <div class="small">Welcome, <b>${escapeHtml(state.user?.name || "")}</b></div>
        </div>
        <div class="row" style="gap:8px; justify-content:flex-end;">
          <button class="btn" id="langEn">English</button>
          <button class="btn" id="langTi">ትግርኛ</button>
        </div>
      </div>
    </div>
    <div id="coursesWrap"></div>
  `;

  document.getElementById("langEn").onclick = () => { setLang("en"); renderDashboard(); };
  document.getElementById("langTi").onclick = () => { setLang("ti"); renderDashboard(); };

  try {
    // ✅ Faster + avoids undefined: one call for all lesson counts
    await Promise.all([loadCourses(), loadProgressStatus()]);
  } catch (e) {
    document.getElementById("coursesWrap").innerHTML =
      `<div class="card"><div class="small">Failed to load dashboard: ${escapeHtml(e.message)}</div></div>`;
    return;
  }

  const wrap = document.getElementById("coursesWrap");
  wrap.innerHTML = state.courses.map(c => `
    <div class="card">
      <div class="h2">${escapeHtml(c.title || c.id || "")}</div>
      <div class="p">${escapeHtml(c.intro || "")}</div>

      <div class="row" style="justify-content:flex-start; gap:10px;">
        <button class="btn primary" data-open-course="${escapeHtml(c.id)}">Open lessons</button>
        <button class="btn secondary" data-open-exam="${escapeHtml(c.id)}">Final exam</button>
        <button class="btn" data-open-cert="${escapeHtml(c.id)}">Certificate</button>
      </div>

      <div class="small" id="dashMeta_${escapeHtml(c.id)}" style="margin-top:8px;"></div>
    </div>
  `).join("");

  wrap.querySelectorAll("[data-open-course]").forEach(btn => {
    btn.onclick = () => { setHash(`#/course/${btn.getAttribute("data-open-course")}`); render(); };
  });
  wrap.querySelectorAll("[data-open-exam]").forEach(btn => {
    btn.onclick = () => { setHash(`#/exam/${btn.getAttribute("data-open-exam")}`); render(); };
  });
  wrap.querySelectorAll("[data-open-cert]").forEach(btn => {
    btn.onclick = () => { setHash(`#/cert/${btn.getAttribute("data-open-cert")}`); render(); };
  });

  // ✅ Load all exam statuses in parallel (fast) + render meta without fetching lessons
  await Promise.all(state.courses.map(async (c) => {
    try { await loadExamStatus(c.id); } catch {}
  }));

  for (const c of state.courses) {
    const metaEl = document.getElementById(`dashMeta_${c.id}`);
    if (!metaEl) continue;

    const row = getProgressStatusRow(c.id);
    const done = row?.completedLessons ?? 0;
    const total = row?.totalLessons ?? 0;

    const exam = state.examStatusByCourse[c.id] || {};
    metaEl.innerHTML = `Lessons: <b>${done}</b> / ${total} • Exam: <b>${exam.passed ? "PASSED ✅" : "Not passed"}</b>`;
  }
}

// ================= COURSE =================
async function renderCourse(courseId) {
  if (!courseId) { setHash("#/dashboard"); return render(); }

  appEl.innerHTML = `
    <div class="card">
      <div class="row">
        <div>
          <div class="h1">Lessons</div>
          <div class="small">Course: <b>${escapeHtml(courseId)}</b></div>
        </div>
        <div class="row" style="gap:8px; justify-content:flex-end;">
          <button class="btn" id="backDash">Back</button>
          <button class="btn secondary" id="openExam">Final exam</button>
          <button class="btn" id="openCert">Certificate</button>
        </div>
      </div>
      <div id="courseProgress" style="margin-top:10px;"></div>
    </div>
    <div id="lessonsWrap"></div>
  `;

  document.getElementById("backDash").onclick = () => { setHash("#/dashboard"); render(); };
  document.getElementById("openExam").onclick = () => { setHash(`#/exam/${courseId}`); render(); };
  document.getElementById("openCert").onclick = () => { setHash(`#/cert/${courseId}`); render(); };

  try {
    await Promise.all([loadLessons(courseId), loadProgress(courseId)]);
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
    <div class="small">Course progress: <b>${completed}</b> / ${total} (${pct}%)</div>
    <div class="progressWrap" style="margin-top:6px;"><div class="progressBar" style="width:${pct}%"></div></div>
  `;

  const listHtml = lessons
    .slice()
    .sort((a, b) => a.lessonIndex - b.lessonIndex)
    .map(l => {
      const done = !!pmap[l.lessonIndex]?.completed;
      return `
        <div class="card">
          <div class="row" style="justify-content:space-between;">
            <div>
              <div class="h2">${escapeHtml(l.title || "")}</div>
              <div class="small">Lesson ${l.lessonIndex + 1} ${done ? "✅ Completed" : ""}</div>
            </div>
            <button class="btn primary" data-open-lesson="${l.lessonIndex}">Open</button>
          </div>
        </div>
      `;
    }).join("");

  const wrap = document.getElementById("lessonsWrap");
  wrap.innerHTML = listHtml || `<div class="card"><div class="small">No lessons found.</div></div>`;

  wrap.querySelectorAll("[data-open-lesson]").forEach(btn => {
    btn.onclick = () => {
      const idx = btn.getAttribute("data-open-lesson");
      setHash(`#/lesson/${courseId}/${idx}`);
      render();
    };
  });
}

// ================= LESSON =================
async function renderLesson(courseId, lessonIndex) {
  if (!courseId || !Number.isFinite(lessonIndex)) {
    setHash("#/dashboard");
    return render();
  }

  appEl.innerHTML = `
    <div class="card">
      <div class="h1">Lesson</div>
      <div class="small">Course: <b>${escapeHtml(courseId)}</b> • Lesson: <b>${lessonIndex + 1}</b></div>
      <div id="bars" style="margin-top:10px;"></div>
    </div>
    <div class="card" id="lessonCard"><div class="small">Loading...</div></div>
  `;

  try {
    if (!state.lessonsByCourse[courseId]) await loadLessons(courseId);
    await loadProgress(courseId);
  } catch (e) {
    document.getElementById("lessonCard").innerHTML = `<div class="small">Load failed: ${escapeHtml(e.message)}</div>`;
    return;
  }

  const lessons = state.lessonsByCourse[courseId] || [];
  const lesson = lessons.find(x => x.lessonIndex === lessonIndex);

  if (!lesson) {
    document.getElementById("lessonCard").innerHTML = `<div class="small">Lesson not found.</div>`;
    return;
  }

  const pmap = state.progressByCourse[courseId]?.byLessonIndex || {};
  const total = lessons.length;
  const doneCount = Object.values(pmap).filter(x => x && x.completed).length;
  const pct = total > 0 ? Math.round((doneCount / total) * 100) : 0;

  document.getElementById("bars").innerHTML = `
    <div class="small">Course progress: <b>${doneCount}</b> / ${total} (${pct}%)</div>
    <div class="progressWrap" style="margin-top:6px;"><div class="progressBar" style="width:${pct}%"></div></div>
    <div class="small" style="margin-top:10px;">Lesson ${lessonIndex + 1} of ${total}</div>
  `;

  const p = progressFor(courseId, lessonIndex);
  const prevExists = lessons.some(x => x.lessonIndex === lessonIndex - 1);
  const nextExists = lessons.some(x => x.lessonIndex === lessonIndex + 1);

  document.getElementById("lessonCard").innerHTML = `
    <div class="h2">${escapeHtml(lesson.title || "")}</div>

    <div style="height:10px"></div>
    <div class="h2" style="font-size:16px;">Learn</div>
    <div class="p">${escapeHtml(lesson.learnText || "")}</div>

    <div style="height:10px"></div>
    <div class="h2" style="font-size:16px;">Task</div>
    <div class="p">${escapeHtml(lesson.task || "")}</div>

    <div style="height:10px"></div>
    <div class="h2" style="font-size:16px;">Reflection</div>
    <textarea id="reflection" placeholder="Write your reflection...">${escapeHtml(p.reflectionText || "")}</textarea>

    <div style="height:10px"></div>

    <div class="row" style="justify-content:space-between; gap:10px;">
      <button class="btn" id="returnBtn">Return</button>
      <button class="btn" id="prevBtn" ${prevExists ? "" : "disabled"}>Back</button>
      <button class="btn primary" id="saveBtn">Save & Complete</button>
      <button class="btn" id="nextBtn" ${(nextExists && p.completed) ? "" : "disabled"}>Next</button>
    </div>

    <div class="small" id="saveMsg" style="margin-top:10px;"></div>
    <div class="lockNote" id="nextNote" style="display:${p.completed ? "none" : "block"};">
      🔒 “Next” unlocks after you press <b>Save & Complete</b>.
    </div>
  `;

  document.getElementById("returnBtn").onclick = () => { setHash(`#/course/${courseId}`); render(); };
  document.getElementById("prevBtn").onclick = () => {
    if (!prevExists) return;
    setHash(`#/lesson/${courseId}/${lessonIndex - 1}`);
    render();
  };
  document.getElementById("nextBtn").onclick = () => {
    if (!nextExists) return;
    const nowP = progressFor(courseId, lessonIndex);
    if (!nowP.completed) return;
    setHash(`#/lesson/${courseId}/${lessonIndex + 1}`);
    render();
  };

  document.getElementById("saveBtn").onclick = async () => {
    const msg = document.getElementById("saveMsg");
    msg.textContent = "Saving...";
    const reflection = document.getElementById("reflection").value || "";

    try {
      await api("/progress/update", {
        method: "POST",
        body: { courseId, lessonIndex, reflection, completed: true }
      });

      msg.textContent = "Saved ✅";
      await loadProgress(courseId);

      const nextBtn = document.getElementById("nextBtn");
      if (nextExists && nextBtn) nextBtn.disabled = false;
      const note = document.getElementById("nextNote");
      if (note) note.style.display = "none";
    } catch (e) {
      msg.textContent = "Save failed: " + e.message;
    }
  };
}

// ================= EXAM =================
async function renderExam(courseId) {
  if (!courseId) { setHash("#/dashboard"); return render(); }

  appEl.innerHTML = `
    <div class="card">
      <div class="row">
        <div>
          <div class="h1">Final Exam</div>
          <div class="small">Course: <b>${escapeHtml(courseId)}</b></div>
        </div>
        <div class="row" style="gap:8px; justify-content:flex-end;">
          <button class="btn" id="backCourse">Back</button>
          <button class="btn" id="goCert">Certificate</button>
        </div>
      </div>
      <div class="small" id="examMeta" style="margin-top:10px;"></div>
    </div>

    <div class="card" id="examCard"><div class="small">Loading exam...</div></div>
  `;

  document.getElementById("backCourse").onclick = () => { setHash(`#/course/${courseId}`); render(); };
  document.getElementById("goCert").onclick = () => { setHash(`#/cert/${courseId}`); render(); };

  let examData;
  try {
    examData = await api(`/exams/${courseId}`);
  } catch (e) {
    document.getElementById("examCard").innerHTML =
      `<div class="small">Failed: ${escapeHtml(e.message)}</div>`;
    return;
  }

  // If backend returns latestAttempt, show it; else fallback to status endpoint
 // Load exam status (score, passed, attempts)
  let st = null;
  try {
    st = await loadExamStatus(courseId);
  } catch {}


  const passScore = examData.passScore ?? 70;
  const questions = examData.exam?.questions || [];

  document.getElementById("examMeta").innerHTML = `
  Pass score: <b>${passScore}%</b>
  ${st?.attemptCount != null
    ? ` • Attempts: <b>${st.attemptCount}</b>${st.maxAttempts ? ` / ${st.maxAttempts}` : ""}`
    : ""
  }
  ${st?.score != null
    ? ` • Last score: <b>${st.score}%</b> ${st.passed ? "✅ PASSED" : "❌"}`
    : ""
  }
`;

  if (!questions.length) {
    document.getElementById("examCard").innerHTML =
      `<div class="small">Exam not configured yet.</div>`;
    return;
  }

  // Build UI with ids + data attributes so we can mark results later
  const qHtml = questions.map((q, i) => {
    const opts = (q.options || []).map((opt, oi) => `
      <label class="quizOption" id="q_${i}_opt_${oi}" data-q="${i}" data-opt="${oi}">
        <input type="radio" name="q_${i}" value="${oi}" />
        <div><b>${escapeHtml(opt)}</b></div>
      </label>
    `).join("");

    return `
      <div class="card" id="qcard_${i}" style="background:rgba(255,255,255,.03)">
        <div class="h2" style="font-size:16px;">${i + 1}. ${escapeHtml(q.text || "")}</div>
        <div style="height:8px"></div>
        ${opts}
        <div class="small" id="q_${i}_msg" style="margin-top:8px;"></div>
      </div>
    `;
  }).join("");

  document.getElementById("examCard").innerHTML = `
    <div class="small">Answer all questions, then submit.</div>
    <div style="height:10px"></div>
    ${qHtml}
    <div class="row" style="gap:10px; margin-top:10px;">
      <button class="btn primary" id="submitExam">Submit Exam</button>
      <button class="btn" id="retryExam" style="display:none;">Retry</button>
    </div>
    <div class="small" id="examMsg" style="margin-top:10px;"></div>
  `;

  const btnSubmit = document.getElementById("submitExam");
  const btnRetry = document.getElementById("retryExam");

  function clearMarks() {
    for (let i = 0; i < questions.length; i++) {
      document.getElementById(`qcard_${i}`).style.outline = "none";
      document.getElementById(`q_${i}_msg`).textContent = "";
      for (let oi = 0; oi < (questions[i].options || []).length; oi++) {
        const el = document.getElementById(`q_${i}_opt_${oi}`);
        if (!el) continue;
        el.style.outline = "none";
        el.style.opacity = "1";
      }
    }
  }

  function applyResults(results) {
    // results item: { index, picked, correct, isCorrect }
    clearMarks();

    for (const r of results || []) {
      const i = r.index;

      // Mark question card
      const qCard = document.getElementById(`qcard_${i}`);
      if (qCard) {
        qCard.style.outline = r.isCorrect ? "2px solid rgba(34,197,94,.6)" : "2px solid rgba(239,68,68,.6)";
        qCard.style.borderRadius = "10px";
      }

      // Fade all options slightly
      const optCount = (questions[i]?.options || []).length;
      for (let oi = 0; oi < optCount; oi++) {
        const el = document.getElementById(`q_${i}_opt_${oi}`);
        if (el) el.style.opacity = "0.65";
      }

      // Highlight correct option
      const correctEl = document.getElementById(`q_${i}_opt_${r.correct}`);
      if (correctEl) {
        correctEl.style.opacity = "1";
        correctEl.style.outline = "2px solid rgba(34,197,94,.7)";
        correctEl.style.borderRadius = "10px";
      }

      // Highlight picked option
      const pickedEl = document.getElementById(`q_${i}_opt_${r.picked}`);
      if (pickedEl) {
        pickedEl.style.opacity = "1";
        pickedEl.style.outline = r.isCorrect
          ? "2px solid rgba(34,197,94,.7)"
          : "2px solid rgba(239,68,68,.7)";
        pickedEl.style.borderRadius = "10px";
      }

      // Per-question message
      const msgEl = document.getElementById(`q_${i}_msg`);
      if (msgEl) {
        msgEl.textContent = r.isCorrect ? "✅ Correct" : "❌ Wrong (correct option highlighted)";
      }
    }
  }

  btnRetry.onclick = () => {
    // Clear selected answers
    for (let i = 0; i < questions.length; i++) {
      const picked = document.querySelector(`input[name="q_${i}"]:checked`);
      if (picked) picked.checked = false;
    }
    clearMarks();
    document.getElementById("examMsg").textContent = "Try again when ready.";
    btnRetry.style.display = "none";
    btnSubmit.disabled = false;
  };

  btnSubmit.onclick = async () => {
    const msg = document.getElementById("examMsg");
    msg.textContent = "Submitting...";

    const answers = [];
    for (let i = 0; i < questions.length; i++) {
      const picked = document.querySelector(`input[name="q_${i}"]:checked`);
      answers[i] = picked ? Number(picked.value) : -1;
    }

    if (answers.some(x => x < 0)) {
      msg.textContent = "Please answer all questions before submitting.";
      return;
    }

    btnSubmit.disabled = true;

    try {
      const r = await api(`/exams/${courseId}/submit`, {
        method: "POST",
        body: { answers } // backend ignores lang now; keep it simple
      });

      msg.textContent = r.passed
        ? `✅ Passed! Score: ${r.score}% (Pass: ${r.passScore}%)`
        : `❌ Not passed. Score: ${r.score}% (Pass: ${r.passScore}%) — please retry.`;

      // ✅ Show per-question correction
      if (Array.isArray(r.results)) applyResults(r.results);

      // Show retry if failed
      if (!r.passed) btnRetry.style.display = "inline-block";

      await loadExamStatus(courseId);
    } catch (e) {
      msg.textContent = "Submit failed: " + e.message;
      btnSubmit.disabled = false;
    }
  };
}

// ================= CERTIFICATE =================
async function renderCert(courseId) {
  if (!courseId) { setHash("#/dashboard"); return render(); }

  appEl.innerHTML = `
    <div class="card">
      <div class="row">
        <div>
          <div class="h1">Certificate</div>
          <div class="small">Course: <b>${escapeHtml(courseId)}</b></div>
        </div>
        <div class="row" style="gap:8px; justify-content:flex-end;">
          <button class="btn" id="backCourse">Back</button>
          <button class="btn secondary" id="openExam">Final exam</button>
        </div>
      </div>
      <div class="small" id="certTop" style="margin-top:10px;"></div>
    </div>

    <div class="card" id="certCard"><div class="small">Loading...</div></div>
  `;

  document.getElementById("backCourse").onclick = () => { setHash(`#/course/${courseId}`); render(); };
  document.getElementById("openExam").onclick = () => { setHash(`#/exam/${courseId}`); render(); };

  let status;
  try {
    status = await loadCertificateStatus(courseId);
  } catch (e) {
    document.getElementById("certCard").innerHTML = `<div class="small">Failed: ${escapeHtml(e.message)}</div>`;
    return;
  }

  const top = document.getElementById("certTop");
  top.innerHTML = `Lessons completed: <b>${status.completedLessons}</b> / ${status.totalLessons} • Exam passed: <b>${status.examPassed ? "YES ✅" : "NO ❌"}</b>`;

  if (status.issued) {
    document.getElementById("certCard").innerHTML = `
      <div class="h2">Certificate issued ✅</div>
      <div class="small">Download your PDF:</div>
      <div style="height:12px"></div>
      <a class="btn primary" href="${API_BASE}/certificates/${courseId}/pdf" target="_blank" rel="noreferrer">
        Download PDF
      </a>
    `;
    return;
  }

  if (!status.eligible) {
    document.getElementById("certCard").innerHTML = `
      <div class="h2">Not eligible yet 🔒</div>
      <div class="small">
        To unlock the certificate you must:
        <div>${status.completedLessons >= status.totalLessons ? "✅" : "⬜"} Complete all lessons</div>
        <div>${status.examPassed ? "✅" : "⬜"} Pass the final exam</div>
        <div style="margin-top:10px;">Once you pass the exam, come back here and click <b>Claim Certificate</b>.</div>
      </div>
      <div style="height:12px"></div>
      <button class="btn secondary" id="goExamNow">Go to Final Exam</button>
    `;
    document.getElementById("goExamNow").onclick = () => { setHash(`#/exam/${courseId}`); render(); };
    return;
  }

  document.getElementById("certCard").innerHTML = `
    <div class="h2">You are eligible ✅</div>
    <div class="small">Click below to claim your certificate.</div>
    <div style="height:12px"></div>
    <button class="btn primary" id="claimBtn">Claim Certificate</button>
    <div class="small" id="claimMsg" style="margin-top:10px;"></div>
  `;

  document.getElementById("claimBtn").onclick = async () => {
    const m = document.getElementById("claimMsg");
    m.textContent = "Claiming...";
    try {
      await claimCertificate(courseId);
      m.textContent = "Claimed ✅ Opening PDF...";
      window.open(`${API_BASE}/certificates/${courseId}/pdf`, "_blank");
      setTimeout(() => renderCert(courseId), 400);
    } catch (e) {
      m.textContent = "Failed: " + e.message;
    }
  };
}

// ================= BOOT =================
(function boot() {
  if (!location.hash) setHash("#/dashboard");
  state.lang = getLang();
  updateNav();

  // 🔥 Wake up API (Render cold start)
  api("/health").catch(() => {});

  render();
})();