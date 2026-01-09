// ================= CONFIG =================
// Change this when deployed:
const API_BASE = "http://localhost:4000/api";
// Example Render: const API_BASE = "https://YOUR-SERVICE.onrender.com/api";

const appEl = document.getElementById("app");
document.getElementById("year").textContent = new Date().getFullYear();

const logoutBtn = document.getElementById("logoutBtn");

// ================= HELPERS =================
function escapeHtml(str=""){
  return str.replace(/[&<>"']/g, m => ({
    "&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"
  })[m]);
}

async function api(path, { method="GET", body } = {}) {
  const res = await fetch(API_BASE + path, {
    method,
    headers: { "Content-Type": "application/json" },
    credentials: "include",
    body: body ? JSON.stringify(body) : undefined
  });

  const data = await res.json().catch(()=> ({}));
  if (!res.ok) {
    const msg = typeof data.error === "string"
      ? data.error
      : (Array.isArray(data.error) ? "Validation error" : "Request failed");
    throw new Error(msg);
  }
  return data;
}

function setHash(h){ location.hash = h; }

// ================= STATE =================
let state = {
  user: null,
  selectedCourse: "foundation",
  lessons: [],
  editingLessonId: null
};

// ================= AUTH =================
logoutBtn.addEventListener("click", async () => {
  try { await api("/auth/logout", { method:"POST" }); } catch {}
  state.user = null;
  setHash("#/login");
  render();
});

async function loadMe(){
  const r = await api("/auth/me");
  state.user = r.user;
  logoutBtn.style.display = state.user ? "inline-flex" : "none";
}

// ================= ROUTER =================
window.addEventListener("hashchange", render);

function routeParts(){
  return (location.hash || "#/").replace("#/","").split("/");
}

// ================= RENDER =================
async function render(){
  try { await loadMe(); } catch { state.user = null; }

  const parts = routeParts();
  const page = parts[0] || "";

  if(!state.user){
    setHash("#/login");
    return renderLogin();
  }

  // Must be admin
  if(state.user.role !== "admin"){
    appEl.innerHTML = `
      <div class="card">
        <div class="h1">Admin only</div>
        <p class="p">Your account is not an admin. Please login with an admin account.</p>
        <button class="btn danger" id="logoutNow">Logout</button>
      </div>
    `;
    document.getElementById("logoutNow").onclick = async () => {
      await api("/auth/logout", { method:"POST" });
      state.user = null;
      setHash("#/login");
      render();
    };
    return;
  }

  if(page === "" || page === "dashboard") return renderDashboard();
  if(page === "lessons") return renderLessons();
  if(page === "exams") return renderExams();

  return renderDashboard();
}

// ================= LOGIN PAGE =================
function renderLogin(){
  appEl.innerHTML = `
    <div class="card">
      <div class="h1">Admin Login</div>
      <p class="p">Login with an admin account to manage lessons and exams.</p>

      <label>Email</label>
      <input id="email" type="email" placeholder="admin@example.com" />

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

    try{
      const r = await api("/auth/login", { method:"POST", body: { email, password } });
      state.user = r.user;
      setHash("#/dashboard");
      render();
    }catch(e){
      msg.textContent = "Login failed: " + e.message;
    }
  };
}

// ================= DASHBOARD =================
function renderDashboard(){
  appEl.innerHTML = `
    <div class="card">
      <div class="row">
        <div>
          <div class="h1">Dashboard</div>
          <div class="small">Logged in as <b>${escapeHtml(state.user.name)}</b> • ${escapeHtml(state.user.email)}</div>
        </div>
        <div class="row" style="justify-content:flex-end;">
          <button class="btn primary" onclick="location.hash='#/lessons'">Manage Lessons</button>
          <button class="btn ok" onclick="location.hash='#/exams'">Manage Final Exams</button>
        </div>
      </div>
      <p class="p">Use this panel to update lesson content and edit final exams (EN + TI) and pass score.</p>
    </div>

    <div class="card">
      <div class="h2">Quick tips</div>
      <div class="small">
        <div>• Keep lesson_index starting at <b>0</b> (0..9 for 10 lessons).</div>
        <div>• Quiz JSON format: <span class="codeHint">{"questions":[{"text":"...","options":["A","B"],"correctIndex":0}]}</span></div>
        <div>• Exam JSON format is the same as quiz.</div>
      </div>
    </div>
  `;
}

// ================= LESSONS =================
async function renderLessons(){
  appEl.innerHTML = `
    <div class="card">
      <div class="row">
        <div>
          <div class="h1">Manage Lessons</div>
          <div class="small">Create, edit, and delete lessons for each course.</div>
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
      <div class="card" id="lessonsListCard">
        <div class="h2">Lessons list</div>
        <div class="small">Load lessons to see them here.</div>
      </div>

      <div class="card" id="lessonEditorCard">
        <div class="h2">Lesson editor</div>
        <div class="small">Select a lesson from the left, or create a new one.</div>
      </div>
    </div>
  `;

  const courseSelect = document.getElementById("courseSelect");
  courseSelect.value = state.selectedCourse;

  document.getElementById("loadLessonsBtn").onclick = async () => {
    state.selectedCourse = courseSelect.value;
    await loadLessonsList();
    renderLessonsList();
    renderLessonEditor(null); // new lesson editor
  };

  // auto-load when entering page
  await loadLessonsList();
  renderLessonsList();
  renderLessonEditor(null);
}

async function loadLessonsList(){
  const msg = document.getElementById("lessonsMsg");
  msg.textContent = " Loading...";
  try{
    const r = await api(`/admin/lessons/${state.selectedCourse}`);
    state.lessons = r.lessons || [];
    msg.textContent = ` Loaded ✅ (${state.lessons.length})`;
  }catch(e){
    msg.textContent = " Load failed: " + e.message;
  }
}

function renderLessonsList(){
  const el = document.getElementById("lessonsListCard");
  const rows = state.lessons
    .sort((a,b)=>a.lesson_index-b.lesson_index)
    .map(l => `
      <tr>
        <td>${l.lesson_index}</td>
        <td>
          <div><b>${escapeHtml(l.title_en)}</b></div>
          <div class="small">${escapeHtml(l.title_ti)}</div>
        </td>
        <td style="white-space:nowrap;">
          <button class="btn" onclick="editLesson(${l.id})">Edit</button>
          <button class="btn danger" onclick="deleteLesson(${l.id})">Delete</button>
        </td>
      </tr>
    `).join("");

  el.innerHTML = `
    <div class="row">
      <div class="h2">Lessons list</div>
      <button class="btn ok" onclick="renderLessonEditor(null)">+ New lesson</button>
    </div>
    <div class="small">Course: <b>${escapeHtml(state.selectedCourse)}</b></div>
    <div style="height:10px"></div>

    <table class="table">
      <thead>
        <tr>
          <th style="width:70px">Index</th>
          <th>Title</th>
          <th style="width:210px">Actions</th>
        </tr>
      </thead>
      <tbody>
        ${rows || `<tr><td colspan="3" class="small">No lessons yet.</td></tr>`}
      </tbody>
    </table>
  `;
}

window.editLesson = function(id){
  const lesson = state.lessons.find(x => x.id === id);
  renderLessonEditor(lesson || null);
}

window.deleteLesson = async function(id){
  if(!confirm("Delete this lesson?")) return;
  try{
    await api(`/admin/lesson/${id}`, { method:"DELETE" });
    await loadLessonsList();
    renderLessonsList();
    renderLessonEditor(null);
    alert("Deleted ✅");
  }catch(e){
    alert("Delete failed: " + e.message);
  }
}

function renderLessonEditor(lesson){
  const el = document.getElementById("lessonEditorCard");
  const isEdit = !!lesson;
  state.editingLessonId = isEdit ? lesson.id : null;

  // editor fields; for create, start with defaults
  const courseId = state.selectedCourse;
  const lessonIndex = isEdit ? lesson.lesson_index : 0;

  el.innerHTML = `
    <div class="row">
      <div class="h2">${isEdit ? "Edit lesson" : "Create lesson"}</div>
      <span class="badge">${isEdit ? `ID: ${lesson.id}` : "New"}</span>
    </div>

    <label>Course ID</label>
    <select id="editCourseId">
      <option value="foundation">foundation</option>
      <option value="growth">growth</option>
      <option value="excellence">excellence</option>
    </select>

    <label>Lesson index (0..9)</label>
    <input id="editLessonIndex" type="number" value="${lessonIndex}" />

    <hr/>

    <label>Title (English)</label>
    <input id="title_en" type="text" value="${isEdit ? escapeHtml(lesson.title_en) : ""}" placeholder="Lesson title in English" />

    <label>Title (Tigrinya)</label>
    <input id="title_ti" type="text" value="${isEdit ? escapeHtml(lesson.title_ti) : ""}" placeholder="Lesson title in Tigrinya" />

    <label>Learn text (English)</label>
    <textarea id="learn_en" placeholder="Lesson content in English"></textarea>

    <label>Learn text (Tigrinya)</label>
    <textarea id="learn_ti" placeholder="Lesson content in Tigrinya"></textarea>

    <label>Task (English)</label>
    <input id="task_en" type="text" placeholder="Task in English" />

    <label>Task (Tigrinya)</label>
    <input id="task_ti" type="text" placeholder="Task in Tigrinya" />

    <label>Quiz JSON</label>
    <textarea id="quiz_json" class="codeHint" placeholder='{"questions":[{"text":"...","options":["A","B"],"correctIndex":0}]}'></textarea>

    <div style="height:10px"></div>
    <button class="btn ok" id="saveLessonBtn">${isEdit ? "Save changes" : "Create lesson"}</button>
    <div class="small" id="saveLessonMsg" style="margin-top:10px"></div>
  `;

  // set selected course
  const courseSel = document.getElementById("editCourseId");
  courseSel.value = courseId;

  // If editing, we need full lesson data (learn/task/quiz). The list endpoint only returns titles.
  // We'll load the lesson from DB via lessons API for that course and index (simple approach).
  if(isEdit){
    hydrateLessonFields(courseId, lesson.lesson_index).catch(()=>{});
  } else {
    // defaults for new lesson
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

async function hydrateLessonFields(courseId, lessonIndex){
  // Use student lessons endpoint (admin is logged in; requireAuth passes)
  // This returns learn/task/quiz. We'll fill the editor.
  const r = await api(`/lessons/${courseId}?lang=en`);
  const l = (r.lessons || []).find(x => x.lessonIndex === lessonIndex);
  if(!l) return;

  // We also need TI fields; load TI version too
  const rTi = await api(`/lessons/${courseId}?lang=ti`);
  const lTi = (rTi.lessons || []).find(x => x.lessonIndex === lessonIndex);

  document.getElementById("learn_en").value = l.learnText || "";
  document.getElementById("task_en").value = l.task || "";
  document.getElementById("quiz_json").value = JSON.stringify(l.quiz || { questions: [] }, null, 2);

  if(lTi){
    document.getElementById("learn_ti").value = lTi.learnText || "";
    document.getElementById("task_ti").value = lTi.task || "";
  }
}

async function saveLesson(){
  const msg = document.getElementById("saveLessonMsg");
  msg.textContent = "";

  const id = state.editingLessonId;
  const courseId = document.getElementById("editCourseId").value;
  const lessonIndex = Number(document.getElementById("editLessonIndex").value);

  const title_en = document.getElementById("title_en").value.trim();
  const title_ti = document.getElementById("title_ti").value.trim();
  const learn_en = document.getElementById("learn_en").value.trim();
  const learn_ti = document.getElementById("learn_ti").value.trim();
  const task_en = document.getElementById("task_en").value.trim();
  const task_ti = document.getElementById("task_ti").value.trim();

  let quiz;
  try{
    quiz = JSON.parse(document.getElementById("quiz_json").value);
  }catch{
    msg.textContent = "Invalid quiz JSON. Please fix it.";
    return;
  }

  const payload = {
    ...(id ? { id } : {}),
    courseId,
    lessonIndex,
    title_en,
    title_ti,
    learn_en,
    learn_ti,
    task_en,
    task_ti,
    quiz
  };

  try{
    await api("/admin/lesson/save", { method:"POST", body: payload });
    msg.textContent = "Saved ✅";
    state.selectedCourse = courseId;
    await loadLessonsList();
    renderLessonsList();
  }catch(e){
    msg.textContent = "Save failed: " + e.message;
  }
}

// ================= EXAMS =================
async function renderExams(){
  appEl.innerHTML = `
    <div class="card">
      <div class="row">
        <div>
          <div class="h1">Manage Final Exams</div>
          <div class="small">Edit pass score and exam questions (English + Tigrinya).</div>
        </div>
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
      <textarea id="examJsonEn" class="codeHint" placeholder='{"questions":[{"text":"...","options":["A","B"],"correctIndex":0}]}'></textarea>

      <label>Exam JSON (Tigrinya)</label>
      <textarea id="examJsonTi" class="codeHint" placeholder='{"questions":[{"text":"...","options":["...","..."],"correctIndex":0}]}'></textarea>

      <div style="height:10px"></div>

      <div class="row" style="justify-content:flex-start;">
        <button class="btn primary" id="loadExamBtn">Load exam</button>
        <button class="btn ok" id="saveExamBtn">Save exam</button>
      </div>

      <div class="small" id="examMsg" style="margin-top:10px"></div>

      <hr/>
      <div class="small">
        Format example:
        <div class="codeHint">{"questions":[{"text":"Question?","options":["A","B","C"],"correctIndex":1}]}</div>
      </div>
    </div>
  `;

  document.getElementById("examCourseSelect").value = state.selectedCourse;

  document.getElementById("loadExamBtn").onclick = loadExam;
  document.getElementById("saveExamBtn").onclick = saveExam;

  await loadExam();
}

async function loadExam(){
  const courseId = document.getElementById("examCourseSelect").value;
  const msg = document.getElementById("examMsg");
  msg.textContent = "Loading...";

  try{
    const r = await api(`/admin/exam/${courseId}`);
    document.getElementById("passScore").value = (r.passScore ?? 70);
    document.getElementById("examJsonEn").value = JSON.stringify(r.exam_en || {questions:[]}, null, 2);
    document.getElementById("examJsonTi").value = JSON.stringify(r.exam_ti || {questions:[]}, null, 2);
    msg.textContent = "Loaded ✅";
    state.selectedCourse = courseId;
  }catch(e){
    msg.textContent = "Load failed: " + e.message;
  }
}

async function saveExam(){
  const courseId = document.getElementById("examCourseSelect").value;
  const msg = document.getElementById("examMsg");
  msg.textContent = "";

  const passScore = Number(document.getElementById("passScore").value);

  let exam_en, exam_ti;
  try{
    exam_en = JSON.parse(document.getElementById("examJsonEn").value || "{}");
    exam_ti = JSON.parse(document.getElementById("examJsonTi").value || "{}");
  }catch{
    msg.textContent = "Invalid JSON. Please fix and try again.";
    return;
  }

  try{
    await api("/admin/exam/save", {
      method:"POST",
      body: { courseId, passScore, exam_en, exam_ti }
    });
    msg.textContent = "Saved ✅";
    state.selectedCourse = courseId;
  }catch(e){
    msg.textContent = "Save failed: " + e.message;
  }
}

// ================= BOOT =================
(function boot(){
  if(!location.hash) setHash("#/login");
  render();
})();
