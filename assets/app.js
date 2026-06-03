/* Gallery — vanilla JS, no deps */
(() => {
  'use strict';

  // ─── config ──────────────────────────────────────────────
  // 호스팅 위치만 바꾸려면 여기 두 줄 수정.
  const IMG_BASE   = './images';
  const THUMB_BASE = './thumbs';
  const MANIFEST   = './manifest.json';

  // ─── state ───────────────────────────────────────────────
  let items = [];       // [{id, char, folder, cat, sit}, ...]
  let chars = {};       // { char1: { name: '선유훈' }, ... }
  let filtered = [];
  let filterChar = '';
  let filterFolder = '';
  let filterQuery = '';
  let lbIdx = -1;

  // ─── dom ─────────────────────────────────────────────────
  const $  = (s, el = document) => el.querySelector(s);
  const $$ = (s, el = document) => [...el.querySelectorAll(s)];

  const grid     = $('#grid');
  const searchEl = $('#search');
  const clearBtn = $('#clear');
  const countEl  = $('#count');
  const emptyEl  = $('#empty');
  const setupEl  = $('#setup');
  const lightbox = $('#lightbox');
  const lbImg    = $('#lbImg');
  const lbInfo   = $('#lbInfo');

  // ─── init ────────────────────────────────────────────────
  async function init() {
    try {
      const res = await fetch(MANIFEST, { cache: 'no-cache' });
      if (!res.ok) throw new Error('no manifest');
      const data = await res.json();
      items = Array.isArray(data) ? data : (data.items || []);
      chars = (data && data.characters) || {};
    } catch (e) {
      console.warn('manifest.json 로드 실패:', e);
      setupEl.hidden = false;
      return;
    }
    bind();
    apply();
  }

  // ─── events ──────────────────────────────────────────────
  function bind() {
    searchEl.addEventListener('input', () => {
      filterQuery = searchEl.value.trim();
      clearBtn.hidden = !filterQuery;
      apply();
    });
    clearBtn.addEventListener('click', () => {
      searchEl.value = '';
      filterQuery = '';
      clearBtn.hidden = true;
      searchEl.focus();
      apply();
    });

    $$('[data-char]').forEach(btn => {
      btn.addEventListener('click', () => {
        filterChar = btn.dataset.char;
        $$('[data-char]').forEach(b => b.classList.toggle('is-active', b === btn));
        apply();
      });
    });
    $$('[data-folder]').forEach(btn => {
      btn.addEventListener('click', () => {
        filterFolder = btn.dataset.folder;
        $$('[data-folder]').forEach(b => b.classList.toggle('is-active', b === btn));
        apply();
      });
    });

    // lightbox controls
    $('#lbClose').addEventListener('click', closeLb);
    $('#lbPrev').addEventListener('click', () => navLb(-1));
    $('#lbNext').addEventListener('click', () => navLb(1));
    lightbox.addEventListener('click', (e) => {
      if (e.target === lightbox || e.target.id === 'lbStage') closeLb();
    });
    document.addEventListener('keydown', (e) => {
      if (lightbox.hidden) return;
      if (e.key === 'Escape')     closeLb();
      else if (e.key === 'ArrowLeft')  navLb(-1);
      else if (e.key === 'ArrowRight') navLb(1);
    });

    // touch swipe
    let tx = 0, ty = 0, moved = false;
    lightbox.addEventListener('touchstart', (e) => {
      if (e.touches.length !== 1) return;
      tx = e.touches[0].clientX;
      ty = e.touches[0].clientY;
      moved = false;
    }, { passive: true });
    lightbox.addEventListener('touchend', (e) => {
      if (e.changedTouches.length !== 1) return;
      const dx = e.changedTouches[0].clientX - tx;
      const dy = e.changedTouches[0].clientY - ty;
      if (Math.abs(dx) > 60 && Math.abs(dx) > Math.abs(dy)) {
        navLb(dx < 0 ? 1 : -1);
      }
    }, { passive: true });
  }

  // ─── filter ──────────────────────────────────────────────
  function tokenize(q) {
    return q.toLowerCase().split(/[\s_·,]+/).filter(Boolean);
  }

  function matchItem(item, tokens) {
    if (tokens.length === 0) return true;
    const charName = (chars[item.char]?.name || item.char).toLowerCase();
    const folderLabel = item.folder === 'common' ? '공통' : item.folder.toLowerCase();
    const cat = String(item.cat).toLowerCase();
    const sit = parseInt(item.sit, 10);

    return tokens.every(tok => {
      // A_01 / a01 (combined)
      const comb = /^([a-l])(\d{1,2})$/i.exec(tok);
      if (comb) {
        return cat === comb[1].toLowerCase() && sit === parseInt(comb[2], 10);
      }
      // single letter category
      if (/^[a-l]$/i.test(tok) && cat === tok) return true;
      // pure digits → situation
      if (/^\d{1,2}$/.test(tok) && sit === parseInt(tok, 10)) return true;
      // character name (substring)
      if (charName.includes(tok)) return true;
      // folder
      if (folderLabel.includes(tok) || item.folder.toLowerCase().includes(tok)) return true;
      return false;
    });
  }

  function apply() {
    const tokens = tokenize(filterQuery);
    filtered = items.filter(it => {
      if (filterChar   && it.char   !== filterChar)   return false;
      if (filterFolder && it.folder !== filterFolder) return false;
      return matchItem(it, tokens);
    });
    render();
  }

  // ─── render ──────────────────────────────────────────────
  function render() {
    countEl.textContent = items.length
      ? `${filtered.length.toString().padStart(3, '0')} / ${items.length}`
      : '';
    emptyEl.hidden = filtered.length !== 0;

    const frag = document.createDocumentFragment();
    for (let i = 0; i < filtered.length; i++) {
      const it = filtered[i];
      const btn = document.createElement('button');
      btn.type = 'button';
      btn.className = 'tile';
      btn.dataset.idx = i;
      const charLabel = chars[it.char]?.name || it.char;
      const folderLabel = it.folder === 'common' ? '공통' : it.folder;
      btn.setAttribute('aria-label', `${charLabel} ${folderLabel} ${it.cat}_${it.sit}`);

      const img = document.createElement('img');
      img.loading = 'lazy';
      img.decoding = 'async';
      img.src = `${THUMB_BASE}/${it.id}.jpg`;
      img.alt = '';
      img.addEventListener('load', () => img.classList.add('is-loaded'));
      img.addEventListener('error', () => {
        // 썸네일 없으면 원본으로 폴백
        if (!img.dataset.fallback) {
          img.dataset.fallback = '1';
          img.src = `${IMG_BASE}/${it.id}.jpg`;
        }
      });

      btn.appendChild(img);
      btn.addEventListener('click', () => openLb(i));
      frag.appendChild(btn);
    }
    grid.replaceChildren(frag);
  }

  // ─── lightbox ────────────────────────────────────────────
  function openLb(idx) {
    lbIdx = idx;
    showLb();
    lightbox.hidden = false;
    document.body.style.overflow = 'hidden';
  }

  function showLb() {
    const it = filtered[lbIdx];
    if (!it) return;
    lbImg.src = `${IMG_BASE}/${it.id}.jpg`;
    const charLabel = chars[it.char]?.name || it.char;
    const folderLabel = it.folder === 'common' ? '공통' : it.folder;
    lbInfo.textContent = `${charLabel} · ${folderLabel} · ${it.cat}_${it.sit}`;

    // 인접 이미지 프리로드
    [-1, 1].forEach(d => {
      const n = filtered[(lbIdx + d + filtered.length) % filtered.length];
      if (n) { const p = new Image(); p.src = `${IMG_BASE}/${n.id}.jpg`; }
    });
  }

  function navLb(dir) {
    if (!filtered.length) return;
    lbIdx = (lbIdx + dir + filtered.length) % filtered.length;
    showLb();
  }

  function closeLb() {
    lightbox.hidden = true;
    document.body.style.overflow = '';
    lbImg.src = '';
  }

  // ─── go ──────────────────────────────────────────────────
  init();
})();
