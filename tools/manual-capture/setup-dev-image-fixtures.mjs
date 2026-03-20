#!/usr/bin/env node

import path from "node:path";
import { fileURLToPath } from "node:url";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { chromium } from "playwright";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(__dirname, "..", "..");
const stateDir = path.join(__dirname, ".state");
const defaultConfigPath = path.join(
  __dirname,
  "dev-image-fixtures.config.json",
);
const defaultStatePath = path.join(stateDir, "dev-image-fixtures.state.json");
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
      ...config,
    },
  };
};

const loadState = async (statePath) => {
  try {
    return await readJsonFile(statePath);
  } catch {
    return {
      version: 1,
      teacher: null,
      parents: {},
      students: {},
      classes: {},
    };
  }
};

const saveState = async (statePath, state) => {
  await mkdir(path.dirname(statePath), { recursive: true });
  await writeFile(statePath, `${JSON.stringify(state, null, 2)}\n`, "utf8");
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

const createApiClient = ({ baseUrl, bearerToken }) => {
  const apiOrigin = resolveApiOrigin(baseUrl);

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

const resolveManagedStudents = (prefix) =>
  Array.from({ length: 8 }, (_, index) => {
    const studentIndex = index + 1;
    return {
      key: `student-${String(studentIndex).padStart(2, "0")}`,
      name: `${prefix} Student ${studentIndex}`,
      avatarLabel: `S${studentIndex}`,
      parentKey: studentParentGroups[index],
      studentIndex,
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

const ensureTeacherAndParents = async ({ api, config, state }) => {
  const users = await getUsers(api);
  const teacher = findUserByConfig(users, config.teacher);
  if (!teacher) {
    throw new Error(
      "Teacher account was not found. Provide an existing accountId or email in config.",
    );
  }

  state.teacher = {
    accountId: teacher.accountId,
    email: teacher.email ?? config.teacher.email ?? "",
    name: teacher.name ?? `${config.prefix} Teacher`,
  };

  for (const parentConfig of config.parents) {
    const parent = findUserByConfig(users, parentConfig);
    if (!parent) {
      throw new Error(
        `Parent account was not found for key=${parentConfig.key}. Provide an existing accountId or email.`,
      );
    }
    state.parents[parentConfig.key] = {
      accountId: parent.accountId,
      email: parent.email ?? parentConfig.email ?? "",
      name: parent.name ?? `${config.prefix} ${parentConfig.key}`,
    };
  }

  return {
    users,
    teacherAccountId: teacher.accountId,
    companyId: teacher.companyId,
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

const updateStudentAvatar = async ({ api, studentId, studentSpec }) => {
  await api.put(`/students/${encodeURIComponent(studentId)}`, {
    name: studentSpec.name,
    isActive: true,
    logo: createSvgDataUrl({
      label: studentSpec.avatarLabel,
      background: ["#4F8EF7", "#26A269", "#F39C12", "#9B59B6"][
        (studentSpec.studentIndex - 1) % 4
      ],
    }),
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

const syncClass = async ({
  api,
  schoolId,
  classId,
  patch,
}) => {
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

const ensureInitialFixtures = async ({ api, config, state }) => {
  const school = await getSchool(api, config.schoolId);
  if (!school) {
    throw new Error(`School not found: ${config.schoolId}`);
  }

  const { teacherAccountId, companyId: teacherCompanyId } =
    await ensureTeacherAndParents({ api, config, state });
  const companyId = school.companyId ?? teacherCompanyId;
  if (!companyId) {
    throw new Error("companyId could not be resolved from school or teacher.");
  }

  const managedStudents = resolveManagedStudents(config.prefix);
  const managedClasses = resolveManagedClasses(config.prefix);

  for (const studentSpec of managedStudents) {
    const parentAccountId = state.parents[studentSpec.parentKey]?.accountId;
    if (!parentAccountId) {
      throw new Error(`Parent account missing for ${studentSpec.parentKey}.`);
    }
    const studentId = await ensureStudent({
      api,
      schoolId: config.schoolId,
      companyId,
      state,
      studentSpec,
      parentAccountId,
    });
    await updateStudentAvatar({
      api,
      studentId,
      studentSpec,
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
    await replaceManagedClassSessions({
      api,
      schoolId: config.schoolId,
      classId,
      teacherId: nextTeacherId,
      classSpec,
    });
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

const printStatus = ({ config, state }) => {
  const summary = {
    configPath: config.path,
    repoRoot,
    teacher: state.teacher,
    parents: state.parents,
    students: state.students,
    classes: state.classes,
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
    baseUrl: config.value.baseUrl,
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
    await saveState(statePath, state);
    printStatus({ config, state });
    return;
  }

  throw new Error(`Unknown command: ${command}`);
};

main().catch((error) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
});
