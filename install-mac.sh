#!/usr/bin/env bash
# Symlinks this repo folder into Adobe's per-user CEP extensions folder and
# enables PlayerDebugMode (required to load an unsigned/dev CEP extension).
#
# Read SECURITY.md before running this. Run from this folder:
#   ./install-mac.sh

set -euo pipefail

REPO_PATH="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
EXTENSION_ID="${1:-com.sgozel.translatecheck}"
EXTENSIONS_DIR="$HOME/Library/Application Support/Adobe/CEP/extensions"

cat <<'EOF'
=============================================================================
 SECURITY WARNING -- READ BEFORE CONTINUING (full detail in SECURITY.md)
=============================================================================
This installs an UNSIGNED, DEVELOPMENT Adobe CEP extension. Continuing will:

  1. Enable "PlayerDebugMode" for CSXS.9-12 for your user account. This is
     NOT scoped to this extension -- while enabled, EVERY CEP host app
     (Illustrator, InDesign, Photoshop, Premiere, ...) will load ANY
     unsigned extension it finds, from any source, with no signature
     check, until you turn it back off.
  2. The panel runs its embedded browser with --disable-web-security.
  3. API keys you paste into the panel are stored in plain text in the
     panel's local browser storage, not your OS keychain.
  4. This is unsigned, unaudited, third-party software. No warranty.

You are installing and running this entirely AT YOUR OWN RISK.
=============================================================================
EOF

read -rp "Type 'yes' to continue: " CONFIRM
if [[ "$CONFIRM" != "yes" ]]; then
  echo "Aborted -- nothing changed."
  exit 1
fi

mkdir -p "$EXTENSIONS_DIR"
LINK_PATH="$EXTENSIONS_DIR/$EXTENSION_ID"

if [[ -e "$LINK_PATH" || -L "$LINK_PATH" ]]; then
  echo "Removing existing item at $LINK_PATH"
  rm -rf "$LINK_PATH"
fi

ln -s "$REPO_PATH" "$LINK_PATH"
echo "Linked $REPO_PATH -> $LINK_PATH"

for ver in 9 10 11 12; do
  defaults write "com.adobe.CSXS.$ver" PlayerDebugMode 1
done
echo "PlayerDebugMode enabled for CSXS.9 through CSXS.12"

echo
echo "Restart Illustrator, then check Window > Extensions > Translate & Check."
echo "To remove later: delete the symlink above, and 'defaults delete com.adobe.CSXS.N PlayerDebugMode' for N in 9-12."
