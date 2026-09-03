/* 스윙자로 — 화면 로직
 *
 * 영상은 브라우저 안에서만 다룬다(URL.createObjectURL). 서버로 올리지 않는다.
 * 저장은 localStorage 에 'swingjaro:' 접두사로만 한다. 이 기기 밖으로 나가지 않는다.
 */
(function () {
  'use strict';

  var D = window.SwingData, F = window.SwingFaults, A = window.SwingAnalyze;
  var LS_LAST = 'swingjaro:last';
  var LS_HIST = 'swingjaro:history';
  var LS_PROF = 'swingjaro:profile';   // 내 클럽 거리 등
  var LS_FOCUS = 'swingjaro:focus';    // 지금 집중해서 고치는 문제 하나
  var FPS = 60; // 프레임 단위 이동에 쓰는 가정값. 대부분의 폰 영상이 30 또는 60이다.

  var S = {
    club: 'mid', view: 'dtl', sensitivity: 'normal', handed: 'right',
    autoUsed: false,   // 이번 분석에 자동 인식이 쓰였는지
    videoURL: null, duration: 0,
    frames: {},          // { P1:{t:초, marks:{head:{x,y},...}}, ... }
    curFrame: null,      // 지금 마킹 중인 프레임 id
    viewFrame: null,     // 지금 화면에 띄워 놓은 프레임 id (진단 화면에서 씀)
    markQueue: [],       // 남은 관절 목록
    report: null,
    lastRecordId: null,   // 방금 분석한 회차 — 결과를 여기에 붙인다
    logFilter: null, logMode: 'carry',
    profile: { carries: {} },   // 내 기준 거리
    shape: 'draw',              // 내가 치고 싶은 구질
    askOpen: null,              // 펼쳐놓은 증상
    focus: null                 // { faultId, since, club, view }
  };

  var $ = function (s) { return document.querySelector(s); };
  var el = {};
  ['steps','club-grid','view-grid','shoot-guide','shoot-guide-2','sens-seg','go-video',
   'file','drop','video','canvas','stage-in','stage-badge','seek','tcode','play','rate-seg',
   'frames','mark-panel','mark-frame','mark-progress','mark-target','mark-undo','mark-copy',
   'mark-clear','mark-done','go-report','mark-need','report','go-fit','flight-grid','traj-seg',
   'contact-seg','carry','go-fitresult','fitreport','btn-reset','main',
   'stage','stage-slot-mark','stage-slot-report','report-frames',
   'hand-seg','mark-auto','auto-note','btn-log','logbox','outcome-slot',
   'mydist','mydist-sum','mydist-grid',
   'btn-shape','btn-ask','shape-grid','shape-seg','shapebox','ask-q','askbox',
   'install-card','install-btn','install-steps','install-steps-b'].forEach(function (id) {
    el[id] = document.getElementById(id);
  });

  var SCREENS = ['setup','video','mark','report','fit','shape','ask','log'];
  function show(step) {
    SCREENS.forEach(function (s) {
      var n = document.getElementById('s-' + s);
      if (n) n.hidden = (s !== step);
    });
    var hit = false;
    Array.prototype.forEach.call(el.steps.children, function (li) {
      var s = li.dataset.step;
      li.classList.toggle('on', s === step);
      li.classList.toggle('done', !hit && s !== step);
      if (s === step) hit = true;
    });
    // 무대(영상+캔버스)는 하나뿐이라 필요한 화면으로 옮겨 붙인다.
    var slot = step === 'mark' ? el['stage-slot-mark']
             : step === 'report' ? el['stage-slot-report'] : null;
    if (slot && el.stage.parentNode !== slot) slot.appendChild(el.stage);
    el.stage.hidden = !slot;

    window.scrollTo({ top: 0, behavior: 'smooth' });
    if (slot) requestAnimationFrame(fitCanvas);
  }

  function esc(s) {
    return String(s).replace(/[&<>"']/g, function (c) {
      return { '&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;' }[c];
    });
  }
  function ytURL(q) { return 'https://www.youtube.com/results?search_query=' + encodeURIComponent(q); }

  /* ── 1. 셋업 화면 ─────────────────────────────────────────────── */
  function buildSetup() {
    el['club-grid'].innerHTML = D.CLUB_ORDER.map(function (id) {
      var c = D.CLUBS[id];
      return '<button type="button" class="pick' + (id === S.club ? ' on' : '') + '" data-club="' + id + '">' +
        '<span class="em">' + c.emoji + '</span>' + esc(c.label) +
        '<span class="sm">플레인 ' + c.planeDeg + '°</span></button>';
    }).join('');

    el['view-grid'].innerHTML = ['dtl','fo'].map(function (id) {
      var v = D.VIEWS[id];
      return '<button type="button" class="pick' + (id === S.view ? ' on' : '') + '" data-view="' + id + '">' +
        '<span class="em">' + v.emoji + '</span>' + esc(v.label) +
        '<span class="sm">' + esc(v.desc) + '</span></button>';
    }).join('');

    renderGuide();
  }

  function renderGuide() {
    var v = D.VIEWS[S.view];
    var html = '<h4>📷 ' + esc(v.label) + ' 촬영 가이드</h4><ul>' +
      v.guide.map(function (g) { return '<li>' + esc(g) + '</li>'; }).join('') +
      '<li>스윙 시작 1초 전부터 피니시 1초 후까지 넉넉히 담아주세요</li></ul>';
    el['shoot-guide'].innerHTML = html;
    el['shoot-guide-2'].innerHTML = html;
  }

  el['club-grid'].addEventListener('click', function (e) {
    var b = e.target.closest('[data-club]'); if (!b) return;
    S.club = b.dataset.club;
    Array.prototype.forEach.call(this.children, function (n) { n.classList.toggle('on', n === b); });
  });
  el['view-grid'].addEventListener('click', function (e) {
    var b = e.target.closest('[data-view]'); if (!b) return;
    if (S.view !== b.dataset.view) { S.frames = {}; S.report = null; }
    S.view = b.dataset.view;
    Array.prototype.forEach.call(this.children, function (n) { n.classList.toggle('on', n === b); });
    renderGuide(); buildFrames();
  });
  el['hand-seg'].addEventListener('click', function (e) {
    var b = e.target.closest('[data-h]'); if (!b) return;
    S.handed = b.dataset.h;
    Array.prototype.forEach.call(this.children, function (n) { n.classList.toggle('on', n === b); });
  });
  el['sens-seg'].addEventListener('click', function (e) {
    var b = e.target.closest('[data-v]'); if (!b) return;
    S.sensitivity = b.dataset.v;
    Array.prototype.forEach.call(this.children, function (n) { n.classList.toggle('on', n === b); });
  });
  /* ── 내 클럽 거리 ─────────────────────────────────────────────
   * 혼자 쓰는 앱이니 비교 기준을 "아마추어 평균"이 아니라 내 숫자로 둔다.
   */
  function loadProfile() {
    try {
      var p = JSON.parse(localStorage.getItem(LS_PROF) || 'null');
      if (p && p.carries) { S.profile = p; if (p.shape) S.shape = p.shape; }
    } catch (e) { /* 무시 */ }
  }
  function saveProfile() {
    try { localStorage.setItem(LS_PROF, JSON.stringify(S.profile)); } catch (e) { /* 무시 */ }
  }
  function buildMyDist() {
    el['mydist-grid'].innerHTML = D.CLUB_ORDER.map(function (id) {
      var c = D.CLUBS[id], v = S.profile.carries[id] || '';
      return '<label class="mdrow"><span>' + c.emoji + ' ' + esc(c.label) + '</span>' +
        '<input type="number" inputmode="numeric" data-dist-club="' + id + '" value="' + v +
        '" placeholder="' + c.refCarry + '" min="10" max="400" /><em>yd</em></label>';
    }).join('');
    updateMyDistSummary();
  }
  function updateMyDistSummary() {
    var n = Object.keys(S.profile.carries).filter(function (k) { return S.profile.carries[k] > 0; }).length;
    el['mydist-sum'].textContent = n ? n + '개 클럽 입력됨' : '아직 비어 있음 — 평균값 사용 중';
  }
  el['mydist-grid'].addEventListener('change', function (e) {
    var i = e.target.closest('[data-dist-club]'); if (!i) return;
    var v = parseFloat(i.value);
    if (isNaN(v) || v <= 0) delete S.profile.carries[i.dataset.distClub];
    else S.profile.carries[i.dataset.distClub] = Math.round(v);
    saveProfile(); updateMyDistSummary();
  });

  /* ── 목표 구질 ────────────────────────────────────────────────
   * 고른 구질에 따라 가이드가 달라지고, 다운스윙 플레인 판정도 그쪽으로 살짝 옮긴다.
   * 드로우를 치려면 인-아웃이 필요하니 약간 안쪽은 문제가 아니라 목표에 부합한다.
   */
  function buildShapeGrid() {
    var SH = window.SwingShot;
    el['shape-grid'].innerHTML = SH.SHAPE_ORDER.map(function (id) {
      var x = SH.SHAPES[id];
      return '<button type="button" class="pick' + (id === S.shape ? ' on' : '') + '" data-shape="' + id + '">' +
        '<span class="em">' + x.emoji + '</span>' + esc(x.label) +
        '<span class="sm">' + esc(SH.mirror(x.one, S.handed)) + '</span></button>';
    }).join('');
  }
  el['shape-grid'].addEventListener('click', function (e) {
    var b = e.target.closest('[data-shape]'); if (!b) return;
    S.shape = b.dataset.shape;
    S.profile.shape = S.shape; saveProfile();
    Array.prototype.forEach.call(this.children, function (n) { n.classList.toggle('on', n === b); });
  });

  function showShape() {
    var SH = window.SwingShot;
    el['shape-seg'].innerHTML = SH.SHAPE_ORDER.map(function (id) {
      return '<button type="button" data-shape2="' + id + '"' + (id === S.shape ? ' class="on"' : '') + '>' +
        SH.SHAPES[id].emoji + ' ' + esc(SH.SHAPES[id].label) + '</button>';
    }).join('');
    el.shapebox.innerHTML = SH.renderGuide(S.shape, S.handed, S.report);
    show('shape');
  }
  el['shape-seg'].addEventListener('click', function (e) {
    var b = e.target.closest('[data-shape2]'); if (!b) return;
    S.shape = b.dataset.shape2;
    S.profile.shape = S.shape; saveProfile();
    buildShapeGrid(); showShape();
  });
  el['btn-shape'].addEventListener('click', showShape);

  /* ── 증상 문의 ────────────────────────────────────────────────
   * AI 상담이 아니다. 미리 정리해 둔 증상 사전을 찾아 주고, 마지막 분석에서
   * 그 원인이 실제로 잡혔는지 대조해 준다.
   */
  function showAsk() {
    el.askbox.innerHTML = window.SwingShot.renderAsk(el['ask-q'].value, S.handed, S.report, S.askOpen);
    show('ask');
  }
  el['btn-ask'].addEventListener('click', function () { S.askOpen = null; showAsk(); });
  el['ask-q'].addEventListener('input', function () {
    el.askbox.innerHTML = window.SwingShot.renderAsk(this.value, S.handed, S.report, S.askOpen);
  });
  el.askbox.addEventListener('click', function (e) {
    var head = e.target.closest('[data-sym]'); if (!head) return;
    var card = head.parentNode, id = head.dataset.sym;
    S.askOpen = card.classList.contains('open') ? null : id;
    card.classList.toggle('open');
  });

  /* ── 바탕화면 바로가기 ────────────────────────────────────────
   * 아이폰 사파리는 설치 이벤트가 없어서 버튼만 두면 아무 일도 안 일어난다.
   * 그래서 버튼과 수동 안내를 항상 같이 둔다.
   */
  function renderInstall() {
    var I = window.SwingInstall;
    if (!I) return;
    if (I.isStandalone()) { el['install-card'].hidden = true; return; }
    el['install-card'].hidden = false;

    var plat = I.platform(), st = I.STEPS[plat];
    var ready = I.canPrompt();
    el['install-btn'].disabled = !ready;
    el['install-btn'].textContent = ready ? '바탕화면에 추가'
      : plat === 'ios' ? '아이폰은 아래 방법으로 추가합니다'
      : '준비 중… 아래 방법으로도 됩니다';
    // 아이폰은 버튼이 영영 활성화되지 않으므로 안내를 처음부터 펼쳐 둔다.
    if (plat === 'ios') el['install-steps'].open = true;

    el['install-steps-b'].innerHTML =
      '<div class="ist"><b>' + esc(st.title) + '</b><p>' + esc(st.note) + '</p><ol class="steps-num">' +
      st.steps.map(function (x) { return '<li>' + x + '</li>'; }).join('') + '</ol></div>' +
      '<p class="hint">설치해도 기록은 그대로 이 기기에 남습니다. 브라우저에서 열던 것과 같은 데이터입니다.</p>';
  }
  el['install-btn'].addEventListener('click', function () {
    window.SwingInstall.install().then(function (r) {
      if (r === 'accepted') {
        el['install-card'].innerHTML = '<div class="install-h">✅ 추가했습니다</div>' +
          '<p>홈 화면(또는 바탕화면)의 스윙자로 아이콘으로 바로 여세요.</p>';
      } else if (r === 'unavailable') {
        el['install-steps'].open = true;
      }
    });
  });
  if (window.SwingInstall) window.SwingInstall.onChange(renderInstall);

  el['go-video'].addEventListener('click', function () { show('video'); });
  el['btn-reset'].addEventListener('click', function () {
    if (!confirm('처음부터 다시 시작할까요? 지금 찍은 점들은 사라집니다.')) return;
    S.frames = {}; S.report = null; S.curFrame = null; S.viewFrame = null;
    buildFrames(); show('setup');
  });

  /* ── 2. 영상 ─────────────────────────────────────────────────── */
  el.drop.addEventListener('click', function () { el.file.click(); });
  el.file.addEventListener('change', function () {
    var f = this.files && this.files[0];
    if (!f) return;
    if (S.videoURL) URL.revokeObjectURL(S.videoURL);
    S.videoURL = URL.createObjectURL(f);
    S.frames = {}; S.report = null; S.curFrame = null; S.viewFrame = null;
    el.video.src = S.videoURL;
    el.video.load();
  });
  el.video.addEventListener('loadedmetadata', function () {
    S.duration = el.video.duration || 0;
    el.seek.value = 0;
    buildFrames(); show('mark');
    setTimeout(function () { seekTo(Math.min(0.05, S.duration)); }, 60);
  });
  el.video.addEventListener('error', function () {
    if (el.video.src) alert('이 영상 형식은 브라우저가 열지 못했습니다. MP4(H.264)로 변환해 다시 시도해 주세요.');
  });

  /* ── 3. 스크러빙 ─────────────────────────────────────────────── */
  function seekTo(t) {
    t = Math.max(0, Math.min(S.duration || 0, t));
    el.video.currentTime = t;
  }
  el.seek.addEventListener('input', function () {
    el.video.pause();
    seekTo((this.value / 1000) * S.duration);
  });
  el.video.addEventListener('timeupdate', syncTime);
  el.video.addEventListener('seeked', function () { syncTime(); draw(); });
  function syncTime() {
    var t = el.video.currentTime || 0;
    el.tcode.textContent = t.toFixed(2) + 's';
    if (S.duration) el.seek.value = Math.round((t / S.duration) * 1000);
  }
  document.querySelectorAll('[data-nudge]').forEach(function (b) {
    b.addEventListener('click', function () {
      el.video.pause();
      seekTo(el.video.currentTime + (+this.dataset.nudge) / FPS);
    });
  });
  el.play.addEventListener('click', function () {
    if (el.video.paused) { el.video.play(); this.textContent = '❚❚ 일시정지'; }
    else { el.video.pause(); this.textContent = '▶ 재생'; }
  });
  el.video.addEventListener('pause', function () { el.play.textContent = '▶ 재생'; });
  el.video.addEventListener('play', function () { el.play.textContent = '❚❚ 일시정지'; });
  el['rate-seg'].addEventListener('click', function (e) {
    var b = e.target.closest('[data-r]'); if (!b) return;
    el.video.playbackRate = +b.dataset.r;
    Array.prototype.forEach.call(this.children, function (n) { n.classList.toggle('on', n === b); });
  });

  /* ── 4. 키프레임 칩 ──────────────────────────────────────────── */
  function jointList() {
    return D.VIEWS[S.view].joints;
  }
  function neededFor(fid) {
    var list = jointList().map(function (j) { return j; });
    if (fid === 'P1') list = list.concat(D.VIEWS[S.view].extra);
    return list;
  }
  function isMarked(fid) {
    var f = S.frames[fid];
    if (!f) return false;
    return neededFor(fid).every(function (j) { return f.marks[j.id]; });
  }
  function buildFrames() {
    el.frames.innerHTML = D.FRAMES.map(function (f) {
      var set = !!S.frames[f.id], done = isMarked(f.id);
      var st = done ? '✓ 완료' : set ? '점 찍기' : '미지정';
      return '<button type="button" class="fchip' + (f.required ? ' req' : '') +
        (set ? ' set' : '') + (done ? ' marked' : '') + (S.curFrame === f.id ? ' cur' : '') +
        '" data-frame="' + f.id + '"><span class="em">' + f.emoji + '</span>' +
        esc(f.label) + '<span class="st">' + st + '</span></button>';
    }).join('');
    updateReady();
  }
  function updateReady() {
    var need = D.FRAMES.filter(function (f) { return f.required; });
    var missing = need.filter(function (f) { return !isMarked(f.id); });
    el['go-report'].disabled = missing.length > 0;
    el['mark-need'].textContent = missing.length
      ? '필수 구간(*)이 남았습니다 — ' + missing.map(function (f) { return f.label; }).join(', ')
      : '선택 구간(테이크백·다운스윙)까지 찍으면 플레인 진단이 더 정확해집니다.';
  }

  el.frames.addEventListener('click', function (e) {
    var b = e.target.closest('[data-frame]'); if (!b) return;
    var fid = b.dataset.frame, def = null;
    D.FRAMES.forEach(function (f) { if (f.id === fid) def = f; });

    if (!S.frames[fid]) {
      // 아직 시각을 안 잡은 구간: 지금 보고 있는 프레임을 그 구간으로 지정한다.
      if (!confirm(def.label + ' 구간을 지금 이 프레임(' + (el.video.currentTime || 0).toFixed(2) + 's)으로 지정할까요?\n\n' + def.cue)) return;
      S.frames[fid] = { t: el.video.currentTime || 0, marks: {} };
    } else {
      seekTo(S.frames[fid].t);
    }
    startMarking(fid);
  });

  /* ── 5. 관절 마킹 ────────────────────────────────────────────── */
  function startMarking(fid) {
    S.curFrame = fid; S.viewFrame = fid;
    seekTo(S.frames[fid].t);
    var have = S.frames[fid].marks;
    S.markQueue = neededFor(fid).filter(function (j) { return !have[j.id]; });
    el['mark-panel'].hidden = false;
    autoNote('');
    renderMarkPanel();
    buildFrames();
    draw();
  }
  function renderMarkPanel() {
    if (!S.curFrame) { el['mark-panel'].hidden = true; return; }
    var def = null;
    D.FRAMES.forEach(function (f) { if (f.id === S.curFrame) def = f; });
    var total = neededFor(S.curFrame).length, left = S.markQueue.length;
    el['mark-frame'].textContent = def.emoji + ' ' + def.label + ' (' + S.frames[S.curFrame].t.toFixed(2) + 's)';
    el['mark-progress'].textContent = (total - left) + ' / ' + total;
    if (left) {
      var j = S.markQueue[0];
      el['mark-target'].innerHTML = '<span class="dot" style="background:' + j.color + '"></span>' +
        '<b>' + esc(j.label) + '</b> 위치를 영상에서 눌러주세요<small>' + esc(j.hint) + '</small>';
    } else {
      el['mark-target'].innerHTML = '<b>이 구간은 다 찍었습니다 ✓</b><small>점을 끌어서 위치를 미세 조정할 수 있습니다</small>';
    }
    el['mark-undo'].disabled = (total - left) === 0;
    var prev = prevFrameWithMarks(S.curFrame);
    el['mark-copy'].disabled = !prev;
    el['mark-copy'].textContent = prev ? (prev + ' 에서 복사') : '이전 구간에서 복사';
  }
  function prevFrameWithMarks(fid) {
    var order = D.FRAMES.map(function (f) { return f.id; });
    for (var i = order.indexOf(fid) - 1; i >= 0; i--) {
      var f = S.frames[order[i]];
      if (f && Object.keys(f.marks).length) return order[i];
    }
    return null;
  }
  el['mark-undo'].addEventListener('click', function () {
    var fid = S.curFrame; if (!fid) return;
    var all = neededFor(fid), have = S.frames[fid].marks;
    for (var i = all.length - 1; i >= 0; i--) {
      if (have[all[i].id]) { delete have[all[i].id]; break; }
    }
    S.markQueue = all.filter(function (j) { return !have[j.id]; });
    renderMarkPanel(); buildFrames(); draw();
  });
  el['mark-clear'].addEventListener('click', function () {
    if (!S.curFrame) return;
    S.frames[S.curFrame].marks = {};
    S.markQueue = neededFor(S.curFrame);
    renderMarkPanel(); buildFrames(); draw();
  });
  el['mark-copy'].addEventListener('click', function () {
    var prev = prevFrameWithMarks(S.curFrame); if (!prev) return;
    var src = S.frames[prev].marks, dst = S.frames[S.curFrame].marks;
    neededFor(S.curFrame).forEach(function (j) {
      if (!dst[j.id] && src[j.id]) dst[j.id] = { x: src[j.id].x, y: src[j.id].y };
    });
    S.markQueue = neededFor(S.curFrame).filter(function (j) { return !dst[j.id]; });
    renderMarkPanel(); buildFrames(); draw();
  });
  /* ── 자동 관절 인식 ──────────────────────────────────────────
   * 눌렀을 때만 모듈을 내려받는다. 실패해도 직접 찍기는 그대로 쓸 수 있어야 한다.
   */
  function autoNote(msg, kind) {
    el['auto-note'].hidden = !msg;
    el['auto-note'].textContent = msg || '';
    el['auto-note'].className = 'auto-note' + (kind ? ' ' + kind : '');
  }
  el['mark-auto'].addEventListener('click', function () {
    var fid = S.curFrame; if (!fid) return;
    var btn = this;
    btn.disabled = true;
    autoNote('자동 인식 준비 중…');
    global_load().then(function () {
      var lms = window.SwingPose.detect(el.video);
      if (!lms) {
        autoNote('이 프레임에서 사람을 찾지 못했습니다. 몸 전체가 화면에 들어온 프레임인지 확인하고 직접 찍어주세요.', 'bad');
        return;
      }
      var r = window.SwingPose.mapTo(S.view, lms, S.handed);
      var marks = S.frames[fid].marks, filled = 0;
      neededFor(fid).forEach(function (j) {
        if (r.marks[j.id]) { marks[j.id] = r.marks[j.id]; filled++; }
      });
      S.markQueue = neededFor(fid).filter(function (j) { return !marks[j.id]; });
      S.autoUsed = true;
      var rest = S.markQueue.map(function (j) { return j.label; }).join(', ');
      var msg = filled + '개를 자동으로 찍었습니다. 관절 "중심"을 잡은 값이라 손으로 찍은 것과 몇 도씩 다를 수 있으니, ' +
        '점을 끌어 맞춰주세요.';
      if (rest) msg += ' 클럽과 볼은 사람 관절이 아니라 모델이 못 잡습니다 — ' + rest + '은(는) 직접 찍어주세요.';
      if (r.weak.length) msg += ' 가려져서 흐릿하게 잡힌 곳: ' + r.weak.join(', ') + '.';
      autoNote(msg, r.weak.length ? 'warn' : 'ok');
      renderMarkPanel(); buildFrames(); draw();
    }).catch(function (e) {
      // 원문 오류에 URL이 그대로 붙어 나오면 읽기 어렵다. 흔한 원인부터 말한다.
      var m = (e && e.message) || '';
      var why = /fetch|network|import|Load|CORS/i.test(m)
        ? '인터넷에 연결되어 있는지, 사내망·기내 와이파이처럼 외부 접속이 막힌 곳은 아닌지 확인해 주세요.'
        : '기기가 이 기능을 지원하지 않을 수 있습니다.';
      autoNote('자동 인식을 불러오지 못했습니다. ' + why +
        ' 직접 찍으셔도 분석 결과는 똑같으니 그대로 진행하셔도 됩니다.', 'bad');
    }).then(function () { btn.disabled = false; });
  });
  function global_load() {
    if (!window.SwingPose) return Promise.reject(new Error('모듈 없음'));
    return window.SwingPose.load(function (st) { autoNote(st); });
  }

  el['mark-done'].addEventListener('click', function () {
    S.viewFrame = S.curFrame;
    S.curFrame = null; S.markQueue = [];
    el['mark-panel'].hidden = true;
    buildFrames(); draw();
  });

  /* ── 6. 캔버스 ───────────────────────────────────────────────── */
  var ctx = el.canvas.getContext('2d');
  var dragging = null;

  function fitCanvas() {
    var r = el.video.getBoundingClientRect();
    if (!r.width) return;
    var dpr = Math.min(window.devicePixelRatio || 1, 2);
    el.canvas.width = Math.round(r.width * dpr);
    el.canvas.height = Math.round(r.height * dpr);
    el.canvas.style.width = r.width + 'px';
    el.canvas.style.height = r.height + 'px';
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    draw();
  }
  window.addEventListener('resize', fitCanvas);
  el.video.addEventListener('loadeddata', fitCanvas);

  // 정규화 좌표(0~1) ↔ 캔버스 픽셀. 영상이 letterbox 되어도 맞도록 표시 영역 기준으로 계산한다.
  function box() {
    var cw = el.canvas.clientWidth, ch = el.canvas.clientHeight;
    var vw = el.video.videoWidth || 16, vh = el.video.videoHeight || 9;
    var s = Math.min(cw / vw, ch / vh);
    var w = vw * s, h = vh * s;
    return { x: (cw - w) / 2, y: (ch - h) / 2, w: w, h: h };
  }
  function toPx(p) { var b = box(); return { x: b.x + p.x * b.w, y: b.y + p.y * b.h }; }
  function toNorm(px, py) { var b = box(); return { x: (px - b.x) / b.w, y: (py - b.y) / b.h }; }

  function evPos(e) {
    var r = el.canvas.getBoundingClientRect();
    var t = e.touches && e.touches[0] ? e.touches[0] : e;
    return { x: t.clientX - r.left, y: t.clientY - r.top };
  }
  function hitJoint(pos) {
    if (!S.curFrame) return null;
    var marks = S.frames[S.curFrame].marks, best = null, bd = 18;
    Object.keys(marks).forEach(function (id) {
      var p = toPx(marks[id]), d = Math.hypot(p.x - pos.x, p.y - pos.y);
      if (d < bd) { bd = d; best = id; }
    });
    return best;
  }
  function onDown(e) {
    if (!S.curFrame) return;
    var pos = evPos(e);
    // 찍을 점이 남아 있으면 무조건 "찍기"가 우선이다. 끌기를 먼저 보면
    // 볼처럼 클럽헤드 바로 옆에 오는 점을 찍을 때 옆의 점이 끌려가 버린다.
    if (S.markQueue.length) {
      var j = S.markQueue.shift();
      S.frames[S.curFrame].marks[j.id] = toNorm(pos.x, pos.y);
      e.preventDefault();
      renderMarkPanel(); buildFrames(); draw();
      return;
    }
    var hit = hitJoint(pos);
    if (hit) { dragging = hit; e.preventDefault(); }
  }
  function onMove(e) {
    if (!dragging) return;
    var pos = evPos(e);
    S.frames[S.curFrame].marks[dragging] = toNorm(pos.x, pos.y);
    e.preventDefault(); draw();
  }
  function onUp() { if (dragging) { dragging = null; draw(); } }
  el.canvas.addEventListener('pointerdown', onDown);
  el.canvas.addEventListener('pointermove', onMove);
  window.addEventListener('pointerup', onUp);

  function draw() {
    if (!ctx) return;
    var cw = el.canvas.clientWidth, ch = el.canvas.clientHeight;
    ctx.clearRect(0, 0, cw, ch);
    if (S.report && S.report.shapes) drawShapes(S.report.shapes);
    drawSkeleton();
    updateBadge();
  }

  function updateBadge() {
    if (S.curFrame && S.markQueue.length) {
      var j = S.markQueue[0];
      el['stage-badge'].textContent = '지금 찍을 곳: ' + j.label + ' (' + j.hint + ')';
      el['stage-badge'].style.display = '';
    } else if (S.report) {
      var lb = null;
      D.FRAMES.forEach(function (f) { if (f.id === S.viewFrame) lb = f; });
      el['stage-badge'].textContent = (lb ? lb.emoji + ' ' + lb.label + ' · ' : '') +
        '초록 = 정상 플레인 · 주황 = 척추선 · 노랑 = 머리 허용 범위';
      el['stage-badge'].style.display = '';
    } else {
      el['stage-badge'].style.display = 'none';
    }
  }

  function drawSkeleton() {
    var fid = S.curFrame || S.viewFrame;
    if (!fid || !S.frames[fid]) return;
    var marks = S.frames[fid].marks;
    var links = S.view === 'dtl'
      ? [['head','shoulder'],['shoulder','hip'],['hip','knee'],['shoulder','hands'],['hands','clubhead']]
      : [['leadShoulder','trailShoulder'],['leadHip','trailHip'],['leadShoulder','leadHip'],
         ['trailShoulder','trailHip'],['head','leadShoulder'],['head','trailShoulder'],['hands','clubhead']];
    ctx.save();
    ctx.strokeStyle = 'rgba(255,255,255,.55)'; ctx.lineWidth = 2;
    links.forEach(function (L) {
      if (!marks[L[0]] || !marks[L[1]]) return;
      var a = toPx(marks[L[0]]), b = toPx(marks[L[1]]);
      ctx.beginPath(); ctx.moveTo(a.x, a.y); ctx.lineTo(b.x, b.y); ctx.stroke();
    });
    neededFor(fid).forEach(function (j) {
      if (!marks[j.id]) return;
      var p = toPx(marks[j.id]);
      ctx.beginPath(); ctx.arc(p.x, p.y, 6.5, 0, Math.PI * 2);
      ctx.fillStyle = j.color; ctx.fill();
      ctx.lineWidth = 2; ctx.strokeStyle = 'rgba(0,0,0,.45)'; ctx.stroke();
    });
    ctx.restore();
  }

  function extPts(a, b, k) {
    // a→b 선을 b 너머로 k 배 연장한 두 끝점
    var v = { x: b.x - a.x, y: b.y - a.y };
    return [{ x: a.x - v.x * 0.12, y: a.y - v.y * 0.12 }, { x: a.x + v.x * k, y: a.y + v.y * k }];
  }

  function drawShapes(shapes) {
    ctx.save();
    shapes.forEach(function (sh) {
      ctx.setLineDash(sh.dash || []);
      ctx.lineWidth = sh.width || 2;
      ctx.strokeStyle = sh.color || '#fff';
      if (sh.type === 'line') {
        var e2 = extPts(toPx(sh.from), toPx(sh.to), sh.extend || 1.5);
        ctx.beginPath(); ctx.moveTo(e2[0].x, e2[0].y); ctx.lineTo(e2[1].x, e2[1].y); ctx.stroke();
      } else if (sh.type === 'band') {
        var ap = toPx(sh.apex);
        var p1 = extPts(ap, toPx(sh.a), sh.extend || 2)[1];
        var p2 = extPts(ap, toPx(sh.b), sh.extend || 2)[1];
        ctx.beginPath(); ctx.moveTo(ap.x, ap.y); ctx.lineTo(p1.x, p1.y); ctx.lineTo(p2.x, p2.y);
        ctx.closePath(); ctx.fillStyle = sh.fill; ctx.fill();
      } else if (sh.type === 'vline') {
        var b = box(), x = b.x + sh.x * b.w;
        ctx.beginPath(); ctx.moveTo(x, b.y); ctx.lineTo(x, b.y + b.h); ctx.stroke();
      } else if (sh.type === 'circle') {
        // 반지름은 세로 길이 기준으로 넘어온다(가로로 환산하면 세로 영상에서 원이 커진다).
        var c = toPx(sh.center), bb = box();
        ctx.beginPath(); ctx.arc(c.x, c.y, sh.r * bb.h, 0, Math.PI * 2); ctx.stroke();
      } else if (sh.type === 'dot') {
        var d = toPx(sh.at);
        ctx.beginPath(); ctx.arc(d.x, d.y, sh.r || 5, 0, Math.PI * 2);
        ctx.fillStyle = sh.color; ctx.fill();
        ctx.strokeStyle = 'rgba(0,0,0,.5)'; ctx.lineWidth = 1.5; ctx.stroke();
      } else if (sh.type === 'trace') {
        var key = sh.points[0], pts = [];
        D.FRAMES.forEach(function (f) {
          var fr = S.frames[f.id];
          if (fr && fr.marks[key]) pts.push(toPx(fr.marks[key]));
        });
        if (pts.length > 1) {
          ctx.beginPath(); ctx.moveTo(pts[0].x, pts[0].y);
          for (var i = 1; i < pts.length; i++) ctx.lineTo(pts[i].x, pts[i].y);
          ctx.stroke();
        }
        pts.forEach(function (p) {
          ctx.beginPath(); ctx.arc(p.x, p.y, 3.5, 0, Math.PI * 2);
          ctx.fillStyle = sh.color; ctx.fill();
        });
      }
    });
    ctx.setLineDash([]);
    ctx.restore();
  }

  /* ── 7. 진단 리포트 ──────────────────────────────────────────── */
  el['go-report'].addEventListener('click', function () {
    var marks = {};
    Object.keys(S.frames).forEach(function (fid) {
      if (isMarked(fid)) marks[fid] = S.frames[fid].marks;
    });
    // 세로/가로 영상에 따라 x 와 y 의 축척이 다르다. 종횡비를 넘겨 보정하게 한다.
    var aspect = (el.video.videoWidth && el.video.videoHeight)
      ? el.video.videoWidth / el.video.videoHeight : 1;
    S.report = A.analyze({ club: S.club, view: S.view, sensitivity: S.sensitivity,
      marks: marks, aspect: aspect,
      planeShift: (window.SwingShot.SHAPES[S.shape] || {}).planeShift || 0 });
    S.report.autoUsed = S.autoUsed;
    renderReport(S.report);
    S.lastRecordId = saveHistory(S.report);
    renderOutcomeForm();
    S.viewFrame = S.report.framesUsed.indexOf('P7') >= 0 ? 'P7' : S.report.framesUsed[0];
    buildReportFrames();
    seekTo(S.frames[S.viewFrame].t);
    show('report');
    requestAnimationFrame(function () { fitCanvas(); draw(); });
  });

  // 진단 화면에서 구간을 눌러 넘기면 그 순간 영상 위에 오버레이가 다시 그려진다.
  function buildReportFrames() {
    var have = D.FRAMES.filter(function (f) { return isMarked(f.id); });
    el['report-frames'].innerHTML = have.map(function (f) {
      return '<button type="button" class="fchip' + (S.viewFrame === f.id ? ' cur marked' : ' set') +
        '" data-view-frame="' + f.id + '"><span class="em">' + f.emoji + '</span>' +
        esc(f.label) + '<span class="st">' + S.frames[f.id].t.toFixed(2) + 's</span></button>';
    }).join('');
  }
  el['report-frames'].addEventListener('click', function (e) {
    var b = e.target.closest('[data-view-frame]'); if (!b) return;
    S.viewFrame = b.dataset.viewFrame;
    seekTo(S.frames[S.viewFrame].t);
    buildReportFrames(); draw();
  });

  /* ── 집중 교정 ────────────────────────────────────────────────
   * 문제를 한꺼번에 다 고칠 수는 없다. 하나만 정해 놓고, 그 문제가 몇 회 연속
   * 안 잡혔는지를 센다. 앱이 재는 항목이라 약속이 아니라 측정이다.
   */
  function loadFocus() {
    try { S.focus = JSON.parse(localStorage.getItem(LS_FOCUS) || 'null'); } catch (e) { S.focus = null; }
  }
  function setFocus(faultId) {
    S.focus = faultId ? { faultId: faultId, since: Date.now(), club: S.club, view: S.view } : null;
    try {
      if (S.focus) localStorage.setItem(LS_FOCUS, JSON.stringify(S.focus));
      else localStorage.removeItem(LS_FOCUS);
    } catch (e) { /* 무시 */ }
  }
  // 집중 문제가 최근 몇 회 연속으로 안 잡혔는지. 같은 각도의 분석만 센다.
  function focusStreak() {
    if (!S.focus) return null;
    var rows = readHist().filter(function (r) {
      return r.at >= S.focus.since && r.view === S.focus.view;
    }); // readHist 는 최신순
    var clean = 0;
    for (var i = 0; i < rows.length; i++) {
      var hit = (rows[i].faults || []).some(function (f) { return f.id === S.focus.faultId; });
      if (hit) break;
      clean++;
    }
    return { clean: clean, total: rows.length };
  }
  function focusBlock() {
    if (!S.focus || !F.FAULTS[S.focus.faultId]) return '';
    var d = F.FAULTS[S.focus.faultId], st = focusStreak();
    var msg = st.total === 0 ? '이 각도로 아직 분석한 적이 없습니다.'
      : st.clean === 0 ? '가장 최근 분석에서 또 잡혔습니다. 아직 남아 있습니다.'
      : st.clean >= 5 ? '연속 ' + st.clean + '회 안 잡혔습니다. 몸에 붙은 것 같습니다 — 다음 문제로 넘어갈 때입니다.'
      : '연속 ' + st.clean + '회 안 잡혔습니다. 5회까지 이어가 보세요.';
    return '<div class="focus"><div class="focus-h">🎯 지금 집중 교정</div>' +
      '<b>' + d.emoji + ' ' + esc(d.title) + '</b>' +
      '<div class="focus-bar"><i style="width:' + Math.min(100, st.clean / 5 * 100) + '%"></i></div>' +
      '<span>' + esc(msg) + ' <em>(' + esc(D.VIEWS[S.focus.view].label) + ' 기준)</em></span>' +
      '<button type="button" class="mini" data-focus="">집중 교정 해제</button></div>';
  }

  function fmt(v, unit) {
    if (v == null || isNaN(v)) return '–';
    var n = Math.abs(v) >= 10 ? v.toFixed(0) : v.toFixed(2);
    return n + (unit || '');
  }

  function renderReport(R) {
    var club = D.CLUBS[R.club], view = D.VIEWS[R.view];
    var h = [];

    // "점수"는 잘 친다는 뜻이 아니라 "교과서 범위와 얼마나 겹치는가"다.
    // 좋은 스코어를 내는 스윙 중에 이 점수가 낮은 것도 얼마든지 있다.
    var grade = R.score >= 85 ? '기준 범위와 거의 일치' : R.score >= 70 ? '대체로 기준 안'
              : R.score >= 55 ? '벗어난 구간이 있음' : '벗어난 구간이 많음';
    var col = R.score >= 85 ? 'var(--ok)' : R.score >= 70 ? 'var(--teal)' : R.score >= 55 ? 'var(--warn)' : 'var(--bad)';
    h.push('<div class="score"><div class="score-n" style="color:' + col + '">' + R.score +
      '<small>／100</small></div>' +
      '<div class="score-t"><b>' + esc(club.label) + ' · ' + esc(view.label) + ' — ' + grade + '</b>' +
      '<span>구간 ' + R.framesUsed.length + '개에서 ' + R.faults.length + '개 항목이 기준 밖입니다. ' +
      '이 숫자는 <b>교과서 범위와의 일치도</b>지 실력이나 비거리 점수가 아닙니다.</span></div></div>');

    // 이 화면의 세 층이 각각 어디까지 믿을 수 있는지 먼저 밝힌다.
    h.push('<details class="basis"><summary>이 진단은 어디까지 믿을 수 있나 <span>펼쳐보기</span></summary>' +
      '<div class="basis-b">' +
      '<div class="basis-row"><b class="ok">① 측정값</b><p>내가 찍은 점으로 실제로 잰 값입니다. ' +
        '다만 휴대폰 한 대로 재는 2D 추정이라 3D 계측기와는 다릅니다. 카메라 각도가 틀어지면 값도 틀어집니다.' +
        (R.autoUsed ? ' 이번 분석에는 <b>자동 인식</b>이 쓰였습니다. 자동 인식은 관절 중심을 잡으므로 ' +
          '손으로 찍은 값과 절대 각도가 몇 도 다를 수 있습니다. 회차끼리 비교하려면 방식을 통일하세요.' : '') +
        '</p></div>' +
      '<div class="basis-row"><b class="warn">② 정상 범위</b><p>코칭에서 흔히 쓰는 범위를 옮겨 적은 것입니다. ' +
        '실제 스윙 데이터로 학습하거나 검증한 값이 아니고, 체형·유연성·구질 취향에 따라 나에게 맞는 범위는 다를 수 있습니다.</p></div>' +
      '<div class="basis-row"><b class="bad">③ 솔루션·장비 제안</b><p>일반적인 교정 통념입니다. ' +
        '<b>이 앱은 볼을 보지 않습니다.</b> 그래서 "이대로 고치면 더 멀리·똑바로 간다"는 것을 이 앱이 확인해 준 게 아닙니다. ' +
        '가설로 받아들이고, 아래 결과 기록으로 본인에게 실제로 맞는지 직접 확인하세요.</p></div>' +
      '</div></details>');

    var SH = window.SwingShot, sh = SH.SHAPES[S.shape];
    if (sh) {
      var blocked = R.faults.filter(function (f) { return sh.blockers.indexOf(f.faultId) >= 0; });
      var watched = R.faults.filter(function (f) { return sh.watch.indexOf(f.faultId) >= 0; });
      var cls = blocked.length ? 'bad' : watched.length ? 'warn' : 'ok';
      var msg = blocked.length
        ? '<b>' + esc(sh.label) + '를 막는 항목이 잡혔습니다.</b> ' +
          blocked.map(function (f) { return esc(F.FAULTS[f.faultId].title); }).join(', ') +
          ' — 이 궤도로는 원하는 구질이 안 나옵니다. 그립·볼 위치보다 이게 먼저입니다.'
        : watched.length
        ? '<b>방향은 맞는데 과할 수 있습니다.</b> ' +
          watched.map(function (f) { return esc(F.FAULTS[f.faultId].title); }).join(', ') +
          ' — ' + esc(sh.label) + '가 나오는 쪽이지만 지나치면 미스가 됩니다.'
        : '<b>' + esc(sh.label) + '를 막는 항목은 안 잡혔습니다.</b> 셋업을 맞춰 보세요.';
      h.push('<div class="shape-verdict ' + cls + ' inline"><div class="sv-h">🎯 내 목표 구질: ' +
        sh.emoji + ' ' + esc(sh.label) + '</div><p>' + msg +
        '</p><button type="button" class="mini" id="rep-shape">구질 가이드 보기 ›</button></div>');
    }

    var fb = focusBlock();
    if (fb) h.push(fb);

    h.push('<div class="legend">' +
      '<i style="--sw:#4dd4ac">정상 플레인 밴드</i>' +
      '<i style="--sw:#ffb570">척추선</i>' +
      '<i style="--sw:#ffd166">머리 허용 범위</i>' +
      '<i style="--sw:#ff8fb3">손 궤적</i></div>');

    // 측정치 표
    h.push('<div class="mhead">측정값 <span>내가 찍은 점으로 실제로 잰 값</span>' +
      '<em>기준 = 코칭 통념 범위</em></div>');
    h.push('<div class="mtable">');
    Object.keys(R.metrics).forEach(function (k) {
      var m = R.metrics[k];
      if (m.v == null || isNaN(m.v)) return;
      var cls = '', range = '';
      if (m.ideal) {
        var ok = m.v >= m.ideal[0] && m.v <= m.ideal[1];
        cls = ok ? ' good' : ' bad';
        range = '기준 ' + fmt(m.ideal[0]) + '~' + fmt(m.ideal[1]);
      }
      h.push('<div class="mrow' + cls + '"><span class="k">' + esc(m.label) + '</span>' +
        '<span class="v">' + fmt(m.v, m.unit) + '</span><span class="r">' + esc(range) + '</span></div>');
    });
    h.push('</div>');

    if (!R.faults.length) {
      h.push('<div class="okbox"><b>이 각도에서는 기준을 벗어난 항목이 없습니다 ⛳</b>' +
        '<span>잘 친다는 뜻은 아니고, 이 앱이 재는 항목 안에서는 걸린 게 없다는 뜻입니다. 반대쪽 각도(' + esc(D.VIEWS[R.view === 'dtl' ? 'fo' : 'dtl'].label) + ')로도 한 번 찍어보세요. ' +
        '한 각도에서 안 보이는 문제가 다른 각도에서 드러납니다.</span></div>');
    } else {
      // 구간별로 묶어서 출력
      F.PHASES.forEach(function (ph) {
        var list = R.faults.filter(function (f) { return F.FAULTS[f.faultId].phase === ph.id; });
        if (!list.length) return;
        h.push('<div class="phase"><div class="phase-h">' + ph.emoji + ' ' + esc(ph.label) +
          ' <span class="rng">' + esc(ph.range) + '</span></div>');
        list.forEach(function (f) { h.push(faultCard(f)); });
        h.push('</div>');
      });
    }

    el.report.innerHTML = h.join('');
  }

  function faultCard(f) {
    var d = F.FAULTS[f.faultId], m = f.metric;
    var sevLabel = ['', '경미', '주의', '심각'][f.sev];
    var h = [];
    h.push('<div class="card"><div class="card-h"><span class="em">' + d.emoji + '</span>' +
      '<span class="tt"><b>' + esc(d.title) + '</b><span>' + esc(d.symptom.slice(0, 46)) + '…</span></span>' +
      '<span class="sev sev' + f.sev + '">' + sevLabel + '</span><span class="arrow">›</span></div>' +
      '<div class="card-b">');

    h.push('<div class="meas"><div class="' + (m.sev ? 'ng' : '') + '"><span>측정값</span><b>' +
      fmt(m.value, m.unit) + '</b></div><div><span>정상 범위</span><b>' +
      fmt(m.lo) + ' ~ ' + fmt(m.hi) + '</b></div><div><span>항목</span><b style="font-size:12.5px">' +
      esc(m.label || '') + '</b></div></div>');

    h.push('<p>' + esc(d.symptom) + '</p>');
    if (f.note) h.push('<p style="color:var(--dim)">' + esc(f.note) + '</p>');
    h.push('<div class="sec-t">보통 이런 결과로 이어진다고 봅니다</div><p>' + esc(d.impact) + '</p>');
    h.push('<div class="sec-t">흔히 꼽히는 원인</div><ul>' +
      d.cause.map(function (c) { return '<li>' + esc(c) + '</li>'; }).join('') + '</ul>');
    h.push('<div class="sec-t">일반적인 교정 방향</div><ul>' +
      d.fix.map(function (c) { return '<li>' + esc(c) + '</li>'; }).join('') + '</ul>');
    h.push('<div class="sec-t">연습 드릴</div>' +
      d.drills.map(function (dr) {
        return '<div class="drill"><b>' + esc(dr.name) + '</b><p>' + esc(dr.how) + '</p>' +
          '<span class="reps">' + esc(dr.reps) + '</span></div>';
      }).join(''));
    h.push('<div class="sec-t">참고 영상</div>' +
      d.yt.map(function (y) {
        return '<a class="yt" href="' + esc(ytURL(y.q)) + '" target="_blank" rel="noopener">' +
          '<span class="ico">▶</span><span><b>' + esc(y.title) + '</b>' +
          '<span>유튜브에서 "' + esc(y.q) + '" 검색</span></span></a>';
      }).join(''));
    h.push('<p class="basis-note">위 측정값은 실제로 잰 값이고, 원인·교정·드릴은 <b>코칭 통념</b>입니다. ' +
      '이 앱이 내 스윙에서 효과를 확인한 것은 아닙니다. 하나씩 시도한 뒤 결과를 기록해 실제로 맞는지 확인하세요.</p>');
    if (!S.focus || S.focus.faultId !== d.id) {
      h.push('<button type="button" class="mini prim wide" data-focus="' + d.id +
        '">🎯 이걸 이번 집중 교정으로 정하기</button>');
    } else {
      h.push('<p class="basis-note" style="background:rgba(77,212,172,.16)">지금 집중 교정 중인 문제입니다.</p>');
    }
    h.push('</div></div>');
    return h.join('');
  }

  el.report.addEventListener('click', function (e) {
    if (e.target.id === 'rep-shape') { showShape(); return; }
    var fbtn = e.target.closest('[data-focus]');
    if (fbtn) {
      setFocus(fbtn.dataset.focus || null);
      renderReport(S.report);
      window.scrollTo({ top: 0, behavior: 'smooth' });
      return;
    }
    var head = e.target.closest('.card-h'); if (!head) return;
    head.parentNode.classList.toggle('open');
  });
  el['go-fit'].addEventListener('click', function () { show('fit'); });

  /* ── 8. 장비 피팅 ────────────────────────────────────────────── */
  var FIT = { flight: null, traj: 'mid', contact: 'center' };
  function buildFit() {
    el['flight-grid'].innerHTML = D.FLIGHTS.map(function (f) {
      return '<button type="button" class="pick" data-flight="' + f.id + '">' +
        '<span class="em">' + f.emoji + '</span>' + esc(f.label) +
        '<span class="sm">' + esc(f.path) + '</span></button>';
    }).join('');
    el['traj-seg'].innerHTML = D.TRAJECTORIES.map(function (t) {
      return '<button type="button" data-traj="' + t.id + '"' + (t.id === 'mid' ? ' class="on"' : '') + '>' +
        t.emoji + ' ' + esc(t.label) + '</button>';
    }).join('');
    el['contact-seg'].innerHTML = D.CONTACTS.map(function (c) {
      return '<button type="button" data-contact="' + c.id + '"' + (c.id === 'center' ? ' class="on"' : '') + '>' +
        c.emoji + ' ' + esc(c.label) + '</button>';
    }).join('');
  }
  function segPick(container, attr, key) {
    el[container].addEventListener('click', function (e) {
      var b = e.target.closest('[data-' + attr + ']'); if (!b) return;
      FIT[key] = b.dataset[attr];
      Array.prototype.forEach.call(this.children, function (n) { n.classList.toggle('on', n === b); });
    });
  }
  segPick('flight-grid', 'flight', 'flight');
  segPick('traj-seg', 'traj', 'traj');
  segPick('contact-seg', 'contact', 'contact');

  el['go-fitresult'].addEventListener('click', function () {
    if (!FIT.flight) { alert('평소 구질을 먼저 골라주세요.'); return; }
    var carry = parseFloat(el.carry.value);
    var out = A.fitting({
      club: S.club, flight: FIT.flight, traj: FIT.traj, contact: FIT.contact,
      carry: isNaN(carry) ? 0 : carry,
      myCarry: (S.profile.carries && S.profile.carries[S.club]) || 0
    }, S.report);
    renderFit(out);
    el.fitreport.scrollIntoView({ behavior: 'smooth', block: 'start' });
  });

  function renderFit(out) {
    var h = [];
    if (out.speed) {
      var s = out.speed;
      h.push('<div class="speedbox"><h4>⚡ 추정 헤드 스피드</h4><div class="speedgrid">' +
        '<div><span>이 클럽</span><b>' + s.clubMph + '<small style="font-size:11px"> mph</small></b></div>' +
        '<div><span>드라이버 환산</span><b>' + s.driverMph + '<small style="font-size:11px"> mph</small></b></div>' +
        '<div><span>m/s 환산</span><b>' + s.driverMs + '</b></div>' +
        '<div><span>' + esc(s.refLabel) + '(' + s.refCarry + 'yd) 대비</span><b>' +
          (s.gap >= 0 ? '+' : '') + s.gap + '<small style="font-size:11px"> yd</small></b></div>' +
        '</div></div>');
    }
    if (out.flight) {
      h.push('<div class="fit-item"><span class="p">현재 구질</span><div class="s">' +
        out.flight.emoji + ' ' + esc(out.flight.label) + '</div><p class="w">' + esc(out.flight.note) +
        ' · 임팩트 페이스: ' + esc(out.flight.face) + ' · 궤도: ' + esc(out.flight.path) + '</p></div>');
    }
    out.warns.forEach(function (w) {
      h.push('<div class="warnbox"><p>⚠️ ' + esc(w) + '</p></div>');
    });
    h.push('<h3 class="f-title">장비 세팅 제안</h3>');
    h.push('<div class="basis-note box">이 제안은 <b>입력하신 구질·탄도·컨택·거리에서 통상 권하는 방향</b>입니다. ' +
      '볼을 실제로 계측한 값이 아니라 직접 고르신 구질에서 나온 규칙 계산이라, 방향 참고용으로만 쓰시고 ' +
      '반드시 시타로 확인하세요. 로프트·라이각 조정은 되돌리기 어렵습니다.</div>');
    out.items.forEach(function (it) {
      h.push('<div class="fit-item"><span class="p">' + esc(it.part) + '</span>' +
        '<div class="s">' + esc(it.suggest) + '</div><p class="w">' + esc(it.why) + '</p></div>');
    });
    h.push('<p class="hint">가장 확실한 방법은 런치 모니터로 볼스피드·발사각·스핀·클럽패스를 실제로 재는 것입니다. ' +
      '이 화면은 그게 없을 때 방향을 좁혀주는 용도이지 피팅을 대신하지 않습니다. ' +
      '피팅 전문점에서 임팩트 테이프로 실제 접촉 위치를 확인한 뒤 진행하세요.</p>');
    el.fitreport.innerHTML = h.join('');
  }

  /* ── 9. 기록 저장 (좌표만, 영상은 저장하지 않는다) ───────────── */
  function readHist() {
    try { return JSON.parse(localStorage.getItem(LS_HIST) || '[]'); } catch (e) { return []; }
  }
  function writeHist(h) {
    try { localStorage.setItem(LS_HIST, JSON.stringify(h.slice(0, 200))); } catch (e) { /* 무시 */ }
  }
  function saveHistory(R) {
    var id = Date.now();
    try {
      var rec = {
        at: id, club: R.club, view: R.view, score: R.score, autoUsed: !!R.autoUsed,
        faults: R.faults.map(function (f) { return { id: f.faultId, sev: f.sev }; }),
        outcome: null
      };
      var hist = readHist();
      hist.unshift(rec);
      writeHist(hist);
      localStorage.setItem(LS_LAST, JSON.stringify({ club: R.club, view: R.view,
        sensitivity: R.sensitivity, handed: S.handed }));
    } catch (e) { /* 저장 실패는 분석을 막지 않는다 */ }
    return id;
  }

  /* ── 결과 기록 ────────────────────────────────────────────────
   * 진단이 실제로 맞는지 확인할 수 있는 유일한 고리다. 자기 보고 값이라
   * 거칠지만, 회차가 쌓이면 점수와 결과가 같이 움직이는지는 보인다.
   */
  function renderOutcomeForm() {
    el['outcome-slot'].innerHTML = window.SwingLog.outcomeForm();
    var dir = 0;
    el['outcome-slot'].querySelector('#o-dir').addEventListener('click', function (e) {
      var b = e.target.closest('[data-d]'); if (!b) return;
      dir = +b.dataset.d;
      Array.prototype.forEach.call(this.children, function (n) { n.classList.toggle('on', n === b); });
    });
    el['outcome-slot'].querySelector('#o-save').addEventListener('click', function () {
      var carry = parseFloat(el['outcome-slot'].querySelector('#o-carry').value);
      var note = el['outcome-slot'].querySelector('#o-note').value.trim();
      var hist = readHist(), hit = null;
      hist.forEach(function (r) { if (r.at === S.lastRecordId) hit = r; });
      if (!hit) { hit = hist[0]; }
      if (!hit) return;
      hit.outcome = { carry: isNaN(carry) ? 0 : carry, dir: dir, note: note };
      writeHist(hist);
      var saved = el['outcome-slot'].querySelector('#o-saved');
      saved.hidden = false;
      saved.textContent = '저장했습니다. 같은 클럽·같은 각도로 ' + window.SwingLog.MIN_N +
        '회 이상 쌓이면 기록 화면에서 점수와 결과의 관계를 보여드립니다.';
      this.disabled = true;
    });
  }

  function showLog() {
    if (!S.logFilter) {
      var last = readHist()[0];
      S.logFilter = { club: last ? last.club : S.club, view: last ? last.view : S.view };
    }
    var hist = readHist();
    var clubs = D.CLUB_ORDER.filter(function (c) {
      return hist.some(function (r) { return r.club === c; });
    });
    if (clubs.indexOf(S.logFilter.club) < 0) clubs.unshift(S.logFilter.club);
    window.SwingLog.render(el.logbox, hist, S.logFilter, S.logMode, clubs, focusBlock());
    show('log');
  }
  el['btn-log'].addEventListener('click', showLog);
  el.logbox.addEventListener('click', function (e) {
    var fbtn = e.target.closest('[data-focus]');
    if (fbtn) { setFocus(fbtn.dataset.focus || null); showLog(); return; }
    if (e.target.id === 'log-export') { exportAll(); return; }
    if (e.target.id === 'log-import') { el.logbox.querySelector('#log-file').click(); return; }
    if (e.target.id === 'log-fill') { fillFromLog(); return; }
    var b = e.target.closest('[data-m]'); if (!b) return;
    S.logMode = b.dataset.m; showLog();
  });
  el.logbox.addEventListener('change', function (e) {
    if (e.target.id !== 'log-file') return;
    var f = e.target.files && e.target.files[0]; if (!f) return;
    importAll(f);
  });

  /* ── 내보내기 / 가져오기 ──────────────────────────────────────
   * 기록은 이 브라우저의 localStorage 에만 있다. 폰을 바꾸거나 사이트 데이터를
   * 지우면 그냥 사라진다. 혼자 쌓아가는 기록이라 백업 수단이 반드시 있어야 한다.
   */
  function exportAll() {
    var data = { v: 1, at: Date.now(), profile: S.profile, focus: S.focus, history: readHist() };
    var blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
    var a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = 'swingjaro-' + new Date().toISOString().slice(0, 10) + '.json';
    document.body.appendChild(a); a.click();
    setTimeout(function () { URL.revokeObjectURL(a.href); a.remove(); }, 1000);
  }
  function importAll(file) {
    var fr = new FileReader();
    fr.onload = function () {
      var d;
      try { d = JSON.parse(fr.result); } catch (e) { alert('읽을 수 없는 파일입니다.'); return; }
      if (!d || !Array.isArray(d.history)) { alert('스윙자로 백업 파일이 아닙니다.'); return; }
      // 같은 시각의 기록은 하나로 본다. 기존 기록을 지우지 않고 합친다.
      var cur = readHist(), seen = {};
      cur.forEach(function (r) { seen[r.at] = true; });
      var added = 0;
      d.history.forEach(function (r) { if (!seen[r.at]) { cur.push(r); added++; } });
      cur.sort(function (a, b) { return b.at - a.at; });
      writeHist(cur);
      if (d.profile && d.profile.carries) { S.profile = d.profile; saveProfile(); buildMyDist(); }
      if (d.focus) { S.focus = d.focus; try { localStorage.setItem(LS_FOCUS, JSON.stringify(d.focus)); } catch (e) {} }
      alert('가져왔습니다. 새 기록 ' + added + '회를 더했습니다(기존 기록은 그대로).');
      showLog();
    };
    fr.readAsText(file);
  }
  // 실제로 친 기록의 중앙값으로 내 클럽 거리를 채운다
  function fillFromLog() {
    var by = {};
    readHist().forEach(function (r) {
      if (!r.outcome || !(r.outcome.carry > 0)) return;
      (by[r.club] = by[r.club] || []).push(r.outcome.carry);
    });
    var ready = Object.keys(by).filter(function (c) { return by[c].length >= 3; });
    if (!ready.length) {
      alert('아직 3회 이상 기록된 클럽이 없습니다. 조금 더 쌓아주세요.\n(중앙값을 쓰려면 최소 3회가 필요합니다)');
      return;
    }
    // 직접 넣어둔 값이 있으면 말없이 덮어쓰지 않는다.
    var over = ready.filter(function (c) { return S.profile.carries[c] > 0; });
    if (over.length) {
      var lines = over.map(function (c) {
        var v = by[c].slice().sort(function (a, b) { return a - b; });
        return '  · ' + D.CLUBS[c].label + ': ' + S.profile.carries[c] + ' → ' +
          Math.round(v[Math.floor(v.length / 2)]) + 'yd';
      }).join('\n');
      if (!confirm('직접 넣어둔 값을 기록의 중앙값으로 바꿉니다.\n\n' + lines + '\n\n계속할까요?')) return;
    }
    var n = 0;
    ready.forEach(function (c) {
      var v = by[c].slice().sort(function (a, b) { return a - b; });
      S.profile.carries[c] = Math.round(v[Math.floor(v.length / 2)]);
      n++;
    });
    saveProfile(); buildMyDist();
    alert(n + '개 클럽을 실제 기록의 중앙값으로 채웠습니다.');
  }
  el.logbox.addEventListener('change', function (e) {
    if (e.target.id === 'log-club') S.logFilter.club = e.target.value;
    else if (e.target.id === 'log-view') S.logFilter.view = e.target.value;
    else return;
    showLog();
  });
  function restorePrefs() {
    try {
      var p = JSON.parse(localStorage.getItem(LS_LAST) || 'null');
      if (p && D.CLUBS[p.club]) {
        S.club = p.club; S.view = p.view || 'dtl';
        S.sensitivity = p.sensitivity || 'normal'; S.handed = p.handed || 'right';
      }
    } catch (e) { /* 무시 */ }
    Array.prototype.forEach.call(el['sens-seg'].children, function (n) {
      n.classList.toggle('on', n.dataset.v === S.sensitivity);
    });
    Array.prototype.forEach.call(el['hand-seg'].children, function (n) {
      n.classList.toggle('on', n.dataset.h === S.handed);
    });
  }

  /* ── 시작 ────────────────────────────────────────────────────── */
  restorePrefs();
  loadProfile();
  loadFocus();
  buildMyDist();
  buildShapeGrid();
  renderInstall();
  buildSetup();
  buildFrames();
  buildFit();
  show('setup');
})();
