const express = require("express");
const cors = require("cors");
const fs = require("fs");
const path = require("path");

const app = express();
app.use(cors());
app.use(express.json({ limit: "10mb" }));

const DATA_DIR = path.join(__dirname, "data");

/* ===== 环境检测中间件：支持 ?env=beta 或 X-Env: beta ===== */
app.use((req, res, next) => {
  const env = req.query.env || req.headers["x-env"] || "prod";
  req.dataEnv = env;
  req.dataDir = env === "beta" ? path.join(DATA_DIR, "beta") : DATA_DIR;
  if (!fs.existsSync(req.dataDir)) fs.mkdirSync(req.dataDir, { recursive: true });

  // 绑定到当前请求的读写辅助函数
  req.readJSON = (filename, fallback) => {
    const fp = path.join(req.dataDir, filename);
    try { if (fs.existsSync(fp)) return JSON.parse(fs.readFileSync(fp, "utf-8")); }
    catch (e) {}
    return fallback;
  };
  req.writeJSON = (filename, data) => {
    fs.writeFileSync(path.join(req.dataDir, filename), JSON.stringify(data, null, 2), "utf-8");
  };
  req.appendAuditLog = (action, operator, detail) => {
    const logs = req.readJSON("audit.log.json", []);
    logs.push({ ts: new Date().toISOString(), action, operator, detail });
    if (logs.length > 500) logs.splice(0, logs.length - 500);
    req.writeJSON("audit.log.json", logs);
  };
  // 自动备份：每次写 reports.json 前调用，保存当前快照
  req.backupReports = (label) => {
    const current = req.readJSON("reports.json", []);
    if (!current.length) return; // 空数据不备份
    const backups = req.readJSON("reports.backups.json", []);
    backups.push({
      ts: new Date().toISOString(),
      label: label || "auto",
      count: current.length,
      data: current,
    });
    if (backups.length > 20) backups.splice(0, backups.length - 20);
    req.writeJSON("reports.backups.json", backups);
  };
  next();
});

/* ===== clinics 配置（全局共享，不区分环境） ===== */
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

function getClinicPassword(clinicId) {
  // 密码文件共享，不区分环境
  const fp = path.join(DATA_DIR, "clinic_passwords.json");
  try { if (fs.existsSync(fp)) { const overrides = JSON.parse(fs.readFileSync(fp, "utf-8")); return overrides[clinicId] || null; } }
  catch (e) {}
  return null;
}

function validateClinicAuth(team, password) {
  const clinic = clinics.find(c => c.team === team);
  if (!clinic) return null;
  const pwd = getClinicPassword(clinic.id) || clinic.password;
  if (password !== pwd) return null;
  return clinic;
}

function generateToken() {
  return "tk_" + Date.now().toString(36) + "_" + Math.random().toString(36).slice(2, 8);
}

function authMiddleware(req, res, next) {
  const token = req.headers["x-auth-token"];
  if (!token) return res.status(401).json({ error: "未登录" });
  // sessions 不区分环境，同一个 token 在两个环境都有效
  const fp = path.join(DATA_DIR, "sessions.json");
  try {
    if (fs.existsSync(fp)) {
      const sessions = JSON.parse(fs.readFileSync(fp, "utf-8"));
      const session = sessions[token];
      if (!session) return res.status(401).json({ error: "登录已过期" });
      req.session = session;
      req.token = token;
      return next();
    }
  } catch (e) {}
  return res.status(401).json({ error: "登录已过期" });
}

function coachOnly(req, res, next) {
  if (!req.session || (req.session.type !== "coach" && req.session.type !== "admin")) {
    return res.status(403).json({ error: "无权限" });
  }
  next();
}

/* ===== 登录（sessions 共享，不区分环境） ===== */
app.post("/api/login", (req, res) => {
  const { username, password, mode } = req.body;
  if (!username || !password) return res.status(400).json({ error: "用户名和密码不能为空" });

  if (mode === "internal") {
    const account = staffAccounts.find(a => a.username === username && a.password === password);
    if (!account) return res.status(401).json({ error: "内部账号或密码不正确" });
    const token = generateToken();
    const fp = path.join(DATA_DIR, "sessions.json");
    const sessions = (() => { try { return fs.existsSync(fp) ? JSON.parse(fs.readFileSync(fp, "utf-8")) : {}; } catch (e) { return {}; } })();
    sessions[token] = { type: account.role, name: account.name, createdAt: Date.now() };
    fs.writeFileSync(fp, JSON.stringify(sessions, null, 2), "utf-8");
    return res.json({ token, session: sessions[token], env: req.dataEnv });
  }

  const clinic = validateClinicAuth(username, password);
  if (!clinic) return res.status(401).json({ error: "门诊队名或密码不正确" });
  if (clinic.status !== "active") return res.status(403).json({ error: "该门诊暂未参赛" });
  const token = generateToken();
  const fp = path.join(DATA_DIR, "sessions.json");
  const sessions = (() => { try { return fs.existsSync(fp) ? JSON.parse(fs.readFileSync(fp, "utf-8")) : {}; } catch (e) { return {}; } })();
  sessions[token] = { type: "clinic", clinicId: clinic.id, name: clinic.team, createdAt: Date.now() };
  fs.writeFileSync(fp, JSON.stringify(sessions, null, 2), "utf-8");
  return res.json({ token, session: sessions[token], clinic, env: req.dataEnv });
});

/* ===== 获取全量状态 ===== */
app.get("/api/state", authMiddleware, (req, res) => {
  const reports = req.readJSON("reports.json", []);
  const coachScores = req.readJSON("scores.json", {});
  const dataMode = req.readJSON("datamode.json", "official-empty");

  let visibleReports = reports;
  if (req.session.type === "clinic") {
    // 门诊端：自己的所有数据 + 其他门诊的已审核数据（用于排名）
    const myId = req.session.clinicId;
    visibleReports = reports.filter(r =>
      r.clinicId === myId || r.status === "approved"
    );
  }

  res.json({ reports: visibleReports, coachScores, dataMode, env: req.dataEnv });
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

  const reports = req.readJSON("reports.json", []);
  const idx = reports.findIndex(r => r.clinicId === report.clinicId && r.date === report.date);
  if (idx >= 0) {
    reports[idx] = report;
  } else {
    reports.unshift(report);
  }
  req.backupReports("write-reports");
  req.writeJSON("reports.json", reports);
  res.json({ ok: true, report });
});

/* ===== 读取日报 ===== */
app.get("/api/reports", authMiddleware, (req, res) => {
  const reports = req.readJSON("reports.json", []);
  const { clinicId } = req.query;
  if (clinicId) {
    return res.json(reports.filter(r => r.clinicId === clinicId));
  }
  res.json(reports);
});

/* ===== 批量导入日报（教练组） ===== */
app.post("/api/reports/batch", authMiddleware, coachOnly, (req, res) => {
  const { clinicId, reports: incoming } = req.body;
  if (!clinicId || !Array.isArray(incoming) || !incoming.length) {
    return res.status(400).json({ error: "缺少 clinicId 或 reports 数组" });
  }
  const clinic = clinics.find(c => c.id === clinicId);
  if (!clinic) return res.status(400).json({ error: "未知门诊ID" });

  const current = req.readJSON("reports.json", []);
  let imported = 0, skipped = 0;
  incoming.forEach(item => {
    if (!item.clinicId || !item.date) { skipped++; return; }
    const idx = current.findIndex(r => r.clinicId === item.clinicId && r.date === item.date);
    // 标记为教练组导入
    item.status = item.status || "pending";
    item.reviewer = item.reviewer || "";
    item.note = item.note || req.session.name + " 从本地导入";
    item.id = item.id || "import-" + Date.now() + "-" + Math.random().toString(36).slice(2,6);
    if (idx >= 0) {
      // 不覆盖已审核的数据
      if (current[idx].status === "approved") { skipped++; return; }
      current[idx] = item;
      imported++;
    } else {
      current.unshift(item);
      imported++;
    }
  });
  req.backupReports("batch-import-" + clinicId);
  req.writeJSON("reports.json", current);
  req.appendAuditLog("batch-import", req.session.name, clinicId + " 导入 " + imported + " 条，跳过 " + skipped);
  res.json({ ok: true, imported, skipped });
});

/* ===== 审核通过 ===== */
app.put("/api/reports/:id/approve", authMiddleware, coachOnly, (req, res) => {
  const reports = req.readJSON("reports.json", []);
  const report = reports.find(r => r.id === req.params.id);
  if (!report) return res.status(404).json({ error: "日报不存在" });
  report.status = "approved";
  report.reviewer = req.session.name;
  report.note = report.note || "审核通过";
  req.backupReports("write-reports");
  req.writeJSON("reports.json", reports);
  res.json({ ok: true, report });
});

/* ===== 审核退回 ===== */
app.put("/api/reports/:id/reject", authMiddleware, coachOnly, (req, res) => {
  const reports = req.readJSON("reports.json", []);
  const report = reports.find(r => r.id === req.params.id);
  if (!report) return res.status(404).json({ error: "日报不存在" });
  report.status = "rejected";
  report.reviewer = req.session.name;
  report.note = "教练组退回：请核对日报数据、凭证和实收金额";
  req.backupReports("reject-" + report.clinicId + "-" + report.date);
  req.writeJSON("reports.json", reports);
  req.appendAuditLog("reject", req.session.name, { reportId: req.params.id, clinicId: report.clinicId, date: report.date });
  res.json({ ok: true, report });
});

/* ===== 删除日报 ===== */
app.delete("/api/reports/:id", authMiddleware, coachOnly, (req, res) => {
  let reports = req.readJSON("reports.json", []);
  const report = reports.find(r => r.id === req.params.id);
  if (!report) return res.status(404).json({ error: "日报不存在" });
  reports = reports.filter(r => r.id !== req.params.id);
  req.backupReports("delete-" + report.clinicId + "-" + report.date);
  req.writeJSON("reports.json", reports);
  req.appendAuditLog("delete", req.session.name, { reportId: req.params.id, clinicId: report.clinicId, date: report.date });
  res.json({ ok: true });
});

/* ===== 保存甘特评分 ===== */
app.put("/api/scores/gantt", authMiddleware, coachOnly, (req, res) => {
  const scores = req.body;
  const coachScores = req.readJSON("scores.json", {});
  Object.assign(coachScores, scores);
  req.writeJSON("scores.json", coachScores);
  res.json({ ok: true, coachScores });
});

/* ===== 演示数据种子（共享，不区分环境） ===== */
const seedReports = [
  ["aiya","2026-06-13",13,4,12,11,15,8,28,28,26,3,"早矫/隐形",4,128000,2,1,120000,"approved"],
  ["koufang","2026-06-13",3,1,3,3,4,2,10,6,7,1,"托槽",1,12000,0,0,10000,"pending"],
  ["aiyashi","2026-06-13",15,6,14,13,17,9,32,32,30,4,"早矫/全周期/隐形",4,98000,1,1,90000,"approved"],
  ["sunjunli","2026-06-13",8,3,7,6,8,5,18,15,14,2,"托槽/隐形",2,62000,1,0,55000,"pending"],
  ["erbao","2026-06-13",9,4,9,8,10,5,22,21,18,2,"全周期",2,86000,2,1,80000,"approved"],
  ["huoshi","2026-06-13",16,7,15,14,18,10,35,35,34,4,"早矫/托槽/隐形",5,142000,2,1,130000,"approved"],
  ["jiaxiang","2026-06-13",27,11,25,23,29,16,68,67,66,7,"早矫/全周期/托槽/隐形",7,238000,4,2,230000,"pending"],
  ["haiyang","2026-06-13",5,2,5,5,6,3,14,12,11,1,"隐形",1,26000,1,0,22000,"approved"],
  ["aiya","2026-06-14",14,5,13,12,16,9,31,31,28,3,"早矫/隐形",3,116000,1,1,110000,"pending"],
  ["aiyashi","2026-06-14",12,5,13,12,14,8,29,28,27,3,"全周期/隐形",3,89000,2,1,85000,"approved"],
  ["huoshi","2026-06-14",17,7,17,15,19,11,37,37,36,5,"早矫/托槽/隐形",5,168000,1,1,150000,"pending"],
  ["jiaxiang","2026-06-14",28,12,26,24,31,18,72,72,70,7,"早矫/全周期/托槽/隐形",7,276000,5,3,250000,"approved"],
].map(([clinicId, date, nonOrthoPotential, nonOrthoCardSales, orthoFirst, orthoCardSales, cardSales, cardToOrtho, visits, platformCheckins, educationCount, companionDevelopment, dealProjects, closedDeals, cash, lost, recoveredLost, tomorrowTarget, status], index) => ({
  id: `demo-${index}`, clinicId, date,
  nonOrthoPotential: Number(nonOrthoPotential), nonOrthoCardSales: Number(nonOrthoCardSales),
  orthoFirst: Number(orthoFirst), orthoCardSales: Number(orthoCardSales),
  cardSales: Number(cardSales), cardToOrtho: Number(cardToOrtho),
  visits: Number(visits), platformCheckins: Number(platformCheckins),
  educationCount: Number(educationCount), companionDevelopment: Number(companionDevelopment),
  dealProjects: String(dealProjects), closedDeals: Number(closedDeals),
  cash: Number(cash), lost: Number(lost), recoveredLost: Number(recoveredLost),
  tomorrowTarget: Number(tomorrowTarget), status,
  reviewer: status === "approved" ? "教练组" : "",
  note: status === "pending" ? "待核对实收金额与执行凭证" : "数据已核对",
}));

/* ===== 载入演示数据 ===== */
app.post("/api/demo/load", authMiddleware, coachOnly, (req, res) => {
  req.writeJSON("reports.json", seedReports);
  req.writeJSON("datamode.json", "demo");
  req.writeJSON("scores.json", {
    aiya: 24, koufang: 12, aiyashi: 25, sunjunli: 18,
    erbao: 21, huoshi: 27, jiaxiang: 26, haiyang: 17,
  });
  res.json({ ok: true, dataMode: "demo", coachScores: req.readJSON("scores.json", {}) });
});

/* ===== 清空数据（需确认，自动备份） ===== */
app.post("/api/data/clear", authMiddleware, coachOnly, (req, res) => {
  if (!req.body.confirm) {
    return res.status(400).json({ error: "请二次确认：发送 { confirm: true } 以清空所有数据" });
  }
  req.backupReports("clear-" + new Date().toISOString().slice(0, 10));
  req.writeJSON("reports.json", []);
  req.writeJSON("scores.json", {});
  req.writeJSON("datamode.json", "official-empty");
  req.appendAuditLog("clear-data", req.session.name, { confirmed: true });
  res.json({ ok: true, dataMode: "official-empty", backedUp: true });
});

/* ===== 客户端数据恢复（前端备份同步到后端） ===== */
app.post("/api/data/restore", authMiddleware, coachOnly, (req, res) => {
  const { reports, coachScores, dataMode } = req.body;
  if (!Array.isArray(reports)) return res.status(400).json({ error: "缺少 reports 数据" });
  req.backupReports("restore-" + new Date().toISOString().slice(0, 10));
  req.writeJSON("reports.json", reports);
  req.writeJSON("scores.json", coachScores || {});
  req.writeJSON("datamode.json", dataMode || "official-empty");
  req.appendAuditLog("restore-data", req.session.name, { reportCount: reports.length });
  res.json({ ok: true, count: reports.length });
});

/* ===== 备份下载（教练组） ===== */
app.get("/api/backup/download", authMiddleware, coachOnly, (req, res) => {
  const backups = req.readJSON("reports.backups.json", []);
  const reports = req.readJSON("reports.json", []);
  const scores = req.readJSON("scores.json", {});
  const dataMode = req.readJSON("datamode.json", "unknown");
  const payload = {
    exportedAt: new Date().toISOString(),
    dataMode,
    reports,
    scores,
    backupsCount: backups.length,
  };
  const filename = "jinyan-pk-backup-" + new Date().toISOString().slice(0, 10) + ".json";
  res.setHeader("Content-Disposition", "attachment; filename=\"" + filename + "\"");
  res.json(payload);
});

/* ===== 按 ts 获取历史备份内容（教练组） ===== */
app.get("/api/backup/fetch", authMiddleware, coachOnly, (req, res) => {
  const { ts } = req.query;
  const backups = req.readJSON("reports.backups.json", []);
  const found = backups.find(b => b.ts === ts);
  if (!found) return res.status(404).json({ error: "备份不存在", ts });
  res.json({ ts: found.ts, label: found.label, count: found.count, reports: found.data });
});

/* ===== 备份恢复（教练组） ===== */
app.post("/api/backup/restore", authMiddleware, coachOnly, (req, res) => {
  const { reports, scores, dataMode } = req.body;
  if (!Array.isArray(reports)) return res.status(400).json({ error: "缺少 reports 数组" });
  // 恢复前先备份当前数据
  req.backupReports("restore-" + new Date().toISOString().slice(0, 10));
  req.writeJSON("reports.json", reports);
  if (scores) req.writeJSON("scores.json", scores);
  if (dataMode) req.writeJSON("datamode.json", dataMode);
  req.appendAuditLog("restore-backup", req.session.name, { reportCount: reports.length, dataMode });
  res.json({ ok: true, reportCount: reports.length, dataMode: dataMode || "unchanged" });
});

/* ===== 备份列表（教练组，不含数据内容） ===== */
app.get("/api/backup/list", authMiddleware, coachOnly, (req, res) => {
  const backups = req.readJSON("reports.backups.json", []);
  res.json(backups.map(b => ({ ts: b.ts, label: b.label, count: b.count })));
});

/* ===== 健康检查 ===== */
app.get("/api/health", (req, res) => {
  res.json({ ok: true, time: new Date().toISOString(), env: req.dataEnv });
});

/* ===== 审计日志 ===== */
app.get("/api/audit-log", authMiddleware, coachOnly, (req, res) => {
  res.json(req.readJSON("audit.log.json", []));
});

/* ===== clinics 列表 ===== */
app.get("/api/clinics", (req, res) => {
  const fp = path.join(DATA_DIR, "clinic_passwords.json");
  let pwdOverrides = {};
  try { if (fs.existsSync(fp)) pwdOverrides = JSON.parse(fs.readFileSync(fp, "utf-8")); } catch (e) {}
  const list = clinics.map(c => ({
    id: c.id, clinic: c.clinic, team: c.team, city: c.city, status: c.status,
    hasCustomPassword: !!pwdOverrides[c.id],
  }));
  res.json(list);
});

/* ===== 教练组设置门诊密码（共享） ===== */
app.put("/api/clinics/:id/password", authMiddleware, coachOnly, (req, res) => {
  const { password } = req.body;
  if (!password || password.length < 4) return res.status(400).json({ error: "密码至少4位" });
  const clinic = clinics.find(c => c.id === req.params.id);
  if (!clinic) return res.status(404).json({ error: "门诊不存在" });
  const fp = path.join(DATA_DIR, "clinic_passwords.json");
  let overrides = {};
  try { if (fs.existsSync(fp)) overrides = JSON.parse(fs.readFileSync(fp, "utf-8")); } catch (e) {}
  overrides[req.params.id] = String(password);
  fs.writeFileSync(fp, JSON.stringify(overrides, null, 2), "utf-8");
  req.appendAuditLog("set-password", req.session.name, { clinicId: req.params.id, clinic: clinic.clinic });
  res.json({ ok: true, clinicId: req.params.id, hasCustomPassword: true });
});

/* ===== 门诊自行修改密码（共享） ===== */
app.put("/api/my-password", authMiddleware, (req, res) => {
  const { oldPassword, newPassword } = req.body;
  if (!newPassword || newPassword.length < 4) return res.status(400).json({ error: "新密码至少4位" });
  if (req.session.type === "clinic") {
    const clinic = clinics.find(c => c.id === req.session.clinicId);
    if (!clinic) return res.status(404).json({ error: "门诊不存在" });
    const currentPwd = getClinicPassword(clinic.id) || clinic.password;
    if (oldPassword !== currentPwd) return res.status(401).json({ error: "原密码不正确" });
    const fp = path.join(DATA_DIR, "clinic_passwords.json");
    let overrides = {};
    try { if (fs.existsSync(fp)) overrides = JSON.parse(fs.readFileSync(fp, "utf-8")); } catch (e) {}
    overrides[clinic.id] = newPassword;
    fs.writeFileSync(fp, JSON.stringify(overrides, null, 2), "utf-8");
    req.appendAuditLog("change-password", req.session.name, { clinicId: clinic.id });
    return res.json({ ok: true });
  }
  if (req.session.type === "coach" || req.session.type === "admin") {
    const account = staffAccounts.find(a => a.username === req.session.name);
    if (!account) return res.status(404).json({ error: "账号不存在" });
    if (oldPassword !== account.password) return res.status(401).json({ error: "原密码不正确" });
    account.password = newPassword;
    req.appendAuditLog("change-password", req.session.name, { role: req.session.type });
    return res.json({ ok: true });
  }
  res.status(400).json({ error: "不支持的操作" });
});

/* ===== 导出Excel ===== */
app.get("/api/export-excel", authMiddleware, coachOnly, (req, res) => {
  const ExcelJS = require("exceljs");
  const reports = req.readJSON("reports.json", []);
  const activeClinics = clinics.filter(c => c.status === "active");

  const wb = new ExcelJS.Workbook();
  wb.creator = "瑾言教练组";
  wb.created = new Date();

  const columns = [
    { key: "date", header: "日期", width: 14 },
    { key: "nonOrthoPotential", header: "非主诉正畸转诊量", width: 18 },
    { key: "nonOrthoCardSales", header: "非主诉正畸售卡量", width: 18 },
    { key: "orthoFirst", header: "正畸主诉量", width: 14 },
    { key: "orthoCardSales", header: "正畸主诉售卡量", width: 16 },
    { key: "cardSales", header: "99卡总销售量", width: 15 },
    { key: "cardToOrtho", header: "99卡转化矫正量", width: 17 },
    { key: "visits", header: "每日总进店量", width: 15 },
    { key: "platformCheckins", header: "平台打卡量", width: 14 },
    { key: "educationCount", header: "活动宣教量", width: 14 },
    { key: "companionDevelopment", header: "陪诊开发量", width: 14 },
    { key: "dealProjects", header: "成交项目", width: 28 },
    { key: "closedDeals", header: "当日成交量", width: 14 },
    { key: "cash", header: "成交金额", width: 14 },
    { key: "lost", header: "流失人数", width: 12 },
    { key: "recoveredLost", header: "流失追回量", width: 14 },
    { key: "tomorrowTarget", header: "明日业绩目标", width: 15 },
  ];

  const titleFont = { bold: true, size: 14 };
  const headerFont = { bold: true, size: 11 };
  const headerFill = { type: "pattern", pattern: "solid", fgColor: { argb: "FF4472C4" } };
  const headerFontColor = { argb: "FFFFFFFF" };
  const borderStyle = { style: "thin", color: { argb: "FFB4B4B4" } };
  const allBorders = { top: borderStyle, bottom: borderStyle, left: borderStyle, right: borderStyle };

  activeClinics.forEach(clinic => {
    const clinicReports = reports
      .filter(r => r.clinicId === clinic.id && r.status === "approved")
      .sort((a, b) => a.date.localeCompare(b.date));

    const ws = wb.addWorksheet(clinic.team.length > 31 ? clinic.team.slice(0, 28) + "..." : clinic.team);
    ws.mergeCells("A1:R1");
    const titleCell = ws.getCell("A1");
    titleCell.value = `2026年暑期正畸日经营管理表 — ${clinic.team}（${clinic.clinic}）`;
    titleCell.font = titleFont;
    titleCell.alignment = { horizontal: "center", vertical: "middle" };
    ws.getRow(1).height = 28;

    const totalCash = clinicReports.reduce((s, r) => s + (Number(r.cash) || 0), 0);
    const totalDeals = clinicReports.reduce((s, r) => s + (Number(r.closedDeals) || 0), 0);
    ws.getCell("A2").value = `目标：${(clinic.target).toLocaleString()} 元 | 当前累计：${totalCash.toLocaleString()} 元 | 成交量：${totalDeals} 单 | 完成率：${clinic.target > 0 ? (totalCash / clinic.target * 100).toFixed(1) : "0.0"}%`;
    ws.mergeCells("A2:R2");
    ws.getCell("A2").font = { bold: true, size: 11, color: { argb: "FF007AFF" } };
    ws.getRow(2).height = 22;

    const headerRow = ws.getRow(3);
    columns.forEach((col, i) => {
      const cell = headerRow.getCell(i + 1);
      cell.value = col.header;
      cell.font = { ...headerFont, color: headerFontColor };
      cell.fill = headerFill;
      cell.alignment = { horizontal: "center", vertical: "middle", wrapText: true };
      cell.border = allBorders;
      ws.getColumn(i + 1).width = col.width;
    });
    headerRow.height = 32;

    clinicReports.forEach((r, ri) => {
      const row = ws.getRow(ri + 4);
      row.height = 22;
      columns.forEach((col, ci) => {
        const cell = row.getCell(ci + 1);
        let val = r[col.key];
        if (col.key === "cash" || col.key === "tomorrowTarget") cell.numFmt = "#,##0";
        cell.value = val !== undefined && val !== null ? val : "";
        cell.border = allBorders;
        cell.alignment = { horizontal: "center", vertical: "middle" };
      });
    });

    const lastDataRow = clinicReports.length + 3;
    if (clinicReports.length > 0) {
      const sumRow = ws.getRow(lastDataRow + 1);
      const sumCols = ["nonOrthoPotential", "nonOrthoCardSales", "orthoFirst", "orthoCardSales", "cardSales", "cardToOrtho", "visits", "platformCheckins", "educationCount", "companionDevelopment", "closedDeals", "cash", "lost", "recoveredLost", "tomorrowTarget"];
      columns.forEach((col, ci) => {
        const cell = sumRow.getCell(ci + 1);
        cell.border = allBorders;
        cell.font = { bold: true };
        if (sumCols.includes(col.key) && clinicReports.length > 0) {
          const colLetter = String.fromCharCode(65 + ci);
          cell.value = { formula: `SUM(${colLetter}4:${colLetter}${lastDataRow})` };
          cell.numFmt = "#,##0";
        }
        if (ci === 0) cell.value = "合计";
        cell.alignment = { horizontal: "center", vertical: "middle" };
      });
    }
  });

  const summary = wb.addWorksheet("汇总");
  const summaryCols = [
    { header: "门诊", key: "team", width: 20 },
    { header: "城市", key: "city", width: 14 },
    { header: "目标金额", key: "target", width: 14 },
    { header: "累计成交金额", key: "cash", width: 16 },
    { header: "累计成交量", key: "deals", width: 14 },
    { header: "完成率", key: "rate", width: 12 },
    { header: "日报数", key: "count", width: 10 },
  ];
  const sumHeaderRow = summary.getRow(1);
  summaryCols.forEach((col, i) => {
    const cell = sumHeaderRow.getCell(i + 1);
    cell.value = col.header;
    cell.font = { ...headerFont, color: headerFontColor };
    cell.fill = headerFill;
    cell.alignment = { horizontal: "center", vertical: "middle" };
    cell.border = allBorders;
    summary.getColumn(i + 1).width = col.width;
  });
  sumHeaderRow.height = 28;

  activeClinics.forEach((clinic, ri) => {
    const creports = reports.filter(r => r.clinicId === clinic.id && r.status === "approved");
    const cashSum = creports.reduce((s, r) => s + (Number(r.cash) || 0), 0);
    const dealsSum = creports.reduce((s, r) => s + (Number(r.closedDeals) || 0), 0);
    const row = summary.getRow(ri + 2);
    const vals = [clinic.team, clinic.city, clinic.target, cashSum, dealsSum, clinic.target > 0 ? (cashSum / clinic.target * 100).toFixed(1) + "%" : "0.0%", creports.length];
    vals.forEach((v, i) => {
      const cell = row.getCell(i + 1);
      cell.value = v;
      cell.border = allBorders;
      cell.alignment = { horizontal: "center", vertical: "middle" };
      if (i >= 2) cell.numFmt = "#,##0";
    });
  });

  const suffix = req.dataEnv === "beta" ? "_Beta" : "";
  const filename = encodeURIComponent(`瑾言暑期正畸PK数据${suffix}_${new Date().toISOString().slice(0, 10)}.xlsx`);
  res.setHeader("Content-Type", "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet");
  res.setHeader("Content-Disposition", `attachment; filename*=UTF-8''${filename}`);
  wb.xlsx.write(res).then(() => res.end());
});

/* ===== Beta → 正式版数据迁移（coach-only） ===== */
app.post("/api/migrate-beta", authMiddleware, coachOnly, (req, res) => {
  const betaDir = path.join(DATA_DIR, "beta");
  const prodDir = DATA_DIR;

  if (!fs.existsSync(betaDir)) {
    return res.status(404).json({ error: "Beta 环境没有任何数据" });
  }

  const { mode } = req.body; // "preview" | "execute"
  const filesToMigrate = ["reports.json", "scores.json", "datamode.json"];

  // 读取 beta 数据
  const betaData = {};
  for (const f of filesToMigrate) {
    const fp = path.join(betaDir, f);
    try {
      betaData[f] = fs.existsSync(fp) ? JSON.parse(fs.readFileSync(fp, "utf-8")) : null;
    } catch (e) {
      betaData[f] = null;
    }
  }

  const betaReports = betaData["reports.json"] || [];
  const betaScores = betaData["scores.json"] || {};

  const summary = {
    totalReports: betaReports.length,
    approvedReports: betaReports.filter(r => r.status === "approved").length,
    pendingReports: betaReports.filter(r => r.status === "pending").length,
    rejectedReports: betaReports.filter(r => r.status === "rejected").length,
    clinicsWithData: [...new Set(betaReports.map(r => r.clinicId))],
    scoredClinics: Object.keys(betaScores).length,
  };

  if (mode === "preview") {
    return res.json({ ok: true, summary, preview: betaReports.slice(0, 5) });
  }

  // execute: 将 beta 数据迁移到正式环境
  for (const f of filesToMigrate) {
    const src = path.join(betaDir, f);
    const dst = path.join(prodDir, f);
    if (fs.existsSync(src)) {
      fs.copyFileSync(src, dst);
    }
  }

  // 审计日志
  req.appendAuditLog("migrate-beta", req.session.name, summary);

  res.json({ ok: true, message: "Beta 数据已成功迁移到正式版", summary });
});

/* ===== 查看 Beta 数据摘要（coach-only） ===== */
app.get("/api/beta-summary", authMiddleware, coachOnly, (req, res) => {
  // 读取 beta 环境的数据
  const betaDir = path.join(DATA_DIR, "beta");
  if (!fs.existsSync(betaDir)) {
    return res.json({ exists: false, totalReports: 0 });
  }

  const readFile = (filename, fallback) => {
    const fp = path.join(betaDir, filename);
    try { return fs.existsSync(fp) ? JSON.parse(fs.readFileSync(fp, "utf-8")) : fallback; }
    catch (e) { return fallback; }
  };

  const reports = readFile("reports.json", []);
  res.json({
    exists: true,
    totalReports: reports.length,
    approvedReports: reports.filter(r => r.status === "approved").length,
    pendingReports: reports.filter(r => r.status === "pending").length,
    clinicsWithData: [...new Set(reports.map(r => r.clinicId))],
    lastUpdated: reports.length > 0 ? reports.reduce((a, b) => a.id > b.id ? a : b).id : null,
  });
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`瑾言PK看板后端运行在端口 ${PORT} (支持 ?env=beta)`);
});
