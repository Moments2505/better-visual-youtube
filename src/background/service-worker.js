/* Register a fixed, optional feedback page. No identifiers or settings are
   attached to the URL, and nothing is sent by this worker. */
"use strict";
const UNINSTALL_URL = "https://moments2505.github.io/better-visual-youtube/uninstall/";
function registerUninstallSurvey() {
  try {
    const pending = chrome.runtime.setUninstallURL(UNINSTALL_URL);
    if (pending && pending.catch) pending.catch(() => console.warn("[Better visual Youtube] Could not register uninstall feedback."));
  } catch (_) {
    console.warn("[Better visual Youtube] Could not register uninstall feedback.");
  }
}
chrome.runtime.onInstalled.addListener(registerUninstallSurvey);
chrome.runtime.onStartup.addListener(registerUninstallSurvey);
registerUninstallSurvey();
