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
const PASSWORDS_FILE = path.join(DATA_DIR, "clinic_passwords.json");
const AUDIT_FILE = path.join(DATA_DIR, "audit.log.json");

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

function appendAuditLog(action, operator, detail) {
  const logs = readJSON(AUDIT_FILE, []);
  logs.push({ ts: new Date().toISOString(), action, operator, detail });
  if (logs.length > 500) logs.splice(0, logs.length - 500);
  writeJSON(AUDIT_FILE, logs);
}

function getClinicPassword(clinicId) {
  const overrides = readJSON(PASSWORDS_FILE, {});
  return overrides[clinicId] || null;
}

function validateClinicAuth(team, password) {
  const clinic = clinics.find(c => c.team === team);
  if (!clinic) return null;
  const pwd = getClinicPassword(clinic.id) || clinic.password;
  if (password !== pwd) return null;
  return clinic;
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

  const clinic = validateClinicAuth(username, password);
  if (!clinic) return res.status(401).json({ error: "门诊队名或密码不正确" });
  if (clinic.status !== "active") return res.status(403).json({ error: "该门诊暂未参赛" });
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
  appendAuditLog("reject", req.session.name, { reportId: req.params.id, clinicId: report.clinicId, date: report.date });
  res.json({ ok: true, report });
});

/* ===== 删除日报 ===== */
app.delete("/api/reports/:id", authMiddleware, coachOnly, (req, res) => {
  let reports = readJSON(REPORTS_FILE, []);
  const report = reports.find(r => r.id === req.params.id);
  if (!report) return res.status(404).json({ error: "日报不存在" });
  reports = reports.filter(r => r.id !== req.params.id);
  writeJSON(REPORTS_FILE, reports);
  appendAuditLog("delete", req.session.name, { reportId: req.params.id, clinicId: report.clinicId, date: report.date });
  res.json({ ok: true });
});

/* ===== 保存甘特评分 ===== */
app.put("/api/scores/gantt", authMiddleware, coachOnly, (req, res) => {
  const scores = req.body;
  const coachScores = readJSON(SCORES_FILE, {});
  Object.assign(coachScores, scores);
  writeJSON(SCORES_FILE, coachScores);
  res.json({ ok: true, coachScores });
});

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
  writeJSON(REPORTS_FILE, seedReports);
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

/* ===== 审计日志 ===== */
app.get("/api/audit-log", authMiddleware, coachOnly, (req, res) => {
  res.json(readJSON(AUDIT_FILE, []));
});

/* ===== clinics 配置 ===== */
app.get("/api/clinics", (req, res) => {
  const pwdOverrides = readJSON(PASSWORDS_FILE, {});
  const list = clinics.map(c => ({
    id: c.id, clinic: c.clinic, team: c.team, city: c.city, status: c.status,
    hasCustomPassword: !!pwdOverrides[c.id],
  }));
  res.json(list);
});

/* ===== 教练组设置门诊密码 ===== */
app.put("/api/clinics/:id/password", authMiddleware, coachOnly, (req, res) => {
  const { password } = req.body;
  if (!password || password.length < 4) return res.status(400).json({ error: "密码至少4位" });
  const clinic = clinics.find(c => c.id === req.params.id);
  if (!clinic) return res.status(404).json({ error: "门诊不存在" });
  const overrides = readJSON(PASSWORDS_FILE, {});
  overrides[req.params.id] = String(password);
  writeJSON(PASSWORDS_FILE, overrides);
  appendAuditLog("set-password", req.session.name, { clinicId: req.params.id, clinic: clinic.clinic });
  res.json({ ok: true, clinicId: req.params.id, hasCustomPassword: true });
});

/* ===== 门诊自行修改密码 ===== */
app.put("/api/my-password", authMiddleware, (req, res) => {
  const { oldPassword, newPassword } = req.body;
  if (!newPassword || newPassword.length < 4) return res.status(400).json({ error: "新密码至少4位" });
  if (req.session.type === "clinic") {
    const clinic = clinics.find(c => c.id === req.session.clinicId);
    if (!clinic) return res.status(404).json({ error: "门诊不存在" });
    const currentPwd = getClinicPassword(clinic.id) || clinic.password;
    if (oldPassword !== currentPwd) return res.status(401).json({ error: "原密码不正确" });
    const overrides = readJSON(PASSWORDS_FILE, {});
    overrides[clinic.id] = newPassword;
    writeJSON(PASSWORDS_FILE, overrides);
    appendAuditLog("change-password", req.session.name, { clinicId: clinic.id });
    return res.json({ ok: true });
  }
  if (req.session.type === "coach" || req.session.type === "admin") {
    const account = staffAccounts.find(a => a.username === req.session.name);
    if (!account) return res.status(404).json({ error: "账号不存在" });
    if (oldPassword !== account.password) return res.status(401).json({ error: "原密码不正确" });
    account.password = newPassword;
    appendAuditLog("change-password", req.session.name, { role: req.session.type });
    return res.json({ ok: true });
  }
  res.status(400).json({ error: "不支持的操作" });
});

/* ===== 导出Excel ===== */
app.get("/api/export-excel", authMiddleware, coachOnly, (req, res) => {
  const ExcelJS = require("exceljs");

  const reports = readJSON(REPORTS_FILE, []);
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
        if (col.key === "date") val = val;
        if (col.key === "cash" || col.key === "tomorrowTarget") {
          cell.numFmt = "#,##0";
        }
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

  const filename = encodeURIComponent(`瑾言暑期正畸PK数据_${new Date().toISOString().slice(0, 10)}.xlsx`);
  res.setHeader("Content-Type", "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet");
  res.setHeader("Content-Disposition", `attachment; filename*=UTF-8''${filename}`);
  wb.xlsx.write(res).then(() => res.end());
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`瑾言PK看板后端运行在端口 ${PORT}`);
});
