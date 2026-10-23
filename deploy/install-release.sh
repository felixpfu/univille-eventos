#!/usr/bin/env bash
set -Eeuo pipefail
umask 022

usage() {
  echo "Uso: sudo bash deploy/install-release.sh PACOTE.tar.gz RELEASE_ID [--publish]" >&2
  echo 'Sem --publish, inicia/verifica o serviço sem mudar o Nginx.' >&2
  exit 1
}
[[ "$EUID" -eq 0 && "$#" -ge 2 && "$#" -le 3 ]] || usage
ARCHIVE="$(realpath "$1")"
RELEASE_ID="$2"
PUBLISH=0
if [[ "$#" -eq 3 ]]; then
  [[ "$3" == --publish ]] || usage
  PUBLISH=1
fi
[[ "$RELEASE_ID" =~ ^[a-zA-Z0-9][a-zA-Z0-9._-]{0,79}$ ]] || { echo 'RELEASE_ID inválido.' >&2; exit 1; }
[[ -f "$ARCHIVE" ]] || { echo 'Pacote não encontrado.' >&2; exit 1; }
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
APP_ROOT=/opt/univille-eventos
NODE_ROOT=/opt/univille-node/current
STATE_DIR=/var/lib/univille-eventos
ENV_FILE=/etc/univille-eventos.env
UNIT_FILE=/etc/systemd/system/univille-eventos.service
NGINX_CONFIG=/etc/nginx/sites-enabled/default
DEST="$APP_ROOT/releases/$RELEASE_ID"
BACKUP_DIR="/var/backups/univille-eventos/deploy-$RELEASE_ID"
SERVICE_USER=univille-eventos
exec 9>/run/lock/univille-eventos-deploy.lock
flock -n 9 || { echo 'Outra publicação está em andamento.' >&2; exit 1; }
[[ ! -e "$DEST" && ! -e "$BACKUP_DIR" ]] || { echo 'RELEASE_ID já existe; use outro identificador.' >&2; exit 1; }

for command in curl python3 runuser systemctl nginx tar; do
  command -v "$command" >/dev/null || { echo "Comando necessário: $command" >&2; exit 1; }
done
[[ -x "$NODE_ROOT/bin/node" ]] || { echo 'Execute install-node.sh antes da publicação.' >&2; exit 1; }
"$NODE_ROOT/bin/node" --input-type=module -e "import { DatabaseSync } from 'node:sqlite'; if (+process.versions.node.split('.')[0] !== 24) process.exit(1); const d = new DatabaseSync(':memory:'); d.close();"
if ! id "$SERVICE_USER" >/dev/null 2>&1; then
  useradd --system --user-group --home-dir "$STATE_DIR" --shell /usr/sbin/nologin "$SERVICE_USER"
fi
install -d -m 0755 "$APP_ROOT" "$APP_ROOT/releases"
install -d -m 0700 -o "$SERVICE_USER" -g "$SERVICE_USER" "$STATE_DIR"
install -d -m 0700 /var/backups/univille-eventos "$BACKUP_DIR"
if [[ ! -e "$ENV_FILE" ]]; then
  # Credenciais administrativas nunca são criadas nem exibidas por este script.
  install -m 0600 -o root -g root /dev/null "$ENV_FILE"
  cat > "$ENV_FILE" <<'ENV'
NODE_ENV=production
HOST=127.0.0.1
PORT=3002
BASE_PATH=
DATA_DIR=/var/lib/univille-eventos
PUBLIC_ORIGIN=https://flxpfu.com.br
NODE_OPTIONS=--max-old-space-size=192
ENV
fi
[[ ! -L "$ENV_FILE" ]] || { echo 'Recusado arquivo de ambiente com symlink.' >&2; exit 1; }
chown root:root "$ENV_FILE"
chmod 0600 "$ENV_FILE"
# Não faz source: valida apenas variáveis de implantação sem executar o arquivo.
python3 - "$ENV_FILE" <<'PY'
from pathlib import Path
import sys
values = {}
for raw in Path(sys.argv[1]).read_text().splitlines():
    line = raw.strip()
    if line and not line.startswith('#') and '=' in line:
        key, value = line.split('=', 1)
        values[key.strip()] = value.strip().strip('"').strip("'")
expected = {'NODE_ENV': 'production', 'HOST': '127.0.0.1', 'PORT': '3002',
            'BASE_PATH': '', 'DATA_DIR': '/var/lib/univille-eventos',
            'PUBLIC_ORIGIN': 'https://flxpfu.com.br'}
for key, value in expected.items():
    if values.get(key) != value:
        raise SystemExit(f'Ajuste {key} em /etc/univille-eventos.env antes de publicar.')
PY

install -d -m 0755 -o "$SERVICE_USER" -g "$SERVICE_USER" "$DEST"
install -m 0644 "$ARCHIVE" "$DEST/.release.tar.gz"
# A extração e o npm executam sem root. Rejeita links e caminhos fora do pacote.
runuser -u "$SERVICE_USER" -- python3 - "$DEST/.release.tar.gz" "$DEST" <<'PY'
from pathlib import PurePosixPath
import sys
import tarfile
allowed = {'package.json', 'package-lock.json', 'dist', 'server', 'scripts', 'deploy', 'docs', '.env.example'}
with tarfile.open(sys.argv[1], 'r:gz') as archive:
    for member in archive.getmembers():
        path = PurePosixPath(member.name)
        if path.is_absolute() or '..' in path.parts or not path.parts or path.parts[0] not in allowed:
            raise SystemExit('Caminho inesperado no pacote; extração cancelada.')
        if not (member.isfile() or member.isdir()):
            raise SystemExit('Links e arquivos especiais não são permitidos no pacote.')
    archive.extractall(sys.argv[2], filter='data')
PY
rm -f "$DEST/.release.tar.gz"
[[ -f "$DEST/dist/index.html" && -f "$DEST/server/index.js" && -f "$DEST/package-lock.json" ]] || { echo 'Pacote incompleto.' >&2; exit 1; }
runuser -u "$SERVICE_USER" -- env PATH="$NODE_ROOT/bin:/usr/bin:/bin" \
  npm_config_cache="$DEST/.npm-cache" npm ci --prefix "$DEST" --omit=dev --ignore-scripts --no-audit --no-fund
rm -rf "$DEST/.npm-cache"
chown -R root:root "$DEST"
chmod -R go-w "$DEST"

OLD_RELEASE="$(readlink -f "$APP_ROOT/current" 2>/dev/null || true)"
OLD_ACTIVE=0
OLD_ENABLED=0
systemctl is-active --quiet univille-eventos && OLD_ACTIVE=1
systemctl is-enabled --quiet univille-eventos 2>/dev/null && OLD_ENABLED=1
if [[ -e "$UNIT_FILE" ]]; then cp -a "$UNIT_FILE" "$BACKUP_DIR/previous.service"; fi
printf '%s\n' "$OLD_RELEASE" > "$BACKUP_DIR/previous-release.txt"
cp -L "$NGINX_CONFIG" "$BACKUP_DIR/nginx-before.conf"
chmod 0600 "$BACKUP_DIR/nginx-before.conf"
ROLLBACK_REQUIRED=1
PUBLISH_ATTEMPTED=0

rollback_on_failure() {
  local status="$?"
  if [[ "$status" -ne 0 && "${ROLLBACK_REQUIRED:-0}" -eq 1 ]]; then
    set +e
    echo 'Falha na publicação; restaurando serviço e configuração anterior.' >&2
    if [[ "$PUBLISH_ATTEMPTED" -eq 1 ]]; then
      python3 "$SCRIPT_DIR/configure-nginx.py" restore --config "$NGINX_CONFIG" --backup "$BACKUP_DIR/nginx-before.conf"
    fi
    if [[ -n "$OLD_RELEASE" && -d "$OLD_RELEASE" ]]; then
      ln -sfn "$OLD_RELEASE" "$APP_ROOT/.current-next"
      mv -Tf "$APP_ROOT/.current-next" "$APP_ROOT/current"
    else
      rm -f "$APP_ROOT/current"
    fi
    if [[ -e "$BACKUP_DIR/previous.service" ]]; then
      cp -a "$BACKUP_DIR/previous.service" "$UNIT_FILE"
    else
      systemctl stop univille-eventos
      systemctl disable univille-eventos
      rm -f "$UNIT_FILE"
    fi
    systemctl daemon-reload
    if [[ "$OLD_ACTIVE" -eq 1 ]]; then systemctl restart univille-eventos; else systemctl stop univille-eventos; fi
    if [[ "$OLD_ENABLED" -eq 0 ]]; then systemctl disable univille-eventos 2>/dev/null; fi
    echo "Dados preservados. Snapshot anterior, se necessário: $BACKUP_DIR/data-before.tar.gz" >&2
  fi
  exit "$status"
}
trap rollback_on_failure EXIT
if [[ "$OLD_ACTIVE" -eq 1 || -e "$UNIT_FILE" ]]; then systemctl stop univille-eventos; fi
# SQLite e seus arquivos WAL são copiados juntos enquanto o serviço está parado.
tar -czf "$BACKUP_DIR/data-before.tar.gz" -C "$STATE_DIR" .
chmod 0600 "$BACKUP_DIR/data-before.tar.gz"
install -m 0644 "$SCRIPT_DIR/univille-eventos.service" "$UNIT_FILE"
ln -sfn "$DEST" "$APP_ROOT/.current-next"
mv -Tf "$APP_ROOT/.current-next" "$APP_ROOT/current"
systemctl daemon-reload
systemctl start univille-eventos
HEALTHY=0
for attempt in {1..30}; do
  if curl -fsS --max-time 2 http://127.0.0.1:3002/api/health >/dev/null 2>&1; then HEALTHY=1; break; fi
  sleep 1
done
[[ "$HEALTHY" -eq 1 ]] || { echo 'O serviço não respondeu ao health check.' >&2; exit 1; }
curl -fsS --max-time 5 http://127.0.0.1:3002/ >/dev/null
systemctl enable univille-eventos
if [[ "$PUBLISH" -eq 1 ]]; then
  PUBLISH_ATTEMPTED=1
  python3 "$SCRIPT_DIR/configure-nginx.py" apply --config "$NGINX_CONFIG"
  curl --resolve flxpfu.com.br:443:127.0.0.1 -fsS --max-time 10 https://flxpfu.com.br/api/health >/dev/null
  curl --resolve flxpfu.com.br:443:127.0.0.1 -fsS --max-time 10 https://flxpfu.com.br/ >/dev/null
fi
ROLLBACK_REQUIRED=0
printf 'Release ativo: %s\nBackup: %s\n' "$DEST" "$BACKUP_DIR"
if [[ "$PUBLISH" -eq 0 ]]; then echo 'Nginx preservado. O serviço está disponível apenas em 127.0.0.1:3002.'; fi
