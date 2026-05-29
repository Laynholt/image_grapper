# Image Grabber Userscript Design

## Goal

Build a cross-manager userscript for Violentmonkey, Tampermonkey, iOS Userscripts, and similar browser extensions. The script helps users save images that the current page has already loaded or explicitly references, especially on mobile browsers where long-press image saving is unreliable.

The script is not intended to bypass DRM, paywalls, login requirements, server-side access controls, or technical restrictions that prevent the browser from accessing an image.

## User Experience

The script injects a small floating button into every matching page. Pressing the button scans the current document and opens an overlay gallery.

The gallery uses a visual grid layout. Each image candidate appears as a card with:

- Preview image.
- Selection checkbox.
- Source type, such as `img`, `srcset`, lazy attribute, or CSS background.
- Host/domain.
- Known dimensions when available.

The toolbar provides:

- Found and selected counts.
- Refresh scan.
- Select all visible.
- Clear selection.
- Toggle to hide likely small decorative images.
- Download selected.
- Close.

On phones, the same overlay should stay touch-friendly: large tap targets, scrollable grid, sticky toolbar, and no dependency on hover behavior.

## Image Discovery

The first version uses moderate discovery to avoid flooding the gallery with icons, trackers, and unrelated resources.

The scanner collects:

- `img.currentSrc` and `img.src`.
- `srcset` candidates from `img` and `source` elements.
- Common lazy-load attributes, including `data-src`, `data-original`, `data-lazy-src`, `data-srcset`, and similar names.
- CSS `background-image` URLs from visible elements.

The scanner normalizes candidates by resolving them against `document.baseURI`, ignoring invalid URLs, and deduplicating by final absolute URL. It tags every candidate with one or more source types so the gallery can explain why it was found.

The default view hides likely decorative images using conservative heuristics:

- Very small known dimensions.
- Common tiny file names such as spacer, pixel, tracking, icon, sprite, favicon, and avatar where applicable.
- Empty, invalid, unsupported, or non-image-looking URLs.

Users can disable the small-image filter from the gallery.

## Download Behavior

The download adapter uses a fallback chain:

1. `GM_download`, when available.
2. Browser-native anchor download with `<a download>`.
3. `GM_openInTab`, when available.
4. `window.open` or a generated viewer page so the user can save through the browser or operating-system share menu.

The iOS Userscripts environment may not allow direct filesystem downloads from userscript code. In that case, opening the selected image or a local viewer in a new tab is expected behavior.

Multiple selected images are processed sequentially with a short delay between attempts. This reduces the chance that browsers block a burst of downloads or tabs.

Each attempt produces a visible status in the overlay:

- Download started.
- Opened in a new tab for manual saving.
- Failed, with the relevant URL and error message when available.

## Compatibility Layer

The script must run without build tooling. It should be a single `.user.js` file with metadata grants for optional userscript APIs.

The compatibility layer checks features at runtime:

- `GM_download`.
- `GM_openInTab`.
- `GM_xmlhttpRequest`, reserved for later use if needed.
- Standard DOM APIs.

No feature should be required for the gallery to open and basic saving to work. Optional GM APIs only improve the download path on managers that support them.

## Architecture

The single userscript is organized into small internal modules:

- `config`: constants, metadata-facing settings, size thresholds, and source attribute names.
- `scanner`: DOM and CSS discovery, URL normalization, deduplication, candidate metadata.
- `ui`: floating button, overlay shell, toolbar, image grid, selection state, status area.
- `downloadAdapter`: fallback chain for selected images.
- `compat`: runtime API detection and wrappers.
- `utils`: filename extraction, throttling, URL helpers, safe DOM creation.

Modules communicate through plain objects. A discovered candidate has at least:

```js
{
  id: "stable-id",
  url: "https://example.com/image.jpg",
  displayUrl: "example.com/image.jpg",
  sourceTypes: ["img"],
  width: 1200,
  height: 800,
  elementVisible: true,
  likelySmall: false
}
```

## Error Handling

The scanner ignores invalid or unsafe candidates and keeps scanning. UI errors must not break the host page.

Download failures are shown per image. When direct download fails, the adapter falls back to opening the image. If even opening is blocked, the gallery shows a copyable URL.

All injected DOM is namespaced under a unique root ID to avoid colliding with page styles or scripts. Styles are scoped to that root.

## Testing

The project should include a local fixture page with:

- Normal `img` elements.
- `picture` and `srcset`.
- Lazy-load attributes.
- CSS background images.
- Small decorative images that should be hidden by default.
- Duplicate URLs from multiple source types.

Manual checks:

- Install the userscript in a desktop userscript manager.
- Open the fixture page and verify discovery, filtering, selection, and download fallback.
- Test that closing the overlay restores the page without leaving broken UI.
- On iOS, verify that selected images can be opened for saving through the system browser/share workflow.

## Out of Scope

- Bypassing DRM, paywalls, login walls, or server access controls.
- Parsing every network request via `performance.getEntriesByType("resource")` in the first version.
- Crawling linked pages.
- Browser extension packaging beyond a userscript.
- Bulk ZIP export in the first version.
