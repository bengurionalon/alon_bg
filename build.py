#!/usr/bin/env python3
"""Собирает сайт из books/*.json и src/.

Каждая глава становится обычной страницей с текстом прямо в HTML: её видят
поисковики, и читателю не приходится скачивать весь роман целиком.

    python3 build.py

Готовые файлы кладутся в корень репозитория и коммитятся вместе с исходниками.
"""

import hashlib
import html
import json
import os
import re
import shutil
from datetime import date

ROOT = os.path.dirname(os.path.abspath(__file__))
SITE = "https://bengurionalon.github.io/alon_bg"   # адрес сайта; поменять при переезде на свой домен

# Адрес Worker'а, который хранит отзывы и реакции.
# Пустая строка = демонстрация: записи живут только в браузере читателя.
API = "https://alon-api.bengurionalon.workers.dev"
BOOK = os.path.join(ROOT, "books", "v-soznanie.json")

AUTHOR = "А.Л.О.Н."
COVER = "img/cover-v-soznanie.jpg"
LINKS = [
    ("Telegram", "https://t.me/ALON_BG"),
    ("Author.Today", "https://author.today/u/alonbengur"),
    ("Литрес", "https://www.litres.ru/author/a-l-o-n-32314078/"),
    ("Instagram", "https://www.instagram.com/al0n_bg?exln=MXZjdmlia3R0NGh6NQ=="),
]
AUTHOR_TEXT = [
    "Меня зовут А.Л.О.Н. Мои герои – люди, оказавшиеся на границе между человеком и чем-то иным. Я исследую, как любовь, страх и предательство меняют сознание, когда привычный мир даёт трещину.",
    "У меня нет премий и громких званий, есть только тексты, которые вы либо полюбите, либо возненавидите. Но если вы дочитаете до конца, вы поймёте, почему я пишу именно так. Я пишу тёмную фантастику, в которой нет места розовым соплям и хеппи-эндам.",
    "Мои книги для тех, кто устал от «и жили они долго и счастливо». Кто хочет чувствовать, как холодок пробегает по спине, и одновременно думать.",
    "Я не обещаю комфортного чтения. Я обещаю лишь, что вы не останетесь прежним.",
    "Если вам нравится, когда автор не боится сломать персонажа и оставить его лежать в грязи, то мы с вами на одной волне.",
    "«В сознание...» – моя первая книга. И она не про космос. Она про нас. Это как раз тот мир, где каждый выбор ведёт к новой пропасти. И да, я знаю, что вы будете её перечитывать.",
]
LEDE = ("Консул Виктор Малышев летит с рутинной инспекцией в дальнюю колонию. "
        "Он просыпается один, на неисправном корабле, и бортовой журнал показывает дату, "
        "которой не может быть.")

PAGES = []          # (путь без ведущего слэша, приоритет) — для sitemap.xml
STAMP = {}          # отпечатки стилей и скрипта, чтобы браузер не держал старые


def e(s):
    return html.escape(s, quote=True)


def strip_tags(s):
    return re.sub(r"\s+", " ", re.sub(r"<[^>]+>", " ", s)).strip()


def minutes(chars):
    return max(1, round(chars / 1400))


def tag_paragraphs(src):
    """Помечает каждый абзац отпечатком его текста.

    Комментарий читателя привязан к этому отпечатку, а не к порядковому номеру,
    поэтому правка в одном абзаце не отрывает комментарии от всех следующих.
    """
    def repl(m):
        attrs, inner = m.group(1), m.group(2)
        text = strip_tags(inner)
        if len(text) < 2:
            return m.group(0)
        pid = hashlib.sha1(text.encode("utf-8")).hexdigest()[:10]
        return f"<p{attrs} data-p=\"{pid}\">{inner}</p>"
    return re.sub(r"<p([^>]*)>(.*?)</p>", repl, src, flags=re.S)


def head(title, desc, rel, url, extra="", theme_light="#F3EFF8"):
    """Общая шапка документа. rel — путь к корню сайта с текущей страницы."""
    return f"""<!doctype html>
<html lang="ru">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>{e(title)}</title>
<meta name="description" content="{e(desc)}">
<link rel="canonical" href="{e(url)}">
<meta property="og:type" content="book">
<meta property="og:site_name" content="А.Л.О.Н.">
<meta property="og:locale" content="ru_RU">
<meta property="og:title" content="{e(title)}">
<meta property="og:description" content="{e(desc)}">
<meta property="og:url" content="{e(url)}">
<meta property="og:image" content="{SITE}/{COVER}">
<meta property="og:image:width" content="1000">
<meta property="og:image:height" content="1600">
<meta name="twitter:card" content="summary_large_image">
<meta name="twitter:title" content="{e(title)}">
<meta name="twitter:description" content="{e(desc)}">
<meta name="twitter:image" content="{SITE}/{COVER}">
<meta name="theme-color" content="{theme_light}" media="(prefers-color-scheme: light)">
<meta name="theme-color" content="#130F1D" media="(prefers-color-scheme: dark)">
<link rel="icon" href="{rel}img/favicon.svg" type="image/svg+xml">
<link rel="apple-touch-icon" href="{rel}img/apple-touch-icon.png">
<link rel="stylesheet" href="{rel}assets/fonts.css">
<link rel="stylesheet" href="{rel}assets/site.css?v={STAMP.get('css','')}">
{extra}</head>
<body>
<a class="skip" href="#main">К содержимому</a>
"""


def header(rel, current=""):
    def mark(name):
        return ' aria-current="page"' if current == name else ""
    return f"""<header class="site">
  <div class="wrap">
    <a class="mark" href="{rel or './'}">А.Л.О.Н.</a>
    <nav aria-label="Основное меню">
      <a href="{rel}kniga/"{mark('kniga')}>Книга</a>
      <a href="{rel}otzyvy/"{mark('otzyvy')}>Отзывы</a>
      <a href="{rel}#avtor"{mark('avtor')}>Автор</a>
    </nav>
  </div>
</header>
"""


def footer(rel):
    links = "\n      ".join(
        f'<a href="{e(u)}" target="_blank" rel="noopener">{e(n)}</a>' for n, u in LINKS
    )
    return f"""<footer class="foot">
  <div class="wrap">
    <span>© {AUTHOR}, 2022</span>
    <span class="foot-links">
      {links}
    </span>
  </div>
</footer>
<script src="{rel}assets/site.js?v={STAMP.get('js','')}" defer></script>
</body>
</html>
"""


def write(path, text):
    full = os.path.join(ROOT, path)
    os.makedirs(os.path.dirname(full), exist_ok=True)
    with open(full, "w", encoding="utf-8") as f:
        f.write(text)


def ld(obj):
    return ('<script type="application/ld+json">'
            + json.dumps(obj, ensure_ascii=False, separators=(",", ":"))
            + "</script>\n")


# ---------------------------------------------------------------- страницы

def page_home(b):
    total = sum(c["chars"] for c in b["chapters"])
    schema = ld({
        "@context": "https://schema.org",
        "@type": "Person",
        "name": AUTHOR,
        "url": SITE + "/",
        "jobTitle": "Писатель",
        "sameAs": [u for _, u in LINKS],
    })
    links = "\n          ".join(
        f'<li><a href="{e(u)}" target="_blank" rel="noopener">{e(n)}</a></li>' for n, u in LINKS
    )
    author = "\n          ".join(f"<p>{p}</p>" for p in AUTHOR_TEXT)
    out = head(f"{b['title']} — {AUTHOR}", LEDE, "", SITE + "/", schema)
    out += '<canvas id="field" aria-hidden="true"></canvas>\n'
    out += f"""<div id="gate" role="dialog" aria-label="Вход на сайт">
  <div class="gate-stage">
    <button class="gate-book" type="button" style="--thick:34px" aria-label="Открыть книгу и войти на сайт">
      <span class="gate-face gate-spine" aria-hidden="true"><span>{AUTHOR} · {e(b['title'])}</span></span>
      <span class="gate-face gate-edge" aria-hidden="true"></span>
      <span class="gate-face gate-topface" aria-hidden="true"></span>
      <span class="gate-face gate-cover">
        <img src="{COVER}" alt="" width="1000" height="1600">
        <span class="gate-gloss" aria-hidden="true"></span>
      </span>
      <span class="gate-shade" aria-hidden="true"></span>
    </button>
  </div>
  <div class="gate-words">
    <p>Нажмите на книгу, чтобы войти</p>
  </div>
  <button class="gate-skip" type="button" id="gateSkip">Пропустить</button>
</div>
"""
    out += header("", "")
    out += f"""<main id="main">
  <div class="hero">
    <div class="wrap">
      <div class="hero-text">
        <p class="eyebrow">Отправление 05:04:2360 → пробуждение 08:12:2557</p>
        <h1>{e(b['title'])}</h1>
        <p class="byline">{AUTHOR} · роман · {b['year']}</p>
        <p class="lede">{LEDE}</p>
        <div class="actions">
          <a class="btn btn-fill" href="glava-1/">Читать</a>
          <a class="btn btn-quiet" href="kniga/">Оглавление и аннотация</a>
        </div>
        <div class="resume" id="resume" hidden>
          <span id="resumeLabel"></span>
          <a class="btn btn-quiet" id="resumeLink" data-base="" href="kniga/" hidden>Продолжить</a>
        </div>
      </div>
    </div>
  </div>

  <div class="band" id="avtor">
    <div class="wrap">
      <h2 class="kicker">Автор</h2>
      <p class="pull">Меня часто спрашивают: «Почему у тебя такие мрачные истории?»</p>
      <p class="pull-a">Я отвечаю: потому что свет интересен только на контрасте.</p>
      <div class="prose">
          {author}
      </div>
      <ul class="links">
          {links}
      </ul>
    </div>
  </div>

  <div class="band">
    <div class="wrap">
      <h2 class="kicker">Книга</h2>
      <p class="lede" style="margin-bottom:1.2rem">«{e(b['title'])}» — {len(b['chapters'])} глав, примерно {round(minutes(total)/60)} часов чтения. Весь текст открыт и бесплатен.</p>
      <div class="actions"><a class="btn btn-quiet" href="kniga/">Открыть страницу книги</a></div>
    </div>
  </div>
</main>
"""
    out += footer("")
    write("index.html", out)
    PAGES.append(("", "1.0"))


def page_book(b):
    total = sum(c["chars"] for c in b["chapters"])
    desc = strip_tags(b["annotation"][0])[:300]
    schema = ld({
        "@context": "https://schema.org",
        "@type": "Book",
        "name": b["title"],
        "author": {"@type": "Person", "name": AUTHOR, "url": SITE + "/"},
        "inLanguage": "ru",
        "bookFormat": "https://schema.org/EBook",
        "datePublished": str(b["year"]),
        "numberOfPages": len(b["chapters"]),
        "image": f"{SITE}/{COVER}",
        "description": desc,
        "url": f"{SITE}/kniga/",
        "isAccessibleForFree": True,
        "hasPart": [
            {"@type": "Chapter", "name": "Глава " + c["n"], "url": f"{SITE}/glava-{c['n']}/"}
            for c in b["chapters"]
        ],
    })
    annot = "\n            ".join(f"<p>{p}</p>" for p in b["annotation"])
    front = "\n        ".join(
        f'<details><summary>{e(f["title"])}</summary><div class="prose">{f["html"]}</div></details>'
        for f in b["front"]
    )
    toc = "\n        ".join(
        f'<li><a href="../glava-{c["n"]}/">'
        f'<span class="num">{c["n"]}</span>'
        f'<span class="inc">{e(c["incipit"])}</span>'
        f'<span class="min">{minutes(c["chars"])} мин</span></a></li>'
        for c in b["chapters"]
    )
    out = head(f"{b['title']} — оглавление и аннотация", desc, "../", f"{SITE}/kniga/", schema)
    out += '<canvas id="field" aria-hidden="true"></canvas>\n'
    out += header("../", "kniga")
    out += f"""<main id="main">
  <div class="band" style="border-top:0">
    <div class="wrap">
      <div class="bookhead">
        <div class="cover" id="cover">
          <div class="cover-halo" aria-hidden="true"></div>
          <div class="cover-stage">
            <div class="cover-plate">
              <img src="../{COVER}" alt="Обложка романа «{e(b['title'])}»: силуэт головы человека, внутри — созвездие и очертания города" width="1000" height="1600">
              <span class="cover-sheen" aria-hidden="true"></span>
              <span class="cover-edge" aria-hidden="true"></span>
            </div>
          </div>
        </div>
        <div>
          <h1>{e(b['title'])}</h1>
          <ul class="facts">
            <li>{AUTHOR}</li>
            <li>{len(b['chapters'])} глав</li>
            <li>≈ {round(minutes(total)/60)} часов чтения</li>
            <li>{b['year']}</li>
          </ul>
          <div class="prose">
            {annot}
          </div>
          <div class="actions" style="margin-top:1.6rem">
            <a class="btn btn-fill" href="../glava-1/">Читать с начала</a>
            <a class="btn btn-quiet" id="resumeLink" data-base="../" data-short="1" href="../glava-1/" hidden>Продолжить</a>
          </div>
        </div>
      </div>
    </div>
  </div>

  <div class="band">
    <div class="wrap">
        {front}
    </div>
  </div>

  <div class="band">
    <div class="wrap">
      <h2 class="kicker">Оглавление</h2>
      <ul class="toc">
        {toc}
      </ul>
    </div>
  </div>
</main>
"""
    out += footer("../")
    write("kniga/index.html", out)
    PAGES.append(("kniga/", "0.9"))


def page_chapter(b, i):
    c = b["chapters"][i]
    prev = b["chapters"][i - 1] if i > 0 else None
    nxt = b["chapters"][i + 1] if i + 1 < len(b["chapters"]) else None
    body = strip_tags(c["html"])
    desc = body[:200].rsplit(" ", 1)[0] + "…"
    title = f"Глава {c['n']} — {b['title']}"
    url = f"{SITE}/glava-{c['n']}/"
    schema = ld({
        "@context": "https://schema.org",
        "@type": "Chapter",
        "name": "Глава " + c["n"],
        "position": i + 1,
        "url": url,
        "inLanguage": "ru",
        "wordCount": len(body.split()),
        "isPartOf": {
            "@type": "Book",
            "name": b["title"],
            "url": f"{SITE}/kniga/",
            "author": {"@type": "Person", "name": AUTHOR},
        },
    })
    nav = ""
    if prev:
        nav += f'<link rel="prev" href="../glava-{prev["n"]}/">\n'
    if nxt:
        nav += f'<link rel="next" href="../glava-{nxt["n"]}/">\n'

    toc = "\n        ".join(
        f'<li><a href="../glava-{x["n"]}/"{" aria-current=\"page\"" if x["n"] == c["n"] else ""}>'
        f'<span class="num">{x["n"]}</span>'
        f'<span class="inc">{e(x["incipit"])}</span>'
        f'<span class="min">{minutes(x["chars"])} мин</span></a></li>'
        for x in b["chapters"]
    )

    out = head(title, desc, "../", url, schema + nav)
    out = out.replace("<body>", f'<body class="reading" data-chapter="{c["n"]}">')
    out += f"""<div class="rbar">
  <div class="wrap">
    <a class="rbtn" href="../kniga/">← Книга</a>
    <button class="rbtn" id="tocBtn" aria-expanded="false" aria-controls="drawer">Оглавление</button>
    <div class="sizes" role="group" aria-label="Размер шрифта">
      <button class="s1" data-size="1" aria-pressed="false">Аа<span class="vh"> мелкий</span></button>
      <button class="s2" data-size="2" aria-pressed="true">Аа<span class="vh"> обычный</span></button>
      <button class="s3" data-size="3" aria-pressed="false">Аа<span class="vh"> крупный</span></button>
    </div>
  </div>
  <div class="rprog"><i id="prog"></i></div>
</div>
<main class="reader" id="main">
  <div class="wrap">
    <h1 class="chnum">{c['n']}<span class="vh"> — глава {c['n']} романа «{e(b['title'])}»</span></h1>
    <div class="text" id="chText">
{tag_paragraphs(c['html'])}
    </div>
    <nav class="rnav" aria-label="Переход между главами">
"""
    out += (f'      <a class="btn btn-quiet" id="prevCh" href="../glava-{prev["n"]}/">← Глава {prev["n"]}</a>\n'
            if prev else '      <span></span>\n')
    out += (f'      <a class="btn btn-quiet" id="nextCh" href="../glava-{nxt["n"]}/">Глава {nxt["n"]} →</a>\n'
            if nxt else '      <a class="btn btn-quiet" href="../kniga/">К оглавлению</a>\n')
    out += "    </nav>\n"
    if not nxt:
        out += (f'    <p class="rend">Конец романа<br>{e(b["place"])} · 26.07.{b["year"]}</p>\n'
                '    <div class="actions" style="justify-content:center;margin-top:1.6rem">\n'
                '      <a class="btn btn-quiet" href="../otzyvy/">Оставить отзыв о книге</a>\n'
                '    </div>\n')
    out += """  </div>
</main>
<div class="drawer" id="drawer" hidden>
  <div class="wrap">
    <div class="drawer-top">
      <p class="kicker" style="margin:0">Оглавление</p>
      <button class="rbtn" id="drawerClose">Закрыть ✕</button>
    </div>
    <ul class="toc">
        """ + toc + """
    </ul>
  </div>
</div>
"""
    out += footer("../")
    write(f"glava-{c['n']}/index.html", out)
    PAGES.append((f"glava-{c['n']}/", "0.8"))


def page_reviews(b):
    desc = ("Книга отзывов: что читатели пишут о романе «%s». "
            "Оставьте свой отзыв — автор читает все." % b["title"])
    schema = ld({
        "@context": "https://schema.org",
        "@type": "WebPage",
        "name": "Книга отзывов",
        "url": f"{SITE}/otzyvy/",
        "inLanguage": "ru",
        "about": {"@type": "Book", "name": b["title"], "url": f"{SITE}/kniga/"},
    })
    out = head("Книга отзывов — " + AUTHOR, desc, "../", f"{SITE}/otzyvy/", schema)
    out += '<canvas id="field" aria-hidden="true"></canvas>\n'
    out += header("../", "otzyvy")
    out += f"""<main id="main">
  <div class="band" style="border-top:0">
    <div class="wrap">
      <h1 class="page-title">Книга отзывов</h1>
      <p class="lede">Здесь читатели пишут, что они думают о «{e(b['title'])}». Автор читает все отзывы.</p>

      <form class="form" id="reviewForm" novalidate>
        <div class="field">
          <label for="rvName">Как вас зовут</label>
          <input id="rvName" name="name" type="text" maxlength="40" autocomplete="name" required
                 placeholder="Имя или ник">
          <p class="err-msg" id="rvNameErr" hidden></p>
        </div>
        <div class="field">
          <label for="rvText">Отзыв</label>
          <textarea id="rvText" name="text" rows="6" maxlength="2000" required
                    placeholder="Что вы думаете о книге? Не меньше ста символов — коротких «понравилось» тут не хватает."></textarea>
          <p class="counter"><span id="rvCount">0</span> из 100 символов минимум</p>
          <p class="err-msg" id="rvTextErr" hidden></p>
        </div>
        <label class="trap" aria-hidden="true">Не заполняйте это поле<input type="text" name="website" tabindex="-1" autocomplete="off"></label>
        <div class="actions">
          <button class="btn btn-fill" type="submit">Отправить отзыв</button>
        </div>
        <p class="demo-note" id="rvDemo" hidden></p>
      </form>

      <div class="thanks" id="rvThanks" hidden role="status">
        <p class="thanks-title">Спасибо вам за интерес к творчеству автора</p>
        <p class="thanks-sub">Ваш отзыв записан.</p>
        <button class="btn btn-quiet" type="button" id="rvAgain">Написать ещё</button>
      </div>
    </div>
  </div>

  <div class="band">
    <div class="wrap">
      <h2 class="kicker"><span id="rvTotal">Отзывы</span></h2>
      <ul class="reviews" id="rvList"></ul>
      <p class="empty" id="rvEmpty" hidden>Отзывов пока нет. Ваш будет первым.</p>
    </div>
  </div>
</main>
"""
    out += footer("../")
    write("otzyvy/index.html", out)
    PAGES.append(("otzyvy/", "0.7"))


def page_404():
    out = head("Страница не найдена — А.Л.О.Н.", "Такой страницы на сайте нет.", "", SITE + "/404.html")
    out = out.replace('<link rel="canonical"', '<meta name="robots" content="noindex">\n<link rel="canonical"')
    out += header("", "")
    out += """<main class="err" id="main">
  <div class="wrap">
    <h1>Здесь ничего нет</h1>
    <p class="lede">Страница не найдена: возможно, адрес набран с опечаткой или ссылка устарела.</p>
    <div class="actions">
      <a class="btn btn-fill" href="/">На главную</a>
      <a class="btn btn-quiet" href="/kniga/">К оглавлению книги</a>
    </div>
  </div>
</main>
"""
    out += footer("")
    write("404.html", out)


def page_assets():
    os.makedirs(os.path.join(ROOT, "assets"), exist_ok=True)
    with open(os.path.join(ROOT, "src", "site.css"), encoding="utf-8") as f:
        css = f.read()
    with open(os.path.join(ROOT, "assets", "site.css"), "w", encoding="utf-8") as f:
        f.write(css)
    with open(os.path.join(ROOT, "src", "site.js"), encoding="utf-8") as f:
        js = f.read()
    js = js.replace("__ALON_API__", API.rstrip("/"))
    with open(os.path.join(ROOT, "assets", "site.js"), "w", encoding="utf-8") as f:
        f.write(js)
    # отпечаток содержимого в адресе: правка доезжает до читателя сразу,
    # а не через десять минут, пока отстоится кэш GitHub Pages
    STAMP["css"] = hashlib.sha1(css.encode("utf-8")).hexdigest()[:8]
    STAMP["js"] = hashlib.sha1(js.encode("utf-8")).hexdigest()[:8]


def page_meta():
    today = date.today().isoformat()
    urls = "\n".join(
        f"  <url><loc>{SITE}/{p}</loc><lastmod>{today}</lastmod><priority>{pr}</priority></url>"
        for p, pr in PAGES
    )
    write("sitemap.xml",
          '<?xml version="1.0" encoding="UTF-8"?>\n'
          '<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n'
          + urls + "\n</urlset>\n")
    write("robots.txt", f"User-agent: *\nAllow: /\n\nSitemap: {SITE}/sitemap.xml\n")


def main():
    with open(BOOK, encoding="utf-8") as f:
        b = json.load(f)
    page_assets()
    page_home(b)
    page_book(b)
    page_reviews(b)
    for i in range(len(b["chapters"])):
        page_chapter(b, i)
    page_404()
    page_meta()
    print(f"готово: {len(PAGES)} страниц, глав — {len(b['chapters'])}")


if __name__ == "__main__":
    main()
