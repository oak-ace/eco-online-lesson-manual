import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  copyFile,
  mkdir,
  readFile,
  rm,
  writeFile,
} from "node:fs/promises";
import { chromium } from "playwright";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(__dirname, "..", "..");
const docsRoot = path.join(repoRoot, "docs");
const imagesRoot = path.join(docsRoot, "assets", "images", "common");
const contextBaseRoot = path.join(repoRoot, "tools", "manual-capture", "context");
const artifactsRoot = path.join(
  repoRoot,
  "tools",
  "manual-capture",
  ".artifacts",
);

const upstreamRoot =
  process.env.UPSTREAM_REPO_DIR ?? "/workspaces/eco-online-lesson-skim";
const upstreamLessonPackageJson = path.join(
  upstreamRoot,
  "apps",
  "lesson",
  "package.json",
);

const baseUrl = process.env.ECO_BASE_URL;
const teacherEmail = process.env.E2E_TEACHER_EMAIL;
const parentEmail = process.env.E2E_PARENT_EMAIL;
const password = process.env.E2E_LOGIN_PASSWORD;

if (!baseUrl || !teacherEmail || !parentEmail || !password) {
  throw new Error(
    "ECO_BASE_URL, E2E_TEACHER_EMAIL, E2E_PARENT_EMAIL, E2E_LOGIN_PASSWORD are required.",
  );
}

const pageSpecs = [
  {
    slug: "setup-device",
    title: "Setup Device",
    tag: "common",
    imageName: "screen-common-setup-device.png",
    description:
      "端末の利用モードを選択し、ログイン前または再設定時の入口として利用する画面です。",
    imageDescription:
      "ソフトウェアバージョン、保存済みデータの初期化、Device Mode の選択、ログイン導線が表示されます。",
    nextPages: [
      { slug: "login", label: "Login" },
    ],
    items: [
      {
        id: "software-version",
        label: "ソフトウェアバージョン表示",
        purpose: "対象アプリのバージョンを確認するための表示です。",
        states: [
          "表示されている値が現在のアプリバージョンです。",
        ],
      },
      {
        id: "reset-button",
        label: "Reset ボタン",
        purpose: "保存済みの端末状態を初期化するための操作です。",
        operation:
          "押下すると保存済みデータを整理し、再設定しやすい状態に戻します。",
      },
      {
        id: "device-mode",
        label: "Device Mode 選択",
        purpose: "Home / Teacher / Shared のどの用途で端末を使うかを選ぶ項目です。",
        states: [
          "Home は家庭利用向けです。",
          "Teacher は授業進行端末向けです。",
          "Shared は共用端末向けです。",
        ],
      },
      {
        id: "login-button",
        label: "Login ボタン",
        purpose: "現在の設定内容で認証導線へ進むための主操作です。",
        operation:
          "押下すると認証状態に応じてログイン画面または対象経路へ進みます。",
      },
    ],
  },
  {
    slug: "login",
    title: "Login",
    tag: "common",
    imageName: "screen-common-login.png",
    description:
      "メールアドレスとパスワードで認証するための画面です。認証後は端末モードと権限に応じた経路へ進みます。",
    imageDescription:
      "メールアドレス入力欄、パスワード入力欄、ログインボタンが表示される認証画面です。",
    nextPages: [
      { slug: "home-switch-student", label: "Home Route First Screen" },
      { slug: "teacher-select-class", label: "Teacher Class Selection" },
      { slug: "shared-select-class", label: "Shared Class Selection" },
    ],
    items: [
      {
        id: "email-field",
        label: "EMAIL 入力欄",
        purpose: "ログイン対象のメールアドレスを入力する項目です。",
        operation: "アカウントのメールアドレスを入力します。",
      },
      {
        id: "password-field",
        label: "PASSWORD 入力欄",
        purpose: "ログイン対象のパスワードを入力する項目です。",
        operation: "アカウントのパスワードを入力します。",
      },
      {
        id: "login-button",
        label: "LOGIN ボタン",
        purpose: "入力済みの認証情報でログインを実行する主操作です。",
        operation:
          "押下すると認証処理が実行され、成功時は対象経路へ遷移します。",
        conditions: "有効な認証情報を入力している必要があります。",
      },
    ],
  },
  {
    slug: "home-switch-student",
    title: "Home Route First Screen",
    tag: "home",
    imageName: "screen-home-switch-student.png",
    description:
      "Home 経路でログインした直後に、生徒とクラスを確認して開始するための最初の画面です。",
    imageDescription:
      "対象生徒、学校・クラス情報、開始ボタンが表示されます。",
    nextPages: [
      { slug: "home-startup", label: "Home Startup" },
    ],
    items: [
      {
        id: "student-name",
        label: "対象生徒表示",
        purpose: "現在この端末で利用対象になっている生徒を確認するための表示です。",
      },
      {
        id: "class-info",
        label: "クラス情報表示",
        purpose: "対象生徒に紐づく学校名・クラス名・レベル色を確認するための表示です。",
      },
      {
        id: "start-button",
        label: "Start ボタン",
        purpose: "選択中の生徒とクラスで Home 経路を開始する主操作です。",
        operation: "押下すると Home の起動画面へ進みます。",
      },
    ],
  },
  {
    slug: "home-startup",
    title: "Homework Page",
    tag: "home",
    imageName: "screen-home-startup.png",
    description:
      "家庭端末向けの HomeworkPage です。宿題、進捗確認、授業参加導線をここから利用します。",
    imageDescription:
      "ヘッダー、メニュー、Student Card コンテンツが表示される Home の HomeworkPage です。",
    nextPages: [
      { slug: "home-mypage", label: "My Page" },
      { slug: "home-lesson", label: "Home Lesson" },
    ],
    items: [
      {
        id: "school-name",
        label: "学校名表示",
        purpose: "現在表示中の学習対象に紐づく学校名を確認するための表示です。",
      },
      {
        id: "class-name",
        label: "クラス名表示",
        purpose: "Homework 表示モードであることと、現在の表示区分を確認するための表示です。",
      },
      {
        id: "level-color",
        label: "レベル色表示",
        purpose: "現在の学習対象のレベル色を確認するための表示です。",
      },
      {
        id: "unit-button",
        label: "UNIT ボタン",
        purpose: "表示する Unit を確認・切り替えるための操作です。",
        operation: "押下すると選択可能な Unit を切り替えます。",
      },
      {
        id: "student-status",
        label: "生徒ステータス表示",
        purpose: "現在の生徒表示状態を確認するための表示です。",
      },
      {
        id: "menu-button",
        label: "メニューボタン",
        purpose: "進捗確認や授業参加などの操作メニューを開くための操作です。",
        operation: "押下すると起動画面の操作メニューを表示します。",
      },
    ],
  },
  {
    slug: "home-mypage",
    title: "My Page",
    tag: "home",
    imageName: "screen-home-mypage.png",
    description:
      "生徒の進捗やポイント、学習状況を確認するためのページです。",
    imageDescription:
      "生徒名、コイン、ポイント、授業予定、進捗確認 UI が表示されます。",
    nextPages: [
      { slug: "home-avatar", label: "Avatar" },
    ],
    items: [
      {
        id: "profile-header",
        label: "プロフィールヘッダー",
        purpose: "生徒名や所持コインなど、対象生徒の基本情報を確認するための表示です。",
      },
      {
        id: "next-class",
        label: "次回授業情報",
        purpose: "次回授業の予定や時刻を確認するための表示です。",
      },
      {
        id: "progress-panel",
        label: "進捗確認パネル",
        purpose: "Unit ごとの進捗や確認操作を行うための表示です。",
      },
    ],
  },
  {
    slug: "home-avatar",
    title: "Avatar",
    tag: "home",
    imageName: "screen-home-avatar.png",
    description:
      "生徒のアバターや背景色を確認・変更するためのページです。",
    imageDescription:
      "コイン残高、選択中アバター、背景色、フィルター、アバター一覧が表示されます。",
    items: [
      {
        id: "avatar-header",
        label: "アバターヘッダー",
        purpose: "対象生徒名とコイン残高を確認するための表示です。",
      },
      {
        id: "preview-panel",
        label: "プレビュー表示",
        purpose: "現在選択中のアバターや背景色を確認するための表示です。",
      },
      {
        id: "filter-panel",
        label: "フィルター操作",
        purpose: "所有状態やカテゴリで表示対象を絞り込むための操作です。",
        operation: "条件を切り替えると表示するアバター候補が変わります。",
      },
    ],
  },
  {
    slug: "teacher-select-class",
    title: "Teacher Class Selection",
    tag: "teacher",
    imageName: "screen-teacher-select-class.png",
    description:
      "Teacher 経路で担当クラスを選択する画面です。この後に授業プレビューや開始導線へ進みます。",
    imageDescription:
      "ログインユーザー、学校名、クラス名、レベル色、選択ボタンが表示されます。",
    nextPages: [
      { slug: "teacher-startup", label: "Teacher Startup" },
    ],
    items: [
      {
        id: "teacher-name",
        label: "ログインユーザー表示",
        purpose: "現在ログイン中の Teacher ユーザーを確認するための表示です。",
      },
      {
        id: "class-card",
        label: "クラス情報カード",
        purpose: "対象候補の学校名・クラス名・レベル色を確認するための表示です。",
      },
      {
        id: "select-button",
        label: "SELECT ボタン",
        purpose: "選択中のクラスを確定する主操作です。",
        operation: "押下すると Teacher の起動画面へ進みます。",
      },
    ],
  },
  {
    slug: "teacher-startup",
    title: "Preview Page",
    tag: "teacher",
    imageName: "screen-teacher-startup.png",
    description:
      "Teacher 向けの PreviewPage です。授業内容を確認し、授業開始や各種操作の入口になります。",
    imageDescription:
      "ヘッダー、メニュー、Student Card コンテンツ、StudentsPanel が表示される Teacher の PreviewPage です。",
    nextPages: [
      { slug: "teacher-lesson", label: "Teacher Lesson" },
    ],
    items: [
      {
        id: "school-name",
        label: "学校名表示",
        purpose: "現在対象の学校名を確認するための表示です。",
      },
      {
        id: "class-name",
        label: "クラス名表示",
        purpose: "現在対象のクラス名を確認するための表示です。",
      },
      {
        id: "level-color",
        label: "レベル色表示",
        purpose: "現在のレッスン色を確認・変更するための表示兼操作です。",
      },
      {
        id: "unit-button",
        label: "UNIT ボタン",
        purpose: "Preview で表示する Unit を確認・変更するための操作です。",
      },
      {
        id: "students-toggle",
        label: "StudentsPanel 表示切替",
        purpose: "StudentsPanel の開閉を切り替える操作です。",
      },
      {
        id: "students-level",
        label: "StudentsPanel モード切替",
        purpose: "StudentsPanel の表示モードを icon / simple / full / progress で切り替える操作です。",
      },
      {
        id: "menu-button",
        label: "メニューボタン",
        purpose: "Start Lesson などの主要操作を開くための操作です。",
        operation: "押下すると Teacher 用の起動メニューを表示します。",
      },
    ],
  },
  {
    slug: "shared-select-class",
    title: "Shared Class Selection",
    tag: "shared",
    imageName: "screen-shared-select-class.png",
    description:
      "Shared 経路で対象クラスを選択する画面です。共用端末で利用するクラスをここで決めます。",
    imageDescription:
      "学校名、クラス名、レベル色、選択ボタンが表示されます。",
    nextPages: [
      { slug: "shared-select-student", label: "Shared Student Selection" },
    ],
    items: [
      {
        id: "teacher-name",
        label: "ログインユーザー表示",
        purpose: "現在ログイン中の Shared 端末管理ユーザーを確認するための表示です。",
      },
      {
        id: "class-card",
        label: "クラス情報カード",
        purpose: "共用端末で選択するクラス情報を確認するための表示です。",
      },
      {
        id: "select-button",
        label: "SELECT ボタン",
        purpose: "選択中のクラスを確定して次の生徒選択へ進む主操作です。",
        operation: "押下すると Shared の生徒選択画面へ進みます。",
      },
    ],
  },
  {
    slug: "shared-select-student",
    title: "Shared Student Selection",
    tag: "shared",
    imageName: "screen-shared-select-student.png",
    description:
      "Shared 経路で共用端末の利用生徒を選択する画面です。",
    imageDescription:
      "対象クラス、生徒選択 UI、生徒プレビュー、選択ボタンが表示されます。",
    nextPages: [
      { slug: "shared-startup", label: "Shared Startup" },
    ],
    items: [
      {
        id: "class-info",
        label: "クラス情報表示",
        purpose: "現在対象となっているクラスを確認するための表示です。",
      },
      {
        id: "student-selector",
        label: "生徒選択 UI",
        purpose: "利用生徒を切り替えて選択するための操作です。",
        operation: "選択値を切り替えると下部の生徒表示が更新されます。",
      },
      {
        id: "select-button",
        label: "SELECT ボタン",
        purpose: "選択中の生徒を確定する主操作です。",
        operation: "押下すると Shared の起動画面へ進みます。",
      },
    ],
  },
  {
    slug: "shared-startup",
    title: "Shared Homework Page",
    tag: "shared",
    imageName: "screen-shared-startup.png",
    description:
      "共用端末向けの HomeworkPage です。授業参加や教材参照の入口になります。",
    imageDescription:
      "ヘッダー、メニュー、Student Card コンテンツが表示される Shared の HomeworkPage です。",
    items: [
      {
        id: "school-name",
        label: "学校名表示",
        purpose: "現在対象の学校名を確認するための表示です。",
      },
      {
        id: "class-name",
        label: "クラス名表示",
        purpose: "Shared Homework 表示モードであることを確認するための表示です。",
      },
      {
        id: "level-color",
        label: "レベル色表示",
        purpose: "現在の学習対象のレベル色を確認するための表示です。",
      },
      {
        id: "unit-button",
        label: "UNIT ボタン",
        purpose: "表示する Unit を確認・切り替えるための操作です。",
      },
      {
        id: "menu-button",
        label: "メニューボタン",
        purpose: "Enter Lesson などの主要操作を開くための操作です。",
        operation: "押下すると Shared 用の起動メニューを表示します。",
      },
    ],
  },
  {
    slug: "teacher-lesson",
    title: "Teacher Lesson Page",
    tag: "lesson",
    imageName: "screen-lesson-teacher-session.png",
    description:
      "Teacher が実際の Lesson session に入った画面です。Preview と異なり、同期状態と Lesson 操作が有効になります。",
    imageDescription:
      "Lesson ヘッダー、同期モード、StudentsPanel 操作、Student Card コンテンツが表示されます。",
    nextPages: [
      { slug: "teacher-panel-none-md", label: "Teacher StudentsPanel Hidden" },
      { slug: "teacher-panel-icon-md", label: "Teacher StudentsPanel Icon" },
      { slug: "teacher-panel-simple-md", label: "Teacher StudentsPanel Simple" },
      { slug: "teacher-panel-full-md", label: "Teacher StudentsPanel Full" },
      { slug: "teacher-panel-progress-md", label: "Teacher StudentsPanel Progress" },
      { slug: "teacher-content-vocabulary-particle", label: "Vocabulary Particle" },
      { slug: "teacher-content-games", label: "Games" },
    ],
    items: [
      { id: "school-name", label: "学校名表示", purpose: "授業対象の学校名を確認するための表示です。" },
      { id: "class-name", label: "クラス名表示", purpose: "授業対象のクラス名を確認するための表示です。" },
      { id: "level-color", label: "レベル色表示", purpose: "現在のレッスン色と表示対象を確認するための表示です。" },
      { id: "unit-button", label: "UNIT ボタン", purpose: "表示する Unit を確認・切り替えるための操作です。" },
      { id: "section", label: "SECTION 表示", purpose: "現在の SECTION を確認するための表示です。" },
      { id: "menu-button", label: "メニューボタン", purpose: "End Lesson や content 切替を含む Lesson メニューを開くための操作です。" },
      { id: "students-toggle", label: "StudentsPanel 表示切替", purpose: "StudentsPanel の開閉を切り替える操作です。" },
      { id: "students-level", label: "StudentsPanel モード切替", purpose: "StudentsPanel の表示モードを変更する操作です。" },
      { id: "sync-mode", label: "同期モード操作", purpose: "Study / Play を切り替え、内容の同期方法を制御する操作です。" },
      { id: "datetime", label: "日時表示", purpose: "現在時刻と日付を確認するための表示です。" },
    ],
  },
  {
    slug: "home-lesson",
    title: "Student Lesson Page",
    tag: "lesson",
    imageName: "screen-lesson-home-session.png",
    description:
      "生徒側が Lesson session に参加した画面です。Teacher と異なり、Viewer / My Page など生徒向けの操作が表示されます。",
    imageDescription:
      "Lesson ヘッダー、生徒向け同期表示、Student Card コンテンツが表示されます。",
    items: [
      { id: "school-name", label: "学校名表示", purpose: "授業対象の学校名を確認するための表示です。" },
      { id: "class-name", label: "クラス名表示", purpose: "授業対象のクラス名を確認するための表示です。" },
      { id: "level-color", label: "レベル色表示", purpose: "現在のレッスン色を確認するための表示です。" },
      { id: "unit-button", label: "UNIT ボタン", purpose: "表示中の Unit を確認するための表示です。" },
      { id: "section", label: "SECTION 表示", purpose: "現在の SECTION を確認するための表示です。" },
      { id: "menu-button", label: "メニューボタン", purpose: "Exit Lesson などの Lesson メニューを開くための操作です。" },
      { id: "students-toggle", label: "StudentsPanel 表示切替", purpose: "StudentsPanel の開閉を切り替える操作です。" },
      { id: "students-level", label: "StudentsPanel モード切替", purpose: "StudentsPanel の表示モードを変更する操作です。" },
      { id: "viewer-status", label: "Viewer / My Page 操作", purpose: "生徒側の同期状態表示や My Page 導線を確認するための操作です。" },
      { id: "datetime", label: "日時表示", purpose: "現在時刻と日付を確認するための表示です。" },
    ],
  },
  {
    slug: "teacher-panel-none-md",
    title: "Teacher StudentsPanel Hidden",
    tag: "lesson",
    imageName: "screen-lesson-teacher-panel-none-md.png",
    description: "Teacher Lesson で StudentsPanel を閉じた状態です。",
    imageDescription: "中央の教材領域を広く使うレイアウトです。",
    items: [{ id: "student-card", label: "中央コンテンツ", purpose: "StudentsPanel を閉じた状態で教材領域を確認するための表示です。" }],
  },
  {
    slug: "teacher-panel-icon-md",
    title: "Teacher StudentsPanel Icon",
    tag: "lesson",
    imageName: "screen-lesson-teacher-panel-icon-md.png",
    description: "Teacher Lesson の md+ 画面で StudentsPanel を icon 表示にした状態です。",
    imageDescription: "生徒アイコン列と加点・減点アイコンが表示されます。",
    items: [
      { id: "avatar-button", label: "生徒アイコン", purpose: "対象生徒を識別し、詳細カード表示の起点にするための操作です。" },
      { id: "score-add", label: "加点アイコン", purpose: "その生徒の today score を加点するための操作です。" },
      { id: "score-remove", label: "減点アイコン", purpose: "その生徒の today score を減点するための操作です。" },
    ],
  },
  {
    slug: "teacher-panel-icon-xs",
    title: "Teacher StudentsPanel Icon XS",
    tag: "lesson",
    imageName: "screen-lesson-teacher-panel-icon-xs.png",
    description: "Teacher Lesson の xs 画面で StudentsPanel を icon 表示にした状態です。",
    imageDescription: "上部に折り返し配置された生徒アイコン列が表示されます。",
    items: [{ id: "avatar-button", label: "生徒アイコン列", purpose: "xs 画面で折り返し表示される生徒アイコン列を確認するための表示です。" }],
  },
  {
    slug: "teacher-panel-simple-md",
    title: "Teacher StudentsPanel Simple",
    tag: "lesson",
    imageName: "screen-lesson-teacher-panel-simple-md.png",
    description: "Teacher Lesson の md+ 画面で StudentsPanel を simple 表示にした状態です。",
    imageDescription: "生徒ごとの simple card と today score 操作が表示されます。",
    items: [
      { id: "student-card", label: "Simple Card", purpose: "生徒ごとの概要情報を確認するためのカードです。" },
      { id: "today-score", label: "Today Score 操作", purpose: "today score の表示と加減点を行うための操作です。" },
    ],
  },
  {
    slug: "teacher-panel-full-md",
    title: "Teacher StudentsPanel Full",
    tag: "lesson",
    imageName: "screen-lesson-teacher-panel-full-md.png",
    description: "Teacher Lesson の md+ 画面で StudentsPanel を full 表示にした状態です。",
    imageDescription: "today / unit / total score を含む詳細カードが表示されます。",
    items: [
      { id: "student-card", label: "Full Card", purpose: "生徒ごとの詳細情報を確認するためのカードです。" },
      { id: "today-score", label: "Today Score", purpose: "today score の表示と加減点を行うための操作です。" },
      { id: "unit-total-score", label: "Unit / Total Score", purpose: "unit score と total score を確認するための表示です。" },
    ],
  },
  {
    slug: "teacher-panel-progress-md",
    title: "Teacher StudentsPanel Progress",
    tag: "lesson",
    imageName: "screen-lesson-teacher-panel-progress-md.png",
    description: "Teacher Lesson の md+ 画面で StudentsPanel を progress 表示にした状態です。",
    imageDescription: "生徒ごとの progress card が表示されます。",
    items: [
      { id: "student-card", label: "Progress Card", purpose: "生徒ごとの progress / homework 情報を確認するためのカードです。" },
    ],
  },
  {
    slug: "teacher-content-vocabulary-particle",
    title: "Vocabulary Particle Content",
    tag: "lesson",
    imageName: "screen-lesson-teacher-vocabulary-particle.png",
    description: "Lesson content を Vocabulary Particle に切り替えた状態です。",
    imageDescription: "slide mode と match mode を切り替えられる Vocabulary Particle コンテンツです。",
    items: [
      { id: "slide-mode", label: "Slide Mode", purpose: "Vocabulary Particle を slide 表示で学習するための操作です。" },
      { id: "match-mode", label: "Match Mode", purpose: "Vocabulary Particle を match 表示へ切り替えるための操作です。" },
    ],
  },
  {
    slug: "teacher-content-games",
    title: "Games Content",
    tag: "lesson",
    imageName: "screen-lesson-teacher-games.png",
    description: "Lesson content を Games に切り替えた状態です。",
    imageDescription: "ゲームセンターから個別ゲームへ進むためのコンテンツ一覧です。",
    items: [{ id: "games-root", label: "Game Center", purpose: "利用可能なゲームを選択して切り替えるためのコンテンツ本体です。" }],
  },
  {
    slug: "teacher-content-student-card-detail",
    title: "Student Card Detail",
    tag: "lesson",
    imageName: "screen-lesson-teacher-student-card-detail.png",
    description: "Student Card で裏面単体表示に入った状態です。",
    imageDescription: "BACK ボタンが表示され、単体表示から元の画面へ戻れます。",
    items: [
      { id: "back-button", label: "BACK ボタン", purpose: "単体表示から元の Student Card 配置へ戻るための操作です。" },
      { id: "detail-root", label: "単体表示コンテンツ", purpose: "選択した Student Card 詳細を拡大表示した状態です。" },
    ],
  },
];

const toKebabCase = (value) =>
  value
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");

const markdownEscape = (value) => value.replaceAll("\n", " ");

const mergeTextParts = (...parts) =>
  parts
    .flat()
    .filter((value) => typeof value === "string" && value.trim().length > 0)
    .map((value) => value.trim());

const imageMarkdownPath = (imageName) =>
  `../../assets/images/common/${imageName}`;

const itemImageName = (pageSpec, item) =>
  `item-${pageSpec.tag}-${pageSpec.slug}-${toKebabCase(item.id)}.png`;

const getPageSpec = (slug) => {
  const pageSpec = pageSpecs.find((spec) => spec.slug === slug);
  if (!pageSpec) {
    throw new Error(`Unknown page spec: ${slug}`);
  }
  return pageSpec;
};

const ensureOutputDirs = async () => {
  await mkdir(imagesRoot, { recursive: true });
  await mkdir(path.join(docsRoot, "ja", "manual"), { recursive: true });
  await mkdir(path.join(docsRoot, "en", "manual"), { recursive: true });
  await mkdir(artifactsRoot, { recursive: true });
};

const cleanOutputDirs = async () => {
  await rm(imagesRoot, { recursive: true, force: true });
  await rm(path.join(docsRoot, "ja", "manual"), { recursive: true, force: true });
  await rm(path.join(docsRoot, "en", "manual"), { recursive: true, force: true });
};

const loadVersion = async () => {
  const raw = await readFile(upstreamLessonPackageJson, "utf8");
  return JSON.parse(raw).version ?? "0.0.0";
};

const loadContextFile = async (contextPath) => {
  try {
    return JSON.parse(await readFile(contextPath, "utf8"));
  } catch (error) {
    if (error && typeof error === "object" && "code" in error && error.code === "ENOENT") {
      return null;
    }
    throw error;
  }
};

const mergePageContext = (baseContext, overrideContext) => {
  if (!baseContext) {
    return overrideContext;
  }
  if (!overrideContext) {
    return baseContext;
  }

  return {
    ...baseContext,
    ...overrideContext,
    item_overrides: {
      ...(baseContext.item_overrides ?? {}),
      ...(overrideContext.item_overrides ?? {}),
    },
  };
};

const loadPageContext = async (pageSpec, lang) => {
  const jaContext = await loadContextFile(
    path.join(contextBaseRoot, "ja", `${pageSpec.slug}.json`),
  );

  if (lang === "ja") {
    return jaContext;
  }

  const localizedOverride = await loadContextFile(
    path.join(contextBaseRoot, lang, `${pageSpec.slug}.json`),
  );
  return mergePageContext(jaContext, localizedOverride);
};

const localeConfig = {
  ja: {
    frontMatterLang: "ja",
    titlePrefix: "",
    section1: "1. 画面画像",
    section2: "2. 画像の説明",
    section3: "3. 画像内各項目の一覧",
    section41: "4-1. 項目の画像",
    section42: "4-2. 項目の説明",
    relatedPagesHeading: "関連する遷移先ページ",
    audienceHeading: "想定読者",
    purposeHeading: "画面の目的",
    backgroundHeading: "背景",
    prerequisitesHeading: "この画面に到達する前提",
    afterActionsHeading: "この画面のあとに続く流れ",
    purposeLabel: "目的",
    statesLabel: "状態の意味",
    operationLabel: "操作方法とその作用",
    conditionsLabel: "操作可能な条件",
    notesLabel: "補足",
    rootTitle: "ECO Online Manual",
    rootHeading: "ECO Online Manual",
    rootLinks: [
      { label: "日本語マニュアル", path: "./ja/index.md" },
      { label: "English Manual", path: "./en/index.md" },
    ],
    localeIndexTitle: "日本語マニュアル",
    localeIndexHeading: "日本語マニュアル",
    localeIndexLinkLabel: "マニュアル一覧",
    manualIndexTitle: "Manual Index",
    manualIndexHeading: "マニュアル一覧",
  },
  en: {
    frontMatterLang: "en",
    titlePrefix: "",
    section1: "1. Screen Image",
    section2: "2. Screen Description",
    section3: "3. Item List",
    section41: "4-1. Item Images",
    section42: "4-2. Item Details",
    relatedPagesHeading: "Related Destination Pages",
    audienceHeading: "Audience",
    purposeHeading: "Purpose",
    backgroundHeading: "Background",
    prerequisitesHeading: "Prerequisites",
    afterActionsHeading: "What Happens Next",
    purposeLabel: "Purpose",
    statesLabel: "Meaning of States",
    operationLabel: "How to Operate and What Happens",
    conditionsLabel: "Conditions for Operation",
    notesLabel: "Notes",
    rootTitle: "ECO Online Manual",
    rootHeading: "ECO Online Manual",
    rootLinks: [
      { label: "Japanese Manual", path: "./ja/index.md" },
      { label: "English Manual", path: "./en/index.md" },
    ],
    localeIndexTitle: "English Manual",
    localeIndexHeading: "English Manual",
    localeIndexLinkLabel: "Manual Index",
    manualIndexTitle: "Manual Index",
    manualIndexHeading: "Manual Index",
  },
};

const enPageContent = {
  "setup-device": {
    description:
      "This screen is used to choose the device mode before login or when reconfiguring the device.",
    imageDescription:
      "It shows the software version, reset action, device mode choices, and the login entry button.",
    nextPages: [{ slug: "login", label: "Login" }],
    items: {
      "software-version": {
        label: "Software Version",
        purpose: "This display shows the current app version.",
        states: ["The displayed value is the version currently installed on the device."],
      },
      "reset-button": {
        label: "Reset Button",
        purpose: "This action resets stored device state.",
        operation:
          "Selecting it clears stored data and returns the device to a state that is easier to configure again.",
      },
      "device-mode": {
        label: "Device Mode Selector",
        purpose: "This control chooses whether the device is used for Home, Teacher, or Shared mode.",
        states: [
          "Home is for home use.",
          "Teacher is for the lesson host device.",
          "Shared is for a shared device.",
        ],
      },
      "login-button": {
        label: "Login Button",
        purpose: "This is the main action for continuing with the current device mode.",
        operation:
          "Selecting it moves to the login screen or to the route for the selected mode, depending on the current authentication state.",
      },
    },
  },
  login: {
    description:
      "This screen is used to authenticate with an email address and password. After login, the route depends on the device mode and role.",
    imageDescription:
      "It shows the email field, password field, and the login button.",
    nextPages: [
      { slug: "home-switch-student", label: "Home Route First Screen" },
      { slug: "teacher-select-class", label: "Teacher Class Selection" },
      { slug: "shared-select-class", label: "Shared Class Selection" },
    ],
    items: {
      "email-field": {
        label: "Email Field",
        purpose: "This field is used to enter the email address for login.",
        operation: "Enter the account email address.",
      },
      "password-field": {
        label: "Password Field",
        purpose: "This field is used to enter the password for login.",
        operation: "Enter the account password.",
      },
      "login-button": {
        label: "Login Button",
        purpose: "This is the main action for signing in with the entered credentials.",
        operation:
          "Selecting it starts authentication and moves to the destination route if login succeeds.",
        conditions: "Valid credentials must be entered.",
      },
    },
  },
  "home-switch-student": {
    description:
      "This is the first screen after logging in through the Home route, where the student and class are confirmed before starting.",
    imageDescription:
      "It shows the target student, school and class information, and the start button.",
    nextPages: [{ slug: "home-startup", label: "Home Startup" }],
    items: {
      "student-name": {
        label: "Student Display",
        purpose: "This display shows which student is currently selected for this device.",
      },
      "class-info": {
        label: "Class Information",
        purpose: "This display shows the school name, class name, and level color linked to the selected student.",
      },
      "start-button": {
        label: "Start Button",
        purpose: "This is the main action for starting the Home route with the selected student and class.",
        operation: "Selecting it opens the Home startup screen.",
      },
    },
  },
  "home-startup": {
    description:
      "This is the startup screen for home devices. Homework, progress checking, and lesson entry all start from here.",
    imageDescription:
      "It shows lesson information, menu controls, and the list of learning content.",
    nextPages: [{ slug: "home-mypage", label: "My Page" }],
    items: {
      "lesson-header": {
        label: "Lesson Header",
        purpose: "This display shows the current lesson and class information.",
      },
      "menu-button": {
        label: "Menu Button",
        purpose: "This button opens the main menu for actions such as checking progress or joining a lesson.",
        operation: "Selecting it opens the startup menu.",
      },
      "content-list": {
        label: "Content List",
        purpose: "This display shows the learning materials and content available from this screen.",
      },
    },
  },
  "home-mypage": {
    description:
      "This page is used to check the student's progress, points, and learning status.",
    imageDescription:
      "It shows the student name, coins, points, next lesson information, and progress UI.",
    nextPages: [{ slug: "home-avatar", label: "Avatar" }],
    items: {
      "profile-header": {
        label: "Profile Header",
        purpose: "This display shows the selected student's basic information, such as name and coin balance.",
      },
      "next-class": {
        label: "Next Lesson Information",
        purpose: "This display shows the schedule and time of the next lesson.",
      },
      "progress-panel": {
        label: "Progress Panel",
        purpose: "This display is used to review progress by unit and related actions.",
      },
    },
  },
  "home-avatar": {
    description:
      "This page is used to review and change the student's avatar and background color.",
    imageDescription:
      "It shows the coin balance, selected avatar, background color, filters, and the avatar list.",
    items: {
      "avatar-header": {
        label: "Avatar Header",
        purpose: "This display shows the selected student's name and coin balance.",
      },
      "preview-panel": {
        label: "Preview Panel",
        purpose: "This display shows the currently selected avatar and background color.",
      },
      "filter-panel": {
        label: "Filter Controls",
        purpose: "These controls filter the avatar list by ownership state or category.",
        operation: "Changing a condition updates the avatar candidates shown on the screen.",
      },
    },
  },
  "teacher-select-class": {
    description:
      "This is the first screen for the Teacher route, where the class is selected before lesson startup.",
    imageDescription:
      "It shows the teacher name, school and class information, pager controls, and the select button.",
    nextPages: [{ slug: "teacher-startup", label: "Teacher Startup" }],
    items: {
      "teacher-name": {
        label: "Teacher Name",
        purpose: "This display identifies the signed-in teacher context.",
      },
      "class-card": {
        label: "Class Card",
        purpose: "This display shows the currently selected school and class information.",
      },
      "select-button": {
        label: "Select Button",
        purpose: "This is the main action for confirming the current class and moving to the teacher startup screen.",
        operation: "Selecting it opens the Teacher startup screen for the chosen class.",
      },
    },
  },
  "teacher-startup": {
    description:
      "This is the startup screen for the Teacher route. Lesson preparation and class operation start here.",
    imageDescription:
      "It shows lesson information, menu controls, and the student list for the class.",
    items: {
      "lesson-header": {
        label: "Lesson Header",
        purpose: "This display shows the current lesson and class information.",
      },
      "menu-button": {
        label: "Menu Button",
        purpose: "This button opens the menu for teacher-side actions.",
        operation: "Selecting it opens the startup menu.",
      },
      "student-list": {
        label: "Student List",
        purpose: "This display shows the students linked to the selected class.",
      },
    },
  },
  "shared-select-class": {
    description:
      "This is the first class selection screen for the Shared route.",
    imageDescription:
      "It shows the teacher name, school and class information, pager controls, and the select button.",
    nextPages: [{ slug: "shared-select-student", label: "Shared Student Selection" }],
    items: {
      "teacher-name": {
        label: "Teacher Name",
        purpose: "This display identifies the signed-in teacher context used for the shared route.",
      },
      "class-card": {
        label: "Class Card",
        purpose: "This display shows the currently selected school and class information.",
      },
      "select-button": {
        label: "Select Button",
        purpose: "This is the main action for confirming the class and moving to student selection.",
        operation: "Selecting it opens the student selection screen for the chosen class.",
      },
    },
  },
  "shared-select-student": {
    description:
      "This screen is used to choose the student who will use the shared device.",
    imageDescription:
      "It shows the selected class information, the student selector, and the select button.",
    nextPages: [{ slug: "shared-startup", label: "Shared Startup" }],
    items: {
      "class-info": {
        label: "Class Information",
        purpose: "This display shows the school and class currently selected for the shared route.",
      },
      "student-selector": {
        label: "Student Selector",
        purpose: "This control chooses which student will use the shared device.",
        operation: "Choose the target student from the available list.",
      },
      "select-button": {
        label: "Select Button",
        purpose: "This is the main action for confirming the student and moving to the shared startup screen.",
        operation: "Selecting it opens the Shared startup screen for the chosen student.",
      },
    },
  },
  "shared-startup": {
    description:
      "This is the startup screen for the Shared route.",
    imageDescription:
      "It shows lesson information, menu controls, and the list of learning content.",
    items: {
      "lesson-header": {
        label: "Lesson Header",
        purpose: "This display shows the current lesson and class information.",
      },
      "menu-button": {
        label: "Menu Button",
        purpose: "This button opens the shared-route menu.",
        operation: "Selecting it opens the startup menu.",
      },
      "content-list": {
        label: "Content List",
        purpose: "This display shows the learning materials and content available from this screen.",
      },
    },
  },
};

const getLocalizedPageSpec = (pageSpec, lang) => {
  if (lang !== "en") {
    return pageSpec;
  }

  const override = enPageContent[pageSpec.slug];
  if (!override) {
    return pageSpec;
  }

  return {
    ...pageSpec,
    title: override.title ?? pageSpec.title,
    description: override.description ?? pageSpec.description,
    imageDescription: override.imageDescription ?? pageSpec.imageDescription,
    nextPages: override.nextPages ?? pageSpec.nextPages,
    items: pageSpec.items.map((item) => ({
      ...item,
      ...(override.items?.[item.id] ?? {}),
    })),
  };
};

const renderMarkdown = ({ pageSpec, version, pageContext, lang }) => {
  const locale = localeConfig[lang];
  const localizedPageSpec = getLocalizedPageSpec(pageSpec, lang);
  const shouldUseContextText = lang === "ja";
  const summaryLines = [
    localizedPageSpec.description,
    localizedPageSpec.imageDescription,
    ...(shouldUseContextText
      ? mergeTextParts(pageContext?.screen_description_overrides)
      : []),
  ];

  const itemIndexLines = localizedPageSpec.items
    .map((item) => `- [${item.label}](#item-${item.id})`)
    .join("\n");
  const nextPageLines = (localizedPageSpec.nextPages ?? [])
    .map((pageLink) => `- [${pageLink.label}](./${pageLink.slug}.md)`)
    .join("\n");

  const itemSections = localizedPageSpec.items
    .map((item) => {
      const override = shouldUseContextText
        ? (pageContext?.item_overrides?.[item.id] ?? {})
        : {};
      const purposeText = mergeTextParts(item.purpose, override.purpose_extra).join(
        " ",
      );
      const stateText = mergeTextParts(item.states, override.state_meaning_extra).join(
        " / ",
      );
      const operationText = mergeTextParts(
        item.operation,
        override.operation_extra,
      ).join(" ");
      const conditionsText = mergeTextParts(
        item.conditions,
        override.conditions_extra,
      ).join(" ");

      const lines = [
        `<a id="item-${item.id}"></a>`,
        `### ${item.label}`,
        "",
        `![${item.label}](${imageMarkdownPath(itemImageName(localizedPageSpec, item))})`,
        "",
        `- ${locale.purposeLabel}: ${markdownEscape(purposeText)}`,
      ];

      if (stateText) {
        lines.push(`- ${locale.statesLabel}: ${stateText.split(" / ").map(markdownEscape).join(" / ")}`);
      }
      if (operationText) {
        lines.push(`- ${locale.operationLabel}: ${markdownEscape(operationText)}`);
      }
      if (conditionsText) {
        lines.push(`- ${locale.conditionsLabel}: ${markdownEscape(conditionsText)}`);
      }
      if (Array.isArray(override.notes) && override.notes.length > 0) {
        lines.push(`- ${locale.notesLabel}: ${override.notes.map(markdownEscape).join(" / ")}`);
      }
      return lines.join("\n");
    })
    .join("\n\n");

  return `---
title: ${localizedPageSpec.title}
lang: ${locale.frontMatterLang}
tag: ${localizedPageSpec.tag}
version: ${version}
---

# ${localizedPageSpec.title}

## ${locale.section1}

![${localizedPageSpec.title}](${imageMarkdownPath(localizedPageSpec.imageName)})

## ${locale.section2}

${summaryLines.map(markdownEscape).join("\n\n")}

${nextPageLines ? `### ${locale.relatedPagesHeading}\n\n${nextPageLines}` : ""}

## ${locale.section3}

${itemIndexLines}

## ${locale.section41}

## ${locale.section42}

${itemSections}
`;
};

const renderManualIndex = ({ version, lang }) => {
  const locale = localeConfig[lang];
  const pageLinks = pageSpecs
    .map((pageSpec) => getLocalizedPageSpec(pageSpec, lang))
    .map((pageSpec) => `- [${pageSpec.title}](./${pageSpec.slug}.md)`)
    .join("\n");
  return `---
title: ${locale.manualIndexTitle}
lang: ${locale.frontMatterLang}
tag: index
version: ${version}
---

# ${locale.manualIndexHeading}

${pageLinks}
`;
};

const renderRootIndex = () => {
  const locale = localeConfig.ja;
  return `---
title: ${locale.rootTitle}
lang: ja
tag: index
version: manual
---

# ${locale.rootHeading}

${locale.rootLinks.map((link) => `- [${link.label}](${link.path})`).join("\n")}
`;
};

const renderLocaleIndex = ({ version, lang }) => {
  const locale = localeConfig[lang];
  return `---
title: ${locale.localeIndexTitle}
lang: ${locale.frontMatterLang}
tag: index
version: ${version}
---

# ${locale.localeIndexHeading}

- [${locale.localeIndexLinkLabel}](./manual/index.md)
`;
};

const renderConfig = () => `title: ECO Online Manual
markdown: kramdown
theme: minima
`;

const waitForPageReady = async (page) => {
  await page.waitForLoadState("domcontentloaded");
  await page.waitForLoadState("networkidle", { timeout: 60000 }).catch(() => {});
  await page.waitForTimeout(1500);
};

const waitForNoLoadingText = async (page) => {
  await page.waitForFunction(() => {
    const text = document.body.innerText.replace(/\s+/g, " ").trim();
    return !/Loading/i.test(text);
  });
};

const waitForStudentCardRendered = async (page) => {
  await page.getByTestId("student-card-content-root").waitFor();
  await page.waitForFunction(() => {
    const root = document.querySelector('[data-testid="student-card-content-root"]');
    if (!root) {
      return false;
    }

    const images = root.querySelectorAll('img[alt="front"], img[alt="back"]');
    return images.length >= 2;
  });
};

const waitForCaptureReady = async (page, slug) => {
  const body = page.locator("body");

  const readyMap = {
    "setup-device": async () => {
      await page.waitForURL(/\/setup-device$/);
      await page.getByRole("button", { name: /^Login$/i }).waitFor();
    },
    login: async () => {
      await page.waitForURL(/\/login$/);
      await page.getByRole("button", { name: /^Login$/i }).waitFor();
    },
    "home-switch-student": async () => {
      await page.waitForURL(/\/switch-student$/);
      await page.getByRole("button", { name: /^Start$/i }).waitFor();
      await page.waitForFunction(() => /ACE STUDENT/i.test(document.body.innerText));
    },
    "home-startup": async () => {
      await page.waitForURL(/\/home\/lesson$/);
      await page.getByTestId("lesson-header-menu-button").waitFor();
      await waitForStudentCardRendered(page);
      await waitForNoLoadingText(page);
    },
    "home-mypage": async () => {
      await page.waitForURL(/\/mypage$/);
      await page.waitForFunction(() => /Ace Student/i.test(document.body.innerText));
      await waitForNoLoadingText(page);
    },
    "home-avatar": async () => {
      await page.waitForURL(/\/avatar$/);
      await page.waitForFunction(() => /Avatar Name/i.test(document.body.innerText));
      await waitForNoLoadingText(page);
    },
    "teacher-select-class": async () => {
      await page.waitForURL(/\/select-class$/);
      await page.waitForFunction(() => {
        const text = document.body.innerText.replace(/\s+/g, " ").trim();
        return /Select Class/i.test(text) && /ACE DEMO SCHOOL/i.test(text) && !/Loading/i.test(text);
      });
      const selectButton = page.getByRole("button", { name: /^Select$/i });
      await selectButton.waitFor();
      await page.waitForFunction(() => {
        const button = Array.from(document.querySelectorAll("button")).find(
          (node) => /select/i.test(node.textContent ?? ""),
        );
        return !!button && !button.hasAttribute("disabled");
      });
    },
    "teacher-startup": async () => {
      await page.waitForURL(/\/teacher\/lesson$/);
      await page.getByTestId("lesson-header-menu-button").waitFor();
      await waitForStudentCardRendered(page);
      await waitForNoLoadingText(page);
    },
    "shared-select-class": async () => {
      await page.waitForURL(/\/select-class$/);
      await page.waitForFunction(() => {
        const text = document.body.innerText.replace(/\s+/g, " ").trim();
        return /Select Class/i.test(text) && /ACE DEMO SCHOOL/i.test(text) && !/Loading/i.test(text);
      });
      const selectButton = page.getByRole("button", { name: /^Select$/i });
      await selectButton.waitFor();
      await page.waitForFunction(() => {
        const button = Array.from(document.querySelectorAll("button")).find(
          (node) => /select/i.test(node.textContent ?? ""),
        );
        return !!button && !button.hasAttribute("disabled");
      });
    },
    "shared-select-student": async () => {
      await page.waitForURL(/\/select-student$/);
      await page.waitForFunction(() => {
        const text = document.body.innerText.replace(/\s+/g, " ").trim();
        return /Select Student/i.test(text) && /ACE STUDENT/i.test(text) && !/Loading/i.test(text);
      });
      await page.getByRole("button", { name: /^Select$/i }).waitFor();
    },
    "shared-startup": async () => {
      await page.waitForURL(/\/shared\/lesson$/);
      await page.getByTestId("lesson-header-menu-button").waitFor();
      await waitForStudentCardRendered(page);
      await waitForNoLoadingText(page);
    },
    "teacher-lesson": async () => {
      await page.waitForFunction(() =>
        /\/teacher\/lesson\/[^/]+\/session(?:\/content\/[^/]+)?/.test(
          window.location.pathname,
        ),
      );
      await page.getByTestId("lesson-header").waitFor();
      await waitForStudentCardRendered(page);
      await waitForNoLoadingText(page);
    },
    "home-lesson": async () => {
      await page.waitForFunction(() =>
        /\/home\/lesson\/[^/]+\/session(?:\/content\/[^/]+)?/.test(
          window.location.pathname,
        ),
      );
      await page.getByTestId("lesson-header").waitFor();
      await waitForStudentCardRendered(page);
      await waitForNoLoadingText(page);
    },
    "teacher-panel-none-md": async () => {
      await page.getByTestId("lesson-header").waitFor();
      await page.getByTestId("student-card-content-root").waitFor();
    },
    "teacher-panel-icon-md": async () => {
      await page.getByTestId("lesson-shell-students").waitFor();
      await page.getByTestId("student-badge-student-ace-001-avatar-button").waitFor();
    },
    "teacher-panel-icon-xs": async () => {
      await page.getByTestId("lesson-shell-students").waitFor();
      await page.getByTestId("student-badge-student-ace-001-avatar-button").waitFor();
    },
    "teacher-panel-simple-md": async () => {
      await page.getByTestId("student-student-ace-001-card").waitFor();
    },
    "teacher-panel-full-md": async () => {
      await page.getByTestId("student-student-ace-001-total-score-input").waitFor();
    },
    "teacher-panel-progress-md": async () => {
      await page.getByTestId("student-student-ace-001-card").waitFor();
      await page.waitForFunction(() => /Progress|Homework/i.test(document.body.innerText));
    },
    "teacher-content-vocabulary-particle": async () => {
      await page.waitForFunction(() =>
        /\/teacher\/lesson\/[^/]+\/session\/content\/vocabulary-particle(?:\?.*)?$/.test(
          window.location.pathname + window.location.search,
        ),
      );
      await page.waitForFunction(() => {
        const text = document.body.innerText.replace(/\s+/g, " ").trim();
        return /Vocabulary Particle/i.test(text) && /Slide/i.test(text) && /Match/i.test(text);
      });
    },
    "teacher-content-games": async () => {
      await page.waitForFunction(() =>
        /\/teacher\/lesson\/[^/]+\/session\/content\/games(?:\?.*)?$/.test(
          window.location.pathname + window.location.search,
        ),
      );
      await page.waitForFunction(() => {
        const text = document.body.innerText.replace(/\s+/g, " ").trim();
        return /Games/i.test(text) && /HANGMAN|LETTER DROP|SNAKE/i.test(text);
      });
    },
    "teacher-content-student-card-detail": async () => {
      await page.getByRole("button", { name: /^BACK$/i }).waitFor();
      await waitForNoLoadingText(page);
    },
  };

  if (readyMap[slug]) {
    await readyMap[slug]();
    return;
  }

  await body.waitFor();
  await waitForNoLoadingText(page);
};

const capturePage = async ({ page, pageSpec, report }) => {
  await waitForCaptureReady(page, pageSpec.slug);
  await page.screenshot({
    path: path.join(imagesRoot, pageSpec.imageName),
    fullPage: true,
  });

  for (const item of pageSpec.items) {
    const itemPath = path.join(imagesRoot, itemImageName(pageSpec, item));
    try {
      const locator = await getItemLocator(page, pageSpec.slug, item.id);
      if (!locator) {
        throw new Error(`No locator configured for ${pageSpec.slug}:${item.id}`);
      }
      await locator.screenshot({ path: itemPath });
      report.capturedItems.push(`${pageSpec.slug}:${item.id}`);
    } catch (error) {
      await copyFile(path.join(imagesRoot, pageSpec.imageName), itemPath);
      report.failedItems.push({
        page: pageSpec.slug,
        item: item.id,
        reason: String(error),
      });
    }
  }
};

const runStep = async (report, stepName, action) => {
  try {
    await action();
  } catch (error) {
    report.flowFailures ??= [];
    report.flowFailures.push({
      step: stepName,
      reason: String(error),
    });
  }
};

const getItemLocator = async (page, slug, itemId) => {
  const byTextBlock = (pattern) => page.getByText(pattern).first();
  const byRole = (role, name) => page.getByRole(role, { name }).first();

  const map = {
    "setup-device": {
      "software-version": byTextBlock(/Software version:/i),
      "reset-button": byRole("button", /^Reset$/i),
      "device-mode": byTextBlock(/Select device mode:/i),
      "login-button": byRole("button", /^Login$/i),
    },
    login: {
      "email-field": page.getByLabel(/Email/i).first(),
      "password-field": page.getByLabel(/Password/i).first(),
      "login-button": byRole("button", /^Login$/i),
    },
    "home-switch-student": {
      "student-name": byTextBlock(/ACE STUDENT/i),
      "class-info": byTextBlock(/ACE DEMO SCHOOL/i),
      "start-button": byRole("button", /^Start$/i),
    },
    "home-startup": {
      "school-name": page.getByTestId("lesson-header-school-name").first(),
      "class-name": page.getByTestId("lesson-header-class-name").first(),
      "level-color": page.getByTestId("lesson-header-level-color").first(),
      "unit-button": page.getByTestId("lesson-header-unit").first(),
      "student-status": page.getByTestId("lesson-header-homework-student-status").first(),
      "menu-button": page.getByTestId("lesson-header-menu-button").first(),
      "student-card": page.getByTestId("student-card-content-root").first(),
    },
    "home-mypage": {
      "profile-header": byTextBlock(/Ace Student/i),
      "next-class": byTextBlock(/Next Class/i),
      "progress-panel": page.getByRole("table").first(),
    },
    "home-avatar": {
      "avatar-header": byTextBlock(/Coins/i),
      "preview-panel": byTextBlock(/Avatar Name/i),
      "filter-panel": byTextBlock(/Ownership/i),
    },
    "teacher-select-class": {
      "teacher-name": byTextBlock(/先生/i),
      "class-card": byTextBlock(/ACE DEMO SCHOOL/i),
      "select-button": byRole("button", /^Select$/i),
    },
    "teacher-startup": {
      "school-name": page.getByTestId("lesson-header-school-name").first(),
      "class-name": page.getByTestId("lesson-header-class-name").first(),
      "level-color": page.getByTestId("lesson-header-level-color").first(),
      "unit-button": page.getByTestId("lesson-header-unit").first(),
      "students-toggle": page.getByTestId("lesson-header-students-toggle").first(),
      "students-level": page.getByLabel("CHANGE STUDENTS LEVEL").first(),
      "menu-button": page.getByTestId("lesson-header-menu-button").first(),
      "student-card": page.getByTestId("student-card-content-root").first(),
    },
    "shared-select-class": {
      "teacher-name": byTextBlock(/先生/i),
      "class-card": byTextBlock(/ACE DEMO SCHOOL/i),
      "select-button": byRole("button", /^Select$/i),
    },
    "shared-select-student": {
      "class-info": byTextBlock(/ACE DEMO SCHOOL/i),
      "student-selector": page.locator('[role="combobox"]').first(),
      "select-button": byRole("button", /^Select$/i),
    },
    "shared-startup": {
      "school-name": page.getByTestId("lesson-header-school-name").first(),
      "class-name": page.getByTestId("lesson-header-class-name").first(),
      "level-color": page.getByTestId("lesson-header-level-color").first(),
      "unit-button": page.getByTestId("lesson-header-unit").first(),
      "menu-button": page.getByTestId("lesson-header-menu-button").first(),
      "student-card": page.getByTestId("student-card-content-root").first(),
    },
    "teacher-lesson": {
      "school-name": page.getByTestId("lesson-header-school-name").first(),
      "class-name": page.getByTestId("lesson-header-class-name").first(),
      "level-color": page.getByTestId("lesson-header-level-color").first(),
      "unit-button": page.getByTestId("lesson-header-unit").first(),
      section: page.getByTestId("lesson-header-section-value").first(),
      "menu-button": page.getByTestId("lesson-header-menu-button").first(),
      "students-toggle": page.getByTestId("lesson-header-students-toggle").first(),
      "students-level": page.getByLabel("CHANGE STUDENTS LEVEL").first(),
      "sync-mode": page.getByTestId("lesson-header").getByRole("button", { name: /Play|Study/i }).first(),
      datetime: page.getByTestId("lesson-header-datetime").first(),
      "student-card": page.getByTestId("student-card-content-root").first(),
    },
    "home-lesson": {
      "school-name": page.getByTestId("lesson-header-school-name").first(),
      "class-name": page.getByTestId("lesson-header-class-name").first(),
      "level-color": page.getByTestId("lesson-header-level-color").first(),
      "unit-button": page.getByTestId("lesson-header-unit").first(),
      section: page.getByTestId("lesson-header-section-value").first(),
      "menu-button": page.getByTestId("lesson-header-menu-button").first(),
      "students-toggle": page.getByTestId("lesson-header-students-toggle").first(),
      "students-level": page.getByLabel("CHANGE STUDENTS LEVEL").first(),
      "viewer-status": page.getByTestId("lesson-header").getByRole("button", { name: /Viewer|OPEN MY PAGE/i }).first(),
      datetime: page.getByTestId("lesson-header-datetime").first(),
      "student-card": page.getByTestId("student-card-content-root").first(),
    },
    "teacher-panel-none-md": {
      "student-card": page.getByTestId("student-card-content-root").first(),
    },
    "teacher-panel-icon-md": {
      "avatar-button": page.getByTestId("student-badge-student-ace-001-avatar-button").first(),
      "score-add": page.getByTestId("student-badge-student-ace-001-add-button").first(),
      "score-remove": page.getByTestId("student-badge-student-ace-001-remove-button").first(),
    },
    "teacher-panel-icon-xs": {
      "avatar-button": page.getByTestId("student-badge-student-ace-001-avatar-button").first(),
    },
    "teacher-panel-simple-md": {
      "student-card": page.getByTestId("student-student-ace-001-card").first(),
      "today-score": page.getByTestId("student-student-ace-001-today-score-input").first(),
    },
    "teacher-panel-full-md": {
      "student-card": page.getByTestId("student-student-ace-001-card").first(),
      "today-score": page.getByTestId("student-student-ace-001-today-score-input").first(),
      "unit-total-score": page.getByTestId("student-student-ace-001-total-score-input").first(),
    },
    "teacher-panel-progress-md": {
      "student-card": page.getByTestId("student-student-ace-001-card").first(),
    },
    "teacher-content-vocabulary-particle": {
      "slide-mode": byTextBlock(/^Slide$/i),
      "match-mode": byTextBlock(/^Match$/i),
    },
    "teacher-content-games": {
      "games-root": byTextBlock(/HANGMAN|LETTER DROP|SNAKE/i),
    },
    "teacher-content-student-card-detail": {
      "back-button": page.getByRole("button", { name: /^BACK$/i }).first(),
      "detail-root": page.getByTestId("student-card-content-root").first(),
    },
  };

  return map[slug]?.[itemId] ?? null;
};

const extractLessonId = (url) => url.match(/lesson\/([^/]+)\/session/)?.[1] ?? null;

const openStartupMenuAction = async (page, actionLabel) => {
  await page.getByTestId("lesson-header-menu-button").click();
  const menuAction = page.getByRole("button", { name: actionLabel });
  await menuAction.waitFor();
  await menuAction.click();
};

const confirmLessonEntry = async (page, actionLabel) => {
  const confirmButton = page.getByRole("button", {
    name: new RegExp(`^${actionLabel}$`, "i"),
  });
  await confirmButton.waitFor({ timeout: 30_000 });
  await page.waitForFunction(
    (label) => {
      const button = Array.from(document.querySelectorAll("button")).find(
        (node) => new RegExp(`^${label}$`, "i").test(node.textContent ?? ""),
      );
      return !!button && !button.hasAttribute("disabled");
    },
    actionLabel,
  );
  await confirmButton.click();
};

const findLessonEntryButton = (page, actionLabel) =>
  page.getByRole("button", {
    name: new RegExp(`^${actionLabel}$`, "i"),
  });

const expectSessionReady = async (page, mode) => {
  await page.waitForURL(
    new RegExp(`/${mode}/lesson/[^/]+/session(?:/content/[^/]+)?(?:\\?.*)?$`),
    { timeout: 30_000 },
  );
  await page.getByTestId("lesson-header").waitFor({ timeout: 20_000 });
  await page.getByTestId("student-card-content-root").waitFor({
    timeout: 20_000,
  });
  await waitForNoLoadingText(page);
};

const waitUntilHomeJoinReady = async (page) => {
  for (let attempt = 0; attempt < 4; attempt += 1) {
    await openStartupMenuAction(page, "Enter Lesson");
    const joinButton = findLessonEntryButton(page, "Join");
    await joinButton.waitFor({ timeout: 30_000 });

    if (await joinButton.isEnabled()) {
      return;
    }

    await page.getByRole("button", { name: "Close Enter Lesson" }).click();
    await page.reload({ waitUntil: "domcontentloaded" });
    await page.waitForURL(/\/home\/lesson$/, { timeout: 20_000 });
    await waitForPageReady(page);
  }

  await findLessonEntryButton(page, "Join").waitFor({ timeout: 30_000 });
};

const enterHomeLessonSession = async (page) => {
  await waitUntilHomeJoinReady(page);
  await confirmLessonEntry(page, "Join");
  await expectSessionReady(page, "home");
};

const ensureTeacherSession = async (page) => {
  for (let attempt = 0; attempt < 10; attempt += 1) {
    if (
      /\/teacher\/lesson\/[^/]+\/session(?:\/content\/[^/]+)?(?:\?.*)?$/.test(
        page.url(),
      )
    ) {
      break;
    }

    const startButton = findLessonEntryButton(page, "Start");
    if (
      (await startButton.isVisible().catch(() => false)) &&
      (await startButton.isEnabled().catch(() => false))
    ) {
      await confirmLessonEntry(page, "Start");
    } else {
      if (/\/teacher\/lesson$/.test(page.url())) {
        await page.getByTestId("lesson-header-menu-button").click();
        const joinAction = page.getByRole("button", { name: "Join Lesson" });
        if (await joinAction.isVisible().catch(() => false)) {
          await joinAction.click();
        } else {
          await page.getByRole("button", { name: "Start Lesson" }).click();
        }
      }
      const joinButton = findLessonEntryButton(page, "Join");
      if (
        (await joinButton.isVisible().catch(() => false)) &&
        (await joinButton.isEnabled().catch(() => false))
      ) {
        await confirmLessonEntry(page, "Join");
      }
    }

    if (
      /\/teacher\/lesson\/[^/]+\/session(?:\/content\/[^/]+)?(?:\?.*)?$/.test(
        page.url(),
      )
    ) {
      break;
    }

    await page.waitForTimeout(2_000);
  }

  await expectSessionReady(page, "teacher");
};

const ensureHomeSessionByLessonId = async (page, lessonId) => {
  await page.goto(`${baseUrl}/home/lesson/${lessonId}/session?mode=appsync`, {
    waitUntil: "domcontentloaded",
  });
  await waitForPageReady(page);
  await waitForCaptureReady(page, "home-lesson");
};

const setTeacherStudentsPanelState = async (page, { open, level }) => {
  const toggleButton = page.getByLabel("TOGGLE STUDENTS");
  const levelButton = page.getByLabel("CHANGE STUDENTS LEVEL");
  const levelOrder = ["icon", "simple", "full", "progress"];

  const isOpen = await page.evaluate(() => {
    const panel = document.querySelector('[data-testid="lesson-shell-students"]');
    return !!panel && getComputedStyle(panel).transform !== "matrix(1, 0, 0, 1, 0, -1130)";
  }).catch(() => true);

  if (open !== isOpen) {
    await toggleButton.click();
    await page.waitForTimeout(500);
  }

  if (!open || !level) {
    return;
  }

  for (let attempt = 0; attempt < 4; attempt += 1) {
    const matched = await page.evaluate((targetLevel) => {
      const cards = Array.from(document.querySelectorAll("[data-testid]")).map(
        (node) => node.getAttribute("data-testid") ?? "",
      );
      if (targetLevel === "icon") {
        return cards.some((value) => value.includes("student-badge-"));
      }
      if (targetLevel === "simple") {
        return cards.some((value) => value.includes("today-score-input")) &&
          !cards.some((value) => value.includes("total-score-input"));
      }
      if (targetLevel === "full") {
        return cards.some((value) => value.includes("total-score-input"));
      }
      if (targetLevel === "progress") {
        return cards.some((value) => value.includes("student-student-")) &&
          !cards.some((value) => value.includes("today-score-input"));
      }
      return false;
    }, level);

    if (matched) {
      return;
    }

    await levelButton.click();
    await page.waitForTimeout(700);
  }

  throw new Error(`Failed to switch StudentsPanel to ${level}`);
};

const openStudentCardDetail = async (page) => {
  const backImage = page.locator('img[alt="back"]').first();
  await backImage.waitFor();
  const box = await backImage.boundingBox();
  if (!box) {
    throw new Error("Student card back image bounding box not found");
  }
  await page.mouse.click(box.x + box.width / 2, box.y + box.height / 2);
  await page.getByRole("button", { name: /^BACK$/i }).waitFor();
};

const loginAs = async (page, email, gotoPath) => {
  await page.goto(`${baseUrl}${gotoPath}`, { waitUntil: "domcontentloaded" });
  await waitForPageReady(page);
  if (/\/login\b/.test(page.url())) {
    await page.locator('input[type="email"]').fill(email);
    await page.locator('input[type="password"]').fill(password);
    await page.locator('button[type="submit"]').click();
    const postLoginUrlMap = {
      "/teacher": /\/select-class$|\/teacher\/lesson$/,
      "/home": /\/switch-student$|\/home\/lesson$/,
      "/shared": /\/select-class$|\/select-student$|\/shared\/lesson$/,
    };
    const postLoginUrl = postLoginUrlMap[gotoPath];
    if (postLoginUrl) {
      await page.waitForURL(postLoginUrl, { timeout: 30_000 });
    }
    await waitForPageReady(page);
  }
};

const parentFlow = async (browser, report) => {
  const context = await browser.newContext({ viewport: { width: 1440, height: 1400 } });
  const page = await context.newPage();

  await runStep(report, "parent:login-page", async () => {
    await page.goto(`${baseUrl}/login`, { waitUntil: "domcontentloaded" });
    await waitForPageReady(page);
    await capturePage({
      page,
      pageSpec: getPageSpec("login"),
      report,
    });
  });

  await runStep(report, "parent:login", async () => {
    await page.locator('input[type="email"]').fill(parentEmail);
    await page.locator('input[type="password"]').fill(password);
    await page.locator('button[type="submit"]').click();
    await waitForPageReady(page);
    await capturePage({
      page,
      pageSpec: getPageSpec("home-switch-student"),
      report,
    });
  });

  await runStep(report, "parent:setup-device", async () => {
    await page.goto(`${baseUrl}/setup-device`, { waitUntil: "domcontentloaded" });
    await waitForPageReady(page);
    await capturePage({
      page,
      pageSpec: getPageSpec("setup-device"),
      report,
    });
  });

  await runStep(report, "parent:home-startup", async () => {
    await page.goto(`${baseUrl}/switch-student`, { waitUntil: "domcontentloaded" });
    await waitForPageReady(page);
    await page.getByRole("button", { name: /^Start$/i }).click();
    await waitForPageReady(page);
    await capturePage({
      page,
      pageSpec: getPageSpec("home-startup"),
      report,
    });
  });

  await runStep(report, "parent:mypage", async () => {
    await page.goto(`${baseUrl}/mypage`, { waitUntil: "domcontentloaded" });
    await waitForPageReady(page);
    await capturePage({
      page,
      pageSpec: getPageSpec("home-mypage"),
      report,
    });
  });

  await runStep(report, "parent:avatar", async () => {
    await page.goto(`${baseUrl}/avatar`, { waitUntil: "domcontentloaded" });
    await waitForPageReady(page);
    await capturePage({
      page,
      pageSpec: getPageSpec("home-avatar"),
      report,
    });
  });

  await context.close();
};

const teacherFlow = async (browser, report) => {
  const context = await browser.newContext({ viewport: { width: 1440, height: 1400 } });
  const page = await context.newPage();

  await runStep(report, "teacher:select-class", async () => {
    await loginAs(page, teacherEmail, "/teacher");
    await capturePage({
      page,
      pageSpec: getPageSpec("teacher-select-class"),
      report,
    });
  });

  await runStep(report, "teacher:startup", async () => {
    await page.getByRole("button", { name: /^Select$/i }).click();
    await waitForPageReady(page);
    await capturePage({
      page,
      pageSpec: getPageSpec("teacher-startup"),
      report,
    });
  });

  await context.close();
};

const sharedFlow = async (browser, report) => {
  const context = await browser.newContext({ viewport: { width: 1440, height: 1400 } });
  const page = await context.newPage();

  await runStep(report, "shared:select-class", async () => {
    await loginAs(page, teacherEmail, "/shared");
    await capturePage({
      page,
      pageSpec: getPageSpec("shared-select-class"),
      report,
    });
  });

  await runStep(report, "shared:select-student", async () => {
    await page.getByRole("button", { name: /^Select$/i }).click();
    await waitForPageReady(page);
    await capturePage({
      page,
      pageSpec: getPageSpec("shared-select-student"),
      report,
    });
  });

  await runStep(report, "shared:startup", async () => {
    await page.getByRole("button", { name: /^Select$/i }).click();
    await waitForPageReady(page);
    await capturePage({
      page,
      pageSpec: getPageSpec("shared-startup"),
      report,
    });
  });

  await context.close();
};

const lessonFlow = async (browser, report) => {
  const teacherContext = await browser.newContext({
    viewport: { width: 1440, height: 1400 },
  });
  const homeContext = await browser.newContext({
    viewport: { width: 1440, height: 1400 },
  });
  const teacherPage = await teacherContext.newPage();
  const homePage = await homeContext.newPage();

  let lessonId = null;

  await runStep(report, "lesson:teacher-session", async () => {
    await loginAs(teacherPage, teacherEmail, "/teacher");
    if (/\/select-class$/.test(teacherPage.url())) {
      await waitForCaptureReady(teacherPage, "teacher-select-class");
      await teacherPage.getByRole("button", { name: /^Select$/i }).click();
      await waitForPageReady(teacherPage);
    }
    await ensureTeacherSession(teacherPage);
    lessonId = extractLessonId(teacherPage.url());
    await capturePage({
      page: teacherPage,
      pageSpec: getPageSpec("teacher-lesson"),
      report,
    });
  });

  if (lessonId) {
    await runStep(report, "lesson:home-session", async () => {
      await loginAs(homePage, parentEmail, "/home");
      if (/\/switch-student$/.test(homePage.url())) {
        await homePage.getByRole("button", { name: /^Start$/i }).click();
        await waitForPageReady(homePage);
      }
      await enterHomeLessonSession(homePage);
      await capturePage({
        page: homePage,
        pageSpec: getPageSpec("home-lesson"),
        report,
      });
    });

    await runStep(report, "lesson:teacher-panel-md", async () => {
      await teacherPage.goto(
        `${baseUrl}/teacher/lesson/${lessonId}/session/content/student-card?mode=appsync`,
        { waitUntil: "domcontentloaded" },
      );
      await waitForPageReady(teacherPage);
      await setTeacherStudentsPanelState(teacherPage, { open: false });
      await capturePage({
        page: teacherPage,
        pageSpec: getPageSpec("teacher-panel-none-md"),
        report,
      });

      await setTeacherStudentsPanelState(teacherPage, { open: true, level: "icon" });
      await capturePage({
        page: teacherPage,
        pageSpec: getPageSpec("teacher-panel-icon-md"),
        report,
      });

      await setTeacherStudentsPanelState(teacherPage, { open: true, level: "simple" });
      await capturePage({
        page: teacherPage,
        pageSpec: getPageSpec("teacher-panel-simple-md"),
        report,
      });

      await setTeacherStudentsPanelState(teacherPage, { open: true, level: "full" });
      await capturePage({
        page: teacherPage,
        pageSpec: getPageSpec("teacher-panel-full-md"),
        report,
      });

      await setTeacherStudentsPanelState(teacherPage, { open: true, level: "progress" });
      await capturePage({
        page: teacherPage,
        pageSpec: getPageSpec("teacher-panel-progress-md"),
        report,
      });
    });

    await runStep(report, "lesson:teacher-panel-xs", async () => {
      const xsContext = await browser.newContext({
        viewport: { width: 390, height: 844 },
      });
      const xsPage = await xsContext.newPage();
      try {
        await loginAs(xsPage, teacherEmail, "/teacher");
        await xsPage.goto(
          `${baseUrl}/teacher/lesson/${lessonId}/session/content/student-card?mode=appsync`,
          { waitUntil: "domcontentloaded" },
        );
        await waitForPageReady(xsPage);
        await setTeacherStudentsPanelState(xsPage, { open: true, level: "icon" });
        await capturePage({
          page: xsPage,
          pageSpec: getPageSpec("teacher-panel-icon-xs"),
          report,
        });
      } finally {
        await xsContext.close();
      }
    });

    await runStep(report, "lesson:teacher-vocabulary-particle", async () => {
      await teacherPage.goto(
        `${baseUrl}/teacher/lesson/${lessonId}/session/content/vocabulary-particle?mode=appsync`,
        { waitUntil: "domcontentloaded" },
      );
      await waitForPageReady(teacherPage);
      await capturePage({
        page: teacherPage,
        pageSpec: getPageSpec("teacher-content-vocabulary-particle"),
        report,
      });
    });

    await runStep(report, "lesson:teacher-games", async () => {
      await teacherPage.goto(
        `${baseUrl}/teacher/lesson/${lessonId}/session/content/games?mode=appsync`,
        { waitUntil: "domcontentloaded" },
      );
      await waitForPageReady(teacherPage);
      await capturePage({
        page: teacherPage,
        pageSpec: getPageSpec("teacher-content-games"),
        report,
      });
    });

    await runStep(report, "lesson:teacher-student-card-detail", async () => {
      await teacherPage.goto(
        `${baseUrl}/teacher/lesson/${lessonId}/session/content/student-card?mode=appsync`,
        { waitUntil: "domcontentloaded" },
      );
      await waitForPageReady(teacherPage);
      await openStudentCardDetail(teacherPage);
      await capturePage({
        page: teacherPage,
        pageSpec: getPageSpec("teacher-content-student-card-detail"),
        report,
      });
    });
  }

  await Promise.allSettled([teacherContext.close(), homeContext.close()]);
};

const generateDocs = async () => {
  const version = await loadVersion();
  const report = {
    capturedItems: [],
    failedItems: [],
    generatedPages: [],
    baseUrl,
    generatedAt: new Date().toISOString(),
  };

  await cleanOutputDirs();
  await ensureOutputDirs();

  const browser = await chromium.launch({ headless: true });
  try {
    await parentFlow(browser, report);
    await teacherFlow(browser, report);
    await sharedFlow(browser, report);
    await lessonFlow(browser, report);
  } finally {
    await browser.close();
  }

  for (const pageSpec of pageSpecs) {
    for (const lang of ["ja", "en"]) {
      const pageContext = await loadPageContext(pageSpec, lang);
      await writeFile(
        path.join(docsRoot, lang, "manual", `${pageSpec.slug}.md`),
        renderMarkdown({ pageSpec, version, pageContext, lang }),
        "utf8",
      );
    }
    report.generatedPages.push(pageSpec.slug);
  }

  await writeFile(path.join(docsRoot, "_config.yml"), renderConfig(), "utf8");
  await writeFile(path.join(docsRoot, "index.md"), renderRootIndex(), "utf8");
  await writeFile(
    path.join(docsRoot, "ja", "index.md"),
    renderLocaleIndex({ version, lang: "ja" }),
    "utf8",
  );
  await writeFile(
    path.join(docsRoot, "ja", "manual", "index.md"),
    renderManualIndex({ version, lang: "ja" }),
    "utf8",
  );
  await writeFile(
    path.join(docsRoot, "en", "index.md"),
    renderLocaleIndex({ version, lang: "en" }),
    "utf8",
  );
  await writeFile(
    path.join(docsRoot, "en", "manual", "index.md"),
    renderManualIndex({ version, lang: "en" }),
    "utf8",
  );
  await writeFile(
    path.join(artifactsRoot, "last-run.json"),
    JSON.stringify(report, null, 2),
    "utf8",
  );
};

await generateDocs();
