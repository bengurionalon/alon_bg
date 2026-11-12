/**
 * Отзывы и реакции для сайта А.Л.О.Н.
 *
 * Пути:
 *   GET  /reactions?chapter=3   → { "<абзац>": { "🔥": 2, "😨": 1 } }
 *   POST /react                 { chapter, pid, voter, emoji }  emoji:"" снимает
 *   GET  /reviews               → [ { id, name, body, at } ]
 *   POST /reviews               { name, body, voter, website }
 *   GET  /notes?chapter=b2-1    → { "<абзац>": [ { id, parent, name, body, at, author } ] }
 *   POST /note                  { chapter, pid, parent, name, body, voter, website }
 *   POST /note/drop             { id, voter }            свою заметку можно убрать
 *   GET  /notes/new?key=…       последние заметки со всего сайта — для автора
 *   POST /note/hide             { id, key }              убрать чужую — только автору
 *
 * Привязка D1 называется DB. Секрет SALT — любая длинная случайная строка,
 * нужен, чтобы отпечатки адресов нельзя было подобрать обратно.
 */

const ALLOWED = [
  "https://alon-bg.pages.dev",
  "https://bengurionalon.github.io",
  "http://localhost:8000",
  "http://localhost:8791",
];

const EMOJI = ["😮", "😨", "💔", "🔥", "😢", "🤔", "😍", "😡"];
const REVIEW_MIN = 100;
const REVIEW_MAX = 2000;
const NAME_MAX = 40;

/* Заметка на полях — короткая реплика, не отзыв: сто знаков и ни одним больше. */
const NOTE_MAX = 100;
const NOTE_NAME_MAX = 24;

export default {
  async fetch(request, env) {
    const origin = request.headers.get("Origin") || "";
    const cors = {
      "Access-Control-Allow-Origin": ALLOWED.includes(origin) ? origin : ALLOWED[0],
      "Access-Control-Allow-Methods": "GET,POST,OPTIONS",
      "Access-Control-Allow-Headers": "Content-Type",
      "Access-Control-Max-Age": "86400",
      Vary: "Origin",
    };
    if (request.method === "OPTIONS") return new Response(null, { status: 204, headers: cors });

    const json = (data, status = 200, extra = {}) =>
      new Response(JSON.stringify(data), {
        status,
        headers: { "Content-Type": "application/json; charset=utf-8", ...cors, ...extra },
      });

    const url = new URL(request.url);
    const path = url.pathname.replace(/\/+$/, "") || "/";

    try {
      if (request.method === "GET" && path === "/reactions") return await getReactions(env, url, json);
      if (request.method === "POST" && path === "/react") return await postReact(env, request, json);
      if (request.method === "GET" && path === "/reviews") return await getReviews(env, json);
      if (request.method === "POST" && path === "/reviews") return await postReview(env, request, json);
      if (request.method === "GET" && path === "/notes") return await getNotes(env, url, json);
      if (request.method === "GET" && path === "/notes/new") return await getFresh(env, url, json);
      if (request.method === "POST" && path === "/note") return await postNote(env, request, json);
      if (request.method === "POST" && path === "/note/drop") return await dropNote(env, request, json);
      if (request.method === "POST" && path === "/note/hide") return await hideNote(env, request, json);
      return json({ error: "not found" }, 404);
    } catch (err) {
      return json({ error: "server", detail: String(err && err.message || err) }, 500);
    }
  },
};

/* ---------- чтение ---------- */

async function getReactions(env, url, json) {
  const chapter = (url.searchParams.get("chapter") || "").slice(0, 8);
  if (!chapter) return json({});
  const { results } = await env.DB
    .prepare("SELECT pid, emoji, COUNT(*) AS n FROM reactions WHERE chapter = ? GROUP BY pid, emoji")
    .bind(chapter)
    .all();
  const out = {};
  for (const r of results || []) {
    (out[r.pid] = out[r.pid] || {})[r.emoji] = r.n;
  }
  return json(out, 200, { "Cache-Control": "no-store" });
}

async function getReviews(env, json) {
  const { results } = await env.DB
    .prepare("SELECT id, name, body, at FROM reviews WHERE hidden = 0 ORDER BY at DESC LIMIT 300")
    .all();
  return json(results || [], 200, { "Cache-Control": "no-store" });
}

/* ---------- запись ---------- */

async function postReact(env, request, json) {
  const b = await body(request);
  const chapter = str(b.chapter, 8);
  const pid = str(b.pid, 32);
  const voter = str(b.voter, 64);
  const emoji = str(b.emoji, 8);
  if (!chapter || !pid || !voter) return json({ error: "bad request" }, 400);
  if (emoji && !EMOJI.includes(emoji)) return json({ error: "unknown emoji" }, 400);

  if (!(await allow(env, request, "react", 60, 60))) return json({ error: "too many" }, 429);

  if (emoji) {
    await env.DB
      .prepare(
        "INSERT INTO reactions (chapter, pid, voter, emoji, at) VALUES (?, ?, ?, ?, ?) " +
        "ON CONFLICT (chapter, pid, voter) DO UPDATE SET emoji = excluded.emoji, at = excluded.at"
      )
      .bind(chapter, pid, voter, emoji, Date.now())
      .run();
  } else {
    await env.DB
      .prepare("DELETE FROM reactions WHERE chapter = ? AND pid = ? AND voter = ?")
      .bind(chapter, pid, voter)
      .run();
  }
  const url = new URL(request.url);
  url.searchParams.set("chapter", chapter);
  return await getReactions(env, url, json);
}

async function postReview(env, request, json) {
  const b = await body(request);
  if (str(b.website, 80)) return json({ ok: true });          // ловушка для ботов

  const name = clean(str(b.name, NAME_MAX));
  const text = str(b.body, REVIEW_MAX).trim();
  const flat = clean(text);

  if (name.length < 2) return json({ error: "name" }, 400);
  if (flat.length < REVIEW_MIN) return json({ error: "short", need: REVIEW_MIN }, 400);
  if (/https?:\/\/|www\.|\[url|<a\s/i.test(text)) return json({ error: "links" }, 400);

  if (!(await allow(env, request, "review", 2, 600))) return json({ error: "too many" }, 429);

  const id = crypto.randomUUID();
  await env.DB
    .prepare("INSERT INTO reviews (id, name, body, at, hidden) VALUES (?, ?, ?, ?, 0)")
    .bind(id, name, text, Date.now())
    .run();
  return json({ ok: true, id });
}

/* ---------- заметки на полях ---------- */

/** Все заметки главы, разложенные по абзацам: корневые по времени, ответы следом. */
async function getNotes(env, url, json) {
  const chapter = (url.searchParams.get("chapter") || "").slice(0, 8);
  if (!chapter) return json({});
  const { results } = await env.DB
    .prepare(
      "SELECT id, pid, parent, name, body, author, at FROM notes " +
      "WHERE chapter = ? AND hidden = 0 ORDER BY at ASC LIMIT 2000"
    )
    .bind(chapter)
    .all();
  const out = {};
  for (const r of results || []) (out[r.pid] = out[r.pid] || []).push(r);
  return json(out, 200, { "Cache-Control": "no-store" });
}

/** Свежие заметки со всего сайта — страница, с которой автор их разбирает. */
async function getFresh(env, url, json) {
  if (!admin(env, url.searchParams.get("key"))) return json({ error: "key" }, 403);
  const { results } = await env.DB
    .prepare(
      "SELECT id, chapter, pid, parent, name, body, author, at, hidden FROM notes " +
      "ORDER BY at DESC LIMIT 400"
    )
    .all();
  return json(results || [], 200, { "Cache-Control": "no-store" });
}

async function postNote(env, request, json) {
  const b = await body(request);
  if (str(b.website, 80)) return json({ ok: true });          // ловушка для ботов

  const chapter = str(b.chapter, 8);
  const pid = str(b.pid, 32);
  const parent = str(b.parent, 64);
  const voter = str(b.voter, 64);
  const name = clean(str(b.name, NOTE_NAME_MAX));
  const text = clean(str(b.body, NOTE_MAX + 40));

  if (!chapter || !pid || !voter) return json({ error: "bad request" }, 400);
  if (name.length < 2) return json({ error: "name" }, 400);
  if (!text) return json({ error: "empty" }, 400);
  if ([...text].length > NOTE_MAX) return json({ error: "long", max: NOTE_MAX }, 400);
  if (/https?:\/\/|www\.|\[url|<a\s/i.test(text)) return json({ error: "links" }, 400);

  /* ответ цепляется только к существующей заметке того же абзаца,
     и только на один уровень: разговор под абзацем, а не дерево */
  if (parent) {
    const up = await env.DB
      .prepare("SELECT parent FROM notes WHERE id = ? AND chapter = ? AND pid = ?")
      .bind(parent, chapter, pid)
      .first();
    if (!up) return json({ error: "parent" }, 400);
    if (up.parent) return json({ error: "depth" }, 400);
  }

  const key = str(b.key, 64);
  const mine = admin(env, key) ? 1 : 0;
  if (!mine && !(await allow(env, request, "note", 12, 600))) return json({ error: "too many" }, 429);

  const id = crypto.randomUUID();
  await env.DB
    .prepare(
      "INSERT INTO notes (id, chapter, pid, parent, name, body, voter, author, at, hidden) " +
      "VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 0)"
    )
    .bind(id, chapter, pid, parent, name, text, voter, mine, Date.now())
    .run();

  const url = new URL(request.url);
  url.searchParams.set("chapter", chapter);
  return await getNotes(env, url, json);
}

/** Свою заметку читатель убирает сам: сверяем знак браузера, записи не остаётся. */
async function dropNote(env, request, json) {
  const b = await body(request);
  const id = str(b.id, 64), voter = str(b.voter, 64);
  if (!id || !voter) return json({ error: "bad request" }, 400);
  const row = await env.DB.prepare("SELECT chapter FROM notes WHERE id = ? AND voter = ?")
    .bind(id, voter).first();
  if (!row) return json({ error: "not yours" }, 403);
  await env.DB.prepare("DELETE FROM notes WHERE id = ? OR parent = ?").bind(id, id).run();
  const url = new URL(request.url);
  url.searchParams.set("chapter", row.chapter);
  return await getNotes(env, url, json);
}

/** Автор убирает чужое: заметка остаётся в базе, но со страницы уходит. */
async function hideNote(env, request, json) {
  const b = await body(request);
  if (!admin(env, str(b.key, 64))) return json({ error: "key" }, 403);
  const id = str(b.id, 64);
  if (!id) return json({ error: "bad request" }, 400);
  const back = b.show ? 0 : 1;
  await env.DB.prepare("UPDATE notes SET hidden = ? WHERE id = ? OR parent = ?")
    .bind(back, id, id).run();
  return json({ ok: true, hidden: back });
}

/** Ключ автора задаётся секретом ADMIN. Сравнение без ветвления по длине. */
function admin(env, key) {
  const want = env.ADMIN || "";
  if (!want || !key || key.length !== want.length) return false;
  let diff = 0;
  for (let i = 0; i < want.length; i++) diff |= want.charCodeAt(i) ^ key.charCodeAt(i);
  return diff === 0;
}

/* ---------- вспомогательное ---------- */

async function body(request) {
  try { return await request.json(); } catch (e) { return {}; }
}
function str(v, max) {
  return typeof v === "string" ? v.slice(0, max) : "";
}
function clean(s) {
  return String(s).replace(/\s+/g, " ").trim();
}

/** Сколько раз с одного адреса за окно. Сам адрес не сохраняется — только отпечаток. */
async function allow(env, request, kind, limit, windowSec) {
  const ip = request.headers.get("CF-Connecting-IP") || "";
  const data = new TextEncoder().encode(kind + "|" + ip + "|" + (env.SALT || "соль"));
  const digest = await crypto.subtle.digest("SHA-256", data);
  const key = [...new Uint8Array(digest)].slice(0, 12)
    .map((x) => x.toString(16).padStart(2, "0")).join("");

  const now = Math.floor(Date.now() / 1000);
  const row = await env.DB.prepare("SELECT at, n FROM rate WHERE k = ?").bind(key).first();

  if (!row || now - row.at > windowSec) {
    await env.DB
      .prepare("INSERT INTO rate (k, at, n) VALUES (?, ?, 1) " +
               "ON CONFLICT (k) DO UPDATE SET at = excluded.at, n = 1")
      .bind(key, now)
      .run();
    if (Math.random() < 0.02) {
      await env.DB.prepare("DELETE FROM rate WHERE at < ?").bind(now - 86400).run();
    }
    return true;
  }
  if (row.n >= limit) return false;
  await env.DB.prepare("UPDATE rate SET n = n + 1 WHERE k = ?").bind(key).run();
  return true;
}
