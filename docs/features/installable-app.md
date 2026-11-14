# Installable app (PWA)

## Why

Voie Libre has a manifest and a service worker, so a browser can already offer to install it, but nothing in the app says so, the manifest is bare (no screenshots, no id), and Safari on iPhone ignores most of it. It is also the first step towards an Android app (a Trusted Web Activity or Capacitor needs an installable PWA).

## What done looks like

- **Manifest** (`apps/web/public/manifest.webmanifest`): `id`, `lang`, `categories`, and `screenshots` (a narrow one for the phone, a wide one for the desktop, in `apps/web/public/screenshots/`, outside the service worker's files so that they are not prefetched) so that the install dialog of Android and desktop Chrome shows the app. The icons, `display: standalone`, the theme colour (`#0f766e`, the green of the header) stay. No `shortcuts`: the app has no address to open a loop or an itinerary on.
- **iOS tags** in `index.html`: `apple-mobile-web-app-capable`, the status bar style, the title. The touch icon stays.
- **"Install the app"** in the About window (not in the header, which is tight on a phone): a button that opens the browser's own dialog where it exists (`beforeinstallprompt`: Chrome, Edge, Android), and on iPhone and iPad a short hint "Share, then Add to Home Screen". Nothing when the app is already installed (standalone) or when the browser offers nothing.
- Nothing is sent anywhere: the choice is the browser's.

## How we check

- `PwaInstall` specs: the prompt is kept and used once, the button disappears after an install, standalone and iOS detection.
- About spec: the button and the hint show only when they apply.
- The manifest read by the browser's own tools (DevTools application panel), the screenshots at the sizes asked for.

## Out of scope

- The Android app itself (separate decision: TWA or Capacitor).
- A route address for the shortcuts of the app icon.

## How it went

The manifest got `id`, `lang`, `categories` and the two screenshots; `index.html` the iOS tags (status bar `default`: `black-translucent` would put the page under the status bar and needs safe-area padding that the header does not have). `PwaInstall` (`core/pwa`) is started by an app initializer so that `beforeinstallprompt` is not missed; the About window shows the button or, on iPhone and iPad, the hint. The screenshots were taken from voielibre.app with a headless Chromium driven by a throw-away script (a route Clermont-Ferrand to Issoire), the phone one with the CSS of the next version injected (a full width sheet, no full screen button), since the version online had the old look: they should be taken again from the production app when the layout changes much. No `shortcuts` (no address to open a loop or an itinerary). Not checked: the install dialog on a real Android phone or in desktop Chrome, and the iPhone hint on a real device.
