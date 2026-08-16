/* =========================================================================
   AI News Archive - トップページ フロントエンド (Pure Vanilla JS)
   after2/AI News Archive.html の「今日の要約プレビュー + アーカイブ」構成に対応。

   処理概要:
   - manifest.json … 日次/週次/月次アーカイブナビ + 最新日次パス
   - latest-summary.json … 最新日次の全体サマリー/注目ニュース/統計（GASが発行）
   - 上記を fetch し、Hero統計・要約プレビュー・アーカイブナビを動的描画

   互換・方針:
   - manifest.json / news.json のスキーマは不変（news.json はトップでは未使用・日次ページ側で使用）
   - latest-summary.json は後方互換の新規ファイル（取得失敗時は index.html の初期表示を維持）
   - 全記事一覧・検索・Tierフィルタは日次ページ「6. ニュース一覧」へ集約（トップには持たない）
   - 全動的テキストは escapeHtml。google.script.* などGAS依存は一切なし
   ========================================================================= */

'use strict';

// ---- 定数 ----
const MANIFEST_URL = './manifest.json';
const LATEST_SUMMARY_URL = './latest-summary.json';

// ---- 状態 ----
const state = {
    manifest: null,   // manifest.json
    latest: null      // latest-summary.json
};

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

// 全体サマリー本文の重要語を strong.kw で強調（escape 後にプレーン語を全置換）
function highlightKeywords(text, keywords) {
    let s = escapeHtml(text);
    (keywords || []).forEach(kw => {
        const k = escapeHtml(String(kw || '')).trim();
        if (!k) return;
        s = s.split(k).join('<strong class="kw">' + k + '</strong>');
    });
    return s;
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

function setText(id, value) {
    const el = document.getElementById(id);
    if (el) el.textContent = (value === null || value === undefined) ? '' : String(value);
}

// =========================================================================
// Hero統計（latest-summary.json 由来。無ければ 0/空のまま）
// =========================================================================
function renderHeroStats() {
    const L = state.latest;
    if (!L) return;
    setText('heroTotal', L.total != null ? L.total : 0);
    setText('heroTier1', L.tier1 != null ? L.tier1 : 0);
    setText('heroSources', L.sources != null ? L.sources : 0);
    if (L.date) setText('heroDateLabel', L.date);
}

// =========================================================================
// 今日の要約プレビュー（全体サマリー + 注目ニュース + CTAリンク）
// =========================================================================
function renderDailyPreview() {
    const L = state.latest;
    const m = state.manifest && Array.isArray(state.manifest.daily) ? state.manifest.daily[0] : null;

    // CTAリンク: latest-summary.path 優先、無ければ manifest.daily[0].path
    const path = (L && L.path) || (m && m.path) || '';
    const date = (L && L.date) || (m && m.date) || '';
    const link = document.getElementById('dailyPreviewLink');
    if (link && path) {
        link.setAttribute('href', path);
        link.textContent = (date || '最新') + ' の日次まとめを読む →';
    }

    if (!L) return;

    // 全体サマリー（kw強調つき）
    const bullets = document.querySelector('.daily-preview__bullets');
    if (bullets && Array.isArray(L.overallSummary)) {
        bullets.innerHTML = L.overallSummary
            .map(o => '<li>' + highlightKeywords(o.text || '', o.keywords) + '</li>')
            .join('');
    }

    // 注目ニュース（title + summary）
    const featured = document.querySelector('.daily-preview__featured');
    if (featured && Array.isArray(L.featured)) {
        featured.innerHTML = L.featured.map(f =>
            '<li>'
            + '<p class="daily-preview__featured-title">' + escapeHtml(f.title || '') + '</p>'
            + '<p class="daily-preview__featured-summary">' + escapeHtml(f.summary || '') + '</p>'
            + '</li>'
        ).join('');
    }
}

// =========================================================================
// アーカイブナビ (manifest から生成)
// =========================================================================
function renderArchiveNav() {
    const root = document.getElementById('archiveNav');
    if (!root) return;

    const m = state.manifest || { daily: [], weekly: [], monthly: [] };
    const daily = Array.isArray(m.daily) ? m.daily : [];
    const weekly = Array.isArray(m.weekly) ? m.weekly : [];
    const monthly = Array.isArray(m.monthly) ? m.monthly : [];

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
async function fetchJson(url) {
    try {
        const res = await fetch(url, { cache: 'no-store' });
        if (res.ok) return await res.json();
    } catch (e) {
        console.warn('取得失敗', url, e);
    }
    return null;
}

async function fetchAndRender() {
    const [manifest, latest] = await Promise.all([
        fetchJson(MANIFEST_URL),
        fetchJson(LATEST_SUMMARY_URL)
    ]);
    if (manifest) state.manifest = manifest;
    if (latest) state.latest = latest;

    renderArchiveNav();
    renderHeroStats();
    renderDailyPreview();

    if (!latest) showToast('最新の要約データを取得できませんでした');
}

// =========================================================================
// 起動
// =========================================================================
document.addEventListener('DOMContentLoaded', () => {
    renderArchiveNav(); // 空manifestで先に空状態を描画
    fetchAndRender();
});
