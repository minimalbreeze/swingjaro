/* 스윙자로 — 분석 엔진
 *
 * 입력 : 화면에서 찍은 관절 좌표(영상 크기로 나눈 0~1 정규화 좌표)
 * 출력 : 측정치 + 문제 구간 목록 + 오버레이가 그릴 도형 정의
 *
 * ── 좌표계 ──
 * 화면 좌표를 그대로 쓴다(x 오른쪽, y 아래). 각도를 낼 때만 y를 뒤집어
 * 수학 좌표로 바꾼다. 모든 길이는 어깨너비·척추길이 같은 몸 치수로 나눠서
 * 정규화하므로 카메라 거리·영상 해상도가 달라도 값이 흔들리지 않는다.
 *
 * ── 좌우 판별 ──
 * 오른손잡이/왼손잡이를 묻지 않는다. 측면은 "엉덩이에서 볼이 있는 쪽",
 * 정면은 "뒤쪽 어깨에서 앞쪽 어깨로 가는 쪽"을 타깃 방향으로 잡는다.
 * 찍은 점만으로 방향이 정해지므로 어느 손잡이든 그대로 동작한다.
 */
(function (global) {
  'use strict';

  /* ── 기하 도우미 ─────────────────────────────────────────────────
   * 좌표는 영상 크기로 나눈 0~1 값이라 x 와 y 의 물리적 축척이 다르다.
   * 세로 영상(9:16)에서 x 1칸은 y 1칸의 0.5625배 길이다. 각도와 거리는
   * 반드시 이 종횡비를 보정한 뒤에 계산한다. 보정을 빼먹으면 세로 영상에서
   * 척추각이 실제의 절반으로 나온다.
   */
  function toAspect(marks, aspect) {
    var out = {};
    Object.keys(marks).forEach(function (fid) {
      var src = marks[fid], dst = {};
      Object.keys(src).forEach(function (j) { dst[j] = { x: src[j].x * aspect, y: src[j].y }; });
      out[fid] = dst;
    });
    return out;
  }

  function mid(a, b) { return { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 }; }
  function dist(a, b) { return Math.hypot(a.x - b.x, a.y - b.y); }
  var DEG = 180 / Math.PI;

  // 직선 a-b 가 수평선과 이루는 각. 0~90. 어느 쪽으로 기울었든 같은 값이 나온다.
  function slope(a, b) {
    var dx = Math.abs(b.x - a.x), dy = Math.abs(b.y - a.y);
    return Math.atan2(dy, dx) * DEG;
  }
  // 직선 a-b 가 수직선과 이루는 각. 0~90.
  function tilt(a, b) {
    var dx = Math.abs(b.x - a.x), dy = Math.abs(b.y - a.y);
    return Math.atan2(dx, dy) * DEG;
  }
  // b 가 a 보다 얼마나 "위에" 있는지. -90(한참 아래) ~ +90(한참 위).
  // 좌우 어느 쪽에 있든 부호가 뒤집히지 않아서 어깨 기울기·톱 클럽 높이에 쓰기 좋다.
  function elevation(a, b) {
    return Math.atan2(-(b.y - a.y), Math.abs(b.x - a.x)) * DEG;
  }
  // 점 p 가 직선 a-b 에서 떨어진 부호 있는 거리. 부호는 직선의 어느 쪽인지를 뜻한다.
  function signedDist(p, a, b) {
    var ux = b.x - a.x, uy = b.y - a.y, L = Math.hypot(ux, uy);
    if (L < 1e-9) return 0;
    return ((p.x - a.x) * uy - (p.y - a.y) * ux) / L;
  }

  /* ── 밴드 판정 ────────────────────────────────────────────────────
   * 값이 [lo,hi] 안이면 정상. 밖이면 벗어난 양을 step 으로 나눠 1~3단계 심각도.
   */
  function judge(value, lo, hi, step) {
    if (value == null || isNaN(value)) return null;
    var dev = value < lo ? lo - value : (value > hi ? value - hi : 0);
    var sev = dev <= 0 ? 0 : Math.min(3, Math.max(1, Math.ceil(dev / step)));
    return { value: value, lo: lo, hi: hi, dev: dev, sev: sev, over: value > hi, under: value < lo };
  }

  var SENS = { strict: 0.78, normal: 1, lenient: 1.3 };

  /* ── 측면(다운더라인) 분석 ────────────────────────────────────────
   * M  : 종횡비 보정된 좌표 — 모든 측정에 쓴다.
   * raw: 원본 정규화 좌표 — 캔버스에 그릴 도형에 쓴다.
   */
  function analyzeDTL(M, raw, club, k, aspect, shift, session_ballEstimated) {
    var m = {}, shapes = [], P1 = M.P1, R1 = raw.P1;
    if (!P1) return { metrics: m, shapes: shapes };

    var ballRef = P1.ball || P1.clubhead;                  // 플레인 라인의 출발점
    var spineLen = dist(P1.hip, P1.shoulder) || 1e-6;      // 이 시점의 길이 단위
    var ballDir = Math.sign((ballRef.x - P1.hip.x) || 1);  // 화면에서 볼이 있는 쪽

    /* 플레인 밴드
     *  아래 선(샤프트 플레인) : 볼 → 어드레스 손
     *  위 선(어깨 플레인)     : 볼 → 어드레스 어깨
     * 어떤 점이 이 밴드의 어디쯤인지를 0(샤프트 플레인)~1(어깨 플레인) 비율로 잰다.
     * 1보다 크면 밴드 위(가파름), 0보다 작으면 밴드 아래(누움/갇힘)다.
     */
    var bandRef = signedDist(P1.shoulder, ballRef, P1.hands);
    function planeRatio(p) {
      if (!p || Math.abs(bandRef) < 1e-9) return null;
      return signedDist(p, ballRef, P1.hands) / bandRef;
    }

    if (!session_ballEstimated) {
      m.planeAngleP1 = { v: slope(ballRef, P1.hands), unit: '°',
        label: '어드레스 샤프트 각도',
        ideal: [club.planeDeg - club.planeTol * k, club.planeDeg + club.planeTol * k] };
    }
    m.spineTiltP1 = { v: tilt(P1.hip, P1.shoulder), unit: '°',
      label: '어드레스 척추 기울기', ideal: [club.spineTilt[0] - 5 * k, club.spineTilt[1] + 5 * k] };

    if (M.P4) {
      m.clubPlaneP4 = { v: planeRatio(M.P4.clubhead), unit: '',
        label: '톱 클럽 위치 (플레인 밴드)', ideal: [-1.15 - 0.5 * (k - 1), 1.75 + 0.5 * (k - 1)] };
      if (M.P4.clubhead) {
        m.topShaftAngle = { v: elevation(M.P4.hands, M.P4.clubhead), unit: '°',
          label: '톱 클럽헤드 높이 (+ 손보다 위)', ideal: [-10 * k, 90] };
      }
      m.headMoveDTL = { v: dist(M.P4.head, P1.head) / spineLen, unit: '×척추',
        label: '머리 이동 (어드레스→톱)', ideal: [0, 0.22 * k] };
    }
    if (M.P6) {
      var sf = shift || 0;
      m.handsPlaneP6 = { v: planeRatio(M.P6.hands), unit: '',
        label: '다운스윙 손 위치 (플레인 밴드)', ideal: [-1.6 * k + sf, 0.55 * k + sf] };
      m.clubPlaneP6 = { v: planeRatio(M.P6.clubhead), unit: '',
        label: '다운스윙 클럽 위치 (플레인 밴드)', ideal: [-1.0 - 1.6 * k + sf, 1.35 * k + sf] };
    }
    if (M.P7) {
      m.spineTiltP7 = { v: tilt(M.P7.hip, M.P7.shoulder), unit: '°', label: '임팩트 척추 기울기' };
      m.spineChange = { v: m.spineTiltP1.v - m.spineTiltP7.v, unit: '°',
        label: '척추각 변화 (+ 몸이 일어섬)', ideal: [-7 * k, 9 * k] };
      m.hipThrust = { v: ((M.P7.hip.x - P1.hip.x) * ballDir) / spineLen, unit: '×척추',
        label: '엉덩이가 볼 쪽으로 나온 양', ideal: [-1, 0.13 * k] };
    }
    // 측면 영상에서 타깃 방향은 화면 안쪽이라 임팩트 샤프트 기울기(핸드퍼스트)는
    // 잴 수 없다. 이 항목은 정면 영상에서만 판정한다.

    /* 오버레이 도형 — 정규화 좌표(raw) 기준 */
    var rBall = R1.ball || R1.clubhead;
    var rSpine = Math.hypot((R1.hip.x - R1.shoulder.x) * aspect, R1.hip.y - R1.shoulder.y) || 0.2;
    shapes.push({ type: 'band', id: 'planeBand', apex: rBall, a: R1.hands, b: R1.shoulder,
      extend: 2.4, fill: 'rgba(0,230,180,0.10)',
      steps: ['P2','P3','P4','P6'] });
    shapes.push({ type: 'line', id: 'shaftPlane', from: rBall, to: R1.hands, extend: 2.6,
      color: '#00e6a0', width: 2.6, label: '샤프트 플레인',
      steps: ['P1','P2','P3','P4','P6'] });
    shapes.push({ type: 'line', id: 'shoulderPlane', from: rBall, to: R1.shoulder, extend: 2.0,
      color: '#00e6a0', width: 2.2, dash: [10, 8], label: '어깨 플레인',
      steps: ['P4','P6'], only: 'all' });
    shapes.push({ type: 'line', id: 'spineP1', from: R1.hip, to: R1.shoulder, extend: 1.35,
      color: '#ffa63d', width: 2.6, label: '척추선', steps: ['P1','P7'] });
    shapes.push({ type: 'vline', id: 'buttLine', x: R1.hip.x, color: '#ff5fa2', width: 2.2,
      dash: [8, 7], label: '엉덩이 기준선', steps: ['P7'] });
    shapes.push({ type: 'circle', id: 'headZone', center: R1.head, r: rSpine * 0.22 * k,
      color: '#ffd400', width: 2.4, dash: [7, 6], label: '머리 허용 범위',
      steps: ['P4'] });
    if (R1.ball) shapes.push({ type: 'dot', id: 'ball', at: R1.ball, r: 4.5, color: '#ffffff',
      label: '볼', steps: ['P1','P7'] });
    shapes.push({ type: 'trace', id: 'handPath', points: ['hands'], color: 'rgba(255,95,162,.85)',
      width: 1.8, label: '손 궤적', steps: ['P10'], only: 'all' });
    return { metrics: m, shapes: shapes };
  }

  /* ── 정면(페이스온) 분석 ──────────────────────────────────────────── */
  function analyzeFO(M, raw, club, k, aspect) {
    var m = {}, shapes = [], P1 = M.P1, R1 = raw.P1;
    if (!P1) return { metrics: m, shapes: shapes };

    var shW = dist(P1.leadShoulder, P1.trailShoulder) || 1e-6;
    var hipW = dist(P1.leadHip, P1.trailHip) || 1e-6;
    var tgt = Math.sign((P1.leadShoulder.x - P1.trailShoulder.x) || 1); // 타깃 방향
    var hipC1 = mid(P1.leadHip, P1.trailHip);

    // 뒤쪽 어깨가 낮을수록 +. 오른손잡이는 오른어깨가 아래에 오는 게 정상이다.
    m.shoulderTiltP1 = { v: elevation(P1.trailShoulder, P1.leadShoulder), unit: '°',
      label: '어드레스 어깨 기울기 (+ 뒤쪽 어깨가 낮음)',
      ideal: [club.shoulderTiltP1[0] - 5 * k, club.shoulderTiltP1[1] + 5 * k] };

    if (M.P4) {
      var p4 = M.P4;
      // 어깨가 카메라 쪽으로 돌수록 두 어깨 사이 "보이는" 거리가 짧아진다.
      m.shoulderTurn = { v: dist(p4.leadShoulder, p4.trailShoulder) / shW, unit: '×어깨너비',
        label: '톱 어깨 회전 (작을수록 많이 돌아감)', ideal: [0, 0.80 * k] };
      m.sway = { v: ((p4.trailHip.x - P1.trailHip.x) * -tgt) / hipW, unit: '×골반너비',
        label: '백스윙 골반 스웨이', ideal: [-1, 0.30 * k] };
      // 톱에서는 앞쪽 어깨가 낮아야 한다. 0 근처거나 음수면 리버스 피벗.
      m.shoulderTiltP4 = { v: elevation(p4.leadShoulder, p4.trailShoulder), unit: '°',
        label: '톱 어깨 기울기 (+ 앞쪽 어깨가 낮음)', ideal: [14 - 7 * (k - 1), 90] };
      m.headShift = { v: dist(p4.head, P1.head) / shW, unit: '×어깨너비',
        label: '머리 이동 (어드레스→톱)', ideal: [0, 0.24 * k] };
    }
    if (M.P7) {
      var p7 = M.P7, hipC7 = mid(p7.leadHip, p7.trailHip);
      m.weightShift = { v: ((hipC7.x - hipC1.x) * tgt) / hipW, unit: '×골반너비',
        label: '임팩트 골반 이동 (타깃 쪽)', ideal: [0.06 / k, 0.62 * k] };
      if (p7.clubhead) {
        m.shaftLeanP7 = { v: tilt(p7.clubhead, p7.hands) *
            Math.sign(((p7.hands.x - p7.clubhead.x) * tgt) || 1), unit: '°',
          label: '임팩트 샤프트 기울기 (+ 손이 앞섬)',
          ideal: [club.shaftLeanP7[0] - 6 * k, club.shaftLeanP7[1] + 6 * k] };
      }
    }
    if (M.P10) {
      m.hipTurnFinish = { v: dist(M.P10.leadHip, M.P10.trailHip) / hipW, unit: '×골반너비',
        label: '피니시 골반 회전 (작을수록 많이 돌아감)', ideal: [0, 0.85 * k] };
    }
    // 톱에서 팔은 카메라 쪽으로 겹쳐 보여 길이가 짧게 찍힌다. 정면 2D 로는
    // 스윙 아크 폭(팔 접힘)을 믿을 만하게 잴 수 없어 자동 판정에서 뺐다.

    var rShW = Math.hypot((R1.leadShoulder.x - R1.trailShoulder.x) * aspect, R1.leadShoulder.y - R1.trailShoulder.y) || 0.2;
    var rHipC = { x: (R1.leadHip.x + R1.trailHip.x) / 2, y: (R1.leadHip.y + R1.trailHip.y) / 2 };
    var rShC = { x: (R1.leadShoulder.x + R1.trailShoulder.x) / 2, y: (R1.leadShoulder.y + R1.trailShoulder.y) / 2 };
    shapes.push({ type: 'vline', id: 'headLine', x: R1.head.x, color: '#ffd400', width: 2.2,
      dash: [8, 7], label: '머리 기준선', steps: ['P4'] });
    shapes.push({ type: 'circle', id: 'headZone', center: R1.head, r: rShW * 0.24 * k,
      color: '#ffd400', width: 2.4, dash: [7, 6], label: '머리 허용 범위',
      steps: ['P4'], only: 'all' });
    shapes.push({ type: 'vline', id: 'leadHipLine', x: R1.leadHip.x, color: '#4ab8ff', width: 2.2,
      dash: [8, 7], label: '앞쪽 골반선', steps: ['P6','P7','P10'] });
    shapes.push({ type: 'vline', id: 'trailHipLine', x: R1.trailHip.x, color: '#2f7fe0', width: 2.2,
      dash: [8, 7], label: '뒤쪽 골반선', steps: ['P2','P3'] });
    shapes.push({ type: 'line', id: 'shoulderLine', from: R1.trailShoulder, to: R1.leadShoulder,
      extend: 1.25, color: '#00e6a0', width: 2.6, label: '어깨 라인', steps: ['P1','P4'] });
    shapes.push({ type: 'line', id: 'spineFO', from: rHipC, to: rShC, extend: 1.3,
      color: '#ffa63d', width: 2.6, label: '척추선', steps: ['P1','P4','P7'], only: 'all' });
    if (R1.ball) shapes.push({ type: 'dot', id: 'ball', at: R1.ball, r: 4.5, color: '#ffffff',
      label: '볼', steps: ['P1','P7'] });
    shapes.push({ type: 'trace', id: 'handPath', points: ['hands'], color: 'rgba(255,95,162,.85)',
      width: 1.8, label: '손 궤적', steps: ['P10'], only: 'all' });
    /* 헤드 궤적은 클럽헤드를 여러 구간에서 알 때만 그린다. 자동 인식은
     * 클럽을 보지 못해 어드레스 한 곳뿐인데, 그걸로 선을 그으면 점 하나가
     * 엉뚱한 데 찍혀 "헤드 궤적"이라고 붙는다. 없느니만 못하다. */
    var headPts = Object.keys(raw).filter(function (f) {
      return raw[f] && raw[f].clubhead;
    }).length;
    if (headPts >= 3) {
      shapes.push({ type: 'trace', id: 'clubPath', points: ['clubhead'], color: 'rgba(255,138,61,.85)',
        width: 1.8, label: '헤드 궤적', steps: ['P10'], only: 'all' });
    }
    return { metrics: m, shapes: shapes };
  }

  /* ── 측정치 → 문제 구간 ──────────────────────────────────────────
   * 2D 로 믿을 만하게 재지는 항목만 자동 판정한다. 잴 수 없는 항목은 아예
   * 계산하지 않는다 — 근거 없는 진단은 없느니만 못하다.
   */
  function findFaults(m, view, k) {
    var out = [];
    function push(id, j, note) {
      if (!j || !j.sev) return;
      out.push({ faultId: id, sev: j.sev, metric: j, note: note || '' });
    }
    function J(key, step) {
      var x = m[key];
      if (!x || x.v == null || isNaN(x.v) || !x.ideal) return null;
      var r = judge(x.v, x.ideal[0], x.ideal[1], step);
      if (r) { r.label = x.label; r.unit = x.unit; }
      return r;
    }

    if (view === 'dtl') {
      var pa = J('planeAngleP1', 4 * k);
      if (pa) push('setup_posture', pa, pa.over
        ? '샤프트가 기준보다 서 있습니다. 볼에 너무 가까이 섰거나 그립을 너무 세웠을 수 있습니다.'
        : '샤프트가 기준보다 누워 있습니다. 볼에서 너무 멀리 섰을 수 있습니다.');
      var st = J('spineTiltP1', 5 * k);
      if (st) push('setup_posture', st, st.over ? '상체를 필요 이상으로 숙였습니다.' : '상체가 필요보다 서 있습니다.');

      var c4 = J('clubPlaneP4', 0.7 * k);
      if (c4) push(c4.over ? 'steep_top' : 'flat_top', c4);
      var ts = J('topShaftAngle', 9 * k);
      if (ts && ts.under) push('overswing', ts);

      var h6 = J('handsPlaneP6', 0.45 * k);
      if (h6) push(h6.over ? 'over_the_top' : 'under_plane', h6);
      var c6 = J('clubPlaneP6', 0.8 * k);
      if (c6) push(c6.over ? 'over_the_top' : 'under_plane', c6);

      push('early_extension', J('hipThrust', 0.08 * k));
      var sc = J('spineChange', 5 * k);
      if (sc && sc.over) push('loss_of_posture', sc);
      push('head_move', J('headMoveDTL', 0.10 * k));
    } else {
      var t1 = J('shoulderTiltP1', 5 * k);
      if (t1) push('setup_tilt', t1, t1.over
        ? '뒤쪽 어깨가 필요 이상으로 내려가 있습니다.'
        : '어깨가 거의 수평입니다. 뒤쪽 어깨가 자연스럽게 내려가야 합니다.');
      push('short_turn', J('shoulderTurn', 0.10 * k));
      push('sway', J('sway', 0.13 * k));
      var t4 = J('shoulderTiltP4', 9 * k);
      if (t4 && t4.under) push('reverse_pivot', t4);
      push('head_move', J('headShift', 0.11 * k));
      var ws = J('weightShift', 0.16 * k);
      if (ws) push(ws.under ? 'hanging_back' : 'slide', ws);
      var sl = J('shaftLeanP7', 6 * k);
      if (sl) push(sl.under ? 'casting' : 'excessive_lean', sl);
      push('poor_finish', J('hipTurnFinish', 0.10 * k));
    }

    // 같은 문제가 두 지표에서 잡히면 더 심각한 쪽 하나만 남긴다.
    var seen = {};
    out.forEach(function (f) {
      if (!seen[f.faultId] || seen[f.faultId].sev < f.sev) seen[f.faultId] = f;
    });
    return Object.keys(seen).map(function (id) { return seen[id]; })
      .sort(function (a, b) { return b.sev - a.sev; });
  }

  /* ── 메인 ────────────────────────────────────────────────────────── */
  function analyze(session) {
    var club = global.SwingData.CLUBS[session.club];
    var k = SENS[session.sensitivity] || 1;
    var aspect = session.aspect > 0 ? session.aspect : 1;   // 영상 가로/세로 비
    var M = toAspect(session.marks, aspect);
    var res = session.view === 'dtl'
      ? analyzeDTL(M, session.marks, club, k, aspect, session.planeShift || 0, !!session.ballEstimated)
      : analyzeFO(M, session.marks, club, k, aspect);
    var faults = findFaults(res.metrics, session.view, k);

    // 100점에서 문제의 심각도만큼 깎는다. 심각한 문제 하나가 경미한 여럿보다 크게 깎인다.
    var penalty = faults.reduce(function (s, f) { return s + f.sev * f.sev * 2.2; }, 0);
    var score = Math.max(30, Math.round(100 - penalty));

    return {
      club: session.club, view: session.view, sensitivity: session.sensitivity,
      metrics: res.metrics, shapes: res.shapes, faults: faults, score: score,
      framesUsed: Object.keys(session.marks), ballEstimated: !!session.ballEstimated,
      auto: !!session.auto
    };
  }

  /* ── 장비 피팅 ────────────────────────────────────────────────────
   * 구질 · 탄도 · 컨택 · 거리를 받아 클럽 스펙/샤프트/셋업/볼 제안을 만든다.
   * 스윙 진단 결과가 있으면 "먼저 스윙을 고쳐야 하는 항목"을 경고로 붙인다.
   */
  var SPEED_RATIO = { driver:1.00, wood:0.968, hybrid:0.947, long:0.925, mid:0.872, short:0.808, wedge:0.766 };
  var FLEX_TABLE = [
    { max: 72,  flex:'L (레이디스)',   shaft:'40~45g 그라파이트', note:'가볍고 부드러운 쪽이 헤드 스피드를 살립니다' },
    { max: 83,  flex:'A · R2 (시니어)', shaft:'45~52g 그라파이트', note:'R로 가면 볼이 안 뜨고 거리가 줄어들 수 있습니다' },
    { max: 92,  flex:'R (레귤러)',      shaft:'50~57g 그라파이트', note:'가장 무난한 구간입니다' },
    { max: 99,  flex:'SR',              shaft:'55~62g 그라파이트', note:'R과 S 사이. 템포가 빠르면 S 쪽을 봅니다' },
    { max:107,  flex:'S (스티프)',      shaft:'60~70g 그라파이트', note:'템포가 느긋하면 SR도 후보입니다' },
    { max:999,  flex:'X (엑스트라 스티프)', shaft:'65~80g 그라파이트', note:'토크가 낮은 쪽이 방향성에 유리합니다' }
  ];

  function fitting(input, report) {
    var club = global.SwingData.CLUBS[input.club];
    var flight = null, i;
    for (i = 0; i < global.SwingData.FLIGHTS.length; i++) {
      if (global.SwingData.FLIGHTS[i].id === input.flight) flight = global.SwingData.FLIGHTS[i];
    }
    var items = [], warns = [], speed = null;

    /* 1) 거리 → 헤드 스피드 추정 */
    if (input.carry > 0) {
      var clubMph = input.carry / club.carryK;
      var driverMph = clubMph / (SPEED_RATIO[club.id] || 1);
      // 비교 기준: 내가 넣어둔 내 거리가 있으면 그것, 없으면 아마추어 평균.
      var mine = input.myCarry > 0;
      var ref = mine ? input.myCarry : club.refCarry;
      speed = {
        clubMph: Math.round(clubMph * 10) / 10,
        clubMs: Math.round(clubMph * 0.44704 * 10) / 10,
        driverMph: Math.round(driverMph * 10) / 10,
        driverMs: Math.round(driverMph * 0.44704 * 10) / 10,
        refCarry: ref,
        refIsMine: mine,
        refLabel: mine ? '내 기준' : '아마추어 평균',
        gap: Math.round(input.carry - ref)
      };
      var row = FLEX_TABLE[0];
      for (i = 0; i < FLEX_TABLE.length; i++) { if (driverMph <= FLEX_TABLE[i].max) { row = FLEX_TABLE[i]; break; } }
      speed.flexRow = row;
      // 총 비거리(런 포함)나 다른 클럽 거리를 넣으면 추정치가 통째로 어긋난다.
      // 사람이 낼 수 있는 범위를 벗어나면 숫자를 그대로 쓰지 말라고 알린다.
      if (driverMph > 122 || driverMph < 52) {
        speed.implausible = true;
        warns.push('입력하신 ' + input.carry + '미터를 ' + club.label +
          ' 기준으로 환산하면 드라이버 헤드 스피드 ' + speed.driverMph +
          ' mph 가 나옵니다. 사람이 내기 어려운 값이라 아래 샤프트 제안은 믿지 마세요. ' +
          '굴러간 거리를 뺀 캐리(m)인지, 고른 클럽이 실제로 그 거리를 내는 클럽인지 확인해 주세요.');
      }
      items.push({ part:'샤프트 강도', suggest: row.flex,
        why: '추정 헤드 스피드 ' + speed.driverMph + ' mph(드라이버 환산, ' + speed.driverMs + ' m/s) 기준입니다. ' + row.note });
      items.push({ part:'샤프트 무게', suggest: row.shaft,
        why: '무게가 강도보다 스윙 템포에 더 크게 영향을 줍니다. 템포가 빠르면 무거운 쪽, 느긋하면 가벼운 쪽입니다.' });
    }

    /* 2) 로프트 — 드라이버는 헤드 스피드가, 나머지는 탄도가 주 근거 */
    if (club.id === 'driver' && speed) {
      var lofts = speed.driverMph < 85 ? '11.5~13°' : speed.driverMph < 95 ? '10.5~12°'
                : speed.driverMph < 105 ? '9.5~10.5°' : '8.5~9.5°';
      items.push({ part:'드라이버 로프트', suggest: lofts,
        why: '헤드 스피드가 낮을수록 로프트를 키워 발사각을 확보해야 캐리가 늘어납니다.' });
    }
    if (input.traj === 'low') {
      items.push({ part:'로프트', suggest: '현재보다 1~1.5° 큰 쪽',
        why: '탄도가 낮아 캐리가 짧습니다. 로프트를 키우면 발사각과 스핀이 함께 올라가 볼이 더 오래 떠 있습니다.' });
      items.push({ part:'샤프트 킥포인트', suggest: '로우 킥(저킥) — 손잡이 쪽이 단단하고 헤드 쪽이 잘 휘는 타입',
        why: '임팩트에서 헤드가 더 들려 발사각을 만들어 줍니다.' });
    } else if (input.traj === 'high') {
      items.push({ part:'로프트', suggest: '현재보다 1~1.5° 작은 쪽',
        why: '탄도가 지나치게 높아 앞으로 가는 힘이 위로 새고 있습니다.' });
      items.push({ part:'샤프트 킥포인트', suggest: '하이 킥(고킥) — 헤드 쪽이 단단한 타입',
        why: '발사각과 스핀을 함께 낮춰 탄도를 눌러 줍니다.' });
    }

    /* 3) 구질 → 페이스·라이각·무게추·그립 */
    if (flight) {
      var slicey = (flight.curve >= 2), hooky = (flight.curve <= -2);
      var pathOut = (flight.path === '아웃-인'), pathIn = (flight.path === '인-아웃');

      if (slicey) {
        items.push({ part:'헤드 성향', suggest:'드로우 바이어스 / 페이스 앵글 클로즈드 1~2°',
          why:'페이스가 열려 맞고 있습니다. 페이스가 미리 닫혀 있는 헤드가 우측 휨을 직접 줄여 줍니다.' });
        items.push({ part:'무게추 위치', suggest:'힐(안쪽) 쪽으로 이동 / 힐 웨이트 모델',
          why:'무게중심이 힐 쪽에 있으면 페이스가 더 빨리 닫힙니다.' });
        items.push({ part:'그립 두께', suggest:'현재보다 얇게 (또는 언더리스팅 1겹 제거)',
          why:'그립이 얇을수록 손 회전이 빨라져 페이스가 잘 닫힙니다.' });
        items.push({ part:'샤프트 토크', suggest:'높은 토크(4.5 이상) + 부드러운 강도',
          why:'토크가 높으면 헤드가 더 잘 돌아와 페이스가 닫히는 데 도움이 됩니다.' });
        items.push({ part:'볼', suggest:'저스핀 디스턴스 볼 (2피스)',
          why:'사이드스핀이 덜 걸려 휘는 폭이 줄어듭니다.' });
      }
      if (hooky) {
        items.push({ part:'헤드 성향', suggest:'페이드 바이어스 / 페이스 앵글 오픈 0.5~1°',
          why:'페이스가 과하게 닫혀 맞고 있습니다. 열린 페이스 앵글이 좌측 감김을 직접 줄여 줍니다.' });
        items.push({ part:'무게추 위치', suggest:'토(끝) 쪽으로 이동',
          why:'무게중심이 토 쪽이면 페이스가 늦게 닫혀 훅이 줄어듭니다.' });
        items.push({ part:'그립 두께', suggest:'미드사이즈 (또는 언더리스팅 1~2겹 추가)',
          why:'그립이 두꺼우면 손 회전이 느려져 페이스가 덜 닫힙니다.' });
        items.push({ part:'샤프트 토크', suggest:'낮은 토크(3.5 이하) + 한 단계 단단한 강도',
          why:'헤드가 덜 돌아와 좌측 미스가 줄어듭니다.' });
      }
      if (pathOut && !slicey) {
        items.push({ part:'셋업 정렬', suggest:'어깨 라인을 목표선과 나란히 (열려 있는지 확인)',
          why:'아웃-인 궤도는 어깨가 왼쪽을 향해 열린 셋업에서 시작되는 경우가 많습니다. 장비보다 정렬이 먼저입니다.' });
      }
      if (pathIn && flight.curve === 0) {
        items.push({ part:'볼 위치', suggest:'현재보다 공 반 개 왼쪽(타깃 쪽)',
          why:'인-아웃 궤도에서 볼이 오른쪽에 있으면 페이스가 닫히기 전에 맞아 푸시가 납니다.' });
      }
      if (flight.id === 'straight') {
        items.push({ part:'현재 세팅', suggest:'구질 교정용 변경은 필요하지 않습니다',
          why:'페이스와 궤도가 맞아 있습니다. 이 상태에서는 거리·탄도 최적화(로프트·샤프트)만 손대는 것이 안전합니다.' });
      }
    }

    /* 4) 컨택 → 라이각·길이·볼 위치 */
    if (input.contact === 'toe') {
      items.push({ part:'볼과의 거리', suggest:'공 반 개 정도 가깝게',
        why:'셋업 거리가 컨택 위치를 바꾸는 가장 빠른 방법입니다.' });
    } else if (input.contact === 'heel') {
      items.push({ part:'클럽 길이', suggest:'0.25~0.5인치 짧게 (또는 그립을 내려 잡기)',
        why:'짧아지면 컨택 위치가 페이스 중앙 쪽으로 모입니다.' });
    } else if (input.contact === 'thin') {
      items.push({ part:'볼 위치 / 셋업', suggest:'볼을 공 반 개 오른쪽, 체중 앞쪽 55%',
        why:'탑볼은 최저점이 볼보다 뒤에 생겨 올라오면서 맞는 현상입니다.' });
    } else if (input.contact === 'fat') {
      items.push({ part:'웨지 바운스', suggest:'바운스 10~14° 이상 (뒤땅이 잦은 경우)',
        why:'바운스가 크면 클럽이 땅에 박히지 않고 미끄러져 실수의 폭이 줄어듭니다.' });
      items.push({ part:'볼 위치 / 체중', suggest:'볼을 중앙 쪽으로, 임팩트 체중 앞쪽으로',
        why:'뒤땅은 최저점이 볼보다 뒤에 있는 문제입니다.' });
    }

    /* 4-b) 라이각 — 구질과 컨택 두 신호를 합쳐 한 번만 제안한다.
     * 둘이 반대 방향을 가리키면 숫자를 밀어붙이지 않고 실측부터 권한다. */
    var lieVote = 0, lieSrc = [];
    if (flight && flight.curve >= 2) { lieVote += 1; lieSrc.push('우측으로 휘는 구질'); }
    if (flight && flight.curve <= -2) { lieVote -= 1; lieSrc.push('좌측으로 감기는 구질'); }
    if (input.contact === 'toe')  { lieVote += 1; lieSrc.push('토(끝) 쪽 컨택'); }
    if (input.contact === 'heel') { lieVote -= 1; lieSrc.push('힐(안쪽) 쪽 컨택'); }
    if (lieSrc.length) {
      var lieText = lieVote >= 2 ? '2° 업라이트' : lieVote === 1 ? '1° 업라이트'
                  : lieVote === -1 ? '1° 플랫' : lieVote <= -2 ? '2° 플랫'
                  : '조정 보류 — 임팩트 테이프로 실제 접촉 위치부터 확인';
      var lieWhy = lieVote === 0
        ? lieSrc.join(' 과 ') + ' 이(가) 서로 반대 방향을 가리킵니다. 숫자를 바꾸기 전에 실제 접촉 위치를 먼저 재세요.'
        : lieSrc.join(' · ') + ' 근거입니다. 업라이트는 페이스를 왼쪽, 플랫은 오른쪽으로 향하게 합니다(아이언에서 효과가 큽니다). 조정 전후로 임팩트 테이프 확인은 필수입니다.';
      items.push({ part:'라이각', suggest: lieText, why: lieWhy });
    }

    /* 5) 거리 부족/과다 */
    if (speed) {
      if (speed.gap <= -18) {
        items.push({ part:'클럽 총 중량', suggest:'현재보다 10~20g 가벼운 세팅 시타',
          why:speed.refLabel + '(' + speed.refCarry + 'm)보다 ' + Math.abs(speed.gap) +
            '미터 짧습니다. 클럽이 무거워 스피드가 눌리고 있을 수 있습니다.' });
        items.push({ part:'볼 압축', suggest:'저압축 볼(컴프레션 50~70)',
          why:'헤드 스피드가 낮을 때 저압축 볼이 초속을 더 잘 만들어 줍니다.' });
      } else if (speed.gap >= 18) {
        items.push({ part:'스윙웨이트', suggest:'D2~D4 쪽으로 조금 무겁게',
          why:speed.refLabel + '(' + speed.refCarry + 'm)보다 ' + speed.gap +
            '미터 깁니다. 무게를 조금 더 주면 방향성이 안정됩니다.' });
      }
    }

    /* 6) 스윙 진단과의 연결 — 장비로 덮으면 안 되는 항목 경고 */
    if (report && report.faults) {
      var ids = report.faults.map(function (f) { return f.faultId; });
      function has(x) { return ids.indexOf(x) >= 0; }
      if (has('early_extension') || has('loss_of_posture')) {
        warns.push('얼리 익스텐션 / 척추각 상실이 잡혔습니다. 이 상태에서 라이각을 맞추면 스윙이 좋아진 뒤 다시 틀어집니다. 라이각 조정은 자세 교정 뒤로 미루세요.');
      }
      if (has('over_the_top')) {
        warns.push('오버 더 톱이 잡혔습니다. 드로우 바이어스 헤드는 슬라이스를 줄여 주지만 궤도 자체는 그대로입니다. 장비는 보조로만 쓰고 궤도 교정을 병행하세요.');
      }
      if (has('casting')) {
        warns.push('캐스팅(손목 조기 방출)이 잡혔습니다. 로프트를 낮추면 탄도는 내려가지만 컨택은 더 불안정해질 수 있습니다. 손목 각도 유지가 먼저입니다.');
      }
      if (has('sway') || has('slide') || has('head_move')) {
        warns.push('중심 이동이 큽니다. 컨택 위치가 매번 달라지므로 라이각·길이 피팅 결과의 신뢰도가 떨어집니다. 중심 안정 뒤 피팅을 권합니다.');
      }
    }

    // 같은 항목(part)이 여러 규칙에서 나오면 하나로 합친다.
    var byPart = {}, merged = [];
    items.forEach(function (it) {
      var ex = byPart[it.part];
      if (!ex) { byPart[it.part] = it; merged.push(it); return; }
      if (ex.suggest !== it.suggest) ex.suggest += ' · ' + it.suggest;
      if (ex.why.indexOf(it.why) < 0) ex.why += ' ' + it.why;
    });
    return { speed: speed, flight: flight, items: merged, warns: warns };
  }

  global.SwingAnalyze = {
    analyze: analyze, fitting: fitting,
    dist: dist, mid: mid, signedDist: signedDist,
    slope: slope, tilt: tilt, elevation: elevation
  };
})(window);
