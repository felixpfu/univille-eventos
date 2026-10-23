#!/usr/bin/env python3
"""Publica a agenda na raiz HTTPS, mantendo certificados e backup do vhost."""

import argparse
import datetime
import os
from pathlib import Path
import re
import shutil
import stat
import subprocess
import tempfile

BEGIN = "    # BEGIN UNIVILLE EVENTOS (managed)"
END = "    # END UNIVILLE EVENTOS (managed)"
BLOCK = """    # BEGIN UNIVILLE EVENTOS (managed)
    # Mantém a validação do certificado disponível no diretório já existente.
    location ^~ /.well-known/acme-challenge/ {
        root /var/www/flxpfu.com.br/current;
        try_files $uri =404;
    }

    # ^~ impede que o regex de assets do site principal capture estes arquivos.
    location ^~ / {
        proxy_pass http://127.0.0.1:3002;
        proxy_http_version 1.1;
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $remote_addr;
        proxy_set_header X-Forwarded-Proto $scheme;
        proxy_connect_timeout 5s;
        proxy_read_timeout 30s;
        client_max_body_size 1m;
        add_header X-Robots-Tag "noindex, nofollow" always;
    }
    # END UNIVILLE EVENTOS (managed)
"""


def masked(text):
    """Ignora chaves em strings/comentários, mantendo posições no arquivo."""
    result = list(text)
    quote = None
    comment = False
    escape = False
    for i, char in enumerate(text):
        if comment:
            if char == "\n":
                comment = False
            else:
                result[i] = " "
        elif quote:
            result[i] = " "
            if escape:
                escape = False
            elif char == "\\":
                escape = True
            elif char == quote:
                quote = None
        elif char == "#":
            result[i] = " "
            comment = True
        elif char in ("'", '"'):
            result[i] = " "
            quote = char
    if quote:
        raise ValueError("String sem fechamento na configuração; revisão manual necessária.")
    return "".join(result)


def render(text):
    clean = masked(text)
    depth = 0
    opening = None
    servers = []
    for i, char in enumerate(clean):
        if char == "{":
            if depth == 0:
                match = re.search(r"\bserver\s*$", clean[:i])
                opening = match.start() if match else None
            depth += 1
        elif char == "}":
            depth -= 1
            if depth < 0:
                raise ValueError("Chaves desbalanceadas na configuração.")
            if depth == 0 and opening is not None:
                section = clean[opening:i]
                names = re.findall(r"\bserver_name\s+([^;]+);", section)
                https = re.search(r"\blisten\s+[^;]*\b443\b[^;]*;", section)
                if https and any("flxpfu.com.br" in names_line.split() for names_line in names):
                    servers.append((opening, i))
                opening = None
    if depth:
        raise ValueError("Chaves desbalanceadas na configuração.")
    if len(servers) != 1:
        raise ValueError("Esperava exatamente um server HTTPS para flxpfu.com.br.")
    start, close = servers[0]
    section = text[start:close]
    if text.count(BEGIN) != text.count(END) or text.count(BEGIN) > 1:
        raise ValueError("Marcadores gerenciados incompletos ou duplicados.")
    if BEGIN in text and BEGIN not in section:
        raise ValueError("Bloco gerenciado encontrado em outro vhost; revisão necessária.")
    if BEGIN in section:
        first = section.index(BEGIN)
        last = section.index(END) + len(END)
        if last < first:
            raise ValueError("Marcadores fora de ordem.")
        # Consome somente uma quebra de linha pertencente ao bloco.
        if section[last:last + 1] == "\n":
            last += 1
        unmanaged = section[:first] + section[last:]
        if re.search(r"\blocation\s+(?:\^~\s+)?/\s*\{", masked(unmanaged)):
            raise ValueError("Já existe um location raiz fora do bloco gerenciado.")
        updated = section[:first] + BLOCK + section[last:]
        return text[:start] + updated + text[close:]
    if "/.well-known/acme-challenge/" in masked(section):
        raise ValueError("Já existe configuração ACME; concilie-a manualmente antes de publicar.")
    # Substitui apenas o location raiz conhecido; não muda certificados/maps.
    locations = list(re.finditer(r"\blocation\s+/\s*\{", masked(section)))
    if len(locations) != 1:
        raise ValueError("Esperava um único location / original; revisão manual necessária.")
    location = locations[0]
    body = masked(section)
    level = 1
    last = location.end()
    while level and last < len(body):
        if body[last] == "{":
            level += 1
        elif body[last] == "}":
            level -= 1
        last += 1
    if level:
        raise ValueError("Location raiz sem fechamento.")
    first = section.rfind("\n", 0, location.start()) + 1
    if section[first:location.start()].strip():
        first = location.start()
    if section[last:last + 1] == "\n":
        last += 1
    updated = section[:first] + BLOCK + section[last:]
    return text[:start] + updated + text[close:]


def atomic_write(path, contents, original_stat):
    fd, temporary = tempfile.mkstemp(prefix=".univille-nginx-", dir=path.parent)
    try:
        with os.fdopen(fd, "w") as stream:
            stream.write(contents)
            stream.flush()
            os.fsync(stream.fileno())
        os.chmod(temporary, stat.S_IMODE(original_stat.st_mode))
        os.chown(temporary, original_stat.st_uid, original_stat.st_gid)
        os.replace(temporary, path)
    finally:
        if os.path.exists(temporary):
            os.unlink(temporary)


def apply(path, contents):
    if os.geteuid() != 0:
        raise ValueError("A aplicação exige sudo; use render para revisão sem alterações.")
    original = path.read_text()
    if original == contents:
        subprocess.run(["nginx", "-t"], check=True)
        print("Configuração da agenda na raiz já está atualizada.")
        return
    metadata = path.stat()
    backups = Path("/var/backups/univille-eventos")
    backups.mkdir(mode=0o700, parents=True, exist_ok=True)
    stamp = datetime.datetime.now(datetime.timezone.utc).strftime("%Y%m%dT%H%M%SZ")
    backup = backups / f"nginx-{stamp}-{os.getpid()}.conf"
    shutil.copyfile(path, backup)
    backup.chmod(0o600)
    atomic_write(path, contents, metadata)
    try:
        subprocess.run(["nginx", "-t"], check=True)
        subprocess.run(["systemctl", "reload", "nginx"], check=True)
    except BaseException:
        atomic_write(path, original, metadata)
        # O reload só ocorre se a configuração restaurada também for válida.
        if subprocess.run(["nginx", "-t"]).returncode == 0:
            subprocess.run(["systemctl", "reload", "nginx"], check=False)
        raise
    print(f"Nginx atualizado. Backup para reversão: {backup}")


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("action", choices=("render", "apply", "restore"))
    parser.add_argument("--config", default="/etc/nginx/sites-enabled/default")
    parser.add_argument("--output", help="Arquivo de saída para render")
    parser.add_argument("--backup", help="Backup exato a restaurar")
    args = parser.parse_args()
    config = Path(args.config).resolve(strict=True)
    if args.action == "restore":
        if not args.backup:
            parser.error("restore exige --backup")
        contents = Path(args.backup).read_text()
        apply(config, contents)
    else:
        contents = render(config.read_text())
        if args.action == "render":
            if not args.output:
                parser.error("render exige --output")
            Path(args.output).write_text(contents)
        else:
            apply(config, contents)


if __name__ == "__main__":
    try:
        main()
    except (ValueError, OSError, subprocess.CalledProcessError) as error:
        raise SystemExit(f"Nginx não alterado ou restaurado após falha: {error}")
