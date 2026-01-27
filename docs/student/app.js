// docs/student/app.js
// Student SPA (docs/student)
// Backend routes used:
// - /api/auth/*
// - /api/courses
// - /api/lessons/:courseId
// - /api/progress/course/:courseId
// - /api/progress/update
// - /api/exams/:courseId (GET)
// - /api/exams/status/:courseId (GET)
// - /api/exams/:courseId/submit (POST)  body: { answers, lang }
// - /api/certificates/status/:courseId (GET)
// - /api/certificates/claim (POST)      body: { courseId }
// - /api/certificates/:courseId/pdf (GET)

"use strict";

// ================= API BASE =================
const API_BASE = (() => {
  const host = window.location.hostname;
  // Production on riseeritrea.com
  if (host === "riseeritrea.com" || host === "www.riseeritrea.com") {
    return "https://api.riseeritrea.com/api";
  }
  // Local dev
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
  lessonsByCourse: {},    // courseId -> lessons[]
  progressByCourse: {},   // courseId -> progress object
  examStatusByCourse: {}  // courseId -> { passed, score }
};

// ================= HELPERS =================
// ---- language memory ----
function getLang() {
  const saved = localStorage.getItem("lang");
  return (saved === "ti" || saved === "en") ? saved : "en";
}
function setLang(lang) {
  const v = (lang === "ti" || lang === "en") ? lang : "en";
  localStorage.setItem("lang", v);
  return v;
}

// ---- HTML escape ----
function escapeHtml(str = "") {
  return String(str).replace(/[&<>"']/g, (m) => ({
    "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;"
  }[m]));
}

// ---- router helpers ----
function setHash(h) { if (location.hash !== h) location.hash = h; }
function routeParts() { return (location.hash || "#/dashboard").replace("#/", "").split("/"); }
function isLoggedIn() { return !!state.user; }

// stable ordering for dashboard cards
function courseFallbackOrder(courseId) {
  return ({ foundation: 1, growth: 2, excellence: 3 }[courseId] || 999);
}

// backend/courses route returns { id, title, intro } (already localized)
function courseTitle(c) { return c?.title || c?.id || ""; }
function courseDesc(c) { return c?.intro || ""; }

// progress helper
function progressFor(courseId, lessonIndex) {
  const p = state.progressByCourse[courseId]?.byLessonIndex?.[lessonIndex];
  return p || { completed: false, reflectionText: "" };
}

// ---- API url builder (IMPORTANT: works with existing ? queries) ----
function withLang(path) {
  const lang = state.lang || "en";
  return path.includes("?")
    ? `${path}&lang=${encodeURIComponent(lang)}`
    : `${path}?lang=${encodeURIComponent(lang)}`;
}

async function api(path, { method = "GET", body } = {}) {
  const url = API_BASE + withLang(path);

  const res = await fetch(url, {
    method,
    headers: { "Content-Type": "application/json" },
    credentials: "include",
    body: body ? JSON.stringify(body) : undefined
  });

  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(typeof data.error === "string" ? data.error : "Request failed");
  return data;
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
    if (outBtn) outBtn.style.display = "inline-block";
  } else {
    if (loginBtn) loginBtn.style.display = "inline-block";
    if (regBtn) regBtn.style.display = "inline-block";
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

  state.courses.sort((a, b) => {
    const ao = courseFallbackOrder(a.id);
    const bo = courseFallbackOrder(b.id);
    return ao - bo;
  });
}

async function loadLessons(courseId) {
  const r = await api(`/lessons/${courseId}`);
  state.lessonsByCourse[courseId] = Array.isArray(r.lessons) ? r.lessons : [];
}

async function loadProgress(courseId) {
  const r = await api(`/progress/course/${courseId}`);
  state.progressByCourse[courseId] = r || {};
}

async function loadExamStatus(courseId) {
  const r = await api(`/exams/status/${courseId}`);
  state.examStatusByCourse[courseId] = r || { passed: false, score: null };
}

async function loadCertificateStatus(courseId) {
  return api(`/certificates/status/${courseId}`);
}
async function claimCertificate(courseId) {
  return api(`/certificates/claim`, { method: "POST", body: { courseId } });
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

  document.getElementById("langEn").onclick = async () => {
    state.lang = setLang("en");
    await loadCourses();
    renderDashboard();
  };
  document.getElementById("langTi").onclick = async () => {
    state.lang = setLang("ti");
    await loadCourses();
    renderDashboard();
  };

  try {
    await loadCourses();
  } catch (e) {
    document.getElementById("coursesWrap").innerHTML =
      `<div class="card"><div class="small">Failed to load courses: ${escapeHtml(e.message)}</div></div>`;
    return;
  }

  const wrap = document.getElementById("coursesWrap");
  wrap.innerHTML = state.courses.map(c => `
    <div class="card">
      <div class="h2">${escapeHtml(courseTitle(c))}</div>
      <div class="p">${escapeHtml(courseDesc(c))}</div>

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

  // Meta per course
  for (const c of state.courses) {
    const metaEl = document.getElementById(`dashMeta_${c.id}`);
    if (!metaEl) continue;

    try {
      await loadLessons(c.id);
      await loadProgress(c.id);
      await loadExamStatus(c.id);

      const lessons = state.lessonsByCourse[c.id] || [];
      const pmap = state.progressByCourse[c.id]?.byLessonIndex || {};
      const done = Object.values(pmap).filter(x => x && x.completed).length;
      const total = lessons.length;

      const exam = state.examStatusByCourse[c.id] || {};
      metaEl.innerHTML = `Lessons: <b>${done}</b> / ${total} • Exam: <b>${exam.passed ? "PASSED ✅" : "Not passed"}</b>`;
    } catch {
      metaEl.textContent = "";
    }
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
    document.getElementById("examCard").innerHTML = `<div class="small">Failed: ${escapeHtml(e.message)}</div>`;
    return;
  }

  const passScore = examData.passScore ?? 70;
  const questions = examData.exam?.questions || [];
  const latest = examData.latestAttempt || null;

  document.getElementById("examMeta").innerHTML = `
    Pass score: <b>${passScore}%</b>
    ${latest ? ` • Last score: <b>${latest.score}%</b> ${latest.passed ? "✅ PASSED" : "❌"}` : ""}
  `;

  if (!questions.length) {
    document.getElementById("examCard").innerHTML = `<div class="small">Exam not configured yet.</div>`;
    return;
  }

  const qHtml = questions.map((q, i) => {
    const opts = (q.options || []).map((opt, oi) => `
      <label class="quizOption">
        <input type="radio" name="q_${i}" value="${oi}" />
        <div><b>${escapeHtml(opt)}</b></div>
      </label>
    `).join("");

    return `
      <div class="card" style="background:rgba(255,255,255,.03)">
        <div class="h2" style="font-size:16px;">${i + 1}. ${escapeHtml(q.text || "")}</div>
        <div style="height:8px"></div>
        ${opts}
      </div>
    `;
  }).join("");

  document.getElementById("examCard").innerHTML = `
    <div class="small">Answer all questions, then submit.</div>
    <div style="height:10px"></div>
    ${qHtml}
    <button class="btn primary" id="submitExam">Submit Exam</button>
    <div class="small" id="examMsg" style="margin-top:10px;"></div>
  `;

  document.getElementById("submitExam").onclick = async () => {
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

    try {
      const r = await api(`/exams/${courseId}/submit`, {
        method: "POST",
        body: { answers, lang: state.lang }
      });

      msg.textContent = r.passed
        ? `✅ Passed! Score: ${r.score}% (Pass: ${r.passScore}%)`
        : `❌ Not passed. Score: ${r.score}% (Pass: ${r.passScore}%) — try again.`;

      await loadExamStatus(courseId);
    } catch (e) {
      msg.textContent = "Submit failed: " + e.message;
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
  // default hash
  if (!location.hash) setHash("#/dashboard");
  // load saved language
  state.lang = getLang();
  updateNav();
  render();
})();