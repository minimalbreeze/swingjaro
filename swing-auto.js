/* 스윙자로 — 자동 분석
 *
 * 영상만 넣으면 여기서 전부 한다.
 *   1) 영상을 훑으며 프레임마다 관절을 찾는다(MediaPipe Pose)
 *   2) 손 높이와 속도의 흐름으로 스윙 구간(어드레스·톱·임팩트·피니시 등)을 찾는다
 *   3) 우리 분석 엔진이 쓰는 좌표 형식으로 바꿔 넘긴다
 *
 * 왜 손 위치로 구간을 찾나
 *   골프 스윙에서 손 높이는 "낮음(어드레스) → 높음(톱) → 가장 낮음(임팩트) →
 *   높음(피니시)" 으로 아주 뚜렷한 모양을 그린다. 클럽이 안 보여도 이 흐름만으로
 *   구간을 꽤 정확히 집을 수 있다. 속도는 멈춘 구간(어드레스·피니시)을 가른다.
 *
 * 자동으로 못 하는 것
 *   클럽헤드와 볼은 사람 관절이 아니라 이 모델이 못 본다. 볼은 클럽 규격(라이각)과
 *   손·지면 위치로 추정하고, 화면에서 눌러 고칠 수 있게 한다. 클럽헤드가 필요한
 *   항목(톱 클럽 위치, 임팩트 샤프트 기울기)은 자동 분석에서 빼고, 그렇다고
 *   말한다. 추정으로 잰 척하지 않는다.
 */
(function (global) {
  'use strict';

  var MAX_SAMPLES = 140;     // 이보다 촘촘히 보면 느리기만 하다
  var TARGET_FPS = 24;       // 초당 이만큼 뽑아 본다

  function mid(a, b) { return { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 }; }
  var L = { nose:0, earL:7, earR:8, shL:11, shR:12, wrL:15, wrR:16,
            hipL:23, hipR:24, kneeL:25, kneeR:26, ankL:27, ankR:28 };

  /* ── 1) 영상 훑기 ──────────────────────────────────────────── */
  function seek(video, t) {
    return new Promise(function (res) {
      var done = false;
      function ok() { if (done) return; done = true; video.removeEventListener('seeked', ok); res(); }
      video.addEventListener('seeked', ok);
      try { video.currentTime = t; } catch (e) { ok(); }
      setTimeout(ok, 400);   // 어떤 브라우저는 seeked 를 안 쏜다
    });
  }

  function scan(video, onProgress) {
    var dur = video.duration || 0;
    if (!dur || !isFinite(dur)) return Promise.reject(new Error('영상 길이를 읽지 못했습니다.'));
    var n = Math.max(12, Math.min(MAX_SAMPLES, Math.round(dur * TARGET_FPS)));
    var step = dur / n, track = [], i = 0;
    var wasPaused = video.paused;
    video.pause();

    function next() {
      if (i >= n) {
        if (!wasPaused) { /* 원래 재생 중이었으면 그대로 둔다 */ }
        return Promise.resolve(track);
      }
      var t = Math.min(dur - 0.001, i * step);
      return seek(video, t).then(function () {
        var lms = global.SwingPose.detect(video);
        if (lms) track.push({ t: t, lm: lms });
        i++;
        if (onProgress) onProgress(i / n);
        // 브라우저가 숨 쉴 틈을 준다. 안 그러면 화면이 얼어붙는다.
        return new Promise(function (r) { setTimeout(r, 0); }).then(next);
      });
    }
    return next();
  }

  /* ── 2) 구간 찾기 ──────────────────────────────────────────── */
  function smooth(a, w) {
    var out = [];
    for (var i = 0; i < a.length; i++) {
      var s = 0, c = 0;
      for (var j = Math.max(0, i - w); j <= Math.min(a.length - 1, i + w); j++) { s += a[j]; c++; }
      out.push(s / c);
    }
    return out;
  }
  function clampRange(a, lo, hi) {
    var last = a.length - 1;
    lo = Math.max(0, Math.min(lo, last));
    hi = Math.max(lo, Math.min(hi, last));
    return [lo, hi];
  }
  function argMax(a, lo, hi) {
    var r = clampRange(a, lo, hi), bi = r[0];
    for (var i = r[0]; i <= r[1]; i++) if (a[i] > a[bi]) bi = i;
    return bi;
  }
  function argMin(a, lo, hi) {
    var r = clampRange(a, lo, hi), bi = r[0];
    for (var i = r[0]; i <= r[1]; i++) if (a[i] < a[bi]) bi = i;
    return bi;
  }

  function findPhases(track) {
    if (track.length < 8) return null;
    var hand = track.map(function (f) { return mid(f.lm[L.wrL], f.lm[L.wrR]); });
    var hipY = track.map(function (f) { return mid(f.lm[L.hipL], f.lm[L.hipR]).y; });
    // y 는 아래로 갈수록 크다. 높이는 뒤집어서 본다.
    // 표본 간격에 맞춰 다듬는 폭을 정한다. 흔들리는 영상에서 엉뚱한 봉우리를
    // 피니시로 잡던 문제가 있었다.
    var dtAvg = (track[track.length - 1].t - track[0].t) / Math.max(1, track.length - 1);
    var w = Math.max(1, Math.round(0.06 / Math.max(1e-3, dtAvg)));
    var h = smooth(hand.map(function (p) { return -p.y; }), w);
    var spd = [0];
    for (var i = 1; i < track.length; i++) {
      var dt = Math.max(1e-3, track[i].t - track[i - 1].t);
      spd.push(Math.hypot(hand[i].x - hand[i - 1].x, hand[i].y - hand[i - 1].y) / dt);
    }
    spd = smooth(spd, w);

    var idx = function (t) {   // 초 → 표본 간격 수
      var dt = (track[track.length - 1].t - track[0].t) / (track.length - 1);
      return Math.max(1, Math.round(t / Math.max(1e-3, dt)));
    };

    // 손이 가장 빠른 순간을 스윙의 기준점으로 삼는다(임팩트 언저리).
    var fast = argMax(spd, 1, spd.length - 1);
    // 그 앞쪽에서 손이 가장 높은 곳이 톱.
    var top = argMax(h, fast - idx(1.4), fast);
    // 톱 뒤에서 손이 가장 낮은 곳이 임팩트.
    var imp = argMin(h, top + 1, Math.min(h.length - 1, top + idx(0.9)));
    // 피니시: 임팩트 뒤에서 손이 다시 높이 올라가 "멈춘" 지점.
    // 높이만 보면 흔들리는 영상에서 한참 뒤의 잡음을 집는다. 스윙이 끝나
    // 속도가 떨어진 첫 지점까지만 보고, 그 안에서 가장 높은 곳을 고른다.
    var finLo = Math.min(h.length - 1, imp + Math.max(1, idx(0.12)));
    var finHi = Math.min(h.length - 1, imp + idx(1.2));
    var peak = spd[argMax(spd, imp, finHi)] || 1;
    for (var q = imp + 1; q <= finHi; q++) {
      if (spd[q] < peak * 0.12) { finHi = Math.min(finHi, q + Math.max(1, idx(0.15))); break; }
    }
    var fin = argMax(h, finLo, Math.max(finLo, finHi));

    // 어드레스: 톱 앞쪽에서 손이 거의 멈춰 있던 마지막 지점.
    var swingSpd = spd.slice(top, imp + 1).sort(function (a, b) { return a - b; });
    var still = (swingSpd[Math.floor(swingSpd.length / 2)] || 1) * 0.18;
    var addr = Math.max(0, top - idx(1.6));
    for (var k = top - 1; k >= Math.max(0, top - idx(2.2)); k--) {
      if (spd[k] < still) { addr = k; break; }
    }
    if (top - addr < 2) addr = Math.max(0, top - 2);

    // 테이크백/다운스윙(샤프트가 지면과 나란한 순간)은 클럽이 안 보이므로
    // "손이 골반 높이를 지나는 순간"으로 근사한다. 실제로 그 무렵이다.
    // lo 에서 hi 로 훑으며 손이 골반 높이를 지나는 첫 순간을 찾는다.
    function crossHip(lo, hi, wantBelow) {
      for (var i2 = lo; i2 <= hi; i2++) {
        if (i2 < 0 || i2 >= hand.length) break;
        if (wantBelow ? hand[i2].y >= hipY[i2] : hand[i2].y <= hipY[i2]) return i2;
      }
      return null;
    }
    var p2 = crossHip(addr, top, false);        // 올라가며 골반 위로 올라선 순간
    var p6 = crossHip(top + 1, imp, true);      // 내려오며 골반 아래로 내려온 순간

    // 백스윙(P3)·팔로스루(P9)는 "앞팔이 지면과 나란한" 순간이다. 팔이 안 보여도
    // 그 무렵 손은 어깨 높이를 지난다. 그 교차점으로 잡는다.
    var shY = track.map(function (f) { return mid(f.lm[L.shL], f.lm[L.shR]).y; });
    function crossSh(lo, hi) {
      for (var i4 = lo; i4 <= hi; i4++) {
        if (i4 < 0 || i4 >= hand.length) break;
        if (hand[i4].y <= shY[i4]) return i4;
      }
      return null;
    }
    var p3 = crossSh(p2 != null ? p2 : addr, top);
    var p9 = crossSh(imp + 1, fin);

    var out = { P1: addr, P4: top, P7: imp, P10: fin };
    if (p2 != null && p2 > addr && p2 < top) out.P2 = p2;
    if (p3 != null && p3 > (out.P2 != null ? out.P2 : addr) && p3 < top) out.P3 = p3;
    if (p6 != null && p6 > top && p6 < imp) out.P6 = p6;
    if (p9 != null && p9 > imp && p9 < fin) out.P9 = p9;

    /* 찾은 구간이 정말 "스윙 모양"인지 확인한다.
     * 순서만 맞으면 걸어가는 장면에서도 아무 구간이나 나온다. 손이 실제로
     * 크게 올라갔다가(백스윙) 내려오고(다운스윙) 다시 올라가야(폴로) 스윙이다.
     * 크기는 몸통 길이(어깨~골반)로 나눠 재서 화면 크기와 무관하게 만든다. */
    var last = track.length - 1;
    if ([addr, top, imp, fin].some(function (i3) { return i3 == null || i3 < 0 || i3 > last; })) return null;
    if (!(addr < top && top < imp && imp < fin)) return null;
    if (imp >= last) return null;   // 임팩트가 끝이면 피니시가 안 담긴 영상이다

    var torso = (function () {
      var f0 = track[addr].lm;
      var sh = mid(f0[L.shL], f0[L.shR]), hp = mid(f0[L.hipL], f0[L.hipR]);
      return Math.max(0.04, Math.abs(hp.y - sh.y));
    })();
    var up = (h[top] - h[addr]) / torso;      // 어드레스 → 톱 (손이 올라간 양)
    var dn = (h[top] - h[imp]) / torso;       // 톱 → 임팩트 (내려온 양)
    var thru = (h[fin] - h[imp]) / torso;     // 임팩트 → 피니시 (다시 올라간 양)
    if (up < 0.8 || dn < 0.8 || thru < 0.4) return null;
    return { idx: out, track: track, quality: {
      samples: track.length,
      swingSpan: track[fin].t - track[addr].t,
      peakSpeed: spd[fast]
    } };
  }

  /* ── 3) 우리 좌표 형식으로 ─────────────────────────────────── */
  function pt(lm, i) { return { x: lm[i].x, y: lm[i].y }; }

  function buildMarks(res, view, handed, club, aspect) {
    var marks = {}, weak = [];
    Object.keys(res.idx).forEach(function (fid) {
      var f = res.track[res.idx[fid]], lm = f.lm, m = {};
      var shL = pt(lm, L.shL), shR = pt(lm, L.shR);
      var hipL = pt(lm, L.hipL), hipR = pt(lm, L.hipR);
      var hands = mid(pt(lm, L.wrL), pt(lm, L.wrR));
      if (view === 'dtl') {
        m.head = mid(pt(lm, L.earL), pt(lm, L.earR));
        m.shoulder = mid(shL, shR);
        m.hip = mid(hipL, hipR);
        m.knee = mid(pt(lm, L.kneeL), pt(lm, L.kneeR));
        m.hands = hands;
      } else {
        var leadIsLeft = (handed !== 'left');
        m.head = pt(lm, L.nose);
        m.leadShoulder = leadIsLeft ? shL : shR;
        m.trailShoulder = leadIsLeft ? shR : shL;
        m.leadHip = leadIsLeft ? hipL : hipR;
        m.trailHip = leadIsLeft ? hipR : hipL;
        m.hands = hands;
      }
      [L.shL, L.shR, L.hipL, L.hipR, L.wrL, L.wrR].forEach(function (i) {
        var v = lm[i] && lm[i].visibility;
        if (v != null && v < 0.45) weak.push(fid);
      });
      marks[fid] = m;
    });

    /* 볼 위치 추정 — 어드레스 프레임에서만.
     * 지면 높이(발목)와 손 위치를 알고, 클럽의 샤프트 각도를 알면 볼이 놓인
     * 자리를 삼각형으로 풀 수 있다. 추정이므로 화면에서 눌러 고칠 수 있게 한다. */
    var a = res.track[res.idx.P1].lm;
    var ground = Math.max(a[L.ankL].y, a[L.ankR].y);
    var handsA = mid(pt(a, L.wrL), pt(a, L.wrR));
    var hipA = mid(pt(a, L.hipL), pt(a, L.hipR));
    var away = Math.sign((handsA.x - hipA.x) || 1);   // 몸에서 볼 쪽으로 가는 방향
    var dyPx = Math.max(0.02, ground - handsA.y);      // 손에서 지면까지(세로)
    var run = dyPx / Math.tan(club.planeDeg * Math.PI / 180);  // 실제 가로 거리
    var ball = { x: handsA.x + away * (run / (aspect || 1)), y: ground };
    marks.P1.ball = ball;
    // 클럽헤드는 볼 바로 뒤에 놓인다. 없는 것보다 낫지만 잰 값은 아니다.
    marks.P1.clubhead = { x: ball.x, y: ball.y };

    return { marks: marks, ballEstimated: true, weakFrames: Object.keys(
      weak.reduce(function (o, k) { o[k] = 1; return o; }, {})) };
  }

  /* 전 프레임을 우리 좌표로 바꿔 둔다. 재생할 때 뼈대가 영상을 따라가게 하려면
   * 단계 몇 개가 아니라 모든 프레임의 관절이 필요하다. */
  function toTrack(res, view, handed) {
    return res.track.map(function (f) {
      var lm = f.lm, m = {};
      var shL = pt(lm, L.shL), shR = pt(lm, L.shR);
      var hipL = pt(lm, L.hipL), hipR = pt(lm, L.hipR);
      var hands = mid(pt(lm, L.wrL), pt(lm, L.wrR));
      if (view === 'dtl') {
        m.head = mid(pt(lm, L.earL), pt(lm, L.earR));
        m.shoulder = mid(shL, shR);
        m.hip = mid(hipL, hipR);
        m.knee = mid(pt(lm, L.kneeL), pt(lm, L.kneeR));
        m.hands = hands;
      } else {
        var leadIsLeft = (handed !== 'left');
        m.head = pt(lm, L.nose);
        m.leadShoulder = leadIsLeft ? shL : shR;
        m.trailShoulder = leadIsLeft ? shR : shL;
        m.leadHip = leadIsLeft ? hipL : hipR;
        m.trailHip = leadIsLeft ? hipR : hipL;
        m.hands = hands;
      }
      return { t: f.t, marks: m };
    });
  }

  /* 리듬·템포 — 구간 시각만 있으면 바로 나온다.
   * 백스윙에 걸린 시간 ÷ 다운스윙에 걸린 시간. 투어 평균이 대략 3:1 이다.
   * 이건 추정이 아니라 영상에서 잰 시간이라 믿을 만하다. */
  function rhythm(res) {
    var T = function (id) {
      var i = res.idx[id];
      return i == null ? null : res.track[i].t;
    };
    var p1 = T('P1'), p4 = T('P4'), p7 = T('P7'), p10 = T('P10');
    if (p1 == null || p4 == null || p7 == null) return null;
    var back = p4 - p1, down = p7 - p4;
    if (back <= 0 || down <= 0) return null;
    return {
      back: back, down: down,
      total: (p10 != null ? p10 - p1 : null),
      ratio: back / down
    };
  }

  global.SwingAuto = { scan: scan, findPhases: findPhases, buildMarks: buildMarks,
    toTrack: toTrack, rhythm: rhythm };
})(window);
