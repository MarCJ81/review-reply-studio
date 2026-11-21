/* ============================================================
   pro-studio.js  ·  앱별 Pro 연결 글루  v1.0.0
   ------------------------------------------------------------
   pro-api-connector.js(공용 엔진)를 앱 화면에 붙일 때 쓰는 얇은 층.
   의존성 없는 순수 JS(UMD). 브라우저에서는 window.ProStudio,
   node 에서는 require('./pro-studio.js').

   이 모듈이 하는 일
   1) 연결 여부·상태 확인 (무료 모드 / Pro 연결됨)
   2) buildProPrompt → generate 요청 묶음 만들기 (앱별 보정 한 줄 허용)
   3) 응답에서 JSON만 안전하게 꺼내기 (코드펜스·앞뒤 설명 제거)
   4) 실패를 앱이 그대로 보여 줄 수 있는 문장으로 바꾸기
   5) 배지·버튼 상태 동기화

   원칙
   - 미연결이면 요청을 보내지 않고 { ok:false, mode:'free', reason:'not_connected' }.
   - 예외를 던지지 않는다(앱이 무료 모드로 계속 돌아야 한다).
   - 키는 이 모듈을 거치지 않는다(엔진이 저장·전송·마스킹을 맡는다).
   ============================================================ */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory(root);
  else root.ProStudio = factory(root);
})(typeof globalThis !== 'undefined' ? globalThis : this, function (root) {
  'use strict';

  var VERSION = '1.0.0';

  function str(v) {
    if (v === null || v === undefined) return '';
    return String(v);
  }

  function trim(v) { return str(v).replace(/^\s+|\s+$/g, ''); }

  /* ── JSON 꺼내기 ────────────────────────────────────────
     모델은 "설명 + ```json ... ```" 형태로 답하는 일이 잦다.
     코드펜스를 벗기고 첫 '{' ~ 마지막 '}' 만 잘라 읽는다.
     그래도 안 되면 null. */
  function parseJSON(text) {
    var raw = trim(text);
    if (!raw) return { ok: false, reason: 'empty', value: null };

    var body = raw;
    var fence = /```(?:json|JSON)?\s*([\s\S]*?)```/.exec(raw);
    if (fence && trim(fence[1])) body = trim(fence[1]);

    function tryParse(s) {
      try { return { ok: true, value: JSON.parse(s) }; } catch (e) { return null; }
    }

    var direct = tryParse(body);
    if (direct) return direct;

    var start = body.indexOf('{');
    var end = body.lastIndexOf('}');
    if (start >= 0 && end > start) {
      var sliced = tryParse(body.slice(start, end + 1));
      if (sliced) return sliced;
      /* 끝에 붙은 쉼표만 손보고 한 번 더 (흔한 형식 오류) */
      var cleaned = body.slice(start, end + 1).replace(/,\s*([}\]])/g, '$1');
      var second = tryParse(cleaned);
      if (second) return second;
    }

    return { ok: false, reason: 'not_json', value: null };
  }

  function create(P) {
    var engine = P || root.ProConnector || null;

    function engineReady() { return !!(engine && typeof engine.generate === 'function'); }

    function connected() {
      try { return !!(engine && typeof engine.isConnected === 'function' && engine.isConnected()); }
      catch (e) { return false; }
    }

    function state() {
      try {
        if (engine && typeof engine.getState === 'function') return engine.getState();
      } catch (e) { /* ignore */ }
      return { connected: false, mode: 'free', provider: null, providerName: '' };
    }

    function providerName() {
      var s = state();
      return s && s.connected ? (s.providerName || s.provider || 'Pro') : '';
    }

    /**
     * buildRequest(kind, input, tweak)
     * kind: 'blog' | 'commerce' | 'cardnews' | 'reviewReply' | 'shortform' | 'image'
     * tweak: { appendPrompt, maxTokens, temperature } — 앱이 프롬프트 한 줄만 보강할 때
     */
    function buildRequest(kind, input, tweak) {
      if (!engine || typeof engine.buildProPrompt !== 'function') return null;
      var spec;
      try { spec = engine.buildProPrompt(kind, input || {}); } catch (e) { return null; }
      if (!spec) return null;
      var t = tweak || {};
      var prompt = str(spec.prompt);
      /* 앱이 프롬프트의 조건 한 줄을 바꿔야 할 때(장수·비트 수 등).
         replace: [[찾을 문장, 바꿀 문장], ...] — 먼저 적용하고, 그다음 덧붙인다. */
      if (t.replace && t.replace.length) {
        for (var i = 0; i < t.replace.length; i++) {
          var pair = t.replace[i] || [];
          var from = str(pair[0]);
          if (from && prompt.indexOf(from) >= 0) prompt = prompt.split(from).join(str(pair[1]));
        }
      }
      if (t.appendPrompt) prompt += '\n\n' + str(t.appendPrompt);
      var options = {
        temperature: typeof t.temperature === 'number' ? t.temperature : spec.temperature,
        maxTokens: typeof t.maxTokens === 'number' ? t.maxTokens : spec.maxTokens
      };
      return {
        task: 'text',
        prompt: prompt,
        system: spec.system,
        options: options,
        spec: spec
      };
    }

    /**
     * run(kind, input, tweak) → Promise<result>
     * 성공: { ok:true, mode:'pro', data, raw, result, meta }
     * 실패: { ok:false, mode:'free'|'pro', reason, message }
     */
    function run(kind, input, tweak) {
      if (!engineReady()) {
        return Promise.resolve({
          ok: false, mode: 'free', reason: 'engine_missing',
          message: 'Pro 연결 엔진을 불러오지 못했습니다. 새로고침해 주세요.'
        });
      }
      if (!connected()) {
        return Promise.resolve({
          ok: false, mode: 'free', reason: 'not_connected',
          message: '무료 모드입니다. Pro API를 연결하면 이 버튼이 바로 완성본을 만듭니다.'
        });
      }
      var req = buildRequest(kind, input, tweak);
      if (!req) {
        return Promise.resolve({ ok: false, mode: 'pro', reason: 'bad_request', message: '요청을 만들지 못했습니다. 입력을 확인해 주세요.' });
      }
      var pending;
      try { pending = engine.generate(req); } catch (e) {
        return Promise.resolve({ ok: false, mode: 'pro', reason: 'error', message: (e && e.message) || '요청 중 문제가 생겼습니다.' });
      }
      return Promise.resolve(pending).then(function (res) {
        if (!res || !res.ok) {
          return {
            ok: false, mode: (res && res.mode) || 'pro', reason: (res && res.reason) || 'failed',
            message: (res && res.message) || '생성하지 못했습니다. 잠시 후 다시 시도해 주세요.',
            result: res || null
          };
        }
        var parsed = parseJSON(res.text);
        if (!parsed.ok) {
          return {
            ok: false, mode: 'pro', reason: 'bad_json',
            message: '응답을 JSON으로 읽지 못했습니다. 다시 시도하거나 다른 모델을 골라 주세요.',
            raw: str(res.text).slice(0, 4000), result: res
          };
        }
        return {
          ok: true, mode: 'pro', data: parsed.value, raw: res.text,
          result: res,
          meta: {
            provider: res.provider || '', model: res.model || '',
            latencyMs: res.latencyMs || 0, usage: res.usage || null
          }
        };
      }, function (err) {
        return { ok: false, mode: 'pro', reason: 'error', message: (err && err.message) || '요청 중 문제가 생겼습니다.' };
      });
    }

    /* ── 배지·버튼 ─────────────────────────────────────── */

    function badge(selector) {
      if (!engine || typeof engine.renderBadge !== 'function' || !root.document) return null;
      var host = null;
      try { host = typeof selector === 'string' ? root.document.querySelector(selector) : selector; } catch (e) { host = null; }
      if (!host) return null;
      return engine.renderBadge(host);
    }

    /** 같은 화면의 Pro 버튼·상태 문구를 연결 상태에 맞춘다. */
    function sync(scope) {
      var doc = root.document;
      if (!doc) return { connected: connected() };
      var host = scope ? (typeof scope === 'string' ? doc.querySelector(scope) : scope) : doc;
      if (!host) return { connected: connected() };
      var on = connected();
      var name = providerName();

      var buttons = host.querySelectorAll ? host.querySelectorAll('[data-pro-action]') : [];
      for (var i = 0; i < buttons.length; i++) {
        var b = buttons[i];
        b.setAttribute('data-pro-mode', on ? 'pro' : 'free');
        /* aria-disabled·aria-pressed 는 쓰지 않는다.
           무료 모드에서도 눌러서 연결 안내를 여는 정상 동작 버튼이기 때문이다. */
        b.setAttribute('title', on
          ? name + ' 연결됨 · 바로 생성합니다'
          : '무료 모드입니다. 누르면 Pro 연결 안내가 열립니다');
      }

      var states = host.querySelectorAll ? host.querySelectorAll('[data-pro-state]') : [];
      for (var j = 0; j < states.length; j++) {
        var el = states[j];
        el.setAttribute('data-pro-mode', on ? 'pro' : 'free');
        if (el.getAttribute('data-pro-free') !== null && el.getAttribute('data-pro-pro') !== null) {
          el.textContent = on ? el.getAttribute('data-pro-pro') : el.getAttribute('data-pro-free');
        }
      }
      return { connected: on, providerName: name };
    }

    /** 앱의 toast 로 넘길 한 줄 결과 요약 */
    function describe(res) {
      if (!res) return '';
      if (res.ok) {
        var m = res.meta || {};
        var bits = [];
        if (m.provider) bits.push(m.provider);
        if (m.model) bits.push(m.model);
        if (m.latencyMs) bits.push(Math.round(m.latencyMs) + 'ms');
        return bits.join(' · ');
      }
      return res.message || (res.reason === 'not_connected' ? 'Pro API를 연결하면 바로 생성합니다.' : '생성하지 못했습니다.');
    }

    return {
      VERSION: VERSION,
      engine: engine,
      engineReady: engineReady,
      connected: connected,
      state: state,
      providerName: providerName,
      buildRequest: buildRequest,
      run: run,
      badge: badge,
      sync: sync,
      describe: describe,
      openConnect: function () {
        try { if (engine && typeof engine.openModal === 'function') return engine.openModal(); } catch (e) { /* ignore */ }
        return null;
      },
      onConnectChange: function (fn) {
        try { if (engine && typeof engine.subscribe === 'function') return engine.subscribe(fn); } catch (e) { /* ignore */ }
        return null;
      }
    };
  }

  return {
    VERSION: VERSION,
    create: create,
    parseJSON: parseJSON
  };
});
