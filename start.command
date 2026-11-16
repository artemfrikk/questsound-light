#!/bin/sh
# QuestSound Light for macOS: double-click in Finder. The first time, right-click → Open (the file is not signed).
cd "$(dirname "$0")" || exit 1
# macOS marks downloaded files as "from the internet" and would block the bundled node: lift the mark for this folder only
xattr -dr com.apple.quarantine . 2>/dev/null
./node/bin/node questsound-light.mjs "$@"
