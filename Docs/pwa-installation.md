# ETERPAX: connected PWA, first version

Base: origin/sprint-1-landing at 1413073cebe32cc94ad37f67af9f4e8fe0a061e1.
Isolated branch: feature/pwa-install.

## Implementation

Native Next.js manifest (id and scope /, start URL /welcome), standalone display,
brand colors, PNG 192/512 icons, a separate 512 maskable icon with safe padding,
and Apple 180 icon. Assets are rasterizations of the tracked app/icon.svg using
existing sharp; no dependency was installed. iOS metadata and theme color are
provided through Next metadata APIs. Next discovers manifest.ts and apple-icon.png.
Settings contains optional, collapsed installation instructions translated with
the existing LanguageProvider and EN/ES dictionary.

No service worker, Cache Storage, offline data store, push notifications, or
new session persistence is introduced. No changes to auth, Supabase, Stripe,
Continuity Engine, Guardian Verification, delivery, or media recording.

## Compatibility and limitations

- Requires HTTPS and an internet connection; this is not an offline application.
- Safari on iPhone: Share > Add to Home Screen; enable Open as Web App if shown.
- Chrome on Android: menu > Add to Home screen / Install app. Labels and browser
  promotion vary by version. No automatic installation prompt is promised.
- Installed application launches /welcome; existing Login handles access.
- Browser and installed-app sessions/preferences may differ. Sign-in may be needed
  again. Recovery links and private recipient links retain their existing behavior.
- Camera/microphone permissions and background interruptions need real-device
  validation. Existing MediaRecorder/WebM labeling compatibility is unchanged.
- Icon uses the existing E monogram; maskable artwork keeps the letter inside
  the central safe area. Apple icon is opaque.
- Real iPhone/Android installation, session persistence, recovery links and media
  capture have NOT been tested in this environment; validate after authorized
  publication. No real payments, emails or deliveries were triggered.

## References

- https://web.dev/articles/install-criteria
- https://support.apple.com/guide/iphone/open-as-web-app-iphea86e5236/ios
- Installed Next.js documentation: progressive-web-apps guide.

## Validation results

- Production webpack build: PASS, including TypeScript and 41 prerendered pages.
  Used dummy Supabase build configuration; no production credentials or actions.
- Targeted ESLint for all changed TypeScript/TSX files: PASS.
- git diff --check: PASS.
- Existing EN/ES catalog tests: 5/5 PASS.
- Manifest icon paths, PNG dimensions, Apple 180 dimensions: PASS.
- Generated welcome HTML includes manifest, Apple icon, theme color, mobile
  web-app capability and Apple title/status-bar metadata: PASS. Next 16 emits
  mobile-web-app-capable rather than the deprecated Apple-prefixed name.
- Maskable icon visually inspected.
- First build could not download existing Google Fonts in the sandbox; retry
  with network access passed. A concurrent standalone tsc encountered transient
  generated-file errors; final build TypeScript passed.
- Diff restricted to manifest, icons, metadata, Settings help, dictionary and
  this document. Physical-device compatibility validation remains pending.
