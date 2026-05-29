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
          background: #155eef; color: white; font: 700 13px system-ui, sans-serif;
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
      button.textContent = "IMG";
      button.title = "Find page images";
      button.setAttribute("aria-label", "Find page images");
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
      meta.textContent = `${size} - ${item.sourceTypes.join(", ")} - ${item.displayUrl}`;
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

  const api = { config, utils, scanner, compat, downloadAdapter, ui };

  if (typeof module !== "undefined" && module.exports) {
    module.exports = api;
    return;
  }

  ui.init();
})();
