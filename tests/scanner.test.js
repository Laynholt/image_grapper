const test = require("node:test");
const assert = require("node:assert/strict");
const { JSDOM } = require("jsdom");

const grabber = require("../image-grabber.user.js");

function scanHtml(html, url = "https://example.com/page.html") {
  const dom = new JSDOM(html, { url, pretendToBeVisual: true });
  return grabber.scanner.scanDocument(dom.window.document);
}

test("exports testable modules in Node", () => {
  assert.equal(typeof grabber.utils.normalizeUrl, "function");
  assert.equal(typeof grabber.scanner.scanDocument, "function");
});

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

test("createButton mounts UI in shadow DOM to isolate page styles", () => {
  const dom = new JSDOM("<!doctype html><html><head></head><body></body></html>", {
    url: "https://example.com/page.html",
    pretendToBeVisual: true,
  });
  const previousDocument = global.document;
  global.document = dom.window.document;

  try {
    grabber.ui.init();

    const host = dom.window.document.getElementById(grabber.ui.rootId);
    assert.ok(host);
    assert.ok(host.shadowRoot);
    assert.equal(host.shadowRoot.querySelectorAll(".ig-button").length, 1);
    assert.equal(host.querySelectorAll(".ig-button").length, 0);
  } finally {
    grabber.ui.close();
    global.document = previousDocument;
    grabber.ui.shadow = null;
  }
});

test("init replaces a stale existing host instead of binding new state to old controls", () => {
  const dom = new JSDOM("<!doctype html><html><head></head><body></body></html>", {
    url: "https://example.com/page.html",
    pretendToBeVisual: true,
  });
  const previousDocument = global.document;
  global.document = dom.window.document;

  try {
    const staleHost = dom.window.document.createElement("div");
    staleHost.id = grabber.ui.rootId;
    staleHost.attachShadow({ mode: "open" }).innerHTML = "<button class='ig-button'>stale</button>";
    dom.window.document.documentElement.appendChild(staleHost);

    grabber.ui.shadow = null;
    grabber.ui.boundShadow = null;
    grabber.ui.init();

    const host = dom.window.document.getElementById(grabber.ui.rootId);
    assert.notEqual(host, staleHost);
    assert.equal(dom.window.document.querySelectorAll(`#${grabber.ui.rootId}`).length, 1);
    assert.equal(host.shadowRoot.querySelector(".ig-button").textContent.trim(), "");
  } finally {
    grabber.ui.close();
    dom.window.document.getElementById(grabber.ui.rootId)?.remove();
    grabber.ui.shadow = null;
    grabber.ui.boundShadow = null;
    global.document = previousDocument;
  }
});

test("renderCard uses the whole thumbnail card as the selector", () => {
  const dom = new JSDOM("<!doctype html><html><head></head><body></body></html>", {
    url: "https://example.com/page.html",
  });
  const previousDocument = global.document;
  global.document = dom.window.document;

  try {
    const item = grabber.scanner.createCandidate({
      url: "https://example.com/image.jpg",
      sourceType: "img",
      baseUrl: "https://example.com/page.html",
      width: 640,
      height: 480,
    });
    grabber.ui.state.selected = new Set();

    const card = grabber.ui.renderCard(item);

    assert.equal(card.querySelectorAll('input[type="checkbox"]').length, 0);
    assert.equal(card.querySelectorAll("button.ig-select").length, 0);
    assert.equal(card.getAttribute("role"), "button");
    assert.equal(card.getAttribute("aria-selected"), "false");
    assert.equal(card.dataset.imageId, item.id);
  } finally {
    global.document = previousDocument;
  }
});

test("thumbnail card toggles image selection state", () => {
  const dom = new JSDOM(
    `<!doctype html><html><head></head><body>
      <img src="/image.jpg" width="640" height="480">
    </body></html>`,
    {
      url: "https://example.com/page.html",
      pretendToBeVisual: true,
    }
  );
  const previousDocument = global.document;
  global.document = dom.window.document;

  try {
    grabber.ui.shadow = null;
    grabber.ui.state.selected = new Set();
    grabber.ui.state.candidates = [];
    grabber.ui.init();
    grabber.ui.open();

    const card = dom.window.document
      .getElementById(grabber.ui.rootId)
      .shadowRoot.querySelector(".ig-card");
    card.click();
    assert.equal(grabber.ui.state.selected.has("https://example.com/image.jpg"), true);

    dom.window.document
      .getElementById(grabber.ui.rootId)
      .shadowRoot.querySelector(".ig-card")
      .click();
    assert.equal(grabber.ui.state.selected.has("https://example.com/image.jpg"), false);
  } finally {
    grabber.ui.close();
    dom.window.document.getElementById(grabber.ui.rootId)?.remove();
    grabber.ui.shadow = null;
    grabber.ui.boundShadow = null;
    grabber.ui.state.selected = new Set();
    grabber.ui.state.candidates = [];
    global.document = previousDocument;
  }
});

test("thumbnail cards remain interactive after refreshing newly loaded images", () => {
  const dom = new JSDOM(
    `<!doctype html><html><head></head><body>
      <img src="/first.jpg" width="640" height="480">
    </body></html>`,
    {
      url: "https://example.com/page.html",
      pretendToBeVisual: true,
    }
  );
  const previousDocument = global.document;
  global.document = dom.window.document;

  try {
    grabber.ui.shadow = null;
    grabber.ui.state.selected = new Set();
    grabber.ui.state.candidates = [];
    grabber.ui.init();
    grabber.ui.open();

    const firstCard = dom.window.document
      .getElementById(grabber.ui.rootId)
      .shadowRoot.querySelector(".ig-card");
    firstCard.click();
    assert.equal(grabber.ui.state.selected.size, 1);

    const loadedLater = dom.window.document.createElement("img");
    loadedLater.src = "/second.jpg";
    loadedLater.width = 800;
    loadedLater.height = 600;
    dom.window.document.body.appendChild(loadedLater);

    dom.window.document
      .getElementById(grabber.ui.rootId)
      .shadowRoot.querySelector(".ig-toolbar button")
      .click();

    const cardsAfterRefresh = dom.window.document
      .getElementById(grabber.ui.rootId)
      .shadowRoot.querySelectorAll(".ig-card");
    assert.equal(cardsAfterRefresh.length, 2);
    assert.equal(grabber.ui.state.selected.size, 0);

    cardsAfterRefresh[1].click();

    assert.equal(grabber.ui.state.selected.size, 1);
    assert.equal(grabber.ui.selectedCandidates()[0].url, "https://example.com/second.jpg");
  } finally {
    grabber.ui.close();
    dom.window.document.getElementById(grabber.ui.rootId)?.remove();
    grabber.ui.shadow = null;
    grabber.ui.state.selected = new Set();
    grabber.ui.state.candidates = [];
    global.document = previousDocument;
  }
});

test("refreshed image cards can be selected by tapping the card surface", () => {
  const dom = new JSDOM(
    `<!doctype html><html><head></head><body>
      <img src="/first.jpg" width="640" height="480">
    </body></html>`,
    {
      url: "https://example.com/page.html",
      pretendToBeVisual: true,
    }
  );
  const previousDocument = global.document;
  global.document = dom.window.document;

  try {
    grabber.ui.shadow = null;
    grabber.ui.state.selected = new Set();
    grabber.ui.state.candidates = [];
    grabber.ui.init();
    grabber.ui.open();

    const loadedLater = dom.window.document.createElement("img");
    loadedLater.src = "/second.jpg";
    loadedLater.width = 800;
    loadedLater.height = 600;
    dom.window.document.body.appendChild(loadedLater);

    dom.window.document
      .getElementById(grabber.ui.rootId)
      .shadowRoot.querySelector(".ig-toolbar button")
      .click();

    const cardsAfterRefresh = dom.window.document
      .getElementById(grabber.ui.rootId)
      .shadowRoot.querySelectorAll(".ig-card");
    assert.equal(cardsAfterRefresh.length, 2);

    cardsAfterRefresh[1].click();

    assert.equal(grabber.ui.state.selected.size, 1);
    assert.equal(grabber.ui.selectedCandidates()[0].url, "https://example.com/second.jpg");
  } finally {
    grabber.ui.close();
    dom.window.document.getElementById(grabber.ui.rootId)?.remove();
    grabber.ui.shadow = null;
    grabber.ui.state.selected = new Set();
    grabber.ui.state.candidates = [];
    global.document = previousDocument;
  }
});

test("gallery grid scrolls thumbnails without compressing card controls", () => {
  const dom = new JSDOM("<!doctype html><html><head></head><body></body></html>", {
    url: "https://example.com/page.html",
  });
  const previousDocument = global.document;
  global.document = dom.window.document;

  try {
    const styles = grabber.ui.createStyles().textContent;

    assert.match(styles, /\.ig-panel[\s\S]*grid-template-rows: auto minmax\(0, 1fr\) auto/);
    assert.match(styles, /\.ig-grid[\s\S]*overflow-y: auto/);
    assert.match(styles, /\.ig-grid[\s\S]*min-height: 0/);
    assert.match(styles, /\.ig-grid[\s\S]*--ig-card-height: clamp\(132px, 22vw, 190px\)/);
    assert.match(styles, /\.ig-grid[\s\S]*grid-auto-rows: var\(--ig-card-height\)/);
    assert.match(styles, /\.ig-card[\s\S]*height: 100%/);
    assert.match(styles, /\.ig-card img[\s\S]*position: absolute/);
    assert.match(styles, /\.ig-card img[\s\S]*height: 100%/);
    assert.match(styles, /@media \(max-width: 760px\)[\s\S]*--ig-card-height: 128px/);
    assert.match(styles, /\.ig-card\[aria-selected="true"\]::after/);
  } finally {
    global.document = previousDocument;
  }
});
