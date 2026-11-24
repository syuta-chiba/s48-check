# 勉強管理（受験勉強の管理アプリ）

iPhone のホーム画面に追加して使う、受験勉強の管理アプリ（PWA）です。

- 公開 URL: https://syuta-chiba.github.io/s48-check/
- 記録の保存先: 非公開リポジトリ [`syuta-chiba/study-data`](https://github.com/syuta-chiba/study-data)
  - `README.md`: 読める記録のまとめ（アプリが自動で書き換える）
  - `data.json`: 記録の本体

もとは「s1〜s48 の問題ごとに時間と ○×△ を付ける」アプリでした。URL（リポジトリ名 `s48-check`）はその名残です。
**URL を変えると、iPhone の中の記録が引き継がれなくなる**ので、URL は変えないでください。

## できること

| タブ | 中身 |
|---|---|
| ホーム | 試験まであと何日 / 今日の勉強時間と目標 / 科目ごとのタイマー（問題を使わない勉強）/ 今日の計画（締切から 1 日何問）/ 今週と先週 |
| 教材 | 科目 → 教材（問題集）→ 問題。問題ごとにストップウォッチと ○×△、(1)(2) の小問、1 回目・2 回目…の回、分析（日別・ペース・回ごと・苦手な問題） |
| 記録 | 勉強時間（今日・今週・今月・これまで）、日ごとのグラフ（科目別）、科目ごと・日ごとの表、手入力 |
| 設定 | 試験日 / 科目 / 1 日の目標時間 / GitHub に自動保存 / ファイルに保存・戻す |

## 使い始め（iPhone）

1. Safari で公開 URL を開き、共有 →「ホーム画面に追加」。
2. 設定タブで科目を登録し、試験日を入れる。
3. 教材タブで問題集を登録する（問題数・締切）。

## 記録の保存

記録は 3 か所に置けます。

1. **iPhone の中**（localStorage）。いつも自動。ただし Safari の履歴を消すと消えることがある。
2. **GitHub**（`study-data`）。トークンを入れると、変更の数秒後に自動で保存される。履歴を消した後や別の端末では、トークンを入れ直すと GitHub から読み込む。
3. **ファイル**。設定 →「ファイルに保存」で iCloud Drive などに JSON を置ける。「ファイルから戻す」で戻す。

### GitHub のトークンの作り方（最初の 1 回だけ）

パソコンでも iPhone でも作れます。

1. https://github.com/settings/personal-access-tokens/new を開く（fine-grained token）。
2. Token name: 勉強管理 / Expiration: 選べるいちばん長い期間。
3. Repository access: **Only select repositories → `study-data`**。
4. Permissions → Repository permissions → **Contents: Read and write**。
5. Generate token → `github_pat_…` をアプリの 設定 →「GitHub に保存する設定」に貼り、「今すぐ保存」。

トークンはパスワードと同じです。リポジトリや人には渡さず、パスワードアプリなどに控えてください。
トークンは iPhone の中（localStorage の `study-sync-v1`）にだけ置かれ、`data.json` には入りません。

## 開発

ビルドはありません。`index.html`（画面と CSS）と `app.js`（動き）を直して `main` に push すると、GitHub Pages に 1 分ほどで反映されます。

```
index.html      画面の骨組みと CSS
app.js          すべての処理（データ・画面・計測・集計・GitHub 保存）
sw.js           Service Worker（ネット優先、つながらないときはキャッシュ）
manifest.json   PWA の設定
icon-*.png      アイコン（tools/make_icons.py で作り直せる）
tests/e2e.py    ブラウザで動かすテスト（GitHub は模擬）
CLAUDE.md       引き継ぎ用の詳しいメモ（データの形・決まりごと）
```

テスト:

```
pip install playwright && playwright install chromium   # まだ入っていなければ
python tests/e2e.py           # all ok と出れば成功
python tests/e2e.py --shots   # /tmp/study-*.png に画面を保存
```
