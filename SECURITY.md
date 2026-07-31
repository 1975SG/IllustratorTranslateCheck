# Security & Risk

Read this before installing any of the four packages in this folder. It's
unsigned, unaudited, developer-mode software — every point below is a real,
specific consequence of how CEP extensions work, not boilerplate.

## What installing this actually changes on your machine

**1. `PlayerDebugMode` is not scoped to this extension.** Every install
script/doc in this repo sets `PlayerDebugMode=1` for `CSXS.9` through
`CSXS.12` via `defaults write` (macOS) or the registry (Windows). This is
an Adobe-wide setting for your user account: while it's on, **every** CEP
host app (Illustrator, InDesign, Photoshop, Premiere, After Effects...)
will load **any** unsigned extension it finds in the CEP extensions
folder — from any source, not just this one — with no signature
verification at all. It is not possible to enable debug mode for only
this extension. If you don't want that exposure sitting there
indefinitely, turn it back off once you're done:

```
# macOS — repeat per version you enabled
defaults delete com.adobe.CSXS.9 PlayerDebugMode
defaults delete com.adobe.CSXS.10 PlayerDebugMode
defaults delete com.adobe.CSXS.11 PlayerDebugMode
defaults delete com.adobe.CSXS.12 PlayerDebugMode
```
```powershell
# Windows — repeat per version
Remove-ItemProperty -Path "HKCU:\Software\Adobe\CSXS.9" -Name PlayerDebugMode
```

**2. The panel runs with `--disable-web-security`.** Set in every
`CSXS/manifest.xml`'s `CEFCommandLine`, this disables the embedded
browser's same-origin policy for this panel's web content — normal
cross-origin request restrictions do not apply inside it. As shipped, the
panel only talks to the LLM provider endpoints you configure and reads
local files (`examples/`), so this isn't currently exploitable through
normal use — but it means the panel's own web content has no same-origin
protection at all if that ever changes (e.g. if you add remote content
loading).

**3. API keys are stored in plain text.** Whatever you paste into the
"API key" field is written to the panel's local browser storage
(`localStorage`) unencrypted — not your OS keychain, not an encrypted
store. Anyone with filesystem access to your user profile can read it.

**4. This is unsigned, third-party, unaudited code.** It is not
distributed as a signed `.zxp`, has not been through Adobe's extension
review, and comes with no warranty. Read `js/providers.js` and
`jsx/host.jsx` yourself before trusting it with real documents or real API
keys — that's genuinely the right level of scrutiny for unsigned software
that reads your open document and makes outbound network calls with your
credentials attached.

## Net effect

Installing and running any of these packages is entirely **at your own
risk**. The install scripts print a shortened version of this warning and
require typing `yes` before doing anything — that's a speed bump, not a
substitute for having read this file.
