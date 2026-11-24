# 引き継ぎメモ（勉強管理 PWA）

人向けの説明は README.md にあります。このファイルは、直す人（Claude を含む）向けの決まりごとと、データの形をまとめたものです。

## 前提

- 使う人は、大学・高校受験の勉強をする本人です。iPhone のホーム画面から開きます。画面の文はすべて、やさしい日本語で書きます。
- 公開は GitHub Pages（`syuta-chiba/s48-check` の main ブランチ直下）です。push すると反映されます。
- **URL・localStorage のキー `s48-check-v1` を変えないこと。** 変えると iPhone の中の記録が読めなくなります。
- 記録の保存先は非公開リポジトリ `syuta-chiba/study-data` です（`data.json` と `README.md`）。

## 作り

- `index.html`: 画面の骨組みと CSS。ボタンには `data-act="名前"` を付け、`app.js` の `ACT[名前]` が受け取ります（クリックは document で 1 か所にまとめて処理しています）。
- `app.js`: データ（`db`）、描画（`renderHome / renderBooks / renderLog / renderSet / renderBook / renderDetail / renderAna`）、計測、集計、ファイル保存、GitHub 保存（`Sync`）を受け持ちます。
  - 状態を変えたら `save()` → `renderAll()` を呼びます。`save()` は `updatedAt` を更新して localStorage に書き、GitHub 保存を予約します。
  - 0.25 秒ごとの `tick()` が、`data-live` の付いた要素（計測中の時間など）だけを書き換えます。
- 入力は `form(title, fields, {del})`（下から出るシート）で受けます。prompt/confirm は、短い確認にだけ使います。

## データの形（db, v:2）

```js
{
  v: 2,
  exams:    [{id, name, date:'YYYY-MM-DD'}],
  subjects: [{id, name, slot}],            // slot 0〜7 = 色（--c0〜--c7）、8 = 灰色
  books:    [{id, subjectId, name, count, prefix, parts:{s4:2}, target:'YYYY-MM-DD'|'', cur, rounds:[{name, items:{}}]}],
  running:  null | {type:'q', book, round, q, start} | {type:'free', sub, start},   // 同時に動くのは 1 つ
  log:      [{d:開始ms, ms, sub, book?, q?, manual?, fix?}],                      // 勉強時間の記録
  goalMin, updatedAt, backupAt
}
// items のキー = 問題の id。prefix + 番号（例 s12）。小問に分けた問題は s4-1, s4-2…
// items[id] = {t: 時間ms, m: 'o'|'x'|'t'|null, s: 最初にスタートした時刻, at: ○×△を付けた時刻}
```

- 時間は「スタートした時刻との差」で計っています。アプリが裏で止まっていても時間はずれません。
- 勉強時間は `log` の合計です。問題の時間を手で直したりリセットしたりしたときは、差の分を `fix:1` の行として `log` に足します（マイナスもあります）。
- 前の版（`{rounds, cur, parts}` だけの形）は `migrate()` で v2 に変えます。ファイルから戻すときも `migrate()` を通します。

## 集計の決まり

- 正答率 = ○ ÷ ○×△ を付けた問題。△ は正解に数えません。
- 「その日にやった問題」は ○×△ を付けた日（`at`）で数えます。
- 小問に分けた問題は、小問 1 つを 1 問として数えます。
- 計画: `need = ceil((残り + 今日やった数) / (締切までの日数 + 1))`。今日と締切の日の両方を数に入れます。
- 週は月曜はじまりです。

## GitHub 保存（Sync）

- GitHub の contents API で `data.json` を GET し、`updatedAt` の新しいほうを残します。GitHub のほうが新しければ読み込み、iPhone のほうが新しければ PUT します。PUT が成功したら `README.md`（`mdReport()`）も書き換えます。
- この端末で初めてつなぐとき（`cfg.sha` がない）に GitHub に記録があれば、どちらを残すか confirm で聞きます。空の端末で上書きしないためです。
- 記録が空の端末からは、GitHub にファイルを作りません。
- アプリを閉じるとき（visibilitychange → hidden）は、読み込みをせずにすぐ PUT します（`flush`）。
- トークン（fine-grained PAT。study-data だけ、Contents read/write）は `study-sync-v1` に入れます。db やリポジトリには入れません。

## グラフ

- 日ごとの勉強時間を、科目ごとに積み上げた棒グラフ（SVG、手書き）にしています。科目の色は、科目を登録した順に固定の色を割り当てます（`slot`）。並び替えで色は変わりません。
- 色は、色の見分けにくさを検証済みの 8 色（ライト・ダークで別の値）です。index.html の `--c0〜--c7` にあります。勝手に足したり順番を変えたりしないでください。9 個目以降の科目は灰色にします。
- 同じ数字を表でも出しています（記録タブの「科目ごと」「日別」）。

## 確かめ方

- `python tests/e2e.py` を実行します。リポジトリを配信して、Chromium で、引き継ぎ、科目・教材、計測、小問、科目タイマー、手入力、グラフ、GitHub 保存（模擬）、2 台の間で記録が行き来すること、履歴を消した端末、空の端末を確かめます。
- **本物の GitHub やトークンでは試さないこと。** テストでは `page.route` で api.github.com を模擬します。
- 画面を変えたら `--shots` で /tmp に画像を出し、見て確かめます（幅 390px＝iPhone）。
