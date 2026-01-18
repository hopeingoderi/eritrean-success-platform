// Admin Panel (Frontend) — STRING course IDs + stable globals
const API_BASE = "https://api.riseeritrea.com/api";

const appEl = document.getElementById("app");
document.getElementById("year").textContent = new Date().getFullYear();
const logoutBtn = document.getElementById("logoutBtn");

const COURSE_ID_BY_KEY = {
  foundation: "foundation",
  growth: "growth",
  excellence: "excellence"
};

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
  if (!res.ok) throw new Error(typeof data.error === "string" ? data.error : "Request failed");
  return data;
}

function setHash(h) { location.hash = h; }
function normalizeQuiz(quiz) {
  if (quiz && typeof quiz === "object") return { questions: Array.isArray(quiz.questions) ? quiz.questions : [] };
  return { questions: [] };
}

let state = {
  user: null,
  selectedCourse: "foundation",
  lessons: [],
  editingLessonId: null
};

logoutBtn.addEventListener("click", async () => {
  try { await api("/auth/logout", { method: "POST" }); } catch {}
  state.user = null;
  setHash("#/login");
  render();
});

async function loadMe() {
  const r = await api("/auth/me");
  state.user = r.user;
  logoutBtn.style.display = state.user ? "inline-flex" : "none";
}

window.addEventListener("hashchange", render);
function routeParts() { return (location.hash || "#/").replace("#/", "").split("/"); }

async function render() {
  try { await loadMe(); } catch { state.user = null; }

  const [page] = routeParts();

  if (!state.user) {
    setHash("#/login");
    return renderLogin();
  }
  if (state.user.role !== "admin") {
    appEl.innerHTML = `
      <div class="card">
        <div class="h1">Admin only</div>
        <p class="p">Please login with an admin account.</p>
        <button class="btn danger" id="logoutNow">Logout</button>
      </div>`;
    document.getElementById("logoutNow").onclick = async () => {
      await api("/auth/logout", { method: "POST" });
      state.user = null;
      setHash("#/login");
      render();
    };
    return;
  }

  if (!page || page === "dashboard") return renderDashboard();
  if (page === "lessons") return renderLessons();
  if (page === "exams") return renderExams();
  return renderDashboard();
}

function renderLogin() {
  appEl.innerHTML = `
    <div class="card">
      <div class="h1">Admin Login</div>
      <label>Email</label>
      <input id="email" type="email" placeholder="admin@example.com" />
      <label>Password</label>
      <input id="password" type="password" placeholder="••••••••" />
      <div style="height:12px"></div>
      <button class="btn primary" id="loginBtn">Login</button>
      <div class="small" id="msg" style="margin-top:10px"></div>
    </div>`;
  document.getElementById("loginBtn").onclick = async () => {
    const email = document.getElementById("email").value.trim();
    const password = document.getElementById("password").value.trim();
    const msg = document.getElementById("msg");
    msg.textContent = "";
    try {
      const r = await api("/auth/login", { method: "POST", body: { email, password } });
      state.user = r.user;
      setHash("#/dashboard");
      render();
    } catch (e) {
      msg.textContent = "Login failed: " + e.message;
    }
  };
}

function renderDashboard() {
  appEl.innerHTML = `
    <div class="card">
      <div class="row">
        <div>
          <div class="h1">Dashboard</div>
          <div class="small">Logged in as <b>${escapeHtml(state.user.name)}</b></div>
        </div>
        <div class="row" style="justify-content:flex-end;">
          <button class="btn primary" onclick="location.hash='#/lessons'">Manage Lessons</button>
          <button class="btn ok" onclick="location.hash='#/exams'">Manage Final Exams</button>
        </div>
      </div>
    </div>`;
}

async function renderLessons() {
  appEl.innerHTML = `
    <div class="card">
      <div class="row">
        <div>
          <div class="h1">Manage Lessons</div>
          <div class="small">Create / edit / delete lessons.</div>
        </div>
        <div class="row" style="justify-content:flex-end;">
          <button class="btn" onclick="location.hash='#/dashboard'">Back</button>
        </div>
      </div>

      <label>Course</label>
      <select id="courseSelect">
        <option value="foundation">foundation</option>
        <option value="growth">growth</option>
        <option value="excellence">excellence</option>
      </select>

      <div style="height:10px"></div>
      <button class="btn primary" id="loadLessonsBtn">Load lessons</button>
      <span class="small" id="lessonsMsg"></span>
    </div>

    <div class="grid two">
      <div class="card" id="lessonsListCard"></div>
      <div class="card" id="lessonEditorCard"></div>
    </div>`;

  const courseSelect = document.getElementById("courseSelect");
  courseSelect.value = state.selectedCourse;

  document.getElementById("loadLessonsBtn").onclick = async () => {
    state.selectedCourse = courseSelect.value;
    await loadLessonsList();
    renderLessonsList();
    renderLessonEditor(null);
  };

  await loadLessonsList();
  renderLessonsList();
  renderLessonEditor(null);
}

async function loadLessonsList() {
  const msg = document.getElementById("lessonsMsg");
  msg.textContent = " Loading...";
  try {
    const courseId = COURSE_ID_BY_KEY[state.selectedCourse];
    const r = await api(`/admin/lessons/${courseId}`);
    state.lessons = r.lessons || [];
    msg.textContent = ` Loaded ✅ (${state.lessons.length})`;
  } catch (e) {
    msg.textContent = " Load failed: " + e.message;
  }
}

function renderLessonsList() {
  const el = document.getElementById("lessonsListCard");
  const rows = state.lessons
    .sort((a, b) => a.lesson_index - b.lesson_index)
    .map(l => `
      <tr>
        <td>${l.lesson_index}</td>
        <td>
          <div><b>${escapeHtml(l.title_en || "")}</b></div>
          <div class="small">${escapeHtml(l.title_ti || "")}</div>
        </td>
        <td style="white-space:nowrap;">
          <button class="btn" onclick="editLesson(${l.id})">Edit</button>
          <button class="btn danger" onclick="deleteLesson(${l.id})">Delete</button>
        </td>
      </tr>`).join("");

  el.innerHTML = `
    <div class="row">
      <div class="h2">Lessons list</div>
      <button class="btn ok" onclick="renderLessonEditor(null)">+ New lesson</button>
    </div>
    <div class="small">Course: <b>${escapeHtml(state.selectedCourse)}</b></div>
    <div style="height:10px"></div>
    <table class="table">
      <thead><tr><th style="width:70px">Index</th><th>Title</th><th style="width:210px">Actions</th></tr></thead>
      <tbody>${rows || `<tr><td colspan="3" class="small">No lessons yet.</td></tr>`}</tbody>
    </table>`;
}

window.editLesson = (id) => {
  const lesson = state.lessons.find(x => x.id === id);
  renderLessonEditor(lesson || null);
};

window.deleteLesson = async (id) => {
  if (!confirm("Delete this lesson?")) return;
  try {
    await api(`/admin/lesson/${id}`, { method: "DELETE" });
    await loadLessonsList();
    renderLessonsList();
    renderLessonEditor(null);
    alert("Deleted ✅");
  } catch (e) {
    alert("Delete failed: " + e.message);
  }
};

function renderLessonEditor(lesson) {
  const el = document.getElementById("lessonEditorCard");
  const isEdit = !!lesson;
  state.editingLessonId = isEdit ? lesson.id : null;

  const courseKey = state.selectedCourse;
  const lessonIndex = isEdit ? lesson.lesson_index : 0;

  el.innerHTML = `
    <div class="row">
      <div class="h2">${isEdit ? "Edit lesson" : "Create lesson"}</div>
      <span class="badge">${isEdit ? `ID: ${lesson.id}` : "New"}</span>
    </div>

    <label>Course</label>
    <select id="editCourseKey">
      <option value="foundation">foundation</option>
      <option value="growth">growth</option>
      <option value="excellence">excellence</option>
    </select>

    <label>Lesson index (0..9)</label>
    <input id="editLessonIndex" type="number" value="${lessonIndex}" />

    <hr/>

    <label>Title (English)</label>
    <input id="title_en" type="text" value="${isEdit ? escapeHtml(lesson.title_en || "") : ""}" />

    <label>Title (Tigrinya)</label>
    <input id="title_ti" type="text" value="${isEdit ? escapeHtml(lesson.title_ti || "") : ""}" />

    <label>Learn text (English)</label>
    <textarea id="learn_en"></textarea>

    <label>Learn text (Tigrinya)</label>
    <textarea id="learn_ti"></textarea>

    <label>Task (English)</label>
    <input id="task_en" type="text" />

    <label>Task (Tigrinya)</label>
    <input id="task_ti" type="text" />

    <label>Quiz JSON</label>
    <textarea id="quiz_json" class="codeHint"></textarea>

    <div style="height:10px"></div>
    <button class="btn ok" id="saveLessonBtn">${isEdit ? "Save changes" : "Create lesson"}</button>
    <div class="small" id="saveLessonMsg" style="margin-top:10px"></div>
  `;

  document.getElementById("editCourseKey").value = courseKey;

  if (isEdit) {
    // no hydrate via /lessons needed; editor is full form; keep simple
    document.getElementById("learn_en").value = "";
    document.getElementById("learn_ti").value = "";
    document.getElementById("task_en").value = "";
    document.getElementById("task_ti").value = "";
    document.getElementById("quiz_json").value = JSON.stringify({ questions: [] }, null, 2);
  } else {
    document.getElementById("learn_en").value = "";
    document.getElementById("learn_ti").value = "";
    document.getElementById("task_en").value = "";
    document.getElementById("task_ti").value = "";
    document.getElementById("quiz_json").value = JSON.stringify({
      questions: [{ text: "Question 1", options: ["Option A", "Option B"], correctIndex: 0 }]
    }, null, 2);
  }

  document.getElementById("saveLessonBtn").onclick = saveLesson;
}

async function saveLesson() {
  const msg = document.getElementById("saveLessonMsg");
  msg.textContent = "";

  const id = state.editingLessonId;
  const courseKey = document.getElementById("editCourseKey").value;
  const courseId = COURSE_ID_BY_KEY[courseKey];

  const lessonIndex = Number(document.getElementById("editLessonIndex").value);
  const payload = {
    ...(id ? { id } : {}),
    courseId,
    lessonIndex,
    title_en: document.getElementById("title_en").value.trim(),
    title_ti: document.getElementById("title_ti").value.trim(),
    learn_en: document.getElementById("learn_en").value.trim(),
    learn_ti: document.getElementById("learn_ti").value.trim(),
    task_en: document.getElementById("task_en").value.trim(),
    task_ti: document.getElementById("task_ti").value.trim(),
    quiz: normalizeQuiz(JSON.parse(document.getElementById("quiz_json").value || "{}"))
  };

  try {
    await api("/admin/lesson/save", { method: "POST", body: payload });
    msg.textContent = "Saved ✅";
    state.selectedCourse = courseKey;
    await loadLessonsList();
    renderLessonsList();
  } catch (e) {
    msg.textContent = "Save failed: " + e.message;
  }
}

async function renderExams() {
  appEl.innerHTML = `
    <div class="card">
      <div class="row">
        <div><div class="h1">Manage Final Exams</div></div>
        <div class="row" style="justify-content:flex-end;">
          <button class="btn" onclick="location.hash='#/dashboard'">Back</button>
        </div>
      </div>

      <label>Course</label>
      <select id="examCourseSelect">
        <option value="foundation">foundation</option>
        <option value="growth">growth</option>
        <option value="excellence">excellence</option>
      </select>

      <label>Pass score (0–100)</label>
      <input id="passScore" type="number" value="70" />

      <hr/>

      <label>Exam JSON (English)</label>
      <textarea id="examJsonEn" class="codeHint"></textarea>

      <label>Exam JSON (Tigrinya)</label>
      <textarea id="examJsonTi" class="codeHint"></textarea>

      <div style="height:10px"></div>
      <div class="row">
        <button class="btn primary" id="loadExamBtn">Load</button>
        <button class="btn ok" id="saveExamBtn">Save</button>
      </div>

      <div class="small" id="examMsg" style="margin-top:10px"></div>
    </div>
  `;

  document.getElementById("examCourseSelect").value = state.selectedCourse;
  document.getElementById("loadExamBtn").onclick = loadExam;
  document.getElementById("saveExamBtn").onclick = saveExam;

  await loadExam();
}

async function loadExam() {
  const courseKey = document.getElementById("examCourseSelect").value;
  const courseId = COURSE_ID_BY_KEY[courseKey];
  const msg = document.getElementById("examMsg");
  msg.textContent = "Loading...";

  try {
    const r = await api(`/admin/exam/${courseId}`);
    document.getElementById("passScore").value = r.passScore ?? 70;
    document.getElementById("examJsonEn").value = JSON.stringify(r.exam_en || { questions: [] }, null, 2);
    document.getElementById("examJsonTi").value = JSON.stringify(r.exam_ti || { questions: [] }, null, 2);
    msg.textContent = "Loaded ✅";
    state.selectedCourse = courseKey;
  } catch (e) {
    msg.textContent = "Load failed: " + e.message;
  }
}

async function saveExam() {
  const courseKey = document.getElementById("examCourseSelect").value;
  const courseId = COURSE_ID_BY_KEY[courseKey];
  const msg = document.getElementById("examMsg");
  msg.textContent = "";

  const passScore = Number(document.getElementById("passScore").value);

  let exam_en, exam_ti;
  try {
    exam_en = JSON.parse(document.getElementById("examJsonEn").value || "{}");
    exam_ti = JSON.parse(document.getElementById("examJsonTi").value || "{}");
  } catch {
    msg.textContent = "Invalid JSON.";
    return;
  }

  try {
    await api("/admin/exam/save", { method: "POST", body: { courseId, passScore, exam_en, exam_ti } });
    msg.textContent = "Saved ✅";
  } catch (e) {
    msg.textContent = "Save failed: " + e.message;
  }
}

// ✅ Needed for inline onclick in HTML
window.renderLessonEditor = renderLessonEditor;

(function boot() {
  if (!location.hash) setHash("#/login");
  render();
})();
