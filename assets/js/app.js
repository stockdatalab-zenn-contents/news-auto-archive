/* =========================================================================
   AI News Archive - フロントエンド (Pure Vanilla JS)
   - IndexedDB でニュースをキャッシュ (cache-then-network)
   - manifest.json からアーカイブ (日次/週次/月次) ナビ生成
   - カテゴリchip + フリーテキスト検索でニュース絞り込み
   既存PWA (index_gas.html) のニュース処理・IndexedDBヘルパを流用・単体化
   google.script.* などGAS依存は一切なし
   ========================================================================= */

'use strict';

// ---- 定数 ----
const DB_NAME = 'AiNewsArchiveDB';
const DB_VERSION = 1;
const STORE_NEWS = 'newsCache';
const MANIFEST_URL = './manifest.json';
const NEWS_FALLBACK = './news.json';

// ---- 状態 ----
let db = null;
const state = {
    newsData: [],        // 全ニュース (DATA SHAPE)
    manifest: null,      // manifest.json
    categoryFilter: 'all',
    searchText: ''
};

// =========================================================================
// IndexedDB (ニュース専用に単体化)
// =========================================================================

// DB初期化・newsCache ストア (keyPath=id) 作成
function initDB() {
    return new Promise((resolve, reject) => {
        const request = indexedDB.open(DB_NAME, DB_VERSION);
        request.onerror = () => reject(request.error);
        request.onsuccess = () => { db = request.result; resolve(db); };
        request.onupgradeneeded = (e) => {
            const database = e.target.result;
            if (!database.objectStoreNames.contains(STORE_NEWS)) {
                database.createObjectStore(STORE_NEWS, { keyPath: 'id' });
            }
        };
    });
}

// 一括保存 (パフォーマンス最適化)
function saveAllToStore(storeName, dataArray) {
    if (!db || !dataArray || dataArray.length === 0) return Promise.resolve();
    return new Promise((resolve, reject) => {
        const tx = db.transaction(storeName, 'readwrite');
        const store = tx.objectStore(storeName);
        dataArray.forEach(item => store.put(item));
        tx.oncomplete = () => resolve();
        tx.onerror = () => reject(tx.error);
    });
}

// 全件取得
function getAllFromStore(storeName) {
    if (!db) return Promise.resolve([]);
    return new Promise((resolve, reject) => {
        const tx = db.transaction(storeName, 'readonly');
        const store = tx.objectStore(storeName);
        const request = store.getAll();
        request.onsuccess = () => resolve(request.result || []);
        request.onerror = () => reject(request.error);
    });
}

// 全削除
function clearStore(storeName) {
    if (!db) return Promise.resolve();
    return new Promise((resolve, reject) => {
        const tx = db.transaction(storeName, 'readwrite');
        const store = tx.objectStore(storeName);
        store.clear();
        tx.oncomplete = () => resolve();
        tx.onerror = () => reject(tx.error);
    });
}

// キャッシュ更新 (全削除→一括保存)
async function refreshCache(newsArray) {
    try {
        await clearStore(STORE_NEWS);
        await saveAllToStore(STORE_NEWS, newsArray);
    } catch (e) {
        // キャッシュ失敗は致命的でない・表示は継続
        console.warn('キャッシュ更新失敗', e);
    }
}

// =========================================================================
// ユーティリティ
// =========================================================================

// HTMLエスケープ (XSS対策)
function escapeHtml(str) {
    if (str === null || str === undefined) return '';
    return String(str)
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;')
        .replace(/'/g, '&#39;');
}

// 相対時刻表示 (流用: formatNewsDate)
function formatNewsDate(dateStr) {
    try {
        const d = new Date(dateStr);
        if (isNaN(d.getTime())) return dateStr || '';
        const now = new Date();
        const diffMs = now - d;
        const diffH = Math.floor(diffMs / (1000 * 60 * 60));
        if (diffH < 0) return (d.getMonth() + 1) + '/' + d.getDate();
        if (diffH < 1) return Math.floor(diffMs / (1000 * 60)) + '分前';
        if (diffH < 24) return diffH + '時間前';
        const diffD = Math.floor(diffH / 24);
        if (diffD < 7) return diffD + '日前';
        return (d.getMonth() + 1) + '/' + d.getDate();
    } catch (e) {
        return dateStr || '';
    }
}

// Tierバッジのラベル・クラス (流用: tier badge logic)
function tierInfo(tier) {
    if (tier == 1) return { label: 'Tier1', cls: 'tier-1' };
    if (tier == 2) return { label: 'Tier2', cls: 'tier-2' };
    if (tier == 4) return { label: 'HN', cls: 'tier-hn' };
    if (tier === '' || tier === null || tier === undefined) return { label: '-', cls: 'tier-other' };
    return { label: 'Tier' + tier, cls: 'tier-other' };
}

// トースト表示
let toastTimer = null;
function showToast(msg) {
    const el = document.getElementById('toast');
    if (!el) return;
    el.textContent = msg;
    el.classList.add('show');
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => el.classList.remove('show'), 3000);
}

// =========================================================================
// ニュース描画
// =========================================================================

// 受信データを DATA SHAPE に正規化 (id補完・日本語ヘッダ対応)
function normalizeNews(rawArray) {
    if (!Array.isArray(rawArray)) return [];
    return rawArray.map((item, idx) => {
        // 日本語ヘッダCSV形式への後方互換
        if (item['タイトル'] !== undefined || item['URL'] !== undefined) {
            return {
                id: item.id || 'news-' + idx,
                title: item['タイトル（日本語）'] || item['タイトル'] || '',
                link: item['URL'] || '',
                pubDate: item['公開日時'] || item['収集日'] || '',
                description: item['説明'] || '',
                source: item['ソース'] || '',
                tier: item['Tier'] || '',
                category: item['カテゴリ'] || '',
                importance: item['重要度'] || '',
                fetchedAt: item['収集日'] || ''
            };
        }
        if (!item.id) item.id = 'news-' + idx;
        return item;
    });
}

// カテゴリchip生成 (全て + 出現カテゴリすべて)
function renderCategoryChips() {
    const bar = document.getElementById('categoryChips');
    if (!bar) return;

    const cats = [];
    state.newsData.forEach(item => {
        const c = item.category;
        if (c && cats.indexOf(c) === -1) cats.push(c);
    });
    cats.sort((a, b) => a.localeCompare(b, 'ja'));

    const chips = ['all'].concat(cats);
    bar.innerHTML = chips.map(c => {
        const label = c === 'all' ? '全て' : c;
        const sel = c === state.categoryFilter ? ' selected' : '';
        return `<button type="button" class="chip${sel}" data-category="${escapeHtml(c)}">${escapeHtml(label)}</button>`;
    }).join('');

    // 現在のフィルタが消えた場合は全てに戻す
    if (state.categoryFilter !== 'all' && cats.indexOf(state.categoryFilter) === -1) {
        state.categoryFilter = 'all';
    }
}

// フィルタ適用済みリストを返す (流用: filterNews のカテゴリ + 検索)
function getFilteredNews() {
    const q = state.searchText.trim().toLowerCase();
    return state.newsData.filter(item => {
        if (state.categoryFilter !== 'all' && item.category !== state.categoryFilter) return false;
        if (q) {
            const hay = ((item.title || '') + ' ' + (item.source || '')).toLowerCase();
            if (hay.indexOf(q) === -1) return false;
        }
        return true;
    });
}

// ニュース一覧描画 (流用: renderResearchTab)
function renderNews() {
    const container = document.getElementById('newsContainer');
    const emptyEl = document.getElementById('newsEmpty');
    const countEl = document.getElementById('newsCount');
    if (!container) return;

    if (state.newsData.length === 0) {
        container.innerHTML = '';
        if (emptyEl) emptyEl.classList.remove('hidden');
        if (countEl) countEl.textContent = '';
        return;
    }

    const filtered = getFilteredNews();
    if (countEl) countEl.textContent = '(' + filtered.length + '件)';

    if (filtered.length === 0) {
        if (emptyEl) emptyEl.classList.add('hidden');
        container.innerHTML = '<p class="empty-state">該当するニュースがありません</p>';
        return;
    }

    if (emptyEl) emptyEl.classList.add('hidden');

    container.innerHTML = filtered.map(item => {
        const t = tierInfo(item.tier);
        const dateStr = item.pubDate ? formatNewsDate(item.pubDate) : '';
        const desc = (item.description || '').substring(0, 150);
        const cat = item.category ? ' · ' + escapeHtml(item.category) : '';

        return `<article class="card">
            <div class="card-meta">
                <span><span class="tier-badge ${t.cls}">${t.label}</span> <span class="source">${escapeHtml(item.source)}</span>${cat}</span>
                <span>${escapeHtml(dateStr)}</span>
            </div>
            <h3 class="card-title">
                <a href="${escapeHtml(item.link)}" target="_blank" rel="noopener">${escapeHtml(item.title)}</a>
            </h3>
            ${desc ? `<p class="text-muted text-sm">${escapeHtml(desc)}</p>` : ''}
        </article>`;
    }).join('');
}

// =========================================================================
// アーカイブナビ (manifest から生成)
// =========================================================================

// 空/非空どちらの manifest も処理する
function renderArchiveNav() {
    const root = document.getElementById('archiveNav');
    if (!root) return;

    const m = state.manifest || { daily: [], weekly: [], monthly: [] };
    const daily = Array.isArray(m.daily) ? m.daily : [];
    const weekly = Array.isArray(m.weekly) ? m.weekly : [];
    const monthly = Array.isArray(m.monthly) ? m.monthly : [];

    // 最新クイックリンク
    const quick = [];
    if (daily[0]) quick.push(quickLink(daily[0].path, '最新の日次', daily[0].date));
    if (weekly[0]) quick.push(quickLink(weekly[0].path, '最新の週次', weekly[0].week));
    if (monthly[0]) quick.push(quickLink(monthly[0].path, '最新の月次', monthly[0].month));

    let html = '';
    if (quick.length > 0) {
        html += '<div class="archive-quick">' + quick.join('') + '</div>';
    }

    html += archiveGroup('日次', daily, dailyItem);
    html += archiveGroup('週次', weekly, weeklyItem);
    html += archiveGroup('月次', monthly, monthlyItem);

    root.innerHTML = html;
}

function quickLink(path, label, sub) {
    return `<a href="${escapeHtml(path)}">${escapeHtml(label)}<span class="meta">${escapeHtml(sub || '')}</span></a>`;
}

// 折りたたみグループ (空なら空状態表示)
function archiveGroup(title, arr, itemFn) {
    if (!arr || arr.length === 0) {
        return `<details class="details archive-group">
            <summary>${escapeHtml(title)} <span class="text-muted text-sm">(0件)</span></summary>
            <div class="details-body"><p class="empty-state">まだ公開されたページがありません</p></div>
        </details>`;
    }
    const items = arr.map(itemFn).join('');
    return `<details class="details archive-group">
        <summary>${escapeHtml(title)} <span class="text-muted text-sm">(${arr.length}件)</span></summary>
        <div class="details-body"><ul class="archive-list">${items}</ul></div>
    </details>`;
}

function dailyItem(e) {
    return `<li><a href="${escapeHtml(e.path)}">${escapeHtml(e.date || e.path)}</a></li>`;
}

function weeklyItem(e) {
    const range = (e.start && e.end) ? `${e.start} 〜 ${e.end}` : '';
    return `<li><a href="${escapeHtml(e.path)}">${escapeHtml(e.week || e.path)}<span class="meta">${escapeHtml(range)}</span></a></li>`;
}

function monthlyItem(e) {
    return `<li><a href="${escapeHtml(e.path)}">${escapeHtml(e.month || e.path)}</a></li>`;
}

// =========================================================================
// データ取得
// =========================================================================

// manifest → news.json の順で取得・成功時はキャッシュ更新
async function fetchAndRender() {
    let manifest = null;
    try {
        const res = await fetch(MANIFEST_URL, { cache: 'no-store' });
        if (res.ok) manifest = await res.json();
    } catch (e) {
        console.warn('manifest取得失敗', e);
    }

    if (manifest) {
        state.manifest = manifest;
        renderArchiveNav();
    }

    const newsUrl = (manifest && manifest.news) ? manifest.news : NEWS_FALLBACK;
    try {
        const res = await fetch(newsUrl, { cache: 'no-store' });
        if (!res.ok) throw new Error('HTTP ' + res.status);
        const raw = await res.json();
        state.newsData = normalizeNews(raw);
        renderCategoryChips();
        renderNews();
        // ネット成功時のみキャッシュ更新
        await refreshCache(state.newsData);
    } catch (e) {
        console.warn('ニュース取得失敗', e);
        showToast('最新データの取得に失敗・キャッシュを表示中');
    }
}

// =========================================================================
// イベント配線
// =========================================================================

function bindEvents() {
    // カテゴリchip (イベント委譲)
    const chips = document.getElementById('categoryChips');
    if (chips) {
        chips.addEventListener('click', (ev) => {
            const btn = ev.target.closest('[data-category]');
            if (!btn) return;
            state.categoryFilter = btn.getAttribute('data-category');
            renderCategoryChips();
            renderNews();
        });
    }

    // 検索ボックス
    const search = document.getElementById('newsSearch');
    if (search) {
        search.addEventListener('input', (ev) => {
            state.searchText = ev.target.value || '';
            renderNews();
        });
    }
}

// =========================================================================
// 起動
// =========================================================================

document.addEventListener('DOMContentLoaded', async () => {
    bindEvents();
    renderArchiveNav(); // 空manifestで先に空状態を描画

    // DB初期化・キャッシュ即時表示 (cache-then-network)
    try {
        await initDB();
        const cached = await getAllFromStore(STORE_NEWS);
        if (cached && cached.length > 0) {
            state.newsData = cached;
            renderCategoryChips();
            renderNews();
        }
    } catch (e) {
        console.warn('IndexedDB利用不可', e);
    }

    // ネット取得・最新反映
    await fetchAndRender();
});
