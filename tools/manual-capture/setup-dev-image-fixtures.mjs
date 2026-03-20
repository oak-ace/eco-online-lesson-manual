#!/usr/bin/env node

import path from "node:path";
import { randomUUID } from "node:crypto";
import { fileURLToPath } from "node:url";
import { execFile } from "node:child_process";
import { mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { promisify } from "node:util";
import { chromium } from "playwright";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(__dirname, "..", "..");
const stateDir = path.join(__dirname, ".state");
const artifactDir = path.join(__dirname, ".artifacts");
const docsDir = path.join(repoRoot, "docs", "ja", "manual");
const defaultConfigPath = path.join(
  __dirname,
  "dev-image-fixtures.config.json",
);
const defaultStatePath = path.join(stateDir, "dev-image-fixtures.state.json");
const manualOutputPath = path.join(docsDir, "test-users.md");
const summaryOutputPath = path.join(
  artifactDir,
  "dev-image-fixtures-summary.json",
);
const defaultAvatarCatalogBaseUrl =
  process.env.ECO_AVATAR_ASSET_BASE_URL ??
  process.env.VITE_ASSET_BASE_URL ??
  process.env.ECO_ASSET_BASE_URL ??
  "https://avatars.eco-online.site";
const defaultAvatarManifestPath = "/v1/avatars/manifest.json";
const defaultAwsRegion =
  process.env.AWS_REGION ??
  process.env.ECO_COGNITO_REGION ??
  "ap-northeast-1";
const defaultCognitoUserPoolId =
  process.env.ECO_COGNITO_USER_POOL_ID ??
  process.env.VITE_COGNITO_USER_POOL_ID ??
  "";
const defaultDynamoTableName =
  process.env.ECO_DYNAMODB_TABLE_PRIMARY ?? "eco-online";
const execFileAsync = promisify(execFile);
const medalLevels = [
  { level: 5, minPoints: 400 },
  { level: 4, minPoints: 300 },
  { level: 3, minPoints: 200 },
  { level: 2, minPoints: 100 },
  { level: 1, minPoints: 0 },
];
const jstFormatter = new Intl.DateTimeFormat("en-CA", {
  timeZone: "Asia/Tokyo",
  year: "numeric",
  month: "2-digit",
  day: "2-digit",
});

const usage = `Usage:
  npm run setup:image-fixtures -- <command> [--config path] [--state path]

Commands:
  init                 Create or reuse fixture students/classes and set initial state
  teacher-mode <mode>  Switch teacher class assignment: none | single | multi
  student-mode <mode>  Switch student class assignment: none | single | multi
  status               Print managed fixture state

Config:
  Copy tools/manual-capture/dev-image-fixtures.config.example.json to
  tools/manual-capture/dev-image-fixtures.config.json and edit it.

Auth:
  Set ECO_API_TEST_BEARER_TOKEN to use a direct bearer token, or set:
  - ECO_SETUP_EMAIL
  - ECO_SETUP_PASSWORD
  The login account must be allowed to call the admin/system APIs.
`;

const studentParentGroups = [
  "parent-a",
  "parent-a",
  "parent-a",
  "parent-b",
  "parent-b",
  "parent-c",
  "parent-d",
  "parent-e",
];

const studentInitialProfiles = [
  { targetPoints: 40, targetCoins: 12 },
  { targetPoints: 90, targetCoins: 14 },
  { targetPoints: 120, targetCoins: 16 },
  { targetPoints: 180, targetCoins: 18 },
  { targetPoints: 220, targetCoins: 20 },
  { targetPoints: 280, targetCoins: 22 },
  { targetPoints: 340, targetCoins: 24 },
  { targetPoints: 420, targetCoins: 26 },
];

const managedClassTemplates = [
  {
    key: "primary",
    suffix: "Primary",
    level: "blue",
    calendarColor: "#4F8EF7",
    startTime: "16:00",
    duration: 45,
  },
  {
    key: "secondary",
    suffix: "Secondary",
    level: "green",
    calendarColor: "#26A269",
    startTime: "17:00",
    duration: 45,
  },
  {
    key: "tertiary",
    suffix: "Tertiary",
    level: "orange",
    calendarColor: "#F39C12",
    startTime: "18:00",
    duration: 45,
  },
];

const avatarBackgroundPalette = [
  { key: "red", hex: "#E74C3C" },
  { key: "pink", hex: "#E91E63" },
  { key: "blue", hex: "#4F8EF7" },
  { key: "orange", hex: "#F39C12" },
  { key: "green", hex: "#26A269" },
  { key: "brown", hex: "#8D6E63" },
  { key: "purple", hex: "#9B59B6" },
  { key: "yellow", hex: "#F1C40F" },
];

const parseArgs = (argv) => {
  const args = [...argv];
  const positionals = [];
  const options = {};

  while (args.length > 0) {
    const token = args.shift();
    if (!token) {
      continue;
    }

    if (token === "--config" || token === "--state") {
      const value = args.shift();
      if (!value) {
        throw new Error(`${token} requires a value.`);
      }
      options[token.slice(2)] = path.resolve(process.cwd(), value);
      continue;
    }

    if (token === "--help" || token === "-h") {
      options.help = true;
      continue;
    }

    positionals.push(token);
  }

  return {
    command: positionals[0] ?? "",
    mode: positionals[1] ?? "",
    options,
  };
};

const readJsonFile = async (targetPath) => {
  const raw = await readFile(targetPath, "utf8");
  return JSON.parse(raw);
};

const loadConfig = async (configPath) => {
  const resolvedPath = configPath ?? defaultConfigPath;
  const config = await readJsonFile(resolvedPath);
  if (!config.baseUrl || !config.schoolId) {
    throw new Error("Config must include baseUrl and schoolId.");
  }
  if (!config.teacher || (!config.teacher.accountId && !config.teacher.email)) {
    throw new Error("Config must include teacher.accountId or teacher.email.");
  }
  if (!Array.isArray(config.parents) || config.parents.length !== 5) {
    throw new Error("Config must include exactly 5 parent entries.");
  }
  return {
    path: resolvedPath,
    value: {
      prefix: "IMGFIX",
      apiBaseUrl: resolveApiOrigin(config.baseUrl),
      avatarCatalogBaseUrl: defaultAvatarCatalogBaseUrl,
      avatarManifestPath: defaultAvatarManifestPath,
      awsRegion: defaultAwsRegion,
      cognitoUserPoolId: defaultCognitoUserPoolId,
      dynamoTableName: defaultDynamoTableName,
      authAccountPassword: process.env.E2E_LOGIN_PASSWORD ?? "",
      ...config,
    },
  };
};

const loadState = async (statePath) => {
  try {
    return await readJsonFile(statePath);
  } catch {
    return {
      version: 2,
      teacher: null,
      parents: {},
      students: {},
      classes: {},
      outputs: {},
    };
  }
};

const saveState = async (statePath, state) => {
  await mkdir(path.dirname(statePath), { recursive: true });
  await writeFile(statePath, `${JSON.stringify(state, null, 2)}\n`, "utf8");
};

const writeJsonFile = async (targetPath, value) => {
  await mkdir(path.dirname(targetPath), { recursive: true });
  await writeFile(targetPath, `${JSON.stringify(value, null, 2)}\n`, "utf8");
};

const writeTextFile = async (targetPath, value) => {
  await mkdir(path.dirname(targetPath), { recursive: true });
  await writeFile(targetPath, value, "utf8");
};

const toIsoDateJst = (date = new Date()) => jstFormatter.format(date);

const getTodayJstDayOfWeek = () => {
  const formatter = new Intl.DateTimeFormat("en-US", {
    timeZone: "Asia/Tokyo",
    weekday: "short",
  });
  const short = formatter.format(new Date()).toLowerCase();
  return ["sun", "mon", "tue", "wed", "thu", "fri", "sat"].indexOf(short);
};

const createSvgDataUrl = ({ label, background, foreground = "#ffffff" }) => {
  const svg = `
    <svg xmlns="http://www.w3.org/2000/svg" width="160" height="160" viewBox="0 0 160 160">
      <rect width="160" height="160" rx="32" fill="${background}" />
      <circle cx="80" cy="62" r="28" fill="${foreground}" opacity="0.92" />
      <path d="M36 132c8-25 30-40 44-40s36 15 44 40" fill="${foreground}" opacity="0.92" />
      <text x="80" y="150" text-anchor="middle" font-family="Arial, sans-serif" font-size="20" fill="${foreground}">${label}</text>
    </svg>
  `.replace(/\s+/g, " ");
  return `data:image/svg+xml;base64,${Buffer.from(svg).toString("base64")}`;
};

const escapeXml = (value) =>
  String(value)
    .replaceAll("&", "&amp;")
    .replaceAll('"', "&quot;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;");

const fetchAssetAsDataUrl = async (url) => {
  if (!url) {
    return "";
  }

  const response = await fetch(url);
  if (!response.ok) {
    throw new Error(`Failed to fetch avatar badge asset: ${response.status} ${url}`);
  }

  const contentType = response.headers.get("content-type") || "image/webp";
  const buffer = Buffer.from(await response.arrayBuffer());
  return `data:${contentType};base64,${buffer.toString("base64")}`;
};

const createBadgeCompositeDataUrl = ({ badgeDataUrl, backgroundHex }) => {
  const svg = [
    '<svg xmlns="http://www.w3.org/2000/svg" width="160" height="160" viewBox="0 0 160 160">',
    `  <rect width="160" height="160" rx="32" fill="${escapeXml(backgroundHex)}" />`,
    `  <image href="${escapeXml(badgeDataUrl)}" x="0" y="0" width="160" height="160" preserveAspectRatio="xMidYMid meet" />`,
    "</svg>",
  ].join("\n");

  return `data:image/svg+xml;base64,${Buffer.from(svg, "utf8").toString("base64")}`;
};

const pickRandomAvatarBackground = () =>
  avatarBackgroundPalette[
    Math.floor(Math.random() * avatarBackgroundPalette.length)
  ];

const resolveApiOrigin = (baseUrl) => new URL(baseUrl).origin;

const resolveBearerToken = async (baseUrl) => {
  const staticToken = process.env.ECO_API_TEST_BEARER_TOKEN?.trim();
  if (staticToken) {
    return staticToken;
  }

  const email = process.env.ECO_SETUP_EMAIL?.trim();
  const password = process.env.ECO_SETUP_PASSWORD?.trim();
  if (!email || !password) {
    throw new Error(
      "Set ECO_API_TEST_BEARER_TOKEN or ECO_SETUP_EMAIL/ECO_SETUP_PASSWORD.",
    );
  }

  const browser = await chromium.launch({ headless: true });
  try {
    const context = await browser.newContext({
      ignoreHTTPSErrors: true,
    });
    const page = await context.newPage();
    await page.goto(`${baseUrl.replace(/\/$/, "")}/login`, {
      waitUntil: "domcontentloaded",
    });
    await page.getByLabel("EMAIL").fill(email);
    await page.getByLabel("PASSWORD").fill(password);
    await page.getByRole("button", { name: "LOGIN" }).click();
    await page.waitForFunction(() => {
      return !!window.localStorage.getItem("eco:authAccessToken");
    });
    const accessToken = await page.evaluate(() =>
      window.localStorage.getItem("eco:authAccessToken"),
    );
    if (!accessToken) {
      throw new Error("Login succeeded but auth token was not found.");
    }
    return accessToken;
  } finally {
    await browser.close();
  }
};

const createApiClient = ({ apiBaseUrl, bearerToken }) => {
  const apiOrigin = resolveApiOrigin(apiBaseUrl);

  const request = async (method, pathName, body) => {
    const response = await fetch(`${apiOrigin}/api${pathName}`, {
      method,
      headers: {
        Authorization: `Bearer ${bearerToken}`,
        ...(body ? { "Content-Type": "application/json" } : {}),
      },
      body: body ? JSON.stringify(body) : undefined,
    });

    const raw = await response.text();
    let json = null;
    try {
      json = raw ? JSON.parse(raw) : null;
    } catch {
      json = null;
    }
    if (!response.ok || json?.result === false) {
      throw new Error(
        `API ${method} ${pathName} failed: ${response.status} ${raw}`,
      );
    }
    return json;
  };

  return {
    get: (pathName) => request("GET", pathName),
    post: (pathName, body) => request("POST", pathName, body),
    put: (pathName, body) => request("PUT", pathName, body),
    delete: (pathName) => request("DELETE", pathName),
  };
};

const getUsers = async (api) => {
  const json = await api.get("/users");
  return Array.isArray(json?.users) ? json.users : [];
};

const getSchool = async (api, schoolId) => {
  const json = await api.get(`/schools/${encodeURIComponent(schoolId)}`);
  return json?.school ?? null;
};

const getSchoolClasses = async (api, schoolId) => {
  const json = await api.get(`/schools/${encodeURIComponent(schoolId)}/classes`);
  return Array.isArray(json?.classes) ? json.classes : [];
};

const getSchoolStudents = async (api, schoolId) => {
  const json = await api.get(`/schools/${encodeURIComponent(schoolId)}/students`);
  return Array.isArray(json?.students) ? json.students : [];
};

const getSchoolClass = async (api, schoolId, classId) => {
  const json = await api.get(
    `/schools/${encodeURIComponent(schoolId)}/classes/${encodeURIComponent(classId)}`,
  );
  return json?.class ?? null;
};

const getSchoolClassStudents = async (api, schoolId, classId) => {
  const json = await api.get(
    `/schools/${encodeURIComponent(schoolId)}/classes/${encodeURIComponent(classId)}/students`,
  );
  return Array.isArray(json?.students) ? json.students : [];
};

const getStudentCoins = async (api, studentId) => {
  const json = await api.get(
    `/students/${encodeURIComponent(studentId)}/coins`,
  );
  return json?.coins ?? null;
};

const getStudentRank = async (api, studentId) => {
  const json = await api.get(
    `/students/${encodeURIComponent(studentId)}/rank-points`,
  );
  return json?.rank ?? null;
};

const getStudentAvatars = async (api, studentId) => {
  const json = await api.get(
    `/students/${encodeURIComponent(studentId)}/avatars`,
  );
  return json?.avatars ?? null;
};

const resolveManagedStudents = (prefix) =>
  Array.from({ length: 8 }, (_, index) => {
    const studentIndex = index + 1;
    const profile = studentInitialProfiles[index];
    return {
      key: `student-${String(studentIndex).padStart(2, "0")}`,
      name: `${prefix} Student ${studentIndex}`,
      avatarLabel: `S${studentIndex}`,
      parentKey: studentParentGroups[index],
      studentIndex,
      targetPoints: profile.targetPoints,
      targetCoins: profile.targetCoins,
    };
  });

const resolveManagedClasses = (prefix) =>
  managedClassTemplates.map((item, index) => ({
    ...item,
    name: `${prefix} ${item.suffix}`,
    dayOfWeek: getTodayJstDayOfWeek(),
    startDay: toIsoDateJst(),
    numOfLessons: 12 + index,
    maxStudents: 8,
    type: "eco",
    location: `${prefix}-room-${index + 1}`,
    locationList: [
      `${prefix}-room-1`,
      `${prefix}-room-2`,
      `${prefix}-room-3`,
    ],
  }));

const findUserByConfig = (users, subject) => {
  if (subject.accountId) {
    return users.find((item) => item.accountId === subject.accountId) ?? null;
  }
  if (subject.email) {
    return (
      users.find(
        (item) =>
          typeof item.email === "string" &&
          item.email.toLowerCase() === subject.email.toLowerCase(),
      ) ?? null
    );
  }
  return null;
};

const runAws = async (args, awsRegion = defaultAwsRegion) => {
  const fullArgs = [...args, "--region", awsRegion];
  if (process.env.AWS_PROFILE) {
    fullArgs.push("--profile", process.env.AWS_PROFILE);
  }

  try {
    const { stdout } = await execFileAsync("aws", fullArgs, {
      env: process.env,
      maxBuffer: 10 * 1024 * 1024,
    });
    return stdout;
  } catch (error) {
    const detail =
      error instanceof Error ? error.message : "AWS CLI execution failed";
    throw new Error(`AWS CLI failed: ${detail}`);
  }
};

const mapUserAttributes = (attributes) =>
  Object.fromEntries(
    (Array.isArray(attributes) ? attributes : []).flatMap((item) => {
      if (!item?.Name) {
        return [];
      }
      return [[item.Name, item.Value ?? ""]];
    }),
  );

const buildDynamoAttributeValue = (value) => {
  if (value === null || value === undefined) {
    return { NULL: true };
  }
  if (typeof value === "string") {
    return { S: value };
  }
  if (typeof value === "boolean") {
    return { BOOL: value };
  }
  if (typeof value === "number") {
    return { N: String(value) };
  }
  if (Array.isArray(value)) {
    return { L: value.map((item) => buildDynamoAttributeValue(item)) };
  }
  return {
    M: Object.fromEntries(
      Object.entries(value).map(([key, entry]) => [
        key,
        buildDynamoAttributeValue(entry),
      ]),
    ),
  };
};

const getCognitoUser = async ({ username, cognitoUserPoolId, awsRegion }) => {
  if (!username || !cognitoUserPoolId) {
    return null;
  }

  try {
    const stdout = await runAws(
      [
        "cognito-idp",
        "admin-get-user",
        "--user-pool-id",
        cognitoUserPoolId,
        "--username",
        username,
      ],
      awsRegion,
    );
    return JSON.parse(stdout || "{}");
  } catch {
    return null;
  }
};

const ensureCognitoAuthUser = async ({
  email,
  name,
  password,
  awsRegion,
  cognitoUserPoolId,
}) => {
  if (!email || !name || !password || !cognitoUserPoolId) {
    throw new Error("email, name, password, cognitoUserPoolId are required.");
  }

  let user = await getCognitoUser({
    username: email,
    cognitoUserPoolId,
    awsRegion,
  });
  if (!user) {
    const requestedUsername = `imgfix-${randomUUID()}`;
    const stdout = await runAws(
      [
        "cognito-idp",
        "admin-create-user",
        "--user-pool-id",
        cognitoUserPoolId,
        "--username",
        requestedUsername,
        "--user-attributes",
        `Name=email,Value=${email}`,
        "Name=email_verified,Value=true",
        `Name=name,Value=${name}`,
        "--message-action",
        "SUPPRESS",
      ],
      awsRegion,
    );
    const createdUser = JSON.parse(stdout || "{}")?.User ?? null;
    user =
      (await getCognitoUser({
        username: createdUser?.Username ?? requestedUsername,
        cognitoUserPoolId,
        awsRegion,
      })) ??
      createdUser;
  }

  const attributes = mapUserAttributes(user?.UserAttributes ?? user?.Attributes);
  const accountId = attributes.sub || user?.Username;
  if (!accountId) {
    throw new Error(`Cognito sub was not resolved for ${email}.`);
  }

  await ensureCognitoPassword({
    email,
    password,
    awsRegion,
    cognitoUserPoolId,
  });

  return accountId;
};

const putAuthAccountLinks = async ({
  accountId,
  companyId,
  schoolId,
  email,
  name,
  logo,
  role,
  tableName,
}) => {
  const now = new Date().toISOString();
  const accountItem = {
    PK: `ACCOUNT#${accountId}`,
    SK: "ACCOUNT",
    itemType: "Account",
    entityId: accountId,
    accountId,
    companyId,
    name,
    email,
    logo,
    roles: [role],
    isActive: true,
    createdAt: now,
    updatedAt: now,
  };

  const companyLink =
    role === "teacher"
      ? {
          PK: `COMPANY#${companyId}`,
          SK: `COMPANY-TEACHER#${accountId}`,
          itemType: "CompanyTeacherLink",
          companyId,
          accountId,
          accountLookupPK: `ACCOUNT#${accountId}`,
          accountLookupSK: `COMPANY#${companyId}#CompanyTeacherLink`,
          isActive: true,
          createdAt: now,
          updatedAt: now,
        }
      : {
          PK: `COMPANY#${companyId}`,
          SK: `COMPANY-PARENT#${accountId}`,
          itemType: "CompanyParentLink",
          companyId,
          accountId,
          accountLookupPK: `ACCOUNT#${accountId}`,
          accountLookupSK: `COMPANY#${companyId}#CompanyParentLink`,
          isActive: true,
          createdAt: now,
          updatedAt: now,
        };

  const schoolLink =
    role === "teacher"
      ? {
          PK: `SCHOOL#${schoolId}`,
          SK: `SCHOOL-TEACHER#${accountId}`,
          itemType: "SchoolTeacherLink",
          companyId,
          schoolId,
          accountId,
          accountLookupPK: `ACCOUNT#${accountId}`,
          accountLookupSK: `SCHOOL#${schoolId}#SchoolTeacherLink`,
          isActive: true,
          createdAt: now,
          updatedAt: now,
        }
      : {
          PK: `SCHOOL#${schoolId}`,
          SK: `SCHOOL-PARENT#${accountId}`,
          itemType: "SchoolParentLink",
          companyId,
          schoolId,
          accountId,
          accountLookupPK: `ACCOUNT#${accountId}`,
          accountLookupSK: `SCHOOL#${schoolId}#SchoolParentLink`,
          isActive: true,
          createdAt: now,
          updatedAt: now,
        };

  const transactItems = [accountItem, companyLink, schoolLink].map((item) => ({
    Put: {
      TableName: tableName,
      Item: Object.fromEntries(
        Object.entries(item).map(([key, value]) => [
          key,
          buildDynamoAttributeValue(value),
        ]),
      ),
    },
  }));

  const tempPath = path.join(
    artifactDir,
    `.aws-transact-${role}-${accountId}-${Date.now()}.json`,
  );
  await writeJsonFile(tempPath, transactItems);
  try {
    await runAws(
      [
        "dynamodb",
        "transact-write-items",
        "--transact-items",
        `file://${tempPath}`,
      ],
      defaultAwsRegion,
    );
  } finally {
    await rm(tempPath, { force: true });
  }
};

const createManagedAuthUser = async ({
  config,
  schoolId,
  companyId,
  role,
  subject,
  fallbackName,
  logoLabel,
  logoColor,
}) => {
  if (!subject.email) {
    throw new Error(`Cannot create ${role} user without email.`);
  }

  const name = subject.name ?? fallbackName;
  const logo = createSvgDataUrl({
    label: logoLabel,
    background: logoColor,
  });
  const accountId = await ensureCognitoAuthUser({
    email: subject.email,
    name,
    password: config.authAccountPassword,
    awsRegion: config.awsRegion,
    cognitoUserPoolId: config.cognitoUserPoolId,
  });

  await putAuthAccountLinks({
    accountId,
    companyId,
    schoolId,
    email: subject.email,
    name,
    logo,
    role,
    tableName: config.dynamoTableName,
  });
};

const ensureCognitoPassword = async ({
  email,
  password,
  awsRegion,
  cognitoUserPoolId,
}) => {
  if (!email || !password || !cognitoUserPoolId) {
    return;
  }

  try {
    await runAws(
      [
        "cognito-idp",
        "admin-set-user-password",
        "--user-pool-id",
        cognitoUserPoolId,
        "--username",
        email,
        "--password",
        password,
        "--permanent",
      ],
      awsRegion,
    );
  } catch (error) {
    const detail =
      error instanceof Error ? error.message : "aws cognito-idp failed";
    throw new Error(
      `Failed to set Cognito password for ${email}. Check AWS SSO session and Cognito settings. ${detail}`,
    );
  }
};

const ensureTeacherAndParents = async ({
  api,
  config,
  state,
  schoolId,
  companyId,
}) => {
  const users = await getUsers(api);
  let teacher = findUserByConfig(users, config.teacher);
  if (!teacher && config.teacher.createIfMissing) {
    await createManagedAuthUser({
      config,
      schoolId,
      companyId,
      role: "teacher",
      subject: config.teacher,
      fallbackName: `${config.prefix} Teacher`,
      logoLabel: "T",
      logoColor: "#E74C3C",
    });
    teacher = findUserByConfig(await getUsers(api), config.teacher);
  }
  if (!teacher) {
    throw new Error(
      "Teacher account was not found. Provide an existing accountId or email in config.",
    );
  }

  await ensureCognitoPassword({
    email: teacher.email ?? config.teacher.email ?? "",
    password: config.authAccountPassword,
    awsRegion: config.awsRegion,
    cognitoUserPoolId: config.cognitoUserPoolId,
  });

  state.teacher = {
    accountId: teacher.accountId,
    email: teacher.email ?? config.teacher.email ?? "",
    name: teacher.name ?? `${config.prefix} Teacher`,
  };

  for (const parentConfig of config.parents) {
    let parent = findUserByConfig(users, parentConfig);
    if (!parent && parentConfig.createIfMissing) {
      await createManagedAuthUser({
        config,
        schoolId,
        companyId,
        role: "parent",
        subject: parentConfig,
        fallbackName: parentConfig.name ?? `${config.prefix} ${parentConfig.key}`,
        logoLabel: parentConfig.key.replace("parent-", "P").toUpperCase(),
        logoColor: "#34495E",
      });
      parent = findUserByConfig(await getUsers(api), parentConfig);
    }
    if (!parent) {
      throw new Error(
        `Parent account was not found for key=${parentConfig.key}. Provide an existing accountId or email.`,
      );
    }
    await ensureCognitoPassword({
      email: parent.email ?? parentConfig.email ?? "",
      password: config.authAccountPassword,
      awsRegion: config.awsRegion,
      cognitoUserPoolId: config.cognitoUserPoolId,
    });
    state.parents[parentConfig.key] = {
      accountId: parent.accountId,
      email: parent.email ?? parentConfig.email ?? "",
      name: parent.name ?? `${config.prefix} ${parentConfig.key}`,
    };
  }

  return {
    users,
    teacherAccountId: teacher.accountId,
    companyId: teacher.companyId ?? companyId,
  };
};

const ensureStudent = async ({
  api,
  schoolId,
  companyId,
  state,
  studentSpec,
  parentAccountId,
}) => {
  const currentStudents = await getSchoolStudents(api, schoolId);
  const storedStudentId = state.students[studentSpec.key]?.studentId ?? "";
  const byStoredId =
    storedStudentId &&
    currentStudents.find((item) => item.entityId === storedStudentId);
  const byName = currentStudents.find((item) => item.name === studentSpec.name);
  const resolved = byStoredId ?? byName;

  if (resolved) {
    state.students[studentSpec.key] = {
      ...state.students[studentSpec.key],
      studentId: resolved.entityId,
      name: studentSpec.name,
      parentKey: studentSpec.parentKey,
    };
    return resolved.entityId;
  }

  const avatarUrl = createSvgDataUrl({
    label: studentSpec.avatarLabel,
    background: ["#4F8EF7", "#26A269", "#F39C12", "#9B59B6"][
      (studentSpec.studentIndex - 1) % 4
    ],
  });

  await api.post("/users", {
    name: studentSpec.name,
    logo: avatarUrl,
    roles: ["student"],
    companyId,
    schoolId,
    parentId: parentAccountId,
  });

  const nextStudents = await getSchoolStudents(api, schoolId);
  const created = nextStudents.find((item) => item.name === studentSpec.name);
  if (!created?.entityId) {
    throw new Error(`Student create succeeded but ID was not found: ${studentSpec.name}`);
  }

  state.students[studentSpec.key] = {
    studentId: created.entityId,
    name: studentSpec.name,
    parentKey: studentSpec.parentKey,
  };
  return created.entityId;
};

const ensureManagedClass = async ({
  api,
  schoolId,
  teacherAccountId,
  classSpec,
  state,
}) => {
  const classes = await getSchoolClasses(api, schoolId);
  const storedClassId = state.classes[classSpec.key]?.classId ?? "";
  const byStoredId =
    storedClassId && classes.find((item) => item.classId === storedClassId);
  const byName = classes.find((item) => item.name === classSpec.name);
  const resolved = byStoredId ?? byName;

  if (resolved) {
    state.classes[classSpec.key] = {
      classId: resolved.classId,
      name: classSpec.name,
    };
    return resolved.classId;
  }

  await api.post(`/schools/${encodeURIComponent(schoolId)}/classes`, {
    name: classSpec.name,
    type: classSpec.type,
    level: classSpec.level,
    calendarColor: classSpec.calendarColor,
    numOfLessons: classSpec.numOfLessons,
    maxStudents: classSpec.maxStudents,
    teacherId: teacherAccountId,
    dayOfWeek: classSpec.dayOfWeek,
    startDay: classSpec.startDay,
    startTime: classSpec.startTime,
    duration: classSpec.duration,
    location: classSpec.location,
    locationList: classSpec.locationList,
    studentIds: [],
  });

  const nextClasses = await getSchoolClasses(api, schoolId);
  const created = nextClasses.find((item) => item.name === classSpec.name);
  if (!created?.classId) {
    throw new Error(`Class create succeeded but ID was not found: ${classSpec.name}`);
  }

  state.classes[classSpec.key] = {
    classId: created.classId,
    name: classSpec.name,
  };
  return created.classId;
};

const updateTeacherAvatar = async ({ api, teacherAccountId, teacherName }) => {
  await api.put(`/users/${encodeURIComponent(teacherAccountId)}`, {
    name: teacherName,
    logo: createSvgDataUrl({
      label: "T",
      background: "#E74C3C",
    }),
  });
};

const updateStudentProfile = async ({ api, studentId, studentSpec, logo }) => {
  await api.put(`/students/${encodeURIComponent(studentId)}`, {
    name: studentSpec.name,
    isActive: true,
    logo,
  });
};

const buildStudentAvatarLogo = async (avatar) => {
  const badgeSource = avatar?.badgeUrl || avatar?.avatarUrl || "";
  if (!badgeSource) {
    return "";
  }

  return createBadgeCompositeDataUrl({
    badgeDataUrl: await fetchAssetAsDataUrl(badgeSource),
    backgroundHex: pickRandomAvatarBackground().hex,
  });
};

const buildProgressMap = (studentIndex) => ({
  "1": {
    a: true,
    b: studentIndex % 2 === 0,
    c: studentIndex % 3 === 0,
    d: studentIndex % 4 === 0,
  },
  "2": {
    a: studentIndex >= 2,
    b: studentIndex >= 4,
    c: studentIndex >= 6,
    d: studentIndex >= 8,
  },
  "3": {
    a: studentIndex % 2 === 1,
    b: studentIndex >= 5,
    c: false,
    d: false,
  },
});

const buildHomeworkMap = (studentIndex) => ({
  "1": {
    a: true,
    b: true,
    c: studentIndex % 2 === 0,
    d: studentIndex % 3 === 0,
  },
  "2": {
    a: true,
    b: studentIndex >= 3,
    c: studentIndex >= 5,
    d: false,
  },
  "3": {
    a: studentIndex >= 4,
    b: false,
    c: false,
    d: false,
  },
});

const seedStudentProgress = async ({
  api,
  schoolId,
  classId,
  year,
  studentId,
  studentIndex,
}) => {
  await api.put(`/students/${encodeURIComponent(studentId)}/progress`, {
    schoolId,
    classId,
    year,
    progress: buildProgressMap(studentIndex),
  });
  await api.put(
    `/students/${encodeURIComponent(studentId)}/progress/homework`,
    {
      schoolId,
      classId,
      year,
      homework: buildHomeworkMap(studentIndex),
    },
  );
};

const syncClass = async ({ api, schoolId, classId, patch }) => {
  const current = await getSchoolClass(api, schoolId, classId);
  if (!current) {
    throw new Error(`Class not found: ${classId}`);
  }
  const studentIds =
    patch.studentIds ??
    (await getSchoolClassStudents(api, schoolId, classId)).map(
      (item) => item.entityId,
    );

  await api.put(
    `/schools/${encodeURIComponent(schoolId)}/classes/${encodeURIComponent(classId)}`,
    {
      name: patch.name ?? current.name,
      type: patch.type ?? current.type ?? "eco",
      level: patch.level ?? current.level ?? "blue",
      calendarColor:
        patch.calendarColor ?? current.calendarColor ?? "#4F8EF7",
      numOfLessons: patch.numOfLessons ?? current.numOfLessons ?? 12,
      maxStudents: patch.maxStudents ?? current.maxStudents ?? 8,
      teacherId:
        patch.teacherId !== undefined
          ? patch.teacherId
          : (current.teacherId ?? ""),
      dayOfWeek: patch.dayOfWeek ?? current.dayOfWeek ?? getTodayJstDayOfWeek(),
      startDay: patch.startDay ?? current.startDay ?? toIsoDateJst(),
      startTime: patch.startTime ?? current.startTime ?? "16:00",
      duration: patch.duration ?? current.duration ?? 45,
      location: patch.location ?? current.location ?? "",
      locationList: patch.locationList ?? current.locationList ?? [],
      studentIds,
    },
  );
};

const replaceManagedClassSessions = async ({
  api,
  schoolId,
  classId,
  teacherId,
  classSpec,
}) => {
  const today = toIsoDateJst();
  const year = String(new Date(`${today}T00:00:00+09:00`).getUTCFullYear());

  // The backend currently performs delete+put in one batch. Clearing once first
  // avoids same-key collisions when we reinsert the same date.
  await api.post(
    `/schools/${encodeURIComponent(schoolId)}/classes/${encodeURIComponent(classId)}/sessions/${encodeURIComponent(year)}`,
    {
      sessions: [],
    },
  );

  await api.post(
    `/schools/${encodeURIComponent(schoolId)}/classes/${encodeURIComponent(classId)}/sessions/${encodeURIComponent(year)}`,
    {
      sessions: [
        {
          date: today,
          startTime: classSpec.startTime,
          duration: classSpec.duration,
          dayOfWeek: classSpec.dayOfWeek,
          status: "SCHEDULED",
          teacherId: teacherId || undefined,
          locationId: classSpec.location,
          classType: "eco",
          level: classSpec.level,
          calendarColor: classSpec.calendarColor,
          name: "SECTION A",
        },
      ],
    },
  );
};

const markManagedClassSessionInProgress = async ({
  config,
  schoolId,
  classId,
  date = toIsoDateJst(),
}) => {
  const year = String(new Date(`${date}T00:00:00+09:00`).getUTCFullYear());
  const now = new Date().toISOString();
  const key = JSON.stringify({
    PK: { S: `SCHOOL#${schoolId}` },
    SK: { S: `CLASS#${classId}#YEAR#${year}#SESSION#${date}` },
  });
  const expressionAttributeNames = JSON.stringify({
    "#status": "status",
    "#updatedAt": "updatedAt",
    "#startedAt": "startedAt",
  });
  const expressionAttributeValues = JSON.stringify({
    ":status": { S: "IN_PROGRESS" },
    ":updatedAt": { S: now },
    ":startedAt": { S: now },
  });

  await runAws(
    [
      "dynamodb",
      "update-item",
      "--table-name",
      config.dynamoTableName,
      "--key",
      key,
      "--update-expression",
      "SET #status = :status, #updatedAt = :updatedAt, #startedAt = :startedAt",
      "--expression-attribute-names",
      expressionAttributeNames,
      "--expression-attribute-values",
      expressionAttributeValues,
      "--condition-expression",
      "attribute_exists(PK) AND attribute_exists(SK)",
    ],
    config.awsRegion,
  );
};

const loadAvatarCatalog = async ({ baseUrl, manifestPath }) => {
  const manifestUrl = new URL(manifestPath, `${baseUrl.replace(/\/$/, "")}/`);
  const response = await fetch(manifestUrl);
  if (!response.ok) {
    throw new Error(
      `Failed to load avatar catalog: ${response.status} ${manifestUrl}`,
    );
  }
  const manifest = await response.json();
  const items = Array.isArray(manifest?.items) ? manifest.items : [];
  return {
    manifestUrl: manifestUrl.toString(),
    items: items
      .filter((item) => item?.status === "active")
      .sort((left, right) => {
        if ((left.sortOrder ?? 0) !== (right.sortOrder ?? 0)) {
          return (left.sortOrder ?? 0) - (right.sortOrder ?? 0);
        }
        return String(left.key ?? "").localeCompare(String(right.key ?? ""));
      }),
  };
};

const resolveCatalogImageUrl = (manifestUrl, imagePath) => {
  if (!imagePath) {
    return "";
  }
  return new URL(imagePath, manifestUrl).toString();
};

const resolveAvatarAssignments = ({ manifestUrl, items, managedStudents }) => {
  if (items.length < managedStudents.length) {
    throw new Error(
      `Avatar catalog has only ${items.length} active avatars; ${managedStudents.length} are required.`,
    );
  }

  return managedStudents.reduce((map, studentSpec, index) => {
    const item = items[index];
    map[studentSpec.key] = {
      key: item.key,
      name: item.name,
      coinCost: item.coinCost ?? 0,
      badgeUrl: resolveCatalogImageUrl(manifestUrl, item.images?.badge),
      avatarUrl: resolveCatalogImageUrl(manifestUrl, item.images?.avatar),
      group: item.group,
      type: item.type,
    };
    return map;
  }, {});
};

const resolveMedalLevel = (points) => {
  const matched = medalLevels.find((level) => points >= level.minPoints);
  return matched?.level ?? 1;
};

const syncStudentCoins = async ({
  api,
  studentId,
  targetCoins,
  grantedBy,
}) => {
  const current = await getStudentCoins(api, studentId);
  const currentCoins = current?.coins ?? 0;
  const delta = targetCoins - currentCoins;
  if (delta === 0) {
    return targetCoins;
  }

  await api.post(`/students/${encodeURIComponent(studentId)}/coins`, {
    amount: delta,
    reason: "MANUAL",
    note: "Reset image fixture coin balance",
    grantedBy,
  });
  return targetCoins;
};

const syncStudentRankPoints = async ({
  api,
  studentId,
  targetPoints,
  grantedBy,
}) => {
  const current = await getStudentRank(api, studentId);
  const currentPoints = current?.totalPoints ?? 0;
  const delta = targetPoints - currentPoints;
  if (delta === 0) {
    return targetPoints;
  }

  await api.post(`/students/${encodeURIComponent(studentId)}/rank-points`, {
    unit: 1,
    amount: delta,
    reason: "MANUAL",
    note: "Reset image fixture rank points",
    grantedBy,
  });
  return targetPoints;
};

const ensureAvatarSelection = async ({
  api,
  studentId,
  studentSpec,
  preferredAvatar,
  fallbackAvatars,
}) => {
  const avatarState = await getStudentAvatars(api, studentId);
  const purchasedAvatarIds = Array.isArray(avatarState?.purchased)
    ? avatarState.purchased
        .map((item) => item?.avatarId)
        .filter((item) => typeof item === "string" && item.length > 0)
    : [];
  const currentCatalogAvatar = fallbackAvatars.find(
    (candidate) => candidate.key === avatarState?.activeAvatar,
  );

  let selectedAvatar = preferredAvatar;
  if (
    avatarState?.activeAvatar === preferredAvatar.key &&
    preferredAvatar.badgeUrl
  ) {
    await updateStudentProfile({
      api,
      studentId,
      studentSpec,
      logo: await buildStudentAvatarLogo(preferredAvatar),
    });
    return preferredAvatar;
  }

  if (currentCatalogAvatar?.badgeUrl) {
    await updateStudentProfile({
      api,
      studentId,
      studentSpec,
      logo: await buildStudentAvatarLogo(currentCatalogAvatar),
    });
    return currentCatalogAvatar;
  }

  if (purchasedAvatarIds.includes(preferredAvatar.key)) {
    const alternateAvatar = fallbackAvatars.find(
      (candidate) =>
        candidate.key !== avatarState?.activeAvatar &&
        !purchasedAvatarIds.includes(candidate.key),
    );
    if (alternateAvatar) {
      selectedAvatar = alternateAvatar;
    }
  }

  await syncStudentCoins({
    api,
    studentId,
    targetCoins: studentSpec.targetCoins + selectedAvatar.coinCost,
    grantedBy: "codex-image-fixtures",
  });

  if (!purchasedAvatarIds.includes(selectedAvatar.key)) {
    await api.post(
      `/students/${encodeURIComponent(studentId)}/avatars/purchase`,
      {
        avatarId: selectedAvatar.key,
        cost: selectedAvatar.coinCost,
      },
    );
  }

  await syncStudentCoins({
    api,
    studentId,
    targetCoins: studentSpec.targetCoins,
    grantedBy: "codex-image-fixtures",
  });

  await updateStudentProfile({
    api,
    studentId,
    studentSpec,
    logo: await buildStudentAvatarLogo(selectedAvatar),
  });

  return selectedAvatar;
};

const buildClassMemberships = async ({ api, schoolId, state, classSpecs }) => {
  const memberships = {};

  for (const classSpec of classSpecs) {
    const classId = state.classes[classSpec.key]?.classId;
    if (!classId) {
      continue;
    }
    const classInfo = await getSchoolClass(api, schoolId, classId);
    const students = await getSchoolClassStudents(api, schoolId, classId);
    memberships[classSpec.key] = {
      classId,
      name: classInfo?.name ?? classSpec.name,
      teacherId: classInfo?.teacherId ?? "",
      studentIds: students
        .map((item) => item.entityId)
        .filter((item) => typeof item === "string" && item.length > 0),
    };
  }

  return memberships;
};

const renderFixtureManual = ({ generatedAt, config, summary }) => {
  const teacherClasses = summary.teacher.classes.length
    ? summary.teacher.classes.join(", ")
    : "-";
  const teacherAvatarCell = summary.teacher.avatar?.logo
    ? `<img src="${summary.teacher.avatar.logo}" alt="${summary.teacher.name}" width="40" height="40"><br>${summary.teacher.avatar.name ?? "Teacher Logo"}`
    : summary.teacher.avatar?.name ?? "-";
  const teacherAccount = summary.teacher.email || summary.teacher.accountId || "-";
  const studentRows = summary.students
    .map((student) => {
      const classes = student.classes.length ? student.classes.join("<br>") : "-";
      const parent = student.parent
        ? `${student.parent.name} (${student.parent.email || student.parent.accountId})`
        : "-";
      const avatarCell = student.avatar.logo
        ? `<img src="${student.avatar.logo}" alt="${student.avatar.key || student.name}" width="40" height="40"><br>${student.avatar.name ?? student.avatar.key ?? "-"}`
        : student.avatar.name ?? student.avatar.key ?? "-";

      return `| ${student.name} | Student | ${avatarCell} | ${classes} | ${parent} | ${student.points} | ${student.coins} | Lv.${student.medalLevel} |`;
    })
    .join("\n");

  return `---
title: Test Users
lang: ja
tag: manual
version: 0.1.0
---

# 画像取得用テストユーザー

最終更新: ${generatedAt}

## 概要

- 対象 schoolId: \`${config.schoolId}\`
- 教師 1 名、生徒 8 名、親グループ \`3 / 2 / 1 / 1 / 1\`
- 生徒アバターはアバター購入画面の catalog から選んだ購入済みアバターを設定
- メダルレベルはランクポイント合計から算出しています

## 教師

| 名前 | Role | Avatar | 所属クラス | アカウント | 初期ポイント | 初期coin | メダルレベル |
|---|---|---|---|---|---:|---:|---|
| ${summary.teacher.name} | Teacher | ${teacherAvatarCell} | ${teacherClasses} | ${teacherAccount} | - | - | - |

## 生徒

| 名前 | Role | Avatar | 所属クラス | 親アカウント | 初期ポイント | 初期coin | メダルレベル |
|---|---|---|---|---|---:|---:|---|
${studentRows}
`;
};

const buildFixtureSummary = async ({
  api,
  config,
  state,
  managedStudents,
  classSpecs,
  avatarAssignments,
}) => {
  const generatedAt = new Date().toISOString();
  const users = await getUsers(api);
  const schoolStudents = await getSchoolStudents(api, config.schoolId);
  const classMemberships = await buildClassMemberships({
    api,
    schoolId: config.schoolId,
    state,
    classSpecs,
  });
  const teacherClasses = Object.values(classMemberships)
    .filter((classItem) => classItem.teacherId === state.teacher?.accountId)
    .map((classItem) => classItem.name);
  const teacherAccount =
    users.find((item) => item.accountId === state.teacher?.accountId) ?? null;

  const students = [];
  for (const studentSpec of managedStudents) {
    const studentId = state.students[studentSpec.key]?.studentId;
    if (!studentId) {
      continue;
    }

    const studentRecord =
      schoolStudents.find((item) => item.entityId === studentId) ?? null;
    const coins = await getStudentCoins(api, studentId);
    const rank = await getStudentRank(api, studentId);
    const avatars = await getStudentAvatars(api, studentId);
    const classNames = Object.values(classMemberships)
      .filter((classItem) => classItem.studentIds.includes(studentId))
      .map((classItem) => classItem.name);
    const activeAvatarKey = avatars?.activeAvatar ?? "";
    const assignedAvatar = [
      avatarAssignments[studentSpec.key],
      ...Object.values(avatarAssignments),
    ].find((item) => item?.key === activeAvatarKey) ?? avatarAssignments[studentSpec.key];
    const parent = state.parents[studentSpec.parentKey] ?? null;
    const totalPoints = rank?.totalPoints ?? 0;

    students.push({
      key: studentSpec.key,
      studentId,
      name: studentRecord?.name ?? studentSpec.name,
      classes: classNames,
      parent,
      points: totalPoints,
      coins: coins?.coins ?? 0,
      medalLevel: resolveMedalLevel(totalPoints),
      avatar: {
        key: activeAvatarKey || assignedAvatar?.key || "",
        name: assignedAvatar?.name ?? activeAvatarKey,
        badgeUrl:
          assignedAvatar?.badgeUrl ??
          (typeof studentRecord?.logo === "string" ? studentRecord.logo : ""),
        avatarUrl: assignedAvatar?.avatarUrl ?? "",
        logo:
          typeof studentRecord?.logo === "string" ? studentRecord.logo : "",
      },
    });
  }

  return {
    generatedAt,
    schoolId: config.schoolId,
    teacher: {
      ...state.teacher,
      classes: teacherClasses,
      avatar: {
        name: "Teacher Logo",
        logo: typeof teacherAccount?.logo === "string" ? teacherAccount.logo : "",
      },
    },
    students,
    outputs: {
      manualPath: manualOutputPath,
      summaryPath: summaryOutputPath,
    },
  };
};

const writeFixtureOutputs = async ({ config, state, summary }) => {
  const markdown = renderFixtureManual({
    generatedAt: summary.generatedAt,
    config,
    summary,
  });

  await writeTextFile(manualOutputPath, markdown);
  await writeJsonFile(summaryOutputPath, summary);

  state.outputs = {
    manualPath: manualOutputPath,
    summaryPath: summaryOutputPath,
    generatedAt: summary.generatedAt,
  };
};

const ensureInitialFixtures = async ({ api, config, state }) => {
  const school = await getSchool(api, config.schoolId);
  if (!school) {
    throw new Error(`School not found: ${config.schoolId}`);
  }

  const companyId = school.companyId;
  if (!companyId) {
    throw new Error("companyId could not be resolved from school.");
  }
  const { teacherAccountId, companyId: teacherCompanyId } =
    await ensureTeacherAndParents({
      api,
      config,
      state,
      schoolId: config.schoolId,
      companyId,
    });
  const resolvedCompanyId = teacherCompanyId ?? companyId;

  const managedStudents = resolveManagedStudents(config.prefix);
  const managedClasses = resolveManagedClasses(config.prefix);
  const avatarCatalog = await loadAvatarCatalog({
    baseUrl: config.avatarCatalogBaseUrl,
    manifestPath: config.avatarManifestPath,
  });
  const avatarAssignments = resolveAvatarAssignments({
    manifestUrl: avatarCatalog.manifestUrl,
    items: avatarCatalog.items,
    managedStudents,
  });

  for (const studentSpec of managedStudents) {
    const parentAccountId = state.parents[studentSpec.parentKey]?.accountId;
    if (!parentAccountId) {
      throw new Error(`Parent account missing for ${studentSpec.parentKey}.`);
    }
    const studentId = await ensureStudent({
      api,
      schoolId: config.schoolId,
      companyId: resolvedCompanyId,
      state,
      studentSpec,
      parentAccountId,
    });

    await syncStudentRankPoints({
      api,
      studentId,
      targetPoints: studentSpec.targetPoints,
      grantedBy: "codex-image-fixtures",
    });

    await ensureAvatarSelection({
      api,
      studentId,
      studentSpec,
      preferredAvatar: avatarAssignments[studentSpec.key],
      fallbackAvatars: Object.values(avatarAssignments),
    });
  }

  for (const classSpec of managedClasses) {
    await ensureManagedClass({
      api,
      schoolId: config.schoolId,
      teacherAccountId,
      classSpec,
      state,
    });
  }

  await updateTeacherAvatar({
    api,
    teacherAccountId,
    teacherName: state.teacher.name,
  });

  const allStudentIds = managedStudents.map(
    (student) => state.students[student.key].studentId,
  );

  for (const classSpec of managedClasses) {
    const classId = state.classes[classSpec.key].classId;
    const teacherId = classSpec.key === "primary" ? teacherAccountId : "";
    const studentIds = classSpec.key === "primary" ? allStudentIds : [];
    await syncClass({
      api,
      schoolId: config.schoolId,
      classId,
      patch: {
        name: classSpec.name,
        type: classSpec.type,
        level: classSpec.level,
        calendarColor: classSpec.calendarColor,
        numOfLessons: classSpec.numOfLessons,
        maxStudents: classSpec.maxStudents,
        teacherId,
        dayOfWeek: classSpec.dayOfWeek,
        startDay: classSpec.startDay,
        startTime: classSpec.startTime,
        duration: classSpec.duration,
        location: classSpec.location,
        locationList: classSpec.locationList,
        studentIds,
      },
    });
    await replaceManagedClassSessions({
      api,
      schoolId: config.schoolId,
      classId,
      teacherId,
      classSpec,
    });
    if (classSpec.key === "primary" && teacherId) {
      await markManagedClassSessionInProgress({
        config,
        schoolId: config.schoolId,
        classId,
      });
    }
  }

  const year = Number(toIsoDateJst().slice(0, 4));
  const primaryClassId = state.classes.primary.classId;
  for (const studentSpec of managedStudents) {
    const studentId = state.students[studentSpec.key].studentId;
    await seedStudentProgress({
      api,
      schoolId: config.schoolId,
      classId: primaryClassId,
      year,
      studentId,
      studentIndex: studentSpec.studentIndex,
    });
  }

  const summary = await buildFixtureSummary({
    api,
    config,
    state,
    managedStudents,
    classSpecs: managedClasses,
    avatarAssignments,
  });
  await writeFixtureOutputs({ config, state, summary });
};

const setTeacherMode = async ({ api, config, state, mode }) => {
  const teacherId = state.teacher?.accountId;
  if (!teacherId) {
    throw new Error("Fixture state has no teacher. Run init first.");
  }

  const classSpecs = resolveManagedClasses(config.prefix);
  for (const classSpec of classSpecs) {
    const classId = state.classes[classSpec.key]?.classId;
    if (!classId) {
      continue;
    }
    const nextTeacherId =
      mode === "none"
        ? ""
        : mode === "single"
          ? classSpec.key === "primary"
            ? teacherId
            : ""
          : classSpec.key === "tertiary"
            ? ""
            : teacherId;

    await syncClass({
      api,
      schoolId: config.schoolId,
      classId,
      patch: {
        teacherId: nextTeacherId,
      },
    });
    try {
      await replaceManagedClassSessions({
        api,
        schoolId: config.schoolId,
        classId,
        teacherId: nextTeacherId,
        classSpec,
      });
      if (classSpec.key === "primary" && nextTeacherId) {
        await markManagedClassSessionInProgress({
          config,
          schoolId: config.schoolId,
          classId,
        });
      }
    } catch (error) {
      console.warn(
        `Skipping session refresh for class ${classId}: ${
          error instanceof Error ? error.message : String(error)
        }`,
      );
    }
  }
};

const setStudentMode = async ({ api, config, state, mode }) => {
  const classSpecs = resolveManagedClasses(config.prefix);
  const allStudentIds = Object.values(state.students)
    .map((item) => item.studentId)
    .filter(Boolean);
  if (allStudentIds.length === 0) {
    throw new Error("Fixture state has no students. Run init first.");
  }

  for (const classSpec of classSpecs) {
    const classId = state.classes[classSpec.key]?.classId;
    if (!classId) {
      continue;
    }
    const nextStudentIds =
      mode === "none"
        ? []
        : mode === "single"
          ? classSpec.key === "primary"
            ? allStudentIds
            : []
          : classSpec.key === "tertiary"
            ? []
            : allStudentIds;

    await syncClass({
      api,
      schoolId: config.schoolId,
      classId,
      patch: {
        studentIds: nextStudentIds,
      },
    });
  }
};

const refreshOutputs = async ({ api, config, state }) => {
  const managedStudents = resolveManagedStudents(config.prefix);
  const managedClasses = resolveManagedClasses(config.prefix);
  const avatarCatalog = await loadAvatarCatalog({
    baseUrl: config.avatarCatalogBaseUrl,
    manifestPath: config.avatarManifestPath,
  });
  const avatarAssignments = resolveAvatarAssignments({
    manifestUrl: avatarCatalog.manifestUrl,
    items: avatarCatalog.items,
    managedStudents,
  });
  const summary = await buildFixtureSummary({
    api,
    config,
    state,
    managedStudents,
    classSpecs: managedClasses,
    avatarAssignments,
  });
  await writeFixtureOutputs({ config, state, summary });
};

const printStatus = ({ config, state }) => {
  const summary = {
    configPath: config.path,
    repoRoot,
    teacher: state.teacher,
    parents: state.parents,
    students: state.students,
    classes: state.classes,
    outputs: state.outputs ?? {},
  };
  console.log(JSON.stringify(summary, null, 2));
};

const assertMode = (mode) => {
  if (!["none", "single", "multi"].includes(mode)) {
    throw new Error(`Mode must be one of: none, single, multi. Received: ${mode}`);
  }
};

const main = async () => {
  const { command, mode, options } = parseArgs(process.argv.slice(2));
  if (options.help || !command) {
    console.log(usage);
    return;
  }

  const config = await loadConfig(options.config);
  const statePath = options.state ?? defaultStatePath;
  const state = await loadState(statePath);

  if (command === "status") {
    printStatus({ config, state });
    return;
  }

  const bearerToken = await resolveBearerToken(config.value.baseUrl);
  const api = createApiClient({
    apiBaseUrl: config.value.apiBaseUrl,
    bearerToken,
  });

  if (command === "init") {
    await ensureInitialFixtures({
      api,
      config: config.value,
      state,
    });
    await saveState(statePath, state);
    printStatus({ config, state });
    return;
  }

  if (command === "teacher-mode") {
    assertMode(mode);
    await setTeacherMode({
      api,
      config: config.value,
      state,
      mode,
    });
    await refreshOutputs({
      api,
      config: config.value,
      state,
    });
    await saveState(statePath, state);
    printStatus({ config, state });
    return;
  }

  if (command === "student-mode") {
    assertMode(mode);
    await setStudentMode({
      api,
      config: config.value,
      state,
      mode,
    });
    await refreshOutputs({
      api,
      config: config.value,
      state,
    });
    await saveState(statePath, state);
    printStatus({ config, state });
    return;
  }

  throw new Error(`Unknown command: ${command}`);
};

main().catch((error) => {
  if (error instanceof Error) {
    console.error(error.stack || error.message);
  } else {
    console.error(String(error));
  }
  process.exitCode = 1;
});
