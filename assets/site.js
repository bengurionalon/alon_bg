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
  var API = "https://alon-api.bengurionalon.workers.dev";
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

  /* ======== фон: поле растений, которое ложится в нити ========
     На главной сначала идёт наезд на поле — то самое, посреди которого
     Виктор приходит в себя в конце романа. По нажатию стебли
     распрямляются, растягиваются поперёк экрана и становятся нитями,
     которые дальше живут фоном всего сайта. */
  var FIELD = (function(){
    var cv = $("field");
    if (!cv || !cv.getContext) return {grove:function(){}, settle:function(){}};
    var ctx = cv.getContext("2d");
    var W = 0, H = 0, t = 0, raf = null, asleep = false;
    var col = "rgba(94,48,160,.5)";
    var rows = [], plants = [];
    var tx = -9999, ty = -9999, lx = -9999, ly = -9999, hold = 0, holdTo = 0;
    var mode = "strings", morph = 0, morphTo = 0;
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
      if (changed || !plants.length) sow();
      return true;
    }

    /* ---- нити ---- */
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
    function threadY(r, x, live){
      var u = x / W;
      var pin = Math.sin(Math.PI * u);
      var rowEnv = 0.45 + 0.55 * Math.sin(Math.PI * Math.min(1, Math.max(0, r.base / Math.max(1, H))));
      var drift = 32 * Math.sin(x * 0.0020 + t * 0.095 + r.ph * 0.07)
                + 14 * Math.sin(x * 0.0046 - t * 0.068 + r.ph * 0.38)
                +  5 * Math.sin(x * 0.0091 + t * 0.15 + r.ph);
      var y = r.base + pin * drift * rowEnv;
      if (live){
        var ax = x - lx, ay = y - ly;
        var d = Math.sqrt(ax * ax + ay * ay);
        var R = Math.min(340, Math.max(180, W * 0.24));
        if (d < R){
          var f = 1 - d / R;
          y += pin * (ay / Math.max(d, 28)) * f * f * 54 * r.k;
        }
      }
      return y;
    }
    function drawThreads(alpha){
      var dx = Math.max(4, W / 200);
      for (var i = 0; i < rows.length; i++){
        var r = rows[i];
        ctx.beginPath();
        for (var x = 0; x <= W; x += dx){
          var y = threadY(r, x, r.k > 0.012);
          if (x === 0) ctx.moveTo(x, y); else ctx.lineTo(x, y);
        }
        ctx.globalAlpha = alpha * (0.18 + 0.50 * Math.abs(Math.sin(i * 0.68 + 0.4)) + 0.16 * r.k);
        ctx.lineWidth = 1;
        ctx.stroke();
      }
    }

    /* ---- поле ---- */
    function rnd(seed){
      var s = seed >>> 0;
      return function(){ s = (s * 1664525 + 1013904223) >>> 0; return s / 4294967296; };
    }
    function makePlant(i, near){
      var R = rnd(i * 2654435761 + 12345);
      var corridor = 0.17;                 /* тропа посередине остаётся пустой */
      var u = (R() * 2 - 1);
      if (Math.abs(u) < corridor) u = (u < 0 ? -1 : 1) * (corridor + R() * 0.12);
      var leaves = [];
      var n = 4 + Math.floor(R() * 3);
      for (var k = 0; k < n; k++){
        leaves.push({
          s: 0.12 + (k / n) * 0.74 + R() * 0.05,
          side: k % 2 ? 1 : -1,
          len: 0.12 + R() * 0.09,
          droop: 0.46 + R() * 0.42
        });
      }
      return {
        u: u * (1 + R() * 0.9),
        d: near ? (0.14 + Math.pow(R(), 0.55) * 0.95) : (1.0 + R() * 0.1),
        h: 0.72 + R() * 0.5,
        lean: (R() * 2 - 1) * 0.5,
        podW: 0.072 + R() * 0.032,
        veins: 2 + Math.floor(R() * 3),
        sway: R() * 6.28,
        leaves: leaves
      };
    }
    function sow(){
      var count = W < 620 ? 55 : (W < 1100 ? 80 : 110);
      plants = [];
      for (var i = 0; i < count; i++) plants.push(makePlant(i, true));
    }

    function drawPlant(pl, m, idx){
      var hz = H * 0.40;
      var p = 0.30 / Math.max(0.06, pl.d);
      if (p < 0.045) return;
      var x = W * 0.5 + pl.u * p * W * 0.62;
      var base = hz + p * H * 0.50;
      var hgt = p * H * 0.62 * pl.h;
      if (x < -W * 0.6 || x > W * 1.6 || base - hgt > H) return;

      var fade = Math.min(1, (p - 0.04) / 0.05) * Math.min(1, Math.max(0, (1.7 - p) / 0.55));
      if (fade <= 0.01) return;

      /* ветер идёт за курсором */
      var gust = 0;
      if (hold > 0.02){
        var dd = Math.abs(x - lx) / Math.max(1, W * 0.28);
        if (dd < 1.6) gust = (x - lx >= 0 ? 1 : -1) * (1 - Math.min(1, dd)) * 0.5 * hold;
      }
      var lean = pl.lean * 0.06 + Math.sin(t * 0.55 + pl.sway) * 0.025 + gust * 0.22;

      ctx.globalAlpha = fade * 0.46 * (1 - m * 0.15);
      ctx.lineWidth = Math.max(0.45, Math.min(1.05, hgt * 0.0075));

      var topX0 = x + lean * hgt, topY0 = base - hgt;
      var midX0 = x + lean * hgt * 0.3, midY0 = base - hgt * 0.55;

      if (m <= 0.001){
        ctx.beginPath();
        ctx.moveTo(x, base);
        ctx.quadraticCurveTo(midX0, midY0, topX0, topY0);
        ctx.stroke();
      } else {
        /* стебель распрямляется и уходит на место своей нити */
        var e = m * m * (3 - 2 * m);
        var row = rows[(idx * 7 + 3) % rows.length];
        var steps = 18;
        ctx.beginPath();
        for (var i = 0; i <= steps; i++){
          var s = i / steps;
          var a = 1 - s, bq = a * a, cq = 2 * a * s, dq = s * s;
          var px = bq * x + cq * midX0 + dq * topX0;
          var py = bq * base + cq * midY0 + dq * topY0;
          var qx = s * W;
          var qy = threadY(row, qx, false);
          var fx = px + (qx - px) * e, fy = py + (qy - py) * e;
          if (i === 0) ctx.moveTo(fx, fy); else ctx.lineTo(fx, fy);
        }
        ctx.stroke();
      }

      var leafA = fade * 0.4 * (1 - m);
      if (leafA > 0.02){
        ctx.globalAlpha = leafA;
        for (var j = 0; j < pl.leaves.length; j++){
          var lf = pl.leaves[j];
          var ss = lf.s;
          var lx0 = x + lean * hgt * ss * ss, ly0 = base - hgt * ss;
          var len = hgt * lf.len;
          var dir = lf.side;
          ctx.beginPath();
          ctx.moveTo(lx0, ly0);
          ctx.quadraticCurveTo(lx0 + dir * len * 0.5, ly0 - len * 0.20,
                               lx0 + dir * len * 0.78, ly0 + len * lf.droop);
          ctx.quadraticCurveTo(lx0 + dir * len * 0.34, ly0 + len * 0.26, lx0, ly0 + len * 0.1);
          ctx.stroke();
        }
        /* головка с прожилками */
        var pw = hgt * pl.podW, ph = pw * 1.8;
        var cy = topY0 - ph * 0.5;
        ctx.beginPath();
        ctx.ellipse(topX0, cy, pw * 0.5, ph * 0.5, lean * 0.5, 0, 6.2832);
        ctx.stroke();
        for (var v = 1; v <= pl.veins; v++){
          var kk = v / (pl.veins + 1);
          var off = (kk - 0.5) * pw * 0.9;
          ctx.beginPath();
          ctx.moveTo(topX0, cy - ph * 0.5);
          ctx.quadraticCurveTo(topX0 + off * 1.5, cy, topX0, cy + ph * 0.5);
          ctx.stroke();
        }
      }
    }

    function drawGrove(){
      plants.sort(function(a, b){ return b.d - a.d; });
      for (var i = 0; i < plants.length; i++) drawPlant(plants[i], morph, i);
    }

    function step(dt){
      t += 0.016;
      hold += (holdTo - hold) * 0.05;
      if (lx < -1000){ lx = tx; ly = ty; }
      lx += (tx - lx) * 0.11; ly += (ty - ly) * 0.11;
      for (var i = 0; i < rows.length; i++) rows[i].k += (hold - rows[i].k) * rows[i].rate;

      if (mode !== "strings"){
        if (morphTo > 0){
          morph += (morphTo - morph) * 0.045;
          if (morph > 0.985){ morph = 1; mode = "strings"; }
        } else if (!mqReduce.matches){
          /* наезд: поле едет на зрителя, ушедшее возвращается к горизонту */
          for (var j = 0; j < plants.length; j++){
            var pl = plants[j];
            pl.d -= 0.0016;
            if (pl.d < 0.07){ var fresh = makePlant((Math.random() * 1e9) | 0, false); fresh.d = 1.05 + Math.random() * 0.1; plants[j] = fresh; }
          }
        }
      }
    }

    function draw(){
      ctx.clearRect(0, 0, W, H);
      ctx.lineJoin = "round";
      ctx.strokeStyle = col;
      if (mode === "strings"){
        drawThreads(1);
      } else {
        drawGrove();
        if (morph > 0.02) drawThreads(morph * morph);
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
    if (size()){ draw(); start(); }

    return {
      grove: function(){ mode = "grove"; morph = 0; morphTo = 0; if (size()) draw(); start(); },
      settle: function(){ if (mode === "grove"){ morphTo = 1; if (mqReduce.matches){ morph = 1; mode = "strings"; draw(); } } }
    };
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

  /* ======== заставка: наезд на поле ======== */
  (function(){
    var gate = $("gate");
    if (!gate) return;
    var KEY = "alon.gate";
    var body = document.body;
    var mqReduce = window.matchMedia("(prefers-reduced-motion: reduce)");

    var seen = false;
    try { seen = localStorage.getItem(KEY) === "1"; } catch(e){}
    if (seen || location.hash){ gate.remove(); return; }

    body.classList.add("gate-on");
    FIELD.grove();
    requestAnimationFrame(function(){ body.classList.add("gate-ready"); });

    var opening = false;
    function enter(){
      if (opening) return;
      opening = true;
      try { localStorage.setItem(KEY, "1"); } catch(e){}
      FIELD.settle();                              /* растения ложатся в нити */
      body.classList.add("gate-opening");
      setTimeout(function(){
        body.classList.remove("gate-on", "gate-ready", "gate-opening");
        body.classList.add("gate-off");
        setTimeout(function(){ if (gate.parentNode) gate.remove(); }, 1200);
      }, mqReduce.matches ? 0 : 1500);
    }

    gate.addEventListener("click", enter);
    document.addEventListener("keydown", function(e){
      if (!opening && body.classList.contains("gate-on") &&
          (e.key === "Enter" || e.key === " " || e.key === "Escape")){
        e.preventDefault();
        enter();
      }
    });
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
