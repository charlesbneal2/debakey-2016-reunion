(() => {
  const PAGES = 118;
  const SIGN = PAGES + 1; // index of the sign form page; front cover is 0
  const LAST = PAGES + 3; // back cover
  const SIGNATURES_URL = `${window.FUNCTIONS_URL}/signatures`;

  const book = document.getElementById("book");
  const signPage = document.getElementById("sign-page");
  const indicator = document.getElementById("page-indicator");
  const form = document.getElementById("sign-form");
  const nameInput = document.getElementById("sign-name");
  const messageInput = document.getElementById("sign-message");
  const submit = document.getElementById("sign-submit");
  const status = document.getElementById("sign-status");
  const list = document.getElementById("signature-list");
  const note = document.getElementById("signatures-note");

  // Interior pages: odd = left half of a spread, even = right half.
  for (let n = 1; n <= PAGES; n++) {
    const page = document.createElement("div");
    page.className = "page";
    const img = document.createElement("img");
    img.dataset.src = `yearbook/pages/${String(n).padStart(3, "0")}.webp`;
    img.alt = `Yearbook page ${n}`;
    page.append(img);
    book.insertBefore(page, signPage);
  }
  const pages = [...book.querySelectorAll(".page")];

  // Keep taps, drags and scrolling on the signing pages from turning the page.
  for (const el of [signPage, document.getElementById("signatures-page")]) {
    for (const type of ["mousedown", "touchstart", "pointerdown"]) {
      el.addEventListener(type, (event) => event.stopPropagation());
    }
  }

  const flip = new St.PageFlip(book, {
    width: 550,
    height: 733,
    size: "stretch",
    minWidth: 260,
    maxWidth: 1000,
    minHeight: 347,
    maxHeight: 1333,
    showCover: true,
    flippingTime: 700,
    mobileScrollSupport: false,
  });
  flip.loadFromHTML(pages);

  // ponytail: load images near the current page only; whole book is ~16 MB.
  function loadNearby(index) {
    for (let i = Math.max(0, index - 2); i <= Math.min(LAST, index + 4); i++) {
      const img = pages[i].querySelector("img[data-src]");
      if (img) {
        img.src = img.dataset.src;
        img.removeAttribute("data-src");
      }
    }
  }

  function label(index) {
    if (index === 0) return "Cover";
    if (index === LAST) return "Back cover";
    if (index >= SIGN) return "Signatures";
    const spread = flip.getOrientation() === "landscape" && index % 2 === 1;
    return spread ? `Pages ${index}–${index + 1} of ${PAGES}` : `Page ${index} of ${PAGES}`;
  }

  function update() {
    const index = flip.getCurrentPageIndex();
    indicator.textContent = label(index);
    loadNearby(index);
  }

  flip.on("flip", update);
  flip.on("changeOrientation", update);

  const goToSign = () => {
    flip.turnToPage(SIGN);
    update();
  };
  document.getElementById("prev").addEventListener("click", () => flip.flipPrev());
  document.getElementById("next").addEventListener("click", () => flip.flipNext());
  document.getElementById("sign-jump").addEventListener("click", goToSign);

  document.addEventListener("keydown", (event) => {
    if (event.target.closest("input, textarea, select, [contenteditable]")) return;
    if (event.key === "ArrowRight") flip.flipNext();
    if (event.key === "ArrowLeft") flip.flipPrev();
  });

  if (location.hash === "#sign") goToSign();
  else update();

  // Signatures
  function signatureItem({ name, message }) {
    const li = document.createElement("li");
    const who = document.createElement("span");
    who.className = "yb-signature-name";
    who.textContent = name;
    li.append(who);
    if (message) {
      const text = document.createElement("p");
      text.textContent = message;
      li.append(text);
    }
    return li;
  }

  function showStatus(text) {
    status.textContent = text;
    status.hidden = false;
  }

  fetch(SIGNATURES_URL)
    .then((res) => (res.ok ? res.json() : Promise.reject(new Error(res.status))))
    .then(({ signatures }) => list.append(...signatures.map(signatureItem)))
    .catch(() => {
      note.textContent = "Couldn't load signatures. Refresh to try again.";
      note.hidden = false;
    });

  form.addEventListener("submit", async (event) => {
    event.preventDefault();
    if (submit.disabled) return;
    const name = nameInput.value.trim();
    const message = messageInput.value.trim();
    if (!name) {
      showStatus("Please add your name.");
      nameInput.focus();
      return;
    }

    submit.disabled = true;
    status.hidden = true;
    try {
      const res = await fetch(SIGNATURES_URL, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ name, message }),
      });
      if (res.status === 201) {
        const { signature } = await res.json();
        list.prepend(signatureItem(signature));
        form.reset();
        showStatus("Thanks for signing!");
        if (flip.getOrientation() === "portrait") flip.flipNext(); // show the list on phones
      } else if (res.status === 429) {
        showStatus("You've signed a lot. Try again later.");
      } else {
        showStatus("Couldn't save. Try again.");
      }
    } catch {
      showStatus("Couldn't save. Try again.");
    } finally {
      submit.disabled = false;
    }
  });
})();
