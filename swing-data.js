/* 스윙자로 — 데이터 레이어
 *
 * 이 파일은 "판단 기준"만 담는다. 계산은 swing-analyze.js, 화면은 swing.js가 맡는다.
 * 값은 전부 2D 영상(정면/측면 한 대 촬영) 기준의 실무 코칭 범위이며,
 * 3D 런치모니터 수치가 아니다. 화면에서도 항상 "영상 기준 추정치"로 표기한다.
 */
(function (global) {
  'use strict';

  /* ── 클럽 ────────────────────────────────────────────────────────────────
   * planeDeg : 어드레스 때 샤프트(그립→헤드)가 지면과 이루는 각도.
   *            라이각과는 다르다. 카메라가 뒤에서 볼 때 화면에 찍히는 각도라
   *            팔이 늘어진 만큼 라이각보다 완만하게 보인다.
   * attack   : 이상적인 입사각(+ 는 어퍼블로).
   * carryK   : 캐리(미터) ÷ 헤드스피드(mph) 환산 계수. 헤드스피드 역산에 쓴다.
   * refCarry : 아마추어 남성 중급 기준 캐리(미터). 거리 진단의 비교선.
   */
  var CLUBS = {
    driver:  { id:'driver',  label:'드라이버',      short:'DR',  emoji:'🏌️', planeDeg:48, planeTol:6, attack:[ 1, 5], ballPos:'왼발 뒤꿈치 안쪽', carryK:2.085, refCarry:196, spineTilt:[30,38], shoulderTiltP1:[10,18], shaftLeanP7:[-10, 2] },
    wood:    { id:'wood',    label:'페어웨이 우드',  short:'FW',  emoji:'🌲', planeDeg:52, planeTol:6, attack:[-2, 1], ballPos:'왼겨드랑이 아래',   carryK:1.957, refCarry:178, spineTilt:[31,39], shoulderTiltP1:[8,15],  shaftLeanP7:[-5, 4] },
    hybrid:  { id:'hybrid',  label:'유틸리티',      short:'UT',  emoji:'🪄', planeDeg:55, planeTol:6, attack:[-3,-1], ballPos:'중앙에서 공 2개 왼쪽', carryK:1.847, refCarry:165, spineTilt:[32,40], shoulderTiltP1:[7,14],  shaftLeanP7:[-2, 7] },
    long:    { id:'long',    label:'롱아이언 (4·5)', short:'L-I', emoji:'📏', planeDeg:58, planeTol:6, attack:[-4,-2], ballPos:'중앙에서 공 1.5개 왼쪽', carryK:1.737, refCarry:151, spineTilt:[33,41], shoulderTiltP1:[6,13],  shaftLeanP7:[1, 10] },
    mid:     { id:'mid',     label:'미들아이언 (6·7·8)', short:'M-I', emoji:'⛳', planeDeg:61, planeTol:6, attack:[-5,-3], ballPos:'스탠스 중앙',      carryK:1.618, refCarry:133, spineTilt:[34,42], shoulderTiltP1:[5,12],  shaftLeanP7:[4, 14] },
    short:   { id:'short',   label:'숏아이언 (9·PW)', short:'S-I', emoji:'🎯', planeDeg:63, planeTol:6, attack:[-6,-4], ballPos:'중앙에서 공 0.5개 오른쪽', carryK:1.381, refCarry:105, spineTilt:[35,43], shoulderTiltP1:[4,11],  shaftLeanP7:[6, 16] },
    wedge:   { id:'wedge',   label:'웨지',          short:'WG',  emoji:'🔧', planeDeg:65, planeTol:7, attack:[-7,-4], ballPos:'중앙~중앙 오른쪽',   carryK:1.079, refCarry:78,  spineTilt:[35,44], shoulderTiltP1:[3,10],  shaftLeanP7:[7, 18] }
  };
  var CLUB_ORDER = ['driver','wood','hybrid','long','mid','short','wedge'];

  /* ── 촬영 각도 ──────────────────────────────────────────────────────────
   * dtl(측면) : 볼과 타깃을 잇는 선의 연장선 뒤. 손 높이에서 촬영.
   * fo(정면)  : 골퍼를 정면으로. 벨트~가슴 높이에서 촬영.
   */
  var VIEWS = {
    dtl: {
      id:'dtl', label:'측면 (다운더라인)', emoji:'📐',
      desc:'볼 뒤 타깃라인 연장선에서, 손 높이로 촬영',
      guide:[
        '볼과 타깃을 잇는 선을 뒤로 연장한 위치에 카메라를 둔다',
        '높이는 골퍼의 손(그립) 높이. 눈높이에서 찍으면 플레인이 실제보다 눕는다',
        '거리는 3~4m. 클럽 전체와 발끝~머리 위 여유가 모두 들어오게',
        '세로 촬영, 60fps 이상 권장. 카메라는 삼각대로 고정'
      ],
      // 화면에서 타깃 방향(오른손잡이 기준 화면 안쪽). 마킹 순서대로 찍는다.
      joints:[
        { id:'head',     label:'머리',        hint:'귀 또는 관자놀이', color:'#ffd166' },
        { id:'shoulder', label:'어깨',        hint:'목 아래 어깨 뒤쪽', color:'#4dd4ac' },
        { id:'hip',      label:'엉덩이',      hint:'엉덩이 가장 뒤쪽',  color:'#5aa9e6' },
        { id:'knee',     label:'무릎',        hint:'무릎 앞쪽',        color:'#b779ef' },
        { id:'hands',    label:'손(그립)',    hint:'양손 그립 중앙',    color:'#ff8fb3' },
        { id:'clubhead', label:'클럽헤드',    hint:'헤드 중심',        color:'#ff9166' }
      ],
      extra:[ { id:'ball', label:'볼', hint:'공의 중심', color:'#ffffff', frame:'P1' } ]
    },
    fo: {
      id:'fo', label:'정면 (페이스온)', emoji:'🧍',
      desc:'골퍼 정면에서, 벨트~가슴 높이로 촬영',
      guide:[
        '골퍼의 가슴을 정면으로 마주 보는 위치에 카메라를 둔다',
        '높이는 벨트~가슴. 볼-발-머리가 한 화면에 다 들어오게',
        '거리는 3~4m. 좌우로 클럽이 나가는 폭까지 여유를 둔다',
        '세로 촬영, 60fps 이상 권장. 카메라는 삼각대로 고정'
      ],
      joints:[
        { id:'head',          label:'머리',        hint:'코 또는 턱 끝',       color:'#ffd166' },
        { id:'leadShoulder',  label:'앞쪽 어깨',   hint:'타깃 쪽 어깨(오른손잡이=왼쪽)', color:'#4dd4ac' },
        { id:'trailShoulder', label:'뒤쪽 어깨',   hint:'타깃 반대쪽 어깨',    color:'#2f6f5e' },
        { id:'leadHip',       label:'앞쪽 골반',   hint:'타깃 쪽 골반',        color:'#5aa9e6' },
        { id:'trailHip',      label:'뒤쪽 골반',   hint:'타깃 반대쪽 골반',    color:'#3d7fbf' },
        { id:'hands',         label:'손(그립)',    hint:'양손 그립 중앙',      color:'#ff8fb3' },
        { id:'clubhead',      label:'클럽헤드',    hint:'헤드 중심',           color:'#ff9166' }
      ],
      extra:[ { id:'ball', label:'볼', hint:'공의 중심', color:'#ffffff', frame:'P1' } ]
    }
  };

  /* ── 키프레임(P 시스템) ────────────────────────────────────────────────
   * required=true 인 프레임만 있으면 분석이 돌아간다. 나머지는 있으면 더 정밀해진다.
   */
  /* 스윙 8단계. 코칭에서 쓰는 표준 구분을 그대로 따른다.
   * required 인 네 곳만 있으면 분석이 돌아가고, 나머지는 있으면 더 정밀해진다.
   * step 은 이 단계에서 드러나는 문제를 묶는 열쇠다(swing-faults 의 phase 와 연결). */
  var FRAMES = [
    { id:'P1',  label:'어드레스',   emoji:'🧍', required:true,  step:'address',
      cue:'셋업 완료, 클럽이 볼 뒤에 놓인 순간',
      what:'스윙의 출발점. 여기가 틀어지면 뒤가 전부 보상 동작이 된다.' },
    { id:'P2',  label:'테이크어웨이', emoji:'↗️', required:false, step:'takeaway',
      cue:'샤프트가 지면과 나란해진 순간(백스윙)',
      what:'클럽이 몸 안쪽으로 감기는지, 밖으로 들리는지가 여기서 갈린다.' },
    { id:'P3',  label:'백스윙',     emoji:'🔼', required:false, step:'backswing',
      cue:'앞쪽 팔이 지면과 나란해진 순간',
      what:'회전으로 올라가는지 팔로 들어 올리는지가 보인다.' },
    { id:'P4',  label:'톱',         emoji:'⛰️', required:true,  step:'top',
      cue:'백스윙이 멈추고 방향이 바뀌기 직전',
      what:'저장한 힘의 크기와 클럽의 방향이 정해지는 지점.' },
    { id:'P6',  label:'다운스윙',   emoji:'↘️', required:false, step:'downswing',
      cue:'샤프트가 다시 지면과 나란해진 순간(다운)',
      what:'오버 더 톱인지 아닌지가 결정되는 가장 중요한 구간.' },
    { id:'P7',  label:'임팩트',     emoji:'💥', required:true,  step:'impact',
      cue:'클럽페이스가 볼에 닿는 프레임',
      what:'모든 것이 결정되는 1/1000초. 자세가 무너지면 여기서 드러난다.' },
    { id:'P9',  label:'팔로스루',   emoji:'➡️', required:false, step:'follow',
      cue:'임팩트 뒤 앞쪽 팔이 다시 지면과 나란해진 순간',
      what:'릴리즈가 이어지는지, 붙잡는지가 보인다.' },
    { id:'P10', label:'피니시',     emoji:'🏁', required:true,  step:'finish',
      cue:'완전히 돌아 멈춘 마무리 자세',
      what:'끝까지 회전했는지, 균형이 남아 있는지.' }
  ];

  // 문제(phase) → 이 단계에서 보여준다
  var FAULT_STEP = {
    address:'P1', backswing:'P4', transition:'P4',
    downswing:'P6', impact:'P7', follow:'P10'
  };

  /* ── 구질 ────────────────────────────────────────────────────────────────
   * start : 출발 방향(-좌 / 0직 / +우), curve : 휘는 방향(-좌 / 0직 / +우). 오른손잡이 기준.
   * face  : 임팩트 페이스 상태, path : 클럽 궤도. 장비 처방의 근거가 된다.
   */
  var FLIGHTS = [
    { id:'straight', label:'스트레이트', emoji:'➡️', start:0, curve:0,  face:'스퀘어',      path:'스퀘어',   note:'페이스와 궤도가 모두 목표선에 맞은 상태' },
    { id:'draw',     label:'드로우',     emoji:'↩️', start:1, curve:-1, face:'약간 닫힘',   path:'인-아웃',  note:'오른쪽으로 출발해 왼쪽으로 살짝 감기는 좋은 구질' },
    { id:'fade',     label:'페이드',     emoji:'↪️', start:-1,curve:1,  face:'약간 열림',   path:'아웃-인',  note:'왼쪽으로 출발해 오른쪽으로 살짝 열리는 좋은 구질' },
    { id:'hook',     label:'훅',         emoji:'🪝', start:-1,curve:-2, face:'많이 닫힘',   path:'인-아웃',  note:'왼쪽으로 출발해 더 왼쪽으로 크게 감김' },
    { id:'slice',    label:'슬라이스',   emoji:'🍰', start:-1,curve:2,  face:'많이 열림',   path:'아웃-인',  note:'왼쪽으로 출발해 오른쪽으로 크게 휘어 나감' },
    { id:'push',     label:'푸시',       emoji:'👉', start:2, curve:0,  face:'궤도에 스퀘어',path:'인-아웃',  note:'오른쪽으로 곧게 밀려 나감' },
    { id:'pull',     label:'풀',         emoji:'👈', start:-2,curve:0,  face:'궤도에 스퀘어',path:'아웃-인',  note:'왼쪽으로 곧게 당겨 나감' },
    { id:'pushslice',label:'푸시 슬라이스',emoji:'🌀',start:2, curve:2,  face:'궤도보다 열림',path:'인-아웃',  note:'오른쪽으로 출발해 더 오른쪽으로 휨' },
    { id:'pullhook', label:'풀 훅',      emoji:'🌪️', start:-2,curve:-2, face:'궤도보다 닫힘',path:'아웃-인',  note:'왼쪽으로 출발해 더 왼쪽으로 감김' }
  ];

  var TRAJECTORIES = [
    { id:'low',  label:'낮음', emoji:'📉', note:'끝에서 힘없이 떨어짐' },
    { id:'mid',  label:'중간', emoji:'➖', note:'적당한 높이로 날아감' },
    { id:'high', label:'높음', emoji:'📈', note:'많이 뜨고 앞으로 못 감' }
  ];

  var CONTACTS = [
    { id:'center', label:'중앙',   emoji:'🎯' },
    { id:'toe',    label:'토(끝)', emoji:'↗️' },
    { id:'heel',   label:'힐(안쪽)',emoji:'↖️' },
    { id:'thin',   label:'탑볼',   emoji:'🔺' },
    { id:'fat',    label:'뒤땅',   emoji:'🟫' }
  ];

  global.SwingData = {
    CLUBS: CLUBS, CLUB_ORDER: CLUB_ORDER,
    VIEWS: VIEWS, FRAMES: FRAMES, FAULT_STEP: FAULT_STEP,
    FLIGHTS: FLIGHTS, TRAJECTORIES: TRAJECTORIES, CONTACTS: CONTACTS
  };
})(window);
