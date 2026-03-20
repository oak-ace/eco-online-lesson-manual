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
- 教師/親は `createIfMissing: true` を設定すると専用アカウントを API で自動作成します
- Cognito の固定パスワードは `E2E_LOGIN_PASSWORD` を使って揃えます。`cognitoUserPoolId` を設定し、AWS SSO 済みの状態で実行します
- 生徒8名と画像取得用クラスは、スクリプトが専用名で作成・再利用します
- `init` 実行後、初期ユーザー一覧を `docs/ja/manual/test-users.md` と
  `tools/manual-capture/.artifacts/dev-image-fixtures-summary.json` に出力します
- 生徒アバターは avatar catalog から選んだ購入済みアバターを active avatar として設定します
