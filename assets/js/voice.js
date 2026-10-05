/* 목소리 별자리 · audio engine, constellation chart, player, track list and mini player. */
(function () {
  'use strict';

  var samples = window.VOICE_SAMPLES || [];
  var CATS = {
    ad: { ko: '광고', en: 'COMMERCIAL', color: '#ffd27a' },
    char: { ko: '캐릭터 · 게임 · 더빙', en: 'CHARACTER', color: '#ff8fab' },
    narr: { ko: '내레이션', en: 'NARRATION', color: '#9ec5ff' },
    cm: { ko: 'CM송', en: 'CM SONG', color: '#c0a8ff' },
    edu: { ko: '교재', en: 'E-LEARNING', color: '#8fe3cf' }
  };
  var ORDER = ['ad', 'char', 'narr', 'cm', 'edu'];
  var byId = {};
  samples.forEach(function (s) { byId[s.id] = s; });
  // the greeting plays through the same engine but stays off the chart and track list
  if (window.GREETING) byId[window.GREETING.id] = window.GREETING;

  var fmt = function (sec) {
    sec = Math.max(0, Math.floor(sec || 0));
    return String(Math.floor(sec / 60)).padStart(2, '0') + ':' + String(sec % 60).padStart(2, '0');
  };

  /* ---------------- audio engine ---------------- */
  var audio = new Audio();
  audio.preload = 'none';
  var ctx = null, analyser = null, td = null, fd = null, graph = 0; // 0 untried, 1 ok, -1 failed
  var current = null, level = 0, bands = new Float32Array(8);
  var subs = [];
  function emit(type) { for (var i = 0; i < subs.length; i++) { try { subs[i](type, current); } catch (e) { console.warn(e); } } }

  function ensureGraph() {
    if (graph !== 0) return;
    try {
      var AC = window.AudioContext || window.webkitAudioContext;
      if (!AC) { graph = -1; return; }
      ctx = new AC();
      analyser = ctx.createAnalyser();
      analyser.fftSize = 1024;
      analyser.smoothingTimeConstant = .78;
      var src = ctx.createMediaElementSource(audio);
      src.connect(analyser);
      analyser.connect(ctx.destination);
      td = new Uint8Array(analyser.fftSize);
      fd = new Uint8Array(analyser.frequencyBinCount);
      graph = 1;
    } catch (e) { graph = -1; }
  }
  function play(s) {
    if (!s) return;
    ensureGraph();
    if (ctx && ctx.state === 'suspended') { ctx.resume().catch(function () {}); }
    if (!current || current.id !== s.id) {
      current = s;
      audio.src = s.src;
      try { audio.currentTime = 0; } catch (e) {}
      emit('change');
    }
    var p = audio.play();
    if (p && p.catch) p.catch(function () {});
  }
  function pause() { audio.pause(); }
  function toggle(s) {
    if (s && (!current || current.id !== s.id)) { play(s); return; }
    if (audio.paused) play(current || s || samples[0]); else pause();
  }
  function step(dir) {
    var i = current ? samples.indexOf(current) : -1;
    play(samples[(i + dir + samples.length) % samples.length]);
  }
  ['play', 'pause', 'ended', 'timeupdate'].forEach(function (ev) {
    audio.addEventListener(ev, function () { emit(ev === 'timeupdate' ? 'time' : ev); });
  });
  // sandboxed viewers can refuse a direct media URL but allow fetch from the same origin
  var blobTried = {};
  audio.addEventListener('error', function () {
    var s = current;
    if (!s || blobTried[s.id] || !window.fetch) return;
    blobTried[s.id] = true;
    fetch(s.src).then(function (r) { return r.blob(); }).then(function (b) {
      if (current !== s) return;
      audio.src = URL.createObjectURL(b);
      var p = audio.play();
      if (p && p.catch) p.catch(function () {});
    }).catch(function () {});
  });

  function update() {
    if (!current || audio.paused) {
      level *= .9;
      for (var b = 0; b < 8; b++) bands[b] *= .88;
      return;
    }
    if (graph === 1) {
      analyser.getByteTimeDomainData(td);
      var sum = 0;
      for (var i = 0; i < td.length; i++) { var v = (td[i] - 128) / 128; sum += v * v; }
      var target = Math.min(1, Math.sqrt(sum / td.length) * 3.6);
      level += (target - level) * (target > level ? .55 : .14);
      analyser.getByteFrequencyData(fd);
      var edges = [2, 4, 8, 14, 24, 40, 70, 120, 220];
      for (var k = 0; k < 8; k++) {
        var s = 0, n = 0;
        for (var j = edges[k]; j < edges[k + 1]; j++) { s += fd[j]; n++; }
        var bv = n ? s / n / 255 : 0;
        bands[k] += (bv - bands[k]) * .4;
      }
    } else {
      // no analyser (older browser): drive visuals from the pre-computed peaks
      var pk = current.peaks, t = audio.currentTime / (current.dur || 1);
      var pv = pk[Math.min(pk.length - 1, Math.floor(t * pk.length))] || 0;
      level += (pv * .85 - level) * .25;
      for (var q = 0; q < 8; q++) bands[q] += ((pv * (.5 + .5 * Math.sin(performance.now() / 90 + q))) - bands[q]) * .3;
    }
  }

  var Voice = window.Voice = {
    samples: samples, CATS: CATS, ORDER: ORDER, byId: byId, fmt: fmt, audio: audio,
    play: play, pause: pause, toggle: toggle, step: step, update: update,
    on: function (fn) { subs.push(fn); },
    get current() { return current; },
    get playing() { return !!current && !audio.paused; },
    get level() { return level; },
    get bands() { return bands; },
    timeData: function () { return (graph === 1 && current && !audio.paused) ? td : null; }
  };

  /* ---------------- constellation chart ---------------- */
  var chart = document.getElementById('chart');
  var chartApi = { visible: false, draw: function () {} };
  Voice.chart = chartApi;
  if (chart && samples.length) (function () {
    var cv = chart.querySelector('canvas'), g = cv.getContext('2d');
    var tip = chart.querySelector('.chart__tip');
    var W = 0, H = 0, R = 0, cx = 0, cy = 0, dpr = 1;
    var rot = -Math.PI / 2 - .35, rotTarget = null, hover = null;

    // seeded layout: sector size follows how many samples each category has
    var seed = 1989;
    var rnd = function () { seed = (seed * 1664525 + 1013904223) >>> 0; return seed / 4294967296; };
    var counts = {}, weights = 0, sectors = {};
    ORDER.forEach(function (c) { counts[c] = samples.filter(function (s) { return s.cat === c; }).length; weights += Math.max(3, counts[c]); });
    var a0 = 0;
    ORDER.forEach(function (c) {
      var span = Math.PI * 2 * Math.max(3, counts[c]) / weights;
      sectors[c] = { a: a0, b: a0 + span, mid: a0 + span / 2 };
      a0 += span;
    });
    var stars = [];
    ORDER.forEach(function (c) {
      var sec = sectors[c], list = samples.filter(function (s) { return s.cat === c; });
      list.forEach(function (s) {
        var best = null;
        for (var tries = 0; tries < 60; tries++) {
          var ang = sec.a + .1 + rnd() * (sec.b - sec.a - .2);
          var rad = .26 + rnd() * .62;
          var x = Math.cos(ang) * rad, y = Math.sin(ang) * rad, ok = true;
          for (var k = 0; k < stars.length; k++) {
            var dx = stars[k].bx - x, dy = stars[k].by - y;
            if (dx * dx + dy * dy < .016) { ok = false; break; }
          }
          best = { ang: ang, rad: rad, bx: x, by: y };
          if (ok) break;
        }
        stars.push({ s: s, cat: c, ang: best.ang, rad: best.rad, bx: best.bx, by: best.by, x: 0, y: 0, tw: rnd() * 6.28, size: 2.2 + Math.min(1, s.dur / 32) * 2.4, ring: 0 });
      });
    });
    // constellation lines: minimum spanning tree per category
    var links = [];
    ORDER.forEach(function (c) {
      var st = stars.filter(function (x) { return x.cat === c; });
      if (st.length < 2) return;
      var inTree = [st[0]], rest = st.slice(1);
      while (rest.length) {
        var bd = 1e9, bi = 0, bj = 0;
        for (var i = 0; i < inTree.length; i++) for (var j = 0; j < rest.length; j++) {
          var dx = inTree[i].bx - rest[j].bx, dy = inTree[i].by - rest[j].by, d = dx * dx + dy * dy;
          if (d < bd) { bd = d; bi = i; bj = j; }
        }
        links.push([inTree[bi], rest[bj], c]);
        inTree.push(rest[bj]); rest.splice(bj, 1);
      }
    });

    function resize() {
      var r = cv.getBoundingClientRect();
      dpr = Math.min(window.devicePixelRatio || 1, 2);
      W = r.width; H = r.height;
      cv.width = Math.round(W * dpr); cv.height = Math.round(H * dpr);
      cx = W / 2; cy = H / 2; R = Math.min(W, H) / 2 - 34;
    }
    resize();
    if (window.ResizeObserver) new ResizeObserver(resize).observe(cv); else window.addEventListener('resize', resize);

    function place() {
      for (var i = 0; i < stars.length; i++) {
        var st = stars[i], a = st.ang + rot;
        st.x = cx + Math.cos(a) * st.rad * R;
        st.y = cy + Math.sin(a) * st.rad * R;
      }
    }
    function pick(mx, my) {
      var best = null, bd = 26 * 26;
      for (var i = 0; i < stars.length; i++) {
        var dx = stars[i].x - mx, dy = stars[i].y - my, d = dx * dx + dy * dy;
        if (d < bd) { bd = d; best = stars[i]; }
      }
      return best;
    }
    function rgba(hex, a) {
      var n = parseInt(hex.slice(1), 16);
      return 'rgba(' + (n >> 16 & 255) + ',' + (n >> 8 & 255) + ',' + (n & 255) + ',' + a + ')';
    }
    function showTip(st) {
      if (!st) { tip.classList.remove('is-on'); return; }
      tip.innerHTML = '';
      var t = document.createElement('span'); t.textContent = st.s.title;
      var sm = document.createElement('small'); sm.textContent = CATS[st.cat].ko + ' · ' + st.s.tags.join(' · ');
      tip.appendChild(sm); tip.appendChild(t);
      tip.style.left = st.x + 'px'; tip.style.top = st.y + 'px';
      tip.classList.add('is-on');
    }

    cv.addEventListener('pointermove', function (e) {
      if (e.pointerType === 'touch') return;
      var r = cv.getBoundingClientRect();
      var st = pick(e.clientX - r.left, e.clientY - r.top);
      if (st !== hover) { hover = st; showTip(st); }
      cv.style.cursor = st ? 'pointer' : 'crosshair';
      document.dispatchEvent(new CustomEvent('cursorlabel', { detail: st ? 'PLAY' : '' }));
    });
    cv.addEventListener('pointerleave', function () {
      hover = null; showTip(null);
      document.dispatchEvent(new CustomEvent('cursorlabel', { detail: '' }));
    });
    cv.addEventListener('click', function (e) {
      var r = cv.getBoundingClientRect();
      var st = pick(e.clientX - r.left, e.clientY - r.top);
      chart.classList.add('is-touched');
      if (st) Voice.toggle(st.s);
    });

    Voice.on(function (type, cur) {
      if (type === 'change' && cur && cur.id !== 'greet' && sectors[cur.cat]) {
        var sec = sectors[cur.cat];
        // bring the playing constellation to the top of the chart
        var want = -Math.PI / 2 - sec.mid;
        var d = want - rot;
        d = Math.atan2(Math.sin(d), Math.cos(d));
        rotTarget = rot + d;
      }
    });

    var t0 = performance.now();
    chartApi.draw = function (now) {
      if (!chartApi.visible) return;
      var t = (now - t0) / 1000;
      if (rotTarget !== null) {
        rot += (rotTarget - rot) * .06;
        if (Math.abs(rotTarget - rot) < .001) rotTarget = null;
      } else if (!Voice.playing) {
        rot += .0007;
      }
      place();
      var lvl = Voice.level, cur = Voice.current;
      g.setTransform(dpr, 0, 0, dpr, 0, 0);
      g.clearRect(0, 0, W, H);

      // planisphere
      var bg = g.createRadialGradient(cx, cy, R * .1, cx, cy, R * 1.08);
      bg.addColorStop(0, 'rgba(60,70,160,.16)');
      bg.addColorStop(.7, 'rgba(20,24,70,.10)');
      bg.addColorStop(1, 'rgba(6,9,25,0)');
      g.fillStyle = bg; g.beginPath(); g.arc(cx, cy, R * 1.08, 0, Math.PI * 2); g.fill();
      g.lineWidth = 1;
      for (var ring = 1; ring <= 4; ring++) {
        g.strokeStyle = 'rgba(246,239,228,' + (ring === 4 ? .22 : .07) + ')';
        g.setLineDash(ring === 4 ? [] : [2, 6]);
        g.beginPath(); g.arc(cx, cy, R * ring / 4, 0, Math.PI * 2); g.stroke();
      }
      g.setLineDash([]);
      // ticks on the outer ring
      for (var tk = 0; tk < 72; tk++) {
        var ta = rot + tk / 72 * Math.PI * 2, long = tk % 6 === 0;
        g.strokeStyle = 'rgba(246,239,228,' + (long ? .35 : .14) + ')';
        g.beginPath();
        g.moveTo(cx + Math.cos(ta) * R, cy + Math.sin(ta) * R);
        g.lineTo(cx + Math.cos(ta) * (R + (long ? 9 : 5)), cy + Math.sin(ta) * (R + (long ? 9 : 5)));
        g.stroke();
      }
      // sector dividers + labels
      g.font = '500 10px "IBM Plex Mono", monospace';
      g.textAlign = 'center'; g.textBaseline = 'middle';
      ORDER.forEach(function (c) {
        var sec = sectors[c], aa = sec.a + rot;
        g.strokeStyle = 'rgba(246,239,228,.08)';
        g.beginPath(); g.moveTo(cx + Math.cos(aa) * R * .18, cy + Math.sin(aa) * R * .18); g.lineTo(cx + Math.cos(aa) * R, cy + Math.sin(aa) * R); g.stroke();
        var ma = sec.mid + rot, lr = R + 21;
        var active = cur && cur.cat === c;
        g.save();
        g.translate(cx + Math.cos(ma) * lr, cy + Math.sin(ma) * lr);
        var rotText = ma + Math.PI / 2;
        if (Math.sin(ma) > 0) rotText += Math.PI;
        g.rotate(rotText);
        g.fillStyle = active ? CATS[c].color : 'rgba(179,187,220,.75)';
        g.fillText(CATS[c].en, 0, 0);
        g.restore();
      });

      // constellation lines
      for (var li = 0; li < links.length; li++) {
        var L = links[li], on = cur && cur.cat === L[2];
        g.strokeStyle = rgba(CATS[L[2]].color, on ? .55 + lvl * .4 : .2);
        g.lineWidth = on ? 1.3 : .8;
        g.beginPath(); g.moveTo(L[0].x, L[0].y); g.lineTo(L[1].x, L[1].y); g.stroke();
      }

      // beam to the playing star
      var curStar = null;
      if (cur) for (var q = 0; q < stars.length; q++) if (stars[q].s === cur) { curStar = stars[q]; break; }
      if (curStar) {
        var grad = g.createLinearGradient(cx, cy, curStar.x, curStar.y);
        grad.addColorStop(0, 'rgba(255,226,166,0)');
        grad.addColorStop(1, rgba(CATS[curStar.cat].color, .5 + lvl * .5));
        g.strokeStyle = grad; g.lineWidth = 1.2;
        g.beginPath(); g.moveTo(cx, cy); g.lineTo(curStar.x, curStar.y); g.stroke();
      }

      // stars
      g.globalCompositeOperation = 'lighter';
      for (var i = 0; i < stars.length; i++) {
        var st = stars[i], col = CATS[st.cat].color;
        var isCur = st === curStar, isHover = st === hover;
        var tw = .75 + .25 * Math.sin(t * 1.6 + st.tw);
        var r = st.size * (isHover ? 1.5 : 1) * (isCur ? 1.4 + lvl * 1.6 : 1);
        var glowR = r * (isCur ? 6 + lvl * 10 : 4.2);
        var gg = g.createRadialGradient(st.x, st.y, 0, st.x, st.y, glowR);
        gg.addColorStop(0, rgba(col, (isCur ? .55 : .3) * tw));
        gg.addColorStop(1, rgba(col, 0));
        g.fillStyle = gg; g.beginPath(); g.arc(st.x, st.y, glowR, 0, Math.PI * 2); g.fill();
        g.fillStyle = rgba('#fff7ea', .95 * tw);
        g.beginPath(); g.arc(st.x, st.y, r * .55, 0, Math.PI * 2); g.fill();
        if (isCur || isHover) {
          // four-point spark
          var sp = r * (isCur ? 3.2 + lvl * 5 : 2.6);
          g.strokeStyle = rgba(col, .8);
          g.lineWidth = 1;
          g.beginPath(); g.moveTo(st.x - sp, st.y); g.lineTo(st.x + sp, st.y); g.moveTo(st.x, st.y - sp); g.lineTo(st.x, st.y + sp); g.stroke();
        }
      }
      g.globalCompositeOperation = 'source-over';

      // ripples from the playing star
      if (curStar && Voice.playing) {
        for (var rp = 0; rp < 3; rp++) {
          var ph = ((t * .8 + rp / 3) % 1);
          g.strokeStyle = rgba(CATS[curStar.cat].color, (1 - ph) * (.35 + lvl * .5));
          g.lineWidth = 1;
          g.beginPath(); g.arc(curStar.x, curStar.y, 8 + ph * (40 + lvl * 60), 0, Math.PI * 2); g.stroke();
        }
      }

      // center: the morning star
      var cs = 7 + lvl * 16 + Math.sin(t * 2) * .8;
      g.globalCompositeOperation = 'lighter';
      var cg = g.createRadialGradient(cx, cy, 0, cx, cy, cs * 4);
      cg.addColorStop(0, 'rgba(255,226,166,.7)'); cg.addColorStop(1, 'rgba(255,226,166,0)');
      g.fillStyle = cg; g.beginPath(); g.arc(cx, cy, cs * 4, 0, Math.PI * 2); g.fill();
      g.globalCompositeOperation = 'source-over';
      g.fillStyle = '#fff6e2';
      g.beginPath();
      g.moveTo(cx, cy - cs * 1.6);
      g.quadraticCurveTo(cx + cs * .18, cy - cs * .18, cx + cs * 1.6, cy);
      g.quadraticCurveTo(cx + cs * .18, cy + cs * .18, cx, cy + cs * 1.6);
      g.quadraticCurveTo(cx - cs * .18, cy + cs * .18, cx - cs * 1.6, cy);
      g.quadraticCurveTo(cx - cs * .18, cy - cs * .18, cx, cy - cs * 1.6);
      g.fill();
      if (hover) { tip.style.left = hover.x + 'px'; tip.style.top = hover.y + 'px'; }
    };
  })();

  /* ---------------- player panel ---------------- */
  var player = document.getElementById('player');
  var playerApi = { draw: function () {} };
  Voice.player = playerApi;
  if (player) (function () {
    var title = player.querySelector('.player__title'), tags = player.querySelector('.player__tags');
    var catEl = player.querySelector('.player__cat'), catTxt = catEl.querySelector('span'), dot = catEl.querySelector('i');
    var curEl = player.querySelector('.player__cur'), durEl = player.querySelector('.player__dur');
    var wave = player.querySelector('.player__wave'), g = wave.getContext('2d');
    var dpr = 1, W = 0, H = 0;
    function resize() {
      var r = wave.getBoundingClientRect(); dpr = Math.min(window.devicePixelRatio || 1, 2);
      W = r.width; H = r.height; wave.width = Math.round(W * dpr); wave.height = Math.round(H * dpr);
    }
    resize();
    if (window.ResizeObserver) new ResizeObserver(resize).observe(wave);

    player.addEventListener('click', function (e) {
      var b = e.target.closest('[data-act]');
      if (!b) return;
      var act = b.getAttribute('data-act');
      if (act === 'toggle') Voice.toggle(Voice.current || samples[0]);
      else if (act === 'prev') Voice.step(-1);
      else if (act === 'next') Voice.step(1);
    });
    wave.addEventListener('click', function (e) {
      if (!Voice.current) { Voice.play(samples[0]); return; }
      var r = wave.getBoundingClientRect();
      var p = Math.min(1, Math.max(0, (e.clientX - r.left) / r.width));
      if (isFinite(audio.duration)) audio.currentTime = p * audio.duration;
      if (audio.paused) Voice.play(Voice.current);
    });

    function setInfo(s) {
      var c = CATS[s.cat];
      catTxt.textContent = c.ko + ' · ' + c.en;
      dot.style.background = c.color; dot.style.color = c.color;
      title.textContent = s.title;
      tags.textContent = s.tags.join(' · ');
      durEl.textContent = fmt(s.dur);
      player.style.setProperty('--cc', c.color);
    }
    Voice.on(function (type, s) {
      if (!s) return;
      if (type === 'change') setInfo(s);
      if (type === 'time') curEl.textContent = fmt(audio.currentTime);
      player.classList.toggle('is-playing', Voice.playing);
    });

    var idlePeaks = (function () { var a = []; for (var i = 0; i < 96; i++) a.push(.18 + .5 * Math.abs(Math.sin(i * .37) * Math.cos(i * .13))); return a; })();
    playerApi.draw = function (now) {
      if (!Voice.chart.visible) return;
      var s = Voice.current, pk = s ? s.peaks : idlePeaks;
      var prog = s && isFinite(audio.duration) && audio.duration ? audio.currentTime / audio.duration : 0;
      var col = s ? CATS[s.cat].color : '#ffe2a6';
      g.setTransform(dpr, 0, 0, dpr, 0, 0);
      g.clearRect(0, 0, W, H);
      var n = pk.length, bw = W / n, mid = H / 2, lvl = Voice.level;
      for (var i = 0; i < n; i++) {
        var u = i / n, v = pk[i];
        if (!s) v *= .45 + .25 * Math.sin(now / 600 + i * .3);
        var near = s && Math.abs(u - prog) < .02 ? lvl * .6 : 0;
        var h = Math.max(1.5, (v + near) * (H * .46));
        g.fillStyle = u <= prog ? col : 'rgba(246,239,228,.24)';
        var x = i * bw + bw * .2;
        g.fillRect(x, mid - h, Math.max(1, bw * .6), h * 2);
      }
      if (s) {
        g.fillStyle = '#fff';
        g.fillRect(prog * W, 4, 1.5, H - 8);
      }
    };
  })();

  /* ---------------- track list ---------------- */
  var tracks = document.getElementById('tracks');
  if (tracks && samples.length) {
    ORDER.forEach(function (c) {
      var list = samples.filter(function (s) { return s.cat === c; });
      var col = document.createElement('div');
      col.className = 'tracks__col';
      col.setAttribute('data-cat', c);
      var h = document.createElement('h4');
      var hn = document.createElement('span'); hn.textContent = CATS[c].ko;
      var hc = document.createElement('span'); hc.textContent = String(list.length).padStart(2, '0');
      h.appendChild(hn); h.appendChild(hc); col.appendChild(h);
      list.forEach(function (s) {
        var b = document.createElement('button');
        b.type = 'button'; b.className = 'track'; b.setAttribute('data-id', s.id);
        b.setAttribute('aria-label', CATS[c].ko + ' 샘플 ' + s.title + ' 재생');
        var d = document.createElement('i'); d.className = 'track__dot';
        var t = document.createElement('span'); t.textContent = s.title;
        var du = document.createElement('span'); du.className = 'track__d'; du.textContent = fmt(s.dur);
        b.appendChild(d); b.appendChild(t); b.appendChild(du);
        col.appendChild(b);
      });
      tracks.appendChild(col);
    });
    tracks.addEventListener('click', function (e) {
      var b = e.target.closest('.track');
      if (b) Voice.toggle(byId[b.getAttribute('data-id')]);
    });
  }

  /* ---------------- play buttons, ON AIR, mini player ---------------- */
  document.addEventListener('click', function (e) {
    var b = e.target.closest('[data-play]');
    if (!b) return;
    e.preventDefault();
    Voice.toggle(byId[b.getAttribute('data-play')]);
  });
  var onair = document.querySelector('.onair');
  var mini = document.getElementById('mini');
  var miniApi = { draw: function () {} };
  Voice.mini = miniApi;
  var hideTimer = 0;
  Voice.on(function (type, s) {
    var playing = Voice.playing;
    document.querySelectorAll('[data-play]').forEach(function (b) {
      b.classList.toggle('is-playing', playing && s && b.getAttribute('data-play') === s.id);
    });
    document.querySelectorAll('.track').forEach(function (b) {
      b.classList.toggle('is-current', !!s && b.getAttribute('data-id') === s.id);
    });
    if (onair) onair.classList.toggle('is-live', playing);
    if (!mini || !s) return;
    if (type === 'change' || type === 'play') {
      clearTimeout(hideTimer);
      mini.hidden = false;
      mini.querySelector('.mini__t').textContent = s.title;
      mini.querySelector('.mini__s').textContent = CATS[s.cat].en + ' · ' + s.tags.join(' · ');
      mini.style.setProperty('--cc', CATS[s.cat].color);
      if (window.gsap && type === 'change') gsap.fromTo(mini, { y: 40, opacity: 0 }, { y: 0, opacity: 1, duration: .6, ease: 'back.out(1.6)' });
    }
    mini.classList.toggle('is-playing', playing);
    if (type === 'ended') hideTimer = setTimeout(function () { mini.hidden = true; }, 2600);
  });
  if (mini) {
    mini.querySelector('.mini__btn').addEventListener('click', function () { Voice.toggle(Voice.current); });
    mini.querySelector('.mini__x').addEventListener('click', function () {
      clearTimeout(hideTimer);
      Voice.pause();
      var hide = function () { mini.hidden = true; mini.style.opacity = ''; mini.style.transform = ''; };
      if (window.gsap) gsap.to(mini, { y: 40, opacity: 0, duration: .35, ease: 'power2.in', onComplete: hide });
      else hide();
    });
    var eq = mini.querySelector('.mini__eq'), eg = eq.getContext('2d'), prog = mini.querySelector('.mini__prog');
    miniApi.draw = function () {
      if (mini.hidden) return;
      eg.clearRect(0, 0, 72, 28);
      var col = Voice.current ? CATS[Voice.current.cat].color : '#ffe2a6';
      for (var i = 0; i < 8; i++) {
        var v = Math.max(.08, Voice.bands[i] * 1.25);
        var h = Math.min(26, v * 26);
        eg.fillStyle = col;
        eg.fillRect(i * 9 + 1, 27 - h, 6, h);
      }
      var p = isFinite(audio.duration) && audio.duration ? audio.currentTime / audio.duration : 0;
      prog.style.transform = 'scaleX(' + p + ')';
    };
  }
})();
