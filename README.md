# Image Grabber Gallery

A cross-manager userscript for finding images already available on the current page and saving selected images from a visual gallery.

## Install

1. Open `image-grabber.user.js`.
2. Copy it into Violentmonkey, Tampermonkey, iOS Userscripts, or a compatible manager.
3. Enable the script for the sites where you want the floating image button.

## Behavior

The script scans normal images, `srcset`, common lazy-load attributes, and visible CSS background images. It does not bypass DRM, paywalls, login requirements, or server-side access controls.

The gallery uses a dark theme and runs inside Shadow DOM so site styles are much less likely to break controls. The floating button and userscript metadata icon use an embedded SVG, so there are no external icon files to host.

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

Open `fixtures/test-page.html` in a browser. The fixture includes the script directly for local development, so the floating icon button should appear without installing the userscript manager. Press the floating button and verify that normal images, `srcset`, lazy image URLs, and background images appear in the scrollable gallery. Tap thumbnail cards to select them; selected cards show a border and check overlay. Use `Small hidden` / `Small shown` to toggle tiny images.
