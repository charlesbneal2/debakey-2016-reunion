(() => {
  const PAGES = 118;
  const SIGN = PAGES + 1; // index of the left signing page; front cover is 0
  const LAST = PAGES + 3; // back cover
  const SIGNATURES_URL = `${window.FUNCTIONS_URL}/signatures`;

  const book = document.getElementById("book");
  const signPages = [document.getElementById("sign-left"), document.getElementById("sign-right")];
  const indicator = document.getElementById("page-indicator");

  // Interior pages: odd = left half of a spread, even = right half.
  for (let n = 1; n <= PAGES; n++) {
    const page = document.createElement("div");
    page.className = "page";
    const img = document.createElement("img");
    img.dataset.src = `yearbook/pages/${String(n).padStart(3, "0")}.webp`;
    img.alt = `Yearbook page ${n}`;
    page.append(img);
    book.insertBefore(page, signPages[0]);
  }
  const pages = [...book.querySelectorAll(".page")];

  // Taps on the signing pages open the signer instead of turning the page.
  for (const el of signPages) {
    for (const type of ["mousedown", "touchstart", "pointerdown"]) {
      el.addEventListener(type, (event) => event.stopPropagation());
    }
    el.addEventListener("click", () => openSigner());
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

  document.getElementById("prev").addEventListener("click", () => flip.flipPrev());
  document.getElementById("next").addEventListener("click", () => flip.flipNext());
  document.getElementById("sign-jump").addEventListener("click", () => openSigner());

  // ---- Signing sheet: one big zoomable sheet, messages pinned where people tapped. ----
  const SHEET_W = 3000;
  const SHEET_H = 2000;
  const BOX_W = 600; // max message width, sheet units
  const SIZES = [16, 24, 36, 54, 80];
  const signer = document.getElementById("signer");
  const viewport = document.getElementById("signer-viewport");
  const sheet = document.getElementById("sheet");
  const tools = document.getElementById("write-tools");
  const sizeDown = document.getElementById("size-down");
  const sizeUp = document.getElementById("size-up");
  const postButton = document.getElementById("write-post");
  const status = document.getElementById("signer-status");
  const minis = signPages.map((page) => page.querySelector(".sheet-mini"));

  // Default (centre) origin: Panzoom's wheel and pinch zoom only keep the focal point steady with it.
  const panzoom = Panzoom(sheet, { canvas: true, maxScale: 2, step: 0.2 });
  viewport.addEventListener("wheel", panzoom.zoomWithWheel);

  let box = null; // the write box while writing
  let sizeIndex = 1;

  function showStatus(text) {
    status.textContent = text;
    status.hidden = !text;
  }

  function renderSignature({ message, x, y, size }) {
    const el = document.createElement("div");
    el.className = "signature";
    el.style.left = `${x * SHEET_W}px`;
    el.style.top = `${y * SHEET_H}px`;
    el.style.fontSize = `${size}px`;
    el.textContent = message;
    return el;
  }

  function addSignature(signature) {
    sheet.append(renderSignature(signature));
    for (const mini of minis) mini.append(renderSignature(signature));
  }

  // Mini copies inside the book: left page shows the left half of the sheet, right page the right half.
  const resizeMinis = new ResizeObserver(() => {
    minis.forEach((mini, i) => {
      const scale = signPages[i].clientWidth / (SHEET_W / 2);
      mini.style.transform = `scale(${scale}) translateX(${i ? -SHEET_W / 2 : 0}px)`;
    });
  });
  signPages.forEach((page) => resizeMinis.observe(page));

  // Show sheet point (sheetX, sheetY) at the middle of the viewport.
  // Panzoom's transform is scale(s) translate(t) about the sheet centre C, so a point P lands at
  // C + s * (P + t - C); solving for the viewport middle M gives t = (M - C) / s + C - P.
  function centreOn(sheetX, sheetY, scale = 1) {
    const x = (viewport.clientWidth / 2 - SHEET_W / 2) / scale + SHEET_W / 2 - sheetX;
    const y = (viewport.clientHeight / 2 - SHEET_H / 2) / scale + SHEET_H / 2 - sheetY;
    panzoom.zoom(scale, { animate: false, force: true });
    panzoom.pan(x, y, { animate: false, force: true });
  }

  function fit() {
    const scale = Math.min(viewport.clientWidth / SHEET_W, viewport.clientHeight / SHEET_H) * 0.96;
    panzoom.setOptions({ minScale: scale });
    centreOn(SHEET_W / 2, SHEET_H / 2, scale);
  }

  function toSheet(clientX, clientY) {
    const rect = sheet.getBoundingClientRect();
    return [((clientX - rect.left) / rect.width) * SHEET_W, ((clientY - rect.top) / rect.height) * SHEET_H];
  }

  function setSize(index) {
    sizeIndex = Math.max(0, Math.min(SIZES.length - 1, index));
    if (box) box.style.fontSize = `${SIZES[sizeIndex]}px`;
    sizeDown.disabled = sizeIndex === 0;
    sizeUp.disabled = sizeIndex === SIZES.length - 1;
    grow();
  }

  function grow() {
    if (!box) return;
    box.style.height = "auto";
    box.style.height = `${box.scrollHeight}px`;
    // Keep the bottom of the message on the sheet as it grows.
    const top = Math.min(parseFloat(box.style.top) || 0, SHEET_H - box.offsetHeight);
    box.style.top = `${Math.max(0, top)}px`;
  }

  function startWriting(sheetX, sheetY) {
    // Keep the whole box on the sheet.
    const x = Math.max(0, Math.min(SHEET_W - BOX_W, sheetX));
    const y = Math.max(0, Math.min(SHEET_H * 0.97, sheetY));
    if (!box) {
      box = document.createElement("textarea");
      box.id = "write-box";
      box.className = "write-box panzoom-exclude";
      box.maxLength = 280;
      box.rows = 1;
      box.placeholder = "Write your message…";
      box.setAttribute("aria-label", "Your message");
      box.addEventListener("input", grow);
      sheet.append(box);
    }
    box.style.left = `${x}px`;
    box.style.top = `${y}px`;
    setSize(sizeIndex);
    tools.hidden = false;
    showStatus("");
    centreOn(x + BOX_W / 2, y + SIZES[sizeIndex]);
    box.focus({ preventScroll: true });
  }

  function stopWriting() {
    box?.remove();
    box = null;
    tools.hidden = true;
    fit();
  }

  const signJump = document.getElementById("sign-jump");
  const behind = [document.querySelector(".yb-header"), document.querySelector(".yb-main")];
  let returnFocus = null;

  function openSigner() {
    flip.turnToPage(SIGN);
    update();
    returnFocus = document.activeElement;
    signer.hidden = false;
    behind.forEach((el) => (el.inert = true));
    document.body.style.overflow = "hidden";
    if (!box) fit();
    (box ?? document.getElementById("signer-close")).focus({ preventScroll: true });
  }

  function closeSigner() {
    signer.hidden = true;
    behind.forEach((el) => (el.inert = false));
    document.body.style.overflow = "";
    (returnFocus?.matches?.("button, a") ? returnFocus : signJump).focus();
  }

  // A tap (not a drag or pinch) on the sheet starts writing there. Ups/cancels are watched on window
  // so a drag released outside the viewport doesn't leave a pointer counted as still down.
  let down = null;
  const pointers = new Set();
  viewport.addEventListener("pointerdown", (event) => {
    pointers.add(event.pointerId);
    down = pointers.size === 1 ? { x: event.clientX, y: event.clientY, t: Date.now() } : null;
  }, true);
  window.addEventListener("pointercancel", (event) => {
    pointers.delete(event.pointerId);
    down = null;
  }, true);
  window.addEventListener("pointerup", (event) => {
    pointers.delete(event.pointerId);
    const tap = down && Math.hypot(event.clientX - down.x, event.clientY - down.y) < 6 && Date.now() - down.t < 500;
    down = null;
    if (!tap || !viewport.contains(event.target) || event.target === box) return;
    startWriting(...toSheet(event.clientX, event.clientY));
  }, true);

  document.getElementById("write-here").addEventListener("click", () => {
    const rect = viewport.getBoundingClientRect();
    const [x, y] = toSheet(rect.left + rect.width / 2, rect.top + rect.height / 2);
    startWriting(x - BOX_W / 2, y);
  });
  sizeDown.addEventListener("click", () => setSize(sizeIndex - 1));
  sizeUp.addEventListener("click", () => setSize(sizeIndex + 1));
  document.getElementById("write-cancel").addEventListener("click", stopWriting);
  document.getElementById("signer-close").addEventListener("click", closeSigner);
  window.addEventListener("resize", () => {
    if (!signer.hidden && !box) fit();
  });

  postButton.addEventListener("click", async () => {
    if (postButton.disabled || !box) return;
    const message = box.value.trim();
    if (!message) {
      showStatus("Write something first.");
      box.focus();
      return;
    }
    const round = (n) => Math.round(n * 10000) / 10000;
    const body = {
      message,
      x: round(parseFloat(box.style.left) / SHEET_W),
      y: round(parseFloat(box.style.top) / SHEET_H),
      size: SIZES[sizeIndex],
    };
    postButton.disabled = true;
    try {
      const res = await fetch(SIGNATURES_URL, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(body),
      });
      if (res.status === 201) {
        addSignature((await res.json()).signature);
        stopWriting();
        showStatus("Thanks for signing!");
      } else if (res.status === 429) {
        showStatus("You've signed a lot. Try again later.");
      } else {
        showStatus("Couldn't save. Try again.");
      }
    } catch {
      showStatus("Couldn't save. Try again.");
    } finally {
      postButton.disabled = false;
    }
  });

  document.addEventListener("keydown", (event) => {
    if (!signer.hidden) {
      if (event.key === "Escape") box ? stopWriting() : closeSigner();
      if (event.key === "Tab") {
        // Keep focus inside the signer.
        const focusable = [...signer.querySelectorAll("button:not([disabled]), textarea")].filter((el) => el.offsetParent);
        const i = focusable.indexOf(document.activeElement);
        const wrap = event.shiftKey ? i <= 0 : i === focusable.length - 1;
        if (wrap) {
          event.preventDefault();
          focusable[event.shiftKey ? focusable.length - 1 : 0].focus();
        }
      }
      return; // never turn book pages while signing
    }
    if (event.target.closest("input, textarea, select, [contenteditable]")) return;
    if (event.key === "ArrowRight") flip.flipNext();
    if (event.key === "ArrowLeft") flip.flipPrev();
  });

  fetch(SIGNATURES_URL)
    .then((res) => (res.ok ? res.json() : Promise.reject(new Error(res.status))))
    .then(({ signatures }) => signatures.forEach(addSignature))
    .catch(() => showStatus("Couldn't load signatures. Refresh to try again."));

  // Defer: Panzoom resets its pan in a setTimeout right after it is created.
  if (location.hash === "#sign") setTimeout(openSigner);
  else update();
})();
