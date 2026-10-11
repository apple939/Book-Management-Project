const express = require('express');
const session = require('express-session');
const path = require('path');
const crypto = require('crypto');
const { initDatabase } = require('./database');

const authRoutes = require('./routes/auth');
const bookRoutes = require('./routes/books');
const borrowRoutes = require('./routes/borrow');
const userRoutes = require('./routes/user');

const app = express();
const PORT = 3000;

initDatabase();

app.set('view engine', 'ejs');
app.set('views', path.join(__dirname, 'views'));

app.use(express.urlencoded({ extended: true }));
app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

const SESSION_SECRET = process.env.SESSION_SECRET || crypto.randomBytes(32).toString('hex');

app.use(session({
  secret: SESSION_SECRET,
  resave: false,
  saveUninitialized: false,
  cookie: { maxAge: 24 * 60 * 60 * 1000 }
}));

app.use((req, res, next) => {
  res.locals.user = req.session.user || null;
  res.locals.path = req.path;
  next();
});

if (process.env.NODE_ENV === 'test') {
  app.use((req, res, next) => {
    if (req.headers['x-test-captcha']) {
      req.session.captcha = String(req.headers['x-test-captcha']);
    }
    next();
  });
}

app.get('/', (req, res) => {
  const { db } = require('./database');
  const books = db.prepare(`
    SELECT b.*, c.name as category_name FROM books b
    LEFT JOIN categories c ON b.category_id = c.id
    WHERE b.status = 1 ORDER BY b.created_at DESC LIMIT 12
  `).all();
  res.render('layout', { page: 'index', books, title: '图书管理系统' });
});

app.use('/auth', authRoutes);
app.use('/books', bookRoutes);
app.use('/borrow', borrowRoutes);
app.use('/user', userRoutes);

app.get('/logout', (req, res) => {
  req.session.destroy(() => {
    res.redirect('/');
  });
});

if (require.main === module) {
  app.listen(PORT, () => {
    console.log(`图书管理系统已启动: http://localhost:${PORT}`);
  });
}

module.exports = app;
