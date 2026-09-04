#!/bin/sh
# Pasang git hook WARNOTO ke .git/hooks (jalankan sekali per mesin; .git/hooks tak ikut ter-commit).
DIR="$(cd "$(dirname "$0")/.." && pwd)"
cp "$DIR/utils/hooks/pre-commit" "$DIR/.git/hooks/pre-commit"
chmod +x "$DIR/.git/hooks/pre-commit"
echo "pre-commit hook terpasang."
