require("dotenv").config();
const bcrypt = require("bcryptjs");
const { query } = require("./db_pg");

function q(text, options, correctIndex){ return { text, options, correctIndex }; }
function quiz(questions){ return { questions }; }
function exam(questions){ return { questions }; }

async function upsertCourse(c){
  await query(
    `INSERT INTO courses (id, title_en, title_ti, intro_en, intro_ti)
     VALUES ($1,$2,$3,$4,$5)
     ON CONFLICT (id) DO UPDATE SET
       title_en=EXCLUDED.title_en,
       title_ti=EXCLUDED.title_ti,
       intro_en=EXCLUDED.intro_en,
       intro_ti=EXCLUDED.intro_ti`,
    [c.id, c.title_en, c.title_ti, c.intro_en, c.intro_ti]
  );
}

async function upsertLesson(l){
  await query(
    `INSERT INTO lessons (course_id, lesson_index, title_en, title_ti, learn_en, learn_ti, task_en, task_ti, quiz)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9::jsonb)
     ON CONFLICT (course_id, lesson_index) DO UPDATE SET
       title_en=EXCLUDED.title_en,
       title_ti=EXCLUDED.title_ti,
       learn_en=EXCLUDED.learn_en,
       learn_ti=EXCLUDED.learn_ti,
       task_en=EXCLUDED.task_en,
       task_ti=EXCLUDED.task_ti,
       quiz=EXCLUDED.quiz`,
    [
      l.course_id,
      l.lesson_index,
      l.title_en,
      l.title_ti,
      l.learn_en,
      l.learn_ti,
      l.task_en,
      l.task_ti,
      JSON.stringify(l.quiz) // 👈 ensure jsonb
    ]
  );
}

async function upsertExam(courseId, passScore, enExam){
  const tiExam = {
    questions: enExam.questions.map(qq => ({
      text: `TI: ${qq.text}`,
      options: qq.options.map(o => `TI: ${o}`),
      correctIndex: qq.correctIndex
    }))
  };

  await query(
    `INSERT INTO exam_defs (course_id, pass_score, exam_json_en, exam_json_ti)
     VALUES ($1,$2,$3,$4)
     ON CONFLICT (course_id) DO UPDATE SET
       pass_score=EXCLUDED.pass_score,
       exam_json_en=EXCLUDED.exam_json_en,
       exam_json_ti=EXCLUDED.exam_json_ti`,
    [courseId, passScore, JSON.stringify(enExam), JSON.stringify(tiExam)]
  );
}

async function ensureAdmin(){
  const email = "admin@example.com";
  const password = "Admin123!";
  const name = "Site Admin";

  const r = await query("SELECT id FROM users WHERE email=$1", [email]);
  if (r.rows.length) {
    console.log("Admin already exists:", email);
    return;
  }

  const hash = bcrypt.hashSync(password, 10);
  await query(
    "INSERT INTO users (name, email, password_hash, role) VALUES ($1,$2,$3,$4)",
    [name, email, hash, "admin"]
  );

  console.log("✅ Created admin:");
  console.log("   Email:", email);
  console.log("   Password:", password);
}

function makeLesson(course_id, lesson_index, title_en, learn_en, task_en, questions){
  return {
    course_id,
    lesson_index,
    title_en,
    title_ti: `TI: ${title_en}`,
    learn_en,
    learn_ti: `TI: ${learn_en}`,
    task_en,
    task_ti: `TI: ${task_en}`,
    quiz: quiz(questions) // ✅ object, not string
  };
}

async function seed(){
  // courses
  await upsertCourse({
    id: "foundation",
    title_en: "Level 1: Foundation",
    title_ti: "ደረጃ 1፡ መሠረት",
    intro_en: "Build your mindset, confidence, and study basics.",
    intro_ti: "TI: Build your mindset, confidence, and study basics."
  });
  await upsertCourse({
    id: "growth",
    title_en: "Level 2: Growth",
    title_ti: "ደረጃ 2፡ እድገት",
    intro_en: "Build discipline, habits, communication, and consistency.",
    intro_ti: "TI: Build discipline, habits, communication, and consistency."
  });
  await upsertCourse({
    id: "excellence",
    title_en: "Level 3: Excellence",
    title_ti: "ደረጃ 3፡ ብልጽግና",
    intro_en: "Leadership, vision, integrity, and long-term success.",
    intro_ti: "TI: Leadership, vision, integrity, and long-term success."
  });

  // lessons (same content you had; TI placeholders)
  const lessons = [];

  // Foundation 10
  lessons.push(makeLesson("foundation",0,"Believe in Yourself","Believing in yourself means knowing you can improve. Success is built step by step through practice.","Write 3 things you are good at.",[
    q("Believing in yourself means you can improve.",["True","False"],0),
    q("Success is only for people born talented.",["True","False"],1),
    q("Daily practice can help you succeed.",["Yes","No"],0)
  ]));
  lessons.push(makeLesson("foundation",1,"Why Education Matters","Education helps you understand the world, make good decisions, and build a better future.","Write 1 reason why school is important to you.",[
    q("Education can help your future.",["True","False"],0),
    q("Learning is a kind of power.",["True","False"],0),
    q("School is useless for everyone.",["True","False"],1)
  ]));
  lessons.push(makeLesson("foundation",2,"Growth Mindset","A growth mindset means mistakes help you learn, and effort makes you stronger.","Write one mistake you learned from.",[
    q("Mistakes can help you learn.",["True","False"],0),
    q("If you fail once, you should stop forever.",["True","False"],1),
    q("Effort can improve your ability.",["True","False"],0)
  ]));
  lessons.push(makeLesson("foundation",3,"Confidence Without Pride","Confidence means believing in yourself while respecting others. Pride pushes people away.","Do one kind action today.",[
    q("Confidence can include kindness.",["True","False"],0),
    q("Pride can harm relationships.",["True","False"],0),
    q("Being kind makes you weak.",["True","False"],1)
  ]));
  lessons.push(makeLesson("foundation",4,"Responsibility Starts With You","Responsible people do their duties, keep promises, and learn from their actions.","Complete one task without being told.",[
    q("Responsibility includes doing your homework.",["True","False"],0),
    q("Blaming others helps you grow.",["True","False"],1),
    q("Successful people take responsibility.",["True","False"],0)
  ]));
  lessons.push(makeLesson("foundation",5,"Respect Yourself and Others","Respect means listening, speaking politely, and valuing yourself and others.","Speak politely all day today.",[
    q("Respect includes listening.",["True","False"],0),
    q("Polite speech is part of respect.",["True","False"],0),
    q("Respect is not important.",["True","False"],1)
  ]));
  lessons.push(makeLesson("foundation",6,"Basic Study Habits","Good study habits include a regular study time, a quiet place, and short breaks.","Create a 30-minute daily study time.",[
    q("Studying at the same time daily can help.",["True","False"],0),
    q("A quiet place can improve learning.",["True","False"],0),
    q("No breaks is always best.",["True","False"],1)
  ]));
  lessons.push(makeLesson("foundation",7,"Focus and Avoid Distractions","Focus helps you learn faster. Reduce distractions like phone and noise during study.","Study 20 minutes with no phone.",[
    q("Distractions can reduce learning.",["True","False"],0),
    q("Focus helps you finish tasks.",["True","False"],0),
    q("Phones always help studying.",["True","False"],1)
  ]));
  lessons.push(makeLesson("foundation",8,"Time Is Your Friend","Time is valuable. When you plan, you waste less time and learn more.","Write a simple daily schedule.",[
    q("Time is valuable.",["True","False"],0),
    q("Planning can help you use time better.",["True","False"],0),
    q("Wasting time helps success.",["True","False"],1)
  ]));
  lessons.push(makeLesson("foundation",9,"Your First Success Plan","Success needs a goal, a plan, and daily action. Small steps create big results.","Write 1 goal and 1 daily action.",[
    q("A goal without action is enough.",["True","False"],1),
    q("Small steps can create big results.",["True","False"],0),
    q("Planning can help you stay focused.",["True","False"],0)
  ]));

  // Growth 10
  lessons.push(makeLesson("growth",0,"Discipline Is Freedom","Discipline means doing what is right even when it is hard. It creates freedom later.","Do one hard task today without complaining.",[
    q("Discipline means waiting only for motivation.",["True","False"],1),
    q("Discipline can help your future.",["True","False"],0),
    q("Doing hard things builds strength.",["True","False"],0)
  ]));
  lessons.push(makeLesson("growth",1,"Building Daily Habits","Habits shape your life. Good habits build success step by step.","Choose one good habit and do it daily for 7 days.",[
    q("Habits affect your future.",["True","False"],0),
    q("Repeating actions can form habits.",["True","False"],0),
    q("Only big actions matter.",["True","False"],1)
  ]));
  lessons.push(makeLesson("growth",2,"Consistency Beats Talent","Small effort every day is stronger than big effort once. Consistency wins.","Practice one skill for 15 minutes daily.",[
    q("Consistency is important for success.",["True","False"],0),
    q("Talent alone guarantees success.",["True","False"],1),
    q("Daily practice improves skills.",["True","False"],0)
  ]));
  lessons.push(makeLesson("growth",3,"Time Management for Students","Plan your day, do important tasks first, and reduce wasted time.","Make a simple daily timetable.",[
    q("Planning can reduce stress.",["True","False"],0),
    q("Important tasks should always be last.",["True","False"],1),
    q("Wasting time can hurt your goals.",["True","False"],0)
  ]));
  lessons.push(makeLesson("growth",4,"Focus Like a Champion","Focus helps you learn faster and finish tasks. Avoid multitasking.","Study for 25 minutes with full focus.",[
    q("Multitasking always improves learning.",["True","False"],1),
    q("Focus can reduce mistakes.",["True","False"],0),
    q("Short focused sessions can be useful.",["True","False"],0)
  ]));
  lessons.push(makeLesson("growth",5,"Communication Skills","Good communication is speaking clearly, listening carefully, and respecting others.","Listen carefully before speaking today.",[
    q("Listening is part of communication.",["True","False"],0),
    q("Respect improves conversations.",["True","False"],0),
    q("Interrupting is respectful.",["True","False"],1)
  ]));
  lessons.push(makeLesson("growth",6,"Confidence in Speaking","Confidence grows with preparation and practice. Fear becomes smaller with action.","Speak up once today (class/family/friends).",[
    q("Preparation helps confidence.",["True","False"],0),
    q("Practice improves speaking.",["True","False"],0),
    q("Fear disappears without practice.",["True","False"],1)
  ]));
  lessons.push(makeLesson("growth",7,"Handling Failure and Stress","Failure is a teacher. Stress can be part of growth. Learn and continue.","Write one lesson you learned from a failure.",[
    q("Failure can teach lessons.",["True","False"],0),
    q("Strong people always quit after failure.",["True","False"],1),
    q("Stress can be part of growth.",["True","False"],0)
  ]));
  lessons.push(makeLesson("growth",8,"Self-Control and Choices","Self-control helps you choose what is best, not what is easy. Choices have results.","Say “no” to one bad habit today.",[
    q("Every choice has a result.",["True","False"],0),
    q("Self-control helps success.",["True","False"],0),
    q("Temptations always help goals.",["True","False"],1)
  ]));
  lessons.push(makeLesson("growth",9,"Becoming Reliable","Reliable people keep promises, arrive on time, and finish what they start.","Finish one task completely today.",[
    q("Reliable people finish what they start.",["True","False"],0),
    q("Arriving late builds trust.",["True","False"],1),
    q("Keeping promises builds respect.",["True","False"],0)
  ]));

  // Excellence 10
  lessons.push(makeLesson("excellence",0,"What Is True Leadership?","Leadership is setting a good example, taking responsibility, and helping others grow.","Help one person today without expecting anything.",[
    q("Leadership is only about power.",["True","False"],1),
    q("Leaders help others grow.",["True","False"],0),
    q("Serving others can be leadership.",["True","False"],0)
  ]));
  lessons.push(makeLesson("excellence",1,"Leading Yourself First","Self-leadership means controlling actions, managing time, and keeping promises.","Follow your daily plan today without excuses.",[
    q("Self-leadership builds respect.",["True","False"],0),
    q("Promises are not important for leaders.",["True","False"],1),
    q("Managing your time is part of leadership.",["True","False"],0)
  ]));
  lessons.push(makeLesson("excellence",2,"Vision for Your Future","Vision means seeing your future clearly. It guides your decisions and actions.","Write your future story (short paragraph).",[
    q("Vision helps guide decisions.",["True","False"],0),
    q("Future planning is useless.",["True","False"],1),
    q("A clear vision can motivate action.",["True","False"],0)
  ]));
  lessons.push(makeLesson("excellence",3,"Long-Term Goal Setting","Long-term goals give purpose. They help you plan education, career, and life.","Write one 5-year goal.",[
    q("Long-term goals can give purpose.",["True","False"],0),
    q("Goals never help success.",["True","False"],1),
    q("Education goals can be long-term.",["True","False"],0)
  ]));
  lessons.push(makeLesson("excellence",4,"Planning Your Career Path","A career is built step by step. Research and skills help you choose wisely.","Research one career you like and write 3 skills it needs.",[
    q("Research helps career choices.",["True","False"],0),
    q("Skills are not needed for careers.",["True","False"],1),
    q("Interests can guide career choices.",["True","False"],0)
  ]));
  lessons.push(makeLesson("excellence",5,"Money Basics & Responsibility","Money is a tool. Saving and wise spending help your future and reduce stress.","Save a small amount this week (even a little).",[
    q("Saving can help your future.",["True","False"],0),
    q("Spending everything is the best plan.",["True","False"],1),
    q("Money can be used as a tool.",["True","False"],0)
  ]));
  lessons.push(makeLesson("excellence",6,"Integrity and Character","Integrity means being honest and doing the right thing even when it is difficult.","Choose honesty in one situation this week.",[
    q("Integrity includes honesty.",["True","False"],0),
    q("Character does not matter.",["True","False"],1),
    q("Values help guide decisions.",["True","False"],0)
  ]));
  lessons.push(makeLesson("excellence",7,"Serving Your Community","True success includes helping others. Service strengthens your community and character.","Do one helpful action for your community or family.",[
    q("Community service can create meaning.",["True","False"],0),
    q("Helping others reduces success.",["True","False"],1),
    q("Strong communities grow with service.",["True","False"],0)
  ]));
  lessons.push(makeLesson("excellence",8,"Learning Never Stops","Successful people keep learning new skills. Learning builds confidence and opportunity.","Learn one new thing this week and write what you learned.",[
    q("Successful people keep learning.",["True","False"],0),
    q("Learning ends after school.",["True","False"],1),
    q("New skills can build confidence.",["True","False"],0)
  ]));
  lessons.push(makeLesson("excellence",9,"Becoming a Role Model","A role model inspires others through discipline, kindness, and consistent actions.","Do one action today that inspires someone (help, study, respect).",[
    q("People learn from what you do.",["True","False"],0),
    q("Role models can help others succeed.",["True","False"],0),
    q("Being careless inspires others.",["True","False"],1)
  ]));

  for (const l of lessons) await upsertLesson(l);
  console.log(`✅ Seeded lessons: ${lessons.length}`);

  // exams (15 each)
  await upsertExam("foundation", 70, exam([
    q("Believing in yourself means you can improve.", ["True","False"], 0),
    q("Education can help your future.", ["True","False"], 0),
    q("Mistakes can help you learn.", ["True","False"], 0),
    q("Confidence should include respect.", ["True","False"], 0),
    q("Responsibility includes keeping promises.", ["True","False"], 0),
    q("Respect includes listening.", ["True","False"], 0),
    q("Studying regularly can help.", ["True","False"], 0),
    q("A quiet place improves focus.", ["True","False"], 0),
    q("Phones can distract studying.", ["True","False"], 0),
    q("Planning helps use time better.", ["True","False"], 0),
    q("Success needs action, not only dreams.", ["True","False"], 0),
    q("Being kind makes you weak.", ["True","False"], 1),
    q("Blaming others helps you grow.", ["True","False"], 1),
    q("No breaks is always best.", ["True","False"], 1),
    q("Wasting time helps success.", ["True","False"], 1)
  ]));
  await upsertExam("growth", 70, exam([
    q("Discipline means doing what is right even when hard.", ["True","False"], 0),
    q("Habits shape your life.", ["True","False"], 0),
    q("Consistency beats talent alone.", ["True","False"], 0),
    q("Planning your day can reduce stress.", ["True","False"], 0),
    q("Multitasking always improves learning.", ["True","False"], 1),
    q("Listening is part of communication.", ["True","False"], 0),
    q("Preparation helps confidence in speaking.", ["True","False"], 0),
    q("Failure can teach lessons.", ["True","False"], 0),
    q("Self-control helps success.", ["True","False"], 0),
    q("Reliable people keep promises.", ["True","False"], 0),
    q("Wasting time can hurt goals.", ["True","False"], 0),
    q("Short focused sessions can be useful.", ["True","False"], 0),
    q("Strong people always quit after failure.", ["True","False"], 1),
    q("Interrupting is respectful.", ["True","False"], 1),
    q("Arriving late builds trust.", ["True","False"], 1)
  ]));
  await upsertExam("excellence", 70, exam([
    q("Leadership is setting a good example.", ["True","False"], 0),
    q("Self-leadership means managing your actions.", ["True","False"], 0),
    q("Vision guides your decisions.", ["True","False"], 0),
    q("Long-term goals give purpose.", ["True","False"], 0),
    q("Career planning benefits from research.", ["True","False"], 0),
    q("Saving money can help your future.", ["True","False"], 0),
    q("Integrity includes honesty.", ["True","False"], 0),
    q("Serving your community can build meaning.", ["True","False"], 0),
    q("Successful people keep learning.", ["True","False"], 0),
    q("Role models inspire by example.", ["True","False"], 0),
    q("Leadership is only about power.", ["True","False"], 1),
    q("Future planning is useless.", ["True","False"], 1),
    q("Spending everything is the best plan.", ["True","False"], 1),
    q("Character does not matter.", ["True","False"], 1),
    q("Learning ends after school.", ["True","False"], 1)
  ]));
  console.log("✅ Seeded exams.");

  await ensureAdmin();
}

seed().catch((e) => {
  console.error("Seed error:", e);
  process.exit(1);
});
