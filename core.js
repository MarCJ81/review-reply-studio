/* ============================================================
   사장님 리뷰 답글 스튜디오 · core.js
   DOM 없이 도는 순수 로직. app.js가 화면을 그리고 test.js가 검사한다.
     · 리뷰 읽기(별점·포인트·감정·신호)
     · 상황 자동 판별
     · 업종 6 × 플랫폼 4 × 상황 6 × 말투 3 답글 조합
     · AI 티·법 위험·개인정보·책임 확답 점검 + 안전 교정
     · 일괄 리뷰 나누기 / 신고 소명서 / AI 프롬프트
   ============================================================ */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) {
    module.exports = factory(require('./data.js'), require('./engines/copy-psych-engine.js'));
  } else {
    root.ReviewCore = factory(root.ReviewData, root.CopyPsych);
  }
})(typeof self !== 'undefined' ? self : this, function (D, C) {
  'use strict';

  const VERSION = '1.0.0';
  const IS_NODE = typeof module === 'object' && !!module.exports;

  /* ── 작은 유틸 ────────────────────────────────────────── */
  function str(v) { return v === null || v === undefined ? '' : String(v); }
  function clamp(n, lo, hi) { return Math.min(hi, Math.max(lo, n)); }
  function countChars(text) { return Array.from(str(text)).length; }
  function countNoSpace(text) { return Array.from(str(text).replace(/\s+/g, '')).length; }
  function norm(text) { return str(text).replace(/\s+/g, ' ').trim(); }
  function hasBatchim(word) {
    const w = str(word).trim();
    if (!w) return false;
    const ch = w.charAt(w.length - 1);
    const code = ch.charCodeAt(0);
    if (code < 0xac00 || code > 0xd7a3) return false;
    return (code - 0xac00) % 28 !== 0;
  }
  const DIGIT_JONG = { '0': true, '1': true, '2': false, '3': true, '4': false, '5': false, '6': true, '7': true, '8': false, '9': false };
  function josa(word, type) {
    const w0 = str(word).trim();
    const lastCh = w0.charAt(w0.length - 1);
    const has = Object.prototype.hasOwnProperty.call(DIGIT_JONG, lastCh) ? DIGIT_JONG[lastCh] : hasBatchim(w0);
    switch (type) {
      case '은는': return has ? '은' : '는';
      case '이가': return has ? '이' : '가';
      case '을를': return has ? '을' : '를';
      case '과와': return has ? '과' : '와';
      case '이에요': return has ? '이에요' : '예요';
      case '이다': return has ? '이다' : '다';
      case '으로로': {
        if (Object.prototype.hasOwnProperty.call(DIGIT_JONG, lastCh)) return DIGIT_JONG[lastCh] ? '으로' : '로';
        const code = lastCh.charCodeAt(0);
        const jong = code >= 0xac00 && code <= 0xd7a3 ? (code - 0xac00) % 28 : 0;
        return jong && jong !== 8 ? '으로' : '로';
      }
      default: return '';
    }
  }
  function withJosa(word, type) {
    const w = str(word).trim();
    return w ? w + josa(w, type) : '';
  }

  function hash(s) {
    let h = 2166136261;
    const t = str(s);
    for (let i = 0; i < t.length; i++) {
      h ^= t.charCodeAt(i);
      h = Math.imul(h, 16777619);
    }
    return h >>> 0;
  }
  function pick(list, salt) {
    if (!Array.isArray(list) || !list.length) return '';
    return list[Math.abs(salt | 0) % list.length];
  }
  function uniq(list) { return Array.from(new Set(list.filter(Boolean))); }

  /* ── 목록 조회 ────────────────────────────────────────── */
  function byId(list, id, fallbackId) {
    return list.find(function (x) { return x.id === id; }) ||
      list.find(function (x) { return x.id === fallbackId; }) || list[0];
  }
  function industryById(id) { return byId(D.INDUSTRIES, id, 'food'); }
  function platformById(id) { return byId(D.PLATFORMS, id, 'naver'); }
  function situationById(id) { return byId(D.SITUATIONS, id, 'praise'); }
  function toneById(id) { return byId(D.TONES, id, 'warm'); }
  function aspectById(id) { return D.ASPECTS.find(function (a) { return a.id === id; }) || null; }

  /* ── 매장 정보 ────────────────────────────────────────── */
  function emptyProfile() {
    return {
      name: '', industry: 'food', signature: '', parking: '', parkingNote: '',
      benefitOn: false, benefit: '', phone: '', hours: '', story: '',
      tone: 'warm', platform: 'naver',
    };
  }

  function cleanLine(v, max) {
    return str(v).replace(/[\u0000-\u001f\u007f]/g, ' ').replace(/\s+/g, ' ').trim().slice(0, max || 120);
  }

  function normalizeProfile(input) {
    const p = Object.assign(emptyProfile(), input || {});
    const out = {
      name: cleanLine(p.name, 30),
      industry: industryById(p.industry).id,
      signature: cleanLine(p.signature, 40),
      parking: ['shopfront', 'building', 'nearby', 'none', ''].indexOf(p.parking) >= 0 ? p.parking : '',
      parkingNote: cleanLine(p.parkingNote, 60),
      benefitOn: !!p.benefitOn,
      benefit: cleanLine(p.benefit, 40),
      phone: cleanLine(p.phone, 20),
      hours: cleanLine(p.hours, 60),
      story: cleanLine(p.story, 80),
      tone: toneById(p.tone).id,
      platform: platformById(p.platform).id,
    };
    if (!out.benefit) out.benefitOn = false;
    return out;
  }

  function parkingLine(profile) {
    if (!profile.parking) return '';
    if (profile.parkingNote) return '주차는 ' + profile.parkingNote + ' 이용하시면 됩니다.';
    switch (profile.parking) {
      case 'shopfront': return '주차는 가게 앞에 하시면 됩니다.';
      case 'building': return '건물 주차장에 세우시고 오시면 됩니다.';
      case 'nearby': return '주차는 근처 공영주차장을 이용해 주세요.';
      case 'none': return '주차는 어려워서 대중교통으로 오시는 편이 편합니다.';
      default: return '';
    }
  }

  function storeCompleteness(input) {
    const p = normalizeProfile(input);
    const items = [
      { key: 'name', label: '가게 이름', filled: !!p.name, tip: '답글 첫 문장에 들어갑니다.' },
      { key: 'signature', label: '시그니처 메뉴·시술', filled: !!p.signature, tip: '구체적인 한마디가 답글을 사람 말로 만듭니다.' },
      { key: 'phone', label: '문의 번호', filled: /\d{2,3}-\d{3,4}-\d{4}/.test(p.phone), tip: '컴플레인 답글에서 직접 연락을 안내합니다.' },
      { key: 'story', label: '우리 가게 한 줄', filled: !!p.story, tip: '실제로 하는 것만 적으세요. 그대로 답글에 들어갑니다.' },
      { key: 'parking', label: '주차 안내', filled: !!p.parking, tip: '리뷰에 주차 이야기가 나오면 바로 씁니다.' },
      { key: 'benefit', label: '재방문 혜택', filled: !!p.benefitOn && !!p.benefit, tip: '병원은 의료법상 혜택 문구를 넣지 않습니다.' },
    ];
    const filled = items.filter(function (i) { return i.filled; }).length;
    return {
      score: Math.round((filled / items.length) * 100),
      filled: filled,
      total: items.length,
      items: items,
      missing: items.filter(function (i) { return !i.filled; }),
    };
  }

  /* ── 리뷰 분석 ────────────────────────────────────────── */
  const POSITIVE_WORDS = ['맛있', '좋았', '좋아요', '친절', '깨끗', '만족', '추천', '훌륭', '감사', '또 오', '또 올', '다시 오', '믿고', '최고', '잘 먹', '잘했', '편했', '아늑', '넉넉', '시원'];
  const NEGATIVE_WORDS = ['안 ', '별로', '실망', '최악', '불친절', '더럽', '비싸', '늦', '식어', '이물', '아쉬', '불편', '다시는', '짜증', '화나', '환불', '사과도', '없', '힘들', '좁', '시끄', '지저분', '오래', '잘못'];

  /* ── 감성 판정 (부정·완곡·강조) ──────────────────────────
     단어 목록만 세면 "친절하지 않았어요"를 칭찬으로 읽는다.
     그래서 ① 부정어가 붙은 단어는 뒤집고, ② 완곡·유보 표현은
     약한 부정으로, ③ 강조어는 세기를 키우고, ④ 이모지·ㅠㅠ 는
     문장 단위 신호로 더한다. */
  const NEGATORS = ['안', '못', '않', '없이', '아니', '전혀', '별로', '그닥', '딱히'];
  const HEDGES = ['다만', '그런데', '아쉽지만', '조금', '살짝', '약간', '좀', '그나마', '생각보다', '의외로', '웬만'];
  const SOFT_NEG = [
    { w: '아쉬', wgt: 0.7 }, { w: '그럭저럭', wgt: 0.9 }, { w: '무난', wgt: 0.5 },
    { w: '기대 이하', wgt: 1.2 }, { w: '굳이', wgt: 0.8 }, { w: '다신', wgt: 1.2 },
    { w: '안 갈', wgt: 1.2 }, { w: '그저 그', wgt: 1.0 }, { w: '나쁘지 않', wgt: -0.4 },
    { w: '괜찮', wgt: -0.6 }, { w: '좋진 않', wgt: 0.9 }, { w: '좋지 않', wgt: 0.9 },
    { w: '실망', wgt: 1.2 }, { w: '불만', wgt: 1.0 }, { w: '그닥', wgt: 1.0 },
    { w: '별로였', wgt: 1.1 }, { w: '좀 그렇', wgt: 0.8 }
  ];
  const INTENSIFIERS = ['너무', '정말', '완전', '진짜', '엄청', '매우', '아주', '무지', '겁나'];

  function scoreSentiment(text) {
    const t = str(text);
    const clauses = t.split(/[.!?\n\r,~]+/).map(function (x) { return x.trim(); }).filter(Boolean);
    let score = 0;
    const positive = [];
    const negative = [];
    const negated = [];
    const hedged = [];
    let intensity = 1;

    if (/ㅠ|ㅜ|😭|😢|😡|😤|💩/.test(t)) score -= 0.8;
    if (/ㅋㅋ|ㅎㅎ|😊|😍|👍|❤|💕|✨/.test(t)) score += 0.5;
    INTENSIFIERS.forEach(function (w) { if (t.indexOf(w) >= 0) intensity = Math.min(1.6, intensity + 0.2); });
    HEDGES.forEach(function (w) { if (t.indexOf(w) >= 0) { hedged.push(w); intensity = Math.max(0.6, intensity - 0.15); } });

    function negatedAt(clause, idx) {
      const before = clause.slice(Math.max(0, idx - 8), idx);
      const after = clause.slice(idx, idx + 14);
      return NEGATORS.some(function (n) { return before.indexOf(n) >= 0; })
        || /지\s*(않|못)/.test(after) || /(지않|진않|질않)/.test(after)
        || /지(도|는|가|를|만)?\s*(않|못)/.test(after)
        || /(않았|않아|않아요|않습니다|않았어요|못했|못합)/.test(after);
    }

    clauses.forEach(function (clause) {
      POSITIVE_WORDS.forEach(function (w) {
        let idx = clause.indexOf(w);
        while (idx >= 0) {
          if (negatedAt(clause, idx)) { negated.push(w); score -= 1.0; }
          else { positive.push(w); score += 1.0; }
          idx = clause.indexOf(w, idx + w.length);
        }
      });
      NEGATIVE_WORDS.forEach(function (w) {
        let idx = clause.indexOf(w);
        while (idx >= 0) {
          if (negatedAt(clause, idx)) { negated.push(w); score += 0.4; }
          else { negative.push(w); score -= 1.0; }
          idx = clause.indexOf(w, idx + w.length);
        }
      });
      SOFT_NEG.forEach(function (h) {
        if (clause.indexOf(h.w) < 0) return;
        // 이미 센 단어와 겹치면 두 번 세지 않는다("별로" + "별로였")
        const dup = negative.concat(positive).some(function (w) {
          return w.indexOf(h.w) >= 0 || h.w.indexOf(w) >= 0;
        });
        if (dup) return;
        if (h.wgt < 0) {
          if (h.w.indexOf('않') < 0 && negatedAt(clause, clause.indexOf(h.w))) { negative.push(h.w); score -= 0.5; return; }
          positive.push(h.w); score -= h.wgt;
        }
        else { negative.push(h.w); score -= h.wgt; }
      });
    });

    score *= intensity;
    // 완곡 표지가 많으면 확신을 낮춘다(단정하지 않는다).
    const confidence = Math.max(0.35, Math.min(1, 0.6 + Math.min(0.4, Math.abs(score) * 0.12) - hedged.length * 0.12));
    const bounded = Math.max(-3, Math.min(3, Math.round(score * 10) / 10));
    const posCount = positive.length;
    const negCount = negative.length + negated.filter(function (w) { return POSITIVE_WORDS.indexOf(w) >= 0; }).length;
    const contrast = /지만|근데|however|반면/.test(t);
    let label = 'neutral';
    if (posCount && negCount) label = (Math.abs(bounded) >= 1.5 && !contrast) ? (bounded > 0 ? 'positive' : 'negative') : 'mixed';
    else if (bounded > 0.2) label = 'positive';
    else if (bounded < -0.2) label = 'negative';
    if (label === 'positive' && negCount === 0 && posCount === 0 && bounded <= 0.2) label = 'neutral';
    return {
      score: bounded,
      label: label,
      intensity: Math.round(intensity * 100) / 100,
      confidence: Math.round(confidence * 100) / 100,
      positive: uniq(positive),
      negative: uniq(negative),
      negated: uniq(negated),
      hedges: uniq(hedged),
      soft: hedged.length > 0 || /아쉬|그럭저럭|무난|괜찮|다만/.test(t)
    };
  }

  function splitSentences(text) {
    return str(text).split(/[.!?\n\r]+/).map(function (s) { return s.trim(); }).filter(Boolean);
  }

  function detectRating(text) {
    const t = str(text);
    const stars = (t.match(/[★⭐]/g) || []).length;
    if (stars >= 1 && stars <= 5) return stars;
    let m = t.match(/별점\s*([1-5])\s*(?:점|\/\s*5)?/);
    if (m) return Number(m[1]);
    m = t.match(/([1-5])\s*(?:점|\/\s*5)/);
    if (m) return Number(m[1]);
    return 0;
  }

  function stripRating(text) {
    return str(text)
      .replace(/^[\s★⭐]+/, '')
      .replace(/별점\s*[1-5]\s*(?:점|\/\s*5)?/g, '')
      .replace(/[★⭐]+/g, '')
      .replace(/^\s*[1-5]\s*(?:점|\/\s*5)\s*/, '')
      .replace(/\s+/g, ' ')
      .trim();
  }

  function aspectsOf(text) {
    const sentences = splitSentences(text);
    const out = [];
    D.ASPECTS.forEach(function (a) {
      const words = D.ASPECT_WORDS[a.id] || [];
      let hits = 0;
      let negative = false;
      sentences.forEach(function (sent) {
        words.forEach(function (w) {
          if (sent.indexOf(w) >= 0) {
            hits += 1;
            (a.negative || []).forEach(function (n) { if (sent.indexOf(n) >= 0) negative = true; });
          }
        });
      });
      if (hits > 0) out.push({ id: a.id, label: a.label, hits: hits, negative: negative });
    });
    return out.sort(function (x, y) { return y.hits - x.hits || (y.negative ? 1 : 0) - (x.negative ? 1 : 0); });
  }

  function analyzeReview(text, opts) {
    opts = opts || {};
    const raw = str(text).trim();
    const clean = stripRating(raw);
    const parsedRating = detectRating(raw);
    const rating = Number(opts.rating) > 0 ? Number(opts.rating) : parsedRating;
    const sentences = splitSentences(clean);
    const feeling = scoreSentiment(clean);
    const posHits = feeling.positive;
    const negHits = uniq(feeling.negative.concat(feeling.negated.filter(function (w) { return POSITIVE_WORDS.indexOf(w) >= 0; })));
    let sentiment = 0;
    if (rating >= 4) sentiment = 1;
    else if (rating > 0 && rating <= 2) sentiment = -1;
    else if (feeling.label === 'positive') sentiment = 1;
    else if (feeling.label === 'negative') sentiment = -1;
    else if (feeling.label === 'mixed') sentiment = feeling.score > 0 ? 1 : -1;

    const aspects = aspectsOf(clean);
    const flags = {
      photo: /사진|포토|영수증|이미지|올려요|찍었/.test(clean),
      regular: /단골|또 ?왔|또 ?올|벌써|몇 ?번째|늘 ?오|매번|자주 ?가/.test(clean),
      notice: /휴무|예약|노쇼|문 ?닫|영업시간|전화가 안|전화 안|쉬는 ?날/.test(clean),
      delivery: /배달|포장|라이더|도착|주문/.test(clean),
      price: /가격|가성비|비싸|저렴/.test(clean),
      long: countChars(clean) >= 120,
      hygiene: /이물|벌레|머리카락|곰팡이|위생|더럽|지저분/.test(clean),
    };

    const labelById = {};
    aspects.forEach(function (a) { labelById[a.id] = a.label; });
    const keywords = uniq(aspects.map(function (a) { return a.label; })
      .concat(flags.photo ? ['사진'] : [])
      .concat(flags.delivery ? ['배달'] : [])
      .concat(flags.price ? ['가격'] : []));

    return {
      raw: raw,
      clean: clean,
      rating: rating,
      sentiment: sentiment,
      feeling: feeling,
      aspects: aspects,
      aspectLabels: aspects.map(function (a) { return a.label; }),
      negatives: negHits,
      positives: posHits,
      flags: flags,
      keywords: keywords.slice(0, 5),
      chars: countChars(clean),
      sentenceCount: sentences.length,
      excerpt: clean.slice(0, 60) + (countChars(clean) > 60 ? '…' : ''),
    };
  }

  function pickSituation(analysis, opts) {
    opts = opts || {};
    if (opts.situation && opts.situation !== 'auto') {
      const s = situationById(opts.situation);
      return { id: s.id, label: s.label, reason: '직접 고른 상황입니다.', confidence: 1, auto: false };
    }
    const r = analysis.rating;
    const f = analysis.flags;
    const decide = function (id, reason, confidence) {
      return { id: id, label: situationById(id).label, reason: reason, confidence: confidence, auto: true };
    };
    if (r > 0 && r <= 2) return decide('crisis', '별점 ' + r + '점 — 컴플레인 답글이 안전합니다.', 0.95);
    if (f.notice && (r === 0 || r <= 3)) return decide('notice', '휴무·예약·전화 문의가 섞여 있습니다.', 0.8);
    if (r === 3) return decide('meh', '별점 3점 — 아쉬움 케어가 맞습니다.', 0.9);
    if (f.photo && (r >= 4 || r === 0)) return decide('photo', '사진·영수증 이야기가 있습니다.', 0.85);
    if (f.regular) return decide('regular', '단골·재방문 표현이 있습니다.', 0.75);
    if (r === 4) return decide('meh', '별점 4점 — 아쉬움을 먼저 짚습니다.', 0.8);
    if (r === 5) return decide('praise', '별점 5점 — 칭찬 답글입니다.', 0.95);
    const feel = analysis.feeling;
    if (feel && feel.label === 'mixed') return decide('meh', '좋다·아쉽다가 섞여 있습니다. 아쉬운 부분을 먼저 짚습니다.', feel.confidence);
    if (feel && feel.soft && feel.score > -1.2) return decide('meh', '완곡한 아쉬움이 있습니다. 과하게 사과하지 않고 한 가지만 짚습니다.', Math.max(0.5, feel.confidence - 0.1));
    if (analysis.sentiment < 0) return decide('crisis', '부정 표현이 많습니다. 컴플레인으로 처리합니다.', feel ? Math.max(0.6, feel.confidence) : 0.6);
    if (analysis.sentiment === 0) return decide('meh', '좋다·아쉽다가 섞여 있습니다.', 0.55);
    return decide('praise', '긍정 표현이 중심입니다.', 0.7);
  }

  /* ── 답글 조합 ────────────────────────────────────────── */
  function fill(template, ctx) {
    let out = str(template);
    const josaMap = {
      store: ctx.profile.name || '',
      aspect: ctx.aspectLabel || '',
      signature: ctx.profile.signature || '',
      benefit: ctx.profile.benefit || '',
      period: ctx.period || '이번 주말',
      phone: ctx.profile.phone || '',
    };
    out = out.replace(/\{(store|aspect|signature|benefit|period):(은는|이가|을를|과와|으로로|이에요)\}/g, function (m, key, type) {
      const v = str(josaMap[key]).trim();
      return v ? v + josa(v, type) : '';
    });
    const map = {
      store: ctx.profile.name || '',
      aspect: ctx.aspectLabel || '',
      signature: ctx.profile.signature || '',
      parking: parkingLine(ctx.profile),
      benefit: ctx.profile.benefit || '',
      phone: ctx.profile.phone || '',
      period: ctx.period || '이번 주말',
      hours: ctx.profile.hours || '',
      story: ctx.profile.story || '',
      when: D.WHEN_BY_INDUSTRY[ctx.industry.id] || '방문 일시',
    };
    const required = ['store', 'signature', 'benefit', 'story', 'phone', 'parking'];
    for (let i = 0; i < required.length; i++) {
      const key = required[i];
      if (out.indexOf('{' + key) >= 0 && !str(map[key]).trim()) return '';
    }
    Object.keys(map).forEach(function (k) {
      out = out.split('{' + k + '}').join(map[k]);
    });
    if (out.indexOf('{') >= 0) return '';
    return norm(out);
  }

  function toneOpen(ctx, toneId, variant) {
    const p = ctx.platform;
    if (!ctx.profile.name) {
      const noName = {
        warm: ['안녕하세요, 사장입니다.', '사장입니다.', '답글 남깁니다.'],
        pro: ['안녕하세요.', '안녕하세요, 담당자입니다.', '답글 남깁니다.'],
        mz: ['사장이에요.', '안녕하세요!', '사장 등판.'],
      };
      if (p.delivery) return fill(pick(['주문해 주셔서 고맙습니다.', '주문 남겨주셔서 고맙습니다.'], ctx.salt + variant), ctx);
      return fill(pick(noName[toneId] || noName.warm, ctx.salt + variant), ctx);
    }
    if (p.delivery) {
      const deliveryOpen = {
        warm: ['{store} 사장이에요. 주문해 주셔서 고맙습니다.', '{store}입니다. 주문 남겨주셔서 고맙습니다.'],
        pro: ['{store}입니다. 주문해 주셔서 감사합니다.', '{store}입니다. 주문 내용 확인했습니다.'],
        mz: ['{store} 사장이에요. 주문 고마워요!', '{store}입니다. 주문 남겨주셔서 고마워요.'],
      };
      return fill(pick(deliveryOpen[toneId] || deliveryOpen.warm, ctx.salt + variant * 13), ctx);
    }
    return fill(pick(D.BANKS[toneId].open, ctx.salt + variant * 17), ctx);
  }

  function benefitLine(ctx) {
    if (!ctx.profile.benefitOn || !ctx.profile.benefit) return '';
    if (!ctx.industry.benefitAllowed || !ctx.platform.allowBenefit) return '';
    const lines = [
      '재방문하실 때 ' + ctx.profile.benefit + ' 챙겨드릴게요.',
      '다음에 오시면 ' + ctx.profile.benefit + ' 준비해 둘게요.',
      '단골이시니까 다음 방문 때 ' + ctx.profile.benefit + ' 챙겨드리겠습니다.',
    ];
    return pick(lines, ctx.salt + 7);
  }

  function offerPool(ctx, situation) {
    const pool = [];
    const ind = ctx.industry;
    const p = ctx.profile;
    const push = function (text) { if (text && pool.indexOf(text) < 0) pool.push(text); };

    if (p.story && situation !== 'crisis' && situation !== 'notice') push(p.story);
    if (p.signature) {
      const bank = ctx.toneId === 'pro' ? D.SIGNATURE_LINES_PRO : D.SIGNATURE_LINES;
      const lines = bank[ind.id] || [];
      const line = fill(pick(lines, ctx.salt + 3), ctx);
      push(line);
    }
    if (situation === 'regular' || situation === 'praise' || situation === 'photo' || situation === 'meh') {
      const b = benefitLine(ctx);
      if (situation === 'regular') pool.unshift(b); else push(b);
    }
    if (ctx.platform.allowParking && p.parking) push(parkingLine(p));
    if (ind.id === 'clinic') {
      push('다음 내원 때 궁금한 점은 접수 때 편하게 말씀 주세요.');
    }
    return pool.filter(Boolean);
  }

  function inviteLines(ctx) {
    if (ctx.toneId === 'pro' && D.INVITE_PRO_BY_INDUSTRY[ctx.industry.id]) return D.INVITE_PRO_BY_INDUSTRY[ctx.industry.id];
    return D.BANKS[ctx.toneId].invite;
  }

  function fixFor(ctx) {
    const lines = D.ASPECT_FIX[ctx.aspectId] || D.FIX_LINES[ctx.industry.id] || D.FIX_LINES.food;
    return lines;
  }

  function platformTail(ctx) {
    const id = ctx.platform.id;
    if (id === 'local') {
      return ctx.toneId === 'pro'
        ? ['가까우시면 편하게 방문해 주세요.', '동네에서 찾아주시면 감사하겠습니다.']
        : (D.PLATFORM_LINES.local.tail || []);
    }
    if ((id === 'baemin' || id === 'coupangeats') && ctx.toneId === 'pro') {
      return ['다음 주문 때도 정성껏 준비하겠습니다.', '다음에도 맛있게 준비해 보내드리겠습니다.'];
    }
    return (D.PLATFORM_LINES[id] || { tail: [] }).tail;
  }

  function paddingLines(ctx) {
    const map = {
      warm: ['궁금한 점 있으면 편하게 말씀해 주세요.', '다음에 더 잘 챙길게요.'],
      pro: ['궁금한 점이 있으면 언제든 문의해 주세요.', '추가로 안내가 필요하면 말씀해 주세요.'],
      mz: ['궁금한 거 있으면 편하게 물어보세요.', '다음에 더 챙길게요.'],
    };
    return map[ctx.toneId] || map.warm;
  }

  function tailPool(ctx, situation) {
    const tone = ctx.toneId;
    const pool = [];
    if (situation !== 'crisis' && situation !== 'notice') {
      inviteLines(ctx).forEach(function (line) {
        const t = fill(line, ctx);
        if (t) pool.push({ key: 'invite', text: t });
      });
    }
    platformTail(ctx).forEach(function (line) {
      const t = fill(line, ctx);
      if (t) pool.push({ key: 'tail', text: t });
    });
    paddingLines(ctx).forEach(function (line) {
      const t = fill(line, ctx);
      if (t) pool.push({ key: 'tail', text: t });
    });
    return pool;
  }

  function fitSegments(segments, range, extraPool) {
    const join = function (arr) {
      return norm(arr.map(function (s) { return s.text; }).join(' '));
    };
    let out = segments.slice();
    const removeOrder = ['tail', 'invite', 'offer', 'specific', 'close', 'thanks', 'open'];
    let guard = 0;
    while (countChars(join(out)) > range[1] && guard++ < 20) {
      let removed = false;
      for (let i = 0; i < removeOrder.length && !removed; i++) {
        const key = removeOrder[i];
        for (let j = out.length - 1; j >= 1; j--) {
          if (out[j].key === key && !out[j].essential) { out.splice(j, 1); removed = true; break; }
        }
      }
      if (!removed) break;
    }
    let guard2 = 0;
    const extras = extraPool.slice();
    while (countChars(join(out)) < range[0] && guard2++ < 12 && extras.length) {
      const e = extras.shift();
      if (!e) continue;
      if (out.some(function (s) { return s.text === e.text; })) continue;
      if (e.key === 'invite' && out.some(function (s) { return s.key === 'invite'; })) continue;
      out.splice(Math.max(1, out.length - 1), 0, { key: e.key || 'tail', text: e.text, essential: false });
    }
    return join(out);
  }

  function buildSegments(ctx, situationId, variant) {
    const S = [];
    const B = D.BANKS[ctx.toneId] || D.BANKS.warm;
    const add = function (key, list, essential, offset) {
      const arr = (list || []).map(function (line) { return fill(line, ctx); }).filter(Boolean);
      if (!arr.length) return;
      const text = pick(arr, ctx.salt + variant * 53 + (offset || 0) * 131);
      if (!text) return;
      if (key === 'close' && /^감사합니다[.!]?$/.test(text) && S.some(function (x) { return /감사합니다/.test(x.text); })) return;
      if (key === 'close' && S.some(function (x) { return x.text.replace(/[.!?]$/, '') === text.replace(/[.!?]$/, ''); })) return;
      if (key === 'close' && text.indexOf('다음에') === 0 && S.some(function (x) { return /다음에 (오시면|또|한 번)/.test(x.text); })) return;
      if (key === 'invite' && text.indexOf('다음에') === 0 && S.some(function (x) { return x.key === 'promise'; })) return;
      if (S.some(function (s) { return s.text === text; })) return;
      S.push({ key: key, text: text, essential: !!essential });
    };
    const addOne = function (key, text, essential) {
      const t = norm(text);
      if (!t || S.some(function (s) { return s.text === t; })) return;
      S.push({ key: key, text: t, essential: !!essential });
    };

    const open = toneOpen(ctx, ctx.toneId, variant);
    const offers = offerPool(ctx, situationId);
    const offer = function (n) { return offers.length ? [offers[n % offers.length]] : []; };

    if (situationId === 'praise') {
      if (variant === 0) {
        addOne('open', open, true);
        add('thanks', B.thanks, true, 2);
        add('specific', B.specific, false, 3 + variant);
        addOne('offer', pick(offers, ctx.salt + 5));
        add('invite', inviteLines(ctx), false, 7 + variant);
        add('close', B.close, false, 9 + variant);
      } else if (variant === 1) {
        addOne('open', open, true);
        add('specific', B.specific, false, 4 + variant);
        addOne('offer', pick(offers, ctx.salt + 11));
        add('thanks', B.thanks, false, 1 + variant);
        add('close', B.close, false, 6 + variant);
      } else {
        add('thanks', B.thanks, true, 5);
        add('specific', B.specific, false, 6 + variant);
        addOne('offer', pick(offers, ctx.salt + 17));
        add('invite', inviteLines(ctx), false, 8 + variant);
        add('close', B.close, false, 12 + variant);
      }
    } else if (situationId === 'photo') {
      addOne('open', open, variant === 0);
      add('photo', (D.PHOTO_BY_TONE[ctx.toneId] && D.PHOTO_BY_TONE[ctx.toneId].length ? D.PHOTO_BY_TONE[ctx.toneId] : D.PHOTO_LINES), true, variant + 1);
      if (variant !== 2) add('specific', B.specific, false, 3 + variant);
      if (variant !== 1) add('thanks', B.thanks, false, 2 + variant);
      addOne('offer', pick(offers, ctx.salt + 9 + variant));
      add('invite', inviteLines(ctx), false, 5 + variant);
      add('close', B.close, false, 7 + variant);
    } else if (situationId === 'meh') {
      addOne('open', open, false);
      add('meh', (D.MEH_OPEN[ctx.toneId] || D.MEH_OPEN.warm), true, 1);
      add('specific', (D.MEH_SPECIFIC[ctx.toneId] || D.MEH_SPECIFIC.warm), true, 2 + variant);
      if (variant !== 2) add('fix', fixFor(ctx), false, 3 + variant);
      if (variant === 0) add('promise', B.promise, false, 5 + variant);
      add('invite', inviteLines(ctx), false, 8 + variant);
      add('close', B.close, false, 10 + variant);
    } else if (situationId === 'crisis') {
      addOne('open', open, true);
      add('sorry', ctx.platform.delivery ? D.DELIVERY_SORRY : B.sorry, true, 1 + variant);
      add('verify', B.verify, true, 3 + variant);
      add('fix', fixFor(ctx), false, 5 + variant);
      add('contact', B.contact, true, 7 + variant);
      add('close', B.close, false, 9 + variant);
    } else if (situationId === 'regular') {
      addOne('open', open, variant !== 1);
      add('regular', (D.REGULAR_OPEN_BY_TONE[ctx.toneId] && D.REGULAR_OPEN_BY_TONE[ctx.toneId].length ? D.REGULAR_OPEN_BY_TONE[ctx.toneId] : D.REGULAR_OPEN), true, variant + 1);
      add('specific', (D.REGULAR_SPECIFIC_BY_TONE[ctx.toneId] && D.REGULAR_SPECIFIC_BY_TONE[ctx.toneId].length ? D.REGULAR_SPECIFIC_BY_TONE[ctx.toneId] : D.REGULAR_SPECIFIC), false, 2 + variant);
      addOne('offer', pick(offers, ctx.salt + 3 + variant));
      add('invite', inviteLines(ctx), false, 6 + variant);
      add('close', B.close, false, 8 + variant);
    } else if (situationId === 'notice') {
      const type = ctx.noticeType || 'closed';
      const noticeBank = ctx.toneId === 'pro' ? D.NOTICE_PRO : D.NOTICE_LINES;
      const body = noticeBank[type] || D.NOTICE_LINES.closed;
      const asksPhone = ctx.analysis.flags.notice && /전화|연락|문의/.test(ctx.analysis.clean);
      addOne('open', open, true);
      if (variant === 1 && asksPhone) add('phone', D.NOTICE_LINES.phone, false, variant + 2);
      add('notice', body, true, variant + 2);
      if (variant !== 1 && asksPhone) add('phone', D.NOTICE_LINES.phone, false, variant + 2);
      if (ctx.profile.hours && type !== 'closed' && variant !== 1) addOne('hours', '영업시간은 ' + ctx.profile.hours + '입니다.', false);
      add('noticeClose', noticeBank.close || D.NOTICE_LINES.close, false, variant + 3);
    } else {
      addOne('open', open, true);
      add('thanks', B.thanks, true, 1);
      add('specific', B.specific, false, 2);
      add('close', B.close, false, 3);
    }
    return S;
  }

  function dedupeSentences(text) {
    const sentences = [];
    const re = /[^.!?]+[.!?]+|[^.!?]+$/g;
    let m;
    while ((m = re.exec(text)) !== null) {
      const t = m[0].trim();
      if (t) sentences.push(t);
    }
    const seen = {};
    const out = [];
    sentences.forEach(function (sent) {
      const key = sent.replace(/[\s.!?]/g, '');
      if (!key) return;
      if (seen[key] && countChars(sent) < 30) return;
      seen[key] = 1;
      out.push(sent);
    });
    return norm(out.join(' '));
  }

  function padToMin(text, ctx) {
    let out = text;
    const pads = paddingLines(ctx);
    for (let i = 0; i < pads.length; i++) {
      if (countChars(out) >= ctx.platform.range[0]) break;
      const line = fill(pads[i], ctx);
      if (line && out.indexOf(line) < 0) out = norm(out + ' ' + line);
    }
    return out;
  }

  function composeReply(ctx, situationId, variant) {
    const segments = buildSegments(ctx, situationId, variant);
    const extras = tailPool(ctx, situationId);
    let text = fitSegments(segments, ctx.platform.range, extras);
    if (ctx.profile.name && text.indexOf(ctx.profile.name) < 0) {
      text = norm((ctx.platform.delivery ? ctx.profile.name + '입니다.' : '안녕하세요, ' + ctx.profile.name + '입니다.') + ' ' + text);
    }
    text = dedupeSentences(text);
    return padToMin(text, ctx);
  }

  function buildContext(input) {
    const profile = normalizeProfile(input.profile || emptyProfile());
    const industry = industryById(input.industry || profile.industry);
    const platform = platformById(input.platform || profile.platform);
    const analysis = input.analysis || analyzeReview(input.review || '', { rating: input.rating });
    const situation = input.situationId
      ? situationById(input.situationId)
      : situationById(pickSituation(analysis, { situation: input.situation || 'auto' }).id);
    const tone = toneById(input.tone || profile.tone);
    const needsCare = situation.id === 'meh' || situation.id === 'crisis';
    let pickAspect = (needsCare ? analysis.aspects.find(function (a) { return a.negative; }) : null) || analysis.aspects[0];
    if (needsCare && analysis.flags.hygiene && analysis.aspects.some(function (a) { return a.id === 'clean'; })) {
      pickAspect = analysis.aspects.find(function (a) { return a.id === 'clean'; });
    }
    const topAspect = pickAspect ? pickAspect.label : (D.ASPECTS.find(function (a) {
      return industry.aspects.indexOf(a.id) >= 0;
    }) || { label: '응대' }).label;
    const topAspectId = pickAspect ? pickAspect.id : '';

    return {
      review: analysis.clean,
      rating: analysis.rating,
      analysis: analysis,
      profile: profile,
      industry: industry,
      platform: platform,
      situation: situation,
      toneId: tone.id,
      aspectLabel: topAspect,
      aspectId: topAspectId,
      period: cleanLine(input.period, 40) || '이번 주말',
      noticeType: input.noticeType || 'closed',
      salt: hash([analysis.clean, industry.id, platform.id, situation.id, tone.id, input.seed || 0].join('|')),
    };
  }

  function gradeOf(score) {
    if (score >= 90) return { id: 'A', label: '바로 올려도 좋아요' };
    if (score >= 80) return { id: 'B', label: '한 군데만 고치면 좋아요' };
    if (score >= 70) return { id: 'C', label: '손볼 곳이 있습니다' };
    return { id: 'D', label: '그대로 올리지 마세요' };
  }

  function generateReplies(input) {
    input = input || {};
    const profile = normalizeProfile(input.profile || emptyProfile());
    const industry = industryById(input.industry || profile.industry);
    const platform = platformById(input.platform || profile.platform);
    const analysis = analyzeReview(input.review || '', { rating: input.rating });
    const situationPick = pickSituation(analysis, { situation: input.situation || 'auto' });
    const compare = !!(input.compareTones || input.compare);
    const count = clamp(Number(input.count) || 3, 1, 3);
    const baseTone = toneById(input.tone || profile.tone);
    const replies = [];
    const seen = {};

    for (let i = 0; i < (compare ? Math.min(3, count) : count); i++) {
      const ctxTone = compare ? D.TONES[i].id : baseTone.id;
      const ctx = buildContext({
        review: input.review, rating: input.rating, profile: profile, industry: industry.id,
        platform: platform.id, situation: situationPick.id, tone: ctxTone,
        period: input.period, noticeType: input.noticeType, analysis: analysis,
        seed: input.seed || 0,
      });
      let variant = i;
      let text = composeReply(ctx, situationPick.id, variant);
      let guard = 0;
      while (seen[text] && guard++ < 4) {
        variant += 3;
        text = composeReply(ctx, situationPick.id, variant);
      }
      seen[text] = true;
      const check = checkReply(text, {
        platform: platform.id, industry: industry.id, profile: profile,
        analysis: analysis, review: analysis.clean,
      });
      replies.push({
        id: 'reply-' + (i + 1),
        tone: ctxTone,
        toneLabel: toneById(ctxTone).label,
        situation: situationPick.id,
        text: text,
        chars: countChars(text),
        check: check,
      });
    }

    return {
      replies: replies,
      situation: situationPick,
      analysis: analysis,
      meta: {
        industry: industry.id,
        platform: platform.id,
        tone: baseTone.id,
        compare: compare,
        range: platform.range,
        advice: replyAdvice(analysis, profile, industry, platform),
      },
    };
  }

  /* ── 점검 ─────────────────────────────────────────────── */
  function legalRulesFor(industryId) {
    return D.LEGAL_RULES.filter(function (r) {
      return !r.scope || r.scope.indexOf(industryId) >= 0;
    });
  }

  function scanRules(text, rules) {
    const t = str(text);
    const hits = [];
    rules.forEach(function (r) {
      const re = new RegExp(r.re.source, 'g');
      let m;
      while ((m = re.exec(t)) !== null) {
        if (m[0] === '') { re.lastIndex++; continue; }
        hits.push({
          ruleId: r.id, phrase: m[0], index: m.index,
          label: r.label, reason: r.reason, fix: r.fix,
          severity: r.severity || 'mid', law: r.law || '',
        });
      }
    });
    return hits;
  }

  function legalScan(text, industryId) {
    return scanRules(text, legalRulesFor(industryById(industryId).id));
  }

  function privacyScan(text, profile) {
    const t = str(text);
    const p = normalizeProfile(profile || {});
    const hits = [];
    const phones = t.match(/0\d{1,2}-\d{3,4}-\d{4}/g) || [];
    const isPlaceholder = function (ph) { return /^0\d{1,2}-0{3,4}-0{4}$/.test(ph); };
    phones.forEach(function (ph) {
      if (ph !== p.phone && !isPlaceholder(ph)) {
        hits.push({ label: '전화번호 노출', phrase: ph, reason: '손님 또는 다른 사람의 번호로 보입니다. 공개 답글에 남기지 마세요.', fix: '문의 번호는 가게 번호만 쓰세요', severity: 'high' });
      }
    });
    const rrn = t.match(/\d{6}\s?-\s?\d{7}/g) || [];
    rrn.forEach(function (v) {
      hits.push({ label: '주민등록번호 형태', phrase: v, reason: '개인정보입니다. 어떤 경우에도 답글에 쓰지 마세요.', fix: '삭제', severity: 'high' });
    });
    const emails = t.match(/[\w.+-]+@[\w-]+\.[\w.]+/g) || [];
    emails.forEach(function (v) {
      hits.push({ label: '이메일 노출', phrase: v, reason: '개인 연락처가 공개됩니다.', fix: '삭제', severity: 'high' });
    });
    if (/계좌|카드번호|CVC|비밀번호/.test(t)) {
      hits.push({ label: '금융 정보 표현', phrase: '계좌·카드', reason: '금융 정보는 답글에 쓰지 않습니다.', fix: '삭제', severity: 'high' });
    }
    return hits;
  }

  function emojiCount(text) {
    const m = str(text).match(/[\u{1F300}-\u{1FAFF}\u{2600}-\u{27BF}]/gu);
    return m ? m.length : 0;
  }

  function duplicateSentences(text) {
    const seen = {};
    const dup = [];
    splitSentences(text).forEach(function (s) {
      const k = s.replace(/\s+/g, '');
      if (k.length < 4) return;
      if (seen[k]) dup.push(s); else seen[k] = 1;
    });
    return dup;
  }

  function checkReply(text, opts) {
    opts = opts || {};
    const t = norm(text);
    const platform = platformById(opts.platform);
    const industry = industryById(opts.industry);
    const profile = normalizeProfile(opts.profile || {});
    const analysis = opts.analysis || analyzeReview(opts.review || '');
    const issues = [];
    const push = function (issue) { issues.push(issue); };

    /* AI 티 */
    D.AI_TELLS.forEach(function (rule) {
      const re = new RegExp(rule.re.source, 'g');
      let m;
      while ((m = re.exec(t)) !== null) {
        push({
          type: 'ai', severity: 'mid', label: rule.label, phrase: m[0], index: m.index,
          reason: rule.reason, fix: rule.fix ? '"' + m[0] + '" → ' + rule.fix : '이 표현은 빼세요',
        });
        break;
      }
    });

    /* copy-psych-engine의 감점 표현 (번역체·공급자 중심) */
    let friction = 0;
    if (C && typeof C.detect === 'function') {
      try {
        const det = C.detect(t);
        friction = det.friction || 0;
        (det.issues || []).slice(0, 4).forEach(function (is) {
          if (is.type === 'abstract' || is.type === 'passive' || is.type === 'filler' || is.type === 'supplier') {
            if (!issues.some(function (x) { return x.phrase === is.phrase; })) {
              push({
                type: 'ai', severity: is.severity === 'high' ? 'high' : 'mid', label: '카피 엔진 · ' + (is.typeLabel || is.type),
                phrase: is.phrase, index: is.index, reason: is.reason || '번역체·군더더기로 읽힙니다.',
                fix: is.example ? '예: ' + is.example : (is.alternative || '더 쉬운 말로 바꾸세요'),
              });
            }
          }
        });
      } catch (e) { friction = 0; }
    }

    /* 법·정책 */
    legalScan(t, industry.id).forEach(function (h) {
      push({
        type: 'legal', severity: h.severity, label: h.label, phrase: h.phrase, index: h.index,
        reason: h.reason + (h.law ? ' (' + h.law + ')' : ''), fix: h.fix,
      });
    });

    /* 책임 인정 */
    scanRules(t, D.LIABILITY_RULES).forEach(function (h) {
      push({ type: 'liability', severity: 'high', label: h.label, phrase: h.phrase, index: h.index, reason: h.reason, fix: h.fix });
    });

    /* 방어적 표현 */
    scanRules(t, D.DEFENSIVE_RULES).forEach(function (h) {
      push({ type: 'defensive', severity: 'mid', label: h.label, phrase: h.phrase, index: h.index, reason: h.reason, fix: h.fix });
    });

    /* 개인정보 */
    privacyScan(t, profile).forEach(function (h) {
      push({ type: 'privacy', severity: 'high', label: h.label, phrase: h.phrase, index: 0, reason: h.reason, fix: h.fix });
    });

    /* 길이 */
    const chars = countChars(t);
    if (chars > 0 && chars < platform.range[0]) {
      push({
        type: 'length', severity: 'low', label: '조금 짧습니다',
        phrase: chars + '자', index: 0,
        reason: platform.short + ' 답글 권장 길이는 ' + platform.range[0] + '~' + platform.range[1] + '자입니다. 한 문장만 더 붙여도 읽는 맛이 납니다.',
        fix: '구체적인 한마디(메뉴·다음 방문)를 더하세요',
      });
    } else if (chars > platform.range[1]) {
      push({
        type: 'length', severity: 'low', label: '조금 깁니다',
        phrase: chars + '자', index: 0,
        reason: platform.short + ' 답글은 ' + platform.range[0] + '~' + platform.range[1] + '자가 읽기 좋습니다.',
        fix: '인사나 마무리 문장을 하나 줄이세요',
      });
    }

    /* 이모지·감탄부호 */
    const emo = emojiCount(t);
    if (emo > 1) {
      push({ type: 'format', severity: 'low', label: '이모지 과다', phrase: emo + '개', index: 0, reason: '이모지가 많으면 자동응답처럼 보입니다.', fix: '이모지는 1개 이하로' });
    }
    if (/!!|!!!/g.test(t)) {
      push({ type: 'format', severity: 'low', label: '감탄부호 반복', phrase: '!!', index: 0, reason: '감정이 앞서 보입니다.', fix: '느낌표는 한 번만' });
    }
    const dups = duplicateSentences(t);
    if (dups.length) {
      push({ type: 'format', severity: 'low', label: '같은 문장 반복', phrase: dups[0].slice(0, 20), index: 0, reason: '복붙한 느낌을 줍니다.', fix: '한 문장을 지우세요' });
    }

    /* 구체성 */
    const mentioned = analysis.aspects.filter(function (a) { return t.indexOf(a.label) >= 0; });
    const hasInfo = (profile.name && t.indexOf(profile.name) >= 0) ||
      (profile.signature && t.indexOf(profile.signature) >= 0) ||
      (profile.story && t.indexOf(profile.story) >= 0) ||
      !!parkingLine(profile) && t.indexOf(parkingLine(profile)) >= 0 ||
      (profile.phone && t.indexOf(profile.phone) >= 0);
    if (chars >= 60 && !mentioned.length && !hasInfo) {
      push({
        type: 'specific', severity: 'low', label: '리뷰를 안 읽은 느낌',
        phrase: '구체 표현 없음', index: 0,
        reason: '어느 가게에나 붙일 수 있는 문장만 있습니다. 리뷰에 나온 단어 하나를 그대로 쓰면 달라집니다.',
        fix: '리뷰의 포인트(' + (analysis.aspectLabels.join(', ') || '메뉴') + ') 하나를 문장에 넣으세요',
      });
    }

    /* 점수 */
    let penalty = 0;
    const penaltyByType = { ai: 5, legal: 13, liability: 10, defensive: 8, privacy: 18, length: 7, format: 4, specific: 8 };
    const capByType = { ai: 24, legal: 39, liability: 20, defensive: 16, privacy: 30, length: 7, format: 8, specific: 8 };
    const sumByType = {};
    issues.forEach(function (is) {
      const amount = is.severity === 'high' ? penaltyByType[is.type] * 1.4 : penaltyByType[is.type];
      sumByType[is.type] = (sumByType[is.type] || 0) + amount;
    });
    Object.keys(sumByType).forEach(function (type) {
      penalty += Math.min(capByType[type] || 10, sumByType[type]);
    });
    if (friction > 0 && !issues.some(function (i) { return i.type === 'ai'; })) {
      penalty += Math.min(10, Math.round(friction / 8));
    }
    const score = clamp(Math.round(100 - penalty), 0, 100);
    const grade = gradeOf(score);

    const counts = { ai: 0, legal: 0, liability: 0, defensive: 0, privacy: 0, length: 0, format: 0, specific: 0 };
    issues.forEach(function (i) { counts[i.type] = (counts[i.type] || 0) + 1; });

    return {
      score: score,
      grade: grade,
      issues: issues,
      counts: counts,
      friction: friction,
      stats: {
        chars: chars,
        charsNoSpace: countNoSpace(t),
        sentences: splitSentences(t).length,
        emoji: emo,
        readSeconds: Math.max(2, Math.round(chars / 9)),
      },
      range: platform.range,
    };
  }

  function autoFix(text) {
    let out = str(text);
    const applied = [];
    D.AI_TELLS.forEach(function (rule) {
      const re = new RegExp(rule.re.source, 'g');
      if (re.test(out)) {
        out = out.replace(re, rule.fix || '');
        applied.push({ label: rule.label, phrase: rule.fix ? rule.fix : '삭제', reason: rule.reason });
      }
    });
    out = out.replace(/\s+/g, ' ')
      .replace(/\s+([,.!?])/g, '$1')
      .replace(/([.!?])\1+/g, '$1')
      .replace(/^[,\s]+/, '')
      .trim();
    return { text: out, applied: applied, changed: out !== str(text).trim() };
  }

  function replyAdvice(analysis, profile, industry, platform) {
    const tips = [];
    const line = profile.signature || profile.story;
    if (!line) tips.push('매장 설정에서 시그니처 한 줄만 넣어도 답글이 훨씬 구체적으로 바뀝니다.');
    if (industry.id === 'clinic' && profile.benefitOn) tips.push('병원 업종은 재방문 혜택 문구를 답글에 넣지 않습니다(의료법상 환자 유인).');
    if (platform.delivery) tips.push(platform.short + ' 답글은 배달 과정을 탓하지 말고 조리·포장에서 할 수 있는 일을 한 가지 쓰는 게 좋습니다.');
    if (analysis.aspects.length) tips.push('리뷰에서 읽힌 포인트: ' + analysis.aspectLabels.join(', ') + '. 한 가지만 문장에 넣어도 충분합니다.');
    if (analysis.flags.notice) tips.push('예약·휴무 문의는 답글과 함께 가게 공지에도 같은 내용을 올려두면 반복 문의가 줄어듭니다.');
    return tips;
  }

  /* ── 일괄 리뷰 나누기 ─────────────────────────────────── */
  function splitChunks(text) {
    const raw = str(text).replace(/\r\n/g, '\n').trim();
    if (!raw) return [];
    let parts = raw.split(/\n\s*(?:-{3,}|={3,}|\*{3,}|#{3,})\s*\n/);
    if (parts.length > 1) return parts.map(function (s) { return s.trim(); }).filter(Boolean);

    parts = raw.split(/\n\s*\n+/);
    if (parts.length > 1) {
      const merged = [];
      parts.forEach(function (p) {
        const t = p.trim();
        if (!t) return;
        if (merged.length && countChars(t) < 12) merged[merged.length - 1] += ' ' + t;
        else merged.push(t);
      });
      if (merged.length > 1) return merged;
    }

    parts = raw.split(/\n(?=\s*(?:리뷰\s*)?\d{1,2}[.)]\s+)/);
    if (parts.length > 1) return parts.map(function (s) { return s.trim(); }).filter(Boolean);

    parts = raw.split(/\n(?=\s*(?:[★⭐]{1,5}|별점\s*[1-5]))/);
    if (parts.length > 1) return parts.map(function (s) { return s.trim(); }).filter(Boolean);

    return [raw];
  }

  function inferNoticeType(text) {
    const t = str(text);
    if (/노쇼|못 ?오|취소/.test(t)) return 'noshow';
    if (/예약|자리|인원/.test(t)) return 'reserve';
    return 'closed';
  }

  function parseBulk(text) {
    const warnings = [];
    const chunks = splitChunks(text);
    if (!chunks.length) {
      return { items: [], warnings: ['붙여넣은 리뷰가 없습니다. 리뷰를 붙여넣고 다시 눌러주세요.'], count: 0 };
    }
    const items = chunks.map(function (chunk, i) {
      const analysis = analyzeReview(chunk);
      const sit = pickSituation(analysis);
      const noticeType = sit.id === 'notice' ? inferNoticeType(analysis.clean) : '';
      return {
        id: 'bulk-' + (i + 1),
        index: i + 1,
        raw: chunk,
        text: analysis.clean,
        rating: analysis.rating,
        situation: sit.id,
        situationLabel: sit.label,
        situationReason: sit.reason,
        auto: sit.auto,
        noticeType: noticeType,
        rateType: analysis.rating === 0 ? '별점 없음' : analysis.rating + '점',
        aspects: analysis.aspectLabels,
        chars: analysis.chars,
        excerpt: analysis.excerpt,
      };
    });
    if (items.length > 20) warnings.push('리뷰가 ' + items.length + '개입니다. 10개씩 나눠 답글을 만들면 확인이 쉽습니다.');
    const short = items.filter(function (it) { return it.chars < 8; });
    if (short.length) warnings.push('너무 짧은 조각이 ' + short.length + '개 있습니다. 리뷰 사이에 --- 를 넣어 구분해 주세요.');
    if (/[★⭐]/.test(str(text)) === false && items.length > 1) warnings.push('별점 표시가 없어 별점 없이 분류했습니다. 필요하면 직접 상황을 바꿔 주세요.');
    return { items: items, warnings: warnings, count: items.length };
  }

  function formatBulkResult(entries) {
    return (entries || []).map(function (e, i) {
      return '[' + (i + 1) + '] ' + (e.rating ? '★' + e.rating + ' · ' : '') + (e.text || '') + '\n→ ' + (e.reply || '');
    }).join('\n\n');
  }

  function bulkCsv(entries) {
    const esc = function (v) {
      const s = str(v).replace(/"/g, '""');
      return '"' + s + '"';
    };
    const rows = [['번호', '별점', '상황', '리뷰', '답글'].map(esc).join(',')];
    (entries || []).forEach(function (e, i) {
      rows.push([String(i + 1), e.rating ? String(e.rating) : '', e.situationLabel || '', e.text || '', e.reply || ''].map(esc).join(','));
    });
    return '\ufeff' + rows.join('\r\n');
  }

  /* ── 신고 소명서 ──────────────────────────────────────── */
  const RECIPIENTS = {
    naver: '네이버 플레이스 고객센터 (리뷰 신고 접수)',
    baemin: '배달의민족 사장님 고객센터 (리뷰 신고)',
    coupangeats: '쿠팡이츠 스토어 고객센터',
    local: '카카오맵·당근 고객센터',
  };

  function todayStamp(date) {
    const d = date instanceof Date ? date : new Date();
    const pad = function (n) { return (n < 10 ? '0' : '') + n; };
    return d.getFullYear() + '-' + pad(d.getMonth() + 1) + '-' + pad(d.getDate());
  }

  function maskName(name) {
    const n = str(name).trim();
    if (!n) return '(미입력)';
    if (n.length === 1) return n;
    if (n.length === 2) return n.charAt(0) + '*';
    return n.charAt(0) + '*'.repeat(n.length - 2) + n.charAt(n.length - 1);
  }

  function buildClaim(input) {
    input = input || {};
    const profile = normalizeProfile(input.profile || {});
    const platform = platformById(input.platform || profile.platform);
    const violations = (input.violations || []).map(function (id) {
      return D.VIOLATION_TYPES.find(function (v) { return v.id === id; });
    }).filter(Boolean);
    const facts = norm(input.facts || '');
    const reviewText = str(input.reviewText || '').trim();
    const storeName = cleanLine(input.storeName || profile.name, 40) || '(상호명 미입력)';
    const ownerName = cleanLine(input.ownerName, 30) || '(대표자 미입력)';
    const contact = cleanLine(input.contact || profile.phone, 30) || '(연락처 미입력)';
    const reviewerName = maskName(input.reviewerName);
    const reviewDate = cleanLine(input.reviewDate, 20) || '(미입력)';
    const reviewUrl = cleanLine(input.reviewUrl, 200) || '(미입력)';
    const date = cleanLine(input.today, 20) || todayStamp();
    const evidences = (input.evidences || []).slice();
    const warnings = [];

    if (violations.length === 0) warnings.push('위반 유형을 하나 이상 골라야 사유가 채워집니다.');
    if (!facts) warnings.push('사실관계가 비어 있습니다. 확인 가능한 내용만 적어 주세요. 추측은 신고를 약하게 만듭니다.');
    if (!reviewText) warnings.push('리뷰 원문을 붙여넣어 주세요. 원문 인용이 있어야 담당자가 바로 확인합니다.');
    if (!input.reviewUrl) warnings.push('리뷰 주소(URL)를 넣으면 처리 속도가 빨라집니다. 앱에서 리뷰를 열고 주소를 복사하세요.');
    if (!evidences.length) warnings.push('확인 자료를 하나 이상 고르세요. 자료가 없으면 신고가 반려되기 쉽습니다.');
    warnings.push('법 조항은 참고용입니다. 실제 판단은 플랫폼 정책과 담당자에게 있습니다.');
    warnings.push('개인정보가 담긴 자료는 이름·번호를 가린 뒤 제출하세요.');
    warnings.push('사실과 다른 내용을 신고하면 오히려 문제가 될 수 있습니다. 확인된 내용만 쓰세요.');

    const violationLines = [];
    violations.forEach(function (v, i) {
      const para = v.paragraph.split('{facts}').join(facts || '(사실관계 미입력)');
      violationLines.push((i + 1) + ') ' + v.label);
      violationLines.push('   - 해당 규정: ' + v.law);
      violationLines.push('   - 사유: ' + para);
      violationLines.push('');
    });

    const sections = [
      {
        no: '1', title: '신청인 정보',
        lines: ['- 상호: ' + storeName, '- 대표자: ' + ownerName, '- 연락처: ' + contact],
      },
      {
        no: '2', title: '대상 리뷰',
        lines: [
          '- 플랫폼: ' + platform.label,
          '- 작성자 표시명: ' + reviewerName,
          '- 작성일: ' + reviewDate,
          '- 리뷰 주소: ' + reviewUrl,
          '- 리뷰 원문:',
          '  "' + (reviewText || '(원문 미입력)').replace(/\n/g, ' ') + '"',
        ],
      },
      {
        no: '3', title: '위반 사유 및 근거',
        lines: violationLines.length ? violationLines.slice(0, -1) : ['- 선택된 위반 유형이 없습니다.'],
      },
      {
        no: '4', title: '사실관계',
        lines: [facts || '- (미입력)'],
      },
      {
        no: '5', title: '확인 가능한 자료',
        lines: evidences.length ? evidences.map(function (e) { return '- ' + e; }) : ['- (선택 없음)'],
      },
      {
        no: '6', title: '요청 사항',
        lines: ['- 해당 리뷰의 게시 중단 및 삭제',
          '- 필요 시 작성자에 대한 플랫폼 정책상 조치',
          '- 처리 결과를 위 연락처로 회신'],
      },
      {
        no: '7', title: '확인',
        lines: ['- 위 내용은 확인한 사실에 근거하며, 요청 시 관련 자료를 제출할 수 있습니다.'],
      },
    ];

    const title = '리뷰 게시 중단 및 삭제 요청 사유서';
    const header = [
      title, '',
      '수신: ' + RECIPIENTS[platform.id],
      '발신: ' + storeName + ' (대표 ' + ownerName + ')',
      '연락처: ' + contact,
      '작성일: ' + date, '', '',
    ];
    const body = header.join('\n') + sections.map(function (s) {
      return s.no + '. ' + s.title + '\n' + s.lines.join('\n');
    }).join('\n\n') + '\n\n' + date + '\n' + storeName + ' 대표 ' + ownerName + ' (서명 또는 인)';

    const excerpt = reviewText.length > 40 ? reviewText.slice(0, 40) + '…' : reviewText;
    const summary = norm(
      '안녕하세요. ' + storeName + '입니다. ' + reviewDate + ' 작성된 리뷰(' + (excerpt || '원문 확인 필요') + ')는 ' +
      (violations.length ? violations.map(function (v) { return v.label; }).join(', ') : '플랫폼 정책 위반') +
      '에 해당하여 게시 중단을 요청드립니다. ' +
      (facts ? facts.slice(0, 120) : '사실관계는 별도 자료로 확인 가능합니다.') +
      (evidences.length ? ' 확인 자료(' + evidences.slice(0, 3).join(', ') + ')를 제출할 수 있습니다.' : '')
    ).slice(0, 400);

    const checklist = uniq(
      ['리뷰 원문 캡처(닉네임·작성일 포함)', '리뷰 주소(URL)']
        .concat(evidences)
        .concat(violations.map(function (v) { return v.ask; }))
    );

    return {
      title: title,
      recipient: RECIPIENTS[platform.id],
      body: body,
      summary: summary,
      sections: sections,
      checklist: checklist,
      citations: uniq(violations.map(function (v) { return v.label + ' — ' + v.law; })),
      warnings: warnings,
      chars: countChars(body),
      violationCount: violations.length,
    };
  }

  /* ── AI 프롬프트 ──────────────────────────────────────── */
  function profileForPrompt(profile, industry) {
    const p = normalizeProfile(profile);
    const rows = [
      '- 가게 이름: ' + (p.name || '(미입력)'),
      '- 업종: ' + industry.label,
      '- 시그니처(' + industry.signatureLabel + '): ' + (p.signature || '(미입력)'),
      '- 주차: ' + (parkingLine(p) || '(미입력)'),
      '- 재방문 혜택: ' + (industry.benefitAllowed && p.benefitOn && p.benefit ? p.benefit : (industry.benefitAllowed ? '(없음)' : '(병원 업종 — 혜택 문구 사용 금지)')),
      '- 문의 번호: ' + (p.phone || '(미입력)'),
      '- 영업시간: ' + (p.hours || '(미입력)'),
      '- 우리 가게 한 줄: ' + (p.story || '(미입력)'),
    ];
    return rows.join('\n');
  }

  function buildAIPrompt(input) {
    input = input || {};
    const profile = normalizeProfile(input.profile || emptyProfile());
    const industry = industryById(input.industry || profile.industry);
    const platform = platformById(input.platform || profile.platform);
    const analysis = analyzeReview(input.review || '', { rating: input.rating });
    const sit = pickSituation(analysis, { situation: input.situation || 'auto' });
    const tone = toneById(input.tone || profile.tone);
    const count = clamp(Number(input.count) || 3, 1, 3);
    const emoji = input.emoji === false ? '이모지를 쓰지 않는다.' : '이모지는 최대 1개.';
    const forbids = ['리뷰에 없는 사실을 만들지 않는다.', '손님 실명·연락처·예약 시간을 쓰지 않는다.'];
    if (industry.id === 'clinic') forbids.push('치료 효과·완치·부작용 없음을 보장하지 않는다. 할인·사은품으로 환자를 유인하는 표현을 쓰지 않는다.');
    if (industry.id === 'academy') forbids.push('성적·합격을 보장하는 표현을 쓰지 않는다.');
    forbids.push('최고·1위·100% 같은 최상급·보장 표현을 쓰지 않는다.');

    return [
      '너는 동네 가게 사장님을 대신해 리뷰 답글을 쓰는 사람이다. 아래 정보만 사용해서, 사장님이 직접 쓴 것처럼 자연스러운 한국어 답글을 ' + count + '개 써라.',
      '',
      '[가게 정보]',
      profileForPrompt(profile, industry),
      '',
      '[플랫폼]',
      '- ' + platform.label + ' / 권장 ' + platform.range[0] + '~' + platform.range[1] + '자',
      '- ' + platform.hint,
      '',
      '[상황]',
      '- ' + sit.label + ' (' + situationById(sit.id).desc + ')',
      '[말투]',
      '- ' + tone.label + ' / ' + tone.end + ' / ' + tone.desc,
      '[리뷰에서 읽힌 포인트]',
      '- ' + (analysis.aspectLabels.join(', ') || '뚜렷한 포인트 없음') + ' / 별점 ' + (analysis.rating || '없음'),
      '',
      '[리뷰 원문]',
      '"""' + (analysis.clean || '(리뷰 없음)') + '"""',
      '',
      '[규칙]',
      '- 서로 다른 문장 구조로 ' + count + '개. 인사말은 한 번만, 같은 문장 반복 금지.',
      '- 첫 문장에 가게 이름 또는 주문/방문 맥락을 넣는다.',
      '- 리뷰에 나온 단어 하나를 그대로 인용해 읽었다는 느낌을 준다.',
      '- ' + emoji,
      '- ' + forbids.join(' '),
      '- 번호·설명·따옴표 없이 답글 본문만 출력한다. 각 답글은 빈 줄로 구분한다.',
      input.extra ? '- 추가 요청: ' + input.extra : '',
    ].filter(function (line) { return line !== ''; }).join('\n');
  }

  function parseAIReply(text) {
    const t = str(text).replace(/\r\n/g, '\n').trim();
    if (!t) return [];
    let body = t;
    const fence = body.match(/```(?:[a-z]*)\n([\s\S]*?)```/i);
    if (fence) body = fence[1];
    const blocks = body.split(/\n\s*\n+/).map(function (b) {
      return b.replace(/^\s*(?:\d{1,2}[.)]|[-*•])\s*/, '').replace(/^["'“”]|["'“”]$/g, '').trim();
    }).filter(function (b) { return countChars(b) >= 8; });
    return blocks.slice(0, 6);
  }

  function buildGeminiBody(prompt) {
    return {
      contents: [{ role: 'user', parts: [{ text: str(prompt) }] }],
      generationConfig: { temperature: 0.9, maxOutputTokens: 1200, topP: 0.95 },
    };
  }

  function geminiUrl(model) {
    const m = cleanLine(model, 40) || 'gemini-2.5-flash';
    return 'https://generativelanguage.googleapis.com/v1beta/models/' + encodeURIComponent(m) + ':generateContent';
  }

  function readGeminiResponse(json) {
    if (!json || !json.candidates || !json.candidates.length) {
      const msg = json && json.error && json.error.message ? json.error.message : '응답이 비어 있습니다.';
      return { ok: false, error: msg, text: '' };
    }
    const cand = json.candidates[0];
    const parts = (cand.content && cand.content.parts) || [];
    const text = parts.map(function (p) { return p.text || ''; }).join('').trim();
    if (!text) return { ok: false, error: '답글이 비어 있습니다. 프롬프트를 조금 바꿔 다시 시도해 보세요.', text: '' };
    return { ok: true, error: '', text: text, finishReason: cand.finishReason || '' };
  }

  return {
    VERSION,
    /* utils */
    countChars, countNoSpace, josa, withJosa, norm, clamp,
    /* catalog */
    industryById, platformById, situationById, toneById, aspectById,
    /* profile */
    emptyProfile, normalizeProfile, parkingLine, storeCompleteness,
    /* analysis */
    analyzeReview, pickSituation, detectRating, stripRating, aspectsOf, splitSentences, scoreSentiment,
    /* generation */
    generateReplies, composeReply, buildContext,
    /* checking */
    checkReply, legalScan, privacyScan, autoFix, gradeOf, emojiCount, legalRulesFor,
    /* bulk */
    parseBulk, splitChunks, inferNoticeType, formatBulkResult, bulkCsv,
    /* claim */
    buildClaim, todayStamp, maskName, RECIPIENTS,
    /* bridge */
    buildAIPrompt, parseAIReply, buildGeminiBody, geminiUrl, readGeminiResponse,
    data: D,
  };
});
