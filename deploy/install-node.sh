#!/usr/bin/env bash
set -Eeuo pipefail

# Instala um runtime exclusivo; não altera /usr/bin/node, npm ou outros serviços.
VERSION="${1:-24.22.1}"
[[ "$EUID" -eq 0 ]] || { echo 'Execute com sudo.' >&2; exit 1; }
[[ "$VERSION" =~ ^24\.[0-9]+\.[0-9]+$ ]] || { echo 'Informe uma versão exata da linha Node 24 LTS.' >&2; exit 1; }
case "$(uname -m)" in
  x86_64) ARCH=x64 ;;
  aarch64|arm64) ARCH=arm64 ;;
  *) echo 'Arquitetura Linux não suportada por este instalador.' >&2; exit 1 ;;
esac
PREFIX=/opt/univille-node
DEST="$PREFIX/releases/v$VERSION"
if [[ ! -x "$DEST/bin/node" ]]; then
  TASK_TMP="$(mktemp -d)"
  trap 'rm -rf "$TASK_TMP"' EXIT
  ARCHIVE="node-v$VERSION-linux-$ARCH.tar.xz"
  URL="https://nodejs.org/dist/v$VERSION"
  curl --proto '=https' --tlsv1.2 -fsSLo "$TASK_TMP/$ARCHIVE" "$URL/$ARCHIVE"
  curl --proto '=https' --tlsv1.2 -fsSLo "$TASK_TMP/SHASUMS256.txt" "$URL/SHASUMS256.txt"
  awk -v name="$ARCHIVE" '$2 == name {print}' "$TASK_TMP/SHASUMS256.txt" > "$TASK_TMP/verify.txt"
  [[ "$(wc -l < "$TASK_TMP/verify.txt")" -eq 1 ]] || { echo 'Checksum oficial ausente ou ambíguo.' >&2; exit 1; }
  (cd "$TASK_TMP" && sha256sum --check verify.txt)
  install -d -m 0755 "$PREFIX/releases"
  tar -xJf "$TASK_TMP/$ARCHIVE" -C "$TASK_TMP"
  mv "$TASK_TMP/node-v$VERSION-linux-$ARCH" "$DEST"
  chown -R root:root "$DEST"
  chmod -R go-w "$DEST"
fi
[[ "$("$DEST/bin/node" --version)" == "v$VERSION" ]] || { echo 'Runtime instalado não corresponde à versão solicitada.' >&2; exit 1; }
"$DEST/bin/node" --input-type=module -e "import { DatabaseSync } from 'node:sqlite'; const db = new DatabaseSync(':memory:'); db.close();"
ln -sfn "releases/v$VERSION" "$PREFIX/.current-next"
mv -Tf "$PREFIX/.current-next" "$PREFIX/current"
printf 'Runtime exclusivo disponível: %s/current/bin/node (%s)\n' "$PREFIX" "$VERSION"
