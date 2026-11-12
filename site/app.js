const SALES_CLOSE = new Date("2026-11-29T03:00:00Z"); // 9 PM Central, November 28
const HELP = "Please try again, or email info@debakey2016reunion.com.";

const form = document.getElementById("ticket-form");
const submit = document.getElementById("submit");
const status = document.getElementById("form-status");
const guestField = document.getElementById("guest-field");
const nameInput = document.getElementById("name");
const guestInput = document.getElementById("guest-name");

function closeSales() {
  form.remove();
  document.getElementById("sales-closed").hidden = false;
  document.getElementById("cover-cta").hidden = true;
  document.getElementById("cover-closed").hidden = false;
}

function withGuest() {
  return form.elements.party.value === "guest";
}

async function loadGuests() {
  try {
    const response = await fetch(`${window.FUNCTIONS_URL}/guest-list`);
    if (!response.ok) return;
    const { guests } = await response.json();
    const list = document.getElementById("guest-list");
    for (const guest of guests) {
      const item = document.createElement("li");
      item.textContent = guest.plus_one ? `${guest.name} +1` : guest.name;
      list.append(item);
    }
    document.getElementById("guest-empty").hidden = guests.length > 0;
    document.getElementById("guests").hidden = false;
  } catch {
    // The list is a nice-to-have, so its section stays hidden if it can't load.
  }
}

async function startCheckout() {
  submit.disabled = true;
  status.textContent = "";
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 20000);
  try {
    const response = await fetch(`${window.FUNCTIONS_URL}/create-checkout`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        name: nameInput.value.trim(),
        guest_name: withGuest() ? guestInput.value.trim() : "",
        with_guest: withGuest(),
        show_on_list: document.getElementById("show-on-list").checked,
      }),
      signal: controller.signal,
    });
    const data = await response.json();
    if (response.ok && data.url) {
      window.location.assign(data.url);
      return;
    }
    if (response.status === 400 || response.status === 410) {
      status.textContent = data.error;
    } else {
      status.textContent = `We couldn't start checkout. ${HELP}`;
    }
  } catch {
    status.textContent = `We couldn't reach the ticket system. ${HELP}`;
  }
  clearTimeout(timeout);
  submit.disabled = false;
}

form.addEventListener("change", () => {
  guestField.hidden = !withGuest();
});

form.addEventListener("submit", (event) => {
  event.preventDefault();
  if (!nameInput.value.trim()) {
    status.textContent = "Please enter your name.";
    nameInput.focus();
    return;
  }
  startCheckout();
});

// Browsers restore this page from cache when someone comes back from Stripe.
window.addEventListener("pageshow", () => {
  submit.disabled = false;
});

if (new Date() >= SALES_CLOSE) closeSales();
loadGuests();
