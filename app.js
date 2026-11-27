/**
 * 奈良教育大学 空き教室・利用状況チェッカー & 科目検索・My時間割
 * Application Logic
 */

// =========================================================================
// ⚙️ 【ユーザー設定】単位数上限（CAP制）対象外科目の設定
// ここに時間割番号や科目名、除外ルールを追加・編集できます
// =========================================================================
window.CAP_EXEMPT_CONFIG = {
  // ① 時間割番号で指定（完全一致）
  // 例: ['G0106', 'G0603']
  lessonIds: [
    // ここに除外したい時間割番号を追加できます（例: 'G0001', 'G0002'）
  ],

  // ② 科目名に含まれるキーワードで指定（部分一致）
  // 例: ['教職', '集中']
  nameKeywords: [
    // ここにキーワードを追加できます（例: '卒業研究', '教職実践'）
  ],

  // ③ カスタム判定ルール（関数）
  // 自由な条件判定を記述できます。trueを返すとCAP対象外（上限に含めない）になります。
  customRule: function (lesson) {
    // 例: 集中講義をすべてCAP対象外にする場合
    // if (lesson.day === '集中') return true;
    return false;
  }
};

(function () {
  'use strict';

  // グローバルデータ取得
  const DATA = window.SYLLABUS_DATA;
  if (!DATA || !DATA.lessons || !DATA.rooms) {
    console.error('シラバスデータの読み込みに失敗しました。');
    const errBox = document.createElement('div');
    errBox.style.cssText = 'padding: 20px; background: #fee2e2; color: #991b1b; text-align: center; font-weight: bold; margin: 20px; border-radius: 8px;';
    errBox.textContent = 'シラバスデータの読み込みに失敗しました。data.js が正しく読み込まれているか確認してください。';
    document.body.prepend(errBox);
    return;
  }

  // データ正規化（JSONシリアライズ時の防御的変換）
  DATA.lessons.forEach(l => {
    if (!Array.isArray(l.slots)) {
      l.slots = (l.slots !== undefined && l.slots !== null) ? [l.slots] : [];
    }
    if (!Array.isArray(l.rooms)) {
      l.rooms = (l.rooms !== undefined && l.rooms !== null) ? [l.rooms] : [];
    }
    if (!Array.isArray(l.periodNums)) {
      l.periodNums = (l.periodNums !== undefined && l.periodNums !== null) ? [l.periodNums] : [];
    }
  });

  // CAP対象外科目かどうかを判定する関数
  function isCapExempt(lesson) {
    if (!lesson) return false;
    const cfg = window.CAP_EXEMPT_CONFIG || {};
    if (cfg.lessonIds && Array.isArray(cfg.lessonIds) && cfg.lessonIds.includes(lesson.id)) return true;
    if (cfg.nameKeywords && Array.isArray(cfg.nameKeywords) && cfg.nameKeywords.some(kw => (lesson.name || '').includes(kw))) return true;
    if (typeof cfg.customRule === 'function' && cfg.customRule(lesson)) return true;
    return false;
  }

  // LocalStorage キー
  const STORAGE_KEY = 'nara_edu_my_timetable_v2';

  // 曜日の順序マップ
  const DAY_ORDER_MAP = { '月': 1, '火': 2, '水': 3, '木': 4, '金': 5, '集中': 6 };

  // アプリケーション状態
  const state = {
    semester: '前期',
    day: '月',
    slot: 1, // 1: 1・2限, 2: 3・4限, 3: 5・6限, 4: 7・8限, 5: 9・10限
    category: 'lecture',
    searchQuery: '',
    showOccupied: true,
    currentTab: 'curriculum',
    selectedRoom: '101教室',
    matrixCategory: 'lecture',

    // 履修基準・計画の状態
    curricCourse: 'tech',
    curricStatusFilter: 'all', // 'all' | 'none' | 'in_progress' | 'completed'
    curricSearchQuery: '',
    curricCollapsedCats: new Set(),
    curricUserData: {
      version: 2,
      subjects: {}
    },
    activeCurricSubject: null,

    // 科目全件検索の状態
    lessonFilter: {
      q: '',
      sem: 'all',
      day: 'all',
      slot: 'all',
      cat: 'all'
    },
    lessonSort: {
      field: 'id', // 'id' または 'daySlot' のみ
      order: 'asc'
    },

    // My時間割の状態
    mySemester: '前期',
    myTimetable: {
      '前期': [],
      '後期': []
    },
    conflictAck: {
      '前期': false,
      '後期': false
    },
    conflictDismissed: {
      '前期': false,
      '後期': false
    },
    currentConflicts: {},

    activeSlotPicker: null
  };

  // DOM要素
  const dom = {
    semBtns: document.querySelectorAll('.sem-btn'),
    navTabs: document.querySelectorAll('.nav-tab'),
    tabContents: document.querySelectorAll('.tab-content'),
    dayBtns: document.querySelectorAll('#day-selector .pill-btn'),
    slotBtns: document.querySelectorAll('#slot-selector .pill-btn'),
    categoryFilter: document.getElementById('category-filter'),
    roomSearchInput: document.getElementById('room-search-input'),
    showOccupiedToggle: document.getElementById('show-occupied-toggle'),
    roomsGrid: document.getElementById('rooms-grid'),
    countFree: document.getElementById('count-free'),
    countOccupied: document.getElementById('count-occupied'),
    countTotal: document.getElementById('count-total'),
    currentCriteriaLabel: document.getElementById('current-criteria-label'),
    btnNow: document.getElementById('btn-now'),

    // モーダル
    lessonModal: document.getElementById('lesson-modal'),
    modalLessonTitle: document.getElementById('modal-lesson-title'),
    modalLessonBody: document.getElementById('modal-lesson-body'),
    modalSyllabusLink: document.getElementById('modal-syllabus-link'),

    lessonSelectModal: document.getElementById('lesson-select-modal'),
    modalSelectTitle: document.getElementById('modal-select-title'),
    modalSelectDesc: document.getElementById('modal-select-desc'),
    modalSelectList: document.getElementById('modal-select-list'),

    slotPickerModal: document.getElementById('slot-picker-modal'),
    slotPickerTitle: document.getElementById('slot-picker-title'),
    slotPickerSubtitle: document.getElementById('slot-picker-subtitle'),
    slotPickerSearch: document.getElementById('slot-picker-search'),
    slotPickerList: document.getElementById('slot-picker-list'),

    conflictDetailsModal: document.getElementById('conflict-details-modal'),
    conflictDetailsList: document.getElementById('conflict-details-list'),
    btnModalConflictToggle: document.getElementById('btn-modal-conflict-toggle'),

    // タイムテーブル
    timetableRoomSelect: document.getElementById('timetable-room-select'),
    quickRoomChips: document.getElementById('quick-room-chips'),
    timetableRoomName: document.getElementById('timetable-room-name'),
    timetableRoomCat: document.getElementById('timetable-room-cat'),
    timetableTbody: document.getElementById('timetable-tbody'),

    // マトリクス
    matrixCategorySelect: document.getElementById('matrix-category-select'),
    matrixTable: document.getElementById('matrix-table'),

    // 科目全件検索
    lessonSearchInput: document.getElementById('lesson-search-input'),
    lessonSemBtns: document.querySelectorAll('#lesson-sem-selector .pill-btn'),
    lessonDaySelect: document.getElementById('lesson-day-select'),
    lessonSlotSelect: document.getElementById('lesson-slot-select'),
    lessonCatSelect: document.getElementById('lesson-cat-select'),
    btnLessonClear: document.getElementById('btn-lesson-clear'),
    lessonResultsCount: document.getElementById('lesson-results-count'),
    lessonTotalCount: document.getElementById('lesson-total-count'),
    lessonsTable: document.getElementById('lessons-table'),
    lessonsTbody: document.getElementById('lessons-tbody'),

    // My時間割
    myBadgeCount: document.getElementById('my-badge-count'),
    mySemBtns: document.querySelectorAll('.my-sem-btn'),
    myStatCount: document.getElementById('my-stat-count'),
    myStatCreditsCap: document.getElementById('my-stat-credits-cap'),
    myStatCreditsTotal: document.getElementById('my-stat-credits-total'),
    myYearCreditsCap: document.getElementById('my-year-credits-cap'),
    myYearCreditsTotal: document.getElementById('my-year-credits-total'),

    myConflictAlert: document.getElementById('my-conflict-alert'),
    conflictAlertIcon: document.getElementById('conflict-alert-icon'),
    conflictAlertText: document.getElementById('conflict-alert-text'),
    btnConflictDetails: document.getElementById('btn-conflict-details'),
    btnConflictAck: document.getElementById('btn-conflict-ack'),
    btnDismissConflictBar: document.getElementById('btn-dismiss-conflict-bar'),
    btnReopenConflict: document.getElementById('btn-reopen-conflict'),
    btnAddSpecialLesson: document.getElementById('btn-add-special-lesson'),
    btnShareMyTimetable: document.getElementById('btn-share-my-timetable'),

    btnClearMyTimetable: document.getElementById('btn-clear-my-timetable'),
    myTimetableTbody: document.getElementById('my-timetable-tbody'),
    mySpecialCount: document.getElementById('my-special-count'),
    mySpecialList: document.getElementById('my-special-list'),

    // ヘッダーのJSONボタン
    btnHeaderExportJson: document.getElementById('btn-header-export-json'),
    btnHeaderImportJson: document.getElementById('btn-header-import-json'),

    // 履修基準・計画 (TAB: curriculum)
    curricCourseSelect: document.getElementById('curric-course-select'),
    btnCurricResetData: document.getElementById('btn-curric-reset-data'),
    curricStatBadge: document.getElementById('curric-stat-badge'),
    curricStatCompleted: document.getElementById('curric-stat-completed'),
    curricStatInProgress: document.getElementById('curric-stat-inprogress'),
    curricStatRequired: document.getElementById('curric-stat-required'),
    curricProgCompleted: document.getElementById('curric-prog-completed'),
    curricProgInProgress: document.getElementById('curric-prog-inprogress'),
    curricCategoryStatsGrid: document.getElementById('curric-category-stats-grid'),
    curricFilterBar: document.getElementById('curric-filter-bar'),
    curricStatusFilter: document.getElementById('curric-status-filter'),
    curricSearchInput: document.getElementById('curric-search-input'),
    curricDisplayCount: document.getElementById('curric-display-count'),
    btnCurricCollapseAll: document.getElementById('btn-curric-collapse-all'),
    btnCurricExpandAll: document.getElementById('btn-curric-expand-all'),
    curricTableViewContainer: document.getElementById('curric-table-view-container'),

    // 候補選択モーダル
    curricCandidatesModal: document.getElementById('curric-candidates-modal'),
    curricModalSubTitle: document.getElementById('curric-modal-sub-title'),
    curricModalSubDesc: document.getElementById('curric-modal-sub-desc'),
    curricModalCandsList: document.getElementById('curric-modal-cands-list'),

    // JSON入出力モーダル
    curricJsonModal: document.getElementById('curric-json-modal'),
    curricJsonTextarea: document.getElementById('curric-json-textarea'),
    btnCurricModalCopyJson: document.getElementById('btn-curric-modal-copy-json'),
    btnCurricModalDownloadJson: document.getElementById('btn-curric-modal-download-json'),
    curricJsonFileInput: document.getElementById('curric-json-file-input'),
    btnCurricModalApplyJson: document.getElementById('btn-curric-modal-apply-json')
  };

  const POPULAR_ROOMS = ['101教室', '102教室', '105教室', '201教室', '206教室', '306教室', '310教室', '大講義室', '情報センター実習室（3F）'];

  // ----------------------------------------------------
  // LocalStorage: My時間割の保存・復元
  // ----------------------------------------------------
  function loadMyTimetable() {
    try {
      const saved = localStorage.getItem(STORAGE_KEY);
      if (saved) {
        const parsed = JSON.parse(saved);
        if (parsed && typeof parsed === 'object') {
          state.myTimetable['前期'] = Array.isArray(parsed.timetable?.['前期']) ? parsed.timetable['前期'] : [];
          state.myTimetable['後期'] = Array.isArray(parsed.timetable?.['後期']) ? parsed.timetable['後期'] : [];
          if (parsed.conflictAck) {
            state.conflictAck['前期'] = !!parsed.conflictAck['前期'];
            state.conflictAck['後期'] = !!parsed.conflictAck['後期'];
          }
          if (parsed.conflictDismissed) {
            state.conflictDismissed['前期'] = !!parsed.conflictDismissed['前期'];
            state.conflictDismissed['後期'] = !!parsed.conflictDismissed['後期'];
          }
        }
      }
    } catch (e) {
      console.warn('My時間割のロードに失敗しました:', e);
    }
    updateMyBadge();
  }

  function saveMyTimetable() {
    try {
      const toSave = {
        timetable: state.myTimetable,
        conflictAck: state.conflictAck,
        conflictDismissed: state.conflictDismissed
      };
      localStorage.setItem(STORAGE_KEY, JSON.stringify(toSave));
    } catch (e) {
      console.warn('My時間割の保存に失敗しました:', e);
    }
    updateMyBadge();
  }

  function updateMyBadge() {
    if (!dom.myBadgeCount) return;
    const totalCount = (state.myTimetable['前期'] || []).length + (state.myTimetable['後期'] || []).length;
    dom.myBadgeCount.textContent = totalCount;
    dom.myBadgeCount.style.display = totalCount > 0 ? 'inline-flex' : 'none';
  }

  function isLessonInMyTimetable(lessonId) {
    const sem = state.mySemester;
    const list = state.myTimetable[sem] || [];
    return list.includes(lessonId);
  }

  function toggleLessonInMyTimetable(lessonId) {
    const lesson = DATA.lessons.find(l => l.id === lessonId);
    if (!lesson) return;

    let sem = state.mySemester;
    if (lesson.semester === '前期') sem = '前期';
    if (lesson.semester === '後期') sem = '後期';

    let list = state.myTimetable[sem] || [];
    const idx = list.indexOf(lessonId);

    if (idx >= 0) {
      list.splice(idx, 1);
      showToast(`「${lesson.name}」を削除しました`);
    } else {
      list.push(lessonId);
      showToast(`「${lesson.name}」をMy時間割(${sem})に追加しました！ ⭐`);
    }

    state.myTimetable[sem] = list;
    saveMyTimetable();

    renderLessonsTab();
    renderMyTimetableTab();
  }

  // ----------------------------------------------------
  // My時間割の共有 (ハッシュ化 & URLコピー / インポート)
  // ----------------------------------------------------
  function encodeTimetableHash(data) {
    try {
      const json = JSON.stringify(data);
      const bytes = new TextEncoder().encode(json);
      let binary = '';
      for (let i = 0; i < bytes.length; i++) {
        binary += String.fromCharCode(bytes[i]);
      }
      return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
    } catch (e) {
      console.error('時間割ハッシュの生成に失敗しました:', e);
      return null;
    }
  }

  function decodeTimetableHash(hashStr) {
    try {
      let base64 = hashStr.replace(/-/g, '+').replace(/_/g, '/');
      while (base64.length % 4) {
        base64 += '=';
      }
      const binary = atob(base64);
      const bytes = new Uint8Array(binary.length);
      for (let i = 0; i < binary.length; i++) {
        bytes[i] = binary.charCodeAt(i);
      }
      const json = new TextDecoder().decode(bytes);
      return JSON.parse(json);
    } catch (e) {
      console.error('時間割ハッシュのデコードに失敗しました:', e);
      return null;
    }
  }

  function copyToClipboard(text) {
    if (navigator.clipboard && window.isSecureContext) {
      return navigator.clipboard.writeText(text);
    }
    return new Promise((resolve, reject) => {
      try {
        const textArea = document.createElement('textarea');
        textArea.value = text;
        textArea.style.position = 'fixed';
        textArea.style.left = '-999999px';
        textArea.style.top = '-999999px';
        document.body.appendChild(textArea);
        textArea.focus();
        textArea.select();
        const successful = document.execCommand('copy');
        document.body.removeChild(textArea);
        if (successful) resolve();
        else reject(new Error('execCommand failed'));
      } catch (err) {
        reject(err);
      }
    });
  }

  function shareMyTimetable() {
    const s1 = state.myTimetable['前期'] || [];
    const s2 = state.myTimetable['後期'] || [];
    const totalCount = s1.length + s2.length;

    if (totalCount === 0) {
      showToast('⚠️ 時間割に科目が登録されていません');
      return;
    }

    const payload = {
      v: 1,
      sem: state.mySemester,
      s1: s1,
      s2: s2
    };

    const hashStr = encodeTimetableHash(payload);
    if (!hashStr) {
      showToast('⚠️ 共有URLの生成に失敗しました');
      return;
    }

    const shareUrl = `${window.location.origin}${window.location.pathname}#tt=${hashStr}`;

    copyToClipboard(shareUrl).then(() => {
      showToast('📋 共有URLをクリップボードにコピーしました！');
    }).catch(() => {
      prompt('以下の共有URLをコピーして時間割を共有できます:', shareUrl);
    });
  }

  function checkSharedTimetableInUrl() {
    const hash = window.location.hash || '';
    if (!hash.startsWith('#tt=')) return;

    const hashPayload = hash.slice(4);
    if (!hashPayload) return;

    const data = decodeTimetableHash(hashPayload);
    if (!data || !Array.isArray(data.s1) || !Array.isArray(data.s2)) {
      showToast('⚠️ 共有URLの時間割データ形式が無効です');
      return;
    }

    const newCount1 = data.s1.length;
    const newCount2 = data.s2.length;
    const totalNew = newCount1 + newCount2;

    const currentCount = (state.myTimetable['前期'] || []).length + (state.myTimetable['後期'] || []).length;
    if (currentCount > 0) {
      const ok = confirm(`共有された時間割データが見つかりました（前期: ${newCount1}件, 後期: ${newCount2}件）。\n現在の時間割を上書きして読み込みますか？`);
      if (!ok) {
        history.replaceState(null, '', window.location.pathname + window.location.search);
        return;
      }
    }

    state.myTimetable['前期'] = data.s1;
    state.myTimetable['後期'] = data.s2;
    if (data.sem === '前期' || data.sem === '後期') {
      state.mySemester = data.sem;
    }
    state.conflictAck['前期'] = false;
    state.conflictAck['後期'] = false;
    state.conflictDismissed['前期'] = false;
    state.conflictDismissed['後期'] = false;

    saveMyTimetable();
    switchTab('my-timetable');
    renderMyTimetableTab();
    renderLessonsTab();

    showToast(`🎉 共有された時間割を取り込みました！（計 ${totalNew} 科目）`);
    history.replaceState(null, '', window.location.pathname + window.location.search);
  }

  // ----------------------------------------------------
  // データヘルパー関数
  // ----------------------------------------------------
  function getOccupyingLessons(semester, day, slot, roomName) {
    return DATA.lessons.filter(item => {
      const semMatch = (item.semester === semester || item.semester === '通年');
      if (!semMatch) return false;
      if (item.day !== day) return false;
      if (!item.slots || !Array.isArray(item.slots) || !item.slots.includes(slot)) return false;
      if (!item.rooms || !Array.isArray(item.rooms) || !item.rooms.includes(roomName)) return false;
      return true;
    });
  }

  function getRoomDaySchedule(semester, day, roomName) {
    const schedule = [];
    for (let s = 1; s <= 5; s++) {
      const lessons = getOccupyingLessons(semester, day, s, roomName);
      schedule.push({
        slot: s,
        isOccupied: lessons.length > 0,
        lessons: lessons
      });
    }
    return schedule;
  }

  function getCategoryName(key) {
    return (DATA.categories && DATA.categories[key]) ? DATA.categories[key] : 'その他';
  }

  function getSlotName(slotId) {
    const s = DATA.slots.find(item => item.id === slotId);
    return s ? `${s.name} (${s.time})` : `${slotId}限`;
  }

  function escapeHtml(str) {
    if (!str) return '';
    return String(str)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#039;');
  }

  function showToast(msg) {
    let toast = document.getElementById('app-toast');
    if (!toast) {
      toast = document.createElement('div');
      toast.id = 'app-toast';
      toast.style.cssText = `
        position: fixed;
        bottom: 24px;
        left: 50%;
        transform: translateX(-50%);
        background: #0f172a;
        color: #fff;
        padding: 10px 20px;
        border-radius: 9999px;
        font-size: 0.875rem;
        font-weight: 600;
        box-shadow: 0 10px 15px -3px rgba(0,0,0,0.3);
        z-index: 9999;
        transition: opacity 0.3s;
      `;
      document.body.appendChild(toast);
    }
    toast.textContent = msg;
    toast.style.opacity = '1';
    setTimeout(() => {
      toast.style.opacity = '0';
    }, 2500);
  }

  // ----------------------------------------------------
  // レンダリング: 空き教室を探す (TAB 1)
  // ----------------------------------------------------
  function renderFreeRoomsTab() {
    if (dom.currentCriteriaLabel) {
      dom.currentCriteriaLabel.textContent = `${state.semester} / ${state.day}曜日 / ${getSlotName(state.slot)}`;
    }

    let filteredRooms = DATA.rooms.filter(room => {
      if (state.category !== 'all' && room.category !== state.category) return false;
      if (state.searchQuery) {
        const query = state.searchQuery.toLowerCase();
        return room.name.toLowerCase().includes(query);
      }
      return true;
    });

    const roomStatuses = filteredRooms.map(room => {
      const occupiedLessons = getOccupyingLessons(state.semester, state.day, state.slot, room.name);
      const isOccupied = occupiedLessons.length > 0;
      const daySchedule = getRoomDaySchedule(state.semester, state.day, room.name);
      return {
        room: room,
        isOccupied: isOccupied,
        occupiedLessons: occupiedLessons,
        daySchedule: daySchedule
      };
    });

    const freeCount = roomStatuses.filter(r => !r.isOccupied).length;
    const occupiedCount = roomStatuses.filter(r => r.isOccupied).length;
    const totalCount = roomStatuses.length;

    if (dom.countFree) dom.countFree.textContent = freeCount;
    if (dom.countOccupied) dom.countOccupied.textContent = occupiedCount;
    if (dom.countTotal) dom.countTotal.textContent = totalCount;

    const displayRooms = state.showOccupied
      ? roomStatuses
      : roomStatuses.filter(r => !r.isOccupied);

    displayRooms.sort((a, b) => {
      if (a.isOccupied !== b.isOccupied) return a.isOccupied ? 1 : -1;
      return a.room.name.localeCompare(b.room.name, 'ja');
    });

    if (!dom.roomsGrid) return;
    dom.roomsGrid.innerHTML = '';

    if (displayRooms.length === 0) {
      dom.roomsGrid.innerHTML = `
        <div class="card" style="grid-column: 1 / -1; text-align: center; padding: 40px; color: var(--text-muted);">
          <div style="font-size: 2rem; margin-bottom: 8px;">🔍</div>
          <p>該当する教室が見つかりませんでした。絞り込み条件を変更してください。</p>
        </div>
      `;
      return;
    }

    displayRooms.forEach(item => {
      const card = document.createElement('div');
      card.className = `room-card ${item.isOccupied ? 'status-occupied' : 'status-free'}`;

      const miniSlotsHtml = item.daySchedule.map(s => {
        const isCurrent = s.slot === state.slot;
        const cls = s.isOccupied ? 'is-occupied' : 'is-free';
        const currCls = isCurrent ? 'is-current' : '';
        const title = s.isOccupied
          ? `${s.slot}コマ目: 使用中 (${s.lessons.map(l => l.name).join(', ')})`
          : `${s.slot}コマ目: 空き`;
        return `
          <div class="mini-slot ${cls} ${currCls}" title="${escapeHtml(title)}">
            <span>${s.slot * 2 - 1}・${s.slot * 2}</span>
            <span>${s.isOccupied ? '×' : '〇'}</span>
          </div>
        `;
      }).join('');

      let occupiedDetailHtml = '';
      if (item.isOccupied) {
        const l = item.occupiedLessons[0];
        occupiedDetailHtml = `
          <div class="occupied-info">
            <div class="occupied-lesson-name">📖 ${escapeHtml(l.name)}</div>
            <div class="occupied-lesson-teacher">👨‍🏫 ${escapeHtml(l.teacher || '担当者記載なし')}</div>
          </div>
        `;
      } else {
        occupiedDetailHtml = `
          <div style="font-size: 0.825rem; color: var(--success); font-weight: 600;">
            ✅ この時間は自習・利用可能です
          </div>
        `;
      }

      card.innerHTML = `
        <div class="room-card-header">
          <div>
            <div class="room-title">${escapeHtml(item.room.name)}</div>
            <span class="room-category-badge">${getCategoryName(item.room.category)}</span>
          </div>
          <span class="status-pill ${item.isOccupied ? 'occupied' : 'free'}">
            ${item.isOccupied ? '使用中' : '空き教室'}
          </span>
        </div>

        ${occupiedDetailHtml}

        <div style="margin-top: 4px;">
          <div style="font-size: 0.725rem; color: var(--text-muted); margin-bottom: 2px;">
            ${state.day}曜日の終日状況:
          </div>
          <div class="day-slots-mini">
            ${miniSlotsHtml}
          </div>
        </div>
      `;

      card.addEventListener('click', () => {
        state.selectedRoom = item.room.name;
        if (dom.timetableRoomSelect) dom.timetableRoomSelect.value = item.room.name;
        switchTab('timetable');
      });

      dom.roomsGrid.appendChild(card);
    });
  }

  // ----------------------------------------------------
  // レンダリング: 教室別タイムテーブル (TAB 2)
  // ----------------------------------------------------
  function renderTimetableTab() {
    const roomName = state.selectedRoom || '101教室';
    if (dom.timetableRoomName) {
      dom.timetableRoomName.textContent = `${roomName} の週間利用状況 (${state.semester})`;
    }

    const roomObj = DATA.rooms.find(r => r.name === roomName);
    if (dom.timetableRoomCat) {
      dom.timetableRoomCat.textContent = roomObj ? getCategoryName(roomObj.category) : '教室';
    }

    document.querySelectorAll('.quick-chip').forEach(chip => {
      chip.classList.toggle('active', chip.dataset.room === roomName);
    });

    if (!dom.timetableTbody) return;
    dom.timetableTbody.innerHTML = '';

    DATA.slots.forEach(slot => {
      const tr = document.createElement('tr');
      const tdTime = document.createElement('td');
      tdTime.className = 'time-col';
      tdTime.innerHTML = `<div>${escapeHtml(slot.name)}</div><span class="time-span">${escapeHtml(slot.time)}</span>`;
      tr.appendChild(tdTime);

      DATA.days.forEach(day => {
        const td = document.createElement('td');
        const occupying = getOccupyingLessons(state.semester, day, slot.id, roomName);

        if (occupying.length === 0) {
          td.className = 'timetable-cell is-free';
          td.innerHTML = `<span>🟢 空き</span>`;
        } else {
          td.className = 'timetable-cell is-occupied';
          td.innerHTML = occupying.map(lesson => `
            <div class="tt-lesson-item" data-lesson-id="${escapeHtml(lesson.id)}">
              <div class="tt-lesson-name">${escapeHtml(lesson.name)}</div>
              <div class="tt-lesson-meta">👨‍🏫 ${escapeHtml(lesson.teacher || '')}</div>
              <div class="tt-lesson-meta" style="font-size: 0.725rem; color: var(--text-muted);">${escapeHtml(lesson.id)} (${escapeHtml(lesson.credit || '')}単位)</div>
            </div>
          `).join('<hr style="margin: 6px 0; border: none; border-top: 1px dashed #cbd5e1;">');

          td.querySelectorAll('.tt-lesson-item').forEach((itemEl, idx) => {
            itemEl.addEventListener('click', (e) => {
              e.stopPropagation();
              openLessonModal(occupying[idx]);
            });
          });
        }

        tr.appendChild(td);
      });

      dom.timetableTbody.appendChild(tr);
    });
  }

  // ----------------------------------------------------
  // レンダリング: 全体稼働マトリクス (TAB 3)
  // ----------------------------------------------------
  function renderMatrixTab() {
    if (!dom.matrixTable) return;

    let filteredRooms = DATA.rooms.filter(room => {
      if (state.matrixCategory !== 'all' && room.category !== state.matrixCategory) return false;
      return true;
    });

    let html = `<thead><tr><th class="room-name-th">教室名 \\ 曜日・時限</th>`;
    DATA.days.forEach(day => {
      DATA.slots.forEach(slot => {
        html += `<th>${day}<br>${escapeHtml(slot.name.replace('限', ''))}</th>`;
      });
    });
    html += `</tr></thead><tbody>`;

    filteredRooms.forEach(room => {
      html += `<tr><th class="room-name-th">${escapeHtml(room.name)}</th>`;
      DATA.days.forEach(day => {
        DATA.slots.forEach(slot => {
          const occ = getOccupyingLessons(state.semester, day, slot.id, room.name);
          if (occ.length === 0) {
            html += `<td class="matrix-cell free" title="${escapeHtml(room.name)} ${day}曜 ${escapeHtml(slot.name)}: 空き">空</td>`;
          } else if (occ.length === 1) {
            const lesson = occ[0];
            const title = `${room.name} ${day}曜 ${slot.name}: ${lesson.name} (${lesson.teacher || ''})`;
            html += `<td class="matrix-cell occupied" title="${escapeHtml(title)}" onclick="window.__showLessonById('${escapeHtml(lesson.id)}')">${escapeHtml(lesson.name)}</td>`;
          } else {
            const count = occ.length;
            const names = occ.map(l => l.name).join(' / ');
            const title = `${room.name} ${day}曜 ${slot.name} [${count}件登録]: ${names} (クリックして科目を選択)`;
            html += `<td class="matrix-cell occupied multiple" title="${escapeHtml(title)}" onclick="window.__showLessonSelect('${escapeHtml(room.name)}', '${day}', ${slot.id})"><span class="badge-multi">[${count}件]</span>${escapeHtml(occ.map(l => l.name).join(' / '))}</td>`;
          }
        });
      });
      html += `</tr>`;
    });

    html += `</tbody>`;
    dom.matrixTable.innerHTML = html;
  }

  window.__showLessonById = function (id) {
    const l = DATA.lessons.find(item => item.id === id);
    if (l) openLessonModal(l);
  };

  window.__showLessonSelect = function (roomName, day, slotId) {
    const occ = getOccupyingLessons(state.semester, day, slotId, roomName);
    if (occ.length === 0) return;
    if (occ.length === 1) {
      openLessonModal(occ[0]);
      return;
    }
    openLessonSelectModal(roomName, day, slotId, occ);
  };

  // 複数科目選択モーダル (シンプル構成 + 各科目の枠囲い)
  function openLessonSelectModal(roomName, day, slotId, lessons) {
    if (!dom.lessonSelectModal || !dom.modalSelectTitle || !dom.modalSelectList) return;

    dom.modalSelectTitle.innerHTML = `${escapeHtml(roomName)} の開講科目（全${lessons.length}件）`;

    if (dom.modalSelectDesc) {
      dom.modalSelectDesc.textContent = `${state.semester}・${day}曜 ${getSlotName(slotId)} に登録されている科目です。詳細を見る科目を選択してください：`;
    }

    dom.modalSelectList.innerHTML = '';
    lessons.forEach(l => {
      const card = document.createElement('div');
      card.className = 'lesson-select-card';
      card.innerHTML = `
        <div class="select-card-name">📖 ${escapeHtml(l.name)}</div>
        <div class="select-card-meta">
          <span>👨‍🏫 ${escapeHtml(l.teacher || '担当者記載なし')}</span>
          <span>時間割番号: ${escapeHtml(l.id)}</span>
          <span>${escapeHtml(l.periodRaw || '')}</span>
        </div>
      `;
      card.addEventListener('click', () => {
        dom.lessonSelectModal.classList.remove('show');
        openLessonModal(l);
      });
      dom.modalSelectList.appendChild(card);
    });

    dom.lessonSelectModal.classList.add('show');
  }

  // ----------------------------------------------------
  // レンダリング: 科目全件検索 (TAB 4)
  // ----------------------------------------------------
  function renderLessonsTab() {
    if (!dom.lessonsTbody) return;

    const f = state.lessonFilter;
    const q = f.q.toLowerCase().trim();

    // フィルタリング
    let filtered = DATA.lessons.filter(l => {
      if (f.sem !== 'all') {
        if (f.sem === '前期' && l.semester !== '前期' && l.semester !== '通年') return false;
        if (f.sem === '後期' && l.semester !== '後期' && l.semester !== '通年') return false;
        if (f.sem === '通年' && l.semester !== '通年') return false;
      }

      if (f.day !== 'all' && l.day !== f.day) return false;

      if (f.slot !== 'all') {
        const slotNum = parseInt(f.slot, 10);
        if (!l.slots || !l.slots.includes(slotNum)) return false;
      }

      if (f.cat !== 'all') {
        if (f.cat === 'online') {
          const hasOnline = (l.rooms || []).includes('オンライン') || (l.name || '').includes('オンライン');
          if (!hasOnline) return false;
        } else {
          const matchCat = (l.rooms || []).some(roomName => {
            const rObj = DATA.rooms.find(r => r.name === roomName);
            return rObj && rObj.category === f.cat;
          });
          if (!matchCat) return false;
        }
      }

      // AND検索対応 (全角半角スペース区切りで全語を含む)
      if (q) {
        const words = q.split(/[\s\u3000]+/).filter(w => w.length > 0);
        if (words.length > 0) {
          const allMatch = words.every(word => {
            return (l.name || '').toLowerCase().includes(word) ||
                   (l.teacher || '').toLowerCase().includes(word) ||
                   (l.rooms || []).some(r => r.toLowerCase().includes(word)) ||
                   (l.id || '').toLowerCase().includes(word) ||
                   (l.eval || '').toLowerCase().includes(word);
          });
          if (!allMatch) return false;
        }
      }

      return true;
    });

    // 並べ替えは「曜日時限」と「時間割番号」のみ
    const sortField = state.lessonSort.field;
    const sortOrder = state.lessonSort.order === 'desc' ? -1 : 1;

    filtered.sort((a, b) => {
      if (sortField === 'daySlot') {
        const dScoreA = DAY_ORDER_MAP[a.day] || 9;
        const sScoreA = (a.slots && a.slots.length > 0) ? a.slots[0] : (a.day === '集中' ? 98 : 99);
        const scoreA = dScoreA * 100 + sScoreA;

        const dScoreB = DAY_ORDER_MAP[b.day] || 9;
        const sScoreB = (b.slots && b.slots.length > 0) ? b.slots[0] : (b.day === '集中' ? 98 : 99);
        const scoreB = dScoreB * 100 + sScoreB;

        return (scoreA - scoreB) * sortOrder;
      } else {
        const idA = a.id || '';
        const idB = b.id || '';
        return idA.localeCompare(idB, 'ja') * sortOrder;
      }
    });

    if (dom.lessonResultsCount) dom.lessonResultsCount.textContent = filtered.length;
    if (dom.lessonTotalCount) dom.lessonTotalCount.textContent = DATA.lessons.length;

    document.querySelectorAll('.sortable-th').forEach(th => {
      const field = th.dataset.sort;
      const isActive = (field === state.lessonSort.field);
      th.classList.toggle('active', isActive);
      const icon = th.querySelector('.sort-icon');
      if (icon) {
        if (!isActive) {
          icon.textContent = '↕';
        } else {
          icon.textContent = state.lessonSort.order === 'asc' ? '▲' : '▼';
        }
      }
    });

    dom.lessonSemBtns.forEach(btn => {
      btn.classList.toggle('active', btn.dataset.sem === state.lessonFilter.sem);
    });

    let rowsHtml = '';
    const myLessonsPre = state.myTimetable['前期'] || [];
    const myLessonsPost = state.myTimetable['後期'] || [];

    filtered.forEach(l => {
      const isAdded = myLessonsPre.includes(l.id) || myLessonsPost.includes(l.id);

      rowsHtml += `
        <tr data-lesson-id="${escapeHtml(l.id)}">
          <td style="text-align: center;">
            <button type="button" class="btn-star ${isAdded ? 'is-added' : ''}" onclick="window.__toggleMyLesson('${escapeHtml(l.id)}', event)" title="${isAdded ? 'My時間割から削除' : 'My時間割に追加'}">
              ${isAdded ? '★' : '☆'}
            </button>
          </td>
          <td style="font-family: monospace; font-weight: 600;">${escapeHtml(l.id)}</td>
          <td><span class="badge">${escapeHtml(l.semester)}</span></td>
          <td><strong>${escapeHtml(l.day || '')}</strong> ${escapeHtml(l.periodRaw || '')}</td>
          <td style="font-weight: 600; color: #1e40af; cursor: pointer;" onclick="window.__showLessonById('${escapeHtml(l.id)}')">${escapeHtml(l.name)}</td>
          <td>${escapeHtml((l.rooms || []).join(', '))}</td>
          <td>${escapeHtml(l.teacher || '')}</td>
        </tr>
      `;
    });

    dom.lessonsTbody.innerHTML = rowsHtml || `<tr><td colspan="7" style="text-align: center; color: var(--text-muted); padding: 40px;">該当する科目が見つかりませんでした。条件を変更してください。</td></tr>`;
  }

  window.__toggleMyLesson = function (lessonId, event) {
    if (event) event.stopPropagation();
    toggleLessonInMyTimetable(lessonId);
  };

  // ----------------------------------------------------
  // レンダリング: My時間割 (TAB 5)
  // ----------------------------------------------------
  function calcCredits(lessons) {
    let cap = 0;
    let total = 0;
    lessons.forEach(l => {
      const cr = parseFloat(l.credit) || 0;
      total += cr;
      if (!isCapExempt(l)) {
        cap += cr;
      }
    });
    return { cap, total };
  }

  function renderMyTimetableTab() {
    if (!dom.myTimetableTbody) return;

    const currentSem = state.mySemester;
    const lessonIds = state.myTimetable[currentSem] || [];
    const registeredLessons = lessonIds.map(id => DATA.lessons.find(l => l.id === id)).filter(Boolean);

    // 1. 学期内単位の集計 (CAP対象単位数 / 総単位数)
    const semCredits = calcCredits(registeredLessons);
    if (dom.myStatCount) dom.myStatCount.textContent = registeredLessons.length;
    if (dom.myStatCreditsCap) dom.myStatCreditsCap.textContent = semCredits.cap;
    if (dom.myStatCreditsTotal) dom.myStatCreditsTotal.textContent = semCredits.total;

    // 2. 年間合計（通年）の集計
    // 前期登録分 + 後期登録分（通年科目など同一科目が両学期にあっても1回だけ集計）
    const allYearIds = Array.from(new Set([
      ...(state.myTimetable['前期'] || []),
      ...(state.myTimetable['後期'] || [])
    ]));
    const allYearLessons = allYearIds.map(id => DATA.lessons.find(l => l.id === id)).filter(Boolean);
    const yearCredits = calcCredits(allYearLessons);

    if (dom.myYearCreditsCap) dom.myYearCreditsCap.textContent = yearCredits.cap;
    if (dom.myYearCreditsTotal) dom.myYearCreditsTotal.textContent = yearCredits.total;

    // 学期切り替えボタンのUI更新
    dom.mySemBtns.forEach(btn => {
      btn.classList.toggle('active', btn.dataset.mySem === currentSem);
    });

    // スロット配置の辞書作成 & 重複検出
    const slotMap = {};
    const specialLessons = [];
    const conflictGroups = {}; // key -> [lessons]

    registeredLessons.forEach(l => {
      if (l.day === '集中' || !l.slots || l.slots.length === 0) {
        specialLessons.push(l);
      } else {
        l.slots.forEach(s => {
          const key = `${l.day}_${s}`;
          if (!slotMap[key]) slotMap[key] = [];
          slotMap[key].push(l);
          if (slotMap[key].length > 1) {
            conflictGroups[key] = slotMap[key];
          }
        });
      }
    });

    state.currentConflicts = conflictGroups;
    const conflictCount = Object.keys(conflictGroups).length;
    const isConflict = conflictCount > 0;
    const isAck = !!state.conflictAck[currentSem];
    const isDismissed = !!state.conflictDismissed[currentSem];

    // 重複警告バー & 再表示ボタンの更新
    if (!isConflict) {
      if (dom.myConflictAlert) dom.myConflictAlert.style.display = 'none';
      if (dom.btnReopenConflict) dom.btnReopenConflict.style.display = 'none';
      state.conflictAck[currentSem] = false;
      state.conflictDismissed[currentSem] = false;
    } else {
      if (isDismissed) {
        if (dom.myConflictAlert) dom.myConflictAlert.style.display = 'none';
        if (dom.btnReopenConflict) {
          dom.btnReopenConflict.style.display = 'inline-flex';
          if (isAck) {
            dom.btnReopenConflict.innerHTML = '🟢 重複確認済み (詳細)';
            dom.btnReopenConflict.style.borderColor = '#86efac';
            dom.btnReopenConflict.style.color = '#166534';
            dom.btnReopenConflict.style.background = '#f0fdf4';
          } else {
            dom.btnReopenConflict.innerHTML = '⚠️ 重複あり (詳細)';
            dom.btnReopenConflict.style.borderColor = '#f59e0b';
            dom.btnReopenConflict.style.color = '#b45309';
            dom.btnReopenConflict.style.background = '#fffbeb';
          }
        }
      } else {
        if (dom.btnReopenConflict) dom.btnReopenConflict.style.display = 'none';
        if (dom.myConflictAlert) {
          dom.myConflictAlert.style.display = 'block';
          if (isAck) {
            dom.myConflictAlert.classList.add('is-acknowledged');
            if (dom.conflictAlertIcon) dom.conflictAlertIcon.textContent = '🟢';
            if (dom.conflictAlertText) dom.conflictAlertText.innerHTML = `<strong>重複確認済み:</strong> ${conflictCount}箇所の重複を確認済みです`;
          } else {
            dom.myConflictAlert.classList.remove('is-acknowledged');
            if (dom.conflictAlertIcon) dom.conflictAlertIcon.textContent = '⚠️';
            if (dom.conflictAlertText) dom.conflictAlertText.innerHTML = `<strong>重複警告:</strong> ${conflictCount}箇所のコマに複数の科目が登録されています！`;
          }
        }
      }
    }

    // テーブル生成
    dom.myTimetableTbody.innerHTML = '';
    DATA.slots.forEach(slot => {
      const tr = document.createElement('tr');
      const tdTime = document.createElement('td');
      tdTime.className = 'time-col';
      tdTime.innerHTML = `<div>${escapeHtml(slot.name)}</div><span class="time-span">${escapeHtml(slot.time)}</span>`;
      tr.appendChild(tdTime);

      DATA.days.forEach(day => {
        const td = document.createElement('td');
        const key = `${day}_${slot.id}`;
        const lessons = slotMap[key] || [];

        if (lessons.length === 0) {
          td.className = 'timetable-cell my-tt-cell is-empty';
          td.innerHTML = `
            <button type="button" class="my-tt-empty-btn" onclick="window.__openSlotPicker('${day}', ${slot.id})">
              <span style="font-size: 1.1rem; line-height: 1;">＋</span>
              <span>科目を追加</span>
            </button>
          `;
        } else {
          td.className = 'timetable-cell my-tt-cell';
          const hasSlotConflict = lessons.length > 1;

          let cardsHtml = lessons.map(l => {
            const conflictClass = (hasSlotConflict && !isAck) ? 'is-conflict' : '';
            return `
              <div class="my-lesson-card ${conflictClass}">
                <div class="my-lesson-title" onclick="window.__showLessonById('${escapeHtml(l.id)}')">
                  ${hasSlotConflict ? (isAck ? '🟢 ' : '⚠️ ') : ''}${escapeHtml(l.name)}
                </div>
                <div class="my-lesson-details">
                  <span>🏢 ${escapeHtml((l.rooms || []).join(', ') || '教室未定')}</span>
                  <span>👨‍🏫 ${escapeHtml(l.teacher || '')}</span>
                </div>
                <div class="my-lesson-actions">
                  <span style="font-size: 0.725rem; color: var(--text-muted);">${escapeHtml(l.id)}</span>
                  <button type="button" class="my-del-btn" onclick="window.__toggleMyLesson('${escapeHtml(l.id)}', event)">🗑️ 削除</button>
                </div>
              </div>
            `;
          }).join('');

          cardsHtml += `
            <button type="button" class="my-tt-add-more-btn" onclick="window.__openSlotPicker('${day}', ${slot.id})">
              ＋ 科目をさらに追加
            </button>
          `;

          td.innerHTML = cardsHtml;
        }

        tr.appendChild(td);
      });

      dom.myTimetableTbody.appendChild(tr);
    });

    // 集中講義・その他登録リスト
    if (dom.mySpecialCount) dom.mySpecialCount.textContent = specialLessons.length;
    if (dom.mySpecialList) {
      if (specialLessons.length === 0) {
        dom.mySpecialList.innerHTML = `<div class="empty-hint">集中講義などの登録科目はありません。</div>`;
      } else {
        dom.mySpecialList.innerHTML = specialLessons.map(l => {
          return `
            <div class="card my-lesson-card" style="margin: 0;">
              <div class="my-lesson-title" onclick="window.__showLessonById('${escapeHtml(l.id)}')">
                📌 ${escapeHtml(l.name)}
              </div>
              <div class="my-lesson-details" style="margin-top: 4px;">
                <span>開講: ${escapeHtml(l.semester)} / ${escapeHtml(l.day || '')} (${escapeHtml(l.credit || '-')}単位)</span>
                <span>担当: ${escapeHtml(l.teacher || '未定')}</span>
              </div>
              <div class="my-lesson-actions" style="margin-top: 8px;">
                <span style="font-size: 0.75rem; color: var(--text-muted);">${escapeHtml(l.id)}</span>
                <button type="button" class="my-del-btn" onclick="window.__toggleMyLesson('${escapeHtml(l.id)}', event)">🗑️ 削除</button>
              </div>
            </div>
          `;
        }).join('');
      }
    }
  }

  // 重複詳細モーダルを開く
  function openConflictDetailsModal() {
    if (!dom.conflictDetailsModal || !dom.conflictDetailsList) return;

    const currentSem = state.mySemester;
    const groups = state.currentConflicts || {};
    const keys = Object.keys(groups);

    if (keys.length === 0) {
      dom.conflictDetailsList.innerHTML = `<div class="empty-hint" style="text-align: center; padding: 20px;">現在重複しているコマはありません。</div>`;
    } else {
      dom.conflictDetailsList.innerHTML = keys.map(key => {
        const [day, slotId] = key.split('_');
        const slotObj = DATA.slots.find(s => s.id === parseInt(slotId, 10));
        const slotName = slotObj ? `${slotObj.name} (${slotObj.time})` : `${slotId}コマ目`;
        const lessons = groups[key];

        const lessonsHtml = lessons.map(l => `
          <div class="conflict-lesson-item">
            <div style="font-weight: 700; color: #1e293b;">${escapeHtml(l.name)}</div>
            <div style="font-size: 0.775rem; color: var(--text-secondary); margin-top: 2px;">
              時間割番号: ${escapeHtml(l.id)} | 担当: ${escapeHtml(l.teacher || '未定')} | 教室: ${escapeHtml((l.rooms || []).join(', ') || '未定')}
            </div>
          </div>
        `).join('');

        return `
          <div class="conflict-group-box">
            <div class="conflict-group-title">
              <span>📅 ${escapeHtml(day)}曜日 ${escapeHtml(slotName)}</span>
              <span class="badge" style="background: #fee2e2; color: #b91c1c;">${lessons.length}科目重複</span>
            </div>
            ${lessonsHtml}
          </div>
        `;
      }).join('');
    }

    const isAck = !!state.conflictAck[currentSem];
    if (dom.btnModalConflictToggle) {
      dom.btnModalConflictToggle.textContent = isAck ? '取消' : '確認';
      dom.btnModalConflictToggle.className = isAck ? 'btn btn-outline text-danger' : 'btn btn-primary';
    }

    dom.conflictDetailsModal.classList.add('show');
  }

  // 重複の確認／取消トグル
  function toggleConflictAck() {
    const sem = state.mySemester;
    state.conflictAck[sem] = !state.conflictAck[sem];

    if (state.conflictAck[sem]) {
      // 確認した後は警告バーを非表示にする（上部に再表示ボタンを配置）
      state.conflictDismissed[sem] = true;
      showToast(`${sem}の重複を確認しました（警告バーを非表示にしました）`);
    } else {
      // 取消した場合は警告バーを再表示する
      state.conflictDismissed[sem] = false;
      showToast(`${sem}の重複確認を取り消しました`);
    }

    saveMyTimetable();
    renderMyTimetableTab();

    if (dom.conflictDetailsModal && dom.conflictDetailsModal.classList.contains('show')) {
      openConflictDetailsModal();
    }
  }

  // ----------------------------------------------------
  // モーダル: コマから科目を選択・追加 (Slot Picker)
  // ----------------------------------------------------
  window.__openSlotPicker = function (day, slotId) {
    state.activeSlotPicker = { day, slotId };
    if (!dom.slotPickerModal || !dom.slotPickerTitle || !dom.slotPickerList) return;

    const currentSem = state.mySemester;
    dom.slotPickerTitle.textContent = `${currentSem} / ${day}曜 ${getSlotName(slotId)}`;
    if (dom.slotPickerSubtitle) {
      dom.slotPickerSubtitle.textContent = `この日時に開講されている科目から選択して時間割に追加できます`;
    }

    if (dom.slotPickerSearch) {
      dom.slotPickerSearch.value = '';
    }

    renderSlotPickerList();
    dom.slotPickerModal.classList.add('show');
  };

  // 集中講義・コマ未定の科目追加モーダルを開く
  window.__openSpecialLessonPicker = function () {
    state.activeSlotPicker = { isSpecial: true };
    if (!dom.slotPickerModal || !dom.slotPickerTitle || !dom.slotPickerList) return;

    const currentSem = state.mySemester;
    dom.slotPickerTitle.textContent = `${currentSem} / 集中講義・その他`;
    if (dom.slotPickerSubtitle) {
      dom.slotPickerSubtitle.textContent = `集中講義や開講日時がコマに指定されていない科目から選択して時間割に追加できます`;
    }

    if (dom.slotPickerSearch) {
      dom.slotPickerSearch.value = '';
    }

    renderSlotPickerList();
    dom.slotPickerModal.classList.add('show');
  };

  function renderSlotPickerList() {
    if (!state.activeSlotPicker || !dom.slotPickerList) return;
    const isSpecial = !!state.activeSlotPicker.isSpecial;
    const { day, slotId } = state.activeSlotPicker;
    const currentSem = state.mySemester;
    const query = dom.slotPickerSearch ? dom.slotPickerSearch.value.trim().toLowerCase() : '';

    let availableLessons = DATA.lessons.filter(l => {
      const semMatch = (l.semester === currentSem || l.semester === '通年');
      if (!semMatch) return false;

      if (isSpecial) {
        const isSpecialLesson = (l.day === '集中' || !l.slots || l.slots.length === 0);
        if (!isSpecialLesson) return false;
      } else {
        if (l.day !== day) return false;
        if (!l.slots || !l.slots.includes(slotId)) return false;
      }

      if (query) {
        const words = query.split(/[\s\u3000]+/).filter(w => w.length > 0);
        if (words.length > 0) {
          const allMatch = words.every(w => {
            return (l.name || '').toLowerCase().includes(w) ||
                   (l.teacher || '').toLowerCase().includes(w) ||
                   (l.rooms || []).some(r => r.toLowerCase().includes(w)) ||
                   (l.id || '').toLowerCase().includes(w);
          });
          if (!allMatch) return false;
        }
      }

      return true;
    });

    if (availableLessons.length === 0) {
      dom.slotPickerList.innerHTML = `<div class="empty-hint" style="text-align: center; padding: 24px;">該当する科目が見つかりません。</div>`;
      return;
    }

    const currentMyIds = state.myTimetable[currentSem] || [];

    dom.slotPickerList.innerHTML = availableLessons.map(l => {
      const isAdded = currentMyIds.includes(l.id);
      const capTag = isCapExempt(l) ? '<span class="badge" style="background: #f1f5f9; color: #64748b; font-size: 0.7rem; margin-left: 4px;">CAP対象外</span>' : '';

      return `
        <div class="slot-picker-item">
          <div style="flex: 1; min-width: 0;">
            <div style="font-weight: 700; color: #1e293b; font-size: 0.95rem; margin-bottom: 2px;">
              ${escapeHtml(l.name)} ${capTag}
            </div>
            <div style="font-size: 0.8rem; color: var(--text-secondary); display: flex; flex-wrap: wrap; gap: 8px;">
              <span>開講: ${escapeHtml(l.semester)} / ${escapeHtml(l.day || '')} (${escapeHtml(l.credit || '-')}単位)</span>
              <span>🏢 ${escapeHtml((l.rooms || []).join(', ') || '教室未定')}</span>
              <span>👨‍🏫 ${escapeHtml(l.teacher || '担当記載なし')}</span>
              <span style="font-family: monospace; color: var(--text-muted);">${escapeHtml(l.id)}</span>
            </div>
          </div>
          <button type="button" class="slot-picker-btn ${isAdded ? 'is-added' : ''}" onclick="window.__toggleAndRefreshSlotPicker('${escapeHtml(l.id)}')">
            ${isAdded ? '✓ 登録中 (削除)' : '＋ 追加'}
          </button>
        </div>
      `;
    }).join('');
  }

  window.__toggleAndRefreshSlotPicker = function (lessonId) {
    toggleLessonInMyTimetable(lessonId);
    renderSlotPickerList();
  };

  // ----------------------------------------------------
  // モーダル: 講義詳細
  // ----------------------------------------------------
  function openLessonModal(lesson) {
    if (!dom.modalLessonTitle || !dom.modalLessonBody || !dom.lessonModal) return;

    const rawId = (lesson && lesson.id) ? String(lesson.id).trim() : '';
    const formattedId = rawId.startsWith('G') ? rawId : `G${rawId}`;
    const syllabusUrl = formattedId
      ? `https://www.nara-edu.ac.jp/ADMIN/KYOUMU/SYLLABUS/syllabus/2026/detail/2026_01_${formattedId}.html`
      : 'https://www.nara-edu.ac.jp/ADMIN/KYOUMU/SYLLABUS/syllabus/2026/';

    const syllabusLink = document.getElementById('modal-syllabus-link') || dom.modalSyllabusLink;
    if (syllabusLink) {
      syllabusLink.href = syllabusUrl;
      syllabusLink.setAttribute('href', syllabusUrl);
      syllabusLink.onclick = function (e) {
        e.stopPropagation();
        window.open(syllabusUrl, '_blank');
        return false;
      };
    }

    const isAdded = isLessonInMyTimetable(lesson.id);

    dom.modalLessonTitle.textContent = lesson.name;
    dom.modalLessonBody.innerHTML = `
      <div class="detail-grid">
        <div class="detail-item">
          <div class="detail-item-label">時間割番号</div>
          <div class="detail-item-val">${escapeHtml(lesson.id)}</div>
        </div>
        <div class="detail-item">
          <div class="detail-item-label">開講区分・単位</div>
          <div class="detail-item-val">${escapeHtml(lesson.semester)} / ${escapeHtml(lesson.credit || '-')} 単位</div>
        </div>
        <div class="detail-item">
          <div class="detail-item-label">日時</div>
          <div class="detail-item-val">${escapeHtml(lesson.day)}曜 ${escapeHtml(lesson.periodRaw)}</div>
        </div>
        <div class="detail-item">
          <div class="detail-item-label">使用教室</div>
          <div class="detail-item-val" style="color: var(--primary); font-weight: 700;">
            ${escapeHtml((lesson.rooms || []).join(', ') || '指定なし')}
          </div>
        </div>
        <div class="detail-item" style="grid-column: 1 / -1;">
          <div class="detail-item-label">担当教員</div>
          <div class="detail-item-val">${escapeHtml(lesson.teacher || '記載なし')}</div>
        </div>
      </div>

      <div>
        <div class="detail-item-label" style="margin-bottom: 6px;">成績評価方法・シラバス備考</div>
        <div class="eval-box">${escapeHtml(lesson.eval || 'シラバスに評価方法の記載がありません。')}</div>
      </div>

      <div style="display: flex; justify-content: space-between; align-items: center; margin-top: 10px; flex-wrap: wrap; gap: 8px;">
        <button type="button" class="btn-star-modal ${isAdded ? 'is-added' : ''}" id="btn-modal-star">
          ${isAdded ? '★ My時間割から削除' : '☆ My時間割に追加'}
        </button>

        <button type="button" class="btn btn-primary" id="btn-modal-view-room" style="font-size: 0.85rem;">
          この教室の時間割を見る ➔
        </button>
      </div>
    `;

    document.getElementById('btn-modal-star').addEventListener('click', () => {
      toggleLessonInMyTimetable(lesson.id);
      openLessonModal(lesson);
    });

    document.getElementById('btn-modal-view-room').addEventListener('click', () => {
      dom.lessonModal.classList.remove('show');
      if (lesson.rooms && lesson.rooms.length > 0) {
        state.selectedRoom = lesson.rooms[0];
        if (dom.timetableRoomSelect) dom.timetableRoomSelect.value = lesson.rooms[0];
        switchTab('timetable');
      }
    });

    dom.lessonModal.classList.add('show');
  }

  // ----------------------------------------------------
  // 「今すぐ使える教室」クイックジャンプ
  // ----------------------------------------------------
  function jumpToCurrentSlot() {
    const now = new Date();
    const dayMap = ['日', '月', '火', '水', '木', '金', '土'];
    const currentDay = dayMap[now.getDay()];

    const hours = now.getHours();
    const minutes = now.getMinutes();
    const currentMinutes = hours * 60 + minutes;

    let determinedSlot = 1;
    if (currentMinutes < 635) {
      determinedSlot = 1;
    } else if (currentMinutes < 750) {
      determinedSlot = 2;
    } else if (currentMinutes < 875) {
      determinedSlot = 3;
    } else if (currentMinutes < 975) {
      determinedSlot = 4;
    } else {
      determinedSlot = 5;
    }

    if (['月', '火', '水', '木', '金'].includes(currentDay)) {
      state.day = currentDay;
    } else {
      state.day = '月';
    }
    state.slot = determinedSlot;

    const month = now.getMonth() + 1;
    state.semester = (month >= 4 && month <= 9) ? '前期' : '後期';

    updateUISelectors();
    switchTab('free-rooms');
    renderFreeRoomsTab();

    showToast(`現在時刻（${state.semester}・${state.day}曜 ${getSlotName(state.slot)}）に切り替えました！`);
  }

  function updateUISelectors() {
    dom.semBtns.forEach(btn => {
      btn.classList.toggle('active', btn.dataset.sem === state.semester);
    });
    dom.dayBtns.forEach(btn => {
      btn.classList.toggle('active', btn.dataset.day === state.day);
    });
    dom.slotBtns.forEach(btn => {
      btn.classList.toggle('active', parseInt(btn.dataset.slot, 10) === state.slot);
    });
  }



// ====================================================
// 履修基準・計画 (Curriculum & Study Plan) 完全版ロジック
// ====================================================

function normalizeSubName(s) {
  if (!s) return '';
  return String(s)
    .trim()
    .replace(/[（［【]/g, '(')
    .replace(/[）］】]/g, ')')
    .replace(/[　\s]+/g, '')
    .replace(/Ⅰ/g, 'I')
    .replace(/Ⅱ/g, 'II')
    .replace(/Ⅲ/g, 'III')
    .replace(/Ⅳ/g, 'IV')
    .replace(/Ⅴ/g, 'V')
    .toLowerCase();
}

function getCurricTables() {
  if (typeof window !== 'undefined' && window.CURRICULUM_DATA && Array.isArray(window.CURRICULUM_DATA.tables)) {
    return window.CURRICULUM_DATA.tables;
  }
  return [];
}

function extractStdSemString(r) {
  if (r.semesters && typeof r.semesters === 'object') {
    const list = [];
    Object.keys(r.semesters).forEach(k => {
      const v = r.semesters[k];
      if (v) list.push(`${k}(${v})`);
    });
    if (list.length > 0) return list.join(', ');
  }
  if (r.semester_spanning_note) return r.semester_spanning_note;
  if (r.remarks) return r.remarks;
  return '—';
}

function extractSubjectCredits(r, defaultCr = 2) {
  if (r.required_credits_individual) {
    const n = Number(r.required_credits_individual);
    if (!isNaN(n) && n > 0) return n;
  }
  if (r.semesters && typeof r.semesters === 'object') {
    for (const k of Object.keys(r.semesters)) {
      const v = r.semesters[k];
      if (v && /^\d+$/.test(String(v))) {
        return Number(v);
      }
    }
  }
  if (r.subject_name) {
    if (r.subject_name.includes('実験実習') || r.subject_name.includes('実技') || r.subject_name.includes('演習')) {
      return 1;
    }
    if (r.subject_name === '卒業論文') return 6;
  }
  return defaultCr;
}

// ----------------------------------------------------
// コース定義 (全履修基準表_統合.json に準拠)
// ----------------------------------------------------
const CURRIC_COURSES = {
  tech: {
    id: 'tech',
    name: '中学校一種（技術教育専修）',
    totalRequiredCredits: 134,
    categoryOrder: [
      '共通科目',
      '教職科目（教育の基礎・指導法・実践等）',
      '技術科専門科目（免許法別表1）',
      '専修専門科目（技術教育専修）',
      '卒業論文'
    ],
    getSubjects: (tables) => {
      const subjects = [];
      const t2 = tables.find(t => t.table_id && t.table_id.includes('02'));
      const t9 = tables.find(t => t.table_id && t.table_id.includes('09'));

      // 1. 共通科目
      if (t2 && Array.isArray(t2.rows)) {
        t2.rows.forEach(r => {
          if (r.category_1 === '共通科目' && r.subject_name) {
            const isComm = r.subject_name.includes('コミュニケーション');
            const cr = extractSubjectCredits(r, isComm ? 1 : 2);
            subjects.push({
              key: `tech__${r.subject_name}__common`,
              name: r.subject_name,
              category: '共通科目',
              group: isComm ? '外国語コミュニケーション選択群 (同一言語で2単位修得)' : '共通必修科目',
              groupRequired: isComm ? 2 : null,
              isGroupElective: isComm,
              credits: cr,
              stdSem: extractStdSemString(r),
              rule: r.required_credits_group_rule || '',
              remarks: r.remarks || ''
            });
          }
        });
      }

      // 2. 教職科目 (基礎・指導法・実践等)
      if (t2 && Array.isArray(t2.rows)) {
        t2.rows.forEach(r => {
          if (r.category_1 === '教科及び教職科目' && r.subject_name) {
            // 別表1で具体化する3枠は除外
            if (r.subject_name === '教科に関する専門的事項' || r.subject_name === '各教科の指導法' || r.subject_name === '複合科目') {
              return;
            }
            const cr = extractSubjectCredits(r, 2);
            let grp = r.category_2 || '教職科目';
            let isGroupElective = false;
            let groupReq = null;

            if (r.subject_name === '教育経営行政論' || r.subject_name === '教育社会学') {
              grp = '教育経営・教育社会 選択必修群 (いずれか2単位修得)';
              isGroupElective = true;
              groupReq = 2;
            }

            subjects.push({
              key: `tech__${r.subject_name}__teacher`,
              name: r.subject_name,
              category: '教職科目（教育の基礎・指導法・実践等）',
              group: grp,
              groupRequired: groupReq,
              isGroupElective: isGroupElective,
              credits: cr,
              stdSem: extractStdSemString(r),
              rule: r.required_credits_group_rule || '',
              remarks: r.remarks || ''
            });
          }
        });
      }

      // 3. 技術科専門科目 (別表1より: 教科専門20単位 + 指導法8単位 + 複合2単位 = 30単位)
      if (t9 && Array.isArray(t9.rows)) {
        t9.rows.forEach(r => {
          if (r.category_1 === '技術' && r.subject_name) {
            const cr = extractSubjectCredits(r, 2);
            subjects.push({
              key: `tech__${r.subject_name}__license`,
              name: r.subject_name,
              category: '技術科専門科目（免許法別表1）',
              group: r.category_2 || '教科専門事項',
              groupRequired: null,
              isGroupElective: false,
              credits: cr,
              stdSem: extractStdSemString(r),
              rule: r.required_credits_group_rule || '',
              remarks: r.remarks || ''
            });
          }
        });
      }

      // 4. 専修専門科目 (技術教育専修: 必修3単位 + 選択群20単位 = 23単位)
      if (t2 && Array.isArray(t2.rows)) {
        t2.rows.forEach(r => {
          if (r.category_1 === '専修専門等科目' && r.category_3 === '技術教育専修' && r.subject_name) {
            const isReq = (r.subject_name === '大学での学び入門' || r.subject_name === '専修基礎ゼミ');
            const cr = extractSubjectCredits(r, isReq ? (r.subject_name === '大学での学び入門' ? 1 : 2) : 2);
            subjects.push({
              key: `tech__${r.subject_name}__major`,
              name: r.subject_name,
              category: '専修専門科目（技術教育専修）',
              group: isReq ? '専修必修科目 (3単位)' : '専修選択科目群 (当該科目群から20単位選択修得)',
              groupRequired: isReq ? 3 : 20,
              isGroupElective: !isReq,
              credits: cr,
              stdSem: extractStdSemString(r),
              rule: r.required_credits_group_rule || '',
              remarks: r.remarks || ''
            });
          }
        });
      }

      // 5. 卒業論文 (6単位)
      if (t2 && Array.isArray(t2.rows)) {
        t2.rows.forEach(r => {
          if (r.category_1 === '卒業論文' && r.subject_name) {
            subjects.push({
              key: `tech__${r.subject_name}__thesis`,
              name: r.subject_name,
              category: '卒業論文',
              group: '卒業論文（必修）',
              groupRequired: 6,
              isGroupElective: false,
              credits: 6,
              stdSem: extractStdSemString(r),
              rule: '',
              remarks: ''
            });
          }
        });
      }

      return subjects;
    }
  },

  industry: {
    id: 'industry',
    name: '高等学校一種（工業）',
    totalRequiredCredits: 59,
    categoryOrder: [
      '教科に関する専門的事項（工業・20単位選択群）',
      '各教科の指導法（工業）',
      '教職の基礎・指導法・実践科目',
      '大学が独自に設定する科目'
    ],
    getSubjects: (tables) => {
      const subjects = [];
      const t6 = tables.find(t => t.table_id && t.table_id.includes('06'));
      if (t6 && Array.isArray(t6.rows)) {
        t6.rows.forEach(r => {
          if (!r.subject_name || r.category_1 === '必要修得単位数') return;
          const cr = extractSubjectCredits(r, 2);
          let cat = '教科に関する専門的事項（工業・20単位選択群）';
          let grp = '専門的事項選択群 (20単位選択)';
          let isGroupElective = true;
          let groupReq = 20;

          if (r.category_2 === '各教科の指導法') {
            cat = '各教科の指導法（工業）';
            grp = '各教科の指導法 (4単位必修)';
            isGroupElective = false;
            groupReq = 4;
          } else if (r.category_1 && (r.category_1.includes('第三欄') || r.category_1.includes('第四欄') || r.category_1.includes('第五欄'))) {
            cat = '教職の基礎・指導法・実践科目';
            grp = r.category_2 || '教職科目';
            isGroupElective = !!r.required_credits_group;
            groupReq = r.required_credits_group ? Number(r.required_credits_group) : null;
          } else if (r.category_1 && r.category_1.includes('第六欄')) {
            cat = '大学が独自に設定する科目';
            grp = '大学独自設定科目 (10単位)';
            isGroupElective = false;
            groupReq = 10;
          }

          subjects.push({
            key: `industry__${r.subject_name}__${cat}`,
            name: r.subject_name,
            category: cat,
            group: grp,
            groupRequired: groupReq,
            isGroupElective: isGroupElective,
            credits: cr,
            stdSem: extractStdSemString(r),
            rule: r.required_credits_group_rule || '',
            remarks: r.remarks || ''
          });
        });
      }
      return subjects;
    }
  },

  librarian: {
    id: 'librarian',
    name: '学校図書館司書教諭',
    totalRequiredCredits: 10,
    categoryOrder: [
      '学校図書館司書教諭講習規程科目 (10単位必修)'
    ],
    getSubjects: (tables) => {
      const subjects = [];
      const t8 = tables.find(t => t.table_id && t.table_id.includes('08'));
      if (t8 && Array.isArray(t8.rows)) {
        t8.rows.forEach(r => {
          if (!r.subject_name) return;
          subjects.push({
            key: `librarian__${r.subject_name}`,
            name: r.subject_name,
            category: '学校図書館司書教諭講習規程科目 (10単位必修)',
            group: '司書教諭規程科目（全5科目・各2単位）',
            groupRequired: 10,
            isGroupElective: false,
            credits: 2,
            stdSem: extractStdSemString(r),
            rule: '5科目10単位すべて修得必須',
            remarks: r.remarks || ''
          });
        });
      }
      return subjects;
    }
  },

  science: {
    id: 'science',
    name: '高等学校一種（理科）',
    totalRequiredCredits: 59,
    categoryOrder: [
      '教科に関する専門的事項（理科・20単位選択群）',
      '各教科の指導法（理科）',
      '教職の基礎・指導法・実践科目',
      '大学が独自に設定する科目'
    ],
    getSubjects: (tables) => {
      const subjects = [];
      const t5 = tables.find(t => t.table_id && t.table_id.includes('05'));
      if (t5 && Array.isArray(t5.rows)) {
        t5.rows.forEach(r => {
          if (!r.subject_name || r.category_1 === '必要修得単位数') return;
          const cr = extractSubjectCredits(r, 2);
          let cat = '教科に関する専門的事項（理科・20単位選択群）';
          let grp = r.category_2 || '専門的事項選択群 (20単位選択)';
          let isGroupElective = true;
          let groupReq = 20;

          if (r.category_2 === '各教科の指導法') {
            cat = '各教科の指導法（理科）';
            grp = '各教科の指導法 (8単位)';
            isGroupElective = false;
            groupReq = 8;
          } else if (r.category_1 && (r.category_1.includes('第三欄') || r.category_1.includes('第四欄') || r.category_1.includes('第五欄'))) {
            cat = '教職の基礎・指導法・実践科目';
            grp = r.category_2 || '教職科目';
            isGroupElective = !!r.required_credits_group;
            groupReq = r.required_credits_group ? Number(r.required_credits_group) : null;
          } else if (r.category_1 && r.category_1.includes('第六欄')) {
            cat = '大学が独自に設定する科目';
            grp = '大学独自設定科目 (10単位)';
            isGroupElective = false;
            groupReq = 10;
          }

          subjects.push({
            key: `science__${r.subject_name}__${cat}`,
            name: r.subject_name,
            category: cat,
            group: grp,
            groupRequired: groupReq,
            isGroupElective: isGroupElective,
            credits: cr,
            stdSem: extractStdSemString(r),
            rule: r.required_credits_group_rule || '',
            remarks: r.remarks || ''
          });
        });
      }
      return subjects;
    }
  }
};


// ====================================================
// 履修データ永続化 & シラバス連携 & 進捗集計
// ====================================================

const CURRIC_STORAGE_KEY = 'curriculum_nue_userdata_v2';

function loadCurricUserData() {
  try {
    const raw = localStorage.getItem(CURRIC_STORAGE_KEY);
    if (raw) {
      const parsed = JSON.parse(raw);
      if (parsed && typeof parsed === 'object') {
        state.curricUserData = {
          version: 2,
          updatedAt: parsed.updatedAt || new Date().toISOString(),
          subjects: parsed.subjects || {}
        };
        return;
      }
    }
  } catch (err) {
    console.error('Failed to load curriculum user data:', err);
  }
  state.curricUserData = {
    version: 2,
    updatedAt: new Date().toISOString(),
    subjects: {}
  };
}

function saveCurricUserData() {
  try {
    state.curricUserData.updatedAt = new Date().toISOString();
    localStorage.setItem(CURRIC_STORAGE_KEY, JSON.stringify(state.curricUserData));
  } catch (err) {
    console.error('Failed to save curriculum user data:', err);
  }
}

function getCurricSubjectRecord(subKey) {
  if (!state.curricUserData.subjects) state.curricUserData.subjects = {};
  if (!state.curricUserData.subjects[subKey]) {
    state.curricUserData.subjects[subKey] = {
      status: 'none', // 'none' | 'in_progress' | 'completed'
      assignedLessonId: null
    };
  }
  return state.curricUserData.subjects[subKey];
}

function findCurricCandidates(subjectName) {
  if (!subjectName || !DATA || !DATA.lessons) return [];
  const normSub = normalizeSubName(subjectName);
  const candidates = [];
  const seenIds = new Set();

  function addCandidate(l) {
    if (!seenIds.has(l.id)) {
      seenIds.add(l.id);
      candidates.push(l);
    }
  }

  // 1. 完全一致 or ◆読替一致
  for (const l of DATA.lessons) {
    const normL = normalizeSubName(l.name);
    if (normL === normSub) {
      addCandidate(l);
      continue;
    }
    if (l.name && l.name.includes('◆')) {
      const parts = l.name.split('◆').map(p => normalizeSubName(p));
      if (parts.includes(normSub)) {
        addCandidate(l);
        continue;
      }
    }
  }

  // 2. クラス・種目分け派生科目 (例: カリキュラム論 -> カリキュラム論A/B, 体育実技Ⅰ -> 体育実技Ⅰ（...）)
  if (normSub.length >= 2) {
    for (const l of DATA.lessons) {
      if (seenIds.has(l.id)) continue;
      const normL = normalizeSubName(l.name);
      if (normL.startsWith(normSub)) {
        const rest = normL.slice(normSub.length);
        if (/^[a-z0-9]$/i.test(rest) || rest.startsWith('(') || rest.startsWith('（')) {
          if (!normSub.includes('i') && (rest.startsWith('i') || rest.startsWith('v'))) {
            continue;
          }
          addCandidate(l);
        }
      }
    }
  }

  return candidates;
}

function getActiveCurricSubjects() {
  const courseConf = CURRIC_COURSES[state.curricCourse] || CURRIC_COURSES.tech;
  const tables = getCurricTables();
  return courseConf.getSubjects(tables);
}

// ----------------------------------------------------
// 時間割連携ヘルパー
// ----------------------------------------------------
function getAllMyTimetableLessonIds() {
  const z = (state.myTimetable && state.myTimetable['前期']) || [];
  const k = (state.myTimetable && state.myTimetable['後期']) || [];
  return [...new Set([...z, ...k])];
}

function isLessonInAnyTimetable(lessonId) {
  if (!lessonId || !state.myTimetable) return false;
  const z = state.myTimetable['前期'] || [];
  const k = state.myTimetable['後期'] || [];
  return z.includes(lessonId) || k.includes(lessonId);
}

function getAddedLessonForSubject(subjectName, candidates) {
  if (!state.myTimetable) return null;
  const allIds = getAllMyTimetableLessonIds();
  if (allIds.length === 0) return null;

  if (candidates && candidates.length > 0) {
    const candIds = new Set(candidates.map(c => c.id));
    const matchedId = allIds.find(id => candIds.has(id));
    if (matchedId) {
      return candidates.find(c => c.id === matchedId) || DATA.lessons.find(x => x.id === matchedId) || { id: matchedId, name: subjectName };
    }
  }

  const normSub = normalizeSubName(subjectName);
  for (const id of allIds) {
    const l = DATA.lessons.find(x => x.id === id);
    if (l && normalizeSubName(l.name) === normSub) {
      return l;
    }
  }

  return null;
}

// ----------------------------------------------------
// 履修基準・計画 タブ レンダリング
// ----------------------------------------------------
function renderCurriculumTab() {
  const subjects = getActiveCurricSubjects();
  renderCurricStats(subjects);
  renderCurricTableView(subjects);
}

function renderCurricStats(subjects) {
  const courseConf = CURRIC_COURSES[state.curricCourse] || CURRIC_COURSES.tech;
  const totalStandardCredits = courseConf.totalRequiredCredits || 134;

  let totalRawCompleted = 0;
  let totalRawInProgress = 0;

  // カテゴリ・グループ別集計
  const catMap = {};

  subjects.forEach(sub => {
    const rec = getCurricSubjectRecord(sub.key);
    const cr = sub.credits || 2;

    if (!catMap[sub.category]) {
      catMap[sub.category] = {
        name: sub.category,
        groups: {},
        totalSubjects: 0,
        completedCredits: 0,
        inProgressCredits: 0,
        requiredCredits: 0
      };
    }
    const catObj = catMap[sub.category];
    catObj.totalSubjects++;

    if (!catObj.groups[sub.group]) {
      catObj.groups[sub.group] = {
        name: sub.group,
        required: sub.groupRequired,
        isElective: sub.isGroupElective,
        completed: 0,
        inProgress: 0,
        totalSubjectCredits: 0,
        count: 0
      };
    }
    const grpObj = catObj.groups[sub.group];
    grpObj.count++;
    grpObj.totalSubjectCredits += cr;

    if (rec.status === 'completed') {
      grpObj.completed += cr;
      catObj.completedCredits += cr;
      totalRawCompleted += cr;
    } else if (rec.status === 'in_progress') {
      grpObj.inProgress += cr;
      catObj.inProgressCredits += cr;
      totalRawInProgress += cr;
    }
  });

  // カテゴリ全体の必要単位算出
  Object.keys(catMap).forEach(catKey => {
    const c = catMap[catKey];
    let reqSum = 0;
    Object.keys(c.groups).forEach(gKey => {
      const g = c.groups[gKey];
      if (g.required) {
        reqSum += g.required;
      } else {
        reqSum += g.totalSubjectCredits;
      }
    });
    c.requiredCredits = reqSum;
  });

  if (dom.curricStatCompleted) dom.curricStatCompleted.textContent = totalRawCompleted;
  if (dom.curricStatInProgress) dom.curricStatInProgress.textContent = totalRawInProgress;
  if (dom.curricStatRequired) dom.curricStatRequired.textContent = totalStandardCredits;

  const compPct = totalStandardCredits > 0 ? Math.min(100, Math.round((totalRawCompleted / totalStandardCredits) * 100)) : 0;
  const inProgPct = totalStandardCredits > 0 ? Math.min(100 - compPct, Math.round((totalRawInProgress / totalStandardCredits) * 100)) : 0;

  if (dom.curricProgCompleted) dom.curricProgCompleted.style.width = `${compPct}%`;
  if (dom.curricProgInProgress) dom.curricProgInProgress.style.width = `${inProgPct}%`;

  if (dom.curricStatBadge) {
    dom.curricStatBadge.textContent = `修得進捗: ${compPct}% (${totalRawCompleted} / 卒業要件${totalStandardCredits}単位)`;
  }

  // カテゴリ別サマリーカード
  if (dom.curricCategoryStatsGrid) {
    dom.curricCategoryStatsGrid.innerHTML = '';
    const catKeys = Object.keys(catMap);
    if (courseConf.categoryOrder) {
      catKeys.sort((a, b) => {
        const ia = courseConf.categoryOrder.indexOf(a);
        const ib = courseConf.categoryOrder.indexOf(b);
        return (ia === -1 ? 99 : ia) - (ib === -1 ? 99 : ib);
      });
    }

    catKeys.forEach(cat => {
      const cData = catMap[cat];
      const card = document.createElement('div');
      card.className = 'curric-cat-card';

      const targetCr = cData.requiredCredits > 0 ? cData.requiredCredits : cData.completedCredits;
      const cPct = targetCr > 0 ? Math.min(100, Math.round((cData.completedCredits / targetCr) * 100)) : 0;
      const isFulfilled = targetCr > 0 && cData.completedCredits >= targetCr;

      card.innerHTML = `
        <div class="curric-cat-card-header">
          <span class="curric-cat-card-title">${escapeHtml(cat)}</span>
          <span class="curric-cat-card-credits ${isFulfilled ? 'fulfilled' : ''}">
            <strong>${cData.completedCredits}</strong> / ${targetCr} 単位
            ${isFulfilled ? '<span class="cat-check-badge">✓達成</span>' : ''}
          </span>
        </div>
        <div class="curric-progress-track">
          <div class="curric-progress-fill completed" style="width: ${cPct}%;"></div>
        </div>
      `;
      dom.curricCategoryStatsGrid.appendChild(card);
    });
  }
}


// ----------------------------------------------------
// 基準表テーブルビュー (科目群グループ化 & 洗練されたUI)
// ----------------------------------------------------

function renderCurricTableView(subjects) {
  if (!dom.curricTableViewContainer) return;
  dom.curricTableViewContainer.innerHTML = '';

  const q = (state.curricSearchQuery || '').trim().toLowerCase();
  const sFilter = state.curricStatusFilter || 'all';

  const filtered = subjects.filter(sub => {
    const rec = getCurricSubjectRecord(sub.key);
    if (sFilter !== 'all' && rec.status !== sFilter) return false;
    if (q) {
      const matchName = sub.name.toLowerCase().includes(q);
      const matchCat = sub.category.toLowerCase().includes(q);
      const matchGroup = (sub.group || '').toLowerCase().includes(q);
      if (!matchName && !matchCat && !matchGroup) return false;
    }
    return true;
  });

  if (dom.curricDisplayCount) {
    dom.curricDisplayCount.textContent = `表示: ${filtered.length} / ${subjects.length}件`;
  }

  const courseConf = CURRIC_COURSES[state.curricCourse] || CURRIC_COURSES.tech;

  // カテゴリごとにまとめる
  const catMap = {};
  filtered.forEach(sub => {
    if (!catMap[sub.category]) catMap[sub.category] = [];
    catMap[sub.category].push(sub);
  });

  const catKeys = Object.keys(catMap);
  if (courseConf.categoryOrder) {
    catKeys.sort((a, b) => {
      const ia = courseConf.categoryOrder.indexOf(a);
      const ib = courseConf.categoryOrder.indexOf(b);
      return (ia === -1 ? 99 : ia) - (ib === -1 ? 99 : ib);
    });
  }

  if (catKeys.length === 0) {
    dom.curricTableViewContainer.innerHTML = `
      <div class="empty-state">
        <div class="empty-icon">🔍</div>
        <div class="empty-title">該当する科目がありません</div>
        <div class="empty-desc">検索条件または状況絞込を変更してください</div>
      </div>
    `;
    return;
  }

  catKeys.forEach(cat => {
    const subsInCat = catMap[cat];
    const isCollapsed = state.curricCollapsedCats.has(cat);

    let catCompleted = 0;
    let catTotalCredits = 0;
    subsInCat.forEach(s => {
      const r = getCurricSubjectRecord(s.key);
      const cr = s.credits || 2;
      catTotalCredits += cr;
      if (r.status === 'completed') catCompleted += cr;
    });

    // カテゴリ内のグループ（科目群）分け
    const groupMap = {};
    subsInCat.forEach(s => {
      const grp = s.group || '一般';
      if (!groupMap[grp]) groupMap[grp] = [];
      groupMap[grp].push(s);
    });

    const sec = document.createElement('div');
    sec.className = `curric-cat-section ${isCollapsed ? 'collapsed' : ''}`;
    sec.dataset.category = cat;

    let groupsHtml = '';
    Object.keys(groupMap).forEach(grpName => {
      const gSubs = groupMap[grpName];
      const gSample = gSubs[0];
      const req = gSample.groupRequired;
      const isElect = gSample.isGroupElective;

      let gComp = 0;
      let gTotal = 0;
      gSubs.forEach(s => {
        const r = getCurricSubjectRecord(s.key);
        const cr = s.credits || 2;
        gTotal += cr;
        if (r.status === 'completed') gComp += cr;
      });

      const isFulfilled = req && gComp >= req;
      let groupBadgeHtml = '';
      if (req) {
        groupBadgeHtml = `
          <span class="curric-group-req-badge ${isFulfilled ? 'fulfilled' : ''}">
            ${isFulfilled ? '✓ ' : ''}修得: <strong>${gComp}</strong> / 要件${req}単位 ${isElect ? '(選択群)' : '(必修)'}
          </span>
        `;
      } else {
        groupBadgeHtml = `
          <span class="curric-group-req-badge">
            修得: <strong>${gComp}</strong> / 計${gTotal}単位
          </span>
        `;
      }

      groupsHtml += `
        <div class="curric-group-container">
          <div class="curric-group-header">
            <div class="curric-group-title">
              <span class="group-dot">●</span> ${escapeHtml(grpName)}
            </div>
            ${groupBadgeHtml}
          </div>
          <table class="curric-table">
            <thead>
              <tr>
                <th style="width: 130px; text-align: center;">修得状況</th>
                <th>科目名 / 詳細情報</th>
                <th style="width: 75px; text-align: center;">単位数</th>
                <th style="width: 140px; text-align: center;">標準配当</th>
                <th style="width: 260px; text-align: center;">シラバス2026連携</th>
              </tr>
            </thead>
            <tbody>
              ${gSubs.map(sub => renderCurricTableRowHtml(sub)).join('')}
            </tbody>
          </table>
        </div>
      `;
    });

    sec.innerHTML = `
      <div class="curric-cat-section-header" onclick="window.__toggleCurricCatCollapse('${escapeHtml(cat)}')">
        <div class="curric-cat-section-left">
          <span class="curric-cat-collapse-arrow">▼</span>
          <span class="curric-cat-section-title">${escapeHtml(cat)}</span>
          <span class="curric-cat-section-badge">${subsInCat.length}科目</span>
        </div>
        <div class="curric-cat-section-right">
          <span class="curric-cat-section-credits">修得済: <strong>${catCompleted}</strong> 単位</span>
        </div>
      </div>
      <div class="curric-cat-section-body" style="display: ${isCollapsed ? 'none' : 'block'};">
        ${groupsHtml}
      </div>
    `;

    dom.curricTableViewContainer.appendChild(sec);
  });
}

function renderCurricTableRowHtml(sub) {
  const rec = getCurricSubjectRecord(sub.key);
  const candidates = findCurricCandidates(sub.name);
  const addedLesson = getAddedLessonForSubject(sub.name, candidates);

  // ステータスボタン (未履修 / 履修中 / 修得済)
  let statusBtnHtml = '';
  if (rec.status === 'completed') {
    statusBtnHtml = `
      <button type="button" class="curric-status-pill status-completed" onclick="window.__cycleCurricStatus('${escapeHtml(sub.key)}')" title="クリックで状況を変更">
        <span class="status-icon">✓</span> 修得済
      </button>
    `;
  } else if (rec.status === 'in_progress') {
    statusBtnHtml = `
      <button type="button" class="curric-status-pill status-in-progress" onclick="window.__cycleCurricStatus('${escapeHtml(sub.key)}')" title="クリックで状況を変更">
        <span class="status-icon">●</span> 履修中
      </button>
    `;
  } else {
    statusBtnHtml = `
      <button type="button" class="curric-status-pill status-none" onclick="window.__cycleCurricStatus('${escapeHtml(sub.key)}')" title="クリックで状況を変更">
        <span class="status-icon">○</span> 未履修
      </button>
    `;
  }

  // 時間割連携アクション
  let timetableActionHtml = '';
  if (addedLesson) {
    timetableActionHtml = `
      <div class="curric-linked-box">
        <div class="curric-linked-info">
          <span class="curric-linked-badge">✓ 時間割登録中</span>
          <span class="curric-linked-detail" title="${escapeHtml(addedLesson.name)}">${escapeHtml(addedLesson.semester || '')} ${escapeHtml(addedLesson.day || '')}${escapeHtml(addedLesson.periodRaw || '')} (${escapeHtml(addedLesson.teacher || '')})</span>
        </div>
        <button type="button" class="btn-curric-unlink" onclick="window.__removeLessonFromCurric('${escapeHtml(sub.key)}', '${escapeHtml(addedLesson.id)}')">解除</button>
      </div>
    `;
  } else if (candidates.length === 0) {
    timetableActionHtml = `
      <span class="curric-no-cand-badge" title="2026年度シラバスに該当の開講枠がありません">開講枠なし</span>
    `;
  } else if (candidates.length === 1) {
    const l = candidates[0];
    timetableActionHtml = `
      <button type="button" class="btn-curric-add" onclick="window.__addLessonFromCurric('${escapeHtml(sub.key)}', '${escapeHtml(l.id)}')">
        <span class="btn-icon">＋</span> 時間割に追加
        <span class="btn-slot-tag">${escapeHtml(l.semester)} ${escapeHtml(l.day)}${escapeHtml(l.periodRaw)}</span>
      </button>
    `;
  } else {
    timetableActionHtml = `
      <button type="button" class="btn-curric-pick" onclick="window.__openCurricCandidatesModal('${escapeHtml(sub.key)}')">
        <span class="btn-icon">＋</span> 開講枠を選択
        <span class="btn-count-bubble">${candidates.length}件</span>
      </button>
    `;
  }

  return `
    <tr class="curric-row row-${rec.status}">
      <td class="cell-status" style="text-align: center;">
        ${statusBtnHtml}
      </td>
      <td class="cell-subject">
        <div class="curric-sub-name">${escapeHtml(sub.name)}</div>
        ${sub.rule ? `<div class="curric-sub-rule">📌 ${escapeHtml(sub.rule)}</div>` : ''}
        ${sub.remarks ? `<div class="curric-sub-remarks">${escapeHtml(sub.remarks)}</div>` : ''}
      </td>
      <td class="cell-credits" style="text-align: center;">
        <span class="curric-credit-val">${sub.credits}</span><span class="curric-credit-unit">単位</span>
      </td>
      <td class="cell-stdsem" style="text-align: center;">
        <span class="curric-stdsem-text">${escapeHtml(sub.stdSem)}</span>
      </td>
      <td class="cell-timetable-action">
        ${timetableActionHtml}
      </td>
    </tr>
  `;
}


// ----------------------------------------------------
// グローバル操作ハンドラー & モーダル制御 & JSON入出力
// ----------------------------------------------------

window.__closeCurricModal = function() {
  document.querySelectorAll('.modal-overlay').forEach(m => {
    m.classList.remove('show', 'active');
  });
};

// Escキーで閉じる
window.addEventListener('keydown', (e) => {
  if (e.key === 'Escape') {
    window.__closeCurricModal();
  }
});

window.__cycleCurricStatus = function(subKey) {
  const rec = getCurricSubjectRecord(subKey);
  if (rec.status === 'none') {
    rec.status = 'in_progress';
  } else if (rec.status === 'in_progress') {
    rec.status = 'completed';
  } else {
    rec.status = 'none';
  }
  saveCurricUserData();
  renderCurriculumTab();
};

window.__toggleCurricCatCollapse = function(catName) {
  if (state.curricCollapsedCats.has(catName)) {
    state.curricCollapsedCats.delete(catName);
  } else {
    state.curricCollapsedCats.add(catName);
  }
  renderCurriculumTab();
};

window.__addLessonFromCurric = function(subKey, lessonId) {
  const lesson = DATA.lessons.find(l => l.id === lessonId);
  if (!lesson) {
    showToast('授業データが見つかりませんでした');
    return;
  }

  const rec = getCurricSubjectRecord(subKey);
  rec.assignedLessonId = lessonId;
  if (rec.status === 'none') {
    rec.status = 'in_progress';
  }
  saveCurricUserData();

  // 時間割に追加 (前期 / 後期)
  let sem = '前期';
  if (lesson.semester === '後期') sem = '後期';
  if (!state.myTimetable[sem]) state.myTimetable[sem] = [];
  if (!state.myTimetable[sem].includes(lessonId)) {
    state.myTimetable[sem].push(lessonId);
  }
  saveMyTimetable();

  window.__closeCurricModal();

  renderCurriculumTab();
  renderMyTimetableTab();
  showToast(`「${lesson.name}」をMy時間割(${sem})に追加しました！ ⭐`);
};

window.__removeLessonFromCurric = function(subKey, lessonId) {
  const lesson = DATA.lessons.find(l => l.id === lessonId);
  const lName = lesson ? lesson.name : '授業';

  const rec = getCurricSubjectRecord(subKey);
  if (rec.assignedLessonId === lessonId) {
    rec.assignedLessonId = null;
  }
  saveCurricUserData();

  // 時間割から削除
  ['前期', '後期'].forEach(sem => {
    if (state.myTimetable && state.myTimetable[sem]) {
      state.myTimetable[sem] = state.myTimetable[sem].filter(id => id !== lessonId);
    }
  });
  saveMyTimetable();

  window.__closeCurricModal();

  renderCurriculumTab();
  renderMyTimetableTab();
  showToast(`「${lName}」をMy時間割から解除しました`);
};

window.__openCurricCandidatesModal = function(subKey) {
  const subjects = getActiveCurricSubjects();
  const sub = subjects.find(s => s.key === subKey);
  if (!sub) return;

  state.activeCurricSubject = sub;
  const candidates = findCurricCandidates(sub.name);

  if (dom.curricModalSubTitle) {
    dom.curricModalSubTitle.textContent = `${sub.name} (${sub.credits}単位)`;
  }
  if (dom.curricModalSubDesc) {
    dom.curricModalSubDesc.textContent = `${sub.category} / 2026年度開講枠: ${candidates.length}件。希望の枠を選択して時間割に登録できます。`;
  }

  if (dom.curricModalCandsList) {
    dom.curricModalCandsList.innerHTML = '';
    if (candidates.length === 0) {
      dom.curricModalCandsList.innerHTML = '<div class="curric-cand-empty">開講枠がありません</div>';
    } else {
      candidates.forEach(l => {
        const isAdded = isLessonInAnyTimetable(l.id);
        const card = document.createElement('div');
        card.className = `curric-cand-card ${isAdded ? 'added' : ''}`;
        card.innerHTML = `
          <div class="curric-cand-info">
            <div class="curric-cand-name">
              <strong>${escapeHtml(l.name)}</strong>
              <span class="curric-cand-sem-tag">${escapeHtml(l.semester)}</span>
              <span class="curric-cand-slot-tag">${escapeHtml(l.day || '')}${escapeHtml(l.periodRaw || '')}限</span>
            </div>
            <div class="curric-cand-meta">
              <span>担当: <strong>${escapeHtml(l.teacher || '未定')}</strong></span>
              <span>教室: ${escapeHtml((l.rooms || []).join(', ') || '未定')}</span>
              <span>番号: <code class="cand-code">${escapeHtml(l.id)}</code></span>
            </div>
          </div>
          <div class="curric-cand-action">
            ${isAdded 
              ? `<button type="button" class="btn-cand-remove" onclick="window.__removeLessonFromCurric('${escapeHtml(sub.key)}', '${escapeHtml(l.id)}')">✓ 登録中 (解除)</button>`
              : `<button type="button" class="btn-cand-add" onclick="window.__addLessonFromCurric('${escapeHtml(sub.key)}', '${escapeHtml(l.id)}')">＋この枠を追加</button>`
            }
          </div>
        `;
        dom.curricModalCandsList.appendChild(card);
      });
    }
  }

  if (dom.curricCandidatesModal) {
    dom.curricCandidatesModal.classList.add('show', 'active');
  }
};

// ----------------------------------------------------
// JSON 入出力 (Export & Import)
// ----------------------------------------------------

function openCurricJsonExportModal() {
  const exportData = {
    exportedAt: new Date().toISOString(),
    system: 'Curriculum_NUE',
    version: 2,
    course: state.curricCourse,
    curricUserData: state.curricUserData,
    myTimetable: state.myTimetable,
    conflictAck: state.conflictAck,
    conflictDismissed: state.conflictDismissed
  };

  const jsonStr = JSON.stringify(exportData, null, 2);
  if (dom.curricJsonTextarea) {
    dom.curricJsonTextarea.value = jsonStr;
  }
  if (dom.curricJsonModal) {
    dom.curricJsonModal.classList.add('show', 'active');
  }
}

function downloadCurricJsonFile() {
  const exportData = {
    exportedAt: new Date().toISOString(),
    system: 'Curriculum_NUE',
    version: 2,
    course: state.curricCourse,
    curricUserData: state.curricUserData,
    myTimetable: state.myTimetable,
    conflictAck: state.conflictAck,
    conflictDismissed: state.conflictDismissed
  };

  const jsonStr = JSON.stringify(exportData, null, 2);
  const blob = new Blob([jsonStr], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  const dStr = new Date().toISOString().slice(0, 10).replace(/-/g, '');
  a.href = url;
  a.download = `履修データ_${state.curricCourse}_${dStr}.json`;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
  showToast('JSONファイルをダウンロードしました');
}

function applyCurricJsonData(jsonStr) {
  try {
    const parsed = JSON.parse(jsonStr);
    if (!parsed || typeof parsed !== 'object') {
      throw new Error('JSONの形式が無効です');
    }

    if (parsed.course && CURRIC_COURSES[parsed.course]) {
      state.curricCourse = parsed.course;
      if (dom.curricCourseSelect) dom.curricCourseSelect.value = parsed.course;
    }

    if (parsed.curricUserData && parsed.curricUserData.subjects) {
      state.curricUserData = {
        version: 2,
        updatedAt: new Date().toISOString(),
        subjects: parsed.curricUserData.subjects
      };
      saveCurricUserData();
    }

    if (parsed.myTimetable && typeof parsed.myTimetable === 'object') {
      state.myTimetable = {
        '前期': Array.isArray(parsed.myTimetable['前期']) ? parsed.myTimetable['前期'] : [],
        '後期': Array.isArray(parsed.myTimetable['後期']) ? parsed.myTimetable['後期'] : []
      };
      if (parsed.conflictAck) state.conflictAck = parsed.conflictAck;
      if (parsed.conflictDismissed) state.conflictDismissed = parsed.conflictDismissed;
      saveMyTimetable();
    }

    window.__closeCurricModal();

    renderCurriculumTab();
    renderMyTimetableTab();
    showToast('履修計画とMy時間割のデータを復元しました');
  } catch (err) {
    alert('JSONデータの読み込みに失敗しました:\n' + err.message);
  }
}


  function switchTab(tabId) {
    state.currentTab = tabId;
    dom.navTabs.forEach(t => {
      t.classList.toggle('active', t.dataset.tab === tabId);
    });
    dom.tabContents.forEach(c => {
      c.classList.toggle('active', c.id === `tab-${tabId}`);
    });

    if (tabId === 'curriculum') renderCurriculumTab();
    if (tabId === 'free-rooms') renderFreeRoomsTab();
    if (tabId === 'timetable') renderTimetableTab();
    if (tabId === 'matrix') renderMatrixTab();
    if (tabId === 'lessons') renderLessonsTab();
    if (tabId === 'my-timetable') renderMyTimetableTab();
  }

  // ----------------------------------------------------
  // イベントリスナー
  // ----------------------------------------------------
  function initEvents() {
    dom.semBtns.forEach(btn => {
      btn.addEventListener('click', () => {
        state.semester = btn.dataset.sem;
        updateUISelectors();
        if (state.currentTab === 'free-rooms') renderFreeRoomsTab();
        if (state.currentTab === 'timetable') renderTimetableTab();
        if (state.currentTab === 'matrix') renderMatrixTab();
      });
    });

    dom.navTabs.forEach(tab => {
      tab.addEventListener('click', () => {
        switchTab(tab.dataset.tab);
      });
    });

    dom.dayBtns.forEach(btn => {
      btn.addEventListener('click', () => {
        state.day = btn.dataset.day;
        updateUISelectors();
        renderFreeRoomsTab();
      });
    });

    dom.slotBtns.forEach(btn => {
      btn.addEventListener('click', () => {
        state.slot = parseInt(btn.dataset.slot, 10);
        updateUISelectors();
        renderFreeRoomsTab();
      });
    });

    if (dom.categoryFilter) {
      dom.categoryFilter.addEventListener('change', (e) => {
        state.category = e.target.value;
        renderFreeRoomsTab();
      });
    }

    if (dom.roomSearchInput) {
      dom.roomSearchInput.addEventListener('input', (e) => {
        state.searchQuery = e.target.value.trim();
        renderFreeRoomsTab();
      });
    }

    if (dom.showOccupiedToggle) {
      dom.showOccupiedToggle.addEventListener('change', (e) => {
        state.showOccupied = e.target.checked;
        renderFreeRoomsTab();
      });
    }

    if (dom.btnNow) {
      dom.btnNow.addEventListener('click', jumpToCurrentSlot);
    }

    // モーダル閉じるボタン
    document.querySelectorAll('.modal-close-btn').forEach(btn => {
      btn.addEventListener('click', () => {
        if (dom.lessonModal) dom.lessonModal.classList.remove('show');
        if (dom.lessonSelectModal) dom.lessonSelectModal.classList.remove('show');
        if (dom.slotPickerModal) dom.slotPickerModal.classList.remove('show');
        if (dom.conflictDetailsModal) dom.conflictDetailsModal.classList.remove('show');
      });
    });

    // モーダル背景クリック
    [dom.lessonModal, dom.lessonSelectModal, dom.slotPickerModal, dom.conflictDetailsModal].forEach(modal => {
      if (modal) {
        modal.addEventListener('click', (e) => {
          if (e.target === modal) {
            modal.classList.remove('show');
          }
        });
      }
    });

    if (dom.timetableRoomSelect) {
      dom.timetableRoomSelect.addEventListener('change', (e) => {
        state.selectedRoom = e.target.value;
        renderTimetableTab();
      });
    }

    if (dom.matrixCategorySelect) {
      dom.matrixCategorySelect.addEventListener('change', (e) => {
        state.matrixCategory = e.target.value;
        renderMatrixTab();
      });
    }

    // --- 科目全件検索イベント ---
    if (dom.lessonSearchInput) {
      dom.lessonSearchInput.addEventListener('input', (e) => {
        state.lessonFilter.q = e.target.value;
        renderLessonsTab();
      });
    }

    dom.lessonSemBtns.forEach(btn => {
      btn.addEventListener('click', () => {
        state.lessonFilter.sem = btn.dataset.sem;
        renderLessonsTab();
      });
    });

    if (dom.lessonDaySelect) {
      dom.lessonDaySelect.addEventListener('change', (e) => {
        state.lessonFilter.day = e.target.value;
        renderLessonsTab();
      });
    }

    if (dom.lessonSlotSelect) {
      dom.lessonSlotSelect.addEventListener('change', (e) => {
        state.lessonFilter.slot = e.target.value;
        renderLessonsTab();
      });
    }

    if (dom.lessonCatSelect) {
      dom.lessonCatSelect.addEventListener('change', (e) => {
        state.lessonFilter.cat = e.target.value;
        renderLessonsTab();
      });
    }

    if (dom.btnLessonClear) {
      dom.btnLessonClear.addEventListener('click', () => {
        state.lessonFilter = { q: '', sem: 'all', day: 'all', slot: 'all', cat: 'all' };
        if (dom.lessonSearchInput) dom.lessonSearchInput.value = '';
        if (dom.lessonDaySelect) dom.lessonDaySelect.value = 'all';
        if (dom.lessonSlotSelect) dom.lessonSlotSelect.value = 'all';
        if (dom.lessonCatSelect) dom.lessonCatSelect.value = 'all';
        renderLessonsTab();
        showToast('検索条件をクリアしました');
      });
    }

    document.querySelectorAll('.sortable-th').forEach(th => {
      th.addEventListener('click', () => {
        const field = th.dataset.sort;
        if (field !== 'id' && field !== 'daySlot') return;

        if (state.lessonSort.field === field) {
          state.lessonSort.order = (state.lessonSort.order === 'asc') ? 'desc' : 'asc';
        } else {
          state.lessonSort.field = field;
          state.lessonSort.order = 'asc';
        }
        renderLessonsTab();
      });
    });

    if (dom.slotPickerSearch) {
      dom.slotPickerSearch.addEventListener('input', () => {
        renderSlotPickerList();
      });
    }

    // --- My時間割イベント ---
    dom.mySemBtns.forEach(btn => {
      btn.addEventListener('click', () => {
        state.mySemester = btn.dataset.mySem;
        renderMyTimetableTab();
      });
    });

    if (dom.btnClearMyTimetable) {
      dom.btnClearMyTimetable.addEventListener('click', () => {
        const sem = state.mySemester;
        if (confirm(`本当に${sem}のMy時間割をすべてリセットしますか？`)) {
          state.myTimetable[sem] = [];
          state.conflictAck[sem] = false;
          saveMyTimetable();
          renderMyTimetableTab();
          renderLessonsTab();
          showToast(`${sem}のMy時間割をリセットしました`);
        }
      });
    }

    // 時間割の共有ボタン
    if (dom.btnShareMyTimetable) {
      dom.btnShareMyTimetable.addEventListener('click', shareMyTimetable);
    }

    // ハッシュ変更時にも時間割共有をチェック
    window.addEventListener('hashchange', checkSharedTimetableInUrl);

    // 重複警告の「詳細を確認」ボタン
    if (dom.btnConflictDetails) {
      dom.btnConflictDetails.addEventListener('click', openConflictDetailsModal);
    }

    // 重複警告バーの「×」閉じるボタン
    if (dom.btnDismissConflictBar) {
      dom.btnDismissConflictBar.addEventListener('click', () => {
        state.conflictDismissed[state.mySemester] = true;
        saveMyTimetable();
        renderMyTimetableTab();
        showToast('重複警告バーを非表示にしました（上のボタンからいつでも再確認できます）');
      });
    }

    // 重複確認済み／非表示時の再表示ボタン
    if (dom.btnReopenConflict) {
      dom.btnReopenConflict.addEventListener('click', openConflictDetailsModal);
    }

    // 集中講義の追加ボタン
    if (dom.btnAddSpecialLesson) {
      dom.btnAddSpecialLesson.addEventListener('click', () => {
        if (typeof window.__openSpecialLessonPicker === 'function') {
          window.__openSpecialLessonPicker();
        }
      });
    }

    // 重複警告の「問題なし（重複を了解）」ボタン（旧互換）
    if (dom.btnConflictAck) {
      dom.btnConflictAck.addEventListener('click', toggleConflictAck);
    }

    // モーダル内の「確認／取消」ボタン
    if (dom.btnModalConflictToggle) {
      dom.btnModalConflictToggle.addEventListener('click', toggleConflictAck);
    }

    // 履修基準・計画 タブ関連イベント
    if (dom.curricCourseSelect) {
      dom.curricCourseSelect.addEventListener('change', () => {
        state.curricCourse = dom.curricCourseSelect.value;
        renderCurriculumTab();
      });
    }

    if (dom.curricStatusFilter) {
      const sBtns = dom.curricStatusFilter.querySelectorAll('button[data-curric-status]');
      sBtns.forEach(btn => {
        btn.addEventListener('click', () => {
          sBtns.forEach(b => b.classList.toggle('active', b === btn));
          state.curricStatusFilter = btn.dataset.curricStatus;
          renderCurriculumTab();
        });
      });
    }

    if (dom.curricSearchInput) {
      dom.curricSearchInput.addEventListener('input', () => {
        state.curricSearchQuery = dom.curricSearchInput.value;
        renderCurriculumTab();
      });
    }

    if (dom.btnCurricCollapseAll) {
      dom.btnCurricCollapseAll.addEventListener('click', () => {
        const subs = getActiveCurricSubjects();
        subs.forEach(s => state.curricCollapsedCats.add(s.category));
        renderCurriculumTab();
      });
    }

    if (dom.btnCurricExpandAll) {
      dom.btnCurricExpandAll.addEventListener('click', () => {
        state.curricCollapsedCats.clear();
        renderCurriculumTab();
      });
    }

    if (dom.btnCurricResetData) {
      dom.btnCurricResetData.addEventListener('click', () => {
        if (confirm('履修状況（修得済・履修中等のチェック）をすべてリセットしますか？\n※My時間割の登録は削除されません')) {
          state.curricUserData.subjects = {};
          saveCurricUserData();
          renderCurriculumTab();
          showToast('履修チェックをリセットしました');
        }
      });
    }

    // JSON入出力ボタン
    if (dom.btnHeaderExportJson) {
      dom.btnHeaderExportJson.addEventListener('click', openCurricJsonExportModal);
    }
    if (dom.btnHeaderImportJson) {
      dom.btnHeaderImportJson.addEventListener('click', openCurricJsonExportModal);
    }
    if (dom.btnCurricModalCopyJson) {
      dom.btnCurricModalCopyJson.addEventListener('click', () => {
        if (dom.curricJsonTextarea) {
          navigator.clipboard.writeText(dom.curricJsonTextarea.value)
            .then(() => showToast('JSONをクリップボードにコピーしました'))
            .catch(() => showToast('コピーに失敗しました'));
        }
      });
    }
    if (dom.btnCurricModalDownloadJson) {
      dom.btnCurricModalDownloadJson.addEventListener('click', downloadCurricJsonFile);
    }
    if (dom.btnCurricModalApplyJson) {
      dom.btnCurricModalApplyJson.addEventListener('click', () => {
        if (dom.curricJsonTextarea) {
          applyCurricJsonData(dom.curricJsonTextarea.value);
        }
      });
    }
    if (dom.curricJsonFileInput) {
      dom.curricJsonFileInput.addEventListener('change', (e) => {
        const file = e.target.files && e.target.files[0];
        if (file) {
          const reader = new FileReader();
          reader.onload = (evt) => {
            if (dom.curricJsonTextarea) {
              dom.curricJsonTextarea.value = evt.target.result;
            }
            applyCurricJsonData(evt.target.result);
          };
          reader.readAsText(file);
        }
      });
    }
  }

  // ----------------------------------------------------
  // 初期化
  // ----------------------------------------------------
  function init() {
    if (dom.timetableRoomSelect) {
      dom.timetableRoomSelect.innerHTML = '';
      DATA.rooms.forEach(room => {
        const opt = document.createElement('option');
        opt.value = room.name;
        opt.textContent = `${room.name} (${getCategoryName(room.category)})`;
        dom.timetableRoomSelect.appendChild(opt);
      });
    }

    if (dom.quickRoomChips) {
      dom.quickRoomChips.innerHTML = '';
      POPULAR_ROOMS.forEach(rName => {
        if (DATA.rooms.some(r => r.name === rName)) {
          const chip = document.createElement('button');
          chip.type = 'button';
          chip.className = 'quick-chip';
          chip.dataset.room = rName;
          chip.textContent = rName;
          chip.addEventListener('click', () => {
            state.selectedRoom = rName;
            if (dom.timetableRoomSelect) dom.timetableRoomSelect.value = rName;
            renderTimetableTab();
          });
          dom.quickRoomChips.appendChild(chip);
        }
      });
    }

    loadCurricUserData();
    loadMyTimetable();

    state.semester = '前期';
    state.mySemester = '前期';

    updateUISelectors();
    initEvents();

    renderCurriculumTab();
    renderFreeRoomsTab();
    renderTimetableTab();
    renderMatrixTab();
    renderLessonsTab();
    renderMyTimetableTab();

    // URLハッシュに共有時間割が含まれているか確認
    checkSharedTimetableInUrl();
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
})();
