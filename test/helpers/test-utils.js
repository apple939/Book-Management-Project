process.env.NODE_ENV = process.env.NODE_ENV || 'test';

const path = require('path');
const PROD_DB_PATH = path.resolve(__dirname, '..', '..', 'bookmanager.db');
if (!process.env.DB_PATH) {
  throw new Error('[TEST GUARD] DB_PATH 未设置，测试可能触碰生产 bookmanager.db，已终止');
}
if (path.resolve(process.env.DB_PATH) === PROD_DB_PATH) {
  throw new Error('[TEST GUARD] DB_PATH 指向生产 bookmanager.db，测试已终止');
}

const supertest = require('supertest');
const { db } = require('../../database');
const { hashPassword } = require('../../lib/password');

let ADMIN_HASH = null;

function resetDb() {
  db.exec(`
    DELETE FROM system_logs;
    DELETE FROM borrow_records;
    DELETE FROM books;
    DELETE FROM users WHERE username != 'admin';
  `);
  if (!ADMIN_HASH) ADMIN_HASH = hashPassword('admin123');
  db.prepare("UPDATE users SET password = ?, realname = '系统管理员', role = 'admin', status = 1, login_fails = 0, locked_until = NULL WHERE username = 'admin'").run(ADMIN_HASH);
}

function makeAgent(app) {
  return supertest.agent(app);
}

async function login(agent, username, password) {
  return agent
    .post('/auth/login')
    .set('X-Test-Captcha', 'test')
    .type('form')
    .send({ username, password, captcha: 'test' });
}

async function registerUser(agent, username, password) {
  return agent
    .post('/auth/register')
    .type('form')
    .send({ username, password, password2: password, realname: '', email: '' });
}

async function addBook(agent, overrides) {
  const book = Object.assign({
    isbn: '',
    title: '测试图书',
    author: '测试作者',
    publisher: '',
    publish_date: '',
    category_id: '',
    total_count: '1',
    description: ''
  }, overrides);
  return agent.post('/books/add').type('form').send(book);
}

function formatLocalDateTime(d) {
  const p = (n) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}:${p(d.getSeconds())}`;
}

module.exports = { db, resetDb, makeAgent, login, registerUser, addBook, formatLocalDateTime };
