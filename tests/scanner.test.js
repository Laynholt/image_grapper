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
