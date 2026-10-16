-- Таблицы для отзывов и реакций. Выполнить один раз в консоли D1.

-- Реакции к абзацам.
-- Одна строка на читателя и абзац: смена эмодзи заменяет строку,
-- поэтому один человек не может накрутить счётчик.
CREATE TABLE IF NOT EXISTS reactions (
  chapter TEXT    NOT NULL,
  pid     TEXT    NOT NULL,
  voter   TEXT    NOT NULL,
  emoji   TEXT    NOT NULL,
  at      INTEGER NOT NULL,
  PRIMARY KEY (chapter, pid, voter)
);
CREATE INDEX IF NOT EXISTS reactions_chapter ON reactions (chapter);

-- Отзывы.
-- hidden = 1 прячет отзыв с сайта, не удаляя его.
CREATE TABLE IF NOT EXISTS reviews (
  id     TEXT    PRIMARY KEY,
  name   TEXT    NOT NULL,
  body   TEXT    NOT NULL,
  at     INTEGER NOT NULL,
  hidden INTEGER NOT NULL DEFAULT 0
);
CREATE INDEX IF NOT EXISTS reviews_at ON reviews (hidden, at DESC);

-- Ограничение частоты. Ключ — необратимый отпечаток адреса,
-- сам адрес нигде не хранится. Старые строки чистятся сами.
CREATE TABLE IF NOT EXISTS rate (
  k  TEXT    PRIMARY KEY,
  at INTEGER NOT NULL,
  n  INTEGER NOT NULL
);
