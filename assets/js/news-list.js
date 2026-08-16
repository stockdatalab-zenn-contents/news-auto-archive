'use strict';

/* =========================================================================
   news-list.js
   after1 の「6. ニュース一覧」用 interactive スクリプト
   - 検索ボックス（#newsSearch）: タイトル・ソースの部分一致絞り込み
   - Tierチップ（#tierChips .chip）: data-tier に対応する Tierグループのみ表示
   - Tier3/HN のアコーディオン（<details class="tier-group--collapsible">）は
     HTML5 標準の details 機能で動作するため JS 不要
   ========================================================================= */

(function () {
    const searchInput = document.getElementById('newsSearch');
    const chipsContainer = document.getElementById('tierChips');
    const groups = document.querySelectorAll('[data-tier-group]');

    if (!searchInput || !chipsContainer || !groups.length) return;

    function apply() {
        const q = (searchInput.value || '').toLowerCase().trim();
        const selectedChip = chipsContainer.querySelector('.chip.selected');
        const activeTier = selectedChip ? selectedChip.dataset.tier : 'all';

        groups.forEach(function (group) {
            const tier = group.dataset.tierGroup;
            const tierMatch = activeTier === 'all' || tier === activeTier;
            let visibleCount = 0;

            group.querySelectorAll('.card').forEach(function (card) {
                const titleEl = card.querySelector('.card-title');
                const sourceEl = card.querySelector('.source');
                const title = (titleEl ? titleEl.textContent : '').toLowerCase();
                const source = (sourceEl ? sourceEl.textContent : '').toLowerCase();
                const searchMatch = !q || title.includes(q) || source.includes(q);
                const show = tierMatch && searchMatch;
                card.classList.toggle('hidden', !show);
                if (show) visibleCount++;
            });

            group.classList.toggle('hidden', !tierMatch || visibleCount === 0);
        });
    }

    chipsContainer.querySelectorAll('.chip').forEach(function (chip) {
        chip.addEventListener('click', function () {
            chipsContainer.querySelectorAll('.chip').forEach(function (other) {
                other.classList.remove('selected');
                other.setAttribute('aria-pressed', 'false');
            });
            chip.classList.add('selected');
            chip.setAttribute('aria-pressed', 'true');
            apply();
        });
    });

    searchInput.addEventListener('input', apply);
})();
