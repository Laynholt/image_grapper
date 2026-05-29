// ==UserScript==
// @name         Image Grabber Gallery
// @namespace    local.image-grabber
// @version      0.2.0
// @description  Find images on the current page and save selected ones.
// @match        *://*/*
// @icon         data:image/svg+xml,%3Csvg%20xmlns%3D%22http%3A%2F%2Fwww.w3.org%2F2000%2Fsvg%22%20viewBox%3D%220%200%2064%2064%22%3E%3Crect%20width%3D%2264%22%20height%3D%2264%22%20rx%3D%2214%22%20fill%3D%22%230b1220%22%2F%3E%3Cpath%20d%3D%22M16%2018h32v28H16z%22%20fill%3D%22%23111827%22%20stroke%3D%22%2338bdf8%22%20stroke-width%3D%224%22%2F%3E%3Ccircle%20cx%3D%2242%22%20cy%3D%2225%22%20r%3D%224%22%20fill%3D%22%23facc15%22%2F%3E%3Cpath%20d%3D%22M19%2042l9-11%207%208%205-6%207%209z%22%20fill%3D%22%2322c55e%22%2F%3E%3Cpath%20d%3D%22M32%2054V36m0%2018l-8-8m8%208l8-8%22%20stroke%3D%22%23f8fafc%22%20stroke-width%3D%224%22%20stroke-linecap%3D%22round%22%20stroke-linejoin%3D%22round%22%2F%3E%3C%2Fsvg%3E
// @icon64       data:image/svg+xml,%3Csvg%20xmlns%3D%22http%3A%2F%2Fwww.w3.org%2F2000%2Fsvg%22%20viewBox%3D%220%200%2064%2064%22%3E%3Crect%20width%3D%2264%22%20height%3D%2264%22%20rx%3D%2214%22%20fill%3D%22%230b1220%22%2F%3E%3Cpath%20d%3D%22M16%2018h32v28H16z%22%20fill%3D%22%23111827%22%20stroke%3D%22%2338bdf8%22%20stroke-width%3D%224%22%2F%3E%3Ccircle%20cx%3D%2242%22%20cy%3D%2225%22%20r%3D%224%22%20fill%3D%22%23facc15%22%2F%3E%3Cpath%20d%3D%22M19%2042l9-11%207%208%205-6%207%209z%22%20fill%3D%22%2322c55e%22%2F%3E%3Cpath%20d%3D%22M32%2054V36m0%2018l-8-8m8%208l8-8%22%20stroke%3D%22%23f8fafc%22%20stroke-width%3D%224%22%20stroke-linecap%3D%22round%22%20stroke-linejoin%3D%22round%22%2F%3E%3C%2Fsvg%3E
// @grant        GM_download
// @grant        GM_openInTab
// @grant        GM_xmlhttpRequest
// @run-at       document-idle
// ==/UserScript==

(function () {
  "use strict";

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
    iconSvg: `
      <svg viewBox="0 0 64 64" aria-hidden="true" focusable="false">
        <rect width="64" height="64" rx="14" fill="#0b1220"></rect>
        <path d="M16 18h32v28H16z" fill="#111827" stroke="#38bdf8" stroke-width="4"></path>
        <circle cx="42" cy="25" r="4" fill="#facc15"></circle>
        <path d="M19 42l9-11 7 8 5-6 7 9z" fill="#22c55e"></path>
        <path d="M32 54V36m0 18l-8-8m8 8l8-8" stroke="#f8fafc" stroke-width="4" stroke-linecap="round" stroke-linejoin="round"></path>
      </svg>
    `,
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
  };

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

  const ui = {
    rootId: "image-grabber-gallery-root",
    shadow: null,
    state: {
      candidates: [],
      selected: new Set(),
      hideSmall: true,
    },

    init() {
      const existing = document.getElementById(this.rootId);
      if (existing) {
        this.shadow = existing.shadowRoot;
        return;
      }
      this.createButton();
    },

    createStyles() {
      const style = document.createElement("style");
      style.textContent = `
        :host, :host * { box-sizing: border-box; }
        button { font: inherit; }
        .ig-button {
          position: fixed; right: 16px; bottom: 16px; z-index: 2147483647;
          width: 48px; height: 48px; border: 0; border-radius: 50%;
          background: #0b1220; color: white; padding: 7px;
          box-shadow: 0 10px 30px rgba(0, 0, 0, .45), 0 0 0 1px rgba(56, 189, 248, .55);
          cursor: pointer;
        }
        .ig-button svg { width: 100%; height: 100%; display: block; }
        .ig-button:hover { transform: translateY(-1px); }
        .ig-overlay {
          position: fixed; inset: 0; z-index: 2147483646;
          background: rgba(2, 6, 23, .72); display: grid; place-items: center;
          padding: 16px;
        }
        .ig-panel {
          width: min(1100px, 100%); height: min(760px, 100%);
          background: #0b1220; color: #e5e7eb; border: 1px solid #1f2a44; border-radius: 8px;
          display: grid; grid-template-rows: auto 1fr auto;
          overflow: hidden; box-shadow: 0 24px 70px rgba(0, 0, 0, .6);
          font: 14px system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
        }
        .ig-toolbar {
          display: flex; gap: 8px; align-items: center; flex-wrap: wrap;
          padding: 10px; border-bottom: 1px solid #1f2a44; background: #111827;
        }
        .ig-toolbar strong { margin-right: auto; color: #f8fafc; }
        .ig-toolbar button {
          min-height: 36px; border-radius: 6px; border: 1px solid #334155;
          background: #172033; color: #e5e7eb; padding: 0 10px; cursor: pointer;
          display: inline-flex; align-items: center; gap: 6px;
        }
        .ig-toolbar button:hover, .ig-select:hover { border-color: #38bdf8; color: #f8fafc; }
        .ig-primary { background: #0ea5e9; color: #06111f; border-color: #38bdf8; font-weight: 700; }
        .ig-grid {
          overflow: auto; padding: 12px; display: grid;
          grid-template-columns: repeat(auto-fill, minmax(150px, 1fr)); gap: 10px;
        }
        .ig-card {
          border: 1px solid #1f2a44; border-radius: 8px; overflow: hidden;
          background: #111827; min-width: 0;
        }
        .ig-card img {
          width: 100%; aspect-ratio: 1 / 1; object-fit: contain;
          background: #020617; display: block;
        }
        .ig-card-body { padding: 8px; display: grid; gap: 6px; }
        .ig-select {
          min-height: 34px; border-radius: 6px; border: 1px solid #334155;
          background: #172033; color: #e5e7eb; cursor: pointer;
          display: inline-flex; align-items: center; justify-content: center; gap: 8px;
          width: 100%;
        }
        .ig-select::before {
          content: ""; width: 16px; height: 16px; border-radius: 4px;
          border: 1px solid #64748b; background: #020617; display: inline-block;
        }
        .ig-select[aria-pressed="true"] { background: #0f3b57; border-color: #38bdf8; color: #f8fafc; }
        .ig-select[aria-pressed="true"]::before {
          background: #38bdf8; border-color: #7dd3fc;
          box-shadow: inset 0 0 0 3px #0f172a;
        }
        .ig-meta { color: #94a3b8; font-size: 12px; overflow-wrap: anywhere; }
        .ig-status { padding: 8px 10px; border-top: 1px solid #1f2a44; max-height: 120px; overflow: auto; color: #cbd5e1; background: #111827; }
        @media (max-width: 640px) {
          .ig-overlay { padding: 0; place-items: stretch; }
          .ig-panel { width: 100%; height: 100%; border-radius: 0; }
          .ig-grid { grid-template-columns: repeat(2, minmax(0, 1fr)); }
        }
      `;
      return style;
    },

    createButton() {
      const root = document.createElement("div");
      root.id = this.rootId;
      this.shadow = root.attachShadow({ mode: "open" });
      this.shadow.appendChild(this.createStyles());
      const button = document.createElement("button");
      button.className = "ig-button";
      button.type = "button";
      button.title = "Find page images";
      button.setAttribute("aria-label", "Find page images");
      button.innerHTML = config.iconSvg;
      button.addEventListener("click", () => this.open());
      this.shadow.appendChild(button);
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
      const root = this.shadow;
      if (!root) return;
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
      const button = document.createElement("button");
      button.type = "button";
      button.setAttribute("aria-pressed", String(this.state.hideSmall));
      button.textContent = this.state.hideSmall ? "Small hidden" : "Small shown";
      button.addEventListener("click", () => {
        this.state.hideSmall = !this.state.hideSmall;
        this.renderOverlay();
      });
      return button;
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
      const selectButton = document.createElement("button");
      selectButton.type = "button";
      selectButton.className = "ig-select";
      selectButton.setAttribute("aria-pressed", String(this.state.selected.has(item.id)));
      selectButton.textContent = this.state.selected.has(item.id) ? "Selected" : "Select";
      selectButton.addEventListener("click", () => {
        if (this.state.selected.has(item.id)) this.state.selected.delete(item.id);
        else this.state.selected.add(item.id);
        this.renderOverlay();
      });
      const meta = document.createElement("div");
      meta.className = "ig-meta";
      const size = item.width && item.height ? `${item.width}x${item.height}` : "size unknown";
      meta.textContent = `${size} - ${item.sourceTypes.join(", ")} - ${item.displayUrl}`;
      body.append(selectButton, meta);
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
      const root = this.shadow || document.getElementById(this.rootId)?.shadowRoot;
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
      const root = this.shadow || document.getElementById(this.rootId)?.shadowRoot;
      root?.querySelector(".ig-overlay")?.remove();
    },
  };

  const api = { config, utils, scanner, compat, downloadAdapter, ui };

  if (typeof module !== "undefined" && module.exports) {
    module.exports = api;
    return;
  }

  ui.init();
})();
