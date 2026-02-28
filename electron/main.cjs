const { app, BrowserWindow, dialog, ipcMain } = require("electron");
const path = require("node:path");
const fs = require("node:fs");
const Database = require("better-sqlite3");

const DB_FILE_NAME = "cbdb_20260221.sqlite3";
const isDev = !app.isPackaged;

let mainWindow;
let db;
let dbPath;
let dbWritable = false;
let dbInitError = null;

const simplifiedToTraditionalMap = {
  苏: "蘇",
  阳: "陽",
  龙: "龍",
  刘: "劉",
  张: "張",
  赵: "趙",
  陈: "陳",
  黄: "黃",
  国: "國",
  轼: "軾",
  藩: "藩",
  为: "為",
};

function unique(values) {
  return [...new Set(values.filter(Boolean))];
}

function escapeLike(value) {
  return `%${String(value).trim().replace(/\s+/g, "%")}%`;
}

function toInt(value, fallback = null) {
  const n = Number(value);
  if (!Number.isFinite(n)) {
    return fallback;
  }
  return Math.trunc(n);
}

function clamp(value, min, max) {
  return Math.max(min, Math.min(max, value));
}

function convertToTraditional(text) {
  return String(text)
    .split("")
    .map((char) => simplifiedToTraditionalMap[char] || char)
    .join("");
}

function buildKeywordVariants(keyword) {
  const trimmed = String(keyword || "").trim();
  if (!trimmed) {
    return [];
  }
  return unique([trimmed, convertToTraditional(trimmed)]);
}

function resolveDbPath(customPath) {
  const candidates = unique([
    customPath,
    process.env.CBDB_DB_PATH,
    path.join(process.cwd(), DB_FILE_NAME),
    path.join(process.cwd(), "db", DB_FILE_NAME),
    path.join(app.getAppPath(), DB_FILE_NAME),
    path.join(app.getAppPath(), "db", DB_FILE_NAME),
    path.join(process.resourcesPath || "", "db", DB_FILE_NAME),
  ]);

  return candidates.find((candidate) => fs.existsSync(candidate)) || null;
}

function closeDb() {
  if (db) {
    db.close();
    db = null;
  }
}

function ensureIndexes() {
  if (!dbWritable) {
    return;
  }

  const statements = [
    "CREATE INDEX IF NOT EXISTS idx_biog_main_name_chn ON BIOG_MAIN(c_name_chn)",
    "CREATE INDEX IF NOT EXISTS idx_biog_main_name_rm ON BIOG_MAIN(c_name_rm)",
    "CREATE INDEX IF NOT EXISTS idx_biog_main_dy ON BIOG_MAIN(c_dy)",
    "CREATE INDEX IF NOT EXISTS idx_posted_personid ON POSTED_TO_OFFICE_DATA(c_personid)",
    "CREATE INDEX IF NOT EXISTS idx_posted_office_id ON POSTED_TO_OFFICE_DATA(c_office_id)",
    "CREATE INDEX IF NOT EXISTS idx_kin_personid ON KIN_DATA(c_personid)",
    "CREATE INDEX IF NOT EXISTS idx_kin_kinid ON KIN_DATA(c_kin_id)",
    "CREATE INDEX IF NOT EXISTS idx_entry_personid ON ENTRY_DATA(c_personid)",
    "CREATE INDEX IF NOT EXISTS idx_entry_year ON ENTRY_DATA(c_year)",
    "CREATE INDEX IF NOT EXISTS idx_assoc_personid ON ASSOC_DATA(c_personid)",
    "CREATE INDEX IF NOT EXISTS idx_biog_addr_personid ON BIOG_ADDR_DATA(c_personid)",
    "CREATE INDEX IF NOT EXISTS idx_altname_personid ON ALTNAME_DATA(c_personid)",
  ];

  const tx = db.transaction(() => {
    for (const statement of statements) {
      db.prepare(statement).run();
    }
  });

  try {
    tx();
  } catch (error) {
    console.warn("Index creation skipped:", error.message);
  }
}

function openDatabase(customPath) {
  const resolvedPath = resolveDbPath(customPath);
  if (!resolvedPath) {
    throw new Error(
      `未找到数据库文件 ${DB_FILE_NAME}。请将数据库放在项目根目录或通过“选择数据库”手动指定。`
    );
  }

  closeDb();
  dbInitError = null;
  dbPath = resolvedPath;

  try {
    db = new Database(resolvedPath, { fileMustExist: true });
    dbWritable = true;
    ensureIndexes();
  } catch (error) {
    db = new Database(resolvedPath, { fileMustExist: true, readonly: true });
    dbWritable = false;
  }

  db.pragma("cache_size = -32000");
  db.pragma("temp_store = MEMORY");
  db.pragma("busy_timeout = 5000");

  return {
    connected: true,
    dbPath,
    writable: dbWritable,
    message: dbWritable ? "数据库已连接（可写）" : "数据库已连接（只读）",
  };
}

function getDbStatus() {
  return {
    connected: Boolean(db),
    dbPath: dbPath || null,
    writable: dbWritable,
    error: dbInitError,
  };
}

function assertDbReady() {
  if (!db) {
    throw new Error("数据库未初始化，请先选择数据库文件。");
  }
}

function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1520,
    height: 920,
    minWidth: 1180,
    minHeight: 760,
    backgroundColor: "#f2ebdc",
    webPreferences: {
      preload: path.join(__dirname, "preload.cjs"),
      contextIsolation: true,
      nodeIntegration: false,
    },
  });

  if (isDev) {
    mainWindow.loadURL("http://localhost:5174");
    mainWindow.webContents.openDevTools({ mode: "detach" });
  } else {
    mainWindow.loadFile(path.join(__dirname, "..", "dist", "index.html"));
  }
}

function createSearchWhere(payload) {
  const where = [];
  const args = [];

  const keywordVariants = buildKeywordVariants(payload.keyword);
  if (keywordVariants.length > 0) {
    const fields = [
      "bm.c_name_chn",
      "bm.c_name",
      "bm.c_name_rm",
      "bm.c_name_proper",
      "bm.c_surname_chn",
      "bm.c_mingzi_chn",
    ];

    const keywordClauses = keywordVariants.map((variant) => {
      const like = escapeLike(variant);
      args.push(...fields.map(() => like), like, like);
      return `(
        ${fields.map((field) => `${field} LIKE ?`).join(" OR ")}
        OR bm.c_personid IN (
          SELECT ad.c_personid
          FROM ALTNAME_DATA ad
          WHERE ad.c_alt_name_chn LIKE ? OR ad.c_alt_name LIKE ?
        )
      )`;
    });

    where.push(`(${keywordClauses.join(" OR ")})`);
  }

  const dynastyId = toInt(payload.dynastyId);
  if (dynastyId !== null && dynastyId !== 0) {
    where.push("bm.c_dy = ?");
    args.push(dynastyId);
  }

  const officeKeyword = String(payload.officeKeyword || "").trim();
  if (officeKeyword) {
    where.push(`
      bm.c_personid IN (
        SELECT p.c_personid
        FROM POSTED_TO_OFFICE_DATA p
        LEFT JOIN OFFICE_CODES o ON o.c_office_id = p.c_office_id
        WHERE o.c_office_chn LIKE ? OR o.c_office_pinyin LIKE ?
      )
    `);
    const like = escapeLike(officeKeyword);
    args.push(like, like);
  }

  const entryKeyword = String(payload.entryKeyword || "").trim();
  if (entryKeyword) {
    where.push(`
      bm.c_personid IN (
        SELECT e.c_personid
        FROM ENTRY_DATA e
        LEFT JOIN ENTRY_CODES ec ON ec.c_entry_code = e.c_entry_code
        WHERE ec.c_entry_desc_chn LIKE ? OR ec.c_entry_desc LIKE ?
      )
    `);
    const like = escapeLike(entryKeyword);
    args.push(like, like);
  }

  return {
    sql: where.length > 0 ? `WHERE ${where.join(" AND ")}` : "",
    args,
    keywordVariants,
  };
}

function searchPeople(payload = {}) {
  assertDbReady();
  const page = clamp(toInt(payload.page, 1), 1, 99999);
  const pageSize = clamp(toInt(payload.pageSize, 20), 10, 80);
  const offset = (page - 1) * pageSize;

  const where = createSearchWhere(payload);

  const countSql = `
    SELECT COUNT(*) AS total
    FROM BIOG_MAIN bm
    ${where.sql}
  `;

  const listSql = `
    SELECT
      bm.c_personid AS personId,
      bm.c_name_chn AS nameChn,
      bm.c_name AS namePinyin,
      bm.c_birthyear AS birthYear,
      bm.c_deathyear AS deathYear,
      bm.c_dy AS dynastyId,
      COALESCE(d.c_dynasty_chn, d.c_dynasty, '未知') AS dynasty,
      (
        SELECT COALESCE(o.c_office_chn, o.c_office_pinyin)
        FROM POSTED_TO_OFFICE_DATA p
        LEFT JOIN OFFICE_CODES o ON o.c_office_id = p.c_office_id
        WHERE p.c_personid = bm.c_personid
        ORDER BY COALESCE(p.c_firstyear, 9999), p.c_sequence
        LIMIT 1
      ) AS firstOffice
    FROM BIOG_MAIN bm
    LEFT JOIN DYNASTIES d ON d.c_dy = bm.c_dy
    ${where.sql}
    ORDER BY bm.c_personid
    LIMIT ? OFFSET ?
  `;

  const total = db.prepare(countSql).get(...where.args).total;
  const items = db.prepare(listSql).all(...where.args, pageSize, offset);

  return {
    total,
    page,
    pageSize,
    items,
    keywordVariants: where.keywordVariants,
  };
}

function getPersonDetail(personId) {
  assertDbReady();
  const pid = toInt(personId);
  if (!pid) {
    throw new Error("无效的人物 ID");
  }

  const person = db
    .prepare(
      `
      SELECT
        bm.c_personid AS personId,
        bm.c_name_chn AS nameChn,
        bm.c_name AS namePinyin,
        bm.c_surname_chn AS surnameChn,
        bm.c_mingzi_chn AS mingziChn,
        bm.c_birthyear AS birthYear,
        bm.c_deathyear AS deathYear,
        bm.c_notes AS notes,
        bm.c_female AS female,
        bm.c_tribe AS tribe,
        bm.c_ethnicity_code AS ethnicityCode,
        bm.c_dy AS dynastyId,
        COALESCE(d.c_dynasty_chn, d.c_dynasty, '未知') AS dynasty,
        COALESCE(et.c_name_chn, et.c_name, '') AS ethnicity
      FROM BIOG_MAIN bm
      LEFT JOIN DYNASTIES d ON d.c_dy = bm.c_dy
      LEFT JOIN ETHNICITY_TRIBE_CODES et ON et.c_ethnicity_code = bm.c_ethnicity_code
      WHERE bm.c_personid = ?
    `
    )
    .get(pid);

  if (!person) {
    return null;
  }

  const offices = db
    .prepare(
      `
      SELECT
        p.c_sequence AS sequence,
        p.c_firstyear AS firstYear,
        p.c_lastyear AS lastYear,
        COALESCE(o.c_office_chn, o.c_office_pinyin, '未详') AS officeName
      FROM POSTED_TO_OFFICE_DATA p
      LEFT JOIN OFFICE_CODES o ON o.c_office_id = p.c_office_id
      WHERE p.c_personid = ?
      ORDER BY COALESCE(p.c_firstyear, 9999), p.c_sequence
      LIMIT 300
    `
    )
    .all(pid);

  const kinships = db
    .prepare(
      `
      SELECT
        k.c_kin_id AS kinId,
        COALESCE(m.c_name_chn, m.c_name, '未详') AS kinName,
        COALESCE(kc.c_kinrel_chn, kc.c_kinrel, '亲属') AS kinRelation
      FROM KIN_DATA k
      LEFT JOIN KINSHIP_CODES kc ON kc.c_kincode = k.c_kin_code
      LEFT JOIN BIOG_MAIN m ON m.c_personid = k.c_kin_id
      WHERE k.c_personid = ?
      LIMIT 400
    `
    )
    .all(pid);

  const entries = db
    .prepare(
      `
      SELECT
        e.c_year AS year,
        e.c_exam_rank AS examRank,
        e.c_exam_field AS examField,
        COALESCE(ec.c_entry_desc_chn, ec.c_entry_desc, '未详') AS entryType
      FROM ENTRY_DATA e
      LEFT JOIN ENTRY_CODES ec ON ec.c_entry_code = e.c_entry_code
      WHERE e.c_personid = ?
      ORDER BY COALESCE(e.c_year, 9999), e.c_sequence
      LIMIT 200
    `
    )
    .all(pid);

  const associations = db
    .prepare(
      `
      SELECT
        a.c_assoc_id AS targetId,
        COALESCE(m.c_name_chn, m.c_name, '未详') AS targetName,
        COALESCE(ac.c_assoc_desc_chn, ac.c_assoc_desc, '社会关系') AS relation,
        a.c_assoc_first_year AS firstYear,
        a.c_assoc_last_year AS lastYear
      FROM ASSOC_DATA a
      LEFT JOIN ASSOC_CODES ac ON ac.c_assoc_code = a.c_assoc_code
      LEFT JOIN BIOG_MAIN m ON m.c_personid = a.c_assoc_id
      WHERE a.c_personid = ?
      LIMIT 400
    `
    )
    .all(pid);

  const addresses = db
    .prepare(
      `
      SELECT
        ba.c_addr_id AS addrId,
        COALESCE(addr.c_name_chn, addr.c_name, '未详') AS addrName,
        COALESCE(bac.c_addr_desc_chn, bac.c_addr_desc, '活动地点') AS addrType,
        addr.x_coord AS longitude,
        addr.y_coord AS latitude,
        ba.c_firstyear AS firstYear,
        ba.c_lastyear AS lastYear
      FROM BIOG_ADDR_DATA ba
      LEFT JOIN ADDR_CODES addr ON addr.c_addr_id = ba.c_addr_id
      LEFT JOIN BIOG_ADDR_CODES bac ON bac.c_addr_type = ba.c_addr_type
      WHERE ba.c_personid = ?
      ORDER BY COALESCE(ba.c_firstyear, 9999), ba.c_sequence
      LIMIT 500
    `
    )
    .all(pid);

  return {
    person,
    offices,
    kinships,
    entries,
    associations,
    addresses,
  };
}

function getRelationshipGraph(personId) {
  assertDbReady();
  const pid = toInt(personId);
  if (!pid) {
    throw new Error("无效的人物 ID");
  }

  const root = db
    .prepare(
      `
      SELECT c_personid AS id, COALESCE(c_name_chn, c_name, '未详') AS name
      FROM BIOG_MAIN
      WHERE c_personid = ?
    `
    )
    .get(pid);

  if (!root) {
    return { nodes: [], links: [] };
  }

  const kinLinks = db
    .prepare(
      `
      SELECT
        k.c_kin_id AS targetId,
        COALESCE(m.c_name_chn, m.c_name, '未详') AS targetName,
        COALESCE(kc.c_kinrel_chn, kc.c_kinrel, '亲属') AS relation,
        'family' AS relationType
      FROM KIN_DATA k
      LEFT JOIN KINSHIP_CODES kc ON kc.c_kincode = k.c_kin_code
      LEFT JOIN BIOG_MAIN m ON m.c_personid = k.c_kin_id
      WHERE k.c_personid = ?
      LIMIT 120
    `
    )
    .all(pid);

  const socialLinks = db
    .prepare(
      `
      SELECT
        a.c_assoc_id AS targetId,
        COALESCE(m.c_name_chn, m.c_name, '未详') AS targetName,
        COALESCE(ac.c_assoc_desc_chn, ac.c_assoc_desc, '社会关系') AS relation,
        'social' AS relationType
      FROM ASSOC_DATA a
      LEFT JOIN ASSOC_CODES ac ON ac.c_assoc_code = a.c_assoc_code
      LEFT JOIN BIOG_MAIN m ON m.c_personid = a.c_assoc_id
      WHERE a.c_personid = ? AND a.c_assoc_id IS NOT NULL AND a.c_assoc_id != 0
      LIMIT 200
    `
    )
    .all(pid);

  const nodesById = new Map();
  nodesById.set(root.id, {
    id: String(root.id),
    name: root.name,
    category: "root",
    symbolSize: 52,
  });

  const links = [];
  const edgeKeys = new Set();
  const allLinks = [...kinLinks, ...socialLinks];

  for (const row of allLinks) {
    const targetId = String(row.targetId || "");
    if (!targetId) {
      continue;
    }

    if (!nodesById.has(targetId)) {
      nodesById.set(targetId, {
        id: targetId,
        name: row.targetName || `人物 ${targetId}`,
        category: row.relationType === "family" ? "family" : "social",
        symbolSize: row.relationType === "family" ? 32 : 26,
      });
    }

    const edgeKey = `${root.id}|${targetId}|${row.relation}`;
    if (edgeKeys.has(edgeKey)) {
      continue;
    }
    edgeKeys.add(edgeKey);

    links.push({
      source: String(root.id),
      target: targetId,
      name: row.relation,
      relationType: row.relationType,
    });
  }

  return {
    nodes: Array.from(nodesById.values()),
    links,
    rootId: String(root.id),
    rootName: root.name,
  };
}

function buildGeoWhere(params) {
  const where = ["addr.x_coord IS NOT NULL", "addr.y_coord IS NOT NULL"];
  const args = [];

  const dynastyId = toInt(params.dynastyId);
  if (dynastyId && dynastyId > 0) {
    where.push("bm.c_dy = ?");
    args.push(dynastyId);
  }

  const startYear = toInt(params.startYear);
  if (startYear !== null) {
    where.push("COALESCE(ba.c_firstyear, ba.c_lastyear) >= ?");
    args.push(startYear);
  }

  const endYear = toInt(params.endYear);
  if (endYear !== null) {
    where.push("COALESCE(ba.c_lastyear, ba.c_firstyear) <= ?");
    args.push(endYear);
  }

  return {
    sql: `WHERE ${where.join(" AND ")}`,
    args,
  };
}

function getGeoDistribution(payload = {}) {
  assertDbReady();
  const limit = clamp(toInt(payload.limit, 1200), 200, 2000);
  const personId = toInt(payload.personId);
  const where = buildGeoWhere(payload);

  if (personId) {
    const points = db
      .prepare(
        `
        SELECT
          ba.c_addr_id AS addrId,
          COALESCE(addr.c_name_chn, addr.c_name, '未知地点') AS addrName,
          COALESCE(bac.c_addr_desc_chn, bac.c_addr_desc, '活动地点') AS addrType,
          addr.x_coord AS longitude,
          addr.y_coord AS latitude,
          ba.c_firstyear AS firstYear,
          ba.c_lastyear AS lastYear
        FROM BIOG_ADDR_DATA ba
        LEFT JOIN BIOG_MAIN bm ON bm.c_personid = ba.c_personid
        LEFT JOIN ADDR_CODES addr ON addr.c_addr_id = ba.c_addr_id
        LEFT JOIN BIOG_ADDR_CODES bac ON bac.c_addr_type = ba.c_addr_type
        ${where.sql} AND ba.c_personid = ?
        ORDER BY COALESCE(ba.c_firstyear, 9999), ba.c_sequence
        LIMIT ?
      `
      )
      .all(...where.args, personId, limit);

    const timeline = db
      .prepare(
        `
        SELECT
          COALESCE(ba.c_firstyear, ba.c_lastyear) AS year,
          COUNT(*) AS count
        FROM BIOG_ADDR_DATA ba
        LEFT JOIN BIOG_MAIN bm ON bm.c_personid = ba.c_personid
        LEFT JOIN ADDR_CODES addr ON addr.c_addr_id = ba.c_addr_id
        ${where.sql} AND ba.c_personid = ? AND COALESCE(ba.c_firstyear, ba.c_lastyear) IS NOT NULL
        GROUP BY year
        ORDER BY year
      `
      )
      .all(...where.args, personId);

    return {
      mode: "person",
      points,
      timeline,
    };
  }

  const points = db
    .prepare(
      `
      SELECT
        ba.c_addr_id AS addrId,
        COALESCE(addr.c_name_chn, addr.c_name, '未知地点') AS addrName,
        addr.x_coord AS longitude,
        addr.y_coord AS latitude,
        COUNT(DISTINCT ba.c_personid) AS personCount
      FROM BIOG_ADDR_DATA ba
      LEFT JOIN BIOG_MAIN bm ON bm.c_personid = ba.c_personid
      LEFT JOIN ADDR_CODES addr ON addr.c_addr_id = ba.c_addr_id
      ${where.sql}
      GROUP BY ba.c_addr_id
      ORDER BY personCount DESC
      LIMIT ?
    `
    )
    .all(...where.args, limit);

  const timeline = db
    .prepare(
      `
      SELECT
        (COALESCE(ba.c_firstyear, ba.c_lastyear) / 10) * 10 AS decade,
        COUNT(*) AS count
      FROM BIOG_ADDR_DATA ba
      LEFT JOIN BIOG_MAIN bm ON bm.c_personid = ba.c_personid
      LEFT JOIN ADDR_CODES addr ON addr.c_addr_id = ba.c_addr_id
      ${where.sql} AND COALESCE(ba.c_firstyear, ba.c_lastyear) IS NOT NULL
      GROUP BY decade
      ORDER BY decade
    `
    )
    .all(...where.args);

  return {
    mode: "aggregate",
    points,
    timeline,
  };
}

function getStatsOverview() {
  assertDbReady();

  const summary = {
    people: db.prepare("SELECT COUNT(*) AS count FROM BIOG_MAIN").get().count,
    offices: db
      .prepare("SELECT COUNT(*) AS count FROM POSTED_TO_OFFICE_DATA")
      .get().count,
    kinships: db.prepare("SELECT COUNT(*) AS count FROM KIN_DATA").get().count,
    entries: db.prepare("SELECT COUNT(*) AS count FROM ENTRY_DATA").get().count,
    associations: db
      .prepare("SELECT COUNT(*) AS count FROM ASSOC_DATA")
      .get().count,
  };

  const dynastyDistribution = db
    .prepare(
      `
      SELECT
        bm.c_dy AS dynastyId,
        COALESCE(d.c_dynasty_chn, d.c_dynasty, '未知') AS dynasty,
        COUNT(*) AS count
      FROM BIOG_MAIN bm
      LEFT JOIN DYNASTIES d ON d.c_dy = bm.c_dy
      GROUP BY bm.c_dy
      ORDER BY count DESC
      LIMIT 30
    `
    )
    .all();

  const entryTrend = db
    .prepare(
      `
      SELECT
        (c_year / 10) * 10 AS decade,
        COUNT(*) AS count
      FROM ENTRY_DATA
      WHERE c_year IS NOT NULL AND c_year > 0
      GROUP BY decade
      ORDER BY decade
    `
    )
    .all();

  const officeDistribution = db
    .prepare(
      `
      SELECT
        COALESCE(o.c_office_chn, o.c_office_pinyin, '未详官职') AS office,
        COUNT(*) AS count
      FROM POSTED_TO_OFFICE_DATA p
      LEFT JOIN OFFICE_CODES o ON o.c_office_id = p.c_office_id
      GROUP BY p.c_office_id
      ORDER BY count DESC
      LIMIT 20
    `
    )
    .all();

  const familyNetworkScale = db
    .prepare(
      `
      SELECT
        k.c_personid AS personId,
        COALESCE(m.c_name_chn, m.c_name, '未详') AS name,
        COUNT(*) AS kinCount
      FROM KIN_DATA k
      LEFT JOIN BIOG_MAIN m ON m.c_personid = k.c_personid
      GROUP BY k.c_personid
      ORDER BY kinCount DESC
      LIMIT 20
    `
    )
    .all();

  return {
    summary,
    dynastyDistribution,
    entryTrend,
    officeDistribution,
    familyNetworkScale,
  };
}

function getDynasties() {
  assertDbReady();
  return db
    .prepare(
      `
      SELECT
        c_dy AS dynastyId,
        COALESCE(c_dynasty_chn, c_dynasty, '未知') AS dynastyName,
        c_start AS startYear,
        c_end AS endYear
      FROM DYNASTIES
      ORDER BY c_sort, c_start
    `
    )
    .all();
}

ipcMain.handle("db:get-status", () => getDbStatus());

ipcMain.handle("db:pick-file", async () => {
  const result = await dialog.showOpenDialog({
    title: "选择 CBDB SQLite 数据库",
    properties: ["openFile"],
    filters: [{ name: "SQLite", extensions: ["sqlite", "sqlite3", "db"] }],
  });

  if (result.canceled || result.filePaths.length === 0) {
    return { canceled: true };
  }

  const opened = openDatabase(result.filePaths[0]);
  return { canceled: false, ...opened };
});

ipcMain.handle("search:people", (_, payload) => searchPeople(payload));
ipcMain.handle("person:detail", (_, personId) => getPersonDetail(personId));
ipcMain.handle("graph:relations", (_, personId) => getRelationshipGraph(personId));
ipcMain.handle("geo:distribution", (_, payload) => getGeoDistribution(payload));
ipcMain.handle("stats:overview", () => getStatsOverview());
ipcMain.handle("lookup:dynasties", () => getDynasties());

app.whenReady().then(() => {
  try {
    openDatabase();
  } catch (error) {
    dbInitError = error.message;
  }

  createWindow();

  app.on("activate", () => {
    if (BrowserWindow.getAllWindows().length === 0) {
      createWindow();
    }
  });
});

app.on("window-all-closed", () => {
  if (process.platform !== "darwin") {
    app.quit();
  }
});

app.on("before-quit", () => {
  closeDb();
});
