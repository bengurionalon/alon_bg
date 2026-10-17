/* Один файл на весь сайт. Каждый блок включается, только если нужный элемент
   есть на странице, поэтому в читалке не запускается ни поле, ни обложка. */
(function(){
  "use strict";

  var KEY_POS = "alon.pos.v-soznanie";
  var KEY_SIZE = "alon.size";
  var SIZES = {1:"1.0625rem", 2:"1.1875rem", 3:"1.35rem"};
  var $ = function(id){ return document.getElementById(id); };

  function store(k, v){
    try { if (v === undefined) return localStorage.getItem(k); localStorage.setItem(k, v); }
    catch(e){ return null; }
  }
  function readPos(){
    try { return JSON.parse(store(KEY_POS) || "null"); } catch(e){ return null; }
  }

  /* ======== хранилище ========
     Если задан адрес API (подставляется сборщиком из build.py), записи идут
     на сервер и видны всем. Если нет — живут в браузере читателя, как демо. */
  var API = "__ALON_API__";
  if (API.indexOf("__ALON") === 0) API = "";
  var DEMO = !API;

  /* у каждого браузера свой опознавательный знак: он нужен, чтобы один
     человек не накручивал счётчик, и не говорит о нём ничего */
  function voter(){
    var k = "alon.voter", v = null;
    try { v = localStorage.getItem(k); } catch(e){}
    if (!v){
      v = (window.crypto && crypto.randomUUID)
        ? crypto.randomUUID()
        : String(Date.now()) + Math.random().toString(36).slice(2);
      try { localStorage.setItem(k, v); } catch(e){}
    }
    return v;
  }

  var Remote = (function(){
    function call(path, opts){
      return fetch(API + path, opts).then(function(r){
        if (!r.ok) return r.json().catch(function(){ return {}; }).then(function(d){
          var err = new Error(d.error || ("http " + r.status));
          err.code = d.error; err.status = r.status;
          throw err;
        });
        return r.json();
      });
    }
    function post(path, data){
      return call(path, {
        method: "POST",
        headers: {"Content-Type": "application/json"},
        body: JSON.stringify(data)
      });
    }
    var mine = {};
    try { mine = JSON.parse(localStorage.getItem("alon.myreactions") || "{}"); } catch(e){}
    return {
      demo: false,
      tooFast: function(){ return false; },
      listReviews: function(){
        return call("/reviews").then(function(rows){
          return rows.map(function(r){ return {name: r.name, text: r.body, at: r.at, id: r.id}; });
        });
      },
      addReview: function(r){
        return post("/reviews", {name: r.name, body: r.text, website: ""});
      },
      listReactions: function(chapter){
        return call("/reactions?chapter=" + encodeURIComponent(chapter));
      },
      react: function(chapter, pid, was, now){
        return post("/react", {chapter: chapter, pid: pid, voter: voter(), emoji: now || ""});
      },
      myReactions: function(chapter){ return mine[chapter] || {}; },
      saveMine: function(chapter, map){
        mine[chapter] = map;
        try { localStorage.setItem("alon.myreactions", JSON.stringify(mine)); } catch(e){}
      }
    };
  })();

  var Local = (function(){
    var KEY_RV = "alon.reviews", KEY_CM = "alon.reactions",
        KEY_MINE = "alon.myreactions", KEY_RATE = "alon.rate";
    function load(k){
      var empty = (k === KEY_RV) ? "[]" : "{}";
      try { return JSON.parse(localStorage.getItem(k) || empty); }
      catch(e){ return JSON.parse(empty); }
    }
    function save(k, v){
      try { localStorage.setItem(k, JSON.stringify(v)); return true; } catch(e){ return false; }
    }
    function tooFast(){
      var last = 0;
      try { last = Number(localStorage.getItem(KEY_RATE)) || 0; } catch(e){}
      if (Date.now() - last < 20000) return true;
      try { localStorage.setItem(KEY_RATE, String(Date.now())); } catch(e){}
      return false;
    }
    return {
      demo: DEMO,
      tooFast: tooFast,
      listReviews: function(){
        return Promise.resolve(load(KEY_RV).sort(function(a, b){ return b.at - a.at; }));
      },
      addReview: function(r){
        var all = load(KEY_RV);
        r.at = Date.now();
        r.id = String(r.at) + Math.random().toString(36).slice(2, 7);
        all.push(r);
        save(KEY_RV, all);
        return Promise.resolve(r);
      },
      /* реакции: {глава: {абзац: {эмодзи: сколько}}} */
      listReactions: function(chapter){
        return Promise.resolve(load(KEY_CM)[chapter] || {});
      },
      react: function(chapter, pid, was, now){
        var all = load(KEY_CM);
        var ch = all[chapter] = all[chapter] || {};
        var p = ch[pid] = ch[pid] || {};
        if (was && p[was]) p[was] = Math.max(0, p[was] - 1);
        if (now) p[now] = (p[now] || 0) + 1;
        save(KEY_CM, all);
        return Promise.resolve(ch);
      },
      /* что отметил этот читатель — всегда только у него в браузере */
      myReactions: function(chapter){
        return load(KEY_MINE)[chapter] || {};
      },
      saveMine: function(chapter, map){
        var all = load(KEY_MINE);
        all[chapter] = map;
        save(KEY_MINE, all);
      }
    };
  })();

  var Store = API ? Remote : Local;

  var MONTHS = ["января","февраля","марта","апреля","мая","июня",
                "июля","августа","сентября","октября","ноября","декабря"];
  function when(ts){
    var d = new Date(ts);
    return d.getDate() + " " + MONTHS[d.getMonth()] + " " + d.getFullYear();
  }
  function esc(s){
    return String(s).replace(/[&<>"]/g, function(ch){
      return {"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;"}[ch];
    });
  }
  function clean(s){
    return String(s).replace(/\s+/g, " ").trim();
  }
  function looksLikeSpam(s){
    return /https?:\/\/|www\.|<a\s|\[url/i.test(s);
  }

  /* ======== поле нитей ======== */
  (function(){
    var cv = $("field");
    if (!cv || !cv.getContext) return;
    var ctx = cv.getContext("2d");
    var W = 0, H = 0, t = 0, raf = null, asleep = false;
    var col = "rgba(94,48,160,.5)";
    var rows = [];
    var tx = -9999, ty = -9999, lx = -9999, ly = -9999, hold = 0, holdTo = 0;
    var mqReduce = window.matchMedia("(prefers-reduced-motion: reduce)");
    var mqDark = window.matchMedia("(prefers-color-scheme: dark)");

    function readColor(){
      var v = getComputedStyle(document.documentElement).getPropertyValue("--field").trim();
      if (v) col = v;
    }
    function size(){
      var r = cv.getBoundingClientRect();
      if (!r.width || !r.height) return false;
      var dpr = Math.min(2, window.devicePixelRatio || 1);
      var nw = Math.round(r.width), nh = Math.round(r.height);
      var changed = (nw !== W || nh !== H);
      W = nw; H = nh;
      cv.width = Math.round(W * dpr); cv.height = Math.round(H * dpr);
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      if (changed || !rows.length) layout();
      return true;
    }
    function layout(){
      var gap = Math.max(12, H / 38);
      var n = Math.ceil(H / gap) + 3;
      var kept = rows;
      rows = [];
      for (var i = 0; i < n; i++){
        rows.push({
          base: i * gap - gap,
          ph: i * 0.63,
          rate: 0.030 + 0.030 * ((i % 6) / 5),
          k: kept[i] ? kept[i].k : 0
        });
      }
    }
    function step(){
      t += 0.016;
      hold += (holdTo - hold) * 0.05;
      if (lx < -1000){ lx = tx; ly = ty; }
      lx += (tx - lx) * 0.11; ly += (ty - ly) * 0.11;
      for (var i = 0; i < rows.length; i++) rows[i].k += (hold - rows[i].k) * rows[i].rate;
    }
    function draw(){
      ctx.clearRect(0, 0, W, H);
      ctx.lineWidth = 1;
      ctx.lineJoin = "round";
      var dx = Math.max(4, W / 200);
      var R = Math.min(340, Math.max(180, W * 0.24));
      for (var i = 0; i < rows.length; i++){
        var r = rows[i];
        var rowEnv = 0.45 + 0.55 * Math.sin(Math.PI * Math.min(1, Math.max(0, r.base / Math.max(1, H))));
        var live = r.k > 0.012;
        ctx.beginPath();
        for (var x = 0; x <= W; x += dx){
          var u = x / W;
          var pin = Math.sin(Math.PI * u);
          var drift = 32 * Math.sin(x * 0.0020 + t * 0.095 + r.ph * 0.07)
                    + 14 * Math.sin(x * 0.0046 - t * 0.068 + r.ph * 0.38)
                    +  5 * Math.sin(x * 0.0091 + t * 0.15 + r.ph);
          var y = r.base + pin * drift * rowEnv;
          if (live){
            var ax = x - lx, ay = y - ly;
            var d = Math.sqrt(ax * ax + ay * ay);
            if (d < R){
              var f = 1 - d / R;
              y += pin * (ay / Math.max(d, 28)) * f * f * 54 * r.k;
            }
          }
          if (x === 0) ctx.moveTo(x, y); else ctx.lineTo(x, y);
        }
        ctx.globalAlpha = 0.18 + 0.50 * Math.abs(Math.sin(i * 0.68 + 0.4)) + 0.16 * r.k;
        ctx.strokeStyle = col;
        ctx.stroke();
      }
      ctx.globalAlpha = 1;
    }
    function loop(){ step(); draw(); raf = requestAnimationFrame(loop); }
    function start(){ if (!raf && !asleep && !mqReduce.matches) raf = requestAnimationFrame(loop); }
    function stop(){ if (raf){ cancelAnimationFrame(raf); raf = null; } }

    window.addEventListener("pointermove", function(e){
      if (mqReduce.matches) return;
      tx = e.clientX; ty = e.clientY; holdTo = 1;
    }, {passive:true});
    document.addEventListener("pointerleave", function(){ holdTo = 0; }, {passive:true});
    window.addEventListener("blur", function(){ holdTo = 0; });

    var rt = null;
    window.addEventListener("resize", function(){
      clearTimeout(rt);
      rt = setTimeout(function(){ if (size()) draw(); }, 150);
    }, {passive:true});
    document.addEventListener("visibilitychange", function(){
      asleep = document.hidden;
      if (asleep) stop(); else start();
    });
    if (mqDark.addEventListener) mqDark.addEventListener("change", function(){ readColor(); draw(); });
    if (mqReduce.addEventListener) mqReduce.addEventListener("change", function(){
      if (mqReduce.matches){ stop(); holdTo = 0; hold = 0; draw(); } else start();
    });

    readColor();
    if (size()) { draw(); start(); }
  })();

  /* ======== обложка ======== */
  (function(){
    var box = $("cover");
    if (!box) return;
    var stage = box.querySelector(".cover-stage");
    var halo = box.querySelector(".cover-halo");
    var sheen = box.querySelector(".cover-sheen");
    if (!stage || !halo || !sheen) return;
    var mq = window.matchMedia("(prefers-reduced-motion: reduce)");
    var fine = window.matchMedia("(hover: hover) and (pointer: fine)");
    var pending = null;

    function reset(){
      box.classList.remove("live");
      stage.style.transform = "";
      halo.style.transform = "";
    }
    box.addEventListener("pointermove", function(e){
      if (mq.matches || !fine.matches || pending) return;
      pending = requestAnimationFrame(function(){
        pending = null;
        var r = box.getBoundingClientRect();
        if (!r.width) return;
        var u = Math.max(-0.5, Math.min(0.5, (e.clientX - r.left) / r.width - 0.5));
        var v = Math.max(-0.5, Math.min(0.5, (e.clientY - r.top) / r.height - 0.5));
        stage.style.transform = "rotateY(" + (u * 15).toFixed(2) + "deg) rotateX(" + (-v * 13).toFixed(2) + "deg) translateZ(14px)";
        halo.style.transform = "translate3d(" + (-u * 26).toFixed(1) + "px," + (-v * 20).toFixed(1) + "px,0) scale(1.06)";
        sheen.style.setProperty("--mx", ((u + 0.5) * 100).toFixed(1) + "%");
        sheen.style.setProperty("--my", ((v + 0.5) * 100).toFixed(1) + "%");
        box.classList.add("live");
      });
    }, {passive:true});
    box.addEventListener("pointerleave", reset, {passive:true});
    box.addEventListener("pointercancel", reset, {passive:true});
  })();

  /* ======== «продолжить чтение» ======== */
  (function(){
    var link = $("resumeLink");
    if (!link) return;
    var pos = readPos();
    if (!pos || !pos.ch) return;
    var box = $("resume");
    var label = $("resumeLabel");
    link.setAttribute("href", link.dataset.base + "glava-" + pos.ch + "/");
    if (label) label.textContent = "Вы остановились на главе " + pos.ch;
    link.textContent = link.dataset.short ? "Продолжить — глава " + pos.ch : "Продолжить";
    if (box) box.hidden = false;
    link.hidden = false;
  })();

  /* ======== заставка: книга перед входом ======== */
  (function(){
    var gate = $("gate");
    if (!gate) return;
    var KEY = "alon.gate";
    var book = gate.querySelector(".gate-book");
    var gloss = gate.querySelector(".gate-gloss");
    var shade = gate.querySelector(".gate-shade");
    var skip = $("gateSkip");
    var body = document.body;
    var mqReduce = window.matchMedia("(prefers-reduced-motion: reduce)");

    /* второй раз не задерживаем, и никогда — если пришли по ссылке вглубь */
    var seen = false;
    try { seen = localStorage.getItem(KEY) === "1"; } catch(e){}
    if (seen || location.hash){ gate.remove(); return; }

    body.classList.add("gate-on");
    requestAnimationFrame(function(){ body.classList.add("gate-ready"); });

    var opening = false;
    function enter(){
      if (opening) return;
      opening = true;
      try { localStorage.setItem(KEY, "1"); } catch(e){}
      body.classList.add("gate-opening");
      setTimeout(function(){
        body.classList.remove("gate-on", "gate-ready", "gate-opening");
        body.classList.add("gate-off");
        setTimeout(function(){ if (gate.parentNode) gate.remove(); }, 1000);
      }, mqReduce.matches ? 0 : 620);
    }

    book.addEventListener("click", enter);
    if (skip) skip.addEventListener("click", enter);
    document.addEventListener("keydown", function(e){
      if (!opening && body.classList.contains("gate-on") && (e.key === "Enter" || e.key === " " || e.key === "Escape")){
        e.preventDefault();
        enter();
      }
    });

    /* книга ведётся за курсором */
    var pending = null;
    gate.addEventListener("pointermove", function(e){
      if (mqReduce.matches || opening || pending) return;
      pending = requestAnimationFrame(function(){
        pending = null;
        var r = book.getBoundingClientRect();
        if (!r.width) return;
        var u = Math.max(-1, Math.min(1, (e.clientX - (r.left + r.width / 2)) / (window.innerWidth / 2)));
        var v = Math.max(-1, Math.min(1, (e.clientY - (r.top + r.height / 2)) / (window.innerHeight / 2)));
        book.classList.add("held");
        book.style.transform =
          "rotateX(" + (5 - v * 8).toFixed(2) + "deg) rotateY(" + (-24 + u * 13).toFixed(2) + "deg)";
        if (gloss) gloss.style.setProperty("--gx", (50 + u * 38).toFixed(1) + "%");
        if (shade) shade.style.transform = "translateX(" + (-u * 16).toFixed(1) + "px) scaleX(" + (1 - Math.abs(u) * 0.12).toFixed(3) + ")";
      });
    }, {passive:true});
    gate.addEventListener("pointerleave", function(){
      if (opening) return;
      book.classList.remove("held");
      book.style.transform = "";
      if (shade) shade.style.transform = "";
    }, {passive:true});
  })();

  /* ======== книга отзывов ======== */
  (function(){
    var form = $("reviewForm");
    if (!form) return;
    var name = $("rvName"), text = $("rvText"), count = $("rvCount");
    var list = $("rvList"), empty = $("rvEmpty"), total = $("rvTotal");
    var thanks = $("rvThanks"), again = $("rvAgain"), demo = $("rvDemo");
    var MIN = 100;

    if (Store.demo && demo){
      demo.hidden = false;
      demo.textContent = "Пока это демонстрация: отзыв сохраняется только в вашем браузере "
        + "и другие читатели его не увидят. Когда у сайта появится хранилище, "
        + "форма заработает по-настоящему, и ничего в ней менять не придётся.";
    }

    function plural(n){
      var a = n % 10, b = n % 100;
      if (a === 1 && b !== 11) return "отзыв";
      if (a >= 2 && a <= 4 && (b < 10 || b >= 20)) return "отзыва";
      return "отзывов";
    }
    function render(items){
      list.innerHTML = items.map(function(r){
        return '<li><div class="rv-top"><span class="rv-name">' + esc(r.name) + '</span>'
             + '<span class="rv-date">' + when(r.at) + '</span></div>'
             + '<p class="rv-text">' + esc(r.text) + '</p></li>';
      }).join("");
      empty.hidden = items.length > 0;
      total.textContent = items.length ? items.length + " " + plural(items.length) : "Отзывы";
    }
    function err(field, msgEl, msg){
      if (msg){ field.setAttribute("aria-invalid", "true"); msgEl.textContent = msg; msgEl.hidden = false; }
      else { field.removeAttribute("aria-invalid"); msgEl.hidden = true; }
      return !msg;
    }

    text.addEventListener("input", function(){
      var n = clean(text.value).length;
      count.textContent = n;
      count.parentNode.classList.toggle("ok", n >= MIN);
    });

    form.addEventListener("submit", function(ev){
      ev.preventDefault();
      if (form.elements.website && form.elements.website.value) return;
      var nm = clean(name.value), tx = text.value.trim();
      var okName = err(name, $("rvNameErr"),
        nm.length < 2 ? "Напишите, как к вам обращаться." : "");
      var msg = "";
      if (clean(tx).length < MIN) msg = "Нужно не меньше ста символов — сейчас " + clean(tx).length + ".";
      else if (looksLikeSpam(tx)) msg = "Ссылки в отзывах не публикуются.";
      var okText = err(text, $("rvTextErr"), msg);
      if (!okName || !okText){ (okName ? text : name).focus(); return; }
      if (Store.tooFast()){
        err(text, $("rvTextErr"), "Слишком часто. Подождите немного.");
        return;
      }
      Store.addReview({name: nm, text: tx}).then(function(){
        form.reset();
        count.textContent = "0";
        count.parentNode.classList.remove("ok");
        form.hidden = true;
        thanks.hidden = false;
        thanks.scrollIntoView({block: "center", behavior: "smooth"});
        return Store.listReviews().then(render);
      }).catch(function(e){
        var m = {
          short: "Нужно не меньше ста символов.",
          links: "Ссылки в отзывах не публикуются.",
          name: "Напишите, как к вам обращаться.",
          "too many": "Слишком часто. Попробуйте позже."
        }[e && e.code];
        err(text, $("rvTextErr"), m || "Не удалось отправить. Проверьте связь и попробуйте ещё раз.");
      });
    });

    if (again) again.addEventListener("click", function(){
      thanks.hidden = true;
      form.hidden = false;
      name.focus();
    });

    Store.listReviews().then(render).catch(function(){
      empty.hidden = false;
      empty.textContent = "Не удалось загрузить отзывы. Обновите страницу чуть позже.";
    });
  })();

  /* ======== читалка ======== */
  (function(){
    var text = $("chText");
    if (!text) return;
    var chapter = document.body.dataset.chapter;

    function applySize(n){
      document.documentElement.style.setProperty("--rsize", SIZES[n] || SIZES[2]);
      var bs = document.querySelectorAll(".sizes button");
      for (var i = 0; i < bs.length; i++)
        bs[i].setAttribute("aria-pressed", bs[i].dataset.size === String(n) ? "true" : "false");
      store(KEY_SIZE, String(n));
    }
    var bs = document.querySelectorAll(".sizes button");
    for (var i = 0; i < bs.length; i++){
      (function(b){ b.addEventListener("click", function(){ applySize(Number(b.dataset.size)); }); })(bs[i]);
    }
    applySize(Number(store(KEY_SIZE)) || 2);

    var prog = $("prog"), ticking = false;
    function update(){
      var max = Math.max(1, document.documentElement.scrollHeight - window.innerHeight);
      var r = Math.min(1, Math.max(0, window.scrollY / max));
      if (prog) prog.style.width = (r * 100).toFixed(1) + "%";
      try { store(KEY_POS, JSON.stringify({ch: chapter, r: r})); } catch(e){}
    }
    window.addEventListener("scroll", function(){
      if (ticking) return;
      ticking = true;
      requestAnimationFrame(function(){ update(); ticking = false; });
    }, {passive:true});
    window.addEventListener("resize", update, {passive:true});

    /* вернуться туда, где человек остановился в этой же главе */
    var pos = readPos();
    if (pos && pos.ch === chapter && pos.r > 0.02 && pos.r < 0.995 && !location.hash){
      requestAnimationFrame(function(){
        requestAnimationFrame(function(){
          var max = Math.max(0, document.documentElement.scrollHeight - window.innerHeight);
          window.scrollTo(0, pos.r * max);
          update();
        });
      });
    } else {
      update();
    }

    /* оглавление */
    var drawer = $("drawer"), btn = $("tocBtn"), close = $("drawerClose");
    if (drawer && btn){
      function open(){ drawer.hidden = false; btn.setAttribute("aria-expanded", "true"); }
      function shut(){ drawer.hidden = true; btn.setAttribute("aria-expanded", "false"); }
      btn.addEventListener("click", function(){ drawer.hidden ? open() : shut(); });
      if (close) close.addEventListener("click", shut);
      document.addEventListener("keydown", function(e){ if (e.key === "Escape") shut(); });
    }

    /* ---- реакции к абзацам ---- */
    (function(){
      var EMOJI = ["😮","😨","💔","🔥","😢","🤔","😍","😡"];
      var paras = text.querySelectorAll("p[data-p]");
      if (!paras.length) return;
      var counts = {}, mine = Store.myReactions(chapter), open = null;

      Store.listReactions(chapter).then(function(data){
        counts = data;
      }).catch(function(){
        counts = {};          /* хранилище недоступно — текст важнее счётчиков */
      }).then(function(){
        for (var i = 0; i < paras.length; i++) refresh(paras[i]);
        watch();
      });

      /* счётчики проступают, только когда абзац уже прочитан:
         иначе чужая реакция подсказывает, что будет, до того как человек прочтёт */
      function watch(){
        if (!window.IntersectionObserver){
          for (var i = 0; i < paras.length; i++) paras[i].classList.add("read");
          return;
        }
        var io = new IntersectionObserver(function(entries){
          entries.forEach(function(en){
            if (en.boundingClientRect.bottom < en.rootBounds.top + 1){
              en.target.classList.add("read");
              io.unobserve(en.target);
            }
          });
        }, {rootMargin: "-35% 0px 0px 0px", threshold: 0});
        for (var i = 0; i < paras.length; i++) io.observe(paras[i]);
      }

      function refresh(p){
        var pid = p.dataset.p;
        var c = counts[pid] || {};
        var picked = mine[pid] || "";
        var btn = p.querySelector(".pmark");
        if (!btn){
          btn = document.createElement("button");
          btn.type = "button";
          btn.className = "pmark";
          btn.setAttribute("aria-expanded", "false");
          btn.addEventListener("click", function(ev){ ev.stopPropagation(); toggle(p, btn); });
          p.appendChild(btn);
        }
        btn.textContent = picked || "+";
        btn.classList.toggle("picked", !!picked);
        btn.setAttribute("aria-label", picked
          ? "Ваша реакция на абзац: " + picked + ". Изменить"
          : "Отметить реакцию на абзац");

        var pairs = Object.keys(c).filter(function(k){ return c[k] > 0; })
                      .sort(function(x, y){ return c[y] - c[x]; });
        var sum = p.querySelector(".rsum");
        if (!pairs.length){
          if (sum) sum.remove();
          return;
        }
        if (!sum){
          sum = document.createElement("span");
          sum.className = "rsum";
          p.appendChild(sum);
        }
        sum.innerHTML = pairs.slice(0, 4).map(function(k){
          return '<span class="rchip' + (k === picked ? " mine" : "") + '">'
               + '<span aria-hidden="true">' + k + "</span>" + c[k] + "</span>";
        }).join("");
        sum.setAttribute("aria-label", "Реакции читателей: "
          + pairs.map(function(k){ return k + " " + c[k]; }).join(", "));
      }

      function close(){
        if (!open) return;
        open.pop.remove();
        open.btn.setAttribute("aria-expanded", "false");
        open = null;
      }

      function toggle(p, btn){
        if (open && open.p === p){ close(); return; }
        close();
        var pid = p.dataset.p;
        var picked = mine[pid] || "";
        var pop = document.createElement("span");
        pop.className = "rpop";
        pop.innerHTML = EMOJI.map(function(x){
          return '<button type="button" aria-label="' + x + '"'
               + (x === picked ? ' aria-pressed="true"' : "") + ">" + x + "</button>";
        }).join("") + (picked ? '<button type="button" class="rclear">убрать</button>' : "");
        p.appendChild(pop);
        btn.setAttribute("aria-expanded", "true");
        open = {p: p, btn: btn, pop: pop};

        pop.querySelectorAll("button").forEach(function(b){
          b.addEventListener("click", function(ev){
            ev.stopPropagation();
            var next = b.classList.contains("rclear") ? "" : b.textContent;
            if (next === picked) next = "";
            Store.react(chapter, pid, picked, next).then(function(data){
              counts = data;
              if (next) mine[pid] = next; else delete mine[pid];
              Store.saveMine(chapter, mine);
              close();
              p.classList.add("read");
              refresh(p);
            }).catch(function(){
              btn.classList.add("failed");
              setTimeout(function(){ btn.classList.remove("failed"); }, 1500);
              close();
            });
          });
        });
      }

      document.addEventListener("click", close);
      document.addEventListener("keydown", function(e){ if (e.key === "Escape") close(); });
    })();

    /* стрелки листают главы */
    document.addEventListener("keydown", function(e){
      if (e.metaKey || e.ctrlKey || e.altKey) return;
      var tag = e.target && e.target.tagName;
      if (tag === "INPUT" || tag === "TEXTAREA") return;
      var el = null;
      if (e.key === "ArrowRight") el = $("nextCh");
      if (e.key === "ArrowLeft") el = $("prevCh");
      if (el && el.getAttribute("href")) location.href = el.getAttribute("href");
    });
  })();
})();
