const OFFLINE = "Couldn't reach the server. Check your connection and try again.";
const bought = new Intl.DateTimeFormat("en-US", { timeZone: "America/Chicago", month: "short", day: "numeric" });
const $ = (id) => document.getElementById(id);
const auth = window.organizerAuth;

function show(id, message = "") {
  for (const view of ["set-password", "login", "desk"]) $(view).hidden = view !== id;
  if (id === "login") $("login-status").textContent = message;
}

function line(tag, text, className = "") {
  return Object.assign(document.createElement(tag), { textContent: text, className });
}

function renderOrders(orders) {
  const paid = orders.filter((o) => o.status === "paid");
  const guests = paid.filter((o) => o.with_guest).length;
  $("summary").textContent = `${paid.length} classmates, ${guests} guests, ${paid.length + guests} tickets.`;

  $("orders").replaceChildren(...orders.map((order) => {
    const item = document.createElement("li");
    item.className = "order";
    const email = Object.assign(document.createElement("a"), { href: `mailto:${order.email}`, textContent: order.email });
    const guest = order.with_guest ? `+ ${order.guest_name || "guest"}` : "";
    const note = [guest, `bought ${bought.format(new Date(order.created_at))}`, order.status === "refunded" ? "REFUNDED" : ""]
      .filter(Boolean).join(" · ");
    item.append(line("span", order.buyer_name), email, line("small", note));
    return item;
  }));
}

async function load() {
  show("desk");
  $("summary").textContent = "Loading…";
  try {
    const response = await fetch(`${window.FUNCTIONS_URL}/door`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ token: await auth.token(), action: "orders" }),
      signal: AbortSignal.timeout(15000),
    });
    const data = await response.json();
    if (response.status === 401) {
      auth.signOut();
      show("login", data.error);
    } else if (!response.ok) {
      $("summary").textContent = data.error;
    } else {
      renderOrders(data.orders);
    }
  } catch {
    $("summary").textContent = OFFLINE;
  }
}

$("login").addEventListener("submit", async (event) => {
  event.preventDefault();
  try {
    await auth.signIn($("email").value, $("password").value);
    $("password").value = "";
    load();
  } catch (error) {
    show("login", error.status ? error.message : OFFLINE);
  }
});

const link = new URLSearchParams(location.search);
$("set-password").addEventListener("submit", async (event) => {
  event.preventDefault();
  $("set-status").textContent = "";
  try {
    await auth.setPassword(link.get("token_hash"), link.get("type"), $("new-password").value);
    history.replaceState(null, "", location.pathname);
    load();
  } catch (error) {
    if (!error.status) $("set-status").textContent = OFFLINE;
    else if (auth.signedIn()) $("set-status").textContent = error.message; // e.g. password too weak; link already used
    else $("set-status").textContent = "This link has expired or was already used. Ask for a new one.";
  }
});

$("sign-out").addEventListener("click", () => {
  auth.signOut();
  show("login");
});

if (link.get("token_hash")) show("set-password");
else if (auth.signedIn()) load();
else show("login");
