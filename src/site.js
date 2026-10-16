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
     Пока записи живут в браузере читателя. Когда появится сервер, меняется
     только этот объект: четыре метода, всё остальное остаётся как есть. */
  var DEMO = true;
  var Store = (function(){
    var KEY_RV = "alon.reviews", KEY_CM = "alon.comments", KEY_RATE = "alon.rate";
    function load(k){
      try { return JSON.parse(localStorage.getItem(k) || "[]"); } catch(e){ return []; }
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
      listComments: function(chapter){
        var all = load(KEY_CM).filter(function(c){ return c.chapter === chapter; });
        var by = {};
        all.sort(function(a, b){ return a.at - b.at; }).forEach(function(c){
          (by[c.pid] = by[c.pid] || []).push(c);
        });
        return Promise.resolve(by);
      },
      addComment: function(c){
        var all = load(KEY_CM);
        c.at = Date.now();
        c.id = String(c.at) + Math.random().toString(36).slice(2, 7);
        all.push(c);
        save(KEY_CM, all);
        return Promise.resolve(c);
      }
    };
  })();

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
      });
    });

    if (again) again.addEventListener("click", function(){
      thanks.hidden = true;
      form.hidden = false;
      name.focus();
    });

    Store.listReviews().then(render);
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

    /* ---- комментарии к абзацам ---- */
    (function(){
      var EMOJI = ["😮","😨","💔","🔥","😢","🤔","😍","😡"];
      var MAX = 100;
      var paras = text.querySelectorAll("p[data-p]");
      if (!paras.length) return;
      var open = null;

      Store.listComments(chapter).then(function(by){
        for (var i = 0; i < paras.length; i++) mark(paras[i], by[paras[i].dataset.p] || []);
      });

      function mark(p, items){
        var b = p.querySelector(".pmark");
        if (!b){
          b = document.createElement("button");
          b.type = "button";
          b.className = "pmark";
          b.setAttribute("aria-expanded", "false");
          b.addEventListener("click", function(){ toggle(p, b); });
          p.appendChild(b);
        }
        if (items.length){
          b.classList.add("has");
          b.innerHTML = '<span aria-hidden="true">' + items[items.length - 1].emoji + "</span>" + items.length;
          b.setAttribute("aria-label", "Комментарии к абзацу: " + items.length);
        } else {
          b.classList.remove("has");
          b.textContent = "+";
          b.setAttribute("aria-label", "Написать об этом абзаце");
        }
      }

      function close(){
        if (!open) return;
        open.panel.remove();
        open.btn.setAttribute("aria-expanded", "false");
        open = null;
      }

      function toggle(p, btn){
        if (open && open.p === p){ close(); return; }
        close();
        var pid = p.dataset.p;
        var panel = document.createElement("div");
        panel.className = "cpanel";
        panel.innerHTML =
          '<p class="kicker">Об этом абзаце</p>'
          + '<ul class="clist"></ul>'
          + '<form class="cform" novalidate>'
          +   '<div class="field"><label>Что вы чувствуете</label>'
          +     '<div class="emoji" role="group" aria-label="Эмоция">'
          +       EMOJI.map(function(x){
                    return '<button type="button" aria-pressed="false" aria-label="' + x + '">' + x + "</button>";
                  }).join("")
          +     "</div>"
          +     '<p class="err-msg" hidden></p>'
          +   "</div>"
          +   '<div class="field"><label>Имя</label>'
          +     '<input type="text" maxlength="40" autocomplete="name" placeholder="Имя или ник"></div>'
          +   '<div class="field"><label>Что вы думаете</label>'
          +     '<textarea rows="2" maxlength="' + MAX + '" placeholder="Коротко — не больше ста символов."></textarea>'
          +     '<p class="counter"><span>0</span> из ' + MAX + "</p></div>"
          +   '<div class="row"><button class="btn btn-fill" type="submit">Отправить</button>'
          +     '<button class="btn btn-quiet" type="button" data-close>Отмена</button></div>'
          + "</form>";
        p.insertAdjacentElement("afterend", panel);
        btn.setAttribute("aria-expanded", "true");
        open = {p: p, btn: btn, panel: panel};

        var list = panel.querySelector(".clist");
        var form = panel.querySelector("form");
        var input = panel.querySelector("input");
        var area = panel.querySelector("textarea");
        var counter = panel.querySelector(".counter span");
        var emoErr = panel.querySelector(".field .err-msg");
        var picked = "";

        Store.listComments(chapter).then(function(by){ draw(by[pid] || []); });
        function draw(items){
          list.innerHTML = items.map(function(c){
            return '<li><span class="c-emo" aria-hidden="true">' + c.emoji + "</span>"
                 + '<span class="c-who">' + esc(c.name) + " · " + when(c.at) + "</span>"
                 + '<p class="c-text">' + esc(c.text) + "</p></li>";
          }).join("");
          mark(p, items);
        }

        panel.querySelectorAll(".emoji button").forEach(function(b){
          b.addEventListener("click", function(){
            picked = b.textContent;
            panel.querySelectorAll(".emoji button").forEach(function(o){
              o.setAttribute("aria-pressed", o === b ? "true" : "false");
            });
            emoErr.hidden = true;
          });
        });
        area.addEventListener("input", function(){
          counter.textContent = area.value.trim().length;
        });
        panel.querySelector("[data-close]").addEventListener("click", close);

        form.addEventListener("submit", function(ev){
          ev.preventDefault();
          var nm = clean(input.value), tx = clean(area.value);
          if (!picked){
            emoErr.textContent = "Выберите эмоцию.";
            emoErr.hidden = false;
            return;
          }
          if (nm.length < 2){ input.setAttribute("aria-invalid", "true"); input.focus(); return; }
          input.removeAttribute("aria-invalid");
          if (!tx.length || tx.length > MAX || looksLikeSpam(tx)){
            area.setAttribute("aria-invalid", "true"); area.focus(); return;
          }
          area.removeAttribute("aria-invalid");
          if (Store.tooFast()){
            emoErr.textContent = "Слишком часто. Подождите немного.";
            emoErr.hidden = false;
            return;
          }
          Store.addComment({chapter: chapter, pid: pid, name: nm, emoji: picked, text: tx})
            .then(function(){
              form.reset();
              counter.textContent = "0";
              picked = "";
              panel.querySelectorAll(".emoji button").forEach(function(o){ o.setAttribute("aria-pressed","false"); });
              var ok = document.createElement("p");
              ok.className = "cthanks";
              ok.setAttribute("role", "status");
              ok.textContent = "Спасибо, записано.";
              form.appendChild(ok);
              setTimeout(function(){ ok.remove(); }, 4000);
              return Store.listComments(chapter).then(function(by){ draw(by[pid] || []); });
            });
        });

        input.focus({preventScroll: true});
      }

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
