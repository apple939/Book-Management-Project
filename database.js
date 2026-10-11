const Database = require('better-sqlite3');
const path = require('path');

const db = new Database(process.env.DB_PATH || path.join(__dirname, 'bookmanager.db'));

db.pragma('journal_mode = WAL');
db.pragma('foreign_keys = ON');

function initDatabase() {
  db.exec(`
    CREATE TABLE IF NOT EXISTS users (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      username TEXT UNIQUE NOT NULL,
      password TEXT NOT NULL,
      realname TEXT DEFAULT '',
      email TEXT DEFAULT '',
      phone TEXT DEFAULT '',
      role TEXT DEFAULT 'user',
      status INTEGER DEFAULT 1,
      login_fails INTEGER DEFAULT 0,
      locked_until TEXT DEFAULT NULL,
      created_at TEXT DEFAULT (datetime('now','localtime'))
    );

    CREATE TABLE IF NOT EXISTS categories (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT UNIQUE NOT NULL,
      created_at TEXT DEFAULT (datetime('now','localtime'))
    );

    CREATE TABLE IF NOT EXISTS books (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      isbn TEXT DEFAULT '',
      title TEXT NOT NULL,
      author TEXT NOT NULL,
      publisher TEXT DEFAULT '',
      publish_date TEXT DEFAULT '',
      category_id INTEGER DEFAULT NULL,
      total_count INTEGER DEFAULT 1,
      remain_count INTEGER DEFAULT 1,
      description TEXT DEFAULT '',
      status INTEGER DEFAULT 1,
      created_at TEXT DEFAULT (datetime('now','localtime')),
      FOREIGN KEY (category_id) REFERENCES categories(id)
    );

    CREATE TABLE IF NOT EXISTS borrow_records (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id INTEGER NOT NULL,
      book_id INTEGER NOT NULL,
      borrow_date TEXT DEFAULT (datetime('now','localtime')),
      due_date TEXT NOT NULL,
      return_date TEXT DEFAULT NULL,
      status TEXT DEFAULT 'borrowed',
      FOREIGN KEY (user_id) REFERENCES users(id),
      FOREIGN KEY (book_id) REFERENCES books(id)
    );

    CREATE TABLE IF NOT EXISTS system_logs (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id INTEGER,
      action TEXT NOT NULL,
      detail TEXT DEFAULT '',
      created_at TEXT DEFAULT (datetime('now','localtime'))
    );
  `);

  const adminExists = db.prepare('SELECT id FROM users WHERE username = ?').get('admin');
  if (!adminExists) {
    db.prepare('INSERT INTO users (username, password, realname, role) VALUES (?, ?, ?, ?)').run(
      'admin', 'admin123', '系统管理员', 'admin'
    );
  }

  const cats = db.prepare('SELECT COUNT(*) as cnt FROM categories').get();
  if (cats.cnt === 0) {
    const insertCat = db.prepare('INSERT INTO categories (name) VALUES (?)');
    ['计算机科学', '文学小说', '历史哲学', '自然科学', '经济管理', '教育考试', '艺术设计', '其他'].forEach(c => {
      insertCat.run(c);
    });
  }

  console.log('[数据库] 初始化完成');
}

function addLog(userId, action, detail) {
  db.prepare('INSERT INTO system_logs (user_id, action, detail) VALUES (?, ?, ?)').run(userId || null, action, detail || '');
}

module.exports = { db, initDatabase, addLog };
