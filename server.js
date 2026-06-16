const express = require("express");
const cors = require("cors");
const fs = require("fs");
const path = require("path");

const app = express();
app.use(cors());
app.use(express.json({ limit: "10mb" }));

const DATA_DIR = path.join(__dirname, "data");
const REPORTS_FILE = path.join(DATA_DIR, "reports.json");
const SCORES_FILE = path.join(DATA_DIR, "scores.json");
const DATAMODE_FILE = path.join(DATA_DIR, "datamode.json");
const SESSIONS_FILE = path.join(DATA_DIR, "sessions.json");

if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });

function readJSON(filepath, fallback) {
  try {
    if (fs.existsSync(filepath)) return JSON.parse(fs.readFileSync(filepath, "utf-8"));
  } catch {}
  return fallback;
}

function writeJSON(filepath, data) {
  fs.writeFileSync(filepath, JSON.stringify(data, null, 2), "utf-8");
}

const clinics = [
  { id: "aiya", clinic: "艾雅口腔", fullName: "绵阳游仙区艾雅口腔", team: "春花正畸先锋队", password: "123456", city: "四川绵阳", target: 2300000, lastSummer: 1290000, seats: 6, coach: "待定", status: "active" },
  { id: "koufang", clinic: "寇芳口腔", fullName: "淄川洪山寇芳口腔诊所", team: "卓越队", password: "123456", city: "山东淄博", target: 30000, lastSummer: 10000, seats: 5, coach: "待定", status: "active" },
  { id: "aiyashi", clinic: "爱牙仕口腔", fullName: "湖南省邵东市爱牙仕口腔", team: "仕不可挡", password: "123456", city: "湖南邵东", target: 600000, lastSummer: 400000, seats: 9, coach: "待定", status: "active" },
  { id: "sunjunli", clinic: "孙俊莉口腔", fullName: "太原孙俊莉口腔门诊部", team: "必胜队", password: "123456", city: "山西太原", target: 600000, lastSummer: 453310, seats: 8, coach: "待定", status: "active" },
  { id: "erbao", clinic: "二宝口腔", fullName: "内蒙古通辽市扎鲁特旗二宝口腔门诊部", team: "二宝口腔队", password: "123456", city: "内蒙古通辽", target: 1000000, lastSummer: 650000, seats: 12, coach: "待定", status: "active" },
  { id: "huoshi", clinic: "霍氏口腔", fullName: "霍氏口腔", team: "霍氏王牌队", password: "123456", city: "河南济源", target: 1170000, lastSummer: 900000, seats: 14, coach: "待定", status: "active" },
  { id: "jiaxiang", clinic: "嘉祥口腔", fullName: "嘉祥口腔医院", team: "嘉祥口腔队", password: "123456", city: "山东济宁", target: 6110000, lastSummer: 4700000, seats: 26, coach: "待定", status: "active" },
  { id: "haiyang", clinic: "海阳口腔", fullName: "太原海阳口腔", team: "冲锋队", password: "123456", city: "山西太原", target: 250000, lastSummer: 150000, seats: 9, coach: "待定", status: "active" },
  { id: "zhenghe", clinic: "正合口腔", fullName: "正合口腔诊所", team: "正合火焰队", password: "123456", city: "河北张家口", target: 500000, lastSummer: 321010, seats: 11, coach: "不参与暑期陪跑", status: "observer" },
];

const staffAccounts = [
  { username: "教练组", password: "123456", role: "coach", name: "教练组" },
  { username: "瑾言管理组", password: "123456", role: "admin", name: "瑾言管理组" },
];

function generateToken() {
  return "tk_" + Date.now().toString(36) + "_" + Math.random().toString(36).slice(2, 8);
}

function authMiddleware(req, res, next) {
  const token = req.headers["x-auth-token"];
  if (!token) return res.status(401).json({ error: "未登录" });
  const sessions = readJSON(SESSIONS_FILE, {});
  const session = sessions[token];
  if (!session) return res.status(401).json({ error: "登录已过期" });
  req.session = session;
  req.token = token;
  next();
}

function coachOnly(req, res, next) {
  if (!req.session || (req.session.type !== "coach" && req.session.type !== "admin")) {
    return res.status(403).json({ error: "无权限" });
  }
  next();
}

/* ===== 登录 ===== */
app.post("/api/login", (req, res) => {
  const { username, password, mode } = req.body;
  if (!username || !password) return res.status(400).json({ error: "用户名和密码不能为空" });

  if (mode === "internal") {
    const account = staffAccounts.find(a => a.username === username && a.password === password);
    if (!account) return res.status(401).json({ error: "内部账号或密码不正确" });
    const token = generateToken();
    const sessions = readJSON(SESSIONS_FILE, {});
    sessions[token] = { type: account.role, name: account.name, createdAt: Date.now() };
    writeJSON(SESSIONS_FILE, sessions);
    return res.json({ token, session: sessions[token] });
  }

  const clinic = clinics.find(c => c.team === username && c.password === password);
  if (!clinic) return res.status(401).json({ error: "门诊队名或密码不正确" });
  const token = generateToken();
  const sessions = readJSON(SESSIONS_FILE, {});
  sessions[token] = { type: "clinic", clinicId: clinic.id, name: clinic.team, createdAt: Date.now() };
  writeJSON(SESSIONS_FILE, sessions);
  return res.json({ token, session: sessions[token], clinic });
});

/* ===== 获取全量状态 ===== */
app.get("/api/state", authMiddleware, (req, res) => {
  const reports = readJSON(REPORTS_FILE, []);
  const coachScores = readJSON(SCORES_FILE, {});
  const dataMode = readJSON(DATAMODE_FILE, "official-empty");

  let visibleReports = reports;
  if (req.session.type === "clinic") {
    visibleReports = reports.filter(r => r.clinicId === req.session.clinicId);
  }

  res.json({ reports: visibleReports, coachScores, dataMode });
});

/* ===== 提交日报 ===== */
app.post("/api/reports", authMiddleware, (req, res) => {
  const report = req.body;
  if (req.session.type === "clinic" && report.clinicId !== req.session.clinicId) {
    return res.status(403).json({ error: "只能提交本门诊数据" });
  }
  if (!report.clinicId || !report.date) {
    return res.status(400).json({ error: "缺少门诊或日期" });
  }
  report.id = report.id || "report-" + Date.now();
  report.status = report.status || "pending";
  report.reviewer = report.reviewer || "";
  report.note = report.note || "门诊提交，待审核";

  const reports = readJSON(REPORTS_FILE, []);
  const idx = reports.findIndex(r => r.clinicId === report.clinicId && r.date === report.date);
  if (idx >= 0) {
    reports[idx] = report;
  } else {
    reports.unshift(report);
  }
  writeJSON(REPORTS_FILE, reports);
  res.json({ ok: true, report });
});

/* ===== 审核通过 ===== */
app.put("/api/reports/:id/approve", authMiddleware, coachOnly, (req, res) => {
  const reports = readJSON(REPORTS_FILE, []);
  const report = reports.find(r => r.id === req.params.id);
  if (!report) return res.status(404).json({ error: "日报不存在" });
  report.status = "approved";
  report.reviewer = req.session.name;
  report.note = report.note || "审核通过";
  writeJSON(REPORTS_FILE, reports);
  res.json({ ok: true, report });
});

/* ===== 审核退回 ===== */
app.put("/api/reports/:id/reject", authMiddleware, coachOnly, (req, res) => {
  const reports = readJSON(REPORTS_FILE, []);
  const report = reports.find(r => r.id === req.params.id);
  if (!report) return res.status(404).json({ error: "日报不存在" });
  report.status = "rejected";
  report.reviewer = req.session.name;
  report.note = "教练组退回：请核对日报数据、凭证和实收金额";
  writeJSON(REPORTS_FILE, reports);
  res.json({ ok: true, report });
});

/* ===== 保存甘特评分 ===== */
app.put("/api/scores/gantt", authMiddleware, coachOnly, (req, res) => {
  const scores = req.body;
  const coachScores = readJSON(SCORES_FILE, {});
  Object.assign(coachScores, scores);
  writeJSON(SCORES_FILE, coachScores);
  res.json({ ok: true, coachScores });
});

/* ===== 载入演示数据 ===== */
app.post("/api/demo/load", authMiddleware, coachOnly, (req, res) => {
  writeJSON(REPORTS_FILE, []);
  writeJSON(DATAMODE_FILE, "demo");
  writeJSON(SCORES_FILE, {
    aiya: 24, koufang: 12, aiyashi: 25, sunjunli: 18,
    erbao: 21, huoshi: 27, jiaxiang: 26, haiyang: 17,
  });
  res.json({ ok: true, dataMode: "demo", coachScores: readJSON(SCORES_FILE, {}) });
});

/* ===== 清空数据 ===== */
app.post("/api/data/clear", authMiddleware, coachOnly, (req, res) => {
  writeJSON(REPORTS_FILE, []);
  writeJSON(SCORES_FILE, {});
  writeJSON(DATAMODE_FILE, "official-empty");
  res.json({ ok: true, dataMode: "official-empty" });
});

/* ===== 健康检查 ===== */
app.get("/api/health", (req, res) => {
  res.json({ ok: true, time: new Date().toISOString() });
});

/* ===== clinics 配置 ===== */
app.get("/api/clinics", (req, res) => {
  res.json(clinics);
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`瑾言PK看板后端运行在端口 ${PORT}`);
});
