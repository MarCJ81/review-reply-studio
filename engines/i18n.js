/* ============================================================
   OneTap i18n runtime (KO / EN)
   · 언어 결정: ?lang= → localStorage(onetap_lang) → navigator.language
   · 정적 HTML·동적 렌더 문구·placeholder·title·aria-label·토스트·모달·<pre>까지 번역
   · 사전: window.ONETAP_STRINGS = { exact: {한국어: English}, rules: [[정규식, 치환, 플래그]] }
   · 헤더에 KO / EN 토글 주입 (클릭 시 URL ?lang + localStorage 저장 후 새로고침)
   ============================================================ */
(function () {
  'use strict';

  var LS_KEY = 'onetap_lang';
  var HANGUL = /[\u3131-\u318E\uAC00-\uD7A3]/;

  function detect() {
    try {
      var q = new URLSearchParams(location.search).get('lang');
      if (q === 'en' || q === 'ko') return q;
    } catch (e) {}
    try {
      var s = localStorage.getItem(LS_KEY);
      if (s === 'en' || s === 'ko') return s;
    } catch (e) {}
    var n = navigator.language || navigator.userLanguage || '';
    return /^ko/i.test(n) ? 'ko' : 'en';
  }

  var LANG = detect();
  window.ONETAP_LANG = LANG;
  var IS_KO = LANG === 'ko';

  try { document.documentElement.setAttribute('lang', LANG); } catch (e) {}

  var STR = window.ONETAP_STRINGS || {};
  var EXACT = STR.exact || {};
  var RULES = [];
  (STR.rules || []).forEach(function (r) {
    try { RULES.push([new RegExp(r[0], r[2] || ''), r[1]]); } catch (e) {}
  });

  // 번역 시도했지만 사전에 없는 문구 수집(검증용)
  var misses = Object.create(null);

  function has(obj, key) { return Object.prototype.hasOwnProperty.call(obj, key); }

  function lookup(key) {
    if (has(EXACT, key)) return EXACT[key];
    for (var i = 0; i < RULES.length; i++) {
      if (RULES[i][0].test(key)) return key.replace(RULES[i][0], RULES[i][1]);
    }
    return null;
  }

  function norm(s) { return s.replace(/\s+/g, ' ').trim(); }

  function translatePlain(text) {
    var core = norm(text);
    if (!core || !HANGUL.test(core)) return null;
    var out = lookup(core);
    if (out == null) { misses[core] = (misses[core] || 0) + 1; return null; }
    if (HANGUL.test(out)) {
      // 짧은 문구는 사전 키를 부분 치환해 본다 (예: "Delete 겨울 가습기 관리법")
      if (core.length <= 60) {
        var keys = Object.keys(EXACT).sort(function (a, b) { return b.length - a.length; });
        var t2 = out;
        for (var ki = 0; ki < keys.length; ki++) {
          if (keys[ki].length >= 2 && t2.indexOf(keys[ki]) >= 0) t2 = t2.split(keys[ki]).join(EXACT[keys[ki]]);
        }
        if (!HANGUL.test(t2)) return t2;
      }
      // "라벨 · 설명" 처럼 조합된 문구는 조각별로 다시 찾는다
      var seps = [' · ', ' — ', ' / '];
      for (var si = 0; si < seps.length; si++) {
        var parts = out.split(seps[si]);
        if (parts.length < 2) continue;
        var okAll = true, done = [];
        for (var pi = 0; pi < parts.length; pi++) {
          var seg = lookup(norm(parts[pi]));
          if (seg == null) { okAll = false; break; }
          done.push(seg);
        }
        if (okAll) return done.join(seps[si]);
      }
    }
    return out;
  }

  var ATTRS = ['placeholder', 'title', 'aria-label', 'alt', 'data-tip', 'data-label', 'data-empty', 'data-hint', 'data-note', 'data-title'];

  function inSkip(node, root) {
    var el = node.nodeType === 1 ? node : node.parentElement;
    while (el && el !== root.parentElement) {
      if (el.hasAttribute && el.hasAttribute('data-i18n-skip')) return true;
      el = el.parentElement;
    }
    return false;
  }

  function translateTextNode(node, root) {
    var raw = node.nodeValue;
    if (!raw || !HANGUL.test(raw)) return;
    if (root && inSkip(node, root)) return;
    var m = /^([\s\S]*?)([^\s][\s\S]*?)?(\s*)$/.exec(raw);
    if (!m) return;
    var lead = m[1] || '', core = m[2] || '', tail = m[3] || '';
    // <pre> 안쪽은 줄 단위로 번역해 줄바꿈 보존
    var pre = node.parentElement && node.parentElement.closest ? node.parentElement.closest('pre') : null;
    if (pre) {
      var lines = raw.split('\n');
      var changed = false;
      for (var i = 0; i < lines.length; i++) {
        var out = translatePlain(lines[i]);
        if (out != null) { lines[i] = out; changed = true; }
      }
      if (changed) node.nodeValue = lines.join('\n');
      return;
    }
    var unitEl = node.parentElement;
    if (unitEl && unitEl.getAttribute && unitEl.getAttribute('data-unit')) {
      var u = lookup('@unit:' + unitEl.getAttribute('data-unit'));
      if (u != null) { node.nodeValue = lead + u + tail; return; }
    }
    if (unitEl && unitEl.classList && unitEl.classList.contains('unit')) {
      var u2 = lookup('@unit');
      if (u2 != null) { node.nodeValue = lead + u2 + tail; return; }
    }
    var out2 = translatePlain(core);
    if (out2 != null) node.nodeValue = lead + out2 + tail;
  }

  function translateAttrs(el, root) {
    if (!el.getAttribute) return;
    if (inSkip(el, root)) return;
    var tag = el.tagName;
    for (var i = 0; i < ATTRS.length; i++) {
      var name = ATTRS[i];
      var v = el.getAttribute(name);
      if (!v || !HANGUL.test(v)) continue;
      var out = translatePlain(v);
      if (out != null) el.setAttribute(name, out);
    }
    if (tag === 'META') {
      var c = el.getAttribute('content');
      if (c && HANGUL.test(c)) {
        var o = translatePlain(c);
        if (o != null) el.setAttribute('content', o);
      }
    }
  }

  function walk(node, root) {
    if (node.nodeType === 3) { translateTextNode(node, root); return; }
    if (node.nodeType !== 1) return;
    var tag = node.tagName;
    if (tag === 'SCRIPT' || tag === 'STYLE' || tag === 'NOSCRIPT') return;
    translateAttrs(node, root);
    var kids = node.childNodes;
    for (var i = 0; i < kids.length; i++) walk(kids[i], root);
  }

  function applyAll() {
    if (IS_KO) return;
    walk(document.documentElement, document.documentElement);
  }

  function injectToggle() {
    if (document.querySelector('.ot-lang')) return;
    var small = window.matchMedia ? window.matchMedia('(max-width: 620px)').matches : false;
    var host = small
      ? (document.querySelector('.topbar-inner') || document.querySelector('.top-actions') || document.querySelector('header'))
      : (document.querySelector('.top-actions') || document.querySelector('.topbar-inner') || document.querySelector('header'));
    var box = document.createElement('div');
    box.className = 'ot-lang';
    box.setAttribute('role', 'group');
    box.setAttribute('aria-label', 'Language');
    box.setAttribute('data-i18n-skip', '');
    box.innerHTML = '<button type="button" data-lang="ko"' + (IS_KO ? ' class="is-on" aria-pressed="true"' : ' aria-pressed="false"') + '>KO</button>' +
                    '<button type="button" data-lang="en"' + (!IS_KO ? ' class="is-on" aria-pressed="true"' : ' aria-pressed="false"') + '>EN</button>';
    if (host) {
      if (host.classList && host.classList.contains('top-actions')) host.insertBefore(box, host.firstChild);
      else host.appendChild(box);
    } else {
      box.style.position = 'fixed'; box.style.top = '8px'; box.style.right = '8px'; box.style.zIndex = 9999;
      document.body.appendChild(box);
    }
    box.addEventListener('click', function (ev) {
      var btn = ev.target.closest ? ev.target.closest('button[data-lang]') : null;
      if (!btn) return;
      var next = btn.getAttribute('data-lang');
      if (next === LANG) return;
      try { localStorage.setItem(LS_KEY, next); } catch (e) {}
      var u = new URL(location.href);
      u.searchParams.set('lang', next);
      location.replace(u.toString());
    });
  }

  function injectStyle() {
    if (document.getElementById('ot-lang-style')) return;
    var st = document.createElement('style');
    st.id = 'ot-lang-style';
    st.textContent =
      '.ot-lang{display:inline-flex;align-items:center;gap:0;flex:none;border:1px solid rgba(120,130,150,.34);border-radius:999px;overflow:hidden;background:transparent;height:30px;font:600 11px/1 ui-sans-serif,system-ui,-apple-system,"Segoe UI",Roboto,sans-serif;letter-spacing:.02em}' +
      '.ot-lang button{appearance:none;background:transparent;border:0;color:inherit;opacity:.62;padding:0 8px;height:100%;cursor:pointer;font:inherit;transition:background .15s,opacity .15s}' +
      '.ot-lang button:hover{opacity:.95}' +
      '.ot-lang button.is-on{background:rgba(120,130,150,.20);opacity:1}' +
      '.ot-lang button:focus-visible{outline:2px solid currentColor;outline-offset:-2px}' +
      '@media (max-width:520px){.ot-lang{height:26px}.ot-lang button{padding:0 6px;font-size:10px}}' +
      '@media (max-width:1500px){html[lang="en"] .topbar-inner{flex-wrap:wrap;row-gap:6px}html[lang="en"] .tabs{order:3;flex-basis:100%}}' +
      '@media (max-width:620px){.ot-lang{order:9;margin-left:auto;align-self:center}}';
    document.head.appendChild(st);
  }

  var scheduled = false;
  function schedule() {
    if (IS_KO || scheduled) return;
    scheduled = true;
    (window.requestAnimationFrame || window.setTimeout)(function () {
      scheduled = false;
      applyAll();
    });
  }

  var observer = null;
  function startObserver() {
    if (IS_KO || observer || !window.MutationObserver) return;
    observer = new MutationObserver(function (records) {
      for (var i = 0; i < records.length; i++) {
        var r = records[i];
        if (r.type === 'childList') {
          for (var j = 0; j < r.addedNodes.length; j++) {
            var n = r.addedNodes[j];
            if (n.nodeType === 3 ? HANGUL.test(n.nodeValue || '') : (n.nodeType === 1 && HANGUL.test(n.textContent || ''))) { schedule(); return; }
          }
        } else if (r.type === 'characterData') {
          if (HANGUL.test(r.target.nodeValue || '')) { schedule(); return; }
        } else if (r.type === 'attributes') {
          var v = r.target.getAttribute && r.target.getAttribute(r.attributeName);
          if (v && HANGUL.test(v)) { schedule(); return; }
        }
      }
    });
    observer.observe(document.documentElement, {
      childList: true, subtree: true, characterData: true,
      attributes: true, attributeFilter: ATTRS.concat(['content'])
    });
  }

  function boot() {
    injectStyle();
    injectToggle();
    applyAll();
    startObserver();
    // 폰트/스크립트 로딩 후 한 번 더
    setTimeout(applyAll, 120);
    setTimeout(applyAll, 600);
  }

  // 앱 코드에서 직접 쓸 수 있는 API
  window.OT = {
    lang: LANG,
    isKo: IS_KO,
    t: function (s) { if (IS_KO) return s; var o = lookup(norm(String(s))); return o == null ? s : o; },
    refresh: function () { applyAll(); },
    misses: function () { return Object.assign({}, misses); },
    // 현재 화면에 남은 한글 텍스트 + 주변 문맥(검증·번역용)
    scan: function () {
      var out = [];
      if (IS_KO) return out;
      var w = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT, null);
      var n;
      while ((n = w.nextNode())) {
        var t = (n.nodeValue || '').trim();
        if (!t || !HANGUL.test(t)) continue;
        if (n.parentElement && n.parentElement.closest('[data-i18n-skip]')) continue;
        var p = n.parentElement;
        var ctx = (p && (p.closest('li,td,th,p,label,button,h1,h2,h3,span,div,option') || p).innerText || '').replace(/\s+/g, ' ').trim().slice(0, 110);
        out.push({ t: t, c: ctx });
      }
      document.querySelectorAll('[placeholder],[title],[aria-label],[alt]').forEach(function (el) {
        ATTRS.forEach(function (a) {
          var v = el.getAttribute(a);
          if (v && HANGUL.test(v) && !el.closest('[data-i18n-skip]')) out.push({ t: '@' + a + ': ' + v, c: (el.innerText || '').replace(/\s+/g, ' ').trim().slice(0, 90) });
        });
      });
      return out;
    },

    // 현재 화면에 남은 한글 텍스트(검증용)
    leftover: function () {
      var out = [];
      if (IS_KO) return out;
      var w = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT, null);
      var n;
      while ((n = w.nextNode())) {
        var t = (n.nodeValue || '').trim();
        if (t && HANGUL.test(t) && !(n.parentElement && n.parentElement.closest('[data-i18n-skip]'))) out.push(t);
      }
      document.querySelectorAll('[placeholder],[title],[aria-label],[alt]').forEach(function (el) {
        ATTRS.forEach(function (a) {
          var v = el.getAttribute(a);
          if (v && HANGUL.test(v) && !el.closest('[data-i18n-skip]')) out.push('@' + a + ': ' + v);
        });
      });
      return out;
    }
  };

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', boot);
  else boot();
})();
