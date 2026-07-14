require('dotenv').config();

const path = require('path');
const express = require('express');
const session = require('express-session');
const SqliteStore = require('better-sqlite3-session-store')(session);

const { db } = require('./src/db');
const { loadContext } = require('./src/middleware');

const app = express();
const PORT = process.env.PORT || 3000;

app.set('view engine', 'ejs');
app.set('views', path.join(__dirname, 'views'));
app.set('trust proxy', 1); // Render terminates TLS in front of us

app.use(express.static(path.join(__dirname, 'public')));
app.use(express.urlencoded({ extended: false }));

app.use(
  session({
    store: new SqliteStore({ client: db, expired: { clear: true, intervalMs: 900000 } }),
    secret: process.env.SESSION_SECRET || 'dev-secret-change-me',
    resave: false,
    saveUninitialized: false,
    cookie: {
      httpOnly: true,
      sameSite: 'lax',
      secure: process.env.NODE_ENV === 'production',
      maxAge: 1000 * 60 * 60 * 24 * 14,
    },
  })
);

app.use(loadContext);

app.use(require('./src/routes/public'));
app.use(require('./src/routes/submissions'));
app.use(require('./src/routes/comments'));
app.use(require('./src/routes/auth'));
app.use(require('./src/routes/invite'));
app.use(require('./src/routes/account'));
app.use('/admin', require('./src/routes/admin'));

app.use((req, res) => {
  res.status(404).render('error', {
    title: 'Not here',
    message: 'That address does not exist.',
  });
});

app.use((err, req, res, next) => {
  console.error(err);
  res.status(500).render('error', {
    title: 'Something broke',
    message: 'The server hit an error. Try again.',
  });
});

app.listen(PORT, () => console.log(`Repartie running on http://localhost:${PORT}`));
