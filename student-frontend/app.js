// student-frontend/app.js is the same docs/student/app.js
// ============================================================
// Student Frontend (SPA)
// Matches your student-frontend/index.html nav:
//   <button onclick="go('login')">Login</button>
//   <button onclick="go('register')">Register</button>
//   <button onclick="logout()">Logout</button>
// Fixes:
// - Correct API_BASE
// - Courses not "undefined" (maps title_en/title_ti + description_en/description_ti)
// - Sort courses by order: foundation -> growth -> excellence
// - Proper Login/Register/Logout visibility
// - Course page: progress bar + lesson list
// - Lesson page: Back/Next/Return + Save & Complete
// ============================================================

const API_BASE = "https://api.riseeritrea.com/api";

const appEl = document.getElementById("app");
const navEl = document.getElementById("nav");

// ---------------- STATE ----------------
const state = {
  user: null,
  lang: "en", // "en" | "ti"
  courses: [],
  lessonsByCourse: {},        // courseId -> lessons[]
  progressByCourse: {},       // courseId -> { byLessonIndex: { [lessonIndex]: {...} } }
  examAttemptByCourse: {}     // courseId -> { score, passed, updated_at } | null
};

// ---------------- HELPERS ----------------
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

function setHash(h) {
  if (location.hash !== h) location.hash = h;
}
function routeParts() {
  return (location.hash || "#/dashboard").replace("#/", "").split("/");
}
function isLoggedIn() {
  return !!state.user;
}

function courseFallbackOrder(courseId) {
  return ({ foundation: 1, growth: 2, excellence: 3 }[courseId] || 999);
}

function courseTitle(c) {
  return state.lang === "ti" ? (c.title_ti || c.title_en || "") : (c.title_en || c.title_ti || "");
}
function courseDesc(c) {
  return state.lang === "ti"
    ? (c.description_ti || c.description_en || c.intro_ti || c.intro_en || "")
    : (c.description_en || c.description_ti || c.intro_en || c.intro_ti || "");
}

function progressFor(courseId, lessonIndex) {
  const p = state.progressByCourse[courseId]?.byLessonIndex?.[lessonIndex];
  return p || { completed: false, reflectionText: "" };
}

function getCourseProgressCounts(courseId) {
  const lessons = state.lessonsByCourse[courseId] || [];
  const pmap = state.progressByCourse[courseId]?.byLessonIndex || {};
  const total = lessons.length;
  const completed = Object.values(pmap).filter(x => x && x.completed).length;
  return { total, completed };
}

function isExamPassed(courseId) {
  return !!state.examAttemptByCourse[courseId]?.passed;
}

// ---------------- NAV VISIBILITY ----------------
function updateNav() {
  if (!navEl) return;

  const btns = Array.from(navEl.querySelectorAll("button"));
  const loginBtn = btns.find(b => (b.textContent || "").toLowerCase().includes("login"));
  const regBtn = btns.find(b => (b.textContent || "").toLowerCase().includes("register"));
  const outBtn = btns.find(b => (b.textContent || "").toLowerCase().includes("logout"));

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

// ---------------- AUTH ----------------
async function loadMe() {
  const r = await api("/auth/me");
  state.user = r.user;
  updateNav();
}

window.logout = async function () {
  try { await api("/auth/logout", { method: "POST" }); } catch {}
  state.user = null;
  updateNav();
  setHash("#/login");
  render();
};

window.go = function (page) {
  if (page === "login") setHash("#/login");
  else if (page === "register") setHash("#/register");
  else setHash("#/dashboard");
};

// ---------------- LOADERS ----------------
async function loadCourses() {
  const r = await api(`/courses?lang=${state.lang}`);
  state.courses = Array.isArray(r.courses) ? r.courses : [];
  state.courses.sort((a, b) => {
    const ao = Number.isFinite(a.order) ? a.order : courseFallbackOrder(a.id);
    const bo = Number.isFinite(b.order) ? b.order : courseFallbackOrder(b.id);
    return ao - bo;
  });
}

async function loadLessons(courseId) {
  const r = await api(`/lessons/${courseId}?lang=${state.lang}`);
  state.lessonsByCourse[courseId] = Array.isArray(r.lessons) ? r.lessons : [];
}

async function loadProgress(courseId) {
  const r = await api(`/progress/course/${courseId}`);
  state.progressByCourse[courseId] = r || {};
}

async function loadExamAttempt(courseId) {
  const r = await api(`/exams/${courseId}/attempt`);
  state.examAttemptByCourse[courseId] = r.attempt || null;
}

// Certificates: claim + pdf
async function claimCertificate(courseId) {
  return api(`/certificates/claim`, { method: "POST", body: { courseId } });
}
function certificatePdfUrl(courseId) {
  return `${API_BASE}/certificates/${courseId}/pdf`;
}

// ---------------- RENDER ----------------
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
  if (page === "lesson") return renderLesson(parts[1], parts[2]);
  if (page === "exam") return renderExam(parts[1]);
  if (page === "cert") return renderCertHub(parts[1]);

  setHash("#/dashboard");
  return renderDashboard();
}

// ---------------- LOGIN ----------------
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

// ---------------- REGISTER ----------------
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

// ---------------- DASHBOARD ----------------
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
    state.lang = "en";
    await loadCourses();
    renderDashboard();
  };
  document.getElementById("langTi").onclick = async () => {
    state.lang = "ti";
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

  // meta: lessons progress + exam status
  for (const c of state.courses) {
    const metaEl = document.getElementById(`dashMeta_${c.id}`);
    if (!metaEl) continue;

    try {
      // ensure lessons exist (so total count isn't 0)
      if (!state.lessonsByCourse[c.id]) await loadLessons(c.id);

      await loadProgress(c.id);
      await loadExamAttempt(c.id);

      const { total, completed } = getCourseProgressCounts(c.id);
      const attempt = state.examAttemptByCourse[c.id];

      metaEl.innerHTML = `
        Lessons: <b>${completed}</b> / ${total}
        • Exam: <b>${attempt?.passed ? "PASSED ✅" : (attempt ? "Not passed" : "Not taken")}</b>
      `;
    } catch {
      metaEl.textContent = "";
    }
  }
}

// ---------------- COURSE ----------------
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

// ---------------- LESSON ----------------
async function renderLesson(courseId, lessonIndexStr) {
  const lessonIndex = Number(lessonIndexStr);
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

    <div class="card" id="lessonCard">
      <div class="small">Loading...</div>
    </div>
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

  const lessonCompleted = !!p.completed;

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
      <button class="btn" id="nextBtn" ${nextExists ? "" : "disabled"}>Next</button>
    </div>

    <div class="small" id="saveMsg" style="margin-top:10px;"></div>
    <div class="lockNote" id="nextNote" style="display:${lessonCompleted ? "none" : "block"};">
      🔒 “Next” unlocks after you press <b>Save & Complete</b>.
    </div>
  `;

  document.getElementById("returnBtn").onclick = () => {
    setHash(`#/course/${courseId}`);
    render();
  };

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

      document.getElementById("nextNote").style.display = "none";
    } catch (e) {
      msg.textContent = "Save failed: " + e.message;
    }
  };
}

// ---------------- FINAL EXAM ----------------
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
          <button class="btn" id="backCourse">Back to lessons</button>
          <button class="btn" id="goCert">Certificate</button>
        </div>
      </div>
      <div class="small" id="examMeta" style="margin-top:10px;"></div>
    </div>

    <div class="card" id="examCard">
      <div class="small">Loading exam...</div>
    </div>
  `;

  document.getElementById("backCourse").onclick = () => { setHash(`#/course/${courseId}`); render(); };
  document.getElementById("goCert").onclick = () => { setHash(`#/cert/${courseId}`); render(); };

  let examDef, attempt;
  try {
    examDef = await api(`/exams/${courseId}?lang=${state.lang}`);
    const attR = await api(`/exams/${courseId}/attempt`);
    attempt = attR.attempt || null;
    state.examAttemptByCourse[courseId] = attempt;
  } catch (e) {
    document.getElementById("examCard").innerHTML = `<div class="small">Failed: ${escapeHtml(e.message)}</div>`;
    return;
  }

  const passScore = examDef.passScore ?? 70;
  const questions = examDef.exam?.questions || [];

  document.getElementById("examMeta").innerHTML = `
    Pass score: <b>${passScore}%</b>
    ${attempt ? ` • Last score: <b>${attempt.score}%</b> ${attempt.passed ? "✅ PASSED" : "❌"}` : ""}
  `;

  if (!questions.length) {
    document.getElementById("examCard").innerHTML = `
      <div class="small">Exam not configured yet. Ask admin to add questions.</div>
    `;
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

    // compute score client-side (needs correctIndex in JSON)
    let correct = 0;
    for (let i = 0; i < questions.length; i++) {
      const picked = document.querySelector(`input[name="q_${i}"]:checked`);
      if (!picked) {
        msg.textContent = "Please answer all questions before submitting.";
        return;
      }
      const chosen = Number(picked.value);
      const correctIndex = Number(questions[i].correctIndex);
      if (chosen === correctIndex) correct++;
    }

    const score = Math.round((correct / questions.length) * 100);

    try {
      const r = await api(`/exams/${courseId}/submit`, {
        method: "POST",
        body: { score }
      });

      msg.textContent = r.passed
        ? `✅ Passed! Score: ${score}% (Pass: ${r.passScore}%)`
        : `❌ Not passed. Score: ${score}% (Pass: ${r.passScore}%) — try again.`;

      await loadExamAttempt(courseId);
    } catch (e) {
      msg.textContent = "Submit failed: " + e.message;
    }
  };
}

// ---------------- CERTIFICATE HUB ----------------
async function renderCertHub(courseId) {
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
      <div class="small" id="certMsg" style="margin-top:10px;"></div>
    </div>

    <div class="card" id="certCard">
      <div class="small">Loading...</div>
    </div>
  `;

  document.getElementById("backCourse").onclick = () => { setHash(`#/course/${courseId}`); render(); };
  document.getElementById("openExam").onclick = () => { setHash(`#/exam/${courseId}`); render(); };

  // load lesson progress + exam attempt
  try {
    if (!state.lessonsByCourse[courseId]) await loadLessons(courseId);
    await loadProgress(courseId);
    await loadExamAttempt(courseId);
  } catch (e) {
    document.getElementById("certCard").innerHTML = `<div class="small">Failed: ${escapeHtml(e.message)}</div>`;
    return;
  }

  const { total, completed } = getCourseProgressCounts(courseId);
  const passed = isExamPassed(courseId);
  const attempt = state.examAttemptByCourse[courseId];

  const eligible = total > 0 && completed >= total && passed;

  document.getElementById("certMsg").innerHTML = `
    Lessons completed: <b>${completed}</b> / ${total}
    • Exam: <b>${passed ? "PASSED ✅" : (attempt ? "Not passed" : "Not taken")}</b>
  `;

  if (!eligible) {
    document.getElementById("certCard").innerHTML = `
      <div class="h2">Not eligible yet</div>
      <div class="small">
        To unlock certificate you must:
        <div>✅ Complete all lessons</div>
        <div>✅ Pass the final exam</div>
      </div>
      <div style="height:12px"></div>
      <button class="btn secondary" id="goExamNow">Go to Final Exam</button>
    `;
    document.getElementById("goExamNow").onclick = () => { setHash(`#/exam/${courseId}`); render(); };
    return;
  }

  // Eligible: allow claim + download pdf
  document.getElementById("certCard").innerHTML = `
    <div class="h2">You are eligible ✅</div>
    <div class="small">Claim your certificate, then download the PDF.</div>
    <div style="height:12px"></div>

    <div class="row" style="justify-content:flex-start; gap:10px;">
      <button class="btn primary" id="claimBtn">Claim certificate</button>
      <a class="btn secondary" id="downloadBtn" href="${certificatePdfUrl(courseId)}" target="_blank" rel="noreferrer">
        Download PDF
      </a>
    </div>

    <div class="small" id="claimMsg" style="margin-top:10px;"></div>
  `;

  document.getElementById("claimBtn").onclick = async () => {
    const m = document.getElementById("claimMsg");
    m.textContent = "Claiming...";

    try {
      await claimCertificate(courseId);
      m.textContent = "Claimed ✅ You can download the PDF now.";
      // open directly if you want:
      // window.open(certificatePdfUrl(courseId), "_blank");
    } catch (e) {
      m.textContent = "Failed: " + e.message;
    }
  };
}

// ---------------- BOOT ----------------
(function boot() {
  updateNav();
  if (!location.hash) setHash("#/dashboard");
  render();
})();
