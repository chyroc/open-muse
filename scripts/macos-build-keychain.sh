#!/bin/sh
# One-time setup for signing Mac builds from any shell, including SSH.
#
# Usage: scripts/macos-build-keychain.sh <exported-identity.p12>
#
# Creates a dedicated keychain holding only the signing identity, with a random
# password stored in a file readable only by you. The macOS build unlocks it
# itself, so every build has the same signature and Keychain keeps trusting the
# app after one "Always Allow". The .p12 password is asked for interactively.
set -eu
p12="${1:?Usage: $0 <exported-identity.p12>}"
keychain="$HOME/Library/Keychains/open-muse-build.keychain-db"
secret_dir="$HOME/.config/open-muse"
secret="$secret_dir/build-keychain-password"
[ -f "$p12" ] || { echo "No such file: $p12" >&2; exit 1; }
[ -e "$keychain" ] && { echo "$keychain already exists; delete it to start over." >&2; exit 1; }
mkdir -p "$secret_dir"
chmod 700 "$secret_dir"
umask 077
openssl rand -base64 32 > "$secret"
password="$(cat "$secret")"
security create-keychain -p "$password" "$keychain"
security set-keychain-settings -lut 3600 "$keychain"
security unlock-keychain -p "$password" "$keychain"
printf "Password for %s: " "$p12"
stty -echo; read -r p12_password; stty echo; echo
security import "$p12" -k "$keychain" -P "$p12_password" -T /usr/bin/codesign
# Let codesign use the key without a dialog.
security set-key-partition-list -S apple-tool:,apple:,codesign: -s -k "$password" "$keychain" >/dev/null
security find-identity -v -p codesigning "$keychain"
echo "Done. Delete $p12 if you no longer need it."
