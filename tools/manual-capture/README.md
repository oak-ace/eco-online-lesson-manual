# Manual Capture Test Notes

`tools/manual-capture` では、実サーバに接続する Playwright ベースの画面取得と fixture 整備を行います。`oak-ace/eco-online-lesson` の Playwright / scripts 運用メモのうち、この repo に効く点をここへ寄せています。

## 基本方針

- 実サーバ向けの処理は、当日 JST の fixture / lesson 前提で動かす
- `setup-dev-image-fixtures.mjs` と `generate-initial-manual.mjs` は直列運用を前提にする
- URL 遷移だけでなく、安定した主要 UI を待って画面取得する
- API と asset 配信は別経路として切り分けて調査する
- 実行時の base URL / API URL / AWS 設定は毎回ログで確認する

## 実行前チェック

1. `tools/manual-capture/dev-image-fixtures.config.example.json` をコピーして `tools/manual-capture/dev-image-fixtures.config.json` を作る
2. `ECO_SETUP_EMAIL` / `ECO_SETUP_PASSWORD` または `ECO_API_TEST_BEARER_TOKEN` を設定する
3. Cognito ユーザー自動作成を使う場合は `E2E_LOGIN_PASSWORD` と `cognitoUserPoolId` を揃える
4. `AWS_PROFILE` と `AWS_REGION` を明示する
5. 以前のシェルで export した古い環境値を信用せず、今回使う値をログで確認する

## 実行順

```bash
npm run setup:image-fixtures -- init
ECO_BASE_URL=https://... E2E_LOGIN_PASSWORD=... npm run generate:manual
```

必要に応じて:

```bash
npm run setup:image-fixtures -- teacher-mode multi
npm run setup:image-fixtures -- student-mode none
```

## 運用 Tips

- 2 本の実サーバ処理を同時に走らせないよう、両 script は `.artifacts/manual-capture.lock` を使います
- 並列実行をどうしても許可したい場合だけ `MANUAL_CAPTURE_ALLOW_PARALLEL=true` を使います
- fixture setup の最新実行内容は `.artifacts/setup-dev-image-fixtures.last-run.json` に残ります
- manual capture の最新実行内容は `.artifacts/last-run.json` に残ります
- 実行中に API 応答が不安定でも、URL だけで失敗判定せず主要 UI の安定を優先します
- 画面は出るのに画像やアバターだけ欠けるときは、API ではなく asset 配信 URL を先に疑います
