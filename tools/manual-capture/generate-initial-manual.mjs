import path from "node:path";
import { fileURLToPath } from "node:url";
import { readFileSync } from "node:fs";
import {
  access,
  copyFile,
  mkdir,
  readdir,
  readFile,
  rm,
  unlink,
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
const manualCaptureLockPath = path.join(artifactsRoot, "manual-capture.lock");
const trackedFixtureSummaryPath = path.join(
  repoRoot,
  "tools",
  "manual-capture",
  "dev-image-fixtures-summary.json",
);
const fixtureSummaryPath = path.join(
  artifactsRoot,
  "dev-image-fixtures-summary.json",
);
const fixtureStatePath = path.join(
  repoRoot,
  "tools",
  "manual-capture",
  ".state",
  "dev-image-fixtures.state.json",
);

const upstreamRoot =
  process.env.UPSTREAM_REPO_DIR ?? "/workspaces/eco-online-lesson-skim";
const upstreamLessonPackageJson = path.join(
  upstreamRoot,
  "apps",
  "lesson",
  "package.json",
);
const localPackageJson = path.join(repoRoot, "package.json");
const apiGatewayBaseUrl =
  process.env.ECO_API_BASE_URL ??
  "https://4802hd5j8l.execute-api.ap-northeast-1.amazonaws.com/api";
const allowParallelManualCapture =
  process.env.MANUAL_CAPTURE_ALLOW_PARALLEL === "1" ||
  process.env.MANUAL_CAPTURE_ALLOW_PARALLEL === "true";
const manualGeneratePageFilter = new Set(
  String(process.env.MANUAL_GENERATE_PAGE_FILTER ?? "")
    .split(",")
    .map((value) => value.trim())
    .filter(Boolean),
);

const escapeRegExp = (value) =>
  String(value).replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

const loadFixtureSummary = () => {
  for (const summaryPath of [trackedFixtureSummaryPath, fixtureSummaryPath]) {
    try {
      return JSON.parse(readFileSync(summaryPath, "utf8"));
    } catch {
      continue;
    }
  }

  return null;
};

const loadFixtureState = () => {
  try {
    return JSON.parse(readFileSync(fixtureStatePath, "utf8"));
  } catch {
    return null;
  }
};

const fixtureSummary = loadFixtureSummary();
const fixtureState = loadFixtureState();
const fixtureTeacherEmail = fixtureSummary?.teacher?.email;
const fallbackParentEmail =
  fixtureSummary?.students?.[0]?.parent?.email ??
  fixtureSummary?.students?.find((student) => student?.parent?.email)?.parent
    ?.email;
const fixturePrimaryClassId = fixtureState?.classes?.primary?.classId ?? null;
const fixturePrimaryStudentId =
  fixtureSummary?.students?.[0]?.studentId ??
  Object.values(fixtureState?.students ?? {})[0]?.studentId ??
  null;
const fixtureLessonId = fixturePrimaryClassId
  ? `${fixtureSummary?.schoolId ?? "school-ace-001"}_${fixturePrimaryClassId}_${
    new Intl.DateTimeFormat("en-CA", {
      timeZone: "Asia/Tokyo",
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
    }).format(new Date())
  }`
  : null;
const baseUrl = process.env.ECO_BASE_URL;
const flowStepTimeoutMs = Number(process.env.MANUAL_FLOW_STEP_TIMEOUT_MS ?? "45000");
const captureAssetTimeoutMs = Number(
  process.env.MANUAL_CAPTURE_ASSET_TIMEOUT_MS ?? "30000",
);
const captureSettleTimeoutMs = Number(
  process.env.MANUAL_CAPTURE_SETTLE_TIMEOUT_MS ?? "5000",
);
const joinReadyAttempts = Number(
  process.env.MANUAL_JOIN_READY_ATTEMPTS ?? "45",
);
const joinReadyRetryDelayMs = Number(
  process.env.MANUAL_JOIN_READY_RETRY_DELAY_MS ?? "1000",
);
const joinDialogReopenInterval = Number(
  process.env.MANUAL_JOIN_DIALOG_REOPEN_INTERVAL ?? "5",
);
const teacherEmail =
  fixtureTeacherEmail ?? process.env.E2E_TEACHER_EMAIL;
const parentEmail = fallbackParentEmail ?? process.env.E2E_PARENT_EMAIL;
const password = process.env.E2E_LOGIN_PASSWORD;
const fixtureTeacherNamePattern = fixtureSummary?.teacher?.name
  ? new RegExp(escapeRegExp(fixtureSummary.teacher.name), "i")
  : /Teacher|先生/i;

if (!baseUrl || !teacherEmail || !parentEmail || !password) {
  throw new Error(
    "ECO_BASE_URL and E2E_LOGIN_PASSWORD are required. Manual capture prefers teacher/parent emails from tools/manual-capture/.artifacts/dev-image-fixtures-summary.json and falls back to E2E_* env vars.",
  );
}

const allowedCorsMethods = "GET,POST,PUT,PATCH,DELETE,OPTIONS";

const acquireManualCaptureLock = async (scriptName) => {
  if (allowParallelManualCapture) {
    return async () => {};
  }

  await mkdir(artifactsRoot, { recursive: true });

  try {
    await writeFile(
      manualCaptureLockPath,
      JSON.stringify(
        {
          pid: process.pid,
          scriptName,
          startedAt: new Date().toISOString(),
        },
        null,
        2,
      ),
      { encoding: "utf8", flag: "wx" },
    );
  } catch (error) {
    if (error && typeof error === "object" && "code" in error && error.code === "EEXIST") {
      const existing = readFileSync(manualCaptureLockPath, "utf8");
      throw new Error(
        `Another manual-capture run is already active. Remove ${manualCaptureLockPath} only if the previous run is no longer running.\n${existing}`,
      );
    }
    throw error;
  }

  return async () => {
    await unlink(manualCaptureLockPath).catch((error) => {
      if (!error || typeof error !== "object" || !("code" in error) || error.code !== "ENOENT") {
        throw error;
      }
    });
  };
};

const logRunContext = (context) => {
  console.log("[manual-capture] run context");
  console.log(JSON.stringify(context, null, 2));
};

const writeLastRunReport = async (report) => {
  await writeFile(
    path.join(artifactsRoot, "last-run.json"),
    JSON.stringify(report, null, 2),
    "utf8",
  );
};

const shouldCapturePage = (slug) =>
  manualGeneratePageFilter.size === 0 || manualGeneratePageFilter.has(slug);

const buildFixtureSessionPayload = (lessonId) => {
  if (typeof lessonId !== "string") {
    return null;
  }

  const match = lessonId.match(/^([^_]+)_([^_]+)_(\d{4}-\d{2}-\d{2})$/);
  if (!match) {
    return null;
  }

  const [, schoolId, classId, date] = match;
  const primaryClassId = fixtureState?.classes?.primary?.classId;
  if (classId !== primaryClassId) {
    return null;
  }

  const teacherId = fixtureState?.teacher?.accountId ?? fixtureSummary?.teacher?.accountId;

  return {
    session: {
      PK: `SCHOOL#${schoolId}`,
      SK: `CLASS#${classId}#YEAR#${date.slice(0, 4)}#SESSION#${date}`,
      accountLookupPK: teacherId ? `ACCOUNT#${teacherId}` : undefined,
      accountLookupSK: "SESSION#2026-03-20#16:00",
      attendance: {},
      calendarColor: "#4F8EF7",
      classId,
      classType: "eco",
      createdAt: new Date().toISOString(),
      date,
      dayOfWeek: 5,
      duration: 45,
      isActive: true,
      itemType: "ClassSession",
      lessonId,
      lessonType: "eco",
      level: "blue",
      locationId: "IMGFIX-room-1",
      locationLookupPK: `SCHOOL#${schoolId}#LOCATION#IMGFIX-room-1`,
      locationLookupSK: "SESSION#2026-03-20#16:00",
      name: "SECTION A",
      schoolCalendarLookupPK: `SCHOOL#${schoolId}`,
      schoolCalendarLookupSK: "SESSION#2026-03-20#16:00",
      startTime: "16:00",
      startedAt: new Date().toISOString(),
      status: "IN_PROGRESS",
      teacherId,
      unitNumber: 1,
      updatedAt: new Date().toISOString(),
      year: Number(date.slice(0, 4)),
    },
  };
};

const maybeBuildShimmedApiResponse = (requestUrl, method, upstreamStatus) => {
  const url = new URL(requestUrl);
  const lessonMatch = url.pathname.match(/\/sessions\/([^/]+)$/);
  if (method === "GET" && lessonMatch && upstreamStatus === 400) {
    return buildFixtureSessionPayload(decodeURIComponent(lessonMatch[1]));
  }

  const sessionMutationMatch = url.pathname.match(
    /\/sessions\/([^/]+)\/(start|join|scores|attendance|finalize)$/,
  );
  if (method === "POST" && sessionMutationMatch) {
    const lessonId = decodeURIComponent(sessionMutationMatch[1]);
    if (buildFixtureSessionPayload(lessonId)) {
      return { ok: true };
    }
  }

  return null;
};

const createManualCaptureContext = async (browser, options) => {
  const context = await browser.newContext(options);
  const appOrigin = new URL(baseUrl).origin;
  const gatewayOrigin = new URL(apiGatewayBaseUrl).origin;
  const gatewayPathPrefix = new URL(apiGatewayBaseUrl).pathname.replace(/\/$/, "");

  await context.route(`${gatewayOrigin}/**`, async (route) => {
    const request = route.request();
    const url = new URL(request.url());

    if (!url.pathname.startsWith(gatewayPathPrefix)) {
      await route.fallback();
      return;
    }

    if (request.method() === "OPTIONS") {
      await route.fulfill({
        status: 204,
        headers: {
          "access-control-allow-origin": appOrigin,
          "access-control-allow-methods": allowedCorsMethods,
          "access-control-allow-headers":
            request.headerValue("access-control-request-headers") ??
            "authorization,content-type",
          "access-control-max-age": "86400",
        },
      });
      return;
    }

    const headers = { ...request.headers() };
    delete headers.origin;
    delete headers.referer;
    delete headers.host;
    delete headers["content-length"];

    const response = await fetch(request.url(), {
      method: request.method(),
      headers,
      body: request.method() === "GET" || request.method() === "HEAD"
        ? undefined
        : request.postDataBuffer() ?? undefined,
      redirect: "manual",
    });

    const shimmedBody = maybeBuildShimmedApiResponse(
      request.url(),
      request.method(),
      response.status,
    );
    if (shimmedBody) {
      await route.fulfill({
        status: 200,
        headers: {
          "access-control-allow-origin": appOrigin,
          "access-control-allow-methods": allowedCorsMethods,
          "access-control-allow-headers":
            request.headerValue("access-control-request-headers") ??
            "authorization,content-type",
          "content-type": "application/json",
        },
        body: JSON.stringify(shimmedBody),
      });
      return;
    }

    const responseHeaders = Object.fromEntries(response.headers.entries());
    responseHeaders["access-control-allow-origin"] = appOrigin;
    responseHeaders["access-control-allow-methods"] = allowedCorsMethods;
    responseHeaders["access-control-allow-headers"] =
      request.headerValue("access-control-request-headers") ??
      "authorization,content-type";

    await route.fulfill({
      status: response.status,
      headers: responseHeaders,
      body: Buffer.from(await response.arrayBuffer()),
    });
  });

  return context;
};

const lessonGameTargets = [
  {
    gameId: "word-challenge",
    slug: "teacher-game-word-challenge",
    title: "Word Challenge Game",
    gameCenterTitle: "WORD CHALLENGE",
    previewColor: "blue",
    previewUnit: 1,
  },
  {
    gameId: "speed-challenge",
    slug: "teacher-game-speed-challenge",
    title: "Speed Challenge Game",
    gameCenterTitle: "SPEED CHALLENGE",
    previewColor: "blue",
    previewUnit: 1,
  },
  {
    gameId: "memory-match",
    slug: "teacher-game-memory-match",
    title: "Memory Match Game",
    gameCenterTitle: "MEMORY MATCH",
    previewColor: "blue",
    previewUnit: 1,
  },
  {
    gameId: "word-twist",
    slug: "teacher-game-word-twist",
    title: "Word Twist Game",
    gameCenterTitle: "WORD TWIST",
    previewColor: "blue",
    previewUnit: 1,
  },
  {
    gameId: "word-search",
    slug: "teacher-game-word-search",
    title: "Word Search Game",
    gameCenterTitle: "WORD SEARCH",
    previewColor: "green",
    previewUnit: 1,
  },
  {
    gameId: "sentence-scramble",
    slug: "teacher-game-sentence-scramble",
    title: "Sentence Scramble Game",
    gameCenterTitle: "SENTENCE SCRAMBLE",
    previewColor: "blue",
    previewUnit: 1,
  },
  {
    gameId: "hangman",
    slug: "teacher-game-hangman",
    title: "Hangman Game",
    gameCenterTitle: "HANGMAN",
    previewColor: "blue",
    previewUnit: 1,
  },
  {
    gameId: "image-count",
    slug: "teacher-game-image-count",
    title: "Image Count Game",
    gameCenterTitle: "IMAGE COUNT",
    previewColor: "blue",
    previewUnit: 1,
  },
  {
    gameId: "letter-shoot",
    slug: "teacher-game-letter-shoot",
    title: "Letter Shoot Game",
    gameCenterTitle: "LETTER SHOOT",
    previewColor: "blue",
    previewUnit: 1,
  },
  {
    gameId: "letter-drop",
    slug: "teacher-game-letter-drop",
    title: "Letter Drop Game",
    gameCenterTitle: "LETTER DROP",
    previewColor: "blue",
    previewUnit: 1,
  },
  {
    gameId: "snake",
    slug: "teacher-game-snake",
    title: "Snake Game",
    gameCenterTitle: "SNAKE",
    previewColor: "blue",
    previewUnit: 1,
  },
];

const teacherGamePageSpecs = lessonGameTargets.map((target) => ({
  slug: target.slug,
  title: target.title,
  tag: "lesson",
  imageName: `screen-lesson-${target.slug}.png`,
  description: `Lesson content を ${target.title} に切り替えた状態です。`,
  imageDescription: `${target.title} のプレイ画面が表示されます。`,
  items: [],
}));

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
  {
    slug: "restricted",
    title: "Restricted",
    tag: "common",
    imageName: "screen-common-restricted.png",
    description: "権限不一致または利用不可の device mode に入った場合の制限画面です。",
    imageDescription: "利用できない旨のメッセージと Login Page への戻り導線が表示されます。",
    items: [],
  },
  {
    slug: "shared-mypage",
    title: "Shared My Page",
    tag: "shared",
    imageName: "screen-shared-mypage.png",
    description: "Shared 端末で選択した生徒の進捗やポイントを確認するページです。",
    imageDescription: "生徒情報、ポイント、授業予定、進捗確認 UI が表示されます。",
    items: [],
  },
  {
    slug: "shared-lesson",
    title: "Shared Lesson Page",
    tag: "lesson",
    imageName: "screen-lesson-shared-session.png",
    description: "Shared 端末で Lesson session に参加した Study / Viewer 状態です。",
    imageDescription: "Lesson ヘッダー、生徒向け同期表示、Student Card コンテンツが表示されます。",
    items: [],
  },
  {
    slug: "home-lesson-study-player",
    title: "Home Lesson Study Player",
    tag: "lesson",
    imageName: "screen-lesson-home-session-study-player.png",
    description: "Home 端末で Study モード中に生徒が Operator として参加している状態です。",
    imageDescription: "Lesson ヘッダーに Player 表示が出て、Student Card コンテンツが表示されます。",
    items: [],
  },
  {
    slug: "shared-lesson-study-player",
    title: "Shared Lesson Study Player",
    tag: "lesson",
    imageName: "screen-lesson-shared-session-study-player.png",
    description: "Shared 端末で Study モード中に生徒が Operator として参加している状態です。",
    imageDescription: "Lesson ヘッダーに Player 表示が出て、Student Card コンテンツが表示されます。",
    items: [],
  },
  {
    slug: "teacher-lesson-play",
    title: "Teacher Lesson Play",
    tag: "lesson",
    imageName: "screen-lesson-teacher-session-play.png",
    description: "Teacher が Lesson session を Play モードに切り替えた状態です。",
    imageDescription: "Lesson ヘッダーの同期表示が Play になった Teacher Lesson 画面です。",
    items: [],
  },
  {
    slug: "home-lesson-play",
    title: "Home Lesson Play",
    tag: "lesson",
    imageName: "screen-lesson-home-session-play.png",
    description: "Home 端末で Lesson session を Play モードで表示している状態です。",
    imageDescription: "Lesson ヘッダーに OPEN MY PAGE が表示される生徒側 Lesson 画面です。",
    items: [],
  },
  {
    slug: "shared-lesson-play",
    title: "Shared Lesson Play",
    tag: "lesson",
    imageName: "screen-lesson-shared-session-play.png",
    description: "Shared 端末で Lesson session を Play モードで表示している状態です。",
    imageDescription: "Lesson ヘッダーに OPEN MY PAGE が表示される Shared 側 Lesson 画面です。",
    items: [],
  },
  ...teacherGamePageSpecs,
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
  await rm(path.join(docsRoot, "ja", "manual"), { recursive: true, force: true });
  await rm(path.join(docsRoot, "en", "manual"), { recursive: true, force: true });
};

const loadVersion = async () => {
  const envVersion = process.env.MANUAL_APP_VERSION?.trim();
  if (envVersion) {
    return envVersion;
  }

  for (const candidatePath of [upstreamLessonPackageJson, localPackageJson]) {
    try {
      const raw = await readFile(candidatePath, "utf8");
      return JSON.parse(raw).version ?? "0.0.0";
    } catch (error) {
      if (
        !error ||
        typeof error !== "object" ||
        !("code" in error) ||
        error.code !== "ENOENT"
      ) {
        throw error;
      }
    }
  }

  return "0.0.0";
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
    pageHeaderLinksLabel: "一覧",
    japaneseManualLinkLabel: "日本語一覧",
    englishManualLinkLabel: "English Manual",
    manualPagesHeading: "画面マニュアル",
    fixtureAppendixHeading: "付録: テスト用ユーザー",
    fixtureAppendixLinkLabel: "テスト用ユーザー一覧",
    fixtureTitle: "Test Users",
    fixtureHeading: "画像取得用テストユーザー",
    fixtureUpdatedLabel: "最終更新",
    fixtureOverviewHeading: "概要",
    fixtureTeacherHeading: "教師",
    fixtureStudentsHeading: "生徒",
    fixtureSchoolLabel: "対象 schoolId",
    fixtureGroupingLabel: "親グループ",
    fixtureAvatarNote:
      "生徒アバターはアバター購入画面の catalog から選んだ購入済みアバターを設定",
    fixtureMedalNote: "メダルレベルはランクポイント合計から算出しています",
    fixtureTeacherCountLabel: "教師",
    fixtureStudentCountLabel: "生徒",
    fixtureColumns: {
      name: "名前",
      role: "Role",
      avatar: "Avatar",
      classes: "所属クラス",
      parent: "親アカウント",
      points: "初期ポイント",
      coins: "初期coin",
      medalLevel: "メダルレベル",
    },
    fixtureTeacherAccountColumn: "アカウント",
    fixtureStudentAccountColumn: "親アカウント",
    fixtureTeacherAvatarFallback: "Generated SVG",
    fixtureNoValue: "-",
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
    pageHeaderLinksLabel: "Indexes",
    japaneseManualLinkLabel: "Japanese Manual",
    englishManualLinkLabel: "English Manual",
    manualPagesHeading: "Manual Pages",
    fixtureAppendixHeading: "Appendix: Test Users",
    fixtureAppendixLinkLabel: "Test User List",
    fixtureTitle: "Test Users",
    fixtureHeading: "Image Capture Test Users",
    fixtureUpdatedLabel: "Last Updated",
    fixtureOverviewHeading: "Overview",
    fixtureTeacherHeading: "Teacher",
    fixtureStudentsHeading: "Students",
    fixtureSchoolLabel: "Target schoolId",
    fixtureGroupingLabel: "Parent groups",
    fixtureAvatarNote:
      "Student avatars are assigned from purchased avatars in the avatar catalog.",
    fixtureMedalNote: "Medal levels are calculated from total rank points.",
    fixtureTeacherCountLabel: "Teacher",
    fixtureStudentCountLabel: "Students",
    fixtureColumns: {
      name: "Name",
      role: "Role",
      avatar: "Avatar",
      classes: "Assigned Classes",
      parent: "Parent Account",
      points: "Initial Points",
      coins: "Initial Coins",
      medalLevel: "Medal Level",
    },
    fixtureTeacherAccountColumn: "Account",
    fixtureStudentAccountColumn: "Parent Account",
    fixtureTeacherAvatarFallback: "Generated SVG",
    fixtureNoValue: "-",
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
  const japaneseManualIndexPath =
    lang === "ja" ? "./index.md" : "../../ja/manual/index.md";
  const englishManualIndexPath =
    lang === "en" ? "./index.md" : "../../en/manual/index.md";
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
  const headerLinks = [
    `[${locale.japaneseManualLinkLabel}](${japaneseManualIndexPath})`,
    `[${locale.englishManualLinkLabel}](${englishManualIndexPath})`,
  ].join(" | ");

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

${locale.pageHeaderLinksLabel}: ${headerLinks}

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
  const appendixLinks = fixtureSummary
    ? `## ${locale.manualPagesHeading}

${pageLinks}

## ${locale.fixtureAppendixHeading}

- [${locale.fixtureAppendixLinkLabel}](./test-users.md)`
    : `## ${locale.manualPagesHeading}

${pageLinks}`;
  return `---
title: ${locale.manualIndexTitle}
lang: ${locale.frontMatterLang}
tag: index
version: ${version}
---

# ${locale.manualIndexHeading}

${appendixLinks}
`;
};

const escapeTableCell = (value) =>
  String(value ?? "").replace(/\|/g, "\\|");

const renderFixtureManual = ({ lang, version }) => {
  if (!fixtureSummary) {
    return null;
  }

  const locale = localeConfig[lang];
  const japaneseManualIndexPath =
    lang === "ja" ? "./index.md" : "../../ja/manual/index.md";
  const englishManualIndexPath =
    lang === "en" ? "./index.md" : "../../en/manual/index.md";
  const headerLinks = [
    `[${locale.japaneseManualLinkLabel}](${japaneseManualIndexPath})`,
    `[${locale.englishManualLinkLabel}](${englishManualIndexPath})`,
  ].join(" | ");
  const teacherClasses = fixtureSummary.teacher?.classes?.length
    ? fixtureSummary.teacher.classes.join(", ")
    : locale.fixtureNoValue;
  const columns = locale.fixtureColumns;
  const teacherName = fixtureSummary.teacher?.name ?? locale.fixtureNoValue;
  const teacherAccount =
    fixtureSummary.teacher?.email ||
    fixtureSummary.teacher?.accountId ||
    locale.fixtureNoValue;
  const teacherAvatarCell = fixtureSummary.teacher?.avatar?.logo
    ? `<img src="${fixtureSummary.teacher.avatar.logo}" alt="${teacherName}" width="40" height="40"><br>${fixtureSummary.teacher.avatar.name ?? locale.fixtureTeacherAvatarFallback}`
    : fixtureSummary.teacher?.avatar?.name ?? locale.fixtureTeacherAvatarFallback;
  const studentRows = (fixtureSummary.students ?? [])
    .map((student) => {
      const classes = student.classes?.length
        ? student.classes.join("<br>")
        : locale.fixtureNoValue;
      const parent = student.parent
        ? `${student.parent.name} (${student.parent.email || student.parent.accountId})`
        : locale.fixtureNoValue;
      const avatarCell = student.avatar?.logo
        ? `<img src="${student.avatar.logo}" alt="${student.avatar.key || student.name}" width="40" height="40"><br>${student.avatar.name ?? student.avatar.key ?? locale.fixtureNoValue}`
        : student.avatar?.badgeUrl
        ? `<img src="${student.avatar.badgeUrl}" alt="${student.avatar.key || student.name}" width="40" height="40"><br>${student.avatar.name ?? student.avatar.key ?? locale.fixtureNoValue}`
        : student.avatar?.name ?? student.avatar?.key ?? locale.fixtureNoValue;

      return `| ${escapeTableCell(student.name)} | Student | ${avatarCell} | ${classes} | ${escapeTableCell(parent)} | ${student.points ?? 0} | ${student.coins ?? 0} | Lv.${student.medalLevel ?? locale.fixtureNoValue} |`;
    })
    .join("\n");

  return `---
title: ${locale.fixtureTitle}
lang: ${locale.frontMatterLang}
tag: manual
version: ${version}
---

# ${locale.fixtureHeading}

${locale.pageHeaderLinksLabel}: ${headerLinks}

${locale.fixtureUpdatedLabel}: ${fixtureSummary.generatedAt}

## ${locale.fixtureOverviewHeading}

- ${locale.fixtureSchoolLabel}: \`${fixtureSummary.schoolId}\`
- ${locale.fixtureTeacherCountLabel} 1, ${locale.fixtureStudentCountLabel} 8, ${locale.fixtureGroupingLabel} \`3 / 2 / 1 / 1 / 1\`
- ${locale.fixtureAvatarNote}
- ${locale.fixtureMedalNote}

## ${locale.fixtureTeacherHeading}

| ${columns.name} | ${columns.role} | ${columns.avatar} | ${columns.classes} | ${locale.fixtureTeacherAccountColumn} | ${columns.points} | ${columns.coins} | ${columns.medalLevel} |
|---|---|---|---|---|---:|---:|---|
| ${escapeTableCell(teacherName)} | Teacher | ${teacherAvatarCell} | ${escapeTableCell(teacherClasses)} | ${escapeTableCell(teacherAccount)} | ${locale.fixtureNoValue} | ${locale.fixtureNoValue} | ${locale.fixtureNoValue} |

## ${locale.fixtureStudentsHeading}

| ${columns.name} | ${columns.role} | ${columns.avatar} | ${columns.classes} | ${locale.fixtureStudentAccountColumn} | ${columns.points} | ${columns.coins} | ${columns.medalLevel} |
|---|---|---|---|---|---:|---:|---|
${studentRows}
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
header_pages: []
`;

const isExternalDocLink = (target) =>
  /^(?:[a-z]+:)?\/\//i.test(target) ||
  target.startsWith("mailto:") ||
  target.startsWith("tel:") ||
  target.startsWith("#");

const validateGeneratedDocs = async ({
  reusedExistingImages = false,
  reusedAssets = [],
} = {}) => {
  const markdownFiles = [];
  const manualDirs = [
    path.join(docsRoot, "ja", "manual"),
    path.join(docsRoot, "en", "manual"),
  ];
  const linkPattern = /!?\[[^\]]*\]\(([^)]+)\)/g;
  const issues = [];

  for (const manualDir of manualDirs) {
    let fileNames = [];
    try {
      fileNames = await readdir(manualDir);
    } catch (error) {
      if (!error || typeof error !== "object" || !("code" in error) || error.code !== "ENOENT") {
        throw error;
      }
    }

    for (const fileName of fileNames) {
      if (fileName.endsWith(".md")) {
        markdownFiles.push(path.join(manualDir, fileName));
      }
    }
  }

  for (const markdownFile of markdownFiles) {
    const content = await readFile(markdownFile, "utf8");
    for (const match of content.matchAll(linkPattern)) {
      const rawTarget = match[1]?.trim();
      if (!rawTarget || isExternalDocLink(rawTarget)) {
        continue;
      }

      const normalizedTarget = rawTarget.split("#")[0].split("?")[0];
      if (!normalizedTarget) {
        continue;
      }

      const resolvedTarget = path.resolve(path.dirname(markdownFile), normalizedTarget);
      try {
        await access(resolvedTarget);
      } catch (error) {
        if (error && typeof error === "object" && "code" in error && error.code === "ENOENT") {
          issues.push({
            source: path.relative(docsRoot, markdownFile),
            target: normalizedTarget,
            resolved: path.relative(docsRoot, resolvedTarget),
          });
          continue;
        }
        throw error;
      }
    }
  }

  const lines = [
    "---",
    "title: Output Errors",
    "lang: en",
    "tag: report",
    "---",
    "",
    "# Output Errors",
    "",
    `Generated At: ${new Date().toISOString()}`,
    "",
  ];

  if (reusedExistingImages) {
    lines.push(
      "Note: This output reused existing image assets. Some screenshots may be older than the current markdown output.",
    );
    lines.push("");
    if (reusedAssets.length > 0) {
      lines.push("Reused asset groups:");
      lines.push("");
      for (const asset of reusedAssets) {
        lines.push(`- ${asset}`);
      }
      lines.push("");
    }
  }

  if (issues.length === 0) {
    lines.push("No broken internal links or missing local assets were found.");
  } else {
    lines.push("The following broken internal links or missing local assets were found:");
    lines.push("");
    for (const issue of issues) {
      lines.push(`- Source: \`${issue.source}\` -> Target: \`${issue.target}\` -> Resolved: \`${issue.resolved}\``);
    }
  }

  await writeFile(path.join(docsRoot, "error.md"), `${lines.join("\n")}\n`, "utf8");
  return issues;
};

const waitForPageReady = async (page) => {
  await page.waitForLoadState("domcontentloaded");
  await page.waitForLoadState("networkidle", { timeout: 60000 }).catch(() => {});
  await page.evaluate(async () => {
    if (document.fonts?.ready) {
      await document.fonts.ready.catch(() => {});
    }
  }).catch(() => {});
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

const getStudentBadgeAvatarButton = (page) =>
  page.locator('[data-testid^="student-badge-"][data-testid$="-avatar-button"]').first();

const getStudentBadgeAddButton = (page) =>
  page.locator('[data-testid^="student-badge-"][data-testid$="-add-button"]').first();

const getStudentBadgeRemoveButton = (page) =>
  page.locator('[data-testid^="student-badge-"][data-testid$="-remove-button"]').first();

const getTeacherStudentsPanelCard = (page) =>
  page.locator('[data-testid^="student-"][data-testid$="-card"]').first();

const getTeacherStudentsPanelTodayScoreInput = (page) =>
  page.locator('[data-testid^="student-"][data-testid$="-today-score-input"]').first();

const getTeacherStudentsPanelTotalScoreInput = (page) =>
  page.locator('[data-testid^="student-"][data-testid$="-total-score-input"]').first();

const waitForAnimationFrames = async (page, count = 2) => {
  await page.evaluate(async (frameCount) => {
    for (let index = 0; index < frameCount; index += 1) {
      await new Promise((resolve) => window.requestAnimationFrame(() => resolve()));
    }
  }, count);
};

const readVisualAssetDiagnostics = async (page) =>
  page.evaluate(() => {
    const isVisible = (node) => {
      const style = window.getComputedStyle(node);
      if (
        style.display === "none" ||
        style.visibility === "hidden" ||
        Number(style.opacity) === 0
      ) {
        return false;
      }

      const rect = node.getBoundingClientRect();
      return rect.width > 0 && rect.height > 0;
    };

    const images = Array.from(document.images)
      .filter((image) => isVisible(image))
      .map((image) => ({
        src: image.currentSrc || image.src || "",
        alt: image.getAttribute("alt") ?? "",
        complete: image.complete,
        naturalWidth: image.naturalWidth,
      }));

    const broken = images
      .filter((image) => image.complete && image.naturalWidth === 0)
      .map((image) => ({
        src: image.src,
        alt: image.alt,
      }));
    const pending = images
      .filter((image) => !image.complete)
      .map((image) => ({
        src: image.src,
        alt: image.alt,
      }));

    return {
      visibleImageCount: images.length,
      broken,
      pending,
      fontStatus: document.fonts?.status ?? "unsupported",
    };
  });

const waitForVisibleImagesReady = async (page) => {
  await page.waitForFunction(
    () => {
      const isVisible = (node) => {
        const style = window.getComputedStyle(node);
        if (
          style.display === "none" ||
          style.visibility === "hidden" ||
          Number(style.opacity) === 0
        ) {
          return false;
        }

        const rect = node.getBoundingClientRect();
        return rect.width > 0 && rect.height > 0;
      };

      const visibleImages = Array.from(document.images).filter((image) =>
        isVisible(image)
      );
      return visibleImages.every((image) => image.complete && image.naturalWidth > 0);
    },
    undefined,
    { timeout: captureAssetTimeoutMs },
  ).catch(() => {});
};

const stabilizePageForCapture = async (page, slug, report) => {
  await waitForNoLoadingText(page).catch(() => {});
  await page.evaluate(async () => {
    if (document.fonts?.ready) {
      await document.fonts.ready.catch(() => {});
    }
  }).catch(() => {});
  await waitForVisibleImagesReady(page);
  await waitForAnimationFrames(page, 2).catch(() => {});
  await page.waitForTimeout(300);

  const diagnostics = await readVisualAssetDiagnostics(page).catch(() => null);
  if (!diagnostics) {
    return;
  }

  report.captureDiagnostics ??= [];
  report.captureDiagnostics.push({
    slug,
    ...diagnostics,
    recordedAt: new Date().toISOString(),
  });

  if (diagnostics.pending.length > 0 || diagnostics.broken.length > 0) {
    await page.waitForTimeout(Math.min(captureSettleTimeoutMs, 2_000));
    await waitForVisibleImagesReady(page);
    await waitForAnimationFrames(page, 2).catch(() => {});

    const retriedDiagnostics = await readVisualAssetDiagnostics(page).catch(
      () => diagnostics,
    );
    report.captureDiagnostics.push({
      slug,
      ...retriedDiagnostics,
      recordedAt: new Date().toISOString(),
      retry: true,
    });
  }
};

const waitForTeacherStartupReady = async (page) => {
  const reachedExpectedUrl = await page
    .waitForURL(/\/teacher\/lesson$/, {
      timeout: 20_000,
    })
    .then(() => true)
    .catch(() => false);

  if (reachedExpectedUrl) {
    return;
  }

  await page.getByTestId("lesson-header-menu-button").waitFor({
    timeout: 20_000,
  });
};

const waitForHomeStartupReady = async (page) => {
  const reachedExpectedUrl = await page
    .waitForURL(/\/switch-student$|\/home\/lesson$/, {
      timeout: 20_000,
    })
    .then(() => true)
    .catch(() => false);

  if (reachedExpectedUrl) {
    return /\/switch-student$/.test(page.url()) ? "switch-student" : "homework";
  }

  await page.getByTestId("lesson-header-class-name").waitFor({ timeout: 20_000 });
  await page.getByTestId("lesson-header-school-name").waitFor({ timeout: 20_000 });
  await page.getByTestId("lesson-header-menu-button").waitFor({ timeout: 20_000 });
  return "homework";
};

const waitForSharedStudentSelectionReady = async (page) => {
  await page.waitForFunction(
    () =>
      window.location.pathname === "/select-student" ||
      document.body.innerText.includes("ACE STUDENT"),
    undefined,
    { timeout: 20_000 },
  );
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
    restricted: async () => {
      await page.waitForURL(/\/restricted$/);
      await page.getByRole("button", { name: /Login Page/i }).waitFor();
      await waitForNoLoadingText(page);
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
      await waitForSharedStudentSelectionReady(page);
      await page.getByRole("combobox").waitFor();
      await page.getByRole("button", { name: /^Select$/i }).waitFor();
      await waitForNoLoadingText(page);
    },
    "shared-startup": async () => {
      await page.waitForURL(/\/shared\/lesson$/);
      await page.getByTestId("lesson-header-menu-button").waitFor();
      await waitForStudentCardRendered(page);
      await waitForNoLoadingText(page);
    },
    "shared-mypage": async () => {
      await page.waitForURL(/\/mypage$/);
      await page.waitForFunction(() => {
        const text = document.body.innerText.replace(/\s+/g, " ").trim();
        return /Coins|Points|Progress|Next Class/i.test(text);
      });
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
    "shared-lesson": async () => {
      await page.waitForFunction(() =>
        /\/shared\/lesson\/[^/]+\/session(?:\/content\/[^/]+)?/.test(
          window.location.pathname,
        ),
      );
      await page.getByTestId("lesson-header").waitFor();
      await waitForStudentCardRendered(page);
      await waitForNoLoadingText(page);
    },
    "home-lesson-study-player": async () => {
      await page.waitForFunction(() =>
        /\/home\/lesson\/[^/]+\/session(?:\/content\/[^/]+)?/.test(
          window.location.pathname,
        ),
      );
      await page.getByTestId("lesson-header").waitFor();
      await waitForStudentCardRendered(page);
      await waitForNoLoadingText(page);
    },
    "shared-lesson-study-player": async () => {
      await page.waitForFunction(() =>
        /\/shared\/lesson\/[^/]+\/session(?:\/content\/[^/]+)?/.test(
          window.location.pathname,
        ),
      );
      await page.getByTestId("lesson-header").waitFor();
      await waitForStudentCardRendered(page);
      await waitForNoLoadingText(page);
    },
    "teacher-lesson-play": async () => {
      await page.waitForFunction(() =>
        /\/teacher\/lesson\/[^/]+\/session(?:\/content\/[^/]+)?/.test(
          window.location.pathname,
        ),
      );
      await page.getByTestId("lesson-header").waitFor();
      await waitForStudentCardRendered(page);
      await waitForNoLoadingText(page);
    },
    "home-lesson-play": async () => {
      await page.waitForFunction(() =>
        /\/home\/lesson\/[^/]+\/session(?:\/content\/[^/]+)?/.test(
          window.location.pathname,
        ),
      );
      await page.getByTestId("lesson-header").waitFor();
      await waitForStudentCardRendered(page);
      await waitForNoLoadingText(page);
    },
    "shared-lesson-play": async () => {
      await page.waitForFunction(() =>
        /\/shared\/lesson\/[^/]+\/session(?:\/content\/[^/]+)?/.test(
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
      await getStudentBadgeAvatarButton(page).waitFor();
    },
    "teacher-panel-icon-xs": async () => {
      await page.getByTestId("lesson-shell-students").waitFor();
      await getStudentBadgeAvatarButton(page).waitFor();
    },
    "teacher-panel-simple-md": async () => {
      await getTeacherStudentsPanelCard(page).waitFor();
    },
    "teacher-panel-full-md": async () => {
      await getTeacherStudentsPanelTotalScoreInput(page).waitFor();
    },
    "teacher-panel-progress-md": async () => {
      await getTeacherStudentsPanelCard(page).waitFor();
      await page.waitForFunction(() => /Progress|Homework/i.test(document.body.innerText));
    },
    "teacher-content-vocabulary-particle": async () => {
      await page.waitForFunction(() =>
        /\/teacher\/lesson\/[^/]+\/session\/content\/vocabulary-particle(?:\?.*)?$/.test(
          window.location.pathname + window.location.search,
        ),
      );
      await page.getByTestId("lesson-header").waitFor();
      await waitForNoLoadingText(page);
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

  const gameTarget = lessonGameTargets.find((target) => target.slug === slug);
  if (gameTarget) {
    await page.getByTestId("lesson-header").waitFor();
    await waitForGameContentReady(page, gameTarget.gameId);
    await waitForNoLoadingText(page);
    return;
  }

  if (readyMap[slug]) {
    await readyMap[slug]();
    return;
  }

  await body.waitFor();
  await waitForNoLoadingText(page);
};

const capturePage = async ({ page, pageSpec, report }) => {
  if (!shouldCapturePage(pageSpec.slug)) {
    report.skippedPages ??= [];
    report.skippedPages.push(pageSpec.slug);
    return;
  }

  await waitForCaptureReady(page, pageSpec.slug);
  await stabilizePageForCapture(page, pageSpec.slug, report);
  await page.screenshot({
    path: path.join(imagesRoot, pageSpec.imageName),
    fullPage: true,
  });
  report.capturedPages ??= [];
  report.capturedPages.push(pageSpec.slug);

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

const runStep = async (report, stepName, action, options = {}) => {
  const timeoutMs = options.timeoutMs ?? flowStepTimeoutMs;
  console.log(`[manual-capture] step:start ${stepName}`);
  try {
    await Promise.race([
      action(),
      new Promise((_, reject) => {
        setTimeout(() => {
          reject(new Error(`Step timed out after ${timeoutMs}ms: ${stepName}`));
        }, timeoutMs);
      }),
    ]);
    console.log(`[manual-capture] step:done ${stepName}`);
  } catch (error) {
    console.error(`[manual-capture] step:fail ${stepName}`);
    console.error(String(error));
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
      "teacher-name": byTextBlock(fixtureTeacherNamePattern),
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
      "teacher-name": byTextBlock(fixtureTeacherNamePattern),
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
      "viewer-status": page.getByTestId("lesson-header").getByRole("button", { name: /Viewer|Player|OPEN MY PAGE/i }).first(),
      datetime: page.getByTestId("lesson-header-datetime").first(),
      "student-card": page.getByTestId("student-card-content-root").first(),
    },
    "teacher-panel-none-md": {
      "student-card": page.getByTestId("student-card-content-root").first(),
    },
    "teacher-panel-icon-md": {
      "avatar-button": getStudentBadgeAvatarButton(page),
      "score-add": getStudentBadgeAddButton(page),
      "score-remove": getStudentBadgeRemoveButton(page),
    },
    "teacher-panel-icon-xs": {
      "avatar-button": getStudentBadgeAvatarButton(page),
    },
    "teacher-panel-simple-md": {
      "student-card": getTeacherStudentsPanelCard(page),
      "today-score": getTeacherStudentsPanelTodayScoreInput(page),
    },
    "teacher-panel-full-md": {
      "student-card": getTeacherStudentsPanelCard(page),
      "today-score": getTeacherStudentsPanelTodayScoreInput(page),
      "unit-total-score": getTeacherStudentsPanelTotalScoreInput(page),
    },
    "teacher-panel-progress-md": {
      "student-card": getTeacherStudentsPanelCard(page),
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

const waitForGameContentReady = async (page, gameId) => {
  const waiters = {
    "word-challenge": () => page.getByTestId("word-challenge-start-panel").waitFor(),
    "speed-challenge": () => page.getByTestId("speed-challenge-stage").waitFor(),
    "memory-match": () => page.getByTestId("memory-match-stage").waitFor(),
    "word-twist": () => page.getByTestId("word-twist-stage").waitFor(),
    "word-search": () => page.getByTestId("word-search-grid").waitFor(),
    "sentence-scramble": () => page.getByTestId("sentence-scramble-prompt").waitFor(),
    hangman: async () => {
      await page.getByRole("button", { name: /^Q$/i }).waitFor();
      await waitForNoLoadingText(page);
    },
    "image-count": async () => {
      await page.waitForFunction(
        () => {
          const matches = Array.from(document.querySelectorAll("[data-testid]"))
            .map((node) => node.getAttribute("data-testid") ?? "")
            .filter((value) => /^grid-cell-\d+$/.test(value));
          return matches.length > 0;
        },
        undefined,
        { timeout: 20_000 },
      );
      await waitForNoLoadingText(page);
    },
    "letter-shoot": () => page.getByTestId("letter-shoot-board").waitFor(),
    "letter-drop": () => page.getByTestId("letter-drop-stage").waitFor(),
    snake: () => page.getByTestId("snake-board").waitFor(),
  };

  const waitForGame = waiters[gameId];
  if (!waitForGame) {
    throw new Error(`No game ready waiter configured for ${gameId}`);
  }
  await waitForGame();
};

const getLessonSyncModeButton = (page) =>
  page.getByTestId("lesson-header").getByRole("button", { name: /Study|Play/i }).first();

const ensureLessonSyncMode = async (page, targetMode) => {
  const targetPattern = new RegExp(`^${targetMode}$`, "i");
  const modeButton = getLessonSyncModeButton(page);
  await modeButton.waitFor({ timeout: 20_000 });
  for (let attempt = 0; attempt < 4; attempt += 1) {
    const label = (await modeButton.getAttribute("aria-label").catch(() => "")) ?? "";
    if (targetPattern.test(label)) {
      return;
    }
    await modeButton.click();
    await page.waitForTimeout(800);
  }
  throw new Error(`Failed to switch sync mode to ${targetMode}`);
};

const waitForStudentStatusLabel = async (page, labelPattern) => {
  await page.waitForFunction(
    ({ patternSource, patternFlags }) => {
      const matcher = new RegExp(patternSource, patternFlags);
      const labels = Array.from(document.querySelectorAll("button"))
        .map((node) => node.getAttribute("aria-label") ?? node.textContent ?? "")
        .map((value) => value.trim())
        .filter(Boolean);
      return labels.some((value) => matcher.test(value));
    },
    {
      patternSource: labelPattern.source,
      patternFlags: labelPattern.flags,
    },
    { timeout: 20_000 },
  );
};

const setPrimaryStudentOperatorState = async (page, enabled) => {
  await setTeacherStudentsPanelState(page, { open: true, level: "simple" });
  const studentCard = getTeacherStudentsPanelCard(page);
  await studentCard.waitFor({ timeout: 20_000 });
  const toggleButton = studentCard.getByRole("button", {
    name: enabled ? /^Viewer$/i : /^Operator$/i,
  }).first();
  if (await toggleButton.isVisible().catch(() => false)) {
    await toggleButton.click();
    await page.waitForTimeout(1_000);
  }
};

const waitForSharedStartupReady = async (page) => {
  const reachedExpectedUrl = await page
    .waitForURL(/\/shared\/lesson$/, {
      timeout: 20_000,
    })
    .then(() => true)
    .catch(() => false);

  if (reachedExpectedUrl) {
    return;
  }

  await page.getByTestId("lesson-header-class-name").waitFor({ timeout: 20_000 });
  await page.getByTestId("lesson-header-school-name").waitFor({ timeout: 20_000 });
  await page.getByTestId("lesson-header-menu-button").waitFor({ timeout: 20_000 });
};

const isTeacherSessionUiReady = async (page) =>
  page
    .getByRole("button", { name: "TOGGLE STUDENTS" })
    .isVisible()
    .catch(() => false);

const readTeacherSessionLessonId = (page) => {
  const match = page
    .url()
    .match(/\/teacher\/lesson\/([^/]+)\/session(?:\/content\/[^/?]+)?/);
  return match?.[1] ?? null;
};

const normalizeTeacherSessionStatus = (status) =>
  status?.trim().toLowerCase().replace(/[_-]/g, "") ?? null;

const readTeacherSessionStatus = async (page, lessonId) =>
  page.evaluate(
    async ({ targetLessonId }) => {
      const accessToken =
        window.localStorage.getItem("eco:authAccessToken") ??
        window.sessionStorage.getItem("eco:authAccessToken");
      if (!accessToken) {
        return null;
      }

      const response = await fetch(
        `/api/sessions/${encodeURIComponent(targetLessonId)}`,
        {
          headers: {
            Authorization: `Bearer ${accessToken}`,
          },
        },
      );
      if (!response.ok) {
        return null;
      }

      const contentType = response.headers.get("content-type") ?? "";
      const responseText = await response.text();
      if (!contentType.includes("application/json")) {
        return null;
      }

      try {
        const json = JSON.parse(responseText);
        return json.session?.status ?? null;
      } catch {
        return null;
      }
    },
    { targetLessonId: lessonId },
  );

const hasTeacherLessonStarted = async (page) => {
  const lessonId = readTeacherSessionLessonId(page);
  if (!lessonId) {
    return false;
  }

  let searchParams;
  try {
    searchParams = new URL(page.url()).searchParams;
  } catch {
    return false;
  }

  const startupPending = searchParams.get("startup") === "start";
  const sessionStatus = await readTeacherSessionStatus(page, lessonId);

  if (sessionStatus === null) {
    return (
      !startupPending &&
      ((await isTeacherSessionUiReady(page)) ||
        /\/teacher\/lesson\/[^/]+\/session(?:\/content\/[^/?]+)?\/?(?:\?.*)?$/.test(
          page.url(),
        ))
    );
  }

  return (
    !startupPending &&
    normalizeTeacherSessionStatus(sessionStatus) === "inprogress"
  );
};

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

const truncateJoinDiagnosticText = (value, maxLength = 400) =>
  value.length > maxLength ? `${value.slice(0, maxLength)}...` : value;

const isJoinDiagnosticResponse = (response) => {
  const url = response.url();
  if (url.includes("/api/lessons/startup")) {
    return true;
  }

  if (!url.includes("/graphql")) {
    return false;
  }

  const requestBody = response.request().postData() ?? "";
  return (
    requestBody.includes("LessonPresence") ||
    requestBody.includes("LessonSession")
  );
};

const createJoinNetworkCollector = (page) => {
  const events = [];

  const handleResponse = async (response) => {
    if (!isJoinDiagnosticResponse(response)) {
      return;
    }

    let responseBody = "";
    try {
      responseBody = truncateJoinDiagnosticText(await response.text());
    } catch (error) {
      responseBody =
        error instanceof Error
          ? `(response body read failed) ${error.message}`
          : "(response body read failed)";
    }

    events.push({
      url: response.url(),
      method: response.request().method(),
      status: response.status(),
      requestBody: truncateJoinDiagnosticText(
        response.request().postData() ?? "",
      ),
      responseBody,
    });
  };

  page.on("response", handleResponse);

  return {
    events,
    stop: () => {
      page.off("response", handleResponse);
    },
  };
};

const readLessonJoinDialogState = async (page) => {
  const dialog = page.getByTestId("enter-lesson-dialog");
  const joinButton = dialog.getByTestId("enter-lesson-submit-button");
  const alert = page.getByRole("alert").first();
  const joinVisible = await joinButton.isVisible().catch(() => false);
  const alertVisible = await alert.isVisible().catch(() => false);
  const dialogVisible = await dialog.isVisible().catch(() => false);

  return {
    url: page.url(),
    joinVisible,
    joinEnabled: joinVisible
      ? await joinButton.isEnabled().catch(() => false)
      : false,
    alertText: alertVisible
      ? ((await alert.textContent({ timeout: 1_000 }).catch(() => "")) ?? "").trim()
      : "",
    dialogText: dialogVisible
      ? ((await dialog.textContent({ timeout: 1_000 }).catch(() => "")) ?? "").trim()
      : "",
  };
};

const formatJoinAttempts = (attempts) =>
  attempts
    .map((attempt) =>
      [
        `attempt: ${attempt.attempt}`,
        `mode: ${attempt.mode}`,
        `url: ${attempt.url}`,
        `joinVisible: ${attempt.joinVisible}`,
        `joinEnabled: ${attempt.joinEnabled}`,
        `alert: ${attempt.alertText || "(empty)"}`,
        `dialog: ${attempt.dialogText || "(empty)"}`,
      ].join("\n"),
    )
    .join("\n\n");

const formatJoinNetworkEvents = (events, limit = 12) =>
  events
    .slice(-limit)
    .map((event, index) =>
      [
        `[${index + 1}] ${event.method} ${event.url}`,
        `status: ${event.status}`,
        `request: ${event.requestBody || "(empty)"}`,
        `response: ${event.responseBody || "(empty)"}`,
      ].join("\n"),
    )
    .join("\n\n");

const isTerminalJoinAlert = (alertText) =>
  Boolean(
    alertText &&
      (
        alertText.includes("You already have this lesson open in another window.") ||
        alertText.includes("This Lesson Has Finished.") ||
        alertText.includes("Failed To Enter Lesson.")
      ),
  );

const reopenJoinDialog = async (page, mode) => {
  const closeButton = page.getByRole("button", { name: "Close Enter Lesson" });
  const dialog = page.getByTestId("enter-lesson-dialog");

  if (await closeButton.isVisible().catch(() => false)) {
    await closeButton.click();
  } else {
    await page.keyboard.press("Escape").catch(() => {});
  }
  await dialog.waitFor({ state: "hidden", timeout: 10_000 }).catch(() => {});
  await page.reload({ waitUntil: "domcontentloaded" });

  if (mode === "home") {
    await waitForHomeStartupReady(page);
  } else {
    await waitForSharedStartupReady(page);
  }

  await openStartupMenuAction(page, "Enter Lesson");
  await dialog.waitFor({ state: "visible", timeout: 10_000 });
};

const truncateTeacherStartDiagnosticText = (value, maxLength = 800) =>
  value.length > maxLength ? `${value.slice(0, maxLength)}...` : value;

const isTeacherStartDiagnosticResponse = (response) => {
  const url = response.url();
  return /\/api\/sessions\/[^/]+(?:\/start)?$/.test(url);
};

const createTeacherStartNetworkCollector = (page) => {
  const events = [];
  const startedAt = Date.now();

  const handleRequest = (request) => {
    const url = request.url();
    if (!/\/api\/sessions\/[^/]+(?:\/start)?$/.test(url)) {
      return;
    }

    events.push({
      phase: "request",
      elapsedMs: Date.now() - startedAt,
      url,
      method: request.method(),
      requestBody: truncateTeacherStartDiagnosticText(request.postData() ?? ""),
    });
  };

  const handleResponse = async (response) => {
    if (!isTeacherStartDiagnosticResponse(response)) {
      return;
    }

    let responseBody = "";
    try {
      responseBody = truncateTeacherStartDiagnosticText(await response.text());
    } catch (error) {
      responseBody =
        error instanceof Error
          ? `(response body read failed) ${error.message}`
          : "(response body read failed)";
    }

    events.push({
      phase: "response",
      elapsedMs: Date.now() - startedAt,
      url: response.url(),
      method: response.request().method(),
      status: response.status(),
      requestBody: truncateTeacherStartDiagnosticText(
        response.request().postData() ?? "",
      ),
      responseBody,
    });
  };

  page.on("request", handleRequest);
  page.on("response", handleResponse);

  return {
    events,
    stop: () => {
      page.off("request", handleRequest);
      page.off("response", handleResponse);
    },
  };
};

const dismissTeacherStartupDialogIfPresent = async (page) => {
  const closeOtherWindowDialog = page.getByRole("dialog", {
    name: /Close Other Window/i,
  });
  const declineCloseOtherWindowButton = closeOtherWindowDialog.getByRole(
    "button",
    { name: /^No$/i },
  );
  const closeHostCloseRequestButton = page.getByRole("button", {
    name: /Close Host Close Request/i,
  });
  const closeButton = page.getByRole("button", { name: "Close Start Lesson" });
  const dialog = page.getByRole("dialog");

  if (await declineCloseOtherWindowButton.isVisible().catch(() => false)) {
    await declineCloseOtherWindowButton.click();
    await closeOtherWindowDialog
      .waitFor({ state: "hidden", timeout: 10_000 })
      .catch(() => {});
  } else if (await closeHostCloseRequestButton.isVisible().catch(() => false)) {
    await closeHostCloseRequestButton.click();
  }

  const closeVisible = await closeButton.isVisible().catch(() => false);

  if (closeVisible) {
    await closeButton.click();
    await dialog.waitFor({ state: "hidden", timeout: 10_000 }).catch(() => {});
    return;
  }

  const dialogVisible = await dialog.isVisible().catch(() => false);
  if (!dialogVisible) {
    return;
  }

  await page.keyboard.press("Escape").catch(() => {});
  await dialog.waitFor({ state: "hidden", timeout: 10_000 }).catch(() => {});
};

const expectSessionReady = async (page, mode) => {
  const sessionRoutePattern = new RegExp(
    `/${mode}/lesson/[^/]+/session(?:/content/[^/?]+)?/?(?:\\?.*)?$`,
  );

  const reachedSessionRoute = await page
    .waitForURL(sessionRoutePattern, { timeout: 20_000 })
    .then(() => true)
    .catch(() => false);
  if (!reachedSessionRoute) {
    if (!(mode === "teacher" && (await isTeacherSessionUiReady(page)))) {
      await page.getByRole("button", { name: "TOGGLE STUDENTS" }).waitFor({
        timeout: 10_000,
      });
      await page.getByRole("heading", { name: /Student Card/i }).waitFor({
        timeout: 10_000,
      });
    }
  }

  await page.getByTestId("lesson-header").waitFor({ timeout: 20_000 }).catch(() => {});
  await page.getByTestId("student-card-content-root").waitFor({
    timeout: 20_000,
  }).catch(() => {});
  await waitForNoLoadingText(page);
};

const waitUntilJoinReady = async (page, mode) => {
  const attempts = [];
  const { events, stop } = createJoinNetworkCollector(page);
  await openStartupMenuAction(page, "Enter Lesson");
  await page.getByTestId("enter-lesson-dialog").waitFor({ state: "visible" });

  try {
    for (let attempt = 0; attempt < joinReadyAttempts; attempt += 1) {
      const state = await readLessonJoinDialogState(page);
      attempts.push({ attempt, mode, ...state });

      if (state.joinVisible && state.joinEnabled) {
        return;
      }

      if (isTerminalJoinAlert(state.alertText)) {
        throw new Error(
          `[${mode} join blocked] ${formatJoinAttempts(attempts)}\n\nnetwork:\n${formatJoinNetworkEvents(
            events,
          )}`,
        );
      }

      if (
        attempt > 0 &&
        attempt % joinDialogReopenInterval === 0 &&
        !state.joinEnabled
      ) {
        await reopenJoinDialog(page, mode);
      } else {
        await page.waitForTimeout(joinReadyRetryDelayMs);
      }
    }

    throw new Error(
      `[${mode} join remained disabled] ${formatJoinAttempts(attempts)}\n\nnetwork:\n${formatJoinNetworkEvents(
        events,
      )}`,
    );
  } finally {
    stop();
  }
};

const enterHomeLessonSession = async (page) => {
  await waitUntilJoinReady(page, "home");
  await confirmLessonEntry(page, "Join");
  await expectSessionReady(page, "home");
};

const enterSharedLessonSession = async (page) => {
  await waitUntilJoinReady(page, "shared");
  await confirmLessonEntry(page, "Join");
  await expectSessionReady(page, "shared");
};

const ensureTeacherSession = async (page) => {
  const { events, stop } = createTeacherStartNetworkCollector(page);

  try {
    for (let attempt = 0; attempt < 10; attempt += 1) {
      const isOnTeacherSessionRoute =
        /\/teacher\/lesson\/[^/]+\/session(?:\/content\/[^/?]+)?\/?(?:\?.*)?$/.test(
          page.url(),
        );
      if (
        ((await isTeacherSessionUiReady(page)) || isOnTeacherSessionRoute) &&
        (await hasTeacherLessonStarted(page))
      ) {
        break;
      }

      const startButton = page.getByRole("button", { name: /^Start$/i });
      if (
        (await startButton.isVisible().catch(() => false)) &&
        (await startButton.first().isEnabled().catch(() => false))
      ) {
        await confirmLessonEntry(page, "Start");
      } else {
        const joinButton = page.getByRole("button", { name: /^Join$/i });
        if (
          (await joinButton.isVisible().catch(() => false)) &&
          (await joinButton.first().isEnabled().catch(() => false))
        ) {
          await confirmLessonEntry(page, "Join");
        } else if (/\/teacher\/lesson$/.test(page.url())) {
          await dismissTeacherStartupDialogIfPresent(page);
          await page.getByTestId("lesson-header-menu-button").click();
          const joinLessonAction = page.getByRole("button", {
            name: "Join Lesson",
          });
          if (await joinLessonAction.isVisible().catch(() => false)) {
            await joinLessonAction.click();
          } else {
            await page.getByRole("button", { name: "Start Lesson" }).click();
          }
          await page.waitForTimeout(500);
        }
      }

      if (
        ((await isTeacherSessionUiReady(page)) ||
          /\/teacher\/lesson\/[^/]+\/session(?:\/content\/[^/?]+)?\/?(?:\?.*)?$/.test(
            page.url(),
          )) &&
        (await hasTeacherLessonStarted(page))
      ) {
        break;
      }

      if (
        /\/teacher\/lesson\/[^/]+\/session(?:\/content\/[^/?]+)?\/?(?:\?.*)?$/.test(
          page.url(),
        )
      ) {
        await page.reload({ waitUntil: "domcontentloaded" });
      }
      await page.waitForTimeout(3_000);
    }

    await expectSessionReady(page, "teacher");
    for (let attempt = 0; attempt < 10; attempt += 1) {
      if (await hasTeacherLessonStarted(page)) {
        return;
      }
      await page.waitForTimeout(3_000);
    }
    throw new Error("teacher lesson did not reach inProgress state");
  } catch (error) {
    error.message = `${error.message}\n\nteacher-start-network:\n${events
      .map((event, index) =>
        [
          `[${index + 1}] +${event.elapsedMs}ms ${String(event.phase).toUpperCase()} ${event.method} ${event.url}`,
          `status: ${event.status ?? "(pending)"}`,
          `request: ${event.requestBody || "(empty)"}`,
          `response: ${event.responseBody || "(empty)"}`,
        ].join("\n"),
      )
      .join("\n\n")}`;
    throw error;
  } finally {
    stop();
  }
};

const ensureHomeSessionByLessonId = async (page, lessonId) => {
  await page.goto(`${baseUrl}/home/lesson/${lessonId}/session?mode=appsync`, {
    waitUntil: "domcontentloaded",
  });
  await waitForPageReady(page);
  await waitForCaptureReady(page, "home-lesson");
};

const ensureSharedSessionByLessonId = async (page, lessonId) => {
  await page.goto(`${baseUrl}/shared/lesson/${lessonId}/session?mode=appsync`, {
    waitUntil: "domcontentloaded",
  });
  await waitForPageReady(page);
  await expectSessionReady(page, "shared");
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

  for (let attempt = 0; attempt < 6; attempt += 1) {
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
        return (
          cards.some((value) => /^student-[^-].*-card$/u.test(value)) &&
          (
            !cards.some((value) => value.includes("today-score-input")) ||
            document.querySelector('[data-progress-anchor="true"]') !== null ||
            /Progress|Homework/i.test(document.body.innerText)
          )
        );
      }
      return false;
    }, level);

    if (matched) {
      return;
    }

    await levelButton.click();
    await page.waitForTimeout(level === "progress" ? 1_200 : 700);
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

const resolveDeviceModeForPath = (gotoPath) => {
  if (gotoPath === "/teacher") {
    return "teacher";
  }
  if (gotoPath === "/shared") {
    return "shared";
  }
  return "home";
};

const applyAppContextForPath = async (page, gotoPath, options = {}) => {
  const deviceMode = resolveDeviceModeForPath(gotoPath);
  const classId = options.classId ?? fixturePrimaryClassId;
  const studentId = options.studentId === undefined
    ? fixturePrimaryStudentId
    : options.studentId;
  await page.evaluate(
    ({ deviceMode, classId, studentId }) => {
      window.localStorage.setItem("eco:deviceMode", deviceMode);
      if (classId != null) {
        window.localStorage.setItem("eco:selectedClassId", classId);
      } else {
        window.localStorage.removeItem("eco:selectedClassId");
      }
      if (deviceMode === "home" && studentId != null) {
        window.localStorage.setItem("eco:selectedStudentId", studentId);
      } else if (deviceMode === "home") {
        window.localStorage.removeItem("eco:selectedStudentId");
      }
      if (deviceMode === "shared" && studentId != null) {
        window.sessionStorage.setItem("eco:sharedCurrentStudentId", studentId);
      } else if (deviceMode === "shared") {
        window.sessionStorage.removeItem("eco:sharedCurrentStudentId");
      }
    },
    {
      deviceMode,
      classId,
      studentId,
    },
  );
};

const navigateAfterBrowserLogin = async (page, gotoPath, options = {}) => {
  const hasAccessToken = await page.evaluate(
    () =>
      typeof window.localStorage.getItem("eco:authAccessToken") === "string" &&
      window.localStorage.getItem("eco:authAccessToken").length > 0,
  );

  if (!hasAccessToken) {
    return;
  }

  await applyAppContextForPath(page, gotoPath, options);

  await page.goto(`${baseUrl}${gotoPath}`, { waitUntil: "domcontentloaded" });
};

const openTeacherStartupPage = async (page) => {
  await applyAppContextForPath(page, "/teacher");
  await page.goto(`${baseUrl}/teacher/lesson`, { waitUntil: "domcontentloaded" });
  await waitForPageReady(page);
  await waitForTeacherStartupReady(page);
};

const toTitleCase = (value) =>
  value.charAt(0).toUpperCase() + value.slice(1).toLowerCase();

const selectPreviewScope = async (page, { color, unit }) => {
  const desiredUnitLabel = `Unit ${unit}`;
  const desiredColorLabel = toTitleCase(color).toUpperCase();
  const currentUnit = (await page.getByTestId("lesson-header-unit").first().innerText().catch(() => ""))
    .replace(/\s+/g, " ")
    .trim();
  const currentColor = (
    await page.getByTestId("lesson-header-level-color").first().innerText().catch(() => "")
  )
    .replace(/\s+/g, " ")
    .trim()
    .toUpperCase();

  if (currentUnit === desiredUnitLabel && currentColor === desiredColorLabel) {
    return;
  }

  await page.getByTestId("lesson-header-level-color").first().click();
  await page.getByText(toTitleCase(color), { exact: true }).last().click();
  await page.getByText(desiredUnitLabel, { exact: true }).last().click();
  await page.waitForFunction(
    ({ colorLabel, unitLabel }) => {
      const colorNode = document.querySelector('[data-testid="lesson-header-level-color"]');
      const unitNode = document.querySelector('[data-testid="lesson-header-unit"]');
      const currentColor = (colorNode?.textContent ?? "").replace(/\s+/g, " ").trim().toUpperCase();
      const currentUnit = (unitNode?.textContent ?? "").replace(/\s+/g, " ").trim();
      return currentColor === colorLabel && currentUnit === unitLabel;
    },
    { colorLabel: desiredColorLabel, unitLabel: desiredUnitLabel },
    { timeout: 20_000 },
  );
};

const openTeacherPreviewGamesPage = async (page, target) => {
  await applyAppContextForPath(page, "/teacher");
  await page.goto(`${baseUrl}/teacher/lesson`, { waitUntil: "domcontentloaded" });
  await waitForPageReady(page);
  await selectPreviewScope(page, {
    color: target.previewColor,
    unit: target.previewUnit,
  });
  await page.getByTestId("lesson-header-menu-button").click();
  await page.getByRole("button", { name: /^Games$/i }).click();
  await page.waitForFunction(
    () => {
      const text = document.body.innerText.replace(/\s+/g, " ").trim();
      return /Homework Games|Classroom Games/i.test(text);
    },
    undefined,
    { timeout: 20_000 },
  );
};

const openGameFromGameCenter = async (page, target) => {
  await openTeacherPreviewGamesPage(page, target);
  await page.getByText(target.gameCenterTitle, { exact: true }).first().click();
  await page.getByTestId("lesson-header").waitFor();
  await waitForGameContentReady(page, target.gameId);
};

const openSharedStartupPage = async (page) => {
  await applyAppContextForPath(page, "/shared");
  await page.goto(`${baseUrl}/shared/lesson`, { waitUntil: "domcontentloaded" });
  await waitForPageReady(page);
  await waitForSharedStartupReady(page);
};

const loginAs = async (page, email, gotoPath, options = {}) => {
  await page.goto(`${baseUrl}${gotoPath}`, { waitUntil: "domcontentloaded" });
  await waitForPageReady(page);
  if (/\/login\b/.test(page.url())) {
    await page.locator('input[type="email"]').fill(email);
    await page.locator('input[type="password"]').fill(password);
    await page.locator('button[type="submit"]').click();
    await page.waitForTimeout(2_000);
    if (/\/login\b/.test(page.url())) {
      await navigateAfterBrowserLogin(page, gotoPath, options);
    }
    const postLoginUrlMap = {
      "/teacher": /\/select-class$|\/teacher\/lesson$/,
      "/home": /\/switch-student$|\/home\/lesson$/,
      "/shared": /\/select-class$|\/select-student$|\/shared\/lesson$/,
    };
    const postLoginUrl = postLoginUrlMap[gotoPath];
    if (postLoginUrl) {
      await page.waitForURL(postLoginUrl, { timeout: 30_000 });
    }
    await applyAppContextForPath(page, gotoPath, options);
    await waitForPageReady(page);
  }

  if (gotoPath === "/teacher") {
    if (/\/select-class$/.test(page.url())) {
      return;
    }
    await waitForTeacherStartupReady(page);
    return;
  }

  if (gotoPath === "/home") {
    await waitForHomeStartupReady(page);
    return;
  }

  if (/\/select-class$/.test(page.url())) {
    return;
  }

  if (/\/select-student$/.test(page.url())) {
    await waitForSharedStudentSelectionReady(page);
    return;
  }

  await waitForSharedStartupReady(page);
};

const parentFlow = async (browser, report) => {
  const context = await createManualCaptureContext(browser, {
    viewport: { width: 1440, height: 1400 },
  });
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
    await page.waitForTimeout(2_000);
    if (/\/login\b/.test(page.url())) {
      await navigateAfterBrowserLogin(page, "/home");
    }
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

  await runStep(report, "parent:restricted-shared", async () => {
    await page.goto(`${baseUrl}/shared`, { waitUntil: "domcontentloaded" });
    await waitForPageReady(page);
    await capturePage({
      page,
      pageSpec: getPageSpec("restricted"),
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
  const context = await createManualCaptureContext(browser, {
    viewport: { width: 1440, height: 1400 },
  });
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
    if (/\/select-class$/.test(page.url())) {
      const selectButton = page.getByRole("button", { name: /^Select$/i });
      if (
        (await selectButton.isVisible().catch(() => false)) &&
        (await selectButton.isEnabled().catch(() => false))
      ) {
        await selectButton.click();
        await waitForPageReady(page);
      }
    }
    if (!/\/teacher\/lesson(?:$|\?)/.test(page.url())) {
      await openTeacherStartupPage(page);
    }
    await capturePage({
      page,
      pageSpec: getPageSpec("teacher-startup"),
      report,
    });
  });

  await context.close();
};

const sharedFlow = async (browser, report) => {
  const context = await createManualCaptureContext(browser, {
    viewport: { width: 1440, height: 1400 },
  });
  const page = await context.newPage();

  await runStep(report, "shared:select-class", async () => {
    await loginAs(page, teacherEmail, "/shared", { studentId: null });
    await capturePage({
      page,
      pageSpec: getPageSpec("shared-select-class"),
      report,
    });
  });

  await runStep(report, "shared:select-student", async () => {
    await page.getByRole("button", { name: /^Select$/i }).click();
    await waitForPageReady(page);
    await applyAppContextForPath(page, "/shared", { studentId: null });
    await page.goto(`${baseUrl}/select-student`, { waitUntil: "domcontentloaded" });
    await waitForPageReady(page);
    await capturePage({
      page,
      pageSpec: getPageSpec("shared-select-student"),
      report,
    });
  });

  await runStep(report, "shared:startup", async () => {
    if (/\/select-student$/.test(page.url())) {
      const selectButton = page.getByRole("button", { name: /^Select$/i });
      if (
        (await selectButton.isVisible().catch(() => false)) &&
        (await selectButton.isEnabled().catch(() => false))
      ) {
        await selectButton.click();
        await waitForPageReady(page);
      }
    }
    if (!/\/shared\/lesson(?:$|\?)/.test(page.url())) {
      await openSharedStartupPage(page);
    }
    await capturePage({
      page,
      pageSpec: getPageSpec("shared-startup"),
      report,
    });
  });

  await runStep(report, "shared:mypage", async () => {
    await page.goto(`${baseUrl}/mypage`, { waitUntil: "domcontentloaded" });
    await waitForPageReady(page);
    await capturePage({
      page,
      pageSpec: getPageSpec("shared-mypage"),
      report,
    });
  });

  await context.close();
};

const lessonFlow = async (browser, report) => {
  const teacherContext = await createManualCaptureContext(browser, {
    viewport: { width: 1440, height: 1400 },
  });
  const homeContext = await createManualCaptureContext(browser, {
    viewport: { width: 1440, height: 1400 },
  });
  const sharedContext = await createManualCaptureContext(browser, {
    viewport: { width: 1440, height: 1400 },
  });
  const teacherPage = await teacherContext.newPage();
  const homePage = await homeContext.newPage();
  const sharedPage = await sharedContext.newPage();

  let lessonId = null;

  await runStep(report, "lesson:teacher-session", async () => {
    await loginAs(teacherPage, teacherEmail, "/teacher");
    if (/\/select-class$/.test(teacherPage.url())) {
      await waitForCaptureReady(teacherPage, "teacher-select-class");
      await teacherPage.getByRole("button", { name: /^Select$/i }).click();
      await waitForPageReady(teacherPage);
    }
    try {
      await ensureTeacherSession(teacherPage);
      lessonId = extractLessonId(teacherPage.url());
    } catch (error) {
      if (!fixtureLessonId) {
        throw error;
      }
      console.warn(
        `[manual-capture] lesson:teacher-session fallback to fixture lesson ${fixtureLessonId}`,
      );
      lessonId = fixtureLessonId;
      await teacherPage.goto(
        `${baseUrl}/teacher/lesson/${lessonId}/session/content/student-card?mode=appsync`,
        { waitUntil: "domcontentloaded" },
      );
      await waitForPageReady(teacherPage);
      await expectSessionReady(teacherPage, "teacher");
    }
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
      try {
        await enterHomeLessonSession(homePage);
      } catch (error) {
        console.warn(
          `[manual-capture] lesson:home-session fallback to direct lesson ${lessonId}`,
        );
        await ensureHomeSessionByLessonId(homePage, lessonId);
      }
      await capturePage({
        page: homePage,
        pageSpec: getPageSpec("home-lesson"),
        report,
      });
    });

    await runStep(report, "lesson:shared-session", async () => {
      await loginAs(sharedPage, teacherEmail, "/shared");
      if (/\/select-class$/.test(sharedPage.url())) {
        await sharedPage.getByRole("button", { name: /^Select$/i }).click();
        await waitForPageReady(sharedPage);
      }
      if (/\/select-student$/.test(sharedPage.url())) {
        await sharedPage.getByRole("button", { name: /^Select$/i }).click();
        await waitForPageReady(sharedPage);
      }
      try {
        await enterSharedLessonSession(sharedPage);
      } catch (error) {
        console.warn(
          `[manual-capture] lesson:shared-session fallback to direct lesson ${lessonId}`,
        );
        await ensureSharedSessionByLessonId(sharedPage, lessonId);
      }
      await capturePage({
        page: sharedPage,
        pageSpec: getPageSpec("shared-lesson"),
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

    await runStep(report, "lesson:student-study-player", async () => {
      await teacherPage.goto(
        `${baseUrl}/teacher/lesson/${lessonId}/session/content/student-card?mode=appsync`,
        { waitUntil: "domcontentloaded" },
      );
      await waitForPageReady(teacherPage);
      await ensureLessonSyncMode(teacherPage, "Study");
      await setPrimaryStudentOperatorState(teacherPage, true);

      await ensureHomeSessionByLessonId(homePage, lessonId);
      await capturePage({
        page: homePage,
        pageSpec: getPageSpec("home-lesson-study-player"),
        report,
      });

      await ensureSharedSessionByLessonId(sharedPage, lessonId);
      await capturePage({
        page: sharedPage,
        pageSpec: getPageSpec("shared-lesson-study-player"),
        report,
      });
    });

    await runStep(report, "lesson:play-mode", async () => {
      await teacherPage.goto(
        `${baseUrl}/teacher/lesson/${lessonId}/session/content/student-card?mode=appsync`,
        { waitUntil: "domcontentloaded" },
      );
      await waitForPageReady(teacherPage);
      await ensureLessonSyncMode(teacherPage, "Play");
      await capturePage({
        page: teacherPage,
        pageSpec: getPageSpec("teacher-lesson-play"),
        report,
      });

      await ensureHomeSessionByLessonId(homePage, lessonId);
      await capturePage({
        page: homePage,
        pageSpec: getPageSpec("home-lesson-play"),
        report,
      });

      await ensureSharedSessionByLessonId(sharedPage, lessonId);
      await capturePage({
        page: sharedPage,
        pageSpec: getPageSpec("shared-lesson-play"),
        report,
      });
    });

    await runStep(report, "lesson:teacher-panel-xs", async () => {
      const xsContext = await createManualCaptureContext(browser, {
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

    await runStep(report, "lesson:teacher-games-individual", async () => {
      for (const target of lessonGameTargets) {
        await openGameFromGameCenter(teacherPage, target);
        await capturePage({
          page: teacherPage,
          pageSpec: getPageSpec(target.slug),
          report,
        });
      }
    }, { timeoutMs: 180_000 });

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

  await Promise.allSettled([teacherContext.close(), homeContext.close(), sharedContext.close()]);
};

const generateDocs = async () => {
  const version = await loadVersion();
  const fixtureOnly =
    process.env.MANUAL_GENERATE_FIXTURE_ONLY === "1" ||
    process.env.MANUAL_GENERATE_FIXTURE_ONLY === "true";
  const markdownOnly =
    process.env.MANUAL_GENERATE_MARKDOWN_ONLY === "1" ||
    process.env.MANUAL_GENERATE_MARKDOWN_ONLY === "true";
  const report = {
    capturedItems: [],
    failedItems: [],
    generatedPages: [],
    baseUrl,
    apiGatewayBaseUrl,
    generatedAt: new Date().toISOString(),
    fixtureLessonId,
    fixturePrimaryClassId,
    fixturePrimaryStudentId,
    fixtureSummaryPath,
    trackedFixtureSummaryPath,
    lockPath: allowParallelManualCapture ? null : manualCaptureLockPath,
    flags: {
      fixtureOnly,
      markdownOnly,
      allowParallelManualCapture,
      pageFilter: [...manualGeneratePageFilter],
    },
  };
  if (fixtureOnly && markdownOnly) {
    throw new Error(
      "MANUAL_GENERATE_FIXTURE_ONLY and MANUAL_GENERATE_MARKDOWN_ONLY cannot both be enabled.",
    );
  }
  logRunContext({
    script: "generate-initial-manual",
    baseUrl,
    apiGatewayBaseUrl,
    fixtureLessonId,
    fixturePrimaryClassId,
    fixturePrimaryStudentId,
    flowStepTimeoutMs,
    flags: report.flags,
  });
  const releaseLock = await acquireManualCaptureLock("generate-initial-manual");
  const existingPageImages = new Set();
  try {
    for (const pageSpec of pageSpecs) {
      try {
        await access(path.join(imagesRoot, pageSpec.imageName));
        existingPageImages.add(pageSpec.slug);
      } catch (error) {
        if (!error || typeof error !== "object" || !("code" in error) || error.code !== "ENOENT") {
          throw error;
        }
      }
    }

    if (fixtureOnly) {
      await ensureOutputDirs();
      if (fixtureSummary) {
        await writeFile(
          path.join(docsRoot, "ja", "manual", "test-users.md"),
          renderFixtureManual({ version, lang: "ja" }),
          "utf8",
        );
        await writeFile(
          path.join(docsRoot, "en", "manual", "test-users.md"),
          renderFixtureManual({ version, lang: "en" }),
          "utf8",
        );
        report.generatedPages.push("test-users");
      }
      report.completedAt = new Date().toISOString();
      await writeLastRunReport(report);
      await validateGeneratedDocs({
        reusedExistingImages: true,
        reusedAssets: ["fixture-only markdown output"],
      });
      return;
    }

    if (markdownOnly) {
      await ensureOutputDirs();
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

      await writeFile(
        path.join(docsRoot, "_config.yml"),
        renderConfig(),
        "utf8",
      );
      await writeFile(
        path.join(docsRoot, "index.md"),
        renderRootIndex(),
        "utf8",
      );
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
      if (fixtureSummary) {
        await writeFile(
          path.join(docsRoot, "ja", "manual", "test-users.md"),
          renderFixtureManual({ version, lang: "ja" }),
          "utf8",
        );
        await writeFile(
          path.join(docsRoot, "en", "manual", "test-users.md"),
          renderFixtureManual({ version, lang: "en" }),
          "utf8",
        );
        report.generatedPages.push("test-users");
      }
      report.completedAt = new Date().toISOString();
      await writeLastRunReport(report);
      await validateGeneratedDocs({
        reusedExistingImages: true,
        reusedAssets: ["markdown-only output"],
      });
      return;
    }

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
  if (fixtureSummary) {
    await writeFile(
      path.join(docsRoot, "ja", "manual", "test-users.md"),
      renderFixtureManual({ version, lang: "ja" }),
      "utf8",
    );
  }
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
  if (fixtureSummary) {
    await writeFile(
      path.join(docsRoot, "en", "manual", "test-users.md"),
      renderFixtureManual({ version, lang: "en" }),
      "utf8",
    );
  }
    report.completedAt = new Date().toISOString();
    await writeLastRunReport(report);
    const capturedPages = new Set(report.capturedPages ?? []);
    const reusedAssets = pageSpecs
      .filter((pageSpec) => existingPageImages.has(pageSpec.slug) && !capturedPages.has(pageSpec.slug))
      .map((pageSpec) => pageSpec.slug);
    await validateGeneratedDocs({
      reusedExistingImages: reusedAssets.length > 0,
      reusedAssets,
    });
  } finally {
    await releaseLock();
  }
};

await generateDocs();
