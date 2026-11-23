/* ============================================================
   사장님 리뷰 답글 스튜디오 · app.js
   화면 조립과 이벤트. 문장 생성·점검은 core.js가 한다.
   ============================================================ */
(function () {
  'use strict';

  const C = window.ReviewCore;
  const P = window.ProConnector || null; // engines/pro-api-connector.js
  const PS = window.ProStudio ? window.ProStudio.create(P) : null; // engines/pro-studio.js
  const KEY = 'review-reply-studio:v1';
  const $ = function (sel, root) { return (root || document).querySelector(sel); };
  const $$ = function (sel, root) { return Array.from((root || document).querySelectorAll(sel)); };

  const state = {
    tab: 'write',
    pro: { busy: false, meta: '', note: '' },
    profile: C.normalizeProfile({}),
    situation: 'auto',
    tone: 'warm',
    platform: 'naver',
    industry: 'food',
    compare: false,
    lastReview: '',
    rating: 0,
    replies: [],
    meta: null,
    bulkItems: [],
    bulkEntries: [],
    claim: null,
    bridgePrompt: '',
    gemText: '',
    seed: 0,
    saveTimer: null,
  };

  /* ── 저장 ─────────────────────────────────────────────── */
  function loadStore() {
    try {
      const raw = localStorage.getItem(KEY);
      return raw ? JSON.parse(raw) : null;
    } catch (e) { return null; }
  }
  function saveStore(immediate) {
    clearTimeout(state.saveTimer);
    const write = function () {
      try {
        localStorage.setItem(KEY, JSON.stringify({
          profile: state.profile,
          form: {
            review: $('#f-review').value, rating: $('#f-rating').value,
            situation: state.situation, tone: state.tone, compare: state.compare,
            platform: $('#f-platform').value, industry: $('#f-industry').value,
            noticeType: $('#f-notice-type').value, period: $('#f-period').value,
          },
          theme: document.documentElement.getAttribute('data-theme'),
          v: 1,
        }));
        const now = new Date();
        $('#save-state').textContent = '저장됨 ' + String(now.getHours()).padStart(2, '0') + ':' + String(now.getMinutes()).padStart(2, '0');
      } catch (e) {
        $('#save-state').textContent = '저장할 수 없습니다';
      }
    };
    if (immediate) write();
    else state.saveTimer = setTimeout(write, 400);
  }

  /* ── 공통 UI ──────────────────────────────────────────── */
  function toast(message) {
    const root = $('#toast-root');
    const el = document.createElement('div');
    el.className = 'toast';
    el.textContent = message;
    root.appendChild(el);
    while (root.children.length > 2) root.removeChild(root.firstElementChild);
    setTimeout(function () { el.remove(); }, 2600);
  }

  function copyText(text, btn, label) {
    const done = function (ok) {
      if (!ok) { toast('복사하지 못했습니다. 직접 선택해 복사해 주세요.'); return; }
      toast(label || '복사했습니다.');
      if (btn) {
        const original = btn.textContent;
        btn.textContent = '복사됨';
        btn.classList.add('is-done');
        setTimeout(function () { btn.textContent = original; btn.classList.remove('is-done'); }, 1400);
      }
    };
    if (navigator.clipboard && navigator.clipboard.writeText) {
      navigator.clipboard.writeText(text).then(function () { done(true); }, function () { done(fallbackCopy(text)); });
    } else {
      done(fallbackCopy(text));
    }
  }

  function fallbackCopy(text) {
    try {
      const ta = document.createElement('textarea');
      ta.value = text;
      ta.setAttribute('readonly', '');
      ta.style.position = 'fixed';
      ta.style.top = '-1000px';
      document.body.appendChild(ta);
      ta.select();
      const ok = document.execCommand('copy');
      ta.remove();
      return ok;
    } catch (e) { return false; }
  }

  function escapeHtml(text) {
    return String(text).replace(/[&<>"']/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
    });
  }

  function download(name, text, mime) {
    const blob = new Blob([text], { type: (mime || 'text/plain') + ';charset=utf-8' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = name;
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(function () { URL.revokeObjectURL(a.href); }, 2000);
  }

  function gradeClass(grade) { return 'grade g-' + grade.id; }

  /* ── 디자인 시스템 A안 · Crisp Bento SaaS ───────────────
     색·간격·라운딩의 단일 출처는 styles.css의 :root 다.
     여기서는 문서에 어느 시스템인지 표기만 남긴다.            */
  function applyDesignTokens() {
    try {
      document.documentElement.setAttribute('data-design', 'crisp-bento/v1');
    } catch (e) { /* 표기 실패는 화면 동작에 영향이 없다 */ }
  }

  /* ── 선택 목록 채우기 ─────────────────────────────────── */
  function options(list, selected, labelOf) {
    return list.map(function (x) {
      return '<option value="' + x.id + '"' + (x.id === selected ? ' selected' : '') + '>' +
        escapeHtml(labelOf ? labelOf(x) : x.label) + '</option>';
    }).join('');
  }

  function fillSelects() {
    $('#f-industry').innerHTML = options(C.data.INDUSTRIES, state.industry);
    $('#f-platform').innerHTML = options(C.data.PLATFORMS, state.platform);
    $('#bulk-industry').innerHTML = options(C.data.INDUSTRIES, state.industry);
    $('#bulk-platform').innerHTML = options(C.data.PLATFORMS, state.platform);
    $('#bulk-tone').innerHTML = options(C.data.TONES, state.tone);
    $('#s-industry').innerHTML = options(C.data.INDUSTRIES, state.profile.industry);
    $('#s-tone').innerHTML = options(C.data.TONES, state.profile.tone);
    $('#s-platform').innerHTML = options(C.data.PLATFORMS, state.profile.platform);
    $('#c-platform').innerHTML = options(C.data.PLATFORMS, state.profile.platform);
  }

  /* ── 탭 ───────────────────────────────────────────────── */
  function setTab(name) {
    state.tab = name;
    $$('.tab').forEach(function (t) {
      const on = t.getAttribute('data-tab') === name;
      t.classList.toggle('is-active', on);
      t.setAttribute('aria-selected', on ? 'true' : 'false');
    });
    $$('.view').forEach(function (v) {
      const on = v.id === 'view-' + name;
      v.classList.toggle('is-active', on);
      if (on) v.removeAttribute('hidden'); else v.setAttribute('hidden', '');
    });
    if (name === 'bridge') refreshBridge();
    updateTopAction();
    window.scrollTo({ top: 0, behavior: 'auto' });
  }

  /* ── 매장 ─────────────────────────────────────────────── */
  function profileToForm() {
    const p = state.profile;
    $('#s-name').value = p.name;
    $('#s-industry').value = p.industry;
    $('#s-signature').value = p.signature;
    $('#s-signature-label').textContent = C.industryById(p.industry).signatureLabel;
    $('#s-signature').placeholder = '예: ' + C.industryById(p.industry).signatureHint.replace(/^예:\s*/, '');
    $('#s-parking').value = p.parking;
    $('#s-parking-note').value = p.parkingNote;
    $('#s-phone').value = p.phone;
    $('#s-hours').value = p.hours;
    $('#s-story').value = p.story;
    $('#s-benefit-on').checked = p.benefitOn;
    $('#s-benefit').value = p.benefit;
    $('#s-tone').value = p.tone;
    $('#s-platform').value = p.platform;
    const clinic = p.industry === 'clinic';
    $('#benefit-warn').hidden = !clinic;
    $('#s-benefit').disabled = clinic;
    $('#s-benefit-on').disabled = clinic;
    updateMeter();
  }

  function formToProfile() {
    state.profile = C.normalizeProfile({
      name: $('#s-name').value,
      industry: $('#s-industry').value,
      signature: $('#s-signature').value,
      parking: $('#s-parking').value,
      parkingNote: $('#s-parking-note').value,
      phone: $('#s-phone').value,
      hours: $('#s-hours').value,
      story: $('#s-story').value,
      benefitOn: $('#s-benefit-on').checked,
      benefit: $('#s-benefit').value,
      tone: $('#s-tone').value,
      platform: $('#s-platform').value,
    });
    return state.profile;
  }

  function updateMeter() {
    const info = C.storeCompleteness(state.profile);
    $('#store-meter-bar').style.width = info.score + '%';
    if (info.missing.length === 0) {
      $('#store-missing').textContent = '매장 정보 ' + info.total + '개 모두 채웠습니다. 답글이 가장 자연스러운 상태입니다.';
    } else {
      $('#store-missing').textContent = '매장 정보 ' + info.filled + '/' + info.total + ' · ' +
        info.missing.slice(0, 2).map(function (m) { return m.label; }).join(', ') + '만 채워도 달라집니다.';
    }
  }

  /* ── 리뷰 읽기 ────────────────────────────────────────── */
  function currentForm() {
    return {
      review: $('#f-review').value,
      rating: Number($('#f-rating').value) || 0,
      industry: $('#f-industry').value,
      platform: $('#f-platform').value,
      tone: $('#tone-cards input:checked') ? $('#tone-cards input:checked').value : state.tone,
      situation: state.situation,
      period: $('#f-period').value,
      noticeType: $('#f-notice-type').value,
      compare: state.compare,
    };
  }

  function updateDetect() {
    const form = currentForm();
    const review = form.review.trim();
    $('#review-count').textContent = C.countChars(review) + '자';
    if (!review) {
      $('#detect-badge').textContent = '리뷰를 붙여넣으면 별점과 포인트를 읽습니다.';
      return;
    }
    const a = C.analyzeReview(review, { rating: form.rating });
    const sit = C.pickSituation(a, { situation: state.situation });
    const bits = [];
    bits.push(a.rating ? '<strong>★' + a.rating + '</strong>' : '별점 없음');
    bits.push(escapeHtml(sit.label));
    if (a.aspectLabels.length) bits.push('포인트: ' + escapeHtml(a.aspectLabels.slice(0, 3).join(', ')));
    if (a.flags.photo) bits.push('사진');
    if (a.flags.regular) bits.push('단골');
    const feel = a.feeling ? feelingText(a.feeling) : '';
    if (feel) bits.push(feel);
    $('#detect-badge').innerHTML = bits.join(' · ') + ' — ' + escapeHtml(sit.reason);
  }

  /* ── 답글 카드 ────────────────────────────────────────── */
  function renderReplies(result) {
    state.replies = result.replies.map(function (r) {
      return { id: r.id, tone: r.tone, toneLabel: r.toneLabel, text: r.text, check: r.check };
    });
    state.meta = result;
    const list = $('#reply-list');
    list.innerHTML = '';
    state.replies.forEach(function (r, i) { list.appendChild(replyCard(r, i)); });

    const a = result.analysis;
    const platform = C.platformById(result.meta.platform);
    $('#reply-title').textContent = result.situation.label + ' · ' + platform.short + ' 답글 ' + state.replies.length + '개';
    $('#reply-meta').innerHTML = [
      result.situation.auto ? '자동 판별' : '직접 선택',
      escapeHtml(result.situation.reason),
      a.rating ? '★' + a.rating : '별점 없음',
      platform.range[0] + '~' + platform.range[1] + '자 권장',
    ].map(function (s) { return '<span>' + s + '</span>'; }).join(' <span class="dot">·</span> ');
    $('#reply-meta').classList.add('is-rich');
    $('#btn-copy-all').disabled = false;
    $('#btn-again').disabled = false;
    renderQuality();
    updateTopAction();
    saveStore();
  }

  function updateTopAction() {
    const btn = $('#top-primary');
    const label = $('#top-primary-label');
    if (state.tab === 'write') {
      btn.hidden = false;
      label.textContent = state.replies.length ? '답글 복사' : '답글 만들기';
    } else if (state.tab === 'bulk') {
      const has = state.bulkEntries.some(function (e) { return !!e.reply; });
      btn.hidden = !has;
      label.textContent = '전체 복사';
    } else if (state.tab === 'claim') {
      btn.hidden = !state.claim;
      label.textContent = '사유서 복사';
    } else {
      btn.hidden = true;
    }
  }

  function replyCard(r, index) {
    const card = document.createElement('article');
    card.className = 'reply-card';
    card.setAttribute('data-reply', r.id);
    const grade = r.check.grade;
    card.innerHTML = [
      '<div class="reply-top">',
      '<span class="reply-no">' + String(index + 1).padStart(2, '0') + '</span>',
      '<span class="reply-tone">' + escapeHtml(r.toneLabel) + '</span>',
      '<span class="reply-chars">' + r.check.stats.chars + '자</span>',
      '</div>',
      '<div class="reply-body"><label class="sr-only" for="' + r.id + '-text">답글 ' + (index + 1) + '</label>',
      '<textarea class="reply-text" id="' + r.id + '-text" rows="4" spellcheck="false">' + escapeHtml(r.text) + '</textarea></div>',
      '<div class="reply-foot">',
      '<span class="score"><b>' + r.check.score + '</b><small>/100</small></span>',
      '<span class="' + gradeClass(grade) + '">' + grade.id + '</span>',
      '<span class="score-bar"><span class="' + barClass(r.check.score) + '" style="width:' + r.check.score + '%"></span></span>',
      '<div class="reply-actions">',
      '<button type="button" class="btn btn-ghost btn-sm" data-copy="' + r.id + '">복사</button>',
      '<button type="button" class="btn btn-ghost btn-sm" data-autofix="' + r.id + '">AI 티 고치기</button>',
      '</div></div>',
      '<details class="reply-issues"><summary>' + issueSummary(r.check) + '</summary><div class="issue-list">' + issueHtml(r.check) + '</div></details>',
    ].join('');
    const ta = $('textarea', card);
    ta.value = r.text;
    autoGrow(ta);
    ta.addEventListener('input', function () {
      autoGrow(ta);
      r.text = ta.value;
      clearTimeout(ta._t);
      ta._t = setTimeout(function () { recheckCard(card, r); }, 320);
    });
    return card;
  }

  function autoGrow(ta) {
    ta.style.height = 'auto';
    ta.style.height = Math.max(96, ta.scrollHeight + 2) + 'px';
  }

  function barClass(score) { return score >= 80 ? '' : (score >= 70 ? 'low' : 'bad'); }
  function issueSummary(check) {
    if (!check.issues.length) return '걸리는 표현 없음';
    const high = check.issues.filter(function (i) { return i.severity === 'high'; }).length;
    return '점검 ' + check.issues.length + '건' + (high ? ' · 위험 ' + high : '');
  }
  function issueHtml(check) {
    if (!check.issues.length) return '<p class="quality-empty">걸리는 표현이 없습니다.</p>';
    return check.issues.slice(0, 6).map(function (i) {
      return '<div class="issue is-' + i.severity + '"><b>' + escapeHtml(i.label) +
        (i.phrase ? ' · “' + escapeHtml(i.phrase) + '”' : '') + '</b>' +
        '<span class="why">' + escapeHtml(i.reason) + '</span>' +
        '<span class="fix">→ ' + escapeHtml(i.fix) + '</span></div>';
    }).join('');
  }

  function recheckCard(card, r) {
    const form = currentForm();
    const a = C.analyzeReview(form.review, { rating: form.rating });
    r.check = C.checkReply(r.text, {
      platform: form.platform, industry: form.industry, profile: state.profile, analysis: a, review: a.clean,
    });
    r.chars = r.check.stats.chars;
    $('.reply-chars', card).textContent = r.check.stats.chars + '자';
    $('.score b', card).textContent = r.check.score;
    const g = $('.grade', card);
    g.textContent = r.check.grade.id;
    g.className = gradeClass(r.check.grade);
    const bar = $('.score-bar span', card);
    bar.style.width = r.check.score + '%';
    bar.className = barClass(r.check.score);
    $('summary', card).textContent = issueSummary(r.check);
    $('.issue-list', card).innerHTML = issueHtml(r.check);
    renderQuality();
  }

  function renderQuality() {
    if (!state.replies.length) { $('#quality-panel').hidden = true; return; }
    $('#quality-panel').hidden = false;
    const list = $('#quality-list');
    const items = [];
    state.replies.forEach(function (r, i) {
      r.check.issues.forEach(function (issue) {
        items.push({ reply: i + 1, issue: issue });
      });
    });
    list.innerHTML = items.slice(0, 12).map(function (x) {
      return '<li class="' + x.issue.severity + '"><b>답글 ' + x.reply + ' · ' + escapeHtml(x.issue.label) + '</b> ' +
        escapeHtml(x.issue.reason) + ' <span class="fix">→ ' + escapeHtml(x.issue.fix) + '</span></li>';
    }).join('');
    $('#quality-empty').hidden = items.length > 0;
  }

  /* ── 생성 ─────────────────────────────────────────────── */
  function generate() {
    const form = currentForm();
    if (!form.review.trim()) {
      toast('리뷰를 먼저 붙여넣어 주세요.');
      $('#f-review').focus();
      return;
    }
    const result = C.generateReplies({
      review: form.review,
      rating: form.rating,
      situation: state.situation,
      tone: form.tone,
      platform: form.platform,
      industry: form.industry,
      profile: state.profile,
      compare: state.compare,
      period: form.period,
      noticeType: form.noticeType,
      seed: state.seed,
    });
    state.lastReview = form.review;
    renderReplies(result);
    toast('답글 ' + result.replies.length + '개를 만들었습니다. 손님 이름과 예약 시간이 없는지 확인하세요.');
    saveStore(true);
  }

  /* ── 일괄 ─────────────────────────────────────────────── */
  function renderBulk() {
    const list = $('#bulk-list');
    list.innerHTML = '';
    $('#bulk-empty').hidden = state.bulkItems.length > 0;
    state.bulkItems.forEach(function (item, i) {
      const entry = state.bulkEntries.find(function (e) { return e.id === item.id; });
      const card = document.createElement('article');
      card.className = 'bulk-item';
      card.setAttribute('data-bulk', item.id);
      card.innerHTML = [
        '<div class="bulk-item-head">',
        '<span class="idx">' + String(i + 1).padStart(2, '0') + '</span>',
        '<span class="rate">' + (item.rating ? '★' + item.rating : '별점 없음') + '</span>',
        '<label class="sr-only" for="' + item.id + '-sit">상황</label>',
        '<select class="input mini" id="' + item.id + '-sit" data-sit-for="' + item.id + '">' +
        C.data.SITUATIONS.map(function (s) {
          return '<option value="' + s.id + '"' + (s.id === item.situation ? ' selected' : '') + '>' + escapeHtml(s.label) + '</option>';
        }).join('') + '</select>',
        '</div>',
        '<div class="bulk-item-body">',
        '<p class="bulk-review">' + escapeHtml(item.text) + '</p>',
        '<label class="sr-only" for="' + item.id + '-reply">답글</label>',
        '<textarea class="bulk-reply" id="' + item.id + '-reply" rows="3" data-reply-for="' + item.id + '" placeholder="전체 답글 만들기를 누르면 여기에 답글이 들어옵니다.">' + escapeHtml(entry ? entry.reply : '') + '</textarea>',
        '<div class="bulk-item-foot">',
        '<span class="bulk-score">' + (entry ? entry.check.score + '/100 · ' + entry.check.grade.id : '아직 생성 전') + '</span>',
        '<button type="button" class="btn btn-ghost btn-sm" data-bulk-one="' + item.id + '" style="margin-left:auto">' + (entry ? '다시 만들기' : '이 리뷰 답글') + '</button>',
        '<button type="button" class="btn btn-ghost btn-sm" data-bulk-copy="' + item.id + '"' + (entry ? '' : ' disabled') + '>복사</button>',
        '</div></div>',
      ].join('');
      list.appendChild(card);
    });
    $('#bulk-ready').textContent = state.bulkItems.length + '개';
    const has = state.bulkEntries.some(function (e) { return !!e.reply; });
    updateTopAction();
    $('#btn-bulk-generate').disabled = !state.bulkItems.length;
    ['#btn-bulk-copy', '#btn-bulk-txt', '#btn-bulk-csv'].forEach(function (sel) { $(sel).disabled = !has; });
  }

  function bulkGenerateOne(item) {
    const tone = $('#bulk-tone').value;
    const industry = $('#bulk-industry').value;
    const platform = $('#bulk-platform').value;
    const result = C.generateReplies({
      review: item.text, rating: item.rating, situation: item.situation,
      tone: tone, platform: platform, industry: industry, profile: state.profile,
      noticeType: item.noticeType || 'closed',
    });
    const reply = result.replies[0];
    const existing = state.bulkEntries.findIndex(function (e) { return e.id === item.id; });
    const entry = {
      id: item.id, text: item.text, rating: item.rating, situation: item.situation,
      situationLabel: C.situationById(item.situation).label,
      reply: reply.text, check: reply.check,
    };
    if (existing >= 0) state.bulkEntries[existing] = entry; else state.bulkEntries.push(entry);
  }

  function bulkGenerateAll() {
    if (!state.bulkItems.length) { toast('먼저 리뷰를 나눠 주세요.'); return; }
    state.bulkEntries = [];
    state.bulkItems.forEach(bulkGenerateOne);
    renderBulk();
    const bad = state.bulkEntries.filter(function (e) { return e.check.counts.legal || e.check.counts.privacy; });
    toast('답글 ' + state.bulkEntries.length + '개를 만들었습니다.' + (bad.length ? ' 위험 표현 ' + bad.length + '건을 확인하세요.' : ''));
  }

  function parseBulkInput() {
    const res = C.parseBulk($('#bulk-input').value);
    state.bulkItems = res.items;
    state.bulkEntries = [];
    $('#bulk-warnings').innerHTML = res.warnings.map(function (w) { return '<li>' + escapeHtml(w) + '</li>'; }).join('');
    $('#bulk-warnings').hidden = !res.warnings.length;
    $('#bulk-count').textContent = res.count + '개';
    renderBulk();
    if (!res.count) toast('나눌 리뷰가 없습니다.');
    else toast(res.count + '개로 나눴습니다.');
  }

  /* ── 소명서 ───────────────────────────────────────────── */
  function buildViolationChecks() {
    $('#c-violations').innerHTML = C.data.VIOLATION_TYPES.map(function (v) {
      return '<label class="check"><input type="checkbox" name="viol" value="' + v.id + '" /> <span>' + escapeHtml(v.label) + '</span></label>';
    }).join('');
    $('#c-evidences').innerHTML = C.data.EVIDENCE_ITEMS.map(function (e) {
      return '<label class="check"><input type="checkbox" name="evidence" value="' + escapeHtml(e) + '" /> <span>' + escapeHtml(e) + '</span></label>';
    }).join('');
  }

  function claimForm() {
    return {
      platform: $('#c-platform').value,
      reviewerName: $('#c-reviewer').value,
      reviewDate: $('#c-date').value,
      reviewUrl: $('#c-url').value,
      reviewText: $('#c-review').value,
      violations: $$('#c-violations input:checked').map(function (i) { return i.value; }),
      facts: $('#c-facts').value,
      evidences: $$('#c-evidences input:checked').map(function (i) { return i.value; }),
      storeName: $('#c-store').value,
      ownerName: $('#c-owner').value,
      contact: $('#c-contact').value,
      profile: state.profile,
    };
  }

  function generateClaim() {
    const out = C.buildClaim(claimForm());
    state.claim = out;
    $('#claim-out').textContent = out.body;
    $('#claim-summary').textContent = out.summary;
    $('#claim-summary-box').hidden = false;
    $('#claim-checklist').innerHTML = out.checklist.map(function (c) { return '<li>' + escapeHtml(c) + '</li>'; }).join('');
    $('#claim-warnings').innerHTML = out.warnings.map(function (w) { return '<li>' + escapeHtml(w) + '</li>'; }).join('');
    $('#btn-claim-copy').disabled = false;
    $('#btn-claim-txt').disabled = false;
    updateTopAction();
    toast('사유서 초안을 만들었습니다.');
  }

  function fillClaimSample() {
    const s = C.data.CLAIM_SAMPLE;
    $('#c-platform').value = s.platform;
    $('#c-reviewer').value = s.reviewerName;
    $('#c-date').value = s.reviewDate;
    $('#c-url').value = s.reviewUrl;
    $('#c-review').value = s.reviewText;
    $('#c-facts').value = s.facts;
    $$('#c-violations input').forEach(function (i) { i.checked = s.violations.indexOf(i.value) >= 0; });
    $$('#c-evidences input').forEach(function (i) { i.checked = s.evidences.indexOf(i.value) >= 0; });
    if (!$('#c-store').value) $('#c-store').value = state.profile.name || '오늘식당';
    if (!$('#c-owner').value) $('#c-owner').value = '김사장';
    if (!$('#c-contact').value) $('#c-contact').value = state.profile.phone || '010-0000-0000';
    toast('가상 예시를 채웠습니다. 실제 내용으로 바꿔 주세요.');
  }

  /* ── AI 브리지 ────────────────────────────────────────── */
  function refreshBridge() {
    const form = currentForm();
    const profile = state.profile;
    const industry = C.industryById(form.industry);
    const platform = C.platformById(form.platform);
    const analysis = C.analyzeReview(form.review || '', { rating: form.rating });
    const sit = C.pickSituation(analysis, { situation: state.situation });
    $('#bridge-context').textContent = (profile.name || '가게명 미입력') + ' · ' + industry.label + ' · ' +
      platform.short + ' · ' + sit.label + ' · 리뷰 ' + analysis.chars + '자' + (analysis.rating ? ' (★' + analysis.rating + ')' : '');
    state.bridgePrompt = C.buildAIPrompt({
      review: form.review, rating: form.rating, situation: state.situation,
      tone: form.tone, platform: form.platform, industry: form.industry,
      profile: profile, count: Number($('#br-count').value) || 3,
      emoji: $('#br-emoji').checked, extra: $('#br-extra').value,
    });
    $('#bridge-prompt').value = state.bridgePrompt;
  }

  async function runGemini() {
    const key = $('#gem-key').value.trim();
    const model = $('#gem-model').value.trim() || 'gemini-2.5-flash';
    const status = $('#gem-status');
    if (!key) {
      status.textContent = 'API 키를 붙여넣거나, 위의 프롬프트를 복사해 구독 중인 AI에 붙여넣으세요.';
      status.classList.add('is-error');
      $('#gem-key').focus();
      return;
    }
    if (!state.bridgePrompt) refreshBridge();
    status.classList.remove('is-error');
    status.textContent = '답글을 받는 중입니다…';
    $('#btn-gem-run').disabled = true;
    try {
      const res = await fetch(C.geminiUrl(model), {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'x-goog-api-key': key },
        body: JSON.stringify(C.buildGeminiBody(state.bridgePrompt)),
      });
      let json = null;
      try { json = await res.json(); } catch (e) { json = null; }
      if (!res.ok) {
        const msg = json && json.error && json.error.message ? json.error.message : ('요청이 실패했습니다 (HTTP ' + res.status + ').');
        throw new Error(msg);
      }
      const read = C.readGeminiResponse(json);
      if (!read.ok) throw new Error(read.error);
      state.gemText = read.text;
      $('#gem-out').textContent = read.text;
      $('#gem-out').hidden = false;
      $('#btn-gem-import').hidden = false;
      status.textContent = '받았습니다. 그대로 쓰기 전에 점검을 확인하세요.';
    } catch (err) {
      status.classList.add('is-error');
      status.textContent = '실패: ' + (err && err.message ? err.message : '알 수 없는 오류') +
        ' — 키·모델명을 확인하거나 프롬프트 복사 방식으로 진행하세요.';
    } finally {
      $('#btn-gem-run').disabled = false;
    }
  }

  /* ── Pro AI (맞춤 답글 3안) ──────────────────────────────
     무료 모드에서는 버튼이 연결 안내만 열고 아무 요청도 보내지 않는다.
     연결 뒤에는 buildProPrompt('reviewReply') → generate → 3안을 점검기에 다시 통과시킨다. */

  const PRO_TONE_MAP = { '정중': 'pro', '친근': 'warm', '간결': 'mz' };

  function proFacts() {
    const p = state.profile;
    const bits = [];
    if (p.signature) bits.push('대표 메뉴·시그니처: ' + p.signature);
    if (p.hours) bits.push('영업시간: ' + p.hours);
    if (p.benefitOn && p.benefit) bits.push('혜택: ' + p.benefit);
    if (p.story) bits.push('가게 이야기: ' + p.story);
    return bits.join(' / ');
  }

  function proInput() {
    const form = currentForm();
    const industry = C.industryById(form.industry);
    const platform = C.platformById(form.platform);
    return {
      review: form.review,
      store: [state.profile.name || '우리 가게', industry.label, platform.short].filter(Boolean).join(' · '),
      facts: proFacts(),
      policy: '',
    };
  }

  /* 감성 판정 문구 — 단어 수가 아니라 부정어·완곡·강조를 반영한 결과 */
  function feelingText(f) {
    const map = { positive: '긍정', negative: '부정', mixed: '좋다·아쉬움 섞임', neutral: '중립' };
    let label = map[f.label] || '';
    if (f.label === 'negative' && f.soft) label = '완곡한 아쉬움';
    if (f.label === 'mixed' && f.soft) label = '완곡하게 섞임';
    if (f.negated && f.negated.length) label += ' · 부정어 뒤집힘 ' + f.negated.length;
    if (f.hedges && f.hedges.length) label += ' · 유보 표현';
    return label ? '감성: ' + label : '';
  }

  /* ── 무료 AI 맛보기 (free-ai.js) ──────────────────────── */
  const FREE = window.FreeAI || null;

  function freePromptForReplies(form, analysis, situation) {
    // 워커는 짧은 입력에서 안정적이다. 리뷰 앞부분과 조건만 넣는다.
    const review = String(form.review || '').replace(/\s+/g, ' ').slice(0, 70);
    const cond = String(form.tone || '정중').slice(0, 8) + ' · ' + String(situation || '일반').slice(0, 10);
    return '한국어 리뷰 답글 맛보기. 리뷰: ' + review + ' / 조건: ' + cond +
      '. 사장님 답글 2개를 JSON만으로: {"replies":[{"text":"…"}×2]}. 각 2문장, 90자 이내.';
  }

  function parseFreeReplies(text) {
    const raw = String(text || '');
    let data = null;
    const first = raw.indexOf('{');
    const last = raw.lastIndexOf('}');
    if (first >= 0 && last > first) {
      try { data = JSON.parse(raw.slice(first, last + 1)); } catch (e) { data = null; }
    }
    if (data && Array.isArray(data.replies)) {
      return data.replies.map(function (r) {
        return { tone: String((r && r.tone) || '').trim(), text: String((r && r.text) || '').trim() };
      }).filter(function (r) { return r.text; });
    }
    // JSON 이 아니면 답글만 줄 단위로 줍는다.
    return raw.split(/\n+/).map(function (line) {
      return { tone: '', text: line.replace(/^\s*[-*\d.]+\s*/, '').trim() };
    }).filter(function (r) { return r.text.length >= 20; }).slice(0, 2);
  }

  function runFreeReplies() {
    if (!FREE) { toast('무료 체험 모듈을 불러오지 못했습니다. 새로고침해 주세요.'); return; }
    if (state.pro.busy) return;
    const form = currentForm();
    if (!form.review.trim()) { toast('리뷰를 먼저 붙여넣어 주세요.'); $('#f-review').focus(); return; }
    const analysis = C.analyzeReview(form.review, { rating: form.rating });
    const sit = C.pickSituation(analysis, { situation: state.situation });
    const btn = $('#btn-free-replies');
    const stateEl = $('#proState');
    state.pro.busy = true;
    if (btn) { btn.disabled = true; btn.textContent = '무료 AI가 쓰는 중…'; }
    if (stateEl) stateEl.textContent = '무료 체험으로 답글을 쓰는 중… (보통 3~10초)';
    const host = $('#freeUpgrade');
    if (host) host.innerHTML = '';
    FREE.generate({
      prompt: freePromptForReplies(form, analysis, sit.label),
      options: { temperature: 0.7, maxTokens: 700, json: true }
    }).then(function (res) {
      state.pro.busy = false;
      if (btn) { btn.disabled = false; btn.textContent = '무료 AI 답글 맛보기'; }
      if (!res.ok) {
        if (host) {
          FREE.mountUpgrade(host, res, {
            onConnectKey: function () { if (P && P.mountModal) P.mountModal($('#proConnect')); PS.openConnect(); },
            onBridge: function () { setTab('bridge'); }
          });
        }
        if (stateEl) stateEl.textContent = res.message;
        toast(res.message);
        return;
      }
      const list = parseFreeReplies(res.text);
      if (!list.length) {
        if (stateEl) stateEl.textContent = '응답에 답글이 비어 있습니다. 다시 시도해 주세요.';
        toast('응답에 답글이 비어 있습니다. 다시 시도해 주세요.');
        return;
      }
      const cards = proReplyCards({ replies: list }).map(function (c) {
        return Object.assign({}, c, { toneLabel: c.toneLabel.replace(' · Pro', ' · 무료 체험') });
      });
      const base = C.generateReplies({
        review: form.review, rating: form.rating, situation: state.situation, tone: form.tone,
        platform: form.platform, industry: form.industry, profile: state.profile,
        compare: form.compare, period: form.period, noticeType: form.noticeType, seed: state.seed,
      });
      state.replies = cards;
      state.lastReview = form.review;
      state.meta = base;
      const replyList = $('#reply-list');
      replyList.innerHTML = '';
      state.replies.forEach(function (r, i) { replyList.appendChild(replyCard(r, i)); });
      $('#reply-title').textContent = '무료 체험 · ' + base.situation.label + ' 답글 ' + state.replies.length + '개';
      $('#reply-meta').innerHTML = ['무료 체험(하루 몇 회)으로 만든 답글입니다. 게시 전에 사실 확인을 한 번 해 주세요.',
        C.platformById(form.platform).short].join(' <span class="dot">·</span> ');
      $('#btn-copy-all').disabled = false;
      renderQuality();
      updateTopAction();
      const left = (res.remaining === undefined || res.remaining === null) ? '' : ' · 남은 맛보기 ' + res.remaining + (res.limit ? '/' + res.limit : '') + '회';
      if (stateEl) stateEl.textContent = '무료 체험 답글 ' + state.replies.length + '안을 점검기로 다시 확인했습니다.' + left;
      saveStore(true);
      toast('무료 체험 답글 ' + state.replies.length + '안을 만들었습니다.');
    });
  }

  function setProBusy(on) {
    state.pro.busy = !!on;
    const btn = $('#btn-pro-replies');
    if (!btn) return;
    btn.setAttribute('aria-busy', on ? 'true' : 'false');
    const label = $('.pro-label', btn);
    if (label) label.textContent = on ? 'Pro AI가 쓰는 중…' : 'Pro AI로 맞춤 답글 3안 생성';
  }

  function updateProUi() {
    if (!PS) return;
    const s = PS.sync($('#proBox') || document);
    const el = $('#proState');
    if (!el || state.pro.busy) return;
    el.textContent = s.connected
      ? s.providerName + ' 연결됨 · 리뷰 문맥·업종·법규 회피를 지킨 답글 3안을 쓰고 점검기를 다시 통과시킵니다.'
      : '무료 모드 · 위의 답글 3개 만들기는 그대로 동작합니다. Pro를 연결하면 리뷰 문맥을 읽은 맞춤 답글 3안을 씁니다.';
  }

  function proNote(text) {
    const el = $('#proNote');
    if (!el) return;
    if (!text) { el.hidden = true; el.textContent = ''; return; }
    el.hidden = false;
    el.textContent = text;
  }

  function proReplyCards(data) {
    const form = currentForm();
    const analysis = C.analyzeReview(form.review || '', { rating: form.rating });
    const list = (Array.isArray(data.replies) ? data.replies : []).map(function (r) {
      return { tone: String((r && r.tone) || '').trim(), text: String((r && r.text) || '').trim() };
    }).filter(function (r) { return r.text; }).slice(0, 3);
    return list.map(function (r, i) {
      const toneId = PRO_TONE_MAP[r.tone] || (i === 0 ? 'pro' : i === 1 ? 'warm' : 'mz');
      const check = C.checkReply(r.text, {
        platform: form.platform, industry: form.industry, profile: state.profile, analysis: analysis,
      });
      return {
        id: 'pro-' + (i + 1),
        tone: toneId,
        toneLabel: C.toneById(toneId).label + ' · Pro',
        text: r.text,
        chars: C.countChars(r.text),
        check: check,
      };
    });
  }

  function runPro() {
    if (!PS || !P) { toast('Pro 연결 엔진을 불러오지 못했습니다. 새로고침해 주세요.'); return; }
    if (state.pro.busy) return;
    const form = currentForm();
    if (!form.review.trim()) {
      toast('리뷰를 먼저 붙여넣어 주세요.');
      $('#f-review').focus();
      return;
    }
    if (!PS.connected()) {
      updateProUi();
      toast('무료 모드입니다. Pro API를 연결하면 맞춤 답글 3안을 바로 씁니다.');
      PS.openConnect();
      return;
    }

    setProBusy(true);
    const stateEl = $('#proState');
    if (stateEl) stateEl.textContent = 'Pro AI가 리뷰를 읽고 답글 3안을 쓰는 중… (보통 10~30초) 창을 닫지 마세요.';

    PS.run('reviewReply', proInput()).then(function (res) {
      setProBusy(false);
      if (!res.ok) {
        updateProUi();
        if (stateEl) stateEl.textContent = res.message;
        toast(res.message);
        return;
      }
      const cards = proReplyCards(res.data || {});
      if (!cards.length) {
        updateProUi();
        toast('응답에 답글이 비어 있습니다. 다시 시도해 주세요.');
        return;
      }
      const base = C.generateReplies({
        review: form.review, rating: form.rating, situation: state.situation, tone: form.tone,
        platform: form.platform, industry: form.industry, profile: state.profile,
        compare: form.compare, period: form.period, noticeType: form.noticeType, seed: state.seed,
      });
      state.replies = cards;
      state.lastReview = form.review;
      state.meta = base;

      const list = $('#reply-list');
      list.innerHTML = '';
      state.replies.forEach(function (r, i) { list.appendChild(replyCard(r, i)); });
      $('#reply-title').textContent = 'Pro · ' + base.situation.label + ' 답글 ' + state.replies.length + '개';
      $('#reply-meta').innerHTML = ['Pro AI가 리뷰에 적힌 내용만 인정하고 쓴 답글입니다.',
        C.platformById(form.platform).short].join(' <span class="dot">·</span> ');
      $('#btn-copy-all').disabled = false;
      renderQuality();
      updateTopAction();
      updateProUi();
      state.pro.meta = PS.describe(res);
      state.pro.note = String((res.data && res.data.privateNote) || '').trim();
      proNote(state.pro.note ? '내부 메모 (공개 답글에 쓰지 마세요): ' + state.pro.note : '');
      if (stateEl) stateEl.textContent = state.pro.meta + ' · 답글 ' + state.replies.length + '안을 점검기로 다시 확인했습니다.';
      saveStore(true);
      toast('Pro 맞춤 답글 ' + state.replies.length + '안을 만들었습니다. 점검 결과를 확인하세요.');
    });
  }

  /* 연결 버튼·모달은 처음 눌렀을 때 만든다. */
  function hookProConnect() {
    const btn = $('#proConnect');
    if (!btn || btn.getAttribute('data-pro-hooked') === '1') return;
    btn.setAttribute('data-pro-hooked', '1');
    btn.addEventListener('click', function (e) {
      e.preventDefault();
      if (P && typeof P.mountModal === 'function') P.mountModal(btn);
      PS.openConnect();
    });
  }

  function initPro() {
    if (FREE) {
      FREE.configure({ app: 'review-reply-studio' });
      const fb = $('#freeBadge');
      if (fb) FREE.mountBadge(fb);
    }
    const freeBtn = $('#btn-free-replies');
    if (freeBtn) freeBtn.addEventListener('click', runFreeReplies);
    if (!PS) return;
    PS.badge('#proBadge');
    hookProConnect();
    if ($('#btn-pro-replies')) $('#btn-pro-replies').addEventListener('click', runPro);
    PS.onConnectChange(function () { updateProUi(); });
    updateProUi();
  }

  function importAI(text) {
    const blocks = C.parseAIReply(text);
    if (!blocks.length) { toast('가져올 답글이 없습니다. 빈 줄로 구분해 붙여넣어 주세요.'); return; }
    const form = currentForm();
    const analysis = C.analyzeReview(form.review || '', { rating: form.rating });
    state.replies = blocks.slice(0, 3).map(function (b, i) {
      const check = C.checkReply(b, {
        platform: form.platform, industry: form.industry, profile: state.profile, analysis: analysis,
      });
      return { id: 'ai-' + (i + 1), tone: 'ai', toneLabel: '가져온 답글 ' + (i + 1), text: b, check: check };
    });
    state.meta = { situation: C.pickSituation(analysis, { situation: state.situation }), analysis: analysis, meta: { platform: form.platform } };
    const list = $('#reply-list');
    list.innerHTML = '';
    state.replies.forEach(function (r, i) { list.appendChild(replyCard(r, i)); });
    $('#reply-title').textContent = 'AI에게 받은 답글 ' + state.replies.length + '개';
    $('#reply-meta').textContent = '내 구독 AI가 만든 답글입니다. 이 앱의 점검기를 다시 통과시켰습니다.';
    $('#btn-copy-all').disabled = false;
    renderQuality();
    updateTopAction();
    setTab('write');
    toast('답글 카드로 가져왔습니다. 표현 점검을 확인하세요.');
  }

  /* ── 이벤트 ───────────────────────────────────────────── */
  function wire() {
    $$('.tab').forEach(function (t) {
      t.addEventListener('click', function () { setTab(t.getAttribute('data-tab')); });
    });
    $$('[data-tab-link]').forEach(function (el) {
      el.addEventListener('click', function (e) { e.preventDefault(); setTab(el.getAttribute('data-tab-link')); });
    });

    $('#btn-theme').addEventListener('click', function () {
      const dark = document.documentElement.getAttribute('data-theme') === 'dark';
      document.documentElement.setAttribute('data-theme', dark ? 'light' : 'dark');
      $('#btn-theme').setAttribute('aria-label', dark ? '다크 모드로 전환' : '라이트 모드로 전환');
      saveStore();
    });

    /* 작성 */
    $('#f-review').addEventListener('input', function () {
      updateDetect();
      saveStore();
    });
    $('#f-rating').addEventListener('change', function () { updateDetect(); saveStore(); });
    $('#f-review').addEventListener('input', function () { state.seed = 0; });
    $('#btn-sample').addEventListener('click', function () {
      const sitId = state.situation === 'auto' ? 'praise' : state.situation;
      const s = C.data.SAMPLES[sitId] || C.data.SAMPLES.praise;
      $('#f-review').value = s.text;
      $('#f-rating').value = String(s.rating || 0);
      if (!state.profile.name) {
        state.profile = C.normalizeProfile(C.data.STORE_SAMPLE);
        profileToForm();
        $('#f-industry').value = state.profile.industry;
        $('#f-platform').value = state.profile.platform;
        $('#tone-cards input[value="' + state.profile.tone + '"]').checked = true;
        syncToneCards();
      }
      updateDetect();
      toast('예시 리뷰와 가상 매장(오늘식당)을 넣었습니다.');
    });
    $('#btn-clear-review').addEventListener('click', function () {
      $('#f-review').value = '';
      $('#f-rating').value = '0';
      updateDetect();
      $('#f-review').focus();
    });
    $('#situation-chips').addEventListener('click', function (e) {
      const btn = e.target.closest('[data-sit]');
      if (!btn) return;
      state.situation = btn.getAttribute('data-sit');
      $$('.chip', $('#situation-chips')).forEach(function (c) {
        const on = c === btn;
        c.classList.toggle('is-active', on);
        c.setAttribute('aria-checked', on ? 'true' : 'false');
      });
      $('#notice-fields').hidden = state.situation !== 'notice';
      if (state.situation === 'notice') {
        $('#f-notice-type').value = C.inferNoticeType($('#f-review').value);
      }
      updateDetect();
      saveStore();
    });
    $('#f-notice-type').addEventListener('change', function () { saveStore(); });
    $('#f-period').addEventListener('input', saveStore);
    $$('#tone-cards input').forEach(function (r) {
      r.addEventListener('change', function () { state.tone = r.value; syncToneCards(); saveStore(); });
    });
    $('#f-compare').addEventListener('change', function () {
      state.compare = $('#f-compare').checked;
      $('#f-compare-btn').setAttribute('aria-pressed', state.compare ? 'true' : 'false');
      $('#f-compare-btn').textContent = state.compare ? '비교 끄기' : '3말투 비교';
      saveStore();
    });
    $('#f-compare-btn').addEventListener('click', function () {
      $('#f-compare').checked = !$('#f-compare').checked;
      $('#f-compare').dispatchEvent(new Event('change'));
    });
    $('#f-industry').addEventListener('change', function () { state.industry = $('#f-industry').value; updateMeter(); saveStore(); });
    $('#f-platform').addEventListener('change', function () { state.platform = $('#f-platform').value; saveStore(); });

    $('#write-form').addEventListener('submit', function (e) { e.preventDefault(); generate(); });

    /* 답글 카드 위임 */
    $('#reply-list').addEventListener('click', function (e) {
      const copyBtn = e.target.closest('[data-copy]');
      if (copyBtn) {
        const r = state.replies.find(function (x) { return x.id === copyBtn.getAttribute('data-copy'); });
        if (r) copyText(r.text, copyBtn, '답글을 복사했습니다.');
        return;
      }
      const fixBtn = e.target.closest('[data-autofix]');
      if (fixBtn) {
        const r = state.replies.find(function (x) { return x.id === fixBtn.getAttribute('data-autofix'); });
        if (!r) return;
        const fixed = C.autoFix(r.text);
        const card = fixBtn.closest('.reply-card');
        const ta = $('textarea', card);
        r.text = fixed.text;
        ta.value = fixed.text;
        autoGrow(ta);
        recheckCard(card, r);
        toast(fixed.applied.length ? '표현 ' + fixed.applied.length + '곳을 안전하게 바꿨습니다.' : '바꿀 표현이 없습니다.');
      }
    });
    $('#btn-copy-all').addEventListener('click', copyAllReplies);
    $('#btn-again').addEventListener('click', function () {
      if (!state.replies.length) { toast('먼저 답글을 만들어 주세요.'); return; }
      state.seed += 1;
      generate();
    });
    $('#top-primary').addEventListener('click', function () {
      if (state.tab === 'bulk') {
        if (state.bulkEntries.length) copyText(C.formatBulkResult(state.bulkEntries), $('#top-primary'), '답글 ' + state.bulkEntries.length + '개를 복사했습니다.');
        return;
      }
      if (state.tab === 'claim') {
        if (state.claim) copyText(state.claim.body, $('#top-primary'), '사유서를 복사했습니다.');
        return;
      }
      if (state.replies.length) { copyText(state.replies[0].text, $('#top-primary'), '첫 번째 답글을 복사했습니다.'); return; }
      setTab('write');
      if (!$('#f-review').value.trim()) { $('#f-review').focus(); toast('리뷰를 먼저 붙여넣어 주세요.'); return; }
      generate();
      const first = $('.reply-card');
      if (first) first.scrollIntoView({ block: 'start', behavior: 'smooth' });
    });

    /* 일괄 */
    $('#bulk-input').addEventListener('input', function () {
      $('#bulk-chars').textContent = C.countChars($('#bulk-input').value) + '자';
    });
    $('#btn-bulk-sample').addEventListener('click', function () {
      $('#bulk-input').value = C.data.BULK_SAMPLE;
      $('#bulk-chars').textContent = C.countChars(C.data.BULK_SAMPLE) + '자';
      parseBulkInput();
    });
    $('#btn-bulk-parse').addEventListener('click', parseBulkInput);
    $('#btn-bulk-generate').addEventListener('click', bulkGenerateAll);
    $('#bulk-list').addEventListener('click', function (e) {
      const one = e.target.closest('[data-bulk-one]');
      if (one) {
        const item = state.bulkItems.find(function (i) { return i.id === one.getAttribute('data-bulk-one'); });
        if (!item) return;
        item.situation = $('select[data-sit-for="' + item.id + '"]').value;
        bulkGenerateOne(item);
        renderBulk();
        toast('이 리뷰의 답글을 만들었습니다.');
        return;
      }
      const copy = e.target.closest('[data-bulk-copy]');
      if (copy) {
        const entry = state.bulkEntries.find(function (x) { return x.id === copy.getAttribute('data-bulk-copy'); });
        if (entry) copyText(entry.reply, copy, '이 답글을 복사했습니다.');
      }
    });
    $('#bulk-list').addEventListener('change', function (e) {
      const sel = e.target.closest('[data-sit-for]');
      if (!sel) return;
      const item = state.bulkItems.find(function (i) { return i.id === sel.getAttribute('data-sit-for'); });
      if (item) item.situation = sel.value;
    });
    $('#bulk-list').addEventListener('input', function (e) {
      const ta = e.target.closest('[data-reply-for]');
      if (!ta) return;
      const entry = state.bulkEntries.find(function (x) { return x.id === ta.getAttribute('data-reply-for'); });
      if (entry) {
        entry.reply = ta.value;
        entry.check = C.checkReply(ta.value, { platform: $('#bulk-platform').value, industry: $('#bulk-industry').value, profile: state.profile });
        const foot = ta.closest('.bulk-item').querySelector('.bulk-score');
        if (foot) foot.textContent = entry.check.score + '/100 · ' + entry.check.grade.id;
      }
    });
    $('#btn-bulk-copy').addEventListener('click', function () {
      const text = C.formatBulkResult(state.bulkEntries);
      copyText(text, $('#btn-bulk-copy'), '답글 ' + state.bulkEntries.length + '개를 복사했습니다.');
    });
    $('#btn-bulk-txt').addEventListener('click', function () {
      download('review-replies.txt', C.formatBulkResult(state.bulkEntries));
      toast('TXT로 저장했습니다.');
    });
    $('#btn-bulk-csv').addEventListener('click', function () {
      download('review-replies.csv', C.bulkCsv(state.bulkEntries), 'text/csv');
      toast('CSV로 저장했습니다. 엑셀에서 바로 열립니다.');
    });

    /* 소명서 */
    $('#btn-claim-sample').addEventListener('click', fillClaimSample);
    $('#btn-claim-generate').addEventListener('click', generateClaim);
    $('#btn-claim-copy').addEventListener('click', function () {
      if (state.claim) copyText(state.claim.body, $('#btn-claim-copy'), '사유서를 복사했습니다.');
    });
    $('#btn-claim-summary-copy').addEventListener('click', function () {
      if (state.claim) copyText(state.claim.summary, null, '요약을 복사했습니다.');
    });
    $('#btn-claim-txt').addEventListener('click', function () {
      if (state.claim) { download('review-report.txt', state.claim.body); toast('TXT로 저장했습니다.'); }
    });

    /* 브리지 */
    $('#btn-bridge-build').addEventListener('click', function () { refreshBridge(); toast('지금 리뷰로 프롬프트를 다시 만들었습니다.'); });
    $('#btn-bridge-copy').addEventListener('click', function () {
      refreshBridge();
      copyText(state.bridgePrompt, $('#btn-bridge-copy'), '프롬프트를 복사했습니다. AI 창에 붙여넣으세요.');
    });
    $$('[data-open-ai]').forEach(function (btn) {
      btn.addEventListener('click', function () {
        const which = btn.getAttribute('data-open-ai');
        const urls = { chatgpt: 'https://chatgpt.com/', claude: 'https://claude.ai/new', gemini: 'https://gemini.google.com/app' };
        refreshBridge();
        copyText(state.bridgePrompt, null, '프롬프트를 복사했습니다. 새 창에 붙여넣으세요.');
        window.open(urls[which], '_blank', 'noopener');
      });
    });
    ['#br-count', '#br-emoji', '#br-extra'].forEach(function (sel) {
      $(sel).addEventListener('change', refreshBridge);
    });
    $('#btn-gem-run').addEventListener('click', runGemini);
    $('#gem-key').addEventListener('keydown', function (e) { if (e.key === 'Enter') { e.preventDefault(); runGemini(); } });
    $('#btn-gem-import').addEventListener('click', function () { if (state.gemText) importAI(state.gemText); });
    $('#btn-ai-import').addEventListener('click', function () {
      const text = $('#ai-paste').value;
      if (!text.trim()) { toast('AI가 준 답글을 먼저 붙여넣어 주세요.'); return; }
      importAI(text);
    });

    /* 매장 */
    ['#s-name', '#s-signature', '#s-parking', '#s-parking-note', '#s-phone', '#s-hours', '#s-story', '#s-benefit', '#s-tone', '#s-platform'].forEach(function (sel) {
      $(sel).addEventListener('input', function () {
        formToProfile();
        updateMeter();
        saveStore();
      });
      $(sel).addEventListener('change', function () {
        formToProfile();
        updateMeter();
        saveStore();
      });
    });
    $('#s-industry').addEventListener('change', function () {
      formToProfile();
      $('#s-signature-label').textContent = C.industryById(state.profile.industry).signatureLabel;
      profileToForm();
      saveStore();
    });
    $('#s-benefit-on').addEventListener('change', function () {
      formToProfile();
      saveStore();
    });
    $('#btn-store-save').addEventListener('click', function () {
      formToProfile();
      saveStore(true);
      $('#store-status').textContent = '저장했습니다. 답글 작성 화면에 바로 반영됩니다.';
      updateMeter();
      toast('매장 정보를 저장했습니다.');
    });
    $('#btn-store-sample').addEventListener('click', function () {
      state.profile = C.normalizeProfile(C.data.STORE_SAMPLE);
      profileToForm();
      saveStore(true);
      toast('가상 매장(오늘식당)을 넣었습니다. 실제 정보로 바꿔 주세요.');
    });
    $('#btn-store-reset').addEventListener('click', function () {
      if (!window.confirm('매장 정보를 비울까요? 이 브라우저에 저장된 내용만 지웁니다.')) return;
      state.profile = C.normalizeProfile({});
      profileToForm();
      saveStore(true);
      toast('매장 정보를 비웠습니다.');
    });
  }

  function syncToneCards() {
    $$('.tone-card').forEach(function (card) {
      const input = $('input', card);
      card.classList.toggle('is-active', input.checked);
    });
  }

  function copyAllReplies() {
    if (!state.replies.length) { toast('먼저 답글을 만들어 주세요.'); return; }
    const store = state.profile.name || '우리 가게';
    const head = '[' + store + '] 리뷰 답글 ' + state.replies.length + '안';
    const body = state.replies.map(function (r, i) { return (i + 1) + '. ' + r.text; }).join('\n\n');
    copyText(head + '\n\n' + body, $('#btn-copy-all'), '답글 ' + state.replies.length + '개를 복사했습니다.');
  }

  /* ── 시작 ─────────────────────────────────────────────── */
  function boot() {
    applyDesignTokens();
    const saved = loadStore();
    if (saved && saved.profile) state.profile = C.normalizeProfile(saved.profile);
    else state.profile = C.normalizeProfile({});

    const theme = (saved && saved.theme) || (window.matchMedia && window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light');
    document.documentElement.setAttribute('data-theme', theme);
    $('#btn-theme').setAttribute('aria-label', theme === 'dark' ? '라이트 모드로 전환' : '다크 모드로 전환');

    state.industry = state.profile.industry;
    state.platform = state.profile.platform;
    state.tone = state.profile.tone;
    fillSelects();
    buildViolationChecks();
    profileToForm();
    $('#c-store').value = state.profile.name;
    $('#c-contact').value = state.profile.phone;

    if (saved && saved.form) {
      $('#f-review').value = saved.form.review || '';
      $('#f-rating').value = saved.form.rating || '0';
      state.situation = saved.form.situation || 'auto';
      state.compare = !!saved.form.compare;
      $('#f-compare').checked = state.compare;
      if (saved.form.noticeType) $('#f-notice-type').value = saved.form.noticeType;
      $('#f-period').value = saved.form.period || '';
      if (saved.form.industry) { state.industry = saved.form.industry; $('#f-industry').value = state.industry; }
      if (saved.form.platform) { state.platform = saved.form.platform; $('#f-platform').value = state.platform; }
      if (saved.form.tone) {
        state.tone = saved.form.tone;
        const radio = $('#tone-cards input[value="' + state.tone + '"]');
        if (radio) radio.checked = true;
      }
      $$('.chip', $('#situation-chips')).forEach(function (c) {
        const on = c.getAttribute('data-sit') === state.situation;
        c.classList.toggle('is-active', on);
        c.setAttribute('aria-checked', on ? 'true' : 'false');
      });
      $('#notice-fields').hidden = state.situation !== 'notice';
      $('#f-compare-btn').setAttribute('aria-pressed', state.compare ? 'true' : 'false');
      $('#f-compare-btn').textContent = state.compare ? '비교 끄기' : '3말투 비교';
    }
    syncToneCards();
    updateDetect();
    $('#bulk-count').textContent = '0개';
    $('#bulk-ready').textContent = '0개';
    $('#save-state').textContent = saved ? '자동 저장됨' : '이 브라우저에만 저장';
    wire();
    initPro();
    refreshBridge();
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', boot);
  else boot();
})();
