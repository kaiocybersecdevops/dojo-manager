import { DatabaseSync } from 'node:sqlite';
import { randomBytes } from 'node:crypto';
import { hashPassword } from './auth.js';

export const BELTS = ['white', 'blue', 'purple', 'brown', 'black'];

export function openDb(file = process.env.DB_FILE || ':memory:') {
  const db = new DatabaseSync(file);
  db.exec(`
    PRAGMA foreign_keys = ON;
    CREATE TABLE IF NOT EXISTS students (
      id INTEGER PRIMARY KEY,
      name TEXT NOT NULL,
      belt TEXT NOT NULL DEFAULT 'white',
      stripes INTEGER NOT NULL DEFAULT 0 CHECK (stripes BETWEEN 0 AND 4),
      checkin_code TEXT NOT NULL UNIQUE,
      active INTEGER NOT NULL DEFAULT 1,
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    );
    CREATE TABLE IF NOT EXISTS users (
      id INTEGER PRIMARY KEY,
      name TEXT NOT NULL,
      email TEXT NOT NULL UNIQUE,
      password_hash TEXT NOT NULL,
      role TEXT NOT NULL CHECK (role IN ('admin', 'instructor', 'student')),
      student_id INTEGER REFERENCES students(id)
    );
    CREATE TABLE IF NOT EXISTS checkins (
      id INTEGER PRIMARY KEY,
      student_id INTEGER NOT NULL REFERENCES students(id),
      method TEXT NOT NULL CHECK (method IN ('code', 'staff')),
      created_by INTEGER NOT NULL REFERENCES users(id),
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    );
    CREATE TABLE IF NOT EXISTS audit_log (
      id INTEGER PRIMARY KEY,
      user_id INTEGER REFERENCES users(id),
      action TEXT NOT NULL,
      entity TEXT,
      entity_id INTEGER,
      details TEXT,
      ip TEXT,
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    );
  `);
  return db;
}

export const newCheckinCode = () => randomBytes(3).toString('hex').toUpperCase();

export function seed(db) {
  const count = db.prepare('SELECT COUNT(*) AS n FROM users').get().n;
  if (count > 0) return;
  const addStudent = db.prepare('INSERT INTO students (name, belt, stripes, checkin_code) VALUES (?, ?, ?, ?)');
  const ana = addStudent.run('Ana Souza', 'blue', 2, 'A1B2C3').lastInsertRowid;
  addStudent.run('Lucas Lima', 'white', 3, 'D4E5F6');
  addStudent.run('Marina Costa', 'purple', 1, '7A8B9C');
  const addUser = db.prepare('INSERT INTO users (name, email, password_hash, role, student_id) VALUES (?, ?, ?, ?, ?)');
  addUser.run('Demo Admin', 'admin@dojo.dev', hashPassword('demo1234'), 'admin', null);
  addUser.run('Demo Instructor', 'coach@dojo.dev', hashPassword('demo1234'), 'instructor', null);
  addUser.run('Ana Souza', 'ana@dojo.dev', hashPassword('demo1234'), 'student', ana);
}

export function audit(db, { userId = null, action, entity = null, entityId = null, details = null, ip = null }) {
  db.prepare('INSERT INTO audit_log (user_id, action, entity, entity_id, details, ip) VALUES (?, ?, ?, ?, ?, ?)')
    .run(userId, action, entity, entityId, details ? JSON.stringify(details) : null, ip);
}
