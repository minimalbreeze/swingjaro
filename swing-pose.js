/* 스윙자로 — 자동 관절 인식 (선택 기능)
 *
 * MediaPipe Pose Landmarker 를 눌렀을 때만 내려받아 쓴다. 평소에는 아무것도
 * 불러오지 않으므로 인터넷이 없어도 앱 전체가 그대로 동작한다.
 *
 * 자동 인식은 "초안"이다. 확정이 아니다.
 *  - 클럽헤드와 볼은 사람 관절이 아니라서 이 모델이 못 잡는다. 직접 찍어야 한다.
 *  - 모델이 잡는 건 관절 "중심"이다. 안내대로 손으로 찍은 점(엉덩이 가장 뒤쪽,
 *    귀 등)과 위치가 조금 달라서 절대 각도가 몇 도씩 어긋날 수 있다.
 *    그래서 한 번의 분석 안에서는 자동/수동을 섞지 말고 하나로 통일해야 한다.
 */
(function (global) {
  'use strict';

  // 1.0 에서 API 이름이 바뀌었을 가능성에 대비해 구버전을 뒤에 둔다.
  var SOURCES = [
    { v: '1.0.1',   lib: 'https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@1.0.1/vision_bundle.mjs',
                    wasm: 'https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@1.0.1/wasm' },
    { v: '0.10.35', lib: 'https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@0.10.35/vision_bundle.mjs',
                    wasm: 'https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@0.10.35/wasm' }
  ];
  var MODEL = 'https://storage.googleapis.com/mediapipe-models/pose_landmarker/' +
              'pose_landmarker_lite/float16/1/pose_landmarker_lite.task';

  var landmarker = null, loadingPromise = null, loadedVersion = null;

  function ready() { return !!landmarker; }
  function version() { return loadedVersion; }

  /* 라이브러리 + 모델을 한 번만 내려받는다. 실패하면 다음 버전으로 넘어간다. */
  function load(onStatus) {
    if (landmarker) return Promise.resolve(landmarker);
    if (loadingPromise) return loadingPromise;

    loadingPromise = (function () {
      var lastErr = null;
      function attempt(i) {
        if (i >= SOURCES.length) {
          loadingPromise = null;
          return Promise.reject(lastErr || new Error('자동 인식 모듈을 불러오지 못했습니다.'));
        }
        var src = SOURCES[i];
        if (onStatus) onStatus('자동 인식 모듈 준비 중… (' + src.v + ')');
        return import(/* webpackIgnore: true */ src.lib)
          .then(function (mod) {
            if (!mod || !mod.FilesetResolver || !mod.PoseLandmarker) {
              throw new Error('이 버전(' + src.v + ')에는 기대한 기능이 없습니다.');
            }
            if (onStatus) onStatus('모델 내려받는 중… 약 6MB, 처음 한 번만 받습니다');
            return mod.FilesetResolver.forVisionTasks(src.wasm).then(function (fileset) {
              return mod.PoseLandmarker.createFromOptions(fileset, {
                baseOptions: { modelAssetPath: MODEL, delegate: 'GPU' },
                // 프레임을 건너뛰며 아무 시점이나 보기 때문에 IMAGE 모드를 쓴다.
                // VIDEO 모드는 타임스탬프가 항상 커져야 해서 되감기에 맞지 않는다.
                runningMode: 'IMAGE',
                numPoses: 1
              });
            }).catch(function (e) {
              // GPU 위임이 안 되는 기기가 있다. CPU 로 한 번 더 시도한다.
              if (onStatus) onStatus('GPU를 쓸 수 없어 CPU로 다시 시도합니다…');
              return mod.FilesetResolver.forVisionTasks(src.wasm).then(function (fileset) {
                return mod.PoseLandmarker.createFromOptions(fileset, {
                  baseOptions: { modelAssetPath: MODEL, delegate: 'CPU' },
                  runningMode: 'IMAGE', numPoses: 1
                });
              });
            }).then(function (lm) {
              landmarker = lm; loadedVersion = src.v;
              return lm;
            });
          })
          .catch(function (e) { lastErr = e; return attempt(i + 1); });
      }
      return attempt(0);
    })();
    return loadingPromise;
  }

  /* 지금 화면에 떠 있는 프레임에서 관절을 찾는다. 좌표는 0~1 정규화. */
  function detect(videoEl) {
    if (!landmarker) return null;
    var res = landmarker.detect(videoEl);
    if (!res || !res.landmarks || !res.landmarks.length) return null;
    return res.landmarks[0];
  }

  /* MediaPipe 33개 점 중 필요한 것 */
  var L = { nose:0, earL:7, earR:8, shL:11, shR:12, wrL:15, wrR:16,
            hipL:23, hipR:24, kneeL:25, kneeR:26 };

  function pt(lms, i) {
    var p = lms[i];
    return p ? { x: p.x, y: p.y, vis: (p.visibility == null ? 1 : p.visibility) } : null;
  }
  function mid2(a, b) {
    if (!a) return b; if (!b) return a;
    return { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2, vis: Math.min(a.vis, b.vis) };
  }

  /* 우리 관절 이름으로 옮긴다.
   * handed: 'right' | 'left'  — 정면 영상에서 앞/뒤 어깨를 가르는 데만 쓴다.
   * 클럽헤드와 볼은 넣지 않는다(모델이 못 잡는다).
   */
  function mapTo(view, lms, handed) {
    var out = {}, weak = [];
    function put(id, p, label) {
      if (!p) return;
      out[id] = { x: p.x, y: p.y };
      if (p.vis < 0.5) weak.push(label || id);
    }
    var shL = pt(lms, L.shL), shR = pt(lms, L.shR);
    var hipL = pt(lms, L.hipL), hipR = pt(lms, L.hipR);

    if (view === 'dtl') {
      // 뒤에서 보면 좌우가 거의 겹친다. 중점이 한쪽만 고르는 것보다 안정적이다.
      put('head', mid2(pt(lms, L.earL), pt(lms, L.earR)), '머리');
      put('shoulder', mid2(shL, shR), '어깨');
      put('hip', mid2(hipL, hipR), '엉덩이');
      put('knee', mid2(pt(lms, L.kneeL), pt(lms, L.kneeR)), '무릎');
      put('hands', mid2(pt(lms, L.wrL), pt(lms, L.wrR)), '손');
    } else {
      var leadIsLeft = (handed !== 'left'); // 오른손잡이의 앞쪽은 자기 왼쪽
      put('head', pt(lms, L.nose), '머리');
      put('leadShoulder', leadIsLeft ? shL : shR, '앞쪽 어깨');
      put('trailShoulder', leadIsLeft ? shR : shL, '뒤쪽 어깨');
      put('leadHip', leadIsLeft ? hipL : hipR, '앞쪽 골반');
      put('trailHip', leadIsLeft ? hipR : hipL, '뒤쪽 골반');
      put('hands', mid2(pt(lms, L.wrL), pt(lms, L.wrR)), '손');
    }
    return { marks: out, weak: weak };
  }

  global.SwingPose = {
    load: load, detect: detect, mapTo: mapTo, ready: ready, version: version,
    // 모델이 못 잡는 항목. 화면에서 "직접 찍어야 한다"고 알리는 데 쓴다.
    manualOnly: { dtl: ['clubhead', 'ball'], fo: ['clubhead', 'ball'] }
  };
})(window);
