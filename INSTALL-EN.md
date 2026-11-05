# Better visual Youtube — English installation guide

## Install in Microsoft Edge / Google Chrome

1. Extract the entire ZIP into a permanent folder. Keep that folder in place after installation.
2. Open `edge://extensions` in Edge or `chrome://extensions` in Chrome.
3. Enable **Developer mode**.
4. Click **Load unpacked** and select the folder containing `manifest.json`.
5. Open or reload YouTube. Pin **Better visual Youtube** from the extensions menu for easy access to its settings.

## Defaults and updates

- Version 1.4.53 includes the author's captured settings: Light theme, Thumbnail tint, 1px blur, 14px radius, 62% highlight, 112% hover scale, 162% ambient spread and a 16fps ambient limit. The opacity control displays 1%; the exact internal value is preserved in `default-settings.json`.
- Fresh installations use these defaults. Existing installations retain saved preferences; click **Reset to Defaults** to apply the complete new defaults.
- To update an existing unpacked installation, replace the files in its original folder, click **Reload** on the extensions page, then reload YouTube. Do not remove the extension if you want to preserve preferences.
- Loading from a different folder may create another extension instance. Disable the previous instance to avoid running both.

## If seeking or adjusting volume feels sluggish

- First test with **Optical depth** off on the same video. Then separately test with **Ambient Light** off to distinguish the two rendering costs.
- Optionally reduce **Hover lift**, **Dispersion**, ambient **Spread**, or select **Eco** quality. These reductions are not applied to the included defaults.
- Report the browser, hardware and the affected interaction. No FPS measurement has been performed on the tester's machine; 60fps is not guaranteed on every device.

## Notes

This is an unpacked extension for desktop Edge/Chrome, not a Chrome Web Store installer. Preferences are stored locally in the browser profile and do not automatically transfer to another computer. No accounts, cookies or browsing history are included.

Source and third-party license notices are included. Keep LICENSE files when redistributing.
