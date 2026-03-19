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
    title: "Home Startup",
    tag: "home",
    imageName: "screen-home-startup.png",
    description:
      "家庭端末向けの起動画面です。宿題、進捗確認、授業参加導線をここから利用します。",
    imageDescription:
      "レッスン情報、メニュー、教材一覧が表示される Home の起動画面です。",
    nextPages: [
      { slug: "home-mypage", label: "My Page" },
    ],
    items: [
      {
        id: "lesson-header",
        label: "レッスンヘッダー",
        purpose: "現在対象のレッスンやクラス情報を確認するための表示です。",
      },
      {
        id: "menu-button",
        label: "メニューボタン",
        purpose: "進捗確認や授業参加などの操作メニューを開くための操作です。",
        operation: "押下すると起動画面の操作メニューを表示します。",
      },
      {
        id: "content-list",
        label: "教材一覧",
        purpose: "この画面から扱う教材や学習コンテンツの一覧を確認するための表示です。",
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
    title: "Teacher Startup",
    tag: "teacher",
    imageName: "screen-teacher-startup.png",
    description:
      "Teacher 向けの起動画面です。授業内容を確認し、授業開始や各種操作の入口になります。",
    imageDescription:
      "レッスン情報、メニュー、教材一覧、参加生徒一覧が表示される Teacher 起動画面です。",
    items: [
      {
        id: "lesson-header",
        label: "レッスンヘッダー",
        purpose: "対象クラスとレッスン情報を確認するための表示です。",
      },
      {
        id: "menu-button",
        label: "メニューボタン",
        purpose: "Start Lesson などの主要操作を開くための操作です。",
        operation: "押下すると Teacher 用の起動メニューを表示します。",
      },
      {
        id: "student-list",
        label: "生徒一覧",
        purpose: "対象授業に紐づく生徒を確認するための表示です。",
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
    title: "Shared Startup",
    tag: "shared",
    imageName: "screen-shared-startup.png",
    description:
      "共用端末向けの起動画面です。授業参加や教材参照の入口になります。",
    imageDescription:
      "レッスン情報、メニュー、教材一覧が表示される Shared 起動画面です。",
    items: [
      {
        id: "lesson-header",
        label: "レッスンヘッダー",
        purpose: "現在対象のクラスとレッスン情報を確認するための表示です。",
      },
      {
        id: "menu-button",
        label: "メニューボタン",
        purpose: "Enter Lesson などの主要操作を開くための操作です。",
        operation: "押下すると Shared 用の起動メニューを表示します。",
      },
      {
        id: "content-list",
        label: "教材一覧",
        purpose: "利用可能な教材や学習コンテンツを確認するための表示です。",
      },
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
  return `---
title: ${locale.manualIndexTitle}
lang: ${locale.frontMatterLang}
tag: index
version: ${version}
---

# ${locale.manualIndexHeading}

- [Setup Device](./setup-device.md)
- [Login](./login.md)
- [Home Route First Screen](./home-switch-student.md)
- [Home Startup](./home-startup.md)
- [My Page](./home-mypage.md)
- [Avatar](./home-avatar.md)
- [Teacher Class Selection](./teacher-select-class.md)
- [Teacher Startup](./teacher-startup.md)
- [Shared Class Selection](./shared-select-class.md)
- [Shared Student Selection](./shared-select-student.md)
- [Shared Startup](./shared-startup.md)
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

const waitForCaptureReady = async (page, slug) => {
  const body = page.locator("body");

  const waitForNoLoading = async () => {
    await page.waitForFunction(() => {
      const text = document.body.innerText.replace(/\s+/g, " ").trim();
      return !/Loading/i.test(text);
    });
  };

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
      await waitForNoLoading();
    },
    "home-mypage": async () => {
      await page.waitForURL(/\/mypage$/);
      await page.waitForFunction(() => /Ace Student/i.test(document.body.innerText));
      await waitForNoLoading();
    },
    "home-avatar": async () => {
      await page.waitForURL(/\/avatar$/);
      await page.waitForFunction(() => /Avatar Name/i.test(document.body.innerText));
      await waitForNoLoading();
    },
    "teacher-select-class": async () => {
      await page.waitForURL(/\/select-class$/);
      await page.waitForFunction(() => {
        const text = document.body.innerText.replace(/\s+/g, " ").trim();
        return /Select Class/i.test(text) && /ACE DEMO SCHOOL/i.test(text) && !/Loading/i.test(text);
      });
      await page.getByRole("button", { name: /^Select$/i }).waitFor();
    },
    "teacher-startup": async () => {
      await page.waitForURL(/\/teacher\/lesson$/);
      await page.getByTestId("lesson-header-menu-button").waitFor();
      await waitForNoLoading();
    },
    "shared-select-class": async () => {
      await page.waitForURL(/\/select-class$/);
      await page.waitForFunction(() => {
        const text = document.body.innerText.replace(/\s+/g, " ").trim();
        return /Select Class/i.test(text) && /ACE DEMO SCHOOL/i.test(text) && !/Loading/i.test(text);
      });
      await page.getByRole("button", { name: /^Select$/i }).waitFor();
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
      await waitForNoLoading();
    },
  };

  if (readyMap[slug]) {
    await readyMap[slug]();
    return;
  }

  await body.waitFor();
  await waitForNoLoading();
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
      "lesson-header": page.getByTestId("lesson-header").first(),
      "menu-button": page.getByTestId("lesson-header-menu-button").first(),
      "content-list": byTextBlock(/Student Card/i),
    },
    "home-mypage": {
      "profile-header": byTextBlock(/Ace Student/i),
      "next-class": byTextBlock(/Next Class/i),
      "progress-panel": byTextBlock(/Confirm Progress Unit/i),
    },
    "home-avatar": {
      "avatar-header": byTextBlock(/Ace Student Coins/i),
      "preview-panel": byTextBlock(/Avatar Name/i),
      "filter-panel": byTextBlock(/Ownership/i),
    },
    "teacher-select-class": {
      "teacher-name": byTextBlock(/先生/i),
      "class-card": byTextBlock(/ACE DEMO SCHOOL/i),
      "select-button": byRole("button", /^Select$/i),
    },
    "teacher-startup": {
      "lesson-header": page.getByTestId("lesson-header").first(),
      "menu-button": page.getByTestId("lesson-header-menu-button").first(),
      "student-list": byTextBlock(/ACE STUDENT/i),
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
      "lesson-header": page.getByTestId("lesson-header").first(),
      "menu-button": page.getByTestId("lesson-header-menu-button").first(),
      "content-list": byTextBlock(/Student Card/i),
    },
  };

  return map[slug]?.[itemId] ?? null;
};

const loginAs = async (page, email, gotoPath) => {
  await page.goto(`${baseUrl}${gotoPath}`, { waitUntil: "domcontentloaded" });
  await waitForPageReady(page);
  if (/\/login\b/.test(page.url())) {
    await page.locator('input[type="email"]').fill(email);
    await page.locator('input[type="password"]').fill(password);
    await page.locator('button[type="submit"]').click();
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
      pageSpec: pageSpecs.find((spec) => spec.slug === "login"),
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
      pageSpec: pageSpecs.find((spec) => spec.slug === "home-switch-student"),
      report,
    });
  });

  await runStep(report, "parent:setup-device", async () => {
    await page.goto(`${baseUrl}/setup-device`, { waitUntil: "domcontentloaded" });
    await waitForPageReady(page);
    await capturePage({
      page,
      pageSpec: pageSpecs.find((spec) => spec.slug === "setup-device"),
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
      pageSpec: pageSpecs.find((spec) => spec.slug === "home-startup"),
      report,
    });
  });

  await runStep(report, "parent:mypage", async () => {
    await page.goto(`${baseUrl}/mypage`, { waitUntil: "domcontentloaded" });
    await waitForPageReady(page);
    await capturePage({
      page,
      pageSpec: pageSpecs.find((spec) => spec.slug === "home-mypage"),
      report,
    });
  });

  await runStep(report, "parent:avatar", async () => {
    await page.goto(`${baseUrl}/avatar`, { waitUntil: "domcontentloaded" });
    await waitForPageReady(page);
    await capturePage({
      page,
      pageSpec: pageSpecs.find((spec) => spec.slug === "home-avatar"),
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
      pageSpec: pageSpecs.find((spec) => spec.slug === "teacher-select-class"),
      report,
    });
  });

  await runStep(report, "teacher:startup", async () => {
    await page.getByRole("button", { name: /^Select$/i }).click();
    await waitForPageReady(page);
    await capturePage({
      page,
      pageSpec: pageSpecs.find((spec) => spec.slug === "teacher-startup"),
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
      pageSpec: pageSpecs.find((spec) => spec.slug === "shared-select-class"),
      report,
    });
  });

  await runStep(report, "shared:select-student", async () => {
    await page.getByRole("button", { name: /^Select$/i }).click();
    await waitForPageReady(page);
    await capturePage({
      page,
      pageSpec: pageSpecs.find((spec) => spec.slug === "shared-select-student"),
      report,
    });
  });

  await runStep(report, "shared:startup", async () => {
    await page.getByRole("button", { name: /^Select$/i }).click();
    await waitForPageReady(page);
    await capturePage({
      page,
      pageSpec: pageSpecs.find((spec) => spec.slug === "shared-startup"),
      report,
    });
  });

  await context.close();
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
