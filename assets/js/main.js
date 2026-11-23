/* 이샛별 · motion layer. Every module is guarded so one failure never blanks the page. */
(function () {
  'use strict';

  var $ = function (s, r) { return (r || document).querySelector(s); };
  var $$ = function (s, r) { return Array.prototype.slice.call((r || document).querySelectorAll(s)); };
  var clamp = function (v, a, b) { return Math.min(b, Math.max(a, v)); };
  var lerp = function (a, b, t) { return a + (b - a) * t; };
  var smooth = function (t) { return t * t * (3 - 2 * t); };
  var reduced = window.matchMedia && matchMedia('(prefers-reduced-motion: reduce)').matches;
  var finePointer = window.matchMedia && matchMedia('(hover: hover) and (pointer: fine)').matches;
  var isArtifact = !!window.__ARTIFACT__;
  var hasGsap = !!(window.gsap && window.ScrollTrigger);
  var mobileQ = window.matchMedia('(max-width: 900px)');
  var safe = function (name, fn) { try { fn(); } catch (e) { console.warn('[' + name + ']', e); } };
  var root = document.documentElement;
  root.classList.add('js');

  if (hasGsap) {
    var plugins = [ScrollTrigger];
    if (window.SplitText) plugins.push(SplitText);
    if (window.ScrambleTextPlugin) plugins.push(ScrambleTextPlugin);
    gsap.registerPlugin.apply(gsap, plugins);
    gsap.config({ nullTargetWarn: false });
  }
  // A reload starts at CUE 01, not where the visitor left off. ScrollTrigger snapshots history.scrollRestoration when it
  // starts and writes that snapshot back after every refresh, so 'manual' must go through its API or the next refresh
  // quietly restores 'auto' and the browser jumps back to the old offset after load.
  try { if ('scrollRestoration' in history) history.scrollRestoration = 'manual'; } catch (e) {}
  if (hasGsap) ScrollTrigger.clearScrollMemory('manual');

  /* ---------- per-frame work, only for things on screen ---------- */
  var ticks = [];
  var onTick = function (fn) { ticks.push(fn); };
  var visible = function (el, cb, margin) {
    if (!el || !window.IntersectionObserver) { cb(true); return; }
    new IntersectionObserver(function (es) { es.forEach(function (e) { cb(e.isIntersecting); }); }, { rootMargin: margin || '120px' }).observe(el);
  };
  var loop = function (now) {
    for (var i = 0; i < ticks.length; i++) { try { ticks[i](now); } catch (e) { console.warn(e); ticks.splice(i--, 1); } }
  };
  if (hasGsap) gsap.ticker.add(function () { loop(performance.now()); });
  else (function raf(now) { loop(now); requestAnimationFrame(raf); })(performance.now());

  /* batch reveals: whatever was scrolled past shows at once; what is on screen staggers, capped so a long jump never queues */
  var revealBatch = function (els, from, end, opts) {
    var past = [], now = [];
    els.forEach(function (el) { (el.getBoundingClientRect().bottom < 0 ? past : now).push(el); });
    if (past.length) gsap.set(past, Object.assign({ overwrite: true }, end));
    if (now.length) gsap.fromTo(now, from, Object.assign({ overwrite: true, stagger: { amount: Math.min(.6, (now.length - 1) * .07) } }, end, opts));
  };
  // The hidden state goes on when the batch is set up. Put on only at the trigger line, an element first showed as it is
  // below that line, then blinked out and rose again. clamp() keeps a start that lies past the end of the page reachable,
  // so nothing hidden here can stay hidden.
  var batchReveal = function (targets, start, from, end, opts) {
    var els = typeof targets === 'string' ? $$(targets) : targets;
    if (!els.length) return;
    gsap.set(els, from);
    ScrollTrigger.batch(els, { start: 'clamp(' + start + ')', once: true, onEnter: function (b) { revealBatch(b, from, end, opts); } });
  };

  /* ---------- smooth scroll ---------- */
  var lenis = null;
  safe('lenis', function () {
    if (reduced || !window.Lenis || !hasGsap) return;
    lenis = new Lenis({ lerp: .09, smoothWheel: true, wheelMultiplier: 1, touchMultiplier: 1.3 });
    lenis.on('scroll', ScrollTrigger.update);
    gsap.ticker.add(function (t) { lenis.raf(t * 1000); });
    gsap.ticker.lagSmoothing(0);
  });
  var velocity = function () { return lenis ? lenis.velocity : 0; };

  var scrollToEl = function (el) {
    if (!el) return;
    if (lenis) lenis.scrollTo(el, { offset: el.id === 'top' ? 0 : -8, duration: 1.6, easing: function (t) { return 1 - Math.pow(1 - t, 4); } });
    else el.scrollIntoView({ behavior: reduced ? 'auto' : 'smooth' });
  };

  // Overlays (menu, video) hold the page behind them still. Lenis does that while it runs. Under reduced motion it is
  // off, so the document itself is locked instead; until now the page behind kept scrolling.
  var lockScroll = function (on) {
    if (lenis) { if (on) lenis.stop(); else lenis.start(); }
    root.classList.toggle('is-locked', on && !lenis);
  };
  // Keep Tab inside an open overlay: past the last item it wraps to the first, and Shift+Tab wraps back.
  var trapTab = function (e, items) {
    items = items.filter(function (el) { return el.getClientRects().length; });
    if (!items.length) return;
    var at = items.indexOf(document.activeElement), last = items.length - 1;
    if (e.shiftKey && at <= 0) { e.preventDefault(); items[last].focus(); }
    else if (!e.shiftKey && (at === -1 || at === last)) { e.preventDefault(); items[0].focus(); }
  };

  /* ---------- Voice ticks (audio level → sky, mini eq, chart) ---------- */
  var Voice = window.Voice, Sky = window.Sky || {};
  onTick(function (now) {
    if (Voice) {
      Voice.update();
      Sky.audio = Voice.level;
      Voice.chart && Voice.chart.draw(now);
      Voice.player && Voice.player.draw(now);
      Voice.mini && Voice.mini.draw(now);
    }
  });
  safe('chart-visibility', function () {
    visible($('#voice .voice__stage'), function (v) { if (Voice && Voice.chart) Voice.chart.visible = v; });
  });

  /* ---------- sky palette follows the run of show ---------- */
  var skyEls = [], navLight = false;
  safe('sky', function () {
    skyEls = $$('[data-sky]').map(function (el) { return { el: el, i: +el.getAttribute('data-sky'), top: 0 }; });
    var measure = function () { skyEls.forEach(function (s) { s.top = s.el.getBoundingClientRect().top + window.scrollY; }); };
    measure();
    window.addEventListener('load', measure);
    window.addEventListener('resize', measure);
    if (hasGsap) ScrollTrigger.addEventListener('refresh', measure);
    var nav = $('#nav'), cues = $('.cues'), cursor = $('.cursor');
    onTick(function () {
      var vh = window.innerHeight, y = window.scrollY + vh * .5, k = 0;
      for (var s = 0; s < skyEls.length; s++) if (skyEls[s].top <= y) k = s;
      var cur = skyEls[k], nxt = skyEls[k + 1], t = 0;
      if (nxt) t = clamp((y - (nxt.top - vh * .6)) / (vh * .6), 0, 1);
      if (Sky.blend) Sky.blend(cur.i, nxt ? nxt.i : cur.i, smooth(t));
      // nav colour follows the section under it
      var yt = window.scrollY + 70, kt = 0;
      for (var q = 0; q < skyEls.length; q++) if (skyEls[q].top <= yt) kt = q;
      var light = skyEls[kt].i >= 9;
      if (light !== navLight) {
        navLight = light;
        nav && nav.classList.toggle('is-light', light);
        cues && cues.classList.toggle('is-light', light);
        cursor && cursor.classList.toggle('is-light', light);
      }
    });
  });

  /* ---------- nav, menu, anchors ---------- */
  safe('nav', function () {
    var nav = $('#nav'), lastY = window.scrollY, menuBtn = $('.nav__menu'), menu = $('#menu');
    var links = $$('.nav__links a');
    // mirrored on <html> so the sticky bars below the header (stage switcher, audience, reviews heading) move up into
    // its place instead of leaving a header-high gap above them while it is slid away
    var hidden = false;
    var setHidden = function (on) {
      if (on === hidden) return;
      hidden = on;
      nav.classList.toggle('is-hidden', on);
      root.classList.toggle('nav-hidden', on);
    };
    onTick(function () {
      var y = window.scrollY;
      nav.classList.toggle('is-solid', y > 60);
      if (!menu || menu.hidden) {
        // a header that holds keyboard focus stays down, or Tab would walk through links slid off screen
        if (y > lastY + 4 && y > 500 && !nav.contains(document.activeElement)) setHidden(true);
        else if (y < lastY - 4 || y < 200) setHidden(false);
      }
      lastY = y;
    });
    nav.addEventListener('focusin', function () { setHidden(false); });
    // `isOpen` is the menu's one state. `menu.hidden` only flips when the close tween ends, so judging by it let a
    // click during the close start another close; that tween's onComplete then hid a menu that had been reopened,
    // leaving the X button over a hidden menu and the page locked.
    var isOpen = false;
    var setMenu = function (open) {
      if (open === isOpen) return;
      isOpen = open;
      menuBtn.setAttribute('aria-expanded', String(open));
      menuBtn.setAttribute('aria-label', open ? '메뉴 닫기' : '메뉴 열기');
      if (hasGsap) gsap.killTweensOf(menu);
      if (open) {
        menu.hidden = false;
        lockScroll(true);
        if (hasGsap && !reduced) {
          gsap.fromTo(menu, { clipPath: 'circle(0px at calc(100% - 44px) 34px)' }, { clipPath: 'circle(150% at calc(100% - 44px) 34px)', duration: .9, ease: 'expo.out' });
          gsap.fromTo($$('.menu__links a'), { y: 40, opacity: 0 }, { y: 0, opacity: 1, stagger: .05, duration: .8, ease: 'expo.out', delay: .1, overwrite: true });
        } else menu.style.clipPath = 'none';
      } else {
        lockScroll(false);
        if (hasGsap && !reduced) gsap.to(menu, { clipPath: 'circle(0px at calc(100% - 44px) 34px)', duration: .6, ease: 'expo.inOut', onComplete: function () { if (!isOpen) menu.hidden = true; } });
        else menu.hidden = true;
      }
    };
    menuBtn && menuBtn.addEventListener('click', function () { setMenu(!isOpen); });
    document.addEventListener('keydown', function (e) {
      if (!isOpen) return;
      // Esc hands focus back to the button that opened the menu instead of dropping it on <body>
      if (e.key === 'Escape') { setMenu(false); menuBtn.focus(); }
      else if (e.key === 'Tab') trapTab(e, [menuBtn].concat($$('a, button', menu)));
    });
    document.addEventListener('click', function (e) {
      var a = e.target.closest('a[href^="#"]');
      if (!a) return;
      var id = a.getAttribute('href');
      if (id.length < 2) return;
      var el = document.getElementById(id.slice(1));
      if (!el) return;
      e.preventDefault();
      if (isOpen) setMenu(false);
      scrollToEl(el);
    });
    // active link
    var map = {};
    links.forEach(function (a) { map[a.getAttribute('href').slice(1)] = a; });
    if (hasGsap) Object.keys(map).forEach(function (id) {
      var sec = document.getElementById(id);
      if (!sec) return;
      ScrollTrigger.create({ trigger: sec, start: 'top 50%', end: 'bottom 50%', onToggle: function (st) { map[id].classList.toggle('is-active', st.isActive); } });
    });
  });

  /* ---------- cue sheet rail ---------- */
  safe('cues', function () {
    var items = $$('.cues li'), meter = $('.cues__meter i');
    items.forEach(function (li) {
      var target = document.getElementById(li.getAttribute('data-target'));
      li.addEventListener('click', function () { scrollToEl(target); });
      if (hasGsap && target) ScrollTrigger.create({
        trigger: target, start: 'top 50%', end: 'bottom 50%',
        onToggle: function (st) { if (st.isActive) { items.forEach(function (x) { x.classList.remove('is-active'); }); li.classList.add('is-active'); } }
      });
    });
    onTick(function () {
      var max = document.documentElement.scrollHeight - window.innerHeight;
      if (meter) meter.style.transform = 'scaleY(' + (max > 0 ? window.scrollY / max : 0).toFixed(4) + ')';
    });
  });

  /* ---------- stage switcher (the four stages) ---------- */
  safe('stages', function () {
    if (!hasGsap) return;
    var nav = $('.stages__nav'), bar = $('.stages__bar'), links = $$('.stages__nav a'), current = null;
    var move = function (a) {
      current = a;
      if (!a) { bar.style.width = '0px'; return; }
      bar.style.width = a.offsetWidth + 'px';
      bar.style.transform = 'translateX(' + a.offsetLeft + 'px)';
      links.forEach(function (x) { x.classList.toggle('is-active', x === a); });
      var sl = a.offsetLeft - (nav.clientWidth - a.offsetWidth) / 2;
      if (nav.scrollWidth > nav.clientWidth) nav.scrollTo({ left: sl, behavior: 'smooth' });
    };
    links.forEach(function (a) {
      var sec = document.getElementById(a.getAttribute('href').slice(1));
      ScrollTrigger.create({ trigger: sec, start: 'top 55%', end: 'bottom 55%', onToggle: function (st) { if (st.isActive) move(a); } });
    });
    ScrollTrigger.create({ trigger: '#stages', start: 'top 55%', end: 'bottom 55%', onLeave: function () { move(null); links.forEach(function (x) { x.classList.remove('is-active'); }); }, onLeaveBack: function () { move(null); links.forEach(function (x) { x.classList.remove('is-active'); }); } });
    // The bar holds pixel sizes from the last stage change. Re-measure after a resize or rotation within one stage;
    // until now it stayed off the active link.
    ScrollTrigger.addEventListener('refresh', function () { move(current); });
  });

  /* ---------- hero ---------- */
  var heroIn = null;
  safe('hero', function () {
    var hero = $('#top');
    if (hasGsap && !reduced) {
      var nameKo = $('.hero__ko'), name = nameKo.textContent;
      nameKo.textContent = '';
      // The letters are separate inline-blocks for the entrance. Screen readers get the name once, whole; they used to
      // spell it out letter by letter.
      var letters = name.split('').map(function (c) { var s = document.createElement('span'); s.textContent = c; s.style.display = 'inline-block'; s.setAttribute('aria-hidden', 'true'); nameKo.appendChild(s); return s; });
      var whole = document.createElement('span'); whole.className = 'sr-only'; whole.textContent = name; nameKo.appendChild(whole);
      heroIn = gsap.timeline({ paused: true, defaults: { ease: 'expo.out' } });
      heroIn
        .from('.hero__title .ln__in', { yPercent: 118, rotate: 2, duration: 1.5, stagger: .13 }, 0)
        .from('.hero__img', { yPercent: 10, scale: 1.1, opacity: 0, duration: 2, ease: 'power3.out' }, 0)
        .from('.hero__glow', { scale: .3, opacity: 0, duration: 2.4 }, .1)
        .from(letters, { opacity: 0, y: 26, filter: 'blur(14px)', stagger: .09, duration: 1.2 }, .35)
        .from('.hero__en', { opacity: 0, x: -20, duration: 1.2 }, .55)
        .from('.hero__lead', { opacity: 0, y: 24, duration: 1.3 }, .55)
        .from('.hero__cta > *', { opacity: 0, y: 22, stagger: .08, duration: 1.1 }, .65)
        .from('.hero__copy .eyebrow', { opacity: 0, duration: .6 }, .1)
        .from('.hero__foot', { opacity: 0, y: 10, duration: 1 }, .9)
        .from('.nav', { opacity: 0, duration: 1.2 }, .3);
      // leave: copy rises, figure sinks back, the stage lights dim
      gsap.to('.hero__copy', { yPercent: -16, opacity: .15, ease: 'none', scrollTrigger: { trigger: hero, start: 'top top', end: 'bottom top', scrub: true } });
      gsap.to('.hero__fig', { yPercent: 9, scale: .94, ease: 'none', scrollTrigger: { trigger: hero, start: 'top top', end: 'bottom top', scrub: true } });
      if (finePointer) {
        var fx = gsap.quickTo('.hero__fig', 'x', { duration: 1.2, ease: 'power3' });
        var cx = gsap.quickTo('.hero__copy', 'x', { duration: 1.4, ease: 'power3' });
        window.addEventListener('pointermove', function (e) {
          var nx = e.clientX / window.innerWidth - .5;
          fx(-nx * 26); cx(nx * 10);
        }, { passive: true });
      }
    }
    // the hero waveform: three voices of light, live audio drives the lead line
    var cv = $('.hero__wave'), g = cv.getContext('2d'), W = 0, H = 0, dpr = 1, on = true;
    var mx = .5, energy = 0, lastX = 0;
    var size = function () { var r = cv.getBoundingClientRect(); dpr = Math.min(devicePixelRatio || 1, 2); W = r.width; H = r.height; cv.width = W * dpr; cv.height = H * dpr; };
    size(); window.addEventListener('resize', size);
    visible(hero, function (v) { on = v; });
    window.addEventListener('pointermove', function (e) {
      if (reduced) return;
      mx = e.clientX / window.innerWidth;
      energy = Math.min(1.4, energy + Math.abs(e.clientX - lastX) / 260);
      lastX = e.clientX;
    }, { passive: true });
    var lines = [
      { c: 'rgba(255,226,166,.95)', a: 1, f: 1, w: 1.7 },
      { c: 'rgba(255,159,176,.6)', a: .72, f: 1.55, w: 1.1 },
      { c: 'rgba(246,239,228,.32)', a: .48, f: 2.3, w: 1 }
    ];
    onTick(function (now) {
      if (!on) return;
      // reduced motion: the line holds still (time stops); it still answers a voice the visitor plays
      var t = reduced ? 0 : now / 1000, td = Voice && Voice.timeData(), lvl = Voice ? Voice.level : 0;
      energy *= .965;
      g.setTransform(dpr, 0, 0, dpr, 0, 0);
      g.clearRect(0, 0, W, H);
      var idle = .16 + .07 * Math.sin(t * .7);
      for (var L = 0; L < lines.length; L++) {
        var ln = lines[L];
        g.beginPath();
        for (var x = 0; x <= W; x += 3) {
          var u = x / W, env = Math.pow(Math.sin(Math.PI * u), 1.3);
          var base = Math.sin(u * 13 * ln.f + t * 1.6 * ln.f) * .5 + Math.sin(u * 31 * ln.f - t * 2.2) * .3 + Math.sin(u * 6.5 + t * .8) * .2;
          var bump = Math.exp(-Math.pow(u - mx, 2) / .012) * energy;
          var aud = 0;
          if (td) aud = (td[Math.floor(u * (td.length - 1))] - 128) / 128 * (L === 0 ? 2.6 : 1.4);
          var y = H / 2 + (base * (idle + bump * .7 + lvl * .4) + aud) * H * .4 * env * ln.a;
          if (x === 0) g.moveTo(x, y); else g.lineTo(x, y);
        }
        g.strokeStyle = ln.c; g.lineWidth = ln.w; g.stroke();
      }
    });
  });

  /* ---------- intro: voice → waveform → name → stars ---------- */
  safe('intro', function () {
    var intro = $('#intro'), finished = false;
    // Runs once. If the 8s fallback ends the intro while a background tab has paused its frames, the frame loop would
    // wake up later and run reveal() and finish() (refresh, lenis start) a second time.
    var finish = function () {
      if (finished) return;
      finished = true;
      if (intro && intro.parentNode) intro.parentNode.removeChild(intro);
      root.classList.remove('is-intro');
      lenis && lenis.start();
      if (heroIn) heroIn.play(0);
      if (hasGsap) ScrollTrigger.refresh();
    };
    // plays on every load (skip with the button, a click or any key); headless capture and reduced motion skip it
    if (!intro || reduced || !hasGsap || navigator.webdriver) { finish(); return; }
    root.classList.add('is-intro');
    lenis && lenis.stop();
    window.scrollTo(0, 0);
    setTimeout(function () { if (intro.parentNode) { heroIn && heroIn.play(0); heroIn = null; finish(); } }, 8000);

    var cv = intro.querySelector('canvas'), g = cv.getContext('2d');
    var dpr = Math.min(devicePixelRatio || 1, 2), W = window.innerWidth, H = window.innerHeight;
    cv.width = W * dpr; cv.height = H * dpr; g.scale(dpr, dpr);
    var N = W < 700 ? 1500 : 3200, cx = W / 2, cy = H * .46;
    var px = new Float32Array(N), py = new Float32Array(N), vx = new Float32Array(N), vy = new Float32Array(N);
    var tx = new Float32Array(N), ty = new Float32Array(N), rho = new Float32Array(N), col = new Uint8Array(N);
    for (var i = 0; i < N; i++) {
      px[i] = cx + (Math.random() - .5) * 4; py[i] = cy + (Math.random() - .5) * 4;
      rho[i] = Math.random() * 2 - 1; col[i] = Math.random() < .62 ? 0 : (Math.random() < .6 ? 1 : 2);
    }
    var textPts = null;
    var sample = function () {
      var oc = document.createElement('canvas'), og = oc.getContext('2d');
      oc.width = W; oc.height = H;
      var fs = Math.min(W * .27, H * .3, 300);
      og.fillStyle = '#fff'; og.textAlign = 'center'; og.textBaseline = 'middle';
      og.font = '700 ' + fs + 'px "Pretendard Variable", Pretendard, "Apple SD Gothic Neo", sans-serif';
      og.fillText('이샛별', cx, cy);
      var d = og.getImageData(0, 0, W, H).data, pts = [], step = W < 700 ? 2 : 3;
      for (var y = 0; y < H; y += step) for (var x = 0; x < W; x += step) if (d[(y * W + x) * 4 + 3] > 140) pts.push(x, y);
      // shuffle point pairs
      for (var k = pts.length / 2 - 1; k > 0; k--) {
        var j = Math.floor(Math.random() * (k + 1)), a = pts[k * 2], b = pts[k * 2 + 1];
        pts[k * 2] = pts[j * 2]; pts[k * 2 + 1] = pts[j * 2 + 1]; pts[j * 2] = a; pts[j * 2 + 1] = b;
      }
      textPts = pts.length ? pts : null;
    };
    var fontWait = document.fonts && document.fonts.load ? Promise.race([document.fonts.load('700 120px "Pretendard Variable"', '이샛별'), new Promise(function (r) { setTimeout(r, 1300); })]) : Promise.resolve();
    fontWait.then(sample, sample);

    var status = intro.querySelector('.intro__status'), line = intro.querySelector('.intro__line'), sub = intro.querySelector('.intro__sub');
    var t0 = performance.now(), phase = 0, done = false, burstAt = 3.15, raf = 0, live = false;
    var colors = ['rgba(255,226,166,.9)', 'rgba(246,239,228,.85)', 'rgba(255,159,176,.85)'];
    var skip = function () { if (!done && (performance.now() - t0) / 1000 < burstAt) burstAt = (performance.now() - t0) / 1000; };
    intro.querySelector('.intro__skip').addEventListener('click', skip);
    intro.addEventListener('pointerdown', function (e) { if (!e.target.closest('.intro__skip')) skip(); });
    window.addEventListener('keydown', skip, { once: true });

    var reveal = function () {
      var o = { r: 0 };
      gsap.to(o, {
        r: Math.hypot(W, H) * .75, duration: 1.1, ease: 'power3.inOut',
        onStart: function () { if (heroIn) heroIn.play(0); },
        onUpdate: function () {
          var m = 'radial-gradient(circle at 50% 46%, transparent ' + o.r + 'px, #000 ' + (o.r + 2) + 'px)';
          intro.style.webkitMaskImage = m; intro.style.maskImage = m;
        },
        onComplete: function () { cancelAnimationFrame(raf); heroIn = null; finish(); }
      });
    };

    var frame = function (now) {
      if (finished) return;
      raf = requestAnimationFrame(frame);
      var t = (now - t0) / 1000;
      g.globalCompositeOperation = 'source-over';
      g.fillStyle = 'rgba(4,6,26,.26)';
      g.fillRect(0, 0, W, H);
      var ph = t < .45 ? 0 : t < 1.7 ? 1 : t < burstAt ? 2 : 3;
      if (ph !== phase) {
        phase = ph;
        if (ph === 1 && status) status.textContent = 'VOICE CHECK';
        if (ph === 2) {
          if (!live) { live = true; intro.classList.add('is-live'); status.textContent = 'ON AIR'; }
          gsap.to(line, { opacity: 0, y: -10, duration: .5 });
          gsap.to(sub, { opacity: 1, duration: .8, delay: .4 });
        }
        if (ph === 3) {
          if (!live) { live = true; intro.classList.add('is-live'); }
          for (var b = 0; b < N; b++) {
            var ang = Math.atan2(py[b] - cy, px[b] - cx) + (Math.random() - .5) * .6, sp = 4 + Math.random() * 16;
            vx[b] = Math.cos(ang) * sp; vy[b] = Math.sin(ang) * sp;
          }
          gsap.to([line, sub, intro.querySelector('.intro__top'), intro.querySelector('.intro__lamp'), intro.querySelector('.intro__skip')], { opacity: 0, duration: .4 });
          setTimeout(reveal, 220);
        }
      }
      // syllable envelope makes the line feel like speech, not a sine
      var syl = Math.abs(Math.sin(t * 7.1)) * .6 + Math.abs(Math.sin(t * 2.9 + 1.3)) * .4;
      for (var p = 0; p < N; p++) {
        if (phase === 0) {
          tx[p] = cx + Math.cos(p) * 3; ty[p] = cy + Math.sin(p * 1.7) * 3;
        } else if (phase === 1) {
          var u = p / N, env = Math.pow(Math.sin(Math.PI * u), 1.4);
          var w = Math.sin(u * 40 + t * 9) * .55 + Math.sin(u * 93 - t * 13) * .3 + Math.sin(u * 11 + t * 3) * .15;
          tx[p] = cx + (u - .5) * W * .8;
          ty[p] = cy + rho[p] * Math.abs(w) * env * H * .16 * (.35 + syl);
        } else if (phase === 2 && textPts) {
          var m = (p % (textPts.length / 2)) * 2;
          tx[p] = textPts[m] + Math.sin(t * 3 + p) * .6; ty[p] = textPts[m + 1] + Math.cos(t * 2.6 + p) * .6;
        }
        if (phase < 3) {
          var k = phase === 2 ? .085 : .12;
          vx[p] = (vx[p] + (tx[p] - px[p]) * k) * .72;
          vy[p] = (vy[p] + (ty[p] - py[p]) * k) * .72;
        } else { vx[p] *= .97; vy[p] *= .97; }
        px[p] += vx[p]; py[p] += vy[p];
      }
      g.globalCompositeOperation = 'lighter';
      var fade = phase === 3 ? Math.max(0, 1 - (t - burstAt) * 1.4) : 1;
      for (var c = 0; c < 3; c++) {
        g.fillStyle = colors[c];
        g.globalAlpha = fade;
        var ps = phase === 2 ? 1.9 : 1.6;
        for (var q = 0; q < N; q++) if (col[q] === c) g.fillRect(px[q], py[q], ps, ps);
      }
      g.globalAlpha = 1;
      if (phase === 0) {
        var r = 14 + Math.sin(t * 9) * 4, gr = g.createRadialGradient(cx, cy, 0, cx, cy, r * 4);
        gr.addColorStop(0, 'rgba(255,240,210,.9)'); gr.addColorStop(1, 'rgba(255,226,166,0)');
        g.fillStyle = gr; g.beginPath(); g.arc(cx, cy, r * 4, 0, Math.PI * 2); g.fill();
      }
    };
    raf = requestAnimationFrame(frame);
  });

  /* ---------- marquees react to scroll velocity ---------- */
  safe('marquee', function () {
    $$('.marquee__row').forEach(function (row) {
      var track = row.querySelector('.marquee__track');
      var dir = +row.getAttribute('data-dir') || 1, base = row.classList.contains('marquee__row--sub') ? .45 : .8, x = 0, on = true, sk = 0, w = 800;
      // keep x in (-w, 0] whatever the step size; a single `if` let a fast scroll carry it out of range
      var wrap = function (v) { return ((v % w) - w) % w; };
      // the track width follows vw-based font sizes and web fonts, so measure again instead of trusting the first read
      var measure = function () {
        w = track.offsetWidth || w;
        var need = Math.ceil(window.innerWidth * 2 / w) + 1;
        for (var i = row.children.length - 1; i < need; i++) row.appendChild(track.cloneNode(true));
        x = wrap(x);
      };
      measure();
      var queued = false;
      window.addEventListener('resize', function () {
        if (queued) return;
        queued = true;
        requestAnimationFrame(function () { queued = false; measure(); });
      });
      if (document.fonts && document.fonts.ready) document.fonts.ready.then(measure);
      // watch the static .marquee box, not the row: the row is the thing being translated, and once it slid a
      // viewport-width left its own box sat wholly inside the parent's overflow clip, read as hidden, and froze for good
      visible(row.parentNode, function (v) { on = v; });
      if (reduced) return;
      onTick(function () {
        if (!on) return;
        var v = clamp(velocity(), -60, 60);
        x = wrap(x - (base + Math.abs(v) * .12) * dir * (v < -0.5 ? -1 : 1));
        sk = lerp(sk, clamp(-v * .35, -9, 9), .12);
        row.style.transform = 'translate3d(' + x.toFixed(2) + 'px,0,0) skewX(' + sk.toFixed(2) + 'deg)';
      });
    });
  });

  /* ---------- generic reveals ---------- */
  safe('reveals', function () {
    if (!hasGsap || reduced) return;
    // headings: masked line reveal
    $$('.split').forEach(function (el) {
      if (!window.SplitText) return;
      SplitText.create(el, {
        type: 'lines', mask: 'lines', autoSplit: true,
        onSplit: function (self) {
          return gsap.from(self.lines, { yPercent: 115, duration: 1.3, ease: 'expo.out', stagger: .12, scrollTrigger: { trigger: el, start: 'top 86%', once: true } });
        }
      });
    });
    // eyebrows scramble in
    $$('[data-scramble]').forEach(function (el) {
      var txt = el.textContent;
      ScrollTrigger.create({
        trigger: el, start: 'top 92%', once: true,
        onEnter: function () {
          if (window.ScrambleTextPlugin) gsap.to(el, { duration: 1.3, scrambleText: { text: txt, chars: 'ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789✦·', speed: .7, revealDelay: .25 } });
        }
      });
    });
    // photos: curtain-up clip + slow zoom out, plus depth parallax
    $$('.pic').forEach(function (pic) {
      var img = pic.querySelector('img');
      gsap.fromTo(pic, { clipPath: 'inset(100% 0% 0% 0% round 18px)' }, { clipPath: 'inset(0% 0% 0% 0% round 18px)', duration: 1.5, ease: 'expo.inOut', scrollTrigger: { trigger: pic, start: 'top 90%', once: true } });
      gsap.fromTo(img, { scale: 1.35 }, { scale: 1, duration: 2.2, ease: 'expo.out', scrollTrigger: { trigger: pic, start: 'top 90%', once: true } });
      var sp = parseFloat(pic.getAttribute('data-speed') || '1');
      if (sp !== 1) {
        // read the breakpoint on every refresh: a value fixed at load kept the phone-sized travel after rotating to
        // landscape, and the reveal triggers on the same .pic were then measured off that wrong offset
        var amt = function () { return (1 - sp) * (mobileQ.matches ? 80 : 220); };
        gsap.fromTo(pic, { y: function () { return -amt(); } }, { y: amt, ease: 'none', scrollTrigger: { trigger: pic, start: 'top bottom', end: 'bottom top', scrub: true, invalidateOnRefresh: true } });
      }
    });
    // cards and lists
    batchReveal('.strength, .hl, .clients__list li, .reel, .vfeature, .tracks__col, .cv__col, .stat', 'top 90%', { y: 40, opacity: 0 }, { y: 0, opacity: 1 }, { duration: 1.1, ease: 'expo.out' });
    $$('.pull p').forEach(function (p) {
      gsap.fromTo(p, { opacity: 0, y: 30, filter: 'blur(8px)' }, { opacity: 1, y: 0, filter: 'blur(0px)', duration: 1.4, ease: 'expo.out', scrollTrigger: { trigger: p, start: 'top 86%', once: true } });
    });
    gsap.fromTo('.arch', { clipPath: 'inset(100% 0% 0% 0% round 999px 999px 24px 24px)' }, { clipPath: 'inset(0% 0% 0% 0% round 999px 999px 24px 24px)', duration: 1.8, ease: 'expo.inOut', scrollTrigger: { trigger: '.arch', start: 'top 85%', once: true } });
    gsap.fromTo('.arch img', { yPercent: -8 }, { yPercent: 4, ease: 'none', scrollTrigger: { trigger: '.arch', start: 'top bottom', end: 'bottom top', scrub: true } });
    gsap.fromTo('.player', { y: 60, opacity: 0 }, { y: 0, opacity: 1, duration: 1.4, ease: 'expo.out', scrollTrigger: { trigger: '.voice__stage', start: 'top 80%', once: true } });
    gsap.fromTo('.chart', { scale: .7, opacity: 0, rotate: -25 }, { scale: 1, opacity: 1, rotate: 0, duration: 2, ease: 'expo.out', scrollTrigger: { trigger: '.voice__stage', start: 'top 80%', once: true } });
  });

  /* ---------- stats count up ---------- */
  safe('stats', function () {
    if (!hasGsap || reduced) return;
    $$('.stat__n').forEach(function (el) {
      var end = +el.getAttribute('data-count'), plain = el.hasAttribute('data-plain');
      var o = { v: plain ? 1989 : 0 };
      // Start from the first value right away. The card fades in a moment before its number's own trigger, and showed
      // the final figure that then dropped back to the start and counted up again.
      el.textContent = String(o.v);
      ScrollTrigger.create({
        trigger: el, start: 'clamp(top 90%)', once: true,
        onEnter: function () {
          gsap.to(o, { v: end, duration: 2.4, ease: 'power3.out', onUpdate: function () { el.textContent = plain ? String(Math.round(o.v)) : Math.round(o.v).toLocaleString('ko-KR'); } });
        }
      });
    });
  });

  /* ---------- read-along text (the script lights up as if spoken) ---------- */
  var fmtTime = function (sec) { sec = Math.max(0, Math.round(sec || 0)); return String(Math.floor(sec / 60)).padStart(2, '0') + ':' + String(sec % 60).padStart(2, '0'); };
  safe('read', function () {
    $$('[data-read]').forEach(function (el) {
      var words = el.textContent.split(/(\s+)/);
      el.textContent = '';
      var spans = [];
      words.forEach(function (w) {
        if (/^\s+$/.test(w)) { el.appendChild(document.createTextNode(w)); return; }
        var s = document.createElement('span'); s.className = 'w'; s.textContent = w; el.appendChild(s); spans.push(s);
      });
      // longer words and sentence ends take longer to say: weight progress by them
      var cum = [], tot = 0;
      spans.forEach(function (sp) {
        var t = sp.textContent;
        tot += t.length + (/[.!?]$/.test(t) ? 3 : /,$/.test(t) ? 1.5 : 0) + .6;
        cum.push(tot);
      });
      var bar = el.parentNode;
      var tc = bar.querySelector('.read__tc'), total = bar.querySelector('.read__total');
      var last = -2, spoken = (bar.querySelector('.read__total') && window.GREETING && window.GREETING.dur) || 24;
      var show = function (k) {
        if (k === last) return;
        last = k;
        for (var i = 0; i < spans.length; i++) { spans[i].classList.toggle('is-on', i <= k && k < spans.length || k >= spans.length); spans[i].classList.toggle('is-now', i === k); }
      };
      var clock = function (secs, len) {
        if (tc) tc.textContent = fmtTime(secs);
        if (total && len) total.textContent = fmtTime(len);
      };
      el._paint = function (p, secs, len) {
        var target = clamp(p, 0, 1) * tot, k = 0;
        while (k < cum.length && cum[k] <= target) k++;
        show(p >= 1 ? spans.length : k);
        clock(secs, len);
      };
      // recorded word times (el._starts): light exactly the word being spoken
      el._paintAt = function (t, len) {
        var st = el._starts, k = 0;
        while (k + 1 < st.length && st[k + 1] <= t) k++;
        show(k);
        clock(t, len);
      };
      if (!hasGsap || reduced) { spans.forEach(function (s) { s.classList.add('is-on'); }); return; }
      el._paint(0, 0);
      ScrollTrigger.create({
        trigger: el, start: 'top 78%', end: 'bottom 42%', scrub: true,
        onUpdate: function (st) { if (!el._audio) el._paint(st.progress * .999, st.progress * spoken); }
      });
    });
  });

  /* ---------- greeting recording: the button scrolls to CUE 02 and the script follows the voice ---------- */
  safe('greeting', function () {
    var greet = Voice && Voice.byId && Voice.byId.greet, about = $('#about'), read = $('#about [data-read]');
    if (!greet || !read) return;
    var btns = $$('[data-greet]');
    if (greet.words && greet.words.length === read.querySelectorAll('.w').length) read._starts = greet.words;
    document.addEventListener('click', function (e) {
      var b = e.target.closest('[data-greet]');
      if (!b) return;
      e.preventDefault();
      if (Voice.current === greet && Voice.playing) { Voice.pause(); return; }
      if (Voice.current === greet && Voice.audio.ended) { try { Voice.audio.currentTime = 0; } catch (err) {} }
      Voice.play(greet); // start inside the click so autoplay rules allow it
      if (!about.contains(b)) scrollToEl(about);
    });
    Voice.on(function (type, cur) {
      var on = cur === greet;
      // The recording leads the script only while it plays, or once it has played to the end (everything stays lit).
      // Paused or closed, the scroll takes over again; it used to stay frozen at the paused word, because pausing and
      // closing send 'pause', not 'change'.
      read._audio = on && (Voice.playing || !!(Voice.audio && Voice.audio.ended));
      var playing = on && Voice.playing;
      btns.forEach(function (b) { b.classList.toggle('is-playing', playing); b.setAttribute('aria-label', playing ? '인사말 녹음 일시정지' : (b.classList.contains('read__play') ? '인사말 녹음 듣기' : '목소리 듣기')); });
      if (on && type === 'ended' && read._paint) read._paint(1, Voice.audio.duration, Voice.audio.duration);
    });
    onTick(function () {
      if (!read._audio || Voice.current !== greet || !read._paint) return;
      var a = Voice.audio, d = isFinite(a.duration) && a.duration ? a.duration : greet.dur;
      if (a.paused) return;
      if (read._starts) read._paintAt(a.currentTime, d); else read._paint(a.currentTime / d, a.currentTime, d);
    });
  });

  /* ---------- range: the tension fader ---------- */
  safe('range', function () {
    var sec = $('#range');
    if (!sec) return;
    var fader = $('.fader', sec), knob = $('.fader__knob', sec), fill = $('.fader__fill', sec), ticksEl = $$('.fader__ticks span', sec);
    var photos = $$('.range__photos figure', sec), word = $('.range__en', sec);
    var modeEl = $('.range__mode', sec), titleEl = $('.range__title', sec), descEl = $('.range__desc', sec), copy = $('.range__copy', sec);
    var ro = { tone: $('[data-ro="tone"]', sec), energy: $('[data-ro="energy"]', sec), tempo: $('[data-ro="tempo"]', sec) };
    var roN = { tone: $('[data-ro-n="tone"]', sec), energy: $('[data-ro-n="energy"]', sec), tempo: $('[data-ro-n="tempo"]', sec) };
    var MODES = [
      { m: 'MODE 01 · 의전', t: 'VIP 의전 아나운싱', d: '장관과 기업 대표가 함께하는 VIP 투어. 동선과 시간을 지키며 한 마디도 흐트러지지 않는 차분한 진행.', w: 'Elegant', v: '의전' },
      { m: 'MODE 02 · 공식행사', t: '격식 있는 공식행사', d: '내빈 소개부터 폐회 선언까지. 정확한 전달력과 신뢰감으로 행사의 품격을 지킵니다.', w: 'Trusted', v: '공식행사' },
      { m: 'MODE 03 · 팀빌딩', t: '몰입을 이끄는 팀빌딩', d: '목표를 함께 이루도록 판을 깔아 주는 촉진자. 긴장은 풀고 몰입은 높입니다.', w: 'Engaging', v: '팀빌딩' },
      { m: 'MODE 04 · 레크', t: '현장을 뒤집는 레크리에이션', d: '1,200명 앞에서도 흔들리지 않는 에너지. 웃음과 함성으로 현장을 가득 채웁니다.', w: 'Bright!', v: '레크' }
    ];
    var val = 0, target = 0, dragging = false, mode = -1, on = false, drawn = -1;
    var cv = $('.range__wave', sec), g = cv.getContext('2d'), W = 0, H = 0, dpr = 1, tw = 0, track = $('.fader__track', sec);
    // tw: the track's width, the knob's full travel (it starts on the track's left end). The knob moves by transform,
    // compositor only, instead of re-laying out `left` every frame.
    var place = function () { knob.style.transform = 'translateX(' + (val * tw).toFixed(1) + 'px)'; };
    // Re-place the knob here as well, not only in the frame loop: that loop runs only while the section is on screen,
    // so a rotation elsewhere kept the old travel in px, and a knob at 100% then widened a phone's page by 316px.
    var size = function () {
      var r = cv.getBoundingClientRect(); dpr = Math.min(devicePixelRatio || 1, 2); W = r.width; H = r.height; cv.width = W * dpr; cv.height = H * dpr;
      tw = track.clientWidth; drawn = -1; place();
    };
    size(); window.addEventListener('resize', size);
    // and again after each ScrollTrigger refresh. At the resize event the pinned block still carries the width the pin
    // fixed before the rotation (750px on a phone turned upright), and only the refresh resets it.
    if (hasGsap) ScrollTrigger.addEventListener('refresh', size);
    visible(sec, function (v) { on = v; if (!v) Sky.tension = 0; });

    var setMode = function (i) {
      if (i === mode) return;
      var first = mode === -1;
      mode = i;
      photos.forEach(function (f, k) { f.classList.toggle('is-on', k === i); });
      ticksEl.forEach(function (s, k) { s.classList.toggle('is-on', k === i); });
      var M = MODES[i];
      var apply = function () { modeEl.textContent = M.m; titleEl.textContent = M.t; descEl.textContent = M.d; };
      if (first || !hasGsap) apply();
      else gsap.timeline().to(copy, { opacity: 0, y: 10, duration: .18, ease: 'power2.in', onComplete: apply }).to(copy, { opacity: 1, y: 0, duration: .5, ease: 'expo.out' });
      if (hasGsap && window.ScrambleTextPlugin && !first) gsap.to(word, { duration: .6, scrambleText: { text: M.w, chars: 'abcdefghijklmnopqrstuvwxyz', speed: 1 } });
      else word.textContent = M.w;
      fader.setAttribute('aria-valuetext', M.v);
    };
    setMode(0);

    var fromEvent = function (e) {
      var r = $('.fader__track', sec).getBoundingClientRect();
      return clamp((e.clientX - r.left) / r.width, 0, 1);
    };
    // A hand on the fader wins.
    // - It stops the phone demo for good; before, the demo kept writing the value and dragged the knob on to 100%.
    // - On desktop the scroll moves the value on from where the hand left it (`offset`); before, any scroll snapped it
    //   back to the scroll position, even an arrow-key change.
    var touched = false, demoTween = null, offset = 0, prog = 0;
    var takeOver = function () { touched = true; if (demoTween) { demoTween.kill(); demoTween = null; } };
    var keep = function () { offset = target - prog; };
    fader.addEventListener('pointerdown', function (e) {
      takeOver(); dragging = true; target = fromEvent(e);
      // WebKit throws for a pointer it does not track (a synthetic event, for one); the press must still count
      try { fader.setPointerCapture(e.pointerId); } catch (err) {}
    });
    fader.addEventListener('pointermove', function (e) { if (dragging) target = fromEvent(e); });
    var end = function () { if (dragging) { dragging = false; keep(); } };
    fader.addEventListener('pointerup', end);
    fader.addEventListener('pointercancel', end);
    fader.addEventListener('keydown', function (e) {
      var k = e.key;
      if (k === 'ArrowRight' || k === 'ArrowUp') target = clamp(target + .05, 0, 1);
      else if (k === 'ArrowLeft' || k === 'ArrowDown') target = clamp(target - .05, 0, 1);
      else if (k === 'Home') target = 0;
      else if (k === 'End') target = 1;
      else return;
      takeOver(); keep();
      e.preventDefault();
    });

    if (hasGsap && !reduced) {
      // One pin at every width; on phones it simply has no length. It used to be rebuilt by gsap.matchMedia whenever the
      // window crossed 900px. That rebuild ran a second ScrollTrigger refresh inside the resize refresh, and the inner one
      // recorded the scroll at its measuring position (0) and restored that, so resizing or rotating an iPad sent the
      // visitor back to the top. refreshPriority sorts the pin ahead of the triggers below it, so they are measured with
      // its 140% spacer in place.
      ScrollTrigger.create({
        trigger: $('.range__pin', sec), start: 'top top', end: function () { return mobileQ.matches ? '+=0' : '+=140%'; },
        pin: true, scrub: true, anticipatePin: 1, refreshPriority: 1, invalidateOnRefresh: true,
        onUpdate: function (st) { prog = st.progress; if (!dragging && !mobileQ.matches) target = clamp(prog + offset, 0, 1); },
        onLeave: function () { offset = 0; }, onLeaveBack: function () { offset = 0; }
      });
      // phones: no scroll travel to drive the fader, so it shows its range once by itself
      var demo = { v: 0 };
      ScrollTrigger.create({
        trigger: sec, start: 'top 60%', once: true,
        onEnter: function () {
          if (touched || !mobileQ.matches) return;
          demoTween = gsap.to(demo, { v: 1, duration: 4.2, ease: 'power1.inOut', onUpdate: function () { if (!dragging) target = demo.v; }, onComplete: function () { demoTween = null; } });
        }
      });
    }

    onTick(function (now) {
      if (!on) return;
      val += (target - val) * .12;
      if (Math.abs(val - drawn) > .0004) {
        drawn = val;
        place();
        fill.style.transform = 'scaleX(' + val.toFixed(4) + ')';
        fader.setAttribute('aria-valuenow', String(Math.round(val * 100)));
        var tone = Math.round(96 - val * 70), energy = Math.round(12 + val * 86), tempo = Math.round(72 + val * 60);
        ro.tone.style.transform = 'scaleX(' + tone / 100 + ')'; roN.tone.textContent = tone;
        ro.energy.style.transform = 'scaleX(' + energy / 100 + ')'; roN.energy.textContent = energy;
        ro.tempo.style.transform = 'scaleX(' + ((tempo - 60) / 80).toFixed(3) + ')'; roN.tempo.textContent = tempo;
        word.style.fontVariationSettings = '"opsz" 144, "wght" ' + Math.round(200 + val * 700) + ', "SOFT" ' + Math.round(val * 100) + ', "WONK" ' + (val > .6 ? 1 : 0);
        word.style.fontStyle = val > .6 ? 'italic' : 'normal';
        setMode(val < .17 ? 0 : val < .5 ? 1 : val < .83 ? 2 : 3);
      }
      Sky.tension = val;
      // bars: smooth and low when formal, tall and jittery when the room is up
      // reduced motion: the bars stand still at the current tension instead of jittering 14 times a second
      var t = reduced ? 0 : now / 1000, n = Math.max(32, Math.round(W / 11)), bw = W / n;
      g.setTransform(dpr, 0, 0, dpr, 0, 0);
      g.clearRect(0, 0, W, H);
      for (var i = 0; i < n; i++) {
        var u = i / (n - 1);
        var calm = .2 + .12 * Math.sin(u * 5 + t * 1.1) + .05 * Math.sin(u * 13 - t * .7);
        var jit = Math.sin(i * 12.9898 + Math.floor(t * 14) * 78.233) * 43758.5453; jit = jit - Math.floor(jit);
        var hype = Math.abs(Math.sin(u * 21 + t * 7.4)) * .55 + Math.abs(Math.sin(u * 47 - t * 10.6)) * .3 + jit * .35;
        var h = lerp(calm, hype, val) * (.35 + .65 * val + .2) * H * .62;
        var r1 = 255, g1 = Math.round(lerp(226, 140, u * val)), b1 = Math.round(lerp(166, 170, u * val));
        g.fillStyle = 'rgba(' + r1 + ',' + g1 + ',' + b1 + ',' + (.55 + .35 * val) + ')';
        var x = i * bw + bw * .22, bwid = Math.max(1.5, bw * .56);
        g.fillRect(x, H - 14 - h, bwid, h);
        g.fillStyle = 'rgba(' + r1 + ',' + g1 + ',' + b1 + ',.14)';
        g.fillRect(x, H - 12, bwid, h * .25);
      }
    });
  });

  /* ---------- stage titles: weight and softness breathe with scroll ---------- */
  safe('stage-titles', function () {
    if (!hasGsap || reduced) return;
    $$('.stage__en[data-axis]').forEach(function (el) {
      var txt = el.textContent, soft = el.hasAttribute('data-soft');
      el.textContent = '';
      el.setAttribute('aria-label', txt);
      var chars = [];
      txt.split('').forEach(function (c) {
        var s = document.createElement('span');
        s.className = 'ch'; s.setAttribute('aria-hidden', 'true');
        s.textContent = c === ' ' ? ' ' : c;
        el.appendChild(s); chars.push(s);
      });
      var setVar = function (s, w, so, wo) { s.style.fontVariationSettings = '"opsz" 144, "wght" ' + w + ', "SOFT" ' + so + ', "WONK" ' + wo; };
      chars.forEach(function (s, i) { setVar(s, 100, 0, 0); s.style.opacity = '.15'; s.style.transform = 'translate3d(0,55%,0) rotate(' + (i % 2 ? 6 : -6) + 'deg)'; });
      ScrollTrigger.create({
        trigger: el, start: 'top 95%', end: 'top 25%', scrub: .6,
        onUpdate: function (st) {
          var p = st.progress, n = chars.length;
          for (var i = 0; i < n; i++) {
            var local = clamp(p * 1.7 - (i / n) * .7, 0, 1), e = 1 - Math.pow(1 - local, 3);
            chars[i].style.transform = 'translate3d(0,' + ((1 - e) * 55).toFixed(1) + '%,0) rotate(' + ((1 - e) * (i % 2 ? 6 : -6)).toFixed(2) + 'deg)';
            chars[i].style.opacity = (.15 + e * .85).toFixed(3);
            setVar(chars[i], Math.round(100 + e * (soft ? 520 : 300)), soft ? Math.round(e * 100) : 0, soft && e > .7 ? 1 : 0);
          }
        }
      });
    });
    $$('.stage__ko, .stage__pitch').forEach(function (el) {
      gsap.fromTo(el, { opacity: 0, y: 30 }, { opacity: 1, y: 0, duration: 1.3, ease: 'expo.out', scrollTrigger: { trigger: el, start: 'top 90%', once: true } });
    });
  });

  /* ---------- career ledger: expand + floating photo preview ---------- */
  safe('ledger', function () {
    // Every row shows: the list follows her career sheet in full, so the old "전체 N건 보기" fold is gone.
    $$('.ledger').forEach(function (led) {
      if (hasGsap && !reduced) batchReveal($$('.ledger__list li', led), 'top 92%', { y: 30, opacity: 0 }, { y: 0, opacity: 1 }, { duration: 1, ease: 'expo.out' });
    });
    var prev = $('.preview'), img = prev && prev.querySelector('img');
    if (!prev || !finePointer || !hasGsap || reduced) return;
    var px = gsap.quickTo(prev, 'x', { duration: .5, ease: 'power3' }), py = gsap.quickTo(prev, 'y', { duration: .5, ease: 'power3' });
    var rot = gsap.quickTo(prev, 'rotation', { duration: .6, ease: 'power3' }), lastX = 0;
    // One visibility state, one tween at a time. Separate show (.45s) and hide (.3s) tweens used to overlap on a quick pass,
    // and the show tween outlived the hide, leaving the photo up after the pointer had gone.
    var shown = false;
    var setShown = function (on) {
      if (on === shown) return;
      shown = on;
      gsap.to(prev, on ? { opacity: 1, scale: 1, duration: .45, ease: 'back.out(1.6)', overwrite: 'auto' } : { opacity: 0, scale: .6, duration: .3, overwrite: 'auto' });
    };
    // mouse only: a touch tap's compatibility mouseenter gets no matching leave until the next tap elsewhere
    var isMouse = function (e) { return e.pointerType === 'mouse'; };
    // While the page scrolls, rows slide under a resting pointer and fire enter/leave. The photo stays down until the
    // pointer itself moves, instead of popping up for each row that passes.
    var scrolling = false;
    window.addEventListener('scroll', function () { if (!scrolling) { scrolling = true; setShown(false); } }, { passive: true });
    $$('[data-preview] li[data-img]').forEach(function (li) {
      var show = function (e) {
        img.src = 'assets/img/' + li.getAttribute('data-img') + '.webp';
        // a hidden photo starts at the pointer; the follow tween would otherwise fly it in from where it was last left
        // (the first time, the top-left corner of the page)
        if (!shown) { px(e.clientX + 28, e.clientX + 28); py(e.clientY - 120, e.clientY - 120); rot(0, 0); lastX = e.clientX; }
        setShown(true);
      };
      li.addEventListener('pointerenter', function (e) { if (isMouse(e) && !scrolling) show(e); });
      li.addEventListener('pointerleave', function (e) { if (isMouse(e)) setShown(false); });
      li.addEventListener('pointermove', function (e) {
        if (!isMouse(e)) return;
        if (scrolling) { if (!e.movementX && !e.movementY) return; scrolling = false; }
        if (!shown) { show(e); return; }
        px(e.clientX + 28); py(e.clientY - 120);
        rot(clamp((e.clientX - lastX) * .8, -12, 12)); lastX = e.clientX;
      });
    });
  });

  /* ---------- VIP route + swinging badges ---------- */
  safe('vip', function () {
    var route = $('.route');
    if (!route) return;
    var svg = $('.route__svg', route), base = $('.route__base', route), line = $('.route__line', route), badges = $$('.badge', route);
    var len = 0;
    // Badge holes come from layout offsets, not getBoundingClientRect: on a refresh the badges can still be mid-entrance
    // (lifted 50px and tilted), which bent the path through the air above them. The viewBox is the svg's own box: on phones
    // it is a 28px strip, and a route-wide viewBox squeezed the line into a hairline.
    var build = function () {
      var sr = svg.getBoundingClientRect(), rr = route.getBoundingClientRect(), W = sr.width, H = sr.height;
      var ox = sr.left - rr.left, oy = sr.top - rr.top, strip = mobileQ.matches;
      svg.setAttribute('viewBox', '0 0 ' + W + ' ' + H);
      svg.setAttribute('preserveAspectRatio', 'none');
      var pts = [[W / 2, 0]];
      badges.forEach(function (b) {
        var hole = $('.badge__hole', b);
        var hx = b.offsetLeft + (hole ? hole.offsetLeft + hole.offsetWidth / 2 : b.offsetWidth / 2);
        var hy = b.offsetTop + (hole ? hole.offsetTop + hole.offsetHeight / 2 : 14);
        pts.push([strip ? W / 2 : hx - ox, hy - oy]);
      });
      pts.push([W / 2, H]);
      var d = 'M' + pts[0][0] + ' ' + pts[0][1];
      for (var i = 1; i < pts.length; i++) {
        var a = pts[i - 1], b = pts[i], my = (a[1] + b[1]) / 2;
        d += ' C ' + a[0] + ' ' + my + ', ' + b[0] + ' ' + my + ', ' + b[0] + ' ' + b[1];
      }
      base.setAttribute('d', d); line.setAttribute('d', d);
      base.style.vectorEffect = line.style.vectorEffect = 'none';
      len = line.getTotalLength();
      line.style.strokeDasharray = len + ' ' + len;
    };
    build();
    window.addEventListener('resize', build);
    if (hasGsap) ScrollTrigger.addEventListener('refresh', build);
    if (!hasGsap || reduced) { line.style.strokeDashoffset = 0; return; }
    var st = ScrollTrigger.create({
      trigger: route, start: 'top 75%', end: 'bottom 55%', scrub: .5,
      onUpdate: function (s) { line.style.strokeDashoffset = (len * (1 - s.progress)).toFixed(1); }
    });
    line.style.strokeDashoffset = len;
    badges.forEach(function (b, i) {
      gsap.fromTo(b, { rotation: i % 2 ? 14 : -14, y: -50, opacity: 0 }, { rotation: 0, y: 0, opacity: 1, duration: 2, ease: 'elastic.out(1, .38)', scrollTrigger: { trigger: b, start: 'top 85%', once: true } });
      b.addEventListener('mouseenter', function () { gsap.fromTo(b, { rotation: i % 2 ? 3 : -3 }, { rotation: 0, duration: 1.4, ease: 'elastic.out(1.2, .3)' }); });
    });
    void st;
  });

  /* ---------- dominoes: the team falls, then stands back up ---------- */
  safe('dominoes', function () {
    var ds = $$('.domino');
    if (!ds.length || !hasGsap || reduced) return;
    // hidden from the start: set only on enter, the row stood in view below the trigger line, then blinked out and rose
    gsap.set(ds, { y: 60, opacity: 0 });
    ScrollTrigger.create({
      trigger: '.dominoes', start: 'clamp(top 80%)', once: true,
      onEnter: function () {
        var tl = gsap.timeline();
        tl.to(ds, { y: 0, opacity: 1, stagger: .05, duration: .7, ease: 'back.out(1.7)' })
          .to(ds, { rotation: function (i) { return i === ds.length - 1 ? 72 : 24; }, duration: .32, ease: 'power2.in', stagger: .085 }, '+=.25')
          .to(ds, { rotation: 0, duration: 1.3, ease: 'elastic.out(1, .35)', stagger: { each: .06, from: 'end' } }, '+=.35');
      }
    });
    ds.forEach(function (d) {
      d.addEventListener('mouseenter', function () { gsap.fromTo(d, { rotation: -7 }, { rotation: 0, duration: 1, ease: 'elastic.out(1.4, .3)' }); });
    });
  });

  /* ---------- crowd: every seat is a star ---------- */
  safe('crowd', function () {
    var box = $('.crowd');
    if (!box) return;
    var cv = $('.crowd__canvas', box), g = cv.getContext('2d'), nEl = $('.crowd__n', box), label = $('.crowd__label', box);
    var items = $$('.rec__list li'), TOTAL = 4800, W = 0, H = 0, dpr = 1, on = false;
    var seats = [], count = TOTAL, shown = { v: 0 }, selected = null, t0 = performance.now();
    var lightUntil = 0;
    var build = function () {
      var r = box.getBoundingClientRect(); dpr = Math.min(devicePixelRatio || 1, 2);
      W = r.width; H = r.height; cv.width = W * dpr; cv.height = H * dpr;
      var sx = W / 2, sy = H * 1.06, span = 1.32, r0 = H * .2, r1 = H * 1.02;
      var area = span * (r1 * r1 - r0 * r0) / 2, s = Math.sqrt(area / TOTAL) * .96;
      var list = [];
      for (var rr = r0, row = 0; rr < r1 + 400 && list.length < TOTAL; rr += s, row++) {
        var nSeat = Math.floor(rr * span / s);
        for (var k = 0; k < nSeat; k++) {
          var a = -Math.PI / 2 + (k / (nSeat - 1 || 1) - .5) * span;
          list.push({ x: sx + Math.cos(a) * rr, y: sy + Math.sin(a) * rr, row: row, off: Math.abs(k / (nSeat - 1 || 1) - .5), o: 0, hue: Math.random() });
        }
      }
      list.sort(function (a, b) { return a.row - b.row || a.off - b.off; });
      seats = list.slice(0, TOTAL);
      seats.forEach(function (st, i) { st.i = i; });
      seatSize = Math.max(1.1, s * .42);
    };
    var seatSize = 2;
    build();
    if (window.ResizeObserver) new ResizeObserver(build).observe(box);
    visible(box, function (v) { on = v; });

    // `show` is what the counter displays; `selected` is the row a click or key picked. Hover and focus only preview.
    // Hover used to write `selected` itself, so the first click read as "already picked" and cleared the choice, and
    // leaving the list wiped it. Now leaving goes back to the picked row.
    var show = function (n, li) {
      count = n; lightUntil = performance.now() + 900;
      items.forEach(function (x) { x.classList.toggle('is-on', x === li); });
      if (hasGsap) gsap.to(shown, { v: n, duration: 1.2, ease: 'power3.out', overwrite: true, onUpdate: function () { nEl.textContent = Math.round(shown.v).toLocaleString('ko-KR'); } });
      else nEl.textContent = n.toLocaleString('ko-KR');
      label.textContent = li ? li.querySelector('.n').textContent : '16 EVENTS · TOTAL';
    };
    var rest = function () { if (selected) show(+selected.getAttribute('data-n'), selected); else show(TOTAL, null); };
    var pick = function (li) {
      selected = selected === li ? null : li;
      items.forEach(function (x) { x.setAttribute('aria-pressed', String(x === selected)); });
      rest();
    };
    var list = $('.rec__list');
    // the rows are buttons for the keyboard too: Tab reaches them, Enter or Space picks
    if (list) { list.setAttribute('role', 'group'); list.setAttribute('aria-label', '레크리에이션 행사를 고르면 그날의 객석이 채워집니다'); }
    items.forEach(function (li) {
      var n = +li.getAttribute('data-n');
      li.style.setProperty('--p', (n / 1200).toFixed(3));
      li.tabIndex = 0; li.setAttribute('role', 'button'); li.setAttribute('aria-pressed', 'false');
      li.addEventListener('mouseenter', function () { if (finePointer) show(n, li); });
      li.addEventListener('focus', function () { show(n, li); });
      li.addEventListener('click', function () { pick(li); });
      li.addEventListener('keydown', function (e) { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); pick(li); } });
    });
    if (list) {
      list.addEventListener('mouseleave', function () { if (finePointer) rest(); });
      list.addEventListener('focusout', function (e) { if (!list.contains(e.relatedTarget)) rest(); });
    }
    if (hasGsap) ScrollTrigger.create({ trigger: box, start: 'clamp(top 75%)', once: true, onEnter: function () { shown.v = 0; rest(); } });

    onTick(function (now) {
      if (!on) return;
      var t = (now - t0) / 1000;
      g.setTransform(dpr, 0, 0, dpr, 0, 0);
      g.clearRect(0, 0, W, H);
      // stage light at the bottom
      var sg = g.createRadialGradient(W / 2, H * 1.05, 0, W / 2, H * 1.05, H * .5);
      sg.addColorStop(0, 'rgba(255,226,166,.35)'); sg.addColorStop(1, 'rgba(255,226,166,0)');
      g.fillStyle = sg; g.fillRect(0, 0, W, H);
      var wave = Math.min(1, (now - (lightUntil - 900)) / 900);
      var big = count < TOTAL;
      for (var i = 0; i < seats.length; i++) {
        var st = seats[i];
        var lit = i < count && (i / Math.max(1, count)) <= wave * 1.05;
        st.o += ((lit ? 1 : .1) - st.o) * .12;
        if (st.o < .02) continue;
        var tw = .8 + .2 * Math.sin(t * 2 + st.hue * 30);
        var rr = st.hue < .5 ? 255 : 255, gg = st.hue < .33 ? 226 : st.hue < .66 ? 239 : 159, bb = st.hue < .33 ? 166 : st.hue < .66 ? 228 : 176;
        g.fillStyle = 'rgba(' + rr + ',' + gg + ',' + bb + ',' + (st.o * tw).toFixed(3) + ')';
        var sz = seatSize * (big && lit ? 1.35 : 1);
        g.fillRect(st.x - sz / 2, st.y - sz / 2, sz, sz);
      }
    });
  });

  /* ---------- DAW credit tracks slide past the REC playhead ---------- */
  safe('daw', function () {
    var daw = $('.daw');
    if (!daw) return;
    var tracks = $$('.daw__track', daw), clips = $$('.daw__clips li', daw), on = false;
    // reduced motion: the strips stay put and scroll sideways by hand (main.css)
    if (reduced || !hasGsap) { daw.classList.add('is-static'); return; }
    visible(daw, function (v) { on = v; });
    // Each strip runs its whole length while its own row is fully on screen, and ends with its last credit clear of
    // the label and as far as the REC line.
    // - Before, slow strips covered only part of their length.
    // - Paced by the whole box, a row on a phone could be below or above the screen while its last credits went by,
    //   and some credits never appeared at all.
    onTick(function () {
      if (!on) return;
      var vh = window.innerHeight, dw = daw.clientWidth, mid = daw.getBoundingClientRect().left + dw / 2;
      var rows = tracks.map(function (tr) { return tr.getBoundingClientRect(); }); // read all, then write
      tracks.forEach(function (tr, i) {
        var ul = tr.querySelector('.daw__clips'), sp = parseFloat(tr.getAttribute('data-speed')) || .5, last = ul.lastElementChild;
        // The row's pass runs from 0, when it has fully come up from the bottom edge, to 1, when it reaches the top
        // edge. The strip holds still for the first 10% and the last 15% of it, so the first and last credits stay
        // whole on screen for a while.
        var rh = rows[i].height, raw = (vh - rh - rows[i].top) / Math.max(1, vh - rh), k = clamp((raw - .1) / .75, 0, 1);
        var p = sp > 0 ? k : 1 - k;
        var lw = last ? last.offsetWidth : 0, lo = last ? last.offsetLeft : 0;
        var x0 = dw * .18, endLeft = Math.min(Math.max(140, dw / 2 - lw / 2), dw - 8 - lw);
        var x1 = Math.min(x0, endLeft - lo);
        var x = x0 + (x1 - x0) * p;
        ul.style.transform = 'translate3d(' + x.toFixed(1) + 'px,0,0)';
      });
      for (var i = 0; i < clips.length; i++) {
        var r = clips[i].getBoundingClientRect();
        clips[i].classList.toggle('is-hot', r.left < mid && r.right > mid);
      }
    });
  });

  /* ---------- feature: Gwanghwamun frame opens to full bleed ---------- */
  safe('feature', function () {
    var fr = $('.feature__frame');
    if (!fr || !hasGsap || reduced) return;
    var img = fr.querySelector('img');
    gsap.fromTo(fr, { clipPath: 'inset(6% 8% 6% 8% round 28px)' }, { clipPath: 'inset(0% 0% 0% 0% round 0px)', ease: 'none', scrollTrigger: { trigger: '.feature', start: 'top 85%', end: 'top 15%', scrub: true } });
    fr.style.width = '100%'; fr.style.maxWidth = 'none'; fr.style.borderRadius = '0';
    gsap.fromTo(img, { scale: 1.3 }, { scale: 1, ease: 'none', scrollTrigger: { trigger: '.feature', start: 'top bottom', end: 'bottom top', scrub: true } });
    gsap.fromTo('.feature__copy > *', { y: 40, opacity: 0 }, { y: 0, opacity: 1, stagger: .1, duration: 1.2, ease: 'expo.out', scrollTrigger: { trigger: '.feature__copy', start: 'top 92%', once: true } });
  });

  /* ---------- festival posters ---------- */
  safe('posters', function () {
    var ps = $$('.poster');
    if (!ps.length) return;
    var motion = hasGsap && !reduced;
    if (motion) {
      // GSAP owns the posters' transform from here on (entrance, tilt, hover lift). `.is-gsap` takes transform out of the
      // CSS transition, which restarted a .6s transition on every tween frame, and the lift moves into the tween because
      // GSAP's inline transform hides the :hover one.
      ps.forEach(function (p) { p.classList.add('is-gsap'); });
      batchReveal(ps, 'top 92%', { y: 90, opacity: 0, rotation: function () { return gsap.utils.random(-10, 10); } }, { y: 0, opacity: 1, rotation: 0 }, { duration: 1.3, ease: 'back.out(1.3)' });
    }
    if (!finePointer) return;
    ps.forEach(function (p) {
      p.addEventListener('mouseenter', function () { if (motion) gsap.to(p, { y: -8, rotation: -1, duration: .6, ease: 'power3', overwrite: 'auto' }); });
      p.addEventListener('mousemove', function (e) {
        var r = p.getBoundingClientRect(), x = (e.clientX - r.left) / r.width, y = (e.clientY - r.top) / r.height;
        p.style.setProperty('--px', (x * 100).toFixed(1) + '%'); p.style.setProperty('--py', (y * 100).toFixed(1) + '%');
        if (motion) gsap.to(p, { rotationY: (x - .5) * 14, rotationX: -(y - .5) * 12, transformPerspective: 700, duration: .5, ease: 'power3', overwrite: 'auto' });
      });
      p.addEventListener('mouseleave', function () { if (motion) gsap.to(p, { y: 0, rotation: 0, rotationY: 0, rotationX: 0, duration: .9, ease: 'elastic.out(1, .5)', overwrite: 'auto' }); });
    });
  });

  /* ---------- gallery ring ---------- */
  safe('ring', function () {
    var ring = $('#ring');
    if (!ring) return;
    var stage = $('.ring__stage', ring), cap = $('.ring__cap');
    var P = {
      'ev-pilotday': ['2025 도선사의 날 기념식', 'official', '50% 30%'], 'ev-mou': ['고용노동부&한국산업인력공단 합동행사', 'official'],
      'ev-neulbom': ['인천광역시교육청 동부거점 늘봄센터 개소식', 'official'], 'ev-smartfarm': ['2025 스마트 농업전문교육 성과공유회', 'official', '50% 45%'],
      'ev-veterans': ['전몰군경유족회 창립기념식', 'official'], 'ev-incheonbook': ['2025 인천독서대전', 'official', '50% 30%'],
      'ev-socialfair': ['제2회 인천광역시 사회적경제 박람회', 'official', '50% 35%'], 'ev-podium': ['기업 역량 혁신 행사 진행', 'official', '50% 30%'],
      'ev-red': ['공식행사 진행', 'official', '50% 30%'], 'ev-flag': ['공식행사 현장', 'official'], 'ev-vip': ['삼성스마트비즈엑스포 VIP 투어', 'official'],
      'ev-vipboard': ['삼성스마트비즈엑스포 2025', 'official'], 'ev-kintex': ['2024 경기글로벌대전 · 킨텍스', 'official', '50% 30%'],
      'ev-pilotday2': ['2025 도선사의 날', 'official', '50% 30%'], 'ev-reception': ['2025 도선사의 날 · 행사 준비', 'official'], 'ev-conf': ['컨퍼런스 진행', 'official'],
      'ev-hall': ['행사장 전경', 'official'], 'ev-football': ['고양시무원풋볼클럽 고별전', 'official'],
      'ev-goyang': ['2026 고양시 공직자 워크숍 ICE BREAKING', 'team'], 'ev-ice': ['ICE BREAKING 현장', 'team'],
      'ev-kbiz': ['중소기업협동조합 실무자협의회 워크숍', 'team'], 'ev-teamplay': ['팀빌딩 현장', 'team'], 'ev-everland': ['Over the Wall Outdoor · 2026.03.12', 'team'],
      'ev-teamplanner': ['팀빌딩 액티비티', 'team'], 'ev-teamcert': ['팀빌딩 수료 기념', 'team'], 'ev-teamselfie': ['팀플레이 진행팀', 'team'],
      'ev-outdoor': ['야외 팀빌딩', 'team', '50% 40%'], 'ev-samsung': ['삼성전자 송년회 레크', 'team'], 'ev-samsungda': ['2025 삼성전자 DA사업부 선행개발팀 송년의 밤', 'team', '50% 30%'],
      'ev-hanam': ['하남 제일리틀야구단 송년의 밤', 'team'], 'ev-banquet': ['기업 송년회 현장', 'team'], 'ev-gym': ['학단 레크 현장', 'team'],
      'ev-camp': ['캠핑장 가족 레크', 'team'], 'ev-wonju': ['원주시 미래경제교육관 어린이경제 플리마켓', 'team'], 'ev-kids': ['어린이 행사 현장', 'team'],
      'ev-moef': ['2026 재정경제부 부모님 감사행사', 'team'],
      'ev-jongno': ['종로 어디나 스테이지 개막식 · 광화문광장', 'stage'], 'ev-onepiece': ['원피스이모션 팬밋업', 'stage'],
      'ev-sunset': ['THE SHOP 더샵x 조째즈 SUNSET LIVE', 'stage', '50% 30%'], 'ev-gxg': ['2025 GXG 판교 게임축제 더빙시연 · 사진 데일리게임', 'stage'],
      'ev-bora': ['법무부 보라미방송 <12시의 면회>', 'stage'], 'ev-touchtv': ['터치TV 촬영 현장', 'stage'], 'ev-class': ['스피치 · 낭독 수업', 'stage'],
      'ev-socialvalue': ['사회적가치 우수기업 무대', 'stage'], 'ev-seminar': ['세미나 진행', 'stage']
    };
    var ALL = ['ev-jongno', 'ev-pilotday', 'ev-goyang', 'ev-vip', 'ev-onepiece', 'ev-samsung', 'ev-neulbom', 'ev-sunset', 'ev-kbiz', 'ev-mou', 'ev-everland', 'ev-smartfarm', 'ev-hanam', 'ev-gxg', 'ev-socialfair', 'ev-teamplay', 'ev-moef', 'ev-kintex'];
    var listFor = function (f) {
      if (f === 'all') return ALL;
      return Object.keys(P).filter(function (k) { return P[k][1] === f; }).slice(0, 18);
    };
    var items = [], N = 0, step = 0, spin = 0, vel = 0, dragging = false, lastX = 0, idleAt = 0, on = false, frontIdx = -1;
    var R = 1200, C = 900, IW = 400, IH = 290;
    var dims = function () {
      var w = ring.clientWidth;
      step = 360 / N;
      var want = clamp(w * .62, 220, 420);
      R = want / (2 * Math.tan(Math.PI / N) * .9);
      IW = want;
      IH = IW * .72;
      if (IH > ring.clientHeight * .8) { IH = ring.clientHeight * .8; IW = IH / .72; }
      C = R - R * .26;
      ring.style.perspective = Math.round(R * .82) + 'px';
      stage.style.setProperty('--iw', IW.toFixed(0) + 'px');
      stage.style.setProperty('--ih', IH.toFixed(0) + 'px');
    };
    var build = function (f) {
      var keys = listFor(f).slice();
      while (keys.length < 14) keys = keys.concat(keys);
      stage.innerHTML = '';
      items = keys.map(function (k) {
        var d = document.createElement('div'); d.className = 'ring__item';
        // loading must be set before src: assigning src first starts an eager fetch
        var im = document.createElement('img'); im.loading = 'lazy'; im.src = 'assets/img/' + k + '.webp'; im.alt = P[k][0]; im.draggable = false;
        if (P[k][2]) im.style.objectPosition = P[k][2];
        d.appendChild(im); stage.appendChild(d);
        return { el: d, key: k };
      });
      N = items.length; spin = 0; frontIdx = -1;
      dims();
    };
    build('all');
    window.addEventListener('resize', dims);
    visible(ring, function (v) { on = v; });

    $$('.filters button').forEach(function (b) {
      b.addEventListener('click', function () {
        $$('.filters button').forEach(function (x) { x.classList.toggle('is-on', x === b); x.setAttribute('aria-pressed', String(x === b)); });
        var f = b.getAttribute('data-filter');
        if (hasGsap && !reduced) {
          // Fade the ring box, not the 3D stage. Opacity below 1 on a preserve-3d element flattens it, so the cards
          // spun as flat rectangles for the whole fade and snapped back into depth at the last frame.
          gsap.to(ring, { opacity: 0, duration: .35, ease: 'power2.in', overwrite: 'auto' });
          gsap.to(stage, { scale: .9, duration: .35, ease: 'power2.in', overwrite: 'auto', onComplete: function () {
            build(f);
            vel = 6;
            gsap.to(ring, { opacity: 1, duration: .9, ease: 'expo.out', overwrite: 'auto' });
            gsap.fromTo(stage, { scale: 1.08 }, { scale: 1, duration: .9, ease: 'expo.out', overwrite: 'auto' });
          } });
        } else build(f);
      });
    });

    // a card sits at x = -R·sin(angle), so the drag delta is negated to make the ring follow the pointer
    var lastT = 0, flick = 0, gain = 1.05, pid = null;
    ring.addEventListener('pointerdown', function (e) {
      if (e.button > 0) return;
      dragging = true; pid = e.pointerId; lastX = e.clientX; lastT = performance.now(); vel = 0; flick = 0;
      gain = e.pointerType === 'mouse' ? 1.05 : 1.6; // a finger covers less distance per card than a mouse
      try { ring.setPointerCapture(e.pointerId); } catch (err) {}
    });
    ring.addEventListener('pointermove', function (e) {
      if (!dragging || e.pointerId !== pid) return;
      var now = performance.now(), dt = Math.max(1, now - lastT);
      var dx = e.clientX - lastX; lastX = e.clientX; lastT = now;
      var d = -dx / IW * step * gain;
      spin += d;
      flick = flick * .6 + (d * 16.7 / dt) * .4; // per-frame velocity, smoothed over the last few moves
    });
    // release carries the recent velocity; the last tiny touchmove alone used to snap the ring back
    var up = function () {
      if (!dragging) return;
      dragging = false; pid = null; idleAt = performance.now();
      vel = performance.now() - lastT < 90 ? clamp(flick, -step * .45, step * .45) : 0;
    };
    ring.addEventListener('pointerup', up);
    ring.addEventListener('pointercancel', up);
    ring.addEventListener('mouseenter', function () { document.dispatchEvent(new CustomEvent('cursorlabel', { detail: 'DRAG' })); });
    ring.addEventListener('mouseleave', function () { document.dispatchEvent(new CustomEvent('cursorlabel', { detail: '' })); });

    onTick(function (now) {
      if (!on || !N) return;
      if (!dragging) {
        spin += vel; vel *= .94;
        spin += velocity() * .05;
        if (Math.abs(vel) < .02) {
          if (now - idleAt > 3500 && !reduced) spin -= .045;
          else { var snap = Math.round(spin / step) * step; spin += (snap - spin) * .06; }
        }
      }
      var best = 999, bi = 0;
      for (var i = 0; i < N; i++) {
        var a = ((i * step + spin) % 360 + 540) % 360 - 180, aa = Math.abs(a);
        var it = items[i];
        if (aa > 62) { if (it.vis !== false) { it.el.style.visibility = 'hidden'; it.vis = false; } continue; }
        if (it.vis !== true) { it.el.style.visibility = 'visible'; it.vis = true; }
        it.el.style.transform = 'translateZ(' + C.toFixed(1) + 'px) rotateY(' + a.toFixed(2) + 'deg) translateZ(' + (-R).toFixed(1) + 'px)';
        it.el.style.setProperty('--dim', clamp((aa - 8) / 50, 0, .6).toFixed(3));
        if (aa < best) { best = aa; bi = i; }
      }
      if (bi !== frontIdx) { frontIdx = bi; if (cap) cap.textContent = P[items[bi].key][0]; }
    });
  });

  /* ---------- reviews: typing, then the bubble pops ---------- */
  safe('chat', function () {
    var msgs = $$('.chat .msg');
    if (!msgs.length || !hasGsap || reduced) return;
    msgs.forEach(function (m) { gsap.set(m, { opacity: 0, y: 24 }); });
    ScrollTrigger.batch(msgs, {
      start: 'top 88%', once: true,
      onEnter: function (els) {
        els.forEach(function (m, i) {
          var b = m.querySelector('.msg__b'), who = m.querySelector('.msg__who');
          var typing = document.createElement('div'); typing.className = 'msg__typing'; typing.innerHTML = '<i></i><i></i><i></i>';
          var tl = gsap.timeline({ delay: Math.min(i, 4) * .38 });
          // The bubble keeps its box (only hidden) and the dots sit inside it. Swapping the bubble out for the one-line
          // dots shrank and regrew the chat, and everything below it jumped twice for each message.
          tl.set(m, { opacity: 1, y: 0 })
            .set(b, { visibility: 'hidden' })
            .add(function () { b.appendChild(typing); })
            .fromTo([who, typing], { opacity: 0, y: 10 }, { opacity: 1, y: 0, duration: .35, ease: 'power2.out' })
            .add(function () { typing.remove(); }, '+=.42')
            .fromTo(b, { scale: .55, autoAlpha: 0 }, { scale: 1, autoAlpha: 1, duration: .6, ease: 'back.out(1.9)' });
        });
      }
    });
  });

  /* ---------- curtains open on the three side stages ---------- */
  safe('curtains', function () {
    if (!hasGsap || reduced) return;
    $$('.curtain').forEach(function (c, i) {
      var l = c.querySelector('.curtain__l'), r = c.querySelector('.curtain__r');
      gsap.set([l, r], { scaleX: 1 });
      ScrollTrigger.create({
        trigger: c, start: 'top 80%', once: true,
        onEnter: function () {
          gsap.to(l, { scaleX: 0, skewY: 2, duration: 1.6, ease: 'expo.inOut', delay: i * .15, onComplete: function () { l.style.visibility = 'hidden'; } });
          gsap.to(r, { scaleX: 0, skewY: -2, duration: 1.6, ease: 'expo.inOut', delay: i * .15, onComplete: function () { r.style.visibility = 'hidden'; } });
          gsap.fromTo(c.querySelector('.curtain__in'), { scale: .94, opacity: .4 }, { scale: 1, opacity: 1, duration: 1.6, ease: 'expo.out', delay: .3 + i * .15 });
        }
      });
    });
  });

  /* ---------- closing: the headline lights up like sunrise ---------- */
  safe('contact', function () {
    if (!hasGsap || reduced) return;
    var all = [], title = $('.contact__title'), lines = $$('.glow-line');
    // the letters are split for the sunrise; a screen reader gets the sentence once instead of letter by letter
    if (title && lines.length) {
      var sr = document.createElement('span'); sr.className = 'sr-only';
      sr.textContent = lines.map(function (l) { return l.textContent; }).join(' ');
      title.appendChild(sr);
    }
    lines.forEach(function (line) {
      var txt = line.textContent; line.textContent = '';
      line.setAttribute('aria-hidden', 'true');
      txt.split('').forEach(function (ch) {
        var s = document.createElement('span'); s.className = 'gc'; s.textContent = ch === ' ' ? ' ' : ch; line.appendChild(s); all.push(s);
      });
    });
    // Dim from the start. Set only on enter, the headline arrived fully lit, then dropped dark at the 82% line and rose again.
    gsap.set(all, { opacity: .12, y: 30, color: '#25163e' });
    ScrollTrigger.create({
      trigger: '.contact__title', start: 'clamp(top 82%)', once: true,
      onEnter: function () {
        gsap.timeline()
          .to(all, { opacity: 1, y: 0, stagger: .045, duration: .9, ease: 'expo.out' })
          .to(all, { color: '#c06a12', textShadow: '0 0 28px rgba(255,180,80,.75)', stagger: .03, duration: .35, yoyo: true, repeat: 1, ease: 'sine.inOut' }, .3);
      }
    });
    gsap.fromTo('.contact__list li', { opacity: 0, x: -30 }, { opacity: 1, x: 0, stagger: .08, duration: 1, ease: 'expo.out', scrollTrigger: { trigger: '.contact__list', start: 'top 88%', once: true } });
    gsap.fromTo('.card3d', { y: 120, rotate: -8, opacity: 0 }, { y: 0, rotate: 0, opacity: 1, duration: 1.8, ease: 'expo.out', scrollTrigger: { trigger: '.card3d', start: 'top 90%', once: true } });
  });

  /* ---------- 3D business card ---------- */
  safe('card', function () {
    var card = $('#card3d');
    if (!card) return;
    var inner = $('.card3d__in', card), flipped = false, tx = 0, ty = 0;
    inner.style.transition = 'none';
    var apply = function (dur) {
      // reduced motion: the card still turns over, but at once instead of in a 1.1s spin
      if (hasGsap) gsap.to(inner, { rotationY: (flipped ? 180 : 0) + ty, rotationX: tx, duration: reduced ? 0 : dur, ease: 'expo.out' });
      else inner.style.transform = 'rotateY(' + ((flipped ? 180 : 0) + ty) + 'deg) rotateX(' + tx + 'deg)';
    };
    var flip = function () { flipped = !flipped; apply(1.1); };
    card.addEventListener('click', flip);
    card.addEventListener('keydown', function (e) { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); flip(); } });
    // the pointer tilt is motion for its own sake: off under reduced motion
    if (!finePointer || reduced) return;
    card.addEventListener('pointermove', function (e) {
      var r = card.getBoundingClientRect(), x = (e.clientX - r.left) / r.width, y = (e.clientY - r.top) / r.height;
      ty = (x - .5) * 26; tx = -(y - .5) * 20;
      card.style.setProperty('--mx', (x * 100).toFixed(1) + '%'); card.style.setProperty('--my', (y * 100).toFixed(1) + '%'); card.style.setProperty('--fx', (x * 100).toFixed(1) + '%');
      apply(.6);
    });
    card.addEventListener('pointerleave', function () { tx = 0; ty = 0; apply(1.2); });
  });

  /* ---------- copy buttons ---------- */
  safe('copy', function () {
    var toast = $('.toast'), tt = 0;
    var say = function (m, ms) { toast.textContent = m; toast.classList.add('is-on'); clearTimeout(tt); tt = setTimeout(function () { toast.classList.remove('is-on'); }, ms || 2200); };
    document.addEventListener('click', function (e) {
      var a = e.target.closest('a[href^="mailto:"], a[href^="tel:"]');
      if (!a) return;
      var href = a.getAttribute('href'), mail = href.indexOf('mailto:') === 0;
      var v = mail ? decodeURIComponent(href.slice(7).split('?')[0]) : href.slice(4).replace(/^(\d{3})(\d{4})(\d{4})$/, '$1-$2-$3');
      var done = function () { say(mail ? '메일 주소를 복사했어요 · ' + v + ' — 메일 앱이 열리지 않으면 붙여 넣어 보내 주세요' : '전화번호를 복사했어요 · ' + v, 4200); };
      if (navigator.clipboard && navigator.clipboard.writeText) navigator.clipboard.writeText(v).then(done, function () { say((mail ? '메일 ' : '전화 ') + v, 4200); });
      else say((mail ? '메일 ' : '전화 ') + v, 4200);
    });
    $$('.copy').forEach(function (b) {
      b.addEventListener('click', function () {
        var v = b.getAttribute('data-copy');
        var fallback = function () {
          var el = b.parentNode.querySelector('.contact__v');
          var sel = window.getSelection(), rg = document.createRange();
          rg.selectNodeContents(el); sel.removeAllRanges(); sel.addRange(rg);
          say('선택했습니다. 길게 누르거나 Ctrl+C로 복사하세요');
        };
        if (navigator.clipboard && navigator.clipboard.writeText) navigator.clipboard.writeText(v).then(function () { say('복사했습니다 · ' + v); }, fallback);
        else fallback();
      });
    });
  });

  /* ---------- video modal (links open YouTube when embedding is not possible) ---------- */
  safe('video', function () {
    var modal = $('#modal');
    if (!modal || isArtifact) return;
    var frame = $('.modal__frame', modal), lastFocus = null;
    var close = function () {
      if (modal.hidden) return;
      frame.innerHTML = '';
      modal.hidden = true;
      lockScroll(false);
      lastFocus && lastFocus.focus();
    };
    document.addEventListener('click', function (e) {
      var a = e.target.closest('[data-video]');
      if (a) {
        e.preventDefault();
        lastFocus = a;
        if (Voice && Voice.playing) Voice.pause();
        var f = document.createElement('iframe');
        f.src = 'https://www.youtube-nocookie.com/embed/' + a.getAttribute('data-video') + '?autoplay=1&rel=0&playsinline=1';
        // fullscreen is granted by `allow` alone; setting allowFullscreen as well only drew a console warning
        f.allow = 'autoplay; encrypted-media; picture-in-picture; fullscreen';
        f.title = '유튜브 영상';
        frame.innerHTML = ''; frame.appendChild(f);
        modal.hidden = false;
        lockScroll(true);
        if (hasGsap && !reduced) gsap.fromTo('.modal__box', { scale: .85, opacity: 0, y: 30 }, { scale: 1, opacity: 1, y: 0, duration: .7, ease: 'expo.out' });
        $('.modal__x', modal).focus();
        return;
      }
      if (e.target.closest('[data-close]')) close();
    });
    document.addEventListener('keydown', function (e) { if (!modal.hidden && e.key === 'Escape') close(); });
    // aria-modal promises the page behind is out of reach, so Tab stays inside the dialog. Tabbing out of the YouTube
    // frame happens in a cross-origin document this page cannot listen to (and a frame still loading is skipped), so
    // two empty focus stops at the dialog's edges send focus back to the close button instead of to the page behind.
    // Both go to the button, never into the frame: keys pressed inside the frame never reach this page, so Esc would
    // stop closing the dialog. Tab from the button still enters the video.
    var box = $('.modal__box', modal), xBtn = $('.modal__x', modal);
    var stop = function () {
      var s = document.createElement('span'); s.tabIndex = 0; s.className = 'sr-only';
      s.addEventListener('focus', function () { xBtn.focus(); });
      return s;
    };
    box.insertBefore(stop(), box.firstChild);
    box.appendChild(stop());
  });

  /* ---------- tilt on portraits ---------- */
  safe('tilt', function () {
    if (!finePointer || !hasGsap || reduced) return;
    $$('[data-tilt]').forEach(function (el) {
      el.addEventListener('pointermove', function (e) {
        var r = el.getBoundingClientRect(), x = (e.clientX - r.left) / r.width - .5, y = (e.clientY - r.top) / r.height - .5;
        gsap.to(el, { rotationY: x * 10, rotationX: -y * 8, transformPerspective: 900, duration: .6, ease: 'power3' });
      });
      el.addEventListener('pointerleave', function () { gsap.to(el, { rotationY: 0, rotationX: 0, duration: 1.2, ease: 'elastic.out(1, .5)' }); });
    });
  });

  /* ---------- magnetic buttons ---------- */
  safe('magnetic', function () {
    if (!finePointer || !hasGsap || reduced) return;
    $$('.magnetic').forEach(function (el) {
      var qx = gsap.quickTo(el, 'x', { duration: .6, ease: 'power3' }), qy = gsap.quickTo(el, 'y', { duration: .6, ease: 'power3' });
      el.addEventListener('pointermove', function (e) {
        var r = el.getBoundingClientRect();
        qx((e.clientX - r.left - r.width / 2) * .3); qy((e.clientY - r.top - r.height / 2) * .4);
      });
      el.addEventListener('pointerleave', function () { gsap.to(el, { x: 0, y: 0, duration: 1, ease: 'elastic.out(1, .4)' }); });
    });
  });

  /* ---------- cursor + star trail ---------- */
  safe('cursor', function () {
    if (!finePointer || reduced || !hasGsap) return;
    root.classList.add('has-cursor');
    var cur = $('.cursor'), dot = $('.cursor__dot'), ring = $('.cursor__ring'), label = $('.cursor__label');
    var dx = gsap.quickSetter(dot, 'x', 'px'), dy = gsap.quickSetter(dot, 'y', 'px');
    var rx = gsap.quickTo(ring, 'x', { duration: .45, ease: 'power3' }), ry = gsap.quickTo(ring, 'y', { duration: .45, ease: 'power3' });
    var mx = -100, my = -100;
    window.addEventListener('pointermove', function (e) { mx = e.clientX; my = e.clientY; dx(mx); dy(my); rx(mx); ry(my); spawn(mx, my); }, { passive: true });
    var setLabel = function (t) { label.textContent = t || ''; cur.classList.toggle('is-label', !!t); };
    document.addEventListener('cursorlabel', function (e) { setLabel(e.detail); });
    document.addEventListener('pointerover', function (e) {
      var t = e.target.closest('a, button, [role="button"], [role="slider"], .reel, .track, .poster');
      cur.classList.toggle('is-hover', !!t);
      var v = e.target.closest('[data-video]');
      if (v && !isArtifact) setLabel('PLAY'); else if (!e.target.closest('#ring, .chart')) setLabel('');
    });
    document.addEventListener('pointerleave', function () { dx(-100); dy(-100); rx(-100); ry(-100); });

    // sparkles
    var cv = $('.sparkle'), g = cv.getContext('2d'), dpr = Math.min(devicePixelRatio || 1, 2), parts = [], lx = 0, ly = 0, W = 0, H = 0, dirty = false;
    var size = function () { W = window.innerWidth; H = window.innerHeight; cv.width = W * dpr; cv.height = H * dpr; };
    size(); window.addEventListener('resize', size);
    function spawn(x, y) {
      var d = Math.hypot(x - lx, y - ly);
      if (d < 16) return;
      lx = x; ly = y;
      if (parts.length > 70) parts.shift();
      parts.push({ x: x, y: y, vx: (Math.random() - .5) * .6, vy: Math.random() * .6 + .2, r: 1.5 + Math.random() * 3.5, life: 1, rot: Math.random() * 3, hue: Math.random() });
    }
    onTick(function () {
      if (!parts.length) { if (dirty) { g.setTransform(1, 0, 0, 1, 0, 0); g.clearRect(0, 0, cv.width, cv.height); dirty = false; } return; }
      dirty = true;
      g.setTransform(dpr, 0, 0, dpr, 0, 0);
      g.clearRect(0, 0, W, H);
      g.globalCompositeOperation = 'lighter';
      for (var i = parts.length - 1; i >= 0; i--) {
        var p = parts[i];
        p.life -= .022; p.x += p.vx; p.y += p.vy; p.rot += .05;
        if (p.life <= 0) { parts.splice(i, 1); continue; }
        var s = p.r * p.life;
        g.save(); g.translate(p.x, p.y); g.rotate(p.rot);
        g.fillStyle = navLight ? 'rgba(214,130,40,' + p.life * .8 + ')' : (p.hue < .7 ? 'rgba(255,226,166,' : 'rgba(255,159,176,') + p.life + ')';
        g.beginPath();
        g.moveTo(0, -s * 2); g.quadraticCurveTo(s * .2, -s * .2, s * 2, 0); g.quadraticCurveTo(s * .2, s * .2, 0, s * 2);
        g.quadraticCurveTo(-s * .2, s * .2, -s * 2, 0); g.quadraticCurveTo(-s * .2, -s * .2, 0, -s * 2);
        g.fill(); g.restore();
      }
      g.globalCompositeOperation = 'source-over';
    });
  });

  /* ---------- refresh once fonts and images settle ---------- */
  if (hasGsap) {
    ScrollTrigger.sort();
    ScrollTrigger.refresh();
    if (document.fonts && document.fonts.ready) document.fonts.ready.then(function () { ScrollTrigger.refresh(); });
    window.addEventListener('load', function () { ScrollTrigger.refresh(); });
  }
})();
