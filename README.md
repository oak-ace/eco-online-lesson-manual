# eco-online-lesson-manual
Publication of the eco-online-lesson manual

## 不明点

- 「一通りのページ」の最終対象範囲が未確定。現時点では実到達可能な route page を優先して作成し、動的な session/content 系や restricted 系の扱いは今後明確化する。

## 開発データヘルパー

画像取得用の実データ設定ヘルパーを追加しています。

1. `tools/manual-capture/dev-image-fixtures.config.example.json` を
   `tools/manual-capture/dev-image-fixtures.config.json` としてコピーして編集
2. 認証は `ECO_API_TEST_BEARER_TOKEN` または `ECO_SETUP_EMAIL` / `ECO_SETUP_PASSWORD` を設定
3. 実行例

```bash
npm run setup:image-fixtures -- init
npm run setup:image-fixtures -- teacher-mode multi
npm run setup:image-fixtures -- student-mode none
npm run setup:image-fixtures -- status
```

注意:
- 教師アカウントと親アカウントは既存ユーザーを前提にしています
- 生徒8名と画像取得用クラスは、スクリプトが専用名で作成・再利用します
