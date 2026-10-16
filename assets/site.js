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
