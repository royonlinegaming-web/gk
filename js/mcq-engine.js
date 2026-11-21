/* ==========================================================================
   REUSABLE MCQ APPLICATION ENGINE
   Requires a chapter data file (setting window.MCQ_CHAPTER_DATA) loaded first.
   ========================================================================== */
(() => {
  'use strict';

  const CHAPTER_DATA = window.MCQ_CHAPTER_DATA || {};
  const CATEGORY_META = CHAPTER_DATA.categoryMeta || {};
  const QUESTIONS_DATA = Array.isArray(CHAPTER_DATA.questions) ? CHAPTER_DATA.questions : [];

  if (!QUESTIONS_DATA.length) {
    console.warn('MCQ Engine: No questions found in window.MCQ_CHAPTER_DATA. Ensure the chapter notes JS file is loaded before mcq-engine.js.');
  }

  /* ----------------------------------------------------------------------
     A. CUSTOM INLINE SVG ICONS (BULLSEYE DART FOR NOTES & DIAMOND FOR MORE INFO)
     ---------------------------------------------------------------------- */
  const NOTES_TARGET_SVG = `
    <svg class="notes-target-icon" width="19" height="19" viewBox="0 0 24 24" fill="none" aria-hidden="true">
      <path d="M20.56 9.22 A9 9 0 1 1 14.78 3.44" stroke="currentColor" stroke-width="2.4" stroke-linecap="round"/>
      <path d="M16.42 10.73 A4.6 4.6 0 1 1 13.27 7.58" stroke="currentColor" stroke-width="2.4" stroke-linecap="round"/>
      <line x1="12" y1="12" x2="20.4" y2="3.6" stroke="currentColor" stroke-width="2.3" stroke-linecap="round"/>
      <path d="M16.5 7.5 L17.5 4.2 L20.7 1.0 L21.1 3.7 L23.8 4.1 L20.6 7.3 L17.3 8.3 Z" fill="currentColor"/>
    </svg>
  `;

  const MORE_INFO_DIAMOND_SVG = `
    <svg class="more-info-diamond-icon" width="18" height="18" viewBox="0 0 32 32" fill="none" aria-hidden="true">
      <rect x="6.2" y="6.2" width="19.6" height="19.6" rx="5.2" transform="rotate(45 16 16)" stroke="currentColor" stroke-opacity="0.42" stroke-width="2.1"/>
      <rect x="9.6" y="9.6" width="12.8" height="12.8" rx="3.4" transform="rotate(45 16 16)" fill="currentColor" fill-opacity="0.16" stroke="currentColor" stroke-width="2.3"/>
      <rect x="13.2" y="13.2" width="5.6" height="5.6" rx="0.6" transform="rotate(45 16 16)" fill="currentColor"/>
    </svg>
  `;

  const getCategoryMeta = cat => CATEGORY_META[cat] || {
    icon: "fa-bookmark",
    navClass: "nav-color-indigo",
    badgeClass: "",
    dotVar: "var(--accent)"
  };

  /* ----------------------------------------------------------------------
     B. CONFIGURATION & SAFE STORAGE LAYER
     ---------------------------------------------------------------------- */
  const CONFIG = {
    CATEGORY: { ALL: 'ALL', PYQ: 'PYQ' },
    CATEGORY_LABELS: {
      ALL: 'সকল প্রশ্ন',
      PYQ: 'বিগত বছরের প্রশ্নাবলী (PYQ)'
    },
    STORAGE: {
      THEME: 'bn_mcq_theme',
      ANSWERS: CHAPTER_DATA.storageKey || 'bn_mcq_answers_v1',
      FONT_SIZE: 'bn_mcq_fontsize',
      LINE_SPACE: 'bn_mcq_linegap'
    },
    FONT: { DEFAULT: 14, MIN: 10, MAX: 18, STEP: 0.5 },
    OPTION_KEYS: ['A', 'B', 'C', 'D']
  };

  const Store = {
    get(key, fallback = null) {
      try {
        const val = localStorage.getItem(key);
        return val !== null ? val : fallback;
      } catch {
        return fallback;
      }
    },
    set(key, val) {
      try {
        localStorage.setItem(key, val);
      } catch {}
    },
    getJson(key, fallback = {}) {
      try {
        const raw = localStorage.getItem(key);
        const parsed = raw ? JSON.parse(raw) : null;
        return parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? parsed : fallback;
      } catch {
        return fallback;
      }
    },
    setJson(key, obj) {
      this.set(key, JSON.stringify(obj));
    }
  };

  /* ----------------------------------------------------------------------
     C. XSS-SAFE RICH PARSER & SAFE DOM TREEWALKER HIGHLIGHTER
     ---------------------------------------------------------------------- */
  const RichParser = {
    ALLOWED_TAGS: new Set([
      'STRONG', 'B', 'EM', 'I', 'U', 'BR', 'P', 'UL', 'OL', 'LI',
      'TABLE', 'THEAD', 'TBODY', 'TR', 'TH', 'TD', 'SPAN', 'DIV', 'MARK'
    ]),

    sanitize(html) {
      const tpl = document.createElement('template');
      tpl.innerHTML = String(html || '');

      const walk = node => {
        for (const child of Array.from(node.childNodes)) {
          if (child.nodeType === Node.ELEMENT_NODE) {
            if (!this.ALLOWED_TAGS.has(child.tagName)) {
              const text = document.createTextNode(child.textContent || '');
              node.replaceChild(text, child);
              continue;
            }
            for (const attr of Array.from(child.attributes)) {
              if (attr.name !== 'class' && attr.name !== 'colspan' && attr.name !== 'rowspan') {
                child.removeAttribute(attr.name);
              }
            }
            walk(child);
          }
        }
      };

      walk(tpl.content);
      return tpl.innerHTML;
    },

    escapeHtml(str) {
      return String(str || '')
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;');
    },

    escapeRegex(str) {
      return String(str || '').replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    },

    highlightText(text, query) {
      const raw = String(text || '');
      const q = String(query || '').trim();
      if (!q) return this.escapeHtml(raw);
      const regex = new RegExp(`(${this.escapeRegex(q)})`, 'gi');
      return raw
        .split(regex)
        .map((part, idx) =>
          idx % 2 === 1
            ? `<mark class="search-hl">${this.escapeHtml(part)}</mark>`
            : this.escapeHtml(part)
        )
        .join('');
    },

    /**
     * Safely highlights all case-insensitive occurrences of `query` inside
     * any live DOM subtree using TreeWalker (NodeFilter.SHOW_TEXT), never
     * mutating HTML tags, attributes, tables, or cached explanation HTML.
     */
    highlightDomTree(rootEl, query) {
      if (!rootEl) return;
      const q = String(query || '').trim();
      if (!q) return;

      const regex = new RegExp(this.escapeRegex(q), 'gi');
      const textNodes = [];

      const walker = document.createTreeWalker(rootEl, NodeFilter.SHOW_TEXT, {
        acceptNode(node) {
          if (!node.nodeValue || !node.nodeValue.trim()) return NodeFilter.FILTER_REJECT;
          const parent = node.parentElement;
          if (!parent) return NodeFilter.FILTER_REJECT;
          if (parent.closest('mark, script, style, button, svg')) return NodeFilter.FILTER_REJECT;
          return NodeFilter.FILTER_ACCEPT;
        }
      });

      let currentNode;
      while ((currentNode = walker.nextNode())) {
        regex.lastIndex = 0;
        if (regex.test(currentNode.nodeValue)) {
          textNodes.push(currentNode);
        }
      }

      textNodes.forEach(node => {
        const text = node.nodeValue;
        const frag = document.createDocumentFragment();
        let lastIndex = 0;
        regex.lastIndex = 0;
        let match;

        while ((match = regex.exec(text)) !== null) {
          if (match[0].length === 0) {
            regex.lastIndex++;
            continue;
          }
          if (match.index > lastIndex) {
            frag.appendChild(document.createTextNode(text.slice(lastIndex, match.index)));
          }
          const mark = document.createElement('mark');
          mark.className = 'search-hl';
          mark.textContent = match[0];
          frag.appendChild(mark);
          lastIndex = regex.lastIndex;
        }

        if (lastIndex < text.length) {
          frag.appendChild(document.createTextNode(text.slice(lastIndex)));
        }

        if (node.parentNode) {
          node.parentNode.replaceChild(frag, node);
        }
      });
    },

    stripHtml(html) {
      return String(html || '').replace(/<[^>]*>/g, ' ').replace(/\s+/g, ' ').trim();
    },

    wrapTable(tableHtml) {
      return `<div class="rich-content-table-wrap custom-scroll">${tableHtml}</div>`;
    },

    parseMarkdownTable(lines) {
      const splitRow = row => row.trim().replace(/^\||\|$/g, '').split('|').map(c => c.trim());
      const isSeparator = row => /^\|?\s*:?-{3,}:?\s*(\|\s*:?-{3,}:?\s*)+\|?$/.test(row.trim());

      const headers = splitRow(lines[0]);
      const bodyStart = lines.length > 1 && isSeparator(lines[1]) ? 2 : 1;
      const rows = lines.slice(bodyStart).map(splitRow);

      const thead = `<thead><tr>${headers.map(h => `<th>${h}</th>`).join('')}</tr></thead>`;
      const tbody = rows.length
        ? `<tbody>${rows.map(cols => {
            const cells = headers.map((_, i) => `<td>${cols[i] ?? ''}</td>`).join('');
            return `<tr>${cells}</tr>`;
          }).join('')}</tbody>`
        : '';

      return this.wrapTable(`<table>${thead}${tbody}</table>`);
    },

    parse(input) {
      if (!input) return '';
      const raw = Array.isArray(input)
        ? input.map(v => String(v || '').trim()).filter(Boolean).join('\n')
        : String(input);
      if (!raw.trim()) return '';

      const htmlTables = [];
      const tokenized = raw.replace(/<table[\s\S]*?<\/table>/gi, match => {
        const token = `__HTML_TABLE_${htmlTables.length}__`;
        htmlTables.push(this.wrapTable(match.trim()));
        return `\n${token}\n`;
      });

      const blocks = [];
      let bullets = [];
      let mdTable = [];

      const flushBullets = () => {
        if (!bullets.length) return;
        blocks.push(`<ul>${bullets.map(item => `<li>${item}</li>`).join('')}</ul>`);
        bullets = [];
      };

      const flushTable = () => {
        if (!mdTable.length) return;
        blocks.push(
          mdTable.length >= 2
            ? this.parseMarkdownTable(mdTable)
            : `<p>${mdTable[0]}</p>`
        );
        mdTable = [];
      };

      for (const line of tokenized.split(/\r?\n/)) {
        const trimmed = line.trim();
        if (!trimmed) {
          flushBullets();
          flushTable();
          continue;
        }

        const tokenMatch = trimmed.match(/^__HTML_TABLE_(\d+)__$/);
        if (tokenMatch) {
          flushBullets();
          flushTable();
          blocks.push(htmlTables[Number(tokenMatch[1])]);
          continue;
        }

        if (trimmed.startsWith('|') && trimmed.endsWith('|') && trimmed.length > 2) {
          flushBullets();
          mdTable.push(trimmed);
          continue;
        }
        flushTable();

        const bulletMatch = trimmed.match(/^[•\-*]\s+(.*)$/);
        if (bulletMatch) {
          bullets.push(bulletMatch[1].trim());
          continue;
        }
        flushBullets();

        if (/^<(ul|ol)\b/i.test(trimmed)) {
          blocks.push(trimmed);
        } else if (/^<(strong|b)\b[^>]*>[^<]+<\/\1>\s*$/i.test(trimmed)) {
          blocks.push(`<p class="rich-subhead">${trimmed}</p>`);
        } else {
          blocks.push(`<p>${trimmed}</p>`);
        }
      }

      flushBullets();
      flushTable();

      return this.sanitize(`<div class="rich-content">${blocks.join('')}</div>`);
    },

    formatOptionDesc(desc) {
      const text = String(desc || '').trim();
      if (!text) return '';
      if (/^<(strong|b)\b/i.test(text)) return this.parse(text);
      return this.parse(text.replace(/^([^:：<]+[:：])/, '<strong>$1</strong>'));
    },

    normalizeMoreInfo(explanation) {
      const raw = explanation?.moreInformation;
      if (!raw) return null;
      if (typeof raw === 'object' && !Array.isArray(raw)) {
        const title = String(raw.title || '').trim();
        const content = raw.content || '';
        return (title || content) ? { title: title || 'More Information:', content } : null;
      }
      return { title: 'More Information:', content: String(raw) };
    }
  };

  /* ----------------------------------------------------------------------
     D. SEARCH INDEXING, APPLICATION STATE & DOM CACHE
     ---------------------------------------------------------------------- */
  const cloneQuestions = () => JSON.parse(JSON.stringify(QUESTIONS_DATA));

  const questionMap = new Map();
  const subCategoryStats = new Map();
  let totalAllCount = 0;
  let totalPyqCount = 0;

  const buildExplainSearchText = q => {
    const correctOpt = q.options[q.correctKey];
    const bannerText = correctOpt ? `সঠিক উত্তর ${q.correctKey} ${correctOpt.bn || ''} ${correctOpt.en || ''}` : '';
    const contextText = RichParser.stripHtml(q.explanation?.context);
    const analysisText = (q.explanation?.optionAnalysis || []).map(i => RichParser.stripHtml(i.desc)).join(' ');
    const notesText = RichParser.stripHtml(q.explanation?.notes);
    const moreObj = RichParser.normalizeMoreInfo(q.explanation);
    const moreText = moreObj ? `${moreObj.title} ${RichParser.stripHtml(moreObj.content)}` : '';
    return `${bannerText} ${contextText} ${analysisText} ${notesText} ${moreText}`.toLowerCase();
  };

  const buildFullSearchIndex = q => {
    const optText = Object.values(q.options).map(o => `${o.bn || ''} ${o.en || ''}`).join(' ');
    const explainText = buildExplainSearchText(q);
    q._explainSearchIndex = explainText;
    return `${q.questionBn} ${q.questionEn || ''} ${optText} ${q.category} ${q.pyqYear || ''} ${explainText}`.toLowerCase();
  };

  QUESTIONS_DATA.forEach(q => {
    const isPyq = Boolean(q.pyqYear);
    totalAllCount++;
    if (isPyq) totalPyqCount++;

    if (!subCategoryStats.has(q.category)) {
      subCategoryStats.set(q.category, { all: 0, pyq: 0 });
    }
    const stat = subCategoryStats.get(q.category);
    stat.all++;
    if (isPyq) stat.pyq++;
  });

  const subCategoriesList = Array.from(subCategoryStats.keys());

  function rebuildQuestionMap(questions) {
    questionMap.clear();
    questions.forEach(q => {
      q._searchIndex = buildFullSearchIndex(q);
      q._cachedExplainHtml = null;
      questionMap.set(q.id, q);
    });
  }

  const initialQuestions = cloneQuestions();
  rebuildQuestionMap(initialQuestions);

  const state = {
    questions: initialQuestions,
    filteredCache: null,
    mainCategory: CONFIG.CATEGORY.ALL,
    subCategory: null,
    searchQuery: '',
    searchMatches: [],
    activeMatchIndex: -1,
    preSearchOpenExplains: null,
    answers: Store.getJson(CONFIG.STORAGE.ANSWERS, {}),
    openExplains: {},
    allExplainsOpen: false,
    theme: Store.get(CONFIG.STORAGE.THEME, 'comfort-night'),
    lineSpace: Store.get(CONFIG.STORAGE.LINE_SPACE, '1.65'),
    fontSize: (() => {
      const val = parseFloat(Store.get(CONFIG.STORAGE.FONT_SIZE, CONFIG.FONT.DEFAULT));
      if (!Number.isNaN(val) && val >= CONFIG.FONT.MIN && val <= CONFIG.FONT.MAX) {
        return Math.round(val * 2) / 2;
      }
      return CONFIG.FONT.DEFAULT;
    })()
  };

  const $ = id => document.getElementById(id);
  const dom = {
    html: document.documentElement,
    srAnnouncer: $('sr-announcer'),
    toast: $('app-toast'),
    toastText: $('app-toast-text'),
    homeBtn: $('home-btn'),
    readingProgressFill: $('reading-progress-fill'),
    searchBarWrapper: $('search-bar-wrapper'),
    searchInputBox: $('search-input-box'),
    searchInput: $('search-input'),
    searchKbdHint: $('search-kbd-hint'),
    searchNavControls: $('search-nav-controls'),
    searchMatchCount: $('search-match-count'),
    searchPrevBtn: $('search-prev-btn'),
    searchNextBtn: $('search-next-btn'),
    searchClearBtn: $('search-clear-btn'),
    btnToggleAllExplains: $('btn-toggle-all-explains'),
    iconToggleAll: $('icon-toggle-all'),
    textToggleAll: $('text-toggle-all'),
    btnShuffle: $('btn-shuffle'),
    menuOpenBtn: $('menu-open-btn'),
    sideDrawer: $('side-drawer'),
    drawerCloseBtn: $('drawer-close-btn'),
    drawerBackdrop: $('drawer-backdrop'),
    drawerTabs: Array.from(document.querySelectorAll('.drawer-tab-btn')),
    panelToc: $('panel-toc'),
    panelPalette: $('panel-palette'),
    categoryFilterContainer: $('category-filter-container'),
    themePills: Array.from(document.querySelectorAll('.theme-pill')),
    themeModeDisplay: $('theme-mode-display'),
    fontSizeSlider: $('font-size-slider'),
    fontSizeDisplay: $('font-size-display'),
    fontDecBtn: $('font-dec-btn'),
    fontIncBtn: $('font-inc-btn'),
    lineSpaceDisplay: $('line-space-display'),
    linePills: Array.from(document.querySelectorAll('.line-pill')),
    btnResetProgress: $('btn-reset-progress'),
    btnResetProgressPalette: $('btn-reset-progress-palette'),
    headerUnansweredBadge: $('header-unanswered-badge'),
    tabUnansweredBadge: $('tab-unanswered-badge'),
    paletteGrid: $('palette-grid'),
    counterPending: $('counter-pending'),
    counterCorrect: $('counter-correct'),
    counterWrong: $('counter-wrong'),
    scoreBarCorrect: $('score-bar-correct'),
    scoreBarWrong: $('score-bar-wrong'),
    scoreBarRest: $('score-bar-rest'),
    filterIndicator: $('filter-indicator'),
    filterIndicatorDot: $('filter-indicator-dot'),
    filterCategoryName: $('filter-category-name'),
    btnShowAllCategories: $('btn-show-all-categories'),
    questionsFeed: $('questions-feed'),
    emptyState: $('empty-state'),
    btnClearFiltersEmpty: $('btn-clear-filters-empty'),
    backToTopBtn: $('back-to-top-btn')
  };

  /* ----------------------------------------------------------------------
     E. UI HELPERS (TOAST, THEME, 0.5px FONT SIZE, LINE SPACE, DRAWER, TABLE FIT)
     ---------------------------------------------------------------------- */
  let toastTimer = null;
  function showToast(message) {
    clearTimeout(toastTimer);
    dom.toastText.textContent = message;
    dom.toast.classList.add('show');
    toastTimer = setTimeout(() => dom.toast.classList.remove('show'), 2200);
  }

  function announce(message) {
    dom.srAnnouncer.textContent = '';
    requestAnimationFrame(() => {
      dom.srAnnouncer.textContent = message;
    });
  }

  /**
   * Ensures every reference table inside `rootEl` fits 100% within its wrapper
   * width without horizontal scrolling and without breaking any word mid-word.
   */
  function fitTablesIn(rootEl = dom.questionsFeed) {
    if (!rootEl) return;
    const wraps = rootEl.querySelectorAll('.rich-content-table-wrap');
    wraps.forEach(wrap => {
      const table = wrap.querySelector('table');
      if (!table) return;

      // Reset prior adjustments so widening viewport or shrinking font restores full size
      table.style.fontSize = '';
      table.classList.remove('table-tight');

      const availW = wrap.clientWidth;
      if (availW <= 0) return;

      let tableW = table.scrollWidth;
      if (tableW <= availW) return;

      // Step 1: Apply compact horizontal padding
      table.classList.add('table-tight');
      tableW = table.scrollWidth;
      if (tableW <= availW) return;

      // Step 2: Proportionally scale down font-size (up to 3 passes, min 8.5px)
      const minFontPx = 8.5;
      for (let pass = 0; pass < 3; pass++) {
        tableW = table.scrollWidth;
        if (tableW <= availW) break;
        const currentPx = parseFloat(window.getComputedStyle(table).fontSize) || 12;
        const scaledPx = Math.max(minFontPx, currentPx * (availW / tableW) * 0.98);
        table.style.fontSize = `${scaledPx.toFixed(2)}px`;
        if (scaledPx <= minFontPx) break;
      }
    });
  }

  const themeLabels = {
    'comfort-night': 'Soft',
    'comfort-day': 'Mist',
    'light': 'Day',
    'dark-night': 'Night'
  };
  const validThemes = ['comfort-night', 'comfort-day', 'light', 'dark-night'];

  function applyTheme(theme) {
    const valid = validThemes.includes(theme) ? theme : 'comfort-night';
    state.theme = valid;
    dom.html.setAttribute('data-theme', valid);
    dom.themeModeDisplay.textContent = themeLabels[valid];
    dom.themePills.forEach(btn => {
      const isSelected = btn.dataset.themeVal === valid;
      btn.classList.toggle('active', isSelected);
      btn.setAttribute('aria-pressed', String(isSelected));
    });
    Store.set(CONFIG.STORAGE.THEME, valid);
  }

  function formatFontSizeLabel(val) {
    return Number.isInteger(val) ? `${val}px` : `${val.toFixed(1)}px`;
  }

  let fontFitTimer = null;
  function applyFontSize(sizePx) {
    const parsed = parseFloat(sizePx);
    const raw = Number.isNaN(parsed) ? CONFIG.FONT.DEFAULT : parsed;
    const snapped = Math.round(raw * 2) / 2;
    const clamped = Math.min(CONFIG.FONT.MAX, Math.max(CONFIG.FONT.MIN, snapped));
    state.fontSize = clamped;
    dom.html.style.fontSize = `${clamped}px`;
    dom.fontSizeSlider.value = String(clamped);
    dom.fontSizeDisplay.textContent = formatFontSizeLabel(clamped);
    dom.fontDecBtn.disabled = clamped <= CONFIG.FONT.MIN;
    dom.fontIncBtn.disabled = clamped >= CONFIG.FONT.MAX;
    Store.set(CONFIG.STORAGE.FONT_SIZE, String(clamped));

    fitTablesIn(dom.questionsFeed);
    clearTimeout(fontFitTimer);
    fontFitTimer = setTimeout(() => fitTablesIn(dom.questionsFeed), 165);
  }

  function applyLineSpace(lh) {
    const validSpaces = ['1.50', '1.65', '1.75', '1.90', '2.00'];
    const val = validSpaces.includes(String(lh)) ? String(lh) : '1.65';
    state.lineSpace = val;
    dom.html.style.setProperty('--reader-line-height', val);
    dom.lineSpaceDisplay.textContent = val;
    dom.linePills.forEach(btn => btn.classList.toggle('active', btn.dataset.lh === val));
    Store.set(CONFIG.STORAGE.LINE_SPACE, val);
  }

  function closeAllDrawers(restoreFocus = false) {
    const wasOpen = dom.sideDrawer.classList.contains('open');
    dom.sideDrawer.classList.remove('open');
    dom.sideDrawer.setAttribute('aria-hidden', 'true');
    dom.menuOpenBtn.setAttribute('aria-expanded', 'false');
    dom.drawerBackdrop.classList.remove('open');
    document.body.style.overflow = '';
    if (restoreFocus && wasOpen) {
      dom.menuOpenBtn.focus();
    }
  }

  function switchDrawerTab(tabName) {
    const isPalette = tabName === 'palette';
    dom.drawerTabs.forEach(btn => {
      const active = btn.dataset.drawerTab === (isPalette ? 'palette' : 'toc');
      btn.classList.toggle('active', active);
      btn.setAttribute('aria-selected', String(active));
    });
    dom.panelToc.hidden = isPalette;
    dom.panelPalette.hidden = !isPalette;
  }

  function openMainDrawer(defaultTab) {
    closeAllDrawers(false);
    if (defaultTab === 'toc' || defaultTab === 'palette') {
      switchDrawerTab(defaultTab);
    }
    dom.sideDrawer.classList.add('open');
    dom.sideDrawer.setAttribute('aria-hidden', 'false');
    dom.menuOpenBtn.setAttribute('aria-expanded', 'true');
    dom.drawerBackdrop.classList.add('open');
    document.body.style.overflow = 'hidden';
    requestAnimationFrame(() => dom.drawerCloseBtn.focus());
  }

  /* ----------------------------------------------------------------------
     F. DEEP SEARCH MATCH COLLECTION & ▲ / ▼ NAVIGATION ENGINE
     ---------------------------------------------------------------------- */
  function updateSearchControlsUi() {
    const hasRawText = dom.searchInput.value.length > 0;
    const hasQuery = state.searchQuery.trim().length > 0;
    const total = state.searchMatches.length;

    dom.searchInputBox.classList.toggle('has-query', hasRawText);
    dom.searchClearBtn.classList.toggle('visible', hasRawText);
    dom.searchKbdHint.classList.toggle('is-hidden', hasRawText);
    dom.searchNavControls.classList.toggle('visible', hasRawText);

    if (hasRawText) {
      dom.searchBarWrapper.classList.remove('search-hidden');
    }

    if (!hasQuery || total === 0) {
      dom.searchMatchCount.textContent = '0/0';
      dom.searchMatchCount.classList.add('is-zero');
      dom.searchPrevBtn.disabled = true;
      dom.searchNextBtn.disabled = true;
    } else {
      const displayIdx = state.activeMatchIndex >= 0 ? state.activeMatchIndex + 1 : 1;
      dom.searchMatchCount.textContent = `${displayIdx}/${total}`;
      dom.searchMatchCount.classList.remove('is-zero');
      dom.searchPrevBtn.disabled = false;
      dom.searchNextBtn.disabled = false;
    }
  }

  function activateSearchMatch(index, shouldScroll = true) {
    const matches = state.searchMatches;
    const total = matches.length;
    if (!total) {
      state.activeMatchIndex = -1;
      updateSearchControlsUi();
      return;
    }

    if (state.activeMatchIndex >= 0 && matches[state.activeMatchIndex]) {
      matches[state.activeMatchIndex].classList.remove('active-match');
    }

    const wrappedIdx = ((index % total) + total) % total;
    state.activeMatchIndex = wrappedIdx;
    const targetEl = matches[wrappedIdx];
    targetEl.classList.add('active-match');
    updateSearchControlsUi();

    if (shouldScroll) {
      targetEl.scrollIntoView({ behavior: 'smooth', block: 'center', inline: 'nearest' });
    }
  }

  function collectSearchMatches(autoScrollFirst = false) {
    const query = state.searchQuery.trim();
    if (!query) {
      state.searchMatches = [];
      state.activeMatchIndex = -1;
      updateSearchControlsUi();
      return;
    }

    const allMarks = Array.from(dom.questionsFeed.querySelectorAll('mark.search-hl')).filter(
      mark => !mark.closest('.hidden')
    );
    allMarks.forEach(m => m.classList.remove('active-match'));

    state.searchMatches = allMarks;
    if (allMarks.length > 0) {
      const nextIdx = (state.activeMatchIndex >= 0 && state.activeMatchIndex < allMarks.length)
        ? state.activeMatchIndex
        : 0;
      activateSearchMatch(nextIdx, autoScrollFirst);
    } else {
      state.activeMatchIndex = -1;
      updateSearchControlsUi();
    }
  }

  function navigateSearchMatch(delta) {
    const total = state.searchMatches.length;
    if (!total) return;
    const current = state.activeMatchIndex >= 0 ? state.activeMatchIndex : 0;
    activateSearchMatch(current + delta, true);
  }

  /* ----------------------------------------------------------------------
     G. RENDERERS (MULTI-COLOR MENU, PALETTE, CARDS, EXPLANATIONS)
     ---------------------------------------------------------------------- */
  function getFilteredQuestions() {
    if (state.filteredCache) return state.filteredCache;
    const query = state.searchQuery.trim().toLowerCase();

    state.filteredCache = state.questions.filter(q => {
      if (state.mainCategory === CONFIG.CATEGORY.PYQ && !q.pyqYear) return false;
      if (state.subCategory && q.category !== state.subCategory) return false;
      return !query || q._searchIndex.includes(query);
    });
    return state.filteredCache;
  }

  function renderCategoryDrawer() {
    const isPyqMode = state.mainCategory === CONFIG.CATEGORY.PYQ;
    const allActive = state.mainCategory === CONFIG.CATEGORY.ALL && state.subCategory === null;
    const pyqActive = state.mainCategory === CONFIG.CATEGORY.PYQ && state.subCategory === null;

    let html = `
      <button type="button" class="filter-item-btn nav-color-indigo ${allActive ? 'active' : ''}" data-main-category="ALL" aria-pressed="${allActive}">
        <span class="filter-item-left">
          <span class="nav-icon-pill" aria-hidden="true"><i class="fa-solid fa-book-open-reader"></i></span>
          <span class="filter-item-label">${CONFIG.CATEGORY_LABELS.ALL}</span>
        </span>
        <span class="filter-count-pill">${totalAllCount}</span>
      </button>

      <button type="button" class="filter-item-btn nav-color-cerulean ${pyqActive ? 'active' : ''}" data-main-category="PYQ" aria-pressed="${pyqActive}">
        <span class="filter-item-left">
          <span class="nav-icon-pill" aria-hidden="true"><i class="fa-solid fa-clock-rotate-left"></i></span>
          <span class="filter-item-label">${CONFIG.CATEGORY_LABELS.PYQ}</span>
        </span>
        <span class="filter-count-pill">${totalPyqCount}</span>
      </button>

      <div class="topic-sublist">
    `;

    subCategoriesList.forEach(subCat => {
      const stat = subCategoryStats.get(subCat) || { all: 0, pyq: 0 };
      const count = isPyqMode ? stat.pyq : stat.all;
      if (!count) return;
      const isSelected = state.subCategory === subCat;
      const meta = getCategoryMeta(subCat);
      html += `
        <button type="button" class="topic-item-btn ${meta.navClass} ${isSelected ? 'active' : ''}" data-sub-category="${RichParser.escapeHtml(subCat)}" aria-pressed="${isSelected}">
          <span class="topic-item-left">
            <span class="nav-icon-pill" aria-hidden="true"><i class="fa-solid ${meta.icon}"></i></span>
            <span class="filter-item-label">${RichParser.escapeHtml(subCat)}</span>
          </span>
          <span class="filter-count-pill">${count}</span>
        </button>
      `;
    });

    html += `</div>`;
    dom.categoryFilterContainer.innerHTML = html;
  }

  function updateHudAndPalette(filtered = getFilteredQuestions()) {
    let correct = 0;
    let wrong = 0;
    let answered = 0;
    const fragment = document.createDocumentFragment();

    filtered.forEach((q, idx) => {
      const choice = state.answers[q.id];
      let statusClass = '';

      if (choice !== undefined) {
        answered++;
        if (choice === q.correctKey) {
          correct++;
          statusClass = 'is-correct';
        } else {
          wrong++;
          statusClass = 'is-wrong';
        }
      }

      const tile = document.createElement('button');
      tile.type = 'button';
      tile.dataset.targetQid = String(q.id);
      tile.className = `palette-tile ${statusClass}`.trim();
      tile.textContent = String(idx + 1);
      tile.title = `প্রশ্ন নম্বর ${idx + 1}-এ যান`;
      tile.setAttribute('aria-label', `প্রশ্ন নম্বর ${idx + 1}-এ যান`);
      fragment.appendChild(tile);
    });

    const total = filtered.length;
    const pending = Math.max(0, total - answered);

    dom.headerUnansweredBadge.textContent = String(pending);
    dom.tabUnansweredBadge.textContent = String(pending);
    dom.menuOpenBtn.title = `মেনু খুলুন (${pending} টি বাকি, মোট ${total} টি)`;

    dom.counterCorrect.textContent = String(correct);
    dom.counterWrong.textContent = String(wrong);
    dom.counterPending.textContent = String(pending);

    const correctPct = total > 0 ? (correct / total) * 100 : 0;
    const wrongPct = total > 0 ? (wrong / total) * 100 : 0;
    const restPct = total > 0 ? (pending / total) * 100 : 0;

    dom.scoreBarCorrect.style.width = `${correctPct}%`;
    dom.scoreBarWrong.style.width = `${wrongPct}%`;
    dom.scoreBarRest.style.width = `${restPct}%`;

    dom.paletteGrid.replaceChildren(fragment);
  }

  function renderOptionsHtml(q, userChoice) {
    const isAnswered = userChoice !== undefined;
    const query = state.searchQuery;

    return CONFIG.OPTION_KEYS.map(key => {
      const opt = q.options[key];
      let stateClass = '';
      let iconHtml = '';

      if (isAnswered) {
        stateClass = 'is-locked ';
        if (key === q.correctKey) {
          stateClass += 'is-correct';
          iconHtml = `<span class="opt-status-icon" aria-hidden="true"><i class="fa-solid fa-circle-check"></i></span>`;
        } else if (key === userChoice) {
          stateClass += 'is-wrong';
          iconHtml = `<span class="opt-status-icon" aria-hidden="true"><i class="fa-solid fa-circle-xmark"></i></span>`;
        } else {
          stateClass += 'is-muted';
        }
      }

      return `
        <div
          data-option-key="${key}"
          data-qid="${q.id}"
          role="button"
          tabindex="${isAnswered ? '-1' : '0'}"
          aria-disabled="${isAnswered}"
          aria-label="Option ${key}: ${RichParser.escapeHtml(opt.bn)}"
          class="option-item ${stateClass.trim()}"
        >
          <span class="opt-key-pill">${key}</span>
          <div class="opt-label-wrap">
            <span class="opt-bn">${RichParser.highlightText(opt.bn, query)}</span>
            ${opt.en ? `<span class="opt-en">(${RichParser.highlightText(opt.en, query)})</span>` : ''}
          </div>
          ${iconHtml}
        </div>
      `;
    }).join('');
  }

  function renderExplanationHtml(q) {
    if (q._cachedExplainHtml) return q._cachedExplainHtml;

    const correctOpt = q.options[q.correctKey];
    const contextHtml = RichParser.parse(q.explanation?.context);
    const notesHtml = RichParser.parse(q.explanation?.notes);
    const moreObj = RichParser.normalizeMoreInfo(q.explanation);
    const moreContentHtml = moreObj ? RichParser.parse(moreObj.content) : '';
    const analysisList = q.explanation?.optionAnalysis || [];

    q._cachedExplainHtml = `
      <div class="explain-panel">
        <div class="correct-answer-banner">
          <span class="banner-check-icon" aria-hidden="true"><i class="fa-solid fa-check"></i></span>
          <span>
            সঠিক উত্তর: <strong>(${q.correctKey}) ${RichParser.escapeHtml(correctOpt.bn)}</strong>
            ${correctOpt.en ? `<span class="font-latin" style="opacity:0.86;">(${RichParser.escapeHtml(correctOpt.en)})</span>` : ''}
          </span>
        </div>

        ${contextHtml ? `
          <div class="explain-section">
            <h4 class="explain-section-title">
              <i class="fa-solid fa-book-open" aria-hidden="true"></i>
              <span>বিশ্লেষণ:</span>
            </h4>
            ${contextHtml}
          </div>
        ` : ''}

        ${analysisList.length ? `
          <div class="explain-section explain-section-separated">
            <h4 class="explain-section-title">
              <i class="fa-solid fa-list-ul" aria-hidden="true"></i>
              <span>অন্যান্য বিকল্পগুলির বিশ্লেষণ:</span>
            </h4>
            <div class="analysis-cards-grid">
              ${analysisList.map(item => `
                <div class="analysis-item-card">
                  <span class="analysis-key">(${RichParser.escapeHtml(item.key)})</span>
                  <div class="analysis-desc-wrap">${RichParser.formatOptionDesc(item.desc)}</div>
                </div>
              `).join('')}
            </div>
          </div>
        ` : ''}

        ${notesHtml ? `
          <div class="explain-section explain-section-separated">
            <h4 class="notes-heading-title">
              ${NOTES_TARGET_SVG}
              <span>কিছু গুরুত্বপূর্ণ তথ্য:</span>
            </h4>
            ${notesHtml}
          </div>
        ` : ''}

        ${moreContentHtml ? `
          <div class="explain-section explain-section-separated">
            <h4 class="more-info-heading-title">
              ${MORE_INFO_DIAMOND_SVG}
              <span>${RichParser.escapeHtml(moreObj.title)}</span>
            </h4>
            ${moreContentHtml}
          </div>
        ` : ''}

        <div class="collapse-row">
          <button type="button" class="btn-collapse-chevron" title="ব্যাখ্যা বন্ধ করুন" data-qid="${q.id}" aria-label="ব্যাখ্যা বন্ধ করুন">
            <i class="fa-solid fa-chevron-up" aria-hidden="true"></i>
          </button>
        </div>
      </div>
    `;
    return q._cachedExplainHtml;
  }

  function populateExplanationDom(containerEl, q) {
    containerEl.innerHTML = renderExplanationHtml(q);
    if (state.searchQuery.trim()) {
      RichParser.highlightDomTree(containerEl, state.searchQuery);
    }
    fitTablesIn(containerEl);
  }

  function getExplainBtnText(qId) {
    if (state.openExplains[qId]) return 'ব্যাখ্যা লুকান';
    return state.answers[qId] !== undefined ? 'ব্যাখ্যা দেখুন' : 'সরাসরি ব্যাখ্যা দেখুন';
  }

  function createQuestionCard(q, indexNum) {
    const card = document.createElement('article');
    card.id = `q-card-${q.id}`;
    card.className = 'question-card';

    const isOpen = Boolean(state.openExplains[q.id]);
    const query = state.searchQuery;
    const catMeta = getCategoryMeta(q.category);

    card.innerHTML = `
      <div class="card-meta-row">
        <span class="cat-badge ${catMeta.badgeClass}">
          <i class="fa-solid ${catMeta.icon}" aria-hidden="true"></i>
          <span>${RichParser.highlightText(q.category, query)}</span>
        </span>
        ${q.pyqYear ? `
          <span class="pyq-badge">
            <i class="fa-solid fa-clock-rotate-left" aria-hidden="true"></i>
            <span>${RichParser.highlightText(q.pyqYear, query)}</span>
          </span>
        ` : ''}
      </div>

      <div class="question-header-row">
        <span class="q-num-badge">${indexNum}</span>
        <div class="q-title-wrap">
          <h2 class="q-title-bn">${RichParser.highlightText(q.questionBn, query)}</h2>
          ${q.questionEn ? `<p class="q-title-en">${RichParser.highlightText(q.questionEn, query)}</p>` : ''}
        </div>
      </div>

      <div class="options-group" role="group" aria-label="উত্তরের বিকল্পসমূহ" data-qid="${q.id}">
        ${renderOptionsHtml(q, state.answers[q.id])}
      </div>

      <div class="card-footer-row">
        <button type="button" aria-expanded="${isOpen}" class="btn-toggle-explain" data-qid="${q.id}">
          <i class="fa-solid ${isOpen ? 'fa-eye-slash' : 'fa-eye'} explain-icon" aria-hidden="true"></i>
          <span class="explain-label">${getExplainBtnText(q.id)}</span>
        </button>
      </div>

      <div class="explanation-container ${isOpen ? '' : 'hidden'}"></div>
    `;

    if (isOpen) {
      const explainBox = card.querySelector('.explanation-container');
      populateExplanationDom(explainBox, q);
    }

    return card;
  }

  function syncGlobalExplainButton(filtered = getFilteredQuestions()) {
    const allOpen = filtered.length > 0 && filtered.every(q => Boolean(state.openExplains[q.id]));
    state.allExplainsOpen = allOpen;
    dom.btnToggleAllExplains.setAttribute('aria-pressed', String(allOpen));
    dom.btnToggleAllExplains.classList.toggle('active', allOpen);
    dom.iconToggleAll.className = `fa-solid ${allOpen ? 'fa-eye-slash' : 'fa-eye'}`;
    dom.textToggleAll.textContent = allOpen ? 'সব ব্যাখ্যা লুকান' : 'সব ব্যাখ্যা দেখুন';
  }

  function renderFeed(options = {}) {
    const { autoScrollFirstMatch = false } = options;
    const filtered = getFilteredQuestions();
    const isFiltered = state.mainCategory !== CONFIG.CATEGORY.ALL || state.subCategory !== null;

    dom.filterIndicator.classList.toggle('hidden', !isFiltered);
    if (isFiltered) {
      const mainLabel = CONFIG.CATEGORY_LABELS[state.mainCategory];
      dom.filterCategoryName.textContent = state.subCategory ? `${mainLabel} › ${state.subCategory}` : mainLabel;
      const dotColor = state.subCategory
        ? getCategoryMeta(state.subCategory).dotVar
        : (state.mainCategory === CONFIG.CATEGORY.PYQ ? 'var(--c-cerulean)' : 'var(--accent)');
      dom.filterIndicatorDot.style.backgroundColor = dotColor;
    }

    if (!filtered.length) {
      dom.questionsFeed.replaceChildren();
      dom.emptyState.classList.remove('hidden');
    } else {
      dom.emptyState.classList.add('hidden');
      const fragment = document.createDocumentFragment();
      filtered.forEach((q, idx) => fragment.appendChild(createQuestionCard(q, idx + 1)));
      dom.questionsFeed.replaceChildren(fragment);
      fitTablesIn(dom.questionsFeed);
    }

    updateHudAndPalette(filtered);
    syncGlobalExplainButton(filtered);
    collectSearchMatches(autoScrollFirstMatch);
  }

  /* ----------------------------------------------------------------------
     H. INTERACTION HANDLERS (ANSWER, INSTANT EXPLAIN, SHUFFLE, RESET, SEARCH)
     ---------------------------------------------------------------------- */
  function selectOption(qId, key) {
    if (state.answers[qId] !== undefined) return;
    const card = $(`q-card-${qId}`);
    const q = questionMap.get(qId);
    if (!card || !q) return;

    state.answers[qId] = key;
    Store.setJson(CONFIG.STORAGE.ANSWERS, state.answers);

    const group = card.querySelector('.options-group');
    if (group) group.innerHTML = renderOptionsHtml(q, key);

    const label = card.querySelector('.explain-label');
    if (label) label.textContent = getExplainBtnText(qId);

    updateHudAndPalette();
    if (state.searchQuery.trim()) {
      collectSearchMatches(false);
    }

    const isCorrect = key === q.correctKey;
    announce(isCorrect
      ? `সঠিক উত্তর: ${q.options[key].bn}`
      : `ভুল উত্তর। সঠিক উত্তর হলো (${q.correctKey}) ${q.options[q.correctKey].bn}`);
  }

  function toggleExplanation(qId, jumpBack = false) {
    const card = $(`q-card-${qId}`);
    const q = questionMap.get(qId);
    if (!card || !q) return;

    const nextOpen = !state.openExplains[qId];
    state.openExplains[qId] = nextOpen;

    const container = card.querySelector('.explanation-container');
    const toggleBtn = card.querySelector('.btn-toggle-explain');
    const label = card.querySelector('.explain-label');
    const icon = card.querySelector('.explain-icon');

    if (nextOpen) {
      container.classList.remove('hidden');
      populateExplanationDom(container, q);
    } else {
      container.classList.add('hidden');
      container.replaceChildren();
      if (jumpBack && toggleBtn) {
        toggleBtn.scrollIntoView({ behavior: 'auto', block: 'center' });
      }
    }

    if (toggleBtn) toggleBtn.setAttribute('aria-expanded', String(nextOpen));
    if (label) label.textContent = getExplainBtnText(qId);
    if (icon) icon.className = `fa-regular ${nextOpen ? 'fa-eye-slash' : 'fa-eye'} explain-icon`;
    syncGlobalExplainButton();

    if (state.searchQuery.trim()) {
      collectSearchMatches(false);
    }
  }

  function applySearchQuery(rawValue) {
    const prevTrimmed = state.searchQuery.trim();
    const nextTrimmed = String(rawValue || '').trim();

    // Snapshot pre-search explanation state when entering search mode
    if (!prevTrimmed && nextTrimmed) {
      state.preSearchOpenExplains = { ...state.openExplains };
    }

    state.searchQuery = rawValue;
    state.filteredCache = null;
    state.activeMatchIndex = -1;

    if (!nextTrimmed) {
      // Restore pre-search explanation state when cleared
      if (state.preSearchOpenExplains !== null) {
        state.openExplains = { ...state.preSearchOpenExplains };
        state.preSearchOpenExplains = null;
      }
      renderFeed({ autoScrollFirstMatch: false });
      return;
    }

    // Auto-expand explanations for filtered questions whose explanation matches the query
    const lowered = nextTrimmed.toLowerCase();
    const baseOpen = state.preSearchOpenExplains || {};
    const nextOpenMap = { ...baseOpen };

    getFilteredQuestions().forEach(q => {
      if (q._explainSearchIndex && q._explainSearchIndex.includes(lowered)) {
        nextOpenMap[q.id] = true;
      }
    });

    state.openExplains = nextOpenMap;
    renderFeed({ autoScrollFirstMatch: true });
  }

  function clearSearchInput(refocus = false) {
    dom.searchInput.value = '';
    applySearchQuery('');
    if (refocus) dom.searchInput.focus();
  }

  function shuffleAll() {
    let answersShifted = false;

    state.questions.forEach(q => {
      const pairs = CONFIG.OPTION_KEYS.map(k => ({ oldKey: k, val: q.options[k] }));
      for (let i = pairs.length - 1; i > 0; i--) {
        const j = Math.floor(Math.random() * (i + 1));
        [pairs[i], pairs[j]] = [pairs[j], pairs[i]];
      }

      const keyMap = {};
      const shuffledOpts = {};
      pairs.forEach((p, idx) => {
        const newKey = CONFIG.OPTION_KEYS[idx];
        keyMap[p.oldKey] = newKey;
        shuffledOpts[newKey] = p.val;
      });

      q.options = shuffledOpts;
      q.correctKey = keyMap[q.correctKey] || q.correctKey;
      q._cachedExplainHtml = null;

      if (state.answers[q.id] && keyMap[state.answers[q.id]]) {
        state.answers[q.id] = keyMap[state.answers[q.id]];
        answersShifted = true;
      }

      if (Array.isArray(q.explanation?.optionAnalysis)) {
        q.explanation.optionAnalysis.forEach(item => {
          if (keyMap[item.key]) item.key = keyMap[item.key];
        });
        q.explanation.optionAnalysis.sort(
          (a, b) => CONFIG.OPTION_KEYS.indexOf(a.key) - CONFIG.OPTION_KEYS.indexOf(b.key)
        );
      }

      q._searchIndex = buildFullSearchIndex(q);
    });

    if (answersShifted) Store.setJson(CONFIG.STORAGE.ANSWERS, state.answers);

    for (let i = state.questions.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [state.questions[i], state.questions[j]] = [state.questions[j], state.questions[i]];
    }

    state.filteredCache = null;
    state.activeMatchIndex = -1;
    renderFeed({ autoScrollFirstMatch: false });
    window.scrollTo({ top: 0, behavior: 'smooth' });
    showToast('প্রশ্ন ও অপশন শাফেল করা হয়েছে');
  }

  function resetAllProgress() {
    state.questions = cloneQuestions();
    rebuildQuestionMap(state.questions);
    state.filteredCache = null;
    state.answers = {};
    state.openExplains = {};
    state.preSearchOpenExplains = null;
    state.allExplainsOpen = false;
    state.activeMatchIndex = -1;
    Store.setJson(CONFIG.STORAGE.ANSWERS, {});

    if (state.searchQuery.trim()) {
      applySearchQuery(state.searchQuery);
    } else {
      renderFeed({ autoScrollFirstMatch: false });
    }

    closeAllDrawers(false);
    window.scrollTo({ top: 0, behavior: 'smooth' });
    showToast('সকল উত্তর পুনরায় শুরু করা হয়েছে');
  }

  /* ----------------------------------------------------------------------
     I. EVENT BINDING & SCROLL VISIBILITY CONTROLLER
     ---------------------------------------------------------------------- */
  function bindEvents() {
    dom.questionsFeed.addEventListener('click', e => {
      const opt = e.target.closest('.option-item');
      if (opt) {
        selectOption(Number(opt.dataset.qid), opt.dataset.optionKey);
        return;
      }
      const chevron = e.target.closest('.btn-collapse-chevron');
      if (chevron) {
        toggleExplanation(Number(chevron.dataset.qid), true);
        return;
      }
      const explainBtn = e.target.closest('.btn-toggle-explain');
      if (explainBtn) {
        toggleExplanation(Number(explainBtn.dataset.qid), false);
      }
    });

    dom.questionsFeed.addEventListener('keydown', e => {
      const opt = e.target.closest('.option-item');
      if (!opt) return;
      if (e.key === 'Enter' || e.key === ' ') {
        e.preventDefault();
        selectOption(Number(opt.dataset.qid), opt.dataset.optionKey);
      }
    });

    dom.menuOpenBtn.addEventListener('click', () => openMainDrawer());
    dom.drawerCloseBtn.addEventListener('click', () => closeAllDrawers(true));
    dom.drawerBackdrop.addEventListener('click', () => closeAllDrawers(false));

    dom.drawerTabs.forEach(tabBtn => {
      tabBtn.addEventListener('click', () => switchDrawerTab(tabBtn.dataset.drawerTab));
    });

    dom.categoryFilterContainer.addEventListener('click', e => {
      const mainBtn = e.target.closest('button[data-main-category]');
      if (mainBtn) {
        state.mainCategory = mainBtn.dataset.mainCategory;
        state.subCategory = null;
        state.filteredCache = null;
        state.activeMatchIndex = -1;
        renderCategoryDrawer();
        renderFeed({ autoScrollFirstMatch: false });
        window.scrollTo({ top: 0, behavior: 'smooth' });
        return;
      }
      const subBtn = e.target.closest('button[data-sub-category]');
      if (subBtn) {
        const picked = subBtn.dataset.subCategory;
        state.subCategory = state.subCategory === picked ? null : picked;
        state.filteredCache = null;
        state.activeMatchIndex = -1;
        closeAllDrawers(false);
        renderCategoryDrawer();
        renderFeed({ autoScrollFirstMatch: false });
        window.scrollTo({ top: 0, behavior: 'smooth' });
      }
    });

    dom.paletteGrid.addEventListener('click', e => {
      const tile = e.target.closest('button[data-target-qid]');
      if (!tile) return;
      closeAllDrawers(false);
      const card = $(`q-card-${tile.dataset.targetQid}`);
      if (!card) return;
      card.scrollIntoView({ behavior: 'smooth', block: 'start' });
      card.classList.add('card-highlight');
      setTimeout(() => card.classList.remove('card-highlight'), 1100);
    });

    dom.themePills.forEach(pill => {
      pill.addEventListener('click', () => applyTheme(pill.dataset.themeVal));
    });

    dom.fontSizeSlider.addEventListener('input', e => applyFontSize(e.target.value));
    dom.fontDecBtn.addEventListener('click', () => applyFontSize(state.fontSize - CONFIG.FONT.STEP));
    dom.fontIncBtn.addEventListener('click', () => applyFontSize(state.fontSize + CONFIG.FONT.STEP));

    dom.linePills.forEach(pill => {
      pill.addEventListener('click', () => applyLineSpace(pill.dataset.lh));
    });

    dom.btnResetProgress.addEventListener('click', resetAllProgress);
    dom.btnResetProgressPalette.addEventListener('click', resetAllProgress);
    dom.btnShuffle.addEventListener('click', shuffleAll);

    dom.btnToggleAllExplains.addEventListener('click', () => {
      const filtered = getFilteredQuestions();
      const nextOpen = !state.allExplainsOpen;
      state.allExplainsOpen = nextOpen;

      filtered.forEach(q => {
        state.openExplains[q.id] = nextOpen;
        const card = $(`q-card-${q.id}`);
        if (!card) return;
        const box = card.querySelector('.explanation-container');
        const toggleBtn = card.querySelector('.btn-toggle-explain');
        const label = card.querySelector('.explain-label');
        const icon = card.querySelector('.explain-icon');
        if (nextOpen) {
          box.classList.remove('hidden');
          populateExplanationDom(box, q);
        } else {
          box.classList.add('hidden');
          box.replaceChildren();
        }
        if (toggleBtn) toggleBtn.setAttribute('aria-expanded', String(nextOpen));
        if (label) label.textContent = getExplainBtnText(q.id);
        if (icon) icon.className = `fa-regular ${nextOpen ? 'fa-eye-slash' : 'fa-eye'} explain-icon`;
      });
      syncGlobalExplainButton(filtered);
      if (state.searchQuery.trim()) {
        collectSearchMatches(false);
      }
    });

    dom.btnShowAllCategories.addEventListener('click', () => {
      state.mainCategory = CONFIG.CATEGORY.ALL;
      state.subCategory = null;
      state.filteredCache = null;
      state.activeMatchIndex = -1;
      renderCategoryDrawer();
      renderFeed({ autoScrollFirstMatch: false });
    });

    dom.btnClearFiltersEmpty.addEventListener('click', () => {
      state.mainCategory = CONFIG.CATEGORY.ALL;
      state.subCategory = null;
      clearSearchInput(false);
      renderCategoryDrawer();
    });

    // Deep Search Input + Match Navigation Arrows + Keyboard Shortcuts
    let searchTimer = null;
    dom.searchInput.addEventListener('input', e => {
      clearTimeout(searchTimer);
      const val = e.target.value;
      updateSearchControlsUi();
      searchTimer = setTimeout(() => {
        applySearchQuery(val);
      }, 160);
    });

    dom.searchInput.addEventListener('keydown', e => {
      if (e.key === 'Enter') {
        e.preventDefault();
        clearTimeout(searchTimer);
        if (dom.searchInput.value !== state.searchQuery) {
          applySearchQuery(dom.searchInput.value);
        } else {
          navigateSearchMatch(e.shiftKey ? -1 : 1);
        }
      } else if (e.key === 'Escape' && dom.searchInput.value) {
        e.stopPropagation();
        clearSearchInput(true);
      }
    });

    dom.searchPrevBtn.addEventListener('click', () => navigateSearchMatch(-1));
    dom.searchNextBtn.addEventListener('click', () => navigateSearchMatch(1));
    dom.searchClearBtn.addEventListener('click', () => clearSearchInput(true));

    document.addEventListener('keydown', e => {
      if (e.key === 'Escape') {
        closeAllDrawers(true);
        return;
      }
      if (
        e.key === '/' &&
        document.activeElement !== dom.searchInput &&
        !['INPUT', 'TEXTAREA'].includes(document.activeElement?.tagName)
      ) {
        e.preventDefault();
        dom.searchBarWrapper.classList.remove('search-hidden');
        dom.searchInput.focus();
        dom.searchInput.select();
      }
    });

    dom.homeBtn?.addEventListener('click', e => {
      const href = dom.homeBtn.getAttribute('href') || '';
      if (!href || href.startsWith('#')) {
        e.preventDefault();
        window.scrollTo({ top: 0, behavior: 'smooth' });
      }
    });

    // Debounced Window Resize Handler for Responsive Table Fitting
    let resizeRaf = null;
    window.addEventListener('resize', () => {
      if (resizeRaf !== null) return;
      resizeRaf = requestAnimationFrame(() => {
        resizeRaf = null;
        fitTablesIn(dom.questionsFeed);
      });
    }, { passive: true });

    // Refit visible tables once custom web fonts finish loading
    if (document.fonts && document.fonts.ready) {
      document.fonts.ready.then(() => fitTablesIn(dom.questionsFeed)).catch(() => {});
    }

    // Scroll Handler: Search bar NEVER hides while search box contains text
    let lastScrollY = window.scrollY;
    let ticking = false;
    window.addEventListener('scroll', () => {
      if (ticking) return;
      ticking = true;
      requestAnimationFrame(() => {
        const currentY = window.scrollY;
        const docHeight = document.documentElement.scrollHeight - window.innerHeight;
        const progress = docHeight > 0 ? Math.min(100, Math.max(0, (currentY / docHeight) * 100)) : 0;
        dom.readingProgressFill.style.width = `${progress}%`;

        dom.backToTopBtn.classList.toggle('visible', currentY > 240);

        const hasSearch = dom.searchInput.value.trim().length > 0 || state.searchQuery.trim().length > 0;
        const isSearchFocused = document.activeElement === dom.searchInput;
        if (hasSearch || isSearchFocused || currentY <= 40) {
          dom.searchBarWrapper.classList.remove('search-hidden');
        } else if (currentY > lastScrollY + 7) {
          dom.searchBarWrapper.classList.add('search-hidden');
        } else if (currentY < lastScrollY - 5) {
          dom.searchBarWrapper.classList.remove('search-hidden');
        }
        lastScrollY = currentY;
        ticking = false;
      });
    }, { passive: true });
  }

  /* ----------------------------------------------------------------------
     J. INITIALIZATION
     ---------------------------------------------------------------------- */
  function init() {
    try {
      applyTheme(state.theme);
      applyFontSize(state.fontSize);
      applyLineSpace(state.lineSpace);
      renderCategoryDrawer();
      bindEvents();
      renderFeed({ autoScrollFirstMatch: false });
      updateSearchControlsUi();
    } catch (err) {
      console.error('Initialization error:', err);
    }
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
})();
