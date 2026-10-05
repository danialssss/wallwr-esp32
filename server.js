// Tiny backend for the Telegram wallet. No extra packages needed.
const http = require("http");
const crypto = require("crypto");
const fs = require("fs");

const BOT_TOKEN = process.env.BOT_TOKEN;
const PORT = process.env.PORT || 3000;
const FILE = "data.json";

if (!BOT_TOKEN) { console.error("Missing BOT_TOKEN environment variable"); process.exit(1); }

let db = { users: {} };
try { db = JSON.parse(fs.readFileSync(FILE, "utf8")); } catch (e) {}
const save = () => { try { fs.writeFileSync(FILE, JSON.stringify(db)); } catch (e) {} };

// Check that initData really came from Telegram.
function verify(initData) {
  if (!initData) return null;
  const p = new URLSearchParams(initData);
  const hash = p.get("hash");
  if (!hash) return null;
  p.delete("hash");
  const str = [...p.entries()].map(([k, v]) => k + "=" + v).sort().join("\n");
  const secret = crypto.createHmac("sha256", "WebAppData").update(BOT_TOKEN).digest();
  const calc = crypto.createHmac("sha256", secret).update(str).digest("hex");
  if (calc !== hash) return null;
  if (Date.now() / 1000 - Number(p.get("auth_date")) > 86400) return null;
  try { return JSON.parse(p.get("user")); } catch (e) { return null; }
}

function getUser(u) {
  const id = String(u.id);
  if (!db.users[id]) db.users[id] = { balance: 0, history: [] };
  db.users[id].username = (u.username || "").toLowerCase();
  return db.users[id];
}

const view = w => ({ balance: w.balance, history: w.history.slice(-50) });
const money = v => Math.round(Number(v) * 100) / 100;

const server = http.createServer((req, res) => {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type, x-init-data");
  res.setHeader("Access-Control-Allow-Methods", "GET, POST, OPTIONS");
  const send = (code, obj) => { res.writeHead(code, { "Content-Type": "application/json" }); res.end(JSON.stringify(obj)); };
  if (req.method === "OPTIONS") return send(204, {});
  if (req.url === "/") return send(200, { ok: true });

  let raw = "";
  req.on("data", c => { raw += c; if (raw.length > 10000) req.destroy(); });
  req.on("end", () => {
    const user = verify(req.headers["x-init-data"]);
    if (!user) return send(401, { error: "Open this app from Telegram." });
    const me = getUser(user);
    let body = {};
    try { body = raw ? JSON.parse(raw) : {}; } catch (e) {}

    if (req.url === "/api/wallet") return send(200, view(me));

    const amount = money(body.amount);
    if (!(amount > 0) || amount > 1000) return send(400, { error: "Enter an amount between 0.01 and 1000." });

    if (req.url === "/api/topup") {
      // DEMO: adds free funds. Replace with a real payment before using real money.
      me.balance = money(me.balance + amount);
      me.history.push({ label: "Top up", amount, date: Date.now() });
      save();
      return send(200, view(me));
    }

    if (req.url === "/api/send") {
      const to = String(body.to || "").replace("@", "").toLowerCase().trim();
      const entry = Object.values(db.users).find(u => u.username && u.username === to);
      if (!entry) return send(400, { error: "@" + to + " has not opened this app yet." });
      if (entry === me) return send(400, { error: "You can't send to yourself." });
      if (amount > me.balance) return send(400, { error: "Not enough funds. Your balance is " + me.balance.toFixed(2) + "." });
      me.balance = money(me.balance - amount);
      entry.balance = money(entry.balance + amount);
      me.history.push({ label: "Sent to @" + to, amount: -amount, date: Date.now() });
      entry.history.push({ label: "From @" + (me.username || "user"), amount, date: Date.now() });
      save();
      return send(200, view(me));
    }
    send(404, { error: "Not found" });
  });
});

server.listen(PORT, () => console.log("Wallet backend running on port " + PORT));
