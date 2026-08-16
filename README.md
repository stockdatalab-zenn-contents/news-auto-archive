# AI News Archive

AI・IT・トレード分野のニュースを収集し、日次/週次/月次でまとめ公開する静的サイト。

## 目的

- 公開専用の静的コピー（原本は Google Drive 側で管理）
- GitHub Pages でフォルダ配信し、日次/週次/月次のまとめHTMLを閲覧可能にする
- フロントは Pure Vanilla JS（フレームワーク・CDN・外部ライブラリ不使用）

## ディレクトリ構成

```
ai-news-archive/
├── index.html            # トップ（最新ニュース + アーカイブナビ）
├── manifest.json         # 公開済みページ一覧（日次/週次/月次）
├── news.json             # 最新日のニュース配列
├── .nojekyll             # Jekyll無効化・フォルダをそのまま配信
├── README.md
├── assets/
│   ├── css/style.css     # 共通スタイル（生成HTMLも同ファイルをリンク）
│   ├── js/app.js         # 表示ロジック（IndexedDBキャッシュ + manifest描画）
│   └── img/.gitkeep
├── daily/                # 日次HTML置き場（daily/YYYY/MM/YYYY-MM-DD.html）
├── weekly/               # 週次HTML置き場（weekly/YYYY/YYYY-Www.html）
└── monthly/              # 月次HTML置き場（monthly/YYYY/YYYY-MM.html）
```

## GitHub Pages 設定手順

1. リポジトリ作成（例: `ai-news-archive`）
2. 本ファイル一式を `main` ブランチへ push
3. Settings → Pages → Source = `main` / `/root`
4. `.nojekyll` によりフォルダがそのまま配信される（`daily/` などが 404 にならない）

## 自動更新について

- 日次/週次/月次HTML・`manifest.json`・`news.json` は **GASバッチが自動更新**
- 手動で編集しない（次回バッチで上書きされる）
- `assets/` 配下（CSS/JS）は共通アセット・手動メンテ対象

## データ仕様

### ニュース記事（news.json 内の各要素）

```
{
  id, title, link, pubDate, description,
  source, tier, category, importance, fetchedAt
}
```

- `category` の例: `IT・AI` / `トレード`
- `tier` の表示: 1 → Tier1、2 → Tier2、4 → HN、その他 → Tier{n}

### manifest.json

```
{
  "updatedAt": "ISO日時",
  "news": "news.json",
  "daily":   [ { "date": "YYYY-MM-DD", "path": "daily/YYYY/MM/YYYY-MM-DD.html", "generatedAt": "ISO" } ],
  "weekly":  [ { "week": "YYYY-Www", "start": "YYYY-MM-DD", "end": "YYYY-MM-DD", "path": "weekly/YYYY/YYYY-Www.html", "generatedAt": "ISO" } ],
  "monthly": [ { "month": "YYYY-MM", "path": "monthly/YYYY/YYYY-MM.html", "generatedAt": "ISO" } ]
}
```

- 各配列は日付降順（DESC）でソート
- 空配列でも動作（アーカイブは空状態を表示）

## 動作概要

- 起動時に IndexedDB（`AiNewsArchiveDB` / ストア `newsCache`）からキャッシュを即時描画（cache-then-network）
- `manifest.json` → `news.json` の順で取得し、成功時に一覧更新 + キャッシュ更新（clear + putAll）
- 取得失敗時はトースト表示のうえキャッシュ表示を継続
- カテゴリchip（全て + 出現カテゴリ）とフリーテキスト検索（タイトル・ソース、大文字小文字無視）で絞り込み
