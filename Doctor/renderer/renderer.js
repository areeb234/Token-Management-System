const { ipcRenderer } = require("electron");
const dgram = require("dgram");
const fs = require("fs");
const path = require("path");

let baseUrl = "http://172.16.0.162:8032";
const DISCOVERY_PORT = 9999;

const stage = "doctor";
const dept = "welfare";

// ------------------ read config.ini ------------------
function appDir() {
  if (process.execPath && !process.execPath.includes("electron")) {
    return path.dirname(process.execPath);
  }
  return __dirname;
}

function parseIni(content) {
  const result = {};
  let section = null;
  for (const raw of content.split(/\r?\n/)) {
    const line = raw.trim();
    if (!line || line.startsWith(";") || line.startsWith("#")) continue;
    const sectionMatch = line.match(/^\[(.+)\]$/);
    if (sectionMatch) { section = sectionMatch[1].toLowerCase(); result[section] = {}; continue; }
    const kvMatch = line.match(/^([^=]+)=(.*)$/);
    if (kvMatch && section) result[section][kvMatch[1].trim().toLowerCase()] = kvMatch[2].trim();
  }
  return result;
}

let room = 11; // fallback
try {
  const configPath = path.join(appDir(), "config.ini");
  const cfg = parseIni(fs.readFileSync(configPath, "utf-8"));
  const parsed = parseInt(cfg?.doctor?.room);
  if (!isNaN(parsed) && parsed >= 11 && parsed <= 18) {
    room = parsed;
  } else {
    console.warn("⚠️ config.ini [doctor] room missing or invalid, defaulting to 11");
  }
} catch (e) {
  console.warn("⚠️ Could not read config.ini, defaulting to room 11:", e.message);
}

const counter = `Room${room}`;
console.log(`doctor_renderer.js loaded — Room ${room} (counter: ${counter})`);

let localServedCount = 0;

function setText(id, value) {
  const el = document.getElementById(id);
  if (el) el.innerText = value;
}

function pad4(n) {
  const x = Number(n) || 0;
  return String(x).padStart(4, "0");
}

function startDiscoveryListener() {
  try {
    const sock = dgram.createSocket("udp4");

    sock.on("error", (err) => {
      console.log("Discovery socket error:", err);
      try { sock.close(); } catch {}
    });

    sock.on("message", async (msg, rinfo) => {
      try {
        const data = JSON.parse(msg.toString());
        if (data?.service !== "Test-QMS") return;

        const ip = data.ip || rinfo.address;
        const port = data.port || 8032;

        const detected = `http://${ip}:${port}`;
        if (detected !== baseUrl) {
          baseUrl = detected;
          localServedCount = 0;
          console.log("Auto-detected server:", baseUrl);
          refresh();
        }
      } catch {
        // ignore
      }
    });

    sock.bind(DISCOVERY_PORT, "0.0.0.0", () => {
      sock.setBroadcast(true);
      console.log(`Listening for QMS discovery on UDP ${DISCOVERY_PORT}`);
    });
  } catch (e) {
    console.log("Discovery listener failed:", e);
  }
}

async function refresh() {
  try {
    const res = await fetch(`${baseUrl}/api/queue?dept=${dept}&stage=${stage}`, { cache: "no-store" });
    const data = await res.json();

    setText("totalWaiting", pad4(data.waiting_count ?? 0));
    setText("currentToken", data.last_called ?? "----");

    // Use local counter for served count, same pattern as nursing
    setText("totalCalled", pad4(localServedCount));

    setText("status", "");
  } catch (e) {
    setText("status", `Server not reachable: ${baseUrl}`);
    console.log("refresh error:", e);
  }
}

async function nextToken() {
  try {
    const res = await fetch(`${baseUrl}/api/call-next`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ dept, stage, counter, mode: "auto", room })
    });

    const data = await res.json();

    if (data.token_no === null) {
      alert(`No waiting tokens for Room ${room}.`);
      return;
    }

    // Every time doctor presses NEXT, server marks previous CALLED as SERVED
    localServedCount++;
    await refresh();
  } catch (e) {
    console.log("nextToken error:", e);
    setText("status", "Failed calling next token");
  }
}

async function recallToken() {
  try {
    const res = await fetch(`${baseUrl}/api/recall-last`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ dept, stage, counter })
    });

    const data = await res.json();

    if (data.token_no === null) {
      alert("Nothing to recall yet.");
    } else {
      setText("status", `Recalled: ${data.token_no}`);
      await refresh();
    }
  } catch (e) {
    console.log("recallToken error:", e);
    setText("status", "Failed recalling");
  }
}

document.addEventListener("DOMContentLoaded", async () => {
  document.getElementById("nextBtn")?.addEventListener("click", nextToken);
  document.getElementById("recallBtn")?.addEventListener("click", recallToken);

  startDiscoveryListener();

  refresh();
  setInterval(refresh, 1000);
});
