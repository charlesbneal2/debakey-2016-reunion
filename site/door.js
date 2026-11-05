const OFFLINE = "Couldn't reach the server. Check signal, try again, or use the printed list.";
const RESCAN_PAUSE_MS = 3000;
const centralTime = new Intl.DateTimeFormat("en-US", {
  timeZone: "America/Chicago",
  hour: "numeric",
  minute: "2-digit",
});

const $ = (id) => document.getElementById(id);
let password = "";
let busy = false;
let lastScan = { text: "", at: 0 };

function savePassword(value) {
  password = value;
  try {
    sessionStorage.setItem("door-password", value);
  } catch {
    // Private browsing can block storage; the in-memory copy is enough.
  }
}

function savedPassword() {
  try {
    return sessionStorage.getItem("door-password") ?? "";
  } catch {
    return "";
  }
}

function forgetPassword() {
  password = "";
  try {
    sessionStorage.removeItem("door-password");
  } catch {
    // Nothing stored.
  }
}

async function callDoor(body) {
  const response = await fetch(`${window.FUNCTIONS_URL}/door`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ password, ...body }),
    signal: AbortSignal.timeout(15000),
  });
  return { status: response.status, data: await response.json() };
}

function showLogin(message = "") {
  $("desk").hidden = true;
  $("login").hidden = false;
  $("login-status").textContent = message;
}

function showResult(state, title, label = "") {
  $("result").dataset.state = state;
  $("result-title").textContent = title;
  $("result-label").textContent = label;
  $("result").hidden = false;
  $("next").focus();
}

function describe({ result, label, checked_in_at: at }) {
  switch (result) {
    case "ok":
      return ["good", "Admit", label];
    case "already":
      return ["bad", at ? `Already checked in at ${centralTime.format(new Date(at))}` : "Already checked in", label];
    case "voided":
      return ["bad", "Refunded or voided", label];
    default:
      return ["bad", "Not found", "Try name search"];
  }
}

async function checkIn(scanned) {
  busy = true;
  try {
    const { status, data } = await callDoor({ action: "scan", scanned });
    if (status === 401) {
      forgetPassword();
      busy = false;
      showLogin(data.error);
    } else if (status !== 200) {
      showResult("bad", "Not checked in", data.error);
    } else {
      showResult(...describe(data));
    }
  } catch {
    showResult("bad", "Not checked in", OFFLINE);
  }
}

function onScan(text) {
  const repeat = text === lastScan.text && Date.now() - lastScan.at < RESCAN_PAUSE_MS;
  if (busy || repeat) return;
  lastScan = { text, at: Date.now() };
  checkIn(text);
}

async function startCamera() {
  try {
    const scanner = new window.Html5Qrcode("reader");
    await scanner.start({ facingMode: "environment" }, { fps: 10, qrbox: 240 }, onScan, () => {});
  } catch {
    $("reader").hidden = true;
    $("camera-status").textContent = "Camera unavailable. Allow camera access and reload, or use name search below.";
  }
}

function openDesk() {
  $("login").hidden = true;
  $("desk").hidden = false;
  startCamera();
}

function renderMatches(matches) {
  $("matches").replaceChildren(...matches.map((match) => {
    const item = document.createElement("li");
    const name = document.createElement("span");
    name.textContent = match.label;
    item.append(name);

    if (match.voided) {
      item.append(Object.assign(document.createElement("small"), { textContent: "Refunded or voided" }));
    } else if (match.checked_in_at) {
      item.append(Object.assign(document.createElement("small"), {
        textContent: `Checked in ${centralTime.format(new Date(match.checked_in_at))}`,
      }));
    } else {
      const button = Object.assign(document.createElement("button"), {
        type: "button",
        className: "button",
        textContent: "Check in",
      });
      button.addEventListener("click", () => checkIn(match.token));
      item.append(button);
    }
    return item;
  }));
}

$("login").addEventListener("submit", async (event) => {
  event.preventDefault();
  savePassword($("password").value);
  try {
    const { status, data } = await callDoor({ action: "login" });
    if (status === 200) {
      $("password").value = "";
      openDesk();
    } else {
      forgetPassword();
      showLogin(data.error);
    }
  } catch {
    forgetPassword();
    showLogin(OFFLINE);
  }
});

$("search").addEventListener("submit", async (event) => {
  event.preventDefault();
  $("search-status").textContent = "";
  try {
    const { status, data } = await callDoor({ action: "search", query: $("query").value });
    if (status === 401) {
      forgetPassword();
      showLogin(data.error);
    } else if (status !== 200) {
      $("search-status").textContent = data.error;
    } else {
      renderMatches(data.matches);
      if (data.matches.length === 0) $("search-status").textContent = "No tickets found.";
    }
  } catch {
    $("search-status").textContent = OFFLINE;
  }
});

$("next").addEventListener("click", () => {
  $("result").hidden = true;
  $("matches").replaceChildren();
  $("query").value = "";
  lastScan.at = Date.now();
  busy = false;
});

const saved = savedPassword();
if (saved) {
  password = saved;
  openDesk();
}
