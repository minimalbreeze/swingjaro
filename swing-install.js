/* 스윙자로 — 바탕화면 바로가기(설치)
 *
 * 연습장에서 브라우저 주소창을 거치지 않고 아이콘 하나로 바로 열기 위한 기능이다.
 * 설치되면 주소창이 사라져 화면이 넓어지고, 영상 스크러빙 공간도 그만큼 늘어난다.
 *
 * 플랫폼마다 방식이 다르다.
 *  - 안드로이드 크롬 / PC 크롬·엣지 : beforeinstallprompt 이벤트를 잡아 버튼으로 띄운다.
 *  - 아이폰 사파리 : 이 이벤트가 아예 없다. 공유 버튼을 눌러 직접 추가해야 해서
 *    안내문을 보여주는 것 말고 할 수 있는 게 없다.
 * 그래서 버튼 하나로 끝나지 않고, 안 되는 경우의 수동 안내를 항상 같이 둔다.
 */
(function (global) {
  'use strict';

  var deferred = null;
  var listeners = [];

  function isStandalone() {
    return (global.matchMedia && global.matchMedia('(display-mode: standalone)').matches) ||
           global.navigator.standalone === true;
  }
  function platform() {
    var ua = global.navigator.userAgent || '';
    if (/iPad|iPhone|iPod/.test(ua) || (/Macintosh/.test(ua) && 'ontouchend' in document)) return 'ios';
    if (/Android/.test(ua)) return 'android';
    return 'desktop';
  }
  function canPrompt() { return !!deferred; }

  function notify() { listeners.forEach(function (fn) { try { fn(); } catch (e) {} }); }
  function onChange(fn) { listeners.push(fn); }

  global.addEventListener('beforeinstallprompt', function (e) {
    e.preventDefault();      // 브라우저 기본 배너를 막고 우리 버튼으로 띄운다
    deferred = e;
    notify();
  });
  global.addEventListener('appinstalled', function () {
    deferred = null;
    notify();
  });

  // 설치 창을 띄운다. 결과는 'accepted' | 'dismissed' | 'unavailable'.
  function install() {
    if (!deferred) return Promise.resolve('unavailable');
    var e = deferred;
    deferred = null;
    return e.prompt().then(function () {
      return e.userChoice;
    }).then(function (r) {
      notify();
      return (r && r.outcome) || 'dismissed';
    }).catch(function () {
      notify();
      return 'dismissed';
    });
  }

  var STEPS = {
    ios: {
      title: '아이폰 · 아이패드 (사파리)',
      note: '사파리에서 열어야 합니다. 크롬·네이버앱 등 다른 브라우저에서는 홈 화면 추가가 안 됩니다.',
      steps: [
        '화면 아래(아이패드는 위) <b>공유 버튼</b>(⬆️ 네모에 화살표)을 누릅니다.',
        '목록을 아래로 내려 <b>"홈 화면에 추가"</b>를 찾습니다.',
        '이름을 확인하고 오른쪽 위 <b>추가</b>를 누릅니다.',
        '홈 화면에 스윙자로 아이콘이 생깁니다.'
      ]
    },
    android: {
      title: '안드로이드 (크롬)',
      note: '위 버튼이 안 보이면 아래대로 하시면 됩니다.',
      steps: [
        '오른쪽 위 <b>⋮ (점 세 개)</b>를 누릅니다.',
        '<b>"앱 설치"</b> 또는 <b>"홈 화면에 추가"</b>를 누릅니다.',
        '<b>설치</b>를 누릅니다.',
        '홈 화면에 아이콘이 생깁니다.'
      ]
    },
    desktop: {
      title: 'PC (크롬 · 엣지)',
      note: '설치하면 브라우저 탭이 아니라 별도 창으로 열립니다.',
      steps: [
        '주소창 오른쪽 끝의 <b>설치 아이콘</b>(⊕ 또는 모니터 모양)을 누릅니다.',
        '안 보이면 오른쪽 위 <b>⋮ → 캐스트·저장 및 공유 → 페이지를 앱으로 설치</b>를 찾습니다.',
        '<b>설치</b>를 누릅니다.',
        '바탕화면과 시작 메뉴에 바로가기가 생깁니다.'
      ]
    }
  };

  global.SwingInstall = {
    isStandalone: isStandalone, platform: platform, canPrompt: canPrompt,
    install: install, onChange: onChange, STEPS: STEPS
  };
})(window);
