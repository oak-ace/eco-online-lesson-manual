# コンテクスト定義

このディレクトリには、マニュアル生成時に Codex へ渡す日本語コンテクスト定義を置きます。

目的:

- 画像だけでは読み取れない背景や目的を補足する
- 画面ごとの説明方針を安定させる
- 再生成時にも手修正ではなく入力情報として意図を反映できるようにする

基本方針:

- 1ページにつき1ファイルを基本とする
- ファイル名は manual page の slug に合わせる
- 生成物の Markdown を直接編集せず、この入力定義を修正する

例:

- `setup-device.json`
- `login.json`
- `home-first-screen.json`
- `teacher-first-screen.json`
- `shared-first-screen.json`

主な項目:

- `page_id`: 対象ページID
- `title`: ページタイトル
- `audience`: 想定読者
- `purpose`: 画面の目的
- `background`: 背景情報
- `writer_guidance`: 文章生成時に重視したい観点
- `item_overrides`: 項目ごとの補足説明

運用:

- 追加したい説明や背景がある場合は、この JSON を更新する
- 生成スクリプト側は、この定義を読んで Markdown 本文の説明へ反映する
