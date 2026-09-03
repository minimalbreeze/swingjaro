/* 스윙자로 — 결과 기록과 대조
 *
 * 이 앱은 볼을 보지 않는다. 그래서 "진단대로 고치면 정말 더 멀리·똑바로 가는가"를
 * 앱이 증명해 줄 수 없다. 대신 매번 실제 결과를 남기면, 점수와 결과가
 * 같이 움직이는지를 본인 데이터로 확인할 수 있다. 이 화면이 그 고리다.
 *
 * 정직하게 지킬 것
 *  - 표본이 적으면 그래프를 그리지 않고 "아직 말할 수 없다"고 말한다.
 *  - 캐리는 클럽마다 다르고 점수는 촬영 각도마다 다르다. 같은 클럽·같은 각도끼리만 묶는다.
 *  - 상관이 보여도 인과가 아니라고 매번 적는다. 자기 보고 데이터다.
 */
(function (global) {
  'use strict';

  var MARK = '#0f8a6d';      // 단일 계열 — 채도·대비 검증을 통과한 브랜드 틸
  var INK = '#1c3b34';
  var MUTED = '#8aa39a';
  var MIN_N = 5;             // 이보다 적으면 그래프를 그리지 않는다
  var MIN_TREND = 10;        // 추세선은 이보다 많아야 그린다

  var DIRS = [
    { v: -2, label: '크게 왼쪽' },
    { v: -1, label: '조금 왼쪽' },
    { v:  0, label: '거의 똑바로' },
    { v:  1, label: '조금 오른쪽' },
    { v:  2, label: '크게 오른쪽' }
  ];

  function esc(s) {
    return String(s).replace(/[&<>"']/g, function (c) {
      return { '&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;' }[c];
    });
  }
  function ymd(t) {
    var d = new Date(t);
    return (d.getMonth() + 1) + '/' + d.getDate();
  }

  /* 피어슨 상관계수. 표본이 적으면 의미가 없으므로 화면에서 N과 함께만 쓴다. */
  function pearson(xs, ys) {
    var n = xs.length;
    if (n < 3) return null;
    var mx = xs.reduce(function (a, b) { return a + b; }, 0) / n;
    var my = ys.reduce(function (a, b) { return a + b; }, 0) / n;
    var sxy = 0, sxx = 0, syy = 0;
    for (var i = 0; i < n; i++) {
      var dx = xs[i] - mx, dy = ys[i] - my;
      sxy += dx * dy; sxx += dx * dx; syy += dy * dy;
    }
    if (sxx <= 0 || syy <= 0) return null;
    return sxy / Math.sqrt(sxx * syy);
  }

  /* ── 산점도 ────────────────────────────────────────────────────
   * 가로: 이 앱의 점수(교과서 일치도) / 세로: 실제 결과.
   * 계열이 하나뿐이라 범례를 두지 않는다(제목이 계열 이름을 대신한다).
   */
  function scatter(rows, mode) {
    // 방향 모드의 세로축 라벨은 "크게 오른쪽"처럼 길어서 여백을 더 준다.
    var W = 320, H = 210, ML = (mode === 'carry' ? 46 : 68), MR = 12, MT = 12, MB = 34;
    var pw = W - ML - MR, ph = H - MT - MB;

    var ys = rows.map(function (r) { return mode === 'carry' ? r.outcome.carry : r.outcome.dir; });
    var yMin, yMax, yTicks;
    if (mode === 'carry') {
      var lo = Math.min.apply(null, ys), hi = Math.max.apply(null, ys);
      var pad = Math.max(5, (hi - lo) * 0.15);
      yMin = Math.floor((lo - pad) / 5) * 5; yMax = Math.ceil((hi + pad) / 5) * 5;
      if (yMax - yMin < 10) yMax = yMin + 10;
      yTicks = [yMin, (yMin + yMax) / 2, yMax].map(function (v) {
        return { v: v, t: Math.round(v) + 'yd' };
      });
    } else {
      yMin = -2.6; yMax = 2.6;
      yTicks = DIRS.map(function (d) { return { v: d.v, t: d.label }; });
    }
    var X = function (v) { return ML + (v / 100) * pw; };
    var Y = function (v) { return MT + ph - ((v - yMin) / (yMax - yMin)) * ph; };

    var g = [];
    // 격자와 축은 뒤로 물린다
    yTicks.forEach(function (t) {
      g.push('<line x1="' + ML + '" y1="' + Y(t.v).toFixed(1) + '" x2="' + (W - MR) +
        '" y2="' + Y(t.v).toFixed(1) + '" stroke="#e3ece8" stroke-width="1"/>');
      g.push('<text x="' + (ML - 6) + '" y="' + (Y(t.v) + 3.5).toFixed(1) +
        '" text-anchor="end" font-size="9.5" fill="' + MUTED + '">' + esc(t.t) + '</text>');
    });
    [0, 50, 100].forEach(function (v) {
      g.push('<text x="' + X(v).toFixed(1) + '" y="' + (H - 14) +
        '" text-anchor="middle" font-size="9.5" fill="' + MUTED + '">' + v + '</text>');
    });
    if (mode === 'dir') {
      g.push('<line x1="' + ML + '" y1="' + Y(0).toFixed(1) + '" x2="' + (W - MR) +
        '" y2="' + Y(0).toFixed(1) + '" stroke="#b9cec6" stroke-width="1.5" stroke-dasharray="4 4"/>');
    }

    // 추세선 — 표본이 충분할 때만, 그것도 "참고"로 흐리게
    if (rows.length >= MIN_TREND) {
      var xs = rows.map(function (r) { return r.score; });
      var n = xs.length;
      var mx = xs.reduce(function (a, b) { return a + b; }, 0) / n;
      var my = ys.reduce(function (a, b) { return a + b; }, 0) / n;
      var sxy = 0, sxx = 0;
      for (var i = 0; i < n; i++) { sxy += (xs[i] - mx) * (ys[i] - my); sxx += (xs[i] - mx) * (xs[i] - mx); }
      if (sxx > 0) {
        var b1 = sxy / sxx, b0 = my - b1 * mx;
        var x1 = Math.min.apply(null, xs), x2 = Math.max.apply(null, xs);
        var cl = function (v) { return Math.max(yMin, Math.min(yMax, v)); };
        g.push('<line x1="' + X(x1).toFixed(1) + '" y1="' + Y(cl(b0 + b1 * x1)).toFixed(1) +
          '" x2="' + X(x2).toFixed(1) + '" y2="' + Y(cl(b0 + b1 * x2)).toFixed(1) +
          '" stroke="#b9cec6" stroke-width="2" stroke-dasharray="5 5"/>');
      }
    }

    // 점 — 겹칠 때 서로 구분되도록 흰 테두리 2px
    rows.forEach(function (r, i) {
      var yv = mode === 'carry' ? r.outcome.carry : r.outcome.dir;
      var title = ymd(r.at) + ' · 점수 ' + r.score + ' · ' +
        (mode === 'carry' ? r.outcome.carry + '야드' : dirLabel(r.outcome.dir));
      g.push('<circle class="pt" data-i="' + i + '" cx="' + X(r.score).toFixed(1) + '" cy="' + Y(yv).toFixed(1) +
        '" r="5" fill="' + MARK + '" stroke="#fff" stroke-width="2"><title>' + esc(title) + '</title></circle>');
    });

    g.push('<text x="' + (ML + pw / 2).toFixed(1) + '" y="' + (H - 2) +
      '" text-anchor="middle" font-size="9.5" fill="' + MUTED + '">스윙자로 점수 (교과서 일치도)</text>');

    return '<svg viewBox="0 0 ' + W + ' ' + H + '" class="lchart" role="img" ' +
      'aria-label="점수와 실제 결과의 관계를 보여주는 산점도">' + g.join('') + '</svg>';
  }

  function dirLabel(v) {
    for (var i = 0; i < DIRS.length; i++) if (DIRS[i].v === v) return DIRS[i].label;
    return String(v);
  }

  /* ── 화면 ──────────────────────────────────────────────────── */
  function render(box, hist, filter, mode, clubs, focusHtml) {
    var rows = hist.filter(function (r) {
      return r.outcome && r.club === filter.club && r.view === filter.view &&
        (mode !== 'carry' || r.outcome.carry > 0);
    }).sort(function (a, b) { return a.at - b.at; });

    var h = [];
    var CL = global.SwingData.CLUBS, VW = global.SwingData.VIEWS;
    if (focusHtml) h.push(focusHtml);

    // 무엇끼리 묶어서 보는지 먼저 밝힌다
    h.push('<div class="lfilter"><span>비교 대상</span>' +
      '<select id="log-club">' + clubs.map(function (c) {
        return '<option value="' + c + '"' + (c === filter.club ? ' selected' : '') + '>' +
          esc(CL[c].label) + '</option>';
      }).join('') + '</select>' +
      '<select id="log-view">' + ['dtl','fo'].map(function (v) {
        return '<option value="' + v + '"' + (v === filter.view ? ' selected' : '') + '>' +
          esc(VW[v].label) + '</option>';
      }).join('') + '</select></div>');
    h.push('<p class="hint">캐리는 클럽마다, 점수는 촬영 각도마다 뜻이 달라서 ' +
      '<b>같은 클럽 · 같은 각도</b>끼리만 비교합니다.</p>');

    h.push('<div class="seg" id="log-mode">' +
      '<button type="button" data-m="carry"' + (mode === 'carry' ? ' class="on"' : '') + '>캐리 거리</button>' +
      '<button type="button" data-m="dir"' + (mode === 'dir' ? ' class="on"' : '') + '>좌우 방향</button></div>');

    if (rows.length < MIN_N) {
      h.push('<div class="lempty"><b>' + rows.length + '회 기록됨</b>' +
        '<span>아직 말할 수 있는 게 없습니다. 같은 조건으로 <b>' + (MIN_N - rows.length) +
        '회</b> 더 쌓이면 점수와 결과가 같이 움직이는지 그려 드립니다. ' +
        '표본이 적을 때 그래프를 그리면 없는 관계가 있어 보입니다.</span></div>');
    } else {
      var xs = rows.map(function (r) { return r.score; });
      var yv = rows.map(function (r) { return mode === 'carry' ? r.outcome.carry : -Math.abs(r.outcome.dir); });
      var r = pearson(xs, yv);

      var yName = mode === 'carry' ? '캐리 거리' : '똑바로 간 정도';
      h.push('<h3 class="f-title">점수가 오르면 ' + yName + '도 좋아지나</h3>');
      if (mode === 'dir') {
        h.push('<p class="hint">그래프는 <b>어느 쪽으로 치우쳤는지</b>를 그대로 보여주고, ' +
          '아래 상관계수는 <b>치우친 정도(좌우 무관)</b>와 점수의 관계를 잽니다. ' +
          '한쪽으로만 몰려 있다면 그건 점수와 별개로 정렬이나 페이스 문제일 수 있습니다.</p>');
      }
      h.push(scatter(rows, mode));

      var strength, tone;
      if (r === null) { strength = '계산할 수 없음'; tone = 'na'; }
      else if (Math.abs(r) < 0.2) { strength = '거의 무관'; tone = 'na'; }
      else if (Math.abs(r) < 0.45) { strength = '약한 관계'; tone = 'weak'; }
      else if (Math.abs(r) < 0.7) { strength = '중간 관계'; tone = 'mid'; }
      else { strength = '뚜렷한 관계'; tone = 'strong'; }
      var dirWord = r === null ? '' : (r > 0 ? '점수가 높은 날 결과가 좋았습니다.' : '점수가 높은 날 결과가 오히려 나빴습니다.');

      h.push('<div class="lstat ' + tone + '"><div class="lstat-n">' +
        (r === null ? '–' : (r > 0 ? '+' : '') + r.toFixed(2)) + '</div>' +
        '<div class="lstat-t"><b>' + strength + ' · 표본 ' + rows.length + '회</b>' +
        '<span>점수 ↔ ' + yName + '. ' + dirWord +
        ' 상관계수는 -1에서 +1 사이 값입니다.</span></div></div>');

      h.push('<p class="basis-note"><b>이 숫자를 과신하지 마세요.</b> ' +
        (rows.length < 15 ? '표본 ' + rows.length + '회는 우연으로도 이 정도 값이 나옵니다. 15~20회는 쌓여야 방향을 말할 수 있습니다. ' : '') +
        '거리와 방향은 직접 입력하신 자기 보고 값이고, 컨디션·바람·라이·볼 같은 것들이 함께 섞여 있습니다. ' +
        '상관이 보여도 인과가 아닙니다. 어디까지나 <b>본인 데이터로 이 앱의 점수가 쓸모 있는지 가늠하는 용도</b>입니다.</p>');
    }

    // 표 — 그래프를 못 읽는 경우에도 같은 내용을 볼 수 있어야 한다
    if (rows.length) {
      h.push('<details class="ltable"><summary>기록 전체 보기 (' + rows.length + '회)</summary><table>' +
        '<thead><tr><th>날짜</th><th>점수</th><th>캐리</th><th>방향</th><th>메모</th></tr></thead><tbody>' +
        rows.slice().reverse().map(function (x) {
          return '<tr><td>' + ymd(x.at) + '</td><td>' + x.score + '</td><td>' +
            (x.outcome.carry > 0 ? x.outcome.carry + 'yd' : '–') + '</td><td>' +
            esc(dirLabel(x.outcome.dir)) + '</td><td>' + esc(x.outcome.note || '') + '</td></tr>';
        }).join('') + '</tbody></table></details>');
    }
    h.push('<div class="lbackup"><b>내 기록 관리</b>' +
      '<p>기록은 이 브라우저 안에만 있습니다. 폰을 바꾸거나 사이트 데이터를 지우면 사라지니 ' +
      '가끔 파일로 내려받아 두세요.</p>' +
      '<div class="lbackup-btns">' +
      '<button type="button" class="mini" id="log-export">⬇ 파일로 내보내기</button>' +
      '<button type="button" class="mini" id="log-import">⬆ 파일에서 가져오기</button>' +
      '<button type="button" class="mini" id="log-fill">📋 내 클럽 거리 채우기</button>' +
      '</div><input type="file" id="log-file" accept="application/json,.json" hidden /></div>');

    box.innerHTML = h.join('');
  }

  /* 진단 화면 아래에 붙는 결과 입력 폼 */
  function outcomeForm() {
    return '<div class="ocard"><b>오늘 실제로 어땠나요?</b>' +
      '<p>이걸 남겨야 이 앱의 진단이 나에게 실제로 맞는지 나중에 확인할 수 있습니다. ' +
      '건너뛰어도 진단 결과는 그대로입니다.</p>' +
      '<div class="orow"><label>이 클럽 캐리</label>' +
      '<input type="number" id="o-carry" inputmode="numeric" placeholder="예: 150" min="10" max="400" /><span>야드</span></div>' +
      '<div class="orow col"><label>주로 간 방향</label><div class="seg wrap" id="o-dir">' +
      DIRS.map(function (d) {
        return '<button type="button" data-d="' + d.v + '"' + (d.v === 0 ? ' class="on"' : '') + '>' +
          esc(d.label) + '</button>';
      }).join('') + '</div></div>' +
      '<div class="orow col"><label>메모 (선택)</label>' +
      '<input type="text" id="o-note" maxlength="40" placeholder="예: 바람 맞바람, 새 샤프트 첫날" /></div>' +
      '<button type="button" class="mini prim wide" id="o-save">이 회차 결과 저장</button>' +
      '<p class="osaved" id="o-saved" hidden></p></div>';
  }

  global.SwingLog = { render: render, outcomeForm: outcomeForm, DIRS: DIRS, dirLabel: dirLabel, MIN_N: MIN_N };
})(window);
