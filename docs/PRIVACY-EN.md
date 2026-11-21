# Better Visual for YouTube — Privacy policy

Developer: QuanNguyen. Last updated: 21 November 2026.

Better Visual for YouTube adds glass effects, animations and Ambient Light to YouTube on desktop. You can use it without creating an account.

## Information processed on your device

The extension reads the YouTube page to apply its styles. When colour-based effects are enabled, it processes video and thumbnail colours on your device. Your settings, active style profile, operational preferences, and optional chosen city name/coordinates are saved in browser extension storage.

The extension does not send browsing history, account credentials, video frames or settings to a developer-operated server. It does not include advertising analytics or remote crash-report uploads. Diagnostic errors may be written to the local browser console.

## Settings storage and browser sync

Settings are saved locally via `chrome.storage.local`. When your browser supports and enables profile sync, the extension also mirrors your appearance settings, style profiles, and optional selected city/coordinates to `chrome.storage.sync` so your preferences can follow your signed-in browser profile across devices. Weather caches and failure backoff timestamps stay strictly local in `chrome.storage.local`. Browser sync is handled solely by Chrome/Edge account sync; QuanNguyen has no server and cannot read your synced settings.

## Network activity and third parties

**Optional live sky:** only after you grant the optional Open-Meteo access, enabling Live sun & weather sends the coordinates of your selected city to api.open-meteo.com. Explicit city searches send the entered city name to geocoding-api.open-meteo.com. These services also receive your IP address as part of a normal connection. Requests omit credentials and referrers; they do not contain YouTube page URLs, video information or account data. The extension does not use GPS or automatically determine your location. The chosen city and coordinates are stored in extension settings storage. One recent weather response and an attempt timestamp are cached locally, shared across tabs; weather normally refreshes every 15 minutes while a visible Home, Search, or Channel page uses it. If fetching fails, the scene may use cached weather up to two hours old. See [Open-Meteo terms and privacy](https://open-meteo.com/en/terms). Weather is model-based, not direct live observation. Turning live weather off stops new automatic requests; it does not revoke the browser permission or erase the local cache.

YouTube continues to make its normal network requests under its own policies. Ambient Light may also process video frames or YouTube storyboard thumbnails locally on your device to render edge lighting. External links, such as support and documentation, are covered by those websites' policies.

When you uninstall the extension, your browser opens an optional feedback page hosted on GitHub Pages (`https://moments2505.github.io/better-visual-youtube/uninstall/`). Its fixed URL contains no user identifier, browsing history or settings. GitHub processes normal website request information under its own privacy policy. The page has no analytics and does not automatically submit or save your answers.

You may copy your feedback or open a draft in your email app. Feedback reaches QuanNguyen only if you send the email yourself; this shares the message and the sender information supplied by your email provider. Sent feedback is kept in the support mailbox. Contact the address below to request its removal.

## Permissions

- Storage (`storage`): retain settings locally (`chrome.storage.local`) and optionally sync your appearance preferences across your signed-in browser profile (`chrome.storage.sync`).
- Access to `https://www.youtube.com/*`: apply styles, discover the player and produce the chosen visual effects on desktop YouTube pages.
- Optional access to `https://api.open-meteo.com/*` and `https://geocoding-api.open-meteo.com/*`: fetch chosen-city weather and city-search results, only when you explicitly enable or use those features. You can revoke it at any time in your browser's extension site-access controls.

The extension does not request access to all websites or permission to read browser history.

## Control and retention

You can disable individual effects or turn off the extension at any time. Reset to Defaults restores bundled settings; removing the extension deletes extension storage according to your browser's storage and sync lifecycle.

## Contact and updates

Questions about privacy? Contact QuanNguyen at quannguyenproducer2505@gmail.com. This policy will be updated if the extension's data handling changes.
