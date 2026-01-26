// backend/migrate_pg.js
require("dotenv").config();
console.log("USING DATABASE_URL =", process.env.DATABASE_URL);

const { query } = require("./db_pg");

async function migrate() {
  // ---------- USERS ----------
  await query(`
    CREATE TABLE IF NOT EXISTS users (
      id SERIAL PRIMARY KEY,
      name TEXT NOT NULL,
      email TEXT NOT NULL UNIQUE,
      password_hash TEXT NOT NULL,
      role TEXT NOT NULL DEFAULT 'student',
      created_at TIMESTAMP NOT NULL DEFAULT NOW()
    );
  `);

  // ---------- COURSES ----------
  await query(`
    CREATE TABLE IF NOT EXISTS courses (
      id TEXT PRIMARY KEY,
      title_en TEXT NOT NULL,
      title_ti TEXT NOT NULL,
      intro_en TEXT NOT NULL,
      intro_ti TEXT NOT NULL
    );
  `);

  // ---------- LESSONS (FINAL: quiz JSONB) ----------
  // Create table with the correct schema (quiz JSONB)
  await query(`
    CREATE TABLE IF NOT EXISTS lessons (
      id SERIAL PRIMARY KEY,
      course_id TEXT NOT NULL REFERENCES courses(id) ON DELETE CASCADE,
      lesson_index INT NOT NULL,
      title_en TEXT NOT NULL,
      title_ti TEXT NOT NULL,
      learn_en TEXT NOT NULL,
      learn_ti TEXT NOT NULL,
      task_en TEXT NOT NULL,
      task_ti TEXT NOT NULL,
      quiz JSONB NOT NULL DEFAULT '{"questions":[]}'::jsonb,
      UNIQUE(course_id, lesson_index)
    );
  `);

  // If an old DB has quiz_json, migrate it -> quiz, then drop quiz_json
  await query(`
    ALTER TABLE lessons
    ADD COLUMN IF NOT EXISTS quiz JSONB DEFAULT '{"questions":[]}'::jsonb;
  `);

  // Move data if quiz_json exists (and quiz is null or default)
  await query(`
    DO $$
    BEGIN
      IF EXISTS (
        SELECT 1
        FROM information_schema.columns
        WHERE table_name='lessons' AND column_name='quiz_json'
      ) THEN
        -- Try to migrate quiz_json text into quiz jsonb
        -- Only update rows where quiz is null or empty default
        UPDATE lessons
        SET quiz = COALESCE(NULLIF(quiz_json, '')::jsonb, '{"questions":[]}'::jsonb)
        WHERE quiz IS NULL OR quiz = '{"questions":[]}'::jsonb;

        -- Drop the old column
        ALTER TABLE lessons DROP COLUMN IF EXISTS quiz_json;
      END IF;
    EXCEPTION
      WHEN others THEN
        -- If some rows have invalid JSON text, do NOT crash migration.
        -- They will keep default quiz and you can fix those rows later.
        RAISE NOTICE 'Skipping quiz_json migration due to invalid JSON in some rows.';
    END $$;
  `);

  // Ensure quiz is NOT NULL with default
  await query(`
    ALTER TABLE lessons
    ALTER COLUMN quiz SET DEFAULT '{"questions":[]}'::jsonb;
  `);
  await query(`
    UPDATE lessons
    SET quiz = '{"questions":[]}'::jsonb
    WHERE quiz IS NULL;
  `);
  await query(`
    ALTER TABLE lessons
    ALTER COLUMN quiz SET NOT NULL;
  `);

  // ---------- PROGRESS ----------
  await query(`
    CREATE TABLE IF NOT EXISTS progress (
      user_id INT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      course_id TEXT NOT NULL REFERENCES courses(id) ON DELETE CASCADE,
      lesson_index INT NOT NULL,
      completed BOOLEAN NOT NULL DEFAULT FALSE,
      quiz_score INT,
      reflection TEXT,
      reflection_updated_at TIMESTAMP,
      updated_at TIMESTAMP NOT NULL DEFAULT NOW(),
      PRIMARY KEY(user_id, course_id, lesson_index)
    );
  `);

  // ---------- CERTIFICATES ----------
  await query(`
    CREATE TABLE IF NOT EXISTS certificates (
      id SERIAL PRIMARY KEY,
      user_id INT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      course_id TEXT NOT NULL REFERENCES courses(id) ON DELETE CASCADE,
      issued_at TIMESTAMP NOT NULL DEFAULT NOW(),
      UNIQUE(user_id, course_id)
    );
  `);

  // ---------- EXAMS ----------
  // (Keeping as TEXT is OK if your code JSON.parse() it.
  //  If you want, we can upgrade these to JSONB later.)
  await query(`
    CREATE TABLE IF NOT EXISTS exam_defs (
      course_id TEXT PRIMARY KEY REFERENCES courses(id) ON DELETE CASCADE,
      pass_score INT NOT NULL DEFAULT 70,
      exam_json_en TEXT NOT NULL,
      exam_json_ti TEXT NOT NULL
    );
  `);

  await query(`
    CREATE TABLE IF NOT EXISTS exam_attempts (
      user_id INT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      course_id TEXT NOT NULL REFERENCES courses(id) ON DELETE CASCADE,
      score INT NOT NULL,
      passed BOOLEAN NOT NULL DEFAULT FALSE,
      updated_at TIMESTAMP NOT NULL DEFAULT NOW(),
      PRIMARY KEY(user_id, course_id)
    );
  `);

  // ---------- SESSIONS (connect-pg-simple) ----------
  await query(`
    CREATE TABLE IF NOT EXISTS "session" (
      "sid" varchar NOT NULL COLLATE "default",
      "sess" json NOT NULL,
      "expire" timestamp(6) NOT NULL
    )
    WITH (OIDS=FALSE);
  `);

  // Add PK only if missing (avoid crash on re-run)
  await query(`
    DO $$
    BEGIN
      IF NOT EXISTS (
        SELECT 1
        FROM pg_constraint
        WHERE conname = 'session_pkey'
      ) THEN
        ALTER TABLE "session" ADD CONSTRAINT "session_pkey" PRIMARY KEY ("sid");
      END IF;
    END $$;
  `);

  await query(`CREATE INDEX IF NOT EXISTS "IDX_session_expire" ON "session" ("expire");`);

  console.log("✅ Migration complete.");
}

migrate().catch((e) => {
  console.error("Migration error FULL:", e);
  process.exit(1);
});