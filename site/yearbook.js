(() => {
  const PAGES = 122;
  const SIGN = PAGES + 1; // index of the left signing page; front cover is 0
  const LAST = PAGES + 3; // back cover
  const SIGNATURES_URL = `${window.FUNCTIONS_URL}/signatures`;

  const book = document.getElementById("book");
  const signPages = [document.getElementById("sign-left"), document.getElementById("sign-right")];
  const chapterLabel = document.querySelector("#page-indicator .yb-chapter");
  const pagesLabel = document.querySelector("#page-indicator .yb-pages");
  const contents = document.getElementById("contents");
  // Page numbers shown to people are the ones printed in the book. File n (= flip index n) is printed
  // page n - 1; files 1-3 and 121-122 are endsheets with no printed number.
  const FIRST_PRINTED = 3;
  const LAST_PRINTED = 119;
  const printed = (index) => (index - 1 >= FIRST_PRINTED && index - 1 <= LAST_PRINTED ? index - 1 : null);
  const fileOf = (page) => page + 1;
  const PORTRAITS = 102;
  // Chapter starts as printed page numbers. menu: false = names the page label only, no menu row.
  const CHAPTERS = [
    ["Student life", 4], ["Sports", 24], ["Clubs", 34], ["Academics", 50], ["People", 62],
    ["Senior portraits", PORTRAITS], ["Closing", 111, false], ["Senior superlatives", 114], ["Index", 116, false],
  ].map(([name, page, menu = true]) => ({ name, page, menu }));

  // Interior pages: odd = left half of a spread, even = right half.
  for (let n = 1; n <= PAGES; n++) {
    const page = document.createElement("div");
    page.className = "page";
    const img = document.createElement("img");
    // ?v: bump when page images change, or browsers keep showing the old image under a reused name.
    img.dataset.src = `yearbook/pages/${String(n).padStart(3, "0")}.webp?v=2`;
    img.alt = printed(n) ? `Yearbook page ${printed(n)}` : "Yearbook endsheet";
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
    showPageCorners: false, // owner found the hover corner-fold hint distracting
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

  function update() {
    const index = flip.getCurrentPageIndex();
    const spread = flip.getOrientation() === "landscape" && index % 2 === 1;
    const interior = index > 0 && index < SIGN;
    const numbers = (spread ? [index, index + 1] : [index]).map(printed).filter(Boolean);
    // Rightmost page in view, so a chapter that starts on a right-hand page is named as soon as it shows.
    const chapter = interior && numbers.length ? CHAPTERS.findLast((c) => c.page <= numbers.at(-1)) : undefined;
    chapterLabel.textContent = chapter ? `${chapter.name} · ` : "";
    pagesLabel.textContent =
      index === 0 ? "Cover" : index === LAST ? "Back cover" : !interior ? "Signatures"
      : numbers.length === 2 ? `pp. ${numbers[0]}–${numbers[1]}` : numbers.length ? `p. ${numbers[0]}` : "Endsheet";
    for (const c of CHAPTERS) {
      if (c === chapter) c.button?.setAttribute("aria-current", "true");
      else c.button?.removeAttribute("aria-current");
    }
    loadNearby(index);
  }

  // Contents menu: chapter rows, built from CHAPTERS.
  const chapterList = document.getElementById("chapters");
  for (const c of CHAPTERS.filter((c) => c.menu)) {
    const li = document.createElement("li");
    c.button = document.createElement("button");
    c.button.type = "button";
    c.button.innerHTML = `<img src="yearbook/thumbs/${String(c.page).padStart(3, "0")}.jpg" alt="" width="30" height="40" loading="lazy"><span>${c.name}</span><small>p. ${c.page}</small>`;
    c.button.addEventListener("click", () => go(fileOf(c.page)));
    li.append(c.button);
    chapterList.append(li);
  }

  // turnToPage snaps to the spread holding the page, so no odd/even fix-up here.
  function go(page) {
    contents.hidePopover?.(); // ponytail: Popover API (Safari 17+, 2023); older browsers get no menu but nothing breaks
    flip.turnToPage(page);
    update();
  }

  document.getElementById("goto").addEventListener("submit", (event) => {
    event.preventDefault(); // min/max/required already checked by the browser
    // Printed pages missing from the book scan don't exist now, so every page in range has a file.
    go(fileOf(event.target.elements.page.valueAsNumber));
    event.target.reset();
  });

  flip.on("flip", update);
  flip.on("changeOrientation", update);

  document.getElementById("prev").addEventListener("click", () => flip.flipPrev());
  document.getElementById("next").addEventListener("click", () => flip.flipNext());
  document.getElementById("portraits-jump").addEventListener("click", () => go(fileOf(PORTRAITS)));
  document.getElementById("sign-jump").addEventListener("click", () => openSigner());

  // ---- Signing sheet: one big zoomable sheet, messages pinned where people tapped. ----
  const SHEET_W = 2100;
  const SHEET_H = 1400;
  const BOX_W = 600; // max message width, sheet units
  const SIZE = 24; // one text size for everyone; the API still accepts 16/24/36/54/80
  const signer = document.getElementById("signer");
  const viewport = document.getElementById("signer-viewport");
  const sheet = document.getElementById("sheet");
  const tools = document.getElementById("write-tools");
  const postButton = document.getElementById("write-post");
  const status = document.getElementById("signer-status");
  const minis = signPages.map((page) => page.querySelector(".sheet-mini"));

  // "Signatures" heading on the left page, as in the printed book. It's an image (rendered once from
  // the Watford font) because that font isn't licensed for web embedding.
  for (const el of [sheet, ...minis]) {
    const title = document.createElement("img");
    title.className = "sheet-title";
    title.src = "assets/signatures-title.png";
    title.alt = el === sheet ? "Signatures" : "";
    el.append(title);
  }

  // Default (centre) origin: Panzoom's wheel and pinch zoom only keep the focal point steady with it.
  const panzoom = Panzoom(sheet, { canvas: true, maxScale: 2, step: 0.2 });
  viewport.addEventListener("wheel", panzoom.zoomWithWheel);

  let box = null; // the write box while writing

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
    box.style.fontSize = `${SIZE}px`;
    grow();
    tools.hidden = false;
    showStatus("");
    centreOn(x + BOX_W / 2, y + SIZE);
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
    contents.hidePopover?.();
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
      size: SIZE,
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
