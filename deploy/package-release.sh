#!/usr/bin/env bash
set -Eeuo pipefail
PROJECT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
DESTINATION="${1:-$PROJECT_DIR/../univille-eventos-release.tar.gz}"
cd "$PROJECT_DIR"
node --input-type=module -e "import { DatabaseSync } from 'node:sqlite'; const db = new DatabaseSync(':memory:'); db.close();"
npm ci --no-audit --no-fund
npm test
BASE_PATH=/ npm run build
[[ -f dist/index.html && -f server/index.js ]] || { echo 'Build ou servidor ausente.' >&2; exit 1; }
mkdir -p "$(dirname "$DESTINATION")"
# Lista explícita: nunca empacota .env, dados, node_modules ou arquivos locais.
COPYFILE_DISABLE=1 tar -czf "$DESTINATION" package.json package-lock.json dist server scripts deploy docs .env.example
printf 'Pacote criado: %s\n' "$DESTINATION"
