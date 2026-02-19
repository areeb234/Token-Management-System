const { ipcRenderer } = require("electron");
const dgram = require("dgram");

let baseUrl = "http://172.16.0.162:8032";
const DISCOVERY_PORT = 9999;

const stage = "nursing";
const counter = "Nurse1";
const dept = "welfare";

console.log("nursing_renderer.js loaded ✅");

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
          console.log("✅ Auto-detected server:", baseUrl);
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

    // "called_count" in DB = how many are CALLED right now historically; we use local counter for served.
    setText("totalCalled", pad4(localServedCount));

    setText("status", "");
  } catch (e) {
    setText("status", `❌ Server not reachable: ${baseUrl}`);
    console.log("refresh error:", e);
  }
}

function selectRoom() {
  return new Promise((resolve) => {
    // Remove any existing modal
    document.getElementById("roomModal")?.remove();

    const overlay = document.createElement("div");
    overlay.id = "roomModal";
    overlay.style.cssText = `
      position: fixed; inset: 0; background: rgba(0,0,0,0.55);
      display: flex; align-items: center; justify-content: center;
      z-index: 9999; font-family: sans-serif;
    `;

    const box = document.createElement("div");
    box.style.cssText = `
      background: #fff; border-radius: 12px; padding: 32px 36px;
      box-shadow: 0 8px 32px rgba(0,0,0,0.25); min-width: 320px; text-align: center;
    `;

    const title = document.createElement("h2");
    title.innerText = "Select Room";
    title.style.cssText = "margin: 0 0 20px; font-size: 22px; color: #1a1a2e;";
    box.appendChild(title);

    const grid = document.createElement("div");
    grid.style.cssText = `
      display: grid; grid-template-columns: repeat(4, 1fr); gap: 10px; margin-bottom: 24px;
    `;

    for (let room = 11; room <= 18; room++) {
      const btn = document.createElement("button");
      btn.innerText = room;
      btn.style.cssText = `
        padding: 14px 0; font-size: 18px; font-weight: bold; border: 2px solid #4a90d9;
        border-radius: 8px; background: #f0f7ff; color: #1a1a2e; cursor: pointer;
        transition: background 0.15s;
      `;
      btn.onmouseenter = () => { btn.style.background = "#4a90d9"; btn.style.color = "#fff"; };
      btn.onmouseleave = () => { btn.style.background = "#f0f7ff"; btn.style.color = "#1a1a2e"; };
      btn.addEventListener("click", () => {
        overlay.remove();
        resolve(room);
      });
      grid.appendChild(btn);
    }
    box.appendChild(grid);

    const cancelBtn = document.createElement("button");
    cancelBtn.innerText = "Cancel";
    cancelBtn.style.cssText = `
      padding: 10px 28px; font-size: 15px; border: 1px solid #ccc;
      border-radius: 8px; background: #f5f5f5; color: #555; cursor: pointer;
    `;
    cancelBtn.addEventListener("click", () => {
      overlay.remove();
      resolve(null);
    });
    box.appendChild(cancelBtn);

    overlay.appendChild(box);

    // Close on backdrop click
    overlay.addEventListener("click", (e) => {
      if (e.target === overlay) { overlay.remove(); resolve(null); }
    });

    document.body.appendChild(overlay);
  });
}

async function nextToken() {
  const room = await selectRoom();
  if (room === null) return; // Nurse cancelled

  try {
    const res = await fetch(`${baseUrl}/api/call-next`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ dept, stage, counter, mode: "auto", room })
    });

    const data = await res.json();

    if (data.token_no === null) {
      alert("No waiting tokens in nursing queue.");
      return;
    }

    // Every time nurse presses NEXT, server marks previous CALLED as SERVED, so we increment served count
    localServedCount++;
    setText("status", `Room ${room} → ${data.token_no}`);
    await refresh();
  } catch (e) {
    console.log("nextToken error:", e);
    setText("status", "❌ Failed calling next token");
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
    setText("status", "❌ Failed recalling");
  }
}

document.addEventListener("DOMContentLoaded", async () => {
  document.getElementById("nextBtn")?.addEventListener("click", nextToken);
  document.getElementById("recallBtn")?.addEventListener("click", recallToken);

  startDiscoveryListener();

  refresh();
  setInterval(refresh, 1000);
});
