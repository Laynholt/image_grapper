# Image Grabber Userscript Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build a single-file userscript that finds already available page images, shows them in a selectable visual grid, and saves or opens selected images through the best available userscript/browser API.

**Architecture:** The product runtime is one `.user.js` file with small internal modules: `config`, `utils`, `scanner`, `compat`, `downloadAdapter`, and `ui`. Pure functions are exported through CommonJS only when running under Node so tests can cover scanner and utility behavior without changing browser runtime behavior.

**Tech Stack:** Plain JavaScript userscript, DOM APIs, optional GM APIs, Node.js built-in `node:test`, `jsdom` for tests, static HTML fixture for manual browser checks.

---

## File Structure

- Create `image-grabber.user.js`: userscript metadata and runtime modules.
- Create `package.json`: development-only test script and `jsdom` dependency.
- Create `tests/scanner.test.js`: Node tests for URL normalization, `srcset`, DOM scanner deduplication, lazy attributes, background images, and small-image heuristics.
- Create `fixtures/test-page.html`: manual fixture with normal images, `picture/srcset`, lazy attributes, CSS backgrounds, duplicates, and small decorative images.
- Create `README.md`: installation, compatibility notes, and manual test instructions.

The current workspace is not a git repository. Commit steps are represented as checkpoint commands; if a git repository is later initialized, commit at the end of each task using the task title as the commit message.

---

### Task 1: Test Harness And Project Shell

**Files:**
- Create: `package.json`
- Create: `tests/scanner.test.js`
- Create: `image-grabber.user.js`

- [ ] **Step 1: Add the development test script**

Create `package.json`:

```json
{
  "name": "image-grabber-userscript",
  "version": "0.1.0",
  "private": true,
  "description": "Userscript that finds page images and offers a selectable download gallery.",
  "scripts": {
    "test": "node --test"
  },
  "devDependencies": {
    "jsdom": "^24.1.3"
  }
}
```

- [ ] **Step 2: Add the first failing smoke test**

Create `tests/scanner.test.js`:

```js
const test = require("node:test");
const assert = require("node:assert/strict");

const grabber = require("../image-grabber.user.js");

test("exports testable modules in Node", () => {
  assert.equal(typeof grabber.utils.normalizeUrl, "function");
  assert.equal(typeof grabber.scanner.scanDocument, "function");
});
```

- [ ] **Step 3: Add a minimal userscript shell**

Create `image-grabber.user.js`:

```js
// ==UserScript==
// @name         Image Grabber Gallery
// @namespace    local.image-grabber
// @version      0.1.0
// @description  Find images on the current page and save selected ones.
// @match        *://*/*
// @grant        GM_download
// @grant        GM_openInTab
// @grant        GM_xmlhttpRequest
// @run-at       document-idle
// ==/UserScript==

(function () {
  "use strict";

  const utils = {
    normalizeUrl(value, baseUrl) {
      if (!value || typeof value !== "string") return null;
      try {
        return new URL(value.trim(), baseUrl || document.baseURI).href;
      } catch (_) {
        return null;
      }
    },
  };

  const scanner = {
    scanDocument() {
      return [];
    },
  };

  const api = { utils, scanner };

  if (typeof module !== "undefined" && module.exports) {
    module.exports = api;
    return;
  }
})();
```

- [ ] **Step 4: Install test dependency**

Run:

```powershell
npm install
```

Expected: `node_modules` and `package-lock.json` are created, with no install errors.

- [ ] **Step 5: Run the smoke test**

Run:

```powershell
npm test
```

Expected: PASS for `exports testable modules in Node`.

- [ ] **Step 6: Checkpoint**

Run:

```powershell
git rev-parse --is-inside-work-tree
```

Expected in the current workspace: `fatal: not a git repository`. Do not commit unless the project has been initialized as a git repository.

---

### Task 2: Utilities And Candidate Model

**Files:**
- Modify: `tests/scanner.test.js`
- Modify: `image-grabber.user.js`

- [ ] **Step 1: Add failing utility tests**

Append to `tests/scanner.test.js`:

```js
test("normalizeUrl resolves relative URLs and rejects invalid values", () => {
  assert.equal(
    grabber.utils.normalizeUrl("/images/photo.jpg", "https://example.com/gallery/page.html"),
    "https://example.com/images/photo.jpg"
  );
  assert.equal(grabber.utils.normalizeUrl("   ", "https://example.com"), null);
});

test("parseSrcset returns URL candidates without descriptors", () => {
  assert.deepEqual(
    grabber.utils.parseSrcset("/small.jpg 480w, https://cdn.example.com/large.jpg 2x"),
    ["/small.jpg", "https://cdn.example.com/large.jpg"]
  );
});

test("createCandidate creates stable dedupe metadata", () => {
  const candidate = grabber.scanner.createCandidate({
    url: "https://example.com/images/photo.jpg",
    sourceType: "img",
    baseUrl: "https://example.com/page",
    width: 1200,
    height: 800,
  });

  assert.equal(candidate.id, "https://example.com/images/photo.jpg");
  assert.equal(candidate.displayUrl, "example.com/images/photo.jpg");
  assert.deepEqual(candidate.sourceTypes, ["img"]);
  assert.equal(candidate.width, 1200);
  assert.equal(candidate.height, 800);
  assert.equal(candidate.likelySmall, false);
});

test("createCandidate marks known tiny assets as likely small", () => {
  const candidate = grabber.scanner.createCandidate({
    url: "https://example.com/assets/tracking-pixel.gif",
    sourceType: "img",
    baseUrl: "https://example.com/page",
    width: 1,
    height: 1,
  });

  assert.equal(candidate.likelySmall, true);
});
```

- [ ] **Step 2: Run tests and verify failure**

Run:

```powershell
npm test
```

Expected: FAIL because `parseSrcset` and `createCandidate` are not defined.

- [ ] **Step 3: Implement utility functions and candidate creation**

Replace the `utils` and `scanner` declarations in `image-grabber.user.js` with:

```js
  const config = {
    lazyAttributes: [
      "data-src",
      "data-original",
      "data-lazy-src",
      "data-image",
      "data-url",
      "data-full",
      "data-full-src",
      "data-srcset",
    ],
    smallImageMaxArea: 96 * 96,
    smallImageNamePattern: /(spacer|pixel|tracking|tracker|icon|sprite|favicon|avatar|blank|1x1)/i,
    imageExtensionPattern: /\.(avif|bmp|gif|jpe?g|png|svg|webp)(?:[?#].*)?$/i,
  };

  const utils = {
    normalizeUrl(value, baseUrl) {
      if (!value || typeof value !== "string") return null;
      const trimmed = value.trim();
      if (!trimmed || trimmed.startsWith("javascript:") || trimmed.startsWith("mailto:")) {
        return null;
      }
      try {
        return new URL(trimmed, baseUrl || document.baseURI).href;
      } catch (_) {
        return null;
      }
    },

    parseSrcset(value) {
      if (!value || typeof value !== "string") return [];
      return value
        .split(",")
        .map((part) => part.trim().split(/\s+/)[0])
        .filter(Boolean);
    },

    displayUrl(url) {
      try {
        const parsed = new URL(url);
        return parsed.host + parsed.pathname;
      } catch (_) {
        return url;
      }
    },

    filenameFromUrl(url, fallbackIndex) {
      try {
        const parsed = new URL(url);
        const rawName = parsed.pathname.split("/").filter(Boolean).pop();
        if (rawName) return decodeURIComponent(rawName).replace(/[\\/:*?"<>|]+/g, "_");
      } catch (_) {
      }
      return `image-${fallbackIndex || Date.now()}.jpg`;
    },
  };

  const scanner = {
    createCandidate({ url, sourceType, baseUrl, width, height, elementVisible }) {
      const normalizedUrl = utils.normalizeUrl(url, baseUrl);
      if (!normalizedUrl) return null;

      const knownArea = Number(width || 0) * Number(height || 0);
      const likelySmall =
        (knownArea > 0 && knownArea <= config.smallImageMaxArea) ||
        config.smallImageNamePattern.test(normalizedUrl);

      return {
        id: normalizedUrl,
        url: normalizedUrl,
        displayUrl: utils.displayUrl(normalizedUrl),
        sourceTypes: [sourceType],
        width: Number(width || 0),
        height: Number(height || 0),
        elementVisible: elementVisible !== false,
        likelySmall,
      };
    },

    scanDocument() {
      return [];
    },
  };
```

Also change the exported API line to:

```js
  const api = { config, utils, scanner };
```

- [ ] **Step 4: Run tests**

Run:

```powershell
npm test
```

Expected: PASS.

- [ ] **Step 5: Checkpoint**

Run:

```powershell
git rev-parse --is-inside-work-tree
```

Expected in the current workspace: `fatal: not a git repository`. Do not commit unless git exists.

---

### Task 3: Moderate Image Scanner

**Files:**
- Modify: `tests/scanner.test.js`
- Modify: `image-grabber.user.js`

- [ ] **Step 1: Add failing scanner tests**

Append to `tests/scanner.test.js`:

```js
const { JSDOM } = require("jsdom");

function scanHtml(html, url = "https://example.com/page.html") {
  const dom = new JSDOM(html, { url, pretendToBeVisual: true });
  return grabber.scanner.scanDocument(dom.window.document);
}

test("scanDocument finds img, srcset, lazy attributes, and visible backgrounds", () => {
  const results = scanHtml(`
    <img src="/plain.jpg" width="1200" height="800">
    <img srcset="/small.jpg 480w, /large.jpg 1200w">
    <picture><source srcset="/source.webp 1x"><img src="/fallback.jpg"></picture>
    <img data-src="/lazy.jpg" width="900" height="600">
    <div style="background-image: url('/background.png'); width: 400px; height: 300px;">x</div>
  `);

  const urls = results.map((item) => item.url).sort();
  assert.deepEqual(urls, [
    "https://example.com/background.png",
    "https://example.com/fallback.jpg",
    "https://example.com/large.jpg",
    "https://example.com/lazy.jpg",
    "https://example.com/plain.jpg",
    "https://example.com/small.jpg",
    "https://example.com/source.webp",
  ]);
});

test("scanDocument deduplicates URLs and merges source types", () => {
  const results = scanHtml(`
    <img src="/same.jpg" width="1000" height="700">
    <img data-src="/same.jpg">
    <div style="background-image: url('/same.jpg'); width: 400px; height: 300px;"></div>
  `);

  assert.equal(results.length, 1);
  assert.equal(results[0].url, "https://example.com/same.jpg");
  assert.deepEqual(results[0].sourceTypes.sort(), ["background", "img", "lazy"].sort());
});

test("scanDocument marks small decorative images but still returns them", () => {
  const results = scanHtml(`<img src="/favicon.png" width="16" height="16">`);

  assert.equal(results.length, 1);
  assert.equal(results[0].likelySmall, true);
});
```

- [ ] **Step 2: Run tests and verify failure**

Run:

```powershell
npm test
```

Expected: FAIL because `scanDocument` returns an empty array.

- [ ] **Step 3: Implement document scanning**

Inside `scanner`, before `scanDocument`, add:

```js
    isVisibleElement(element) {
      if (!element || !element.ownerDocument) return false;
      const win = element.ownerDocument.defaultView;
      if (!win || !win.getComputedStyle) return true;
      const style = win.getComputedStyle(element);
      return style.display !== "none" && style.visibility !== "hidden" && style.opacity !== "0";
    },

    addCandidate(map, input) {
      const candidate = this.createCandidate(input);
      if (!candidate) return;
      const existing = map.get(candidate.id);
      if (existing) {
        for (const sourceType of candidate.sourceTypes) {
          if (!existing.sourceTypes.includes(sourceType)) existing.sourceTypes.push(sourceType);
        }
        existing.width = Math.max(existing.width, candidate.width);
        existing.height = Math.max(existing.height, candidate.height);
        existing.likelySmall = existing.likelySmall && candidate.likelySmall;
        existing.elementVisible = existing.elementVisible || candidate.elementVisible;
        return;
      }
      map.set(candidate.id, candidate);
    },

    collectBackgroundUrls(value) {
      if (!value || value === "none") return [];
      const urls = [];
      const pattern = /url\((?:"([^"]+)"|'([^']+)'|([^'")]+))\)/g;
      let match;
      while ((match = pattern.exec(value))) {
        urls.push(match[1] || match[2] || match[3]);
      }
      return urls;
    },
```

Replace `scanDocument()` with:

```js
    scanDocument(doc) {
      const documentToScan = doc || document;
      const baseUrl = documentToScan.baseURI;
      const candidates = new Map();

      for (const img of Array.from(documentToScan.images || [])) {
        const visible = this.isVisibleElement(img);
        this.addCandidate(candidates, {
          url: img.currentSrc || img.src,
          sourceType: "img",
          baseUrl,
          width: img.naturalWidth || img.width,
          height: img.naturalHeight || img.height,
          elementVisible: visible,
        });

        for (const src of utils.parseSrcset(img.getAttribute("srcset"))) {
          this.addCandidate(candidates, {
            url: src,
            sourceType: "srcset",
            baseUrl,
            width: img.naturalWidth || img.width,
            height: img.naturalHeight || img.height,
            elementVisible: visible,
          });
        }

        for (const attr of config.lazyAttributes) {
          const value = img.getAttribute(attr);
          const values = attr.includes("srcset") ? utils.parseSrcset(value) : [value];
          for (const lazyUrl of values) {
            this.addCandidate(candidates, {
              url: lazyUrl,
              sourceType: "lazy",
              baseUrl,
              width: img.naturalWidth || img.width,
              height: img.naturalHeight || img.height,
              elementVisible: visible,
            });
          }
        }
      }

      for (const source of Array.from(documentToScan.querySelectorAll("source[srcset]"))) {
        for (const src of utils.parseSrcset(source.getAttribute("srcset"))) {
          this.addCandidate(candidates, {
            url: src,
            sourceType: "srcset",
            baseUrl,
            width: 0,
            height: 0,
            elementVisible: this.isVisibleElement(source),
          });
        }
      }

      const win = documentToScan.defaultView;
      for (const element of Array.from(documentToScan.querySelectorAll("*"))) {
        if (!this.isVisibleElement(element)) continue;
        const style = win && win.getComputedStyle ? win.getComputedStyle(element) : element.style;
        for (const url of this.collectBackgroundUrls(style && style.backgroundImage)) {
          this.addCandidate(candidates, {
            url,
            sourceType: "background",
            baseUrl,
            width: element.clientWidth || 0,
            height: element.clientHeight || 0,
            elementVisible: true,
          });
        }
      }

      return Array.from(candidates.values()).sort((a, b) => a.displayUrl.localeCompare(b.displayUrl));
    },
```

- [ ] **Step 4: Run tests**

Run:

```powershell
npm test
```

Expected: PASS.

- [ ] **Step 5: Checkpoint**

Run:

```powershell
git rev-parse --is-inside-work-tree
```

Expected in the current workspace: `fatal: not a git repository`. Do not commit unless git exists.

---

### Task 4: Gallery UI And Floating Button

**Files:**
- Modify: `image-grabber.user.js`

- [ ] **Step 1: Add UI module and startup behavior**

Add the following modules after `scanner` and before `api`:

```js
  const ui = {
    rootId: "image-grabber-gallery-root",
    state: {
      candidates: [],
      selected: new Set(),
      hideSmall: true,
    },

    init() {
      if (document.getElementById(this.rootId)) return;
      this.injectStyles();
      this.createButton();
    },

    injectStyles() {
      const style = document.createElement("style");
      style.textContent = `
        #${this.rootId}, #${this.rootId} * { box-sizing: border-box; }
        #${this.rootId} .ig-button {
          position: fixed; right: 16px; bottom: 16px; z-index: 2147483647;
          width: 48px; height: 48px; border: 0; border-radius: 50%;
          background: #155eef; color: white; font: 700 20px system-ui, sans-serif;
          box-shadow: 0 8px 24px rgba(16, 24, 40, .24); cursor: pointer;
        }
        #${this.rootId} .ig-overlay {
          position: fixed; inset: 0; z-index: 2147483646;
          background: rgba(15, 23, 42, .52); display: grid; place-items: center;
          padding: 16px;
        }
        #${this.rootId} .ig-panel {
          width: min(1100px, 100%); height: min(760px, 100%);
          background: #ffffff; color: #111827; border-radius: 8px;
          display: grid; grid-template-rows: auto 1fr auto;
          overflow: hidden; box-shadow: 0 24px 70px rgba(15, 23, 42, .35);
          font: 14px system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
        }
        #${this.rootId} .ig-toolbar {
          display: flex; gap: 8px; align-items: center; flex-wrap: wrap;
          padding: 10px; border-bottom: 1px solid #e5e7eb; background: #f9fafb;
        }
        #${this.rootId} .ig-toolbar strong { margin-right: auto; }
        #${this.rootId} button, #${this.rootId} label {
          min-height: 36px; border-radius: 6px; border: 1px solid #d1d5db;
          background: #fff; color: #111827; padding: 0 10px; cursor: pointer;
          display: inline-flex; align-items: center; gap: 6px;
        }
        #${this.rootId} .ig-primary { background: #155eef; color: white; border-color: #155eef; }
        #${this.rootId} .ig-grid {
          overflow: auto; padding: 12px; display: grid;
          grid-template-columns: repeat(auto-fill, minmax(150px, 1fr)); gap: 10px;
        }
        #${this.rootId} .ig-card {
          border: 1px solid #e5e7eb; border-radius: 8px; overflow: hidden;
          background: #fff; min-width: 0;
        }
        #${this.rootId} .ig-card img {
          width: 100%; aspect-ratio: 1 / 1; object-fit: contain;
          background: #f3f4f6; display: block;
        }
        #${this.rootId} .ig-card-body { padding: 8px; display: grid; gap: 6px; }
        #${this.rootId} .ig-meta { color: #4b5563; font-size: 12px; overflow-wrap: anywhere; }
        #${this.rootId} .ig-status { padding: 8px 10px; border-top: 1px solid #e5e7eb; max-height: 120px; overflow: auto; color: #374151; }
        @media (max-width: 640px) {
          #${this.rootId} .ig-overlay { padding: 0; place-items: stretch; }
          #${this.rootId} .ig-panel { width: 100%; height: 100%; border-radius: 0; }
          #${this.rootId} .ig-grid { grid-template-columns: repeat(2, minmax(0, 1fr)); }
        }
      `;
      document.head.appendChild(style);
    },

    createButton() {
      const root = document.createElement("div");
      root.id = this.rootId;
      const button = document.createElement("button");
      button.className = "ig-button";
      button.type = "button";
      button.textContent = "↓";
      button.title = "Find page images";
      button.addEventListener("click", () => this.open());
      root.appendChild(button);
      document.documentElement.appendChild(root);
    },

    open() {
      this.state.candidates = scanner.scanDocument(document);
      this.state.selected = new Set();
      this.renderOverlay();
    },

    visibleCandidates() {
      return this.state.candidates.filter((candidate) => !this.state.hideSmall || !candidate.likelySmall);
    },

    renderOverlay() {
      const root = document.getElementById(this.rootId);
      root.querySelector(".ig-overlay")?.remove();
      const overlay = document.createElement("div");
      overlay.className = "ig-overlay";
      overlay.appendChild(this.renderPanel());
      root.appendChild(overlay);
    },

    renderPanel() {
      const panel = document.createElement("section");
      panel.className = "ig-panel";
      panel.append(this.renderToolbar(), this.renderGrid(), this.renderStatus());
      return panel;
    },

    renderToolbar() {
      const toolbar = document.createElement("div");
      toolbar.className = "ig-toolbar";
      const title = document.createElement("strong");
      title.textContent = `Images: ${this.visibleCandidates().length} shown, ${this.state.selected.size} selected`;
      toolbar.appendChild(title);
      toolbar.append(
        this.button("Refresh", () => this.open()),
        this.button("Select all", () => {
          for (const item of this.visibleCandidates()) this.state.selected.add(item.id);
          this.renderOverlay();
        }),
        this.button("Clear", () => {
          this.state.selected.clear();
          this.renderOverlay();
        }),
        this.toggleSmallFilter(),
        this.button("Download selected", () => downloadAdapter.downloadMany(this.selectedCandidates()), "ig-primary"),
        this.button("Close", () => this.close())
      );
      return toolbar;
    },

    toggleSmallFilter() {
      const label = document.createElement("label");
      const input = document.createElement("input");
      input.type = "checkbox";
      input.checked = this.state.hideSmall;
      input.addEventListener("change", () => {
        this.state.hideSmall = input.checked;
        this.renderOverlay();
      });
      label.append(input, document.createTextNode("Hide small"));
      return label;
    },

    renderGrid() {
      const grid = document.createElement("div");
      grid.className = "ig-grid";
      const items = this.visibleCandidates();
      if (!items.length) {
        const empty = document.createElement("p");
        empty.textContent = "No images found with the current filter.";
        grid.appendChild(empty);
        return grid;
      }
      for (const item of items) grid.appendChild(this.renderCard(item));
      return grid;
    },

    renderCard(item) {
      const card = document.createElement("article");
      card.className = "ig-card";
      const img = document.createElement("img");
      img.src = item.url;
      img.alt = "";
      img.loading = "lazy";
      const body = document.createElement("div");
      body.className = "ig-card-body";
      const label = document.createElement("label");
      const checkbox = document.createElement("input");
      checkbox.type = "checkbox";
      checkbox.checked = this.state.selected.has(item.id);
      checkbox.addEventListener("change", () => {
        if (checkbox.checked) this.state.selected.add(item.id);
        else this.state.selected.delete(item.id);
        this.renderOverlay();
      });
      label.append(checkbox, document.createTextNode("Select"));
      const meta = document.createElement("div");
      meta.className = "ig-meta";
      const size = item.width && item.height ? `${item.width}x${item.height}` : "size unknown";
      meta.textContent = `${size} · ${item.sourceTypes.join(", ")} · ${item.displayUrl}`;
      body.append(label, meta);
      card.append(img, body);
      return card;
    },

    renderStatus() {
      const status = document.createElement("div");
      status.className = "ig-status";
      status.setAttribute("aria-live", "polite");
      status.textContent = "Ready.";
      return status;
    },

    selectedCandidates() {
      return this.state.candidates.filter((candidate) => this.state.selected.has(candidate.id));
    },

    setStatus(message) {
      const root = document.getElementById(this.rootId);
      const status = root && root.querySelector(".ig-status");
      if (status) status.textContent = message;
    },

    button(text, onClick, className) {
      const button = document.createElement("button");
      button.type = "button";
      button.textContent = text;
      if (className) button.className = className;
      button.addEventListener("click", onClick);
      return button;
    },

    close() {
      document.getElementById(this.rootId)?.querySelector(".ig-overlay")?.remove();
    },
  };
```

Change the bottom of the browser branch to initialize the UI:

```js
  if (typeof module !== "undefined" && module.exports) {
    module.exports = api;
    return;
  }

  ui.init();
```

- [ ] **Step 2: Run tests**

Run:

```powershell
npm test
```

Expected: PASS. UI code should not run in Node because the CommonJS export returns first.

- [ ] **Step 3: Checkpoint**

Run:

```powershell
git rev-parse --is-inside-work-tree
```

Expected in the current workspace: `fatal: not a git repository`. Do not commit unless git exists.

---

### Task 5: Download Adapter And Compatibility Layer

**Files:**
- Modify: `image-grabber.user.js`

- [ ] **Step 1: Add compatibility and download modules**

Add these modules after `scanner` and before `ui`:

```js
  const compat = {
    gmDownload: typeof GM_download === "function" ? GM_download : null,
    gmOpenInTab: typeof GM_openInTab === "function" ? GM_openInTab : null,

    openTab(url) {
      if (this.gmOpenInTab) {
        this.gmOpenInTab(url, { active: true, insert: true });
        return true;
      }
      const opened = window.open(url, "_blank", "noopener,noreferrer");
      return Boolean(opened);
    },
  };

  const downloadAdapter = {
    async downloadMany(items) {
      if (!items.length) {
        ui.setStatus("No selected images.");
        return;
      }
      for (let index = 0; index < items.length; index += 1) {
        const item = items[index];
        ui.setStatus(`Processing ${index + 1}/${items.length}: ${item.displayUrl}`);
        await this.downloadOne(item, index + 1);
        await new Promise((resolve) => setTimeout(resolve, 350));
      }
      ui.setStatus(`Finished ${items.length} image attempt(s).`);
    },

    downloadOne(item, index) {
      const filename = utils.filenameFromUrl(item.url, index);
      if (compat.gmDownload) {
        return new Promise((resolve) => {
          try {
            compat.gmDownload({
              url: item.url,
              name: filename,
              saveAs: false,
              onload: () => resolve({ method: "GM_download" }),
              onerror: () => {
                this.openFallback(item);
                resolve({ method: "openFallback" });
              },
              ontimeout: () => {
                this.openFallback(item);
                resolve({ method: "openFallback" });
              },
            });
          } catch (_) {
            this.anchorOrOpen(item, filename);
            resolve({ method: "anchorOrOpen" });
          }
        });
      }
      this.anchorOrOpen(item, filename);
      return Promise.resolve({ method: "anchorOrOpen" });
    },

    anchorOrOpen(item, filename) {
      try {
        const link = document.createElement("a");
        link.href = item.url;
        link.download = filename;
        link.rel = "noopener noreferrer";
        link.style.display = "none";
        document.body.appendChild(link);
        link.click();
        link.remove();
        ui.setStatus(`Download started or browser handled: ${item.displayUrl}`);
      } catch (_) {
        this.openFallback(item);
      }
    },

    openFallback(item) {
      const opened = compat.openTab(item.url);
      if (opened) {
        ui.setStatus(`Opened for manual saving: ${item.displayUrl}`);
        return;
      }
      ui.setStatus(`Could not open automatically. Copy URL: ${item.url}`);
    },
  };
```

Update exported API:

```js
  const api = { config, utils, scanner, compat, downloadAdapter, ui };
```

- [ ] **Step 2: Run tests**

Run:

```powershell
npm test
```

Expected: PASS.

- [ ] **Step 3: Checkpoint**

Run:

```powershell
git rev-parse --is-inside-work-tree
```

Expected in the current workspace: `fatal: not a git repository`. Do not commit unless git exists.

---

### Task 6: Fixture Page And Manual Verification

**Files:**
- Create: `fixtures/test-page.html`
- Modify: `README.md`

- [ ] **Step 1: Create the fixture page**

Create `fixtures/test-page.html`:

```html
<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8">
    <meta name="viewport" content="width=device-width, initial-scale=1">
    <title>Image Grabber Fixture</title>
    <style>
      body { font-family: system-ui, sans-serif; margin: 24px; color: #111827; }
      main { display: grid; gap: 24px; max-width: 900px; }
      .hero {
        min-height: 220px;
        background-image: url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='900' height='360'%3E%3Crect width='900' height='360' fill='%2387ceeb'/%3E%3Ccircle cx='700' cy='90' r='55' fill='%23ffd166'/%3E%3Cpath d='M0 300 L250 140 L420 300 Z' fill='%233a7d44'/%3E%3Cpath d='M260 300 L560 120 L900 300 Z' fill='%232f5f98'/%3E%3C/svg%3E");
        background-size: cover;
        border-radius: 8px;
      }
      .tiny { width: 16px; height: 16px; }
    </style>
  </head>
  <body>
    <main>
      <h1>Image Grabber Fixture</h1>
      <img
        src="data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='640' height='360'%3E%3Crect width='640' height='360' fill='%23fca5a5'/%3E%3Ctext x='32' y='190' font-size='48'%3ENormal image%3C/text%3E%3C/svg%3E"
        width="640"
        height="360"
        alt="Normal test image">
      <img
        srcset="data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='320' height='180'%3E%3Crect width='320' height='180' fill='%23bfdbfe'/%3E%3Ctext x='24' y='96' font-size='28'%3ESrcset small%3C/text%3E%3C/svg%3E 320w, data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='960' height='540'%3E%3Crect width='960' height='540' fill='%2399f6e4'/%3E%3Ctext x='48' y='280' font-size='64'%3ESrcset large%3C/text%3E%3C/svg%3E 960w"
        width="320"
        height="180"
        alt="Srcset test image">
      <img
        data-src="data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='500' height='300'%3E%3Crect width='500' height='300' fill='%23fde68a'/%3E%3Ctext x='36' y='160' font-size='42'%3ELazy image%3C/text%3E%3C/svg%3E"
        width="500"
        height="300"
        alt="Lazy test image">
      <div class="hero"></div>
      <img
        class="tiny"
        src="data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='16' height='16'%3E%3Crect width='16' height='16' fill='%23000'/%3E%3C/svg%3E"
        width="16"
        height="16"
        alt="">
    </main>
  </body>
</html>
```

- [ ] **Step 2: Add README instructions**

Create `README.md`:

```markdown
# Image Grabber Gallery

A cross-manager userscript for finding images already available on the current page and saving selected images from a visual gallery.

## Install

1. Open `image-grabber.user.js`.
2. Copy it into Violentmonkey, Tampermonkey, iOS Userscripts, or a compatible manager.
3. Enable the script for the sites where you want the floating image button.

## Behavior

The script scans normal images, `srcset`, common lazy-load attributes, and visible CSS background images. It does not bypass DRM, paywalls, login requirements, or server-side access controls.

Downloads use the best available path:

1. `GM_download` when supported.
2. Browser anchor download.
3. Opening the image in a new tab for manual saving.

On iOS, opening the image for saving through the system browser or share sheet is expected.

## Development

Install test dependencies:

```powershell
npm install
```

Run tests:

```powershell
npm test
```

Manual fixture:

Open `fixtures/test-page.html` in a browser with the userscript enabled. Press the floating button and verify that normal images, `srcset`, lazy image URLs, and background images appear in the gallery. Toggle `Hide small` to show the tiny image.
```

- [ ] **Step 3: Run automated tests**

Run:

```powershell
npm test
```

Expected: PASS.

- [ ] **Step 4: Manual fixture check**

Open `fixtures/test-page.html` in a browser with the userscript installed. Expected:

- Floating button appears in the bottom-right corner.
- Pressing it opens the gallery overlay.
- Normal, `srcset`, lazy, and background candidates are visible.
- Tiny image is hidden while `Hide small` is checked and visible after unchecking it.
- Selecting one or more cards updates the selected count.
- `Download selected` starts a download or opens the image depending on browser support.

- [ ] **Step 5: Checkpoint**

Run:

```powershell
git rev-parse --is-inside-work-tree
```

Expected in the current workspace: `fatal: not a git repository`. Do not commit unless git exists.

---

### Task 7: Final Verification And Cleanup

**Files:**
- Verify: `image-grabber.user.js`
- Verify: `tests/scanner.test.js`
- Verify: `fixtures/test-page.html`
- Verify: `README.md`

- [ ] **Step 1: Run all tests**

Run:

```powershell
npm test
```

Expected: all tests pass.

- [ ] **Step 2: Check userscript metadata grants**

Run:

```powershell
Select-String -Path image-grabber.user.js -Pattern "@grant|@match|@run-at"
```

Expected output includes:

```text
// @match        *://*/*
// @grant        GM_download
// @grant        GM_openInTab
// @grant        GM_xmlhttpRequest
// @run-at       document-idle
```

- [ ] **Step 3: Check no unresolved plan markers leaked into product files**

Run:

```powershell
$pattern = "TB" + "D|TO" + "DO|FIX" + "ME|place" + "holder"
rg -n $pattern image-grabber.user.js tests fixtures README.md
```

Expected: no matches.

- [ ] **Step 4: Confirm workspace status**

Run:

```powershell
git status --short
```

Expected in the current workspace: `fatal: not a git repository`. If a git repository has been initialized by then, review changed files and commit the finished implementation.

---

## Self-Review

- Spec coverage: The plan covers the floating button, moderate discovery, visual grid gallery, hide-small filter, selectable cards, optional GM APIs, fallback to new tab, fixture page, and tests.
- Intentional limits: No DRM/paywall bypass, no `performance.getEntriesByType("resource")`, no crawling, no extension packaging, and no ZIP export.
- Type consistency: Candidate fields match the design spec: `id`, `url`, `displayUrl`, `sourceTypes`, `width`, `height`, `elementVisible`, and `likelySmall`.
