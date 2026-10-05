#!/usr/bin/env bash
# Run from the deployed release directory. Does not delete or restore anything.
set -euo pipefail
umask 077
: "${BACKUP_ROOT:?Set BACKUP_ROOT to a protected directory outside the release}"
: "${ENV_FILE:?Set ENV_FILE to the protected production .env file}"
destination="${BACKUP_ROOT}/enbypro-$(date -u +%Y%m%dT%H%M%SZ)"
mkdir -p "$destination"
docker compose --env-file "$ENV_FILE" -p enbypro exec -T mongo mongodump --archive --gzip > "$destination/mongo.archive.gz"
docker compose --env-file "$ENV_FILE" -p enbypro exec -T app python -c 'import sys,tarfile; t=tarfile.open(fileobj=sys.stdout.buffer,mode="w|gz"); t.add("/app/var/media",arcname="media"); t.close()' > "$destination/media.tar.gz"
sha256sum "$destination/mongo.archive.gz" "$destination/media.tar.gz" > "$destination/SHA256SUMS"
printf 'Backup saved: %s\n' "$destination"
