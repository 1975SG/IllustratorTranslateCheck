# macOS install

1. Copy/clone this folder somewhere permanent (e.g. `~/Documents/IllustratorTranslateCheck`).
2. Symlink it into Adobe's CEP extensions folder:

   ```
   ln -s "$(pwd)" "$HOME/Library/Application Support/Adobe/CEP/extensions/com.sgozel.translatecheck"
   ```

3. Enable `PlayerDebugMode` (required to load an unsigned/dev CEP extension) for the CSXS versions Illustrator's CEP engine uses:

   ```
   defaults write com.adobe.CSXS.9 PlayerDebugMode 1
   defaults write com.adobe.CSXS.10 PlayerDebugMode 1
   defaults write com.adobe.CSXS.11 PlayerDebugMode 1
   defaults write com.adobe.CSXS.12 PlayerDebugMode 1
   ```

4. Restart Illustrator, then `Window > Extensions > Translate & Check`.

Note: editing `jsx/host.jsx` while the panel is open won't take effect — the ExtendScript engine loads it once at panel startup. Close and reopen the panel (toggle the `Window > Extensions` entry off/on) after any `host.jsx` edit.
