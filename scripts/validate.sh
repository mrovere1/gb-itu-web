#!/usr/bin/env bash
# Validações locais do portal: lint, testes, carimbo de versão e segredos. Não acessa a rede.
set -euo pipefail
cd "$(dirname "$0")/.."

fail() { echo "FALHA: $1" >&2; exit 1; }

echo "==> Lint"
npx --no-install eslint .

echo "==> Testes"
node --test "tests/**/*.test.js"

echo "==> Carimbo de versão"
node scripts/stamp-version.js --check

echo "==> Segredos"
if grep -rnE "gho_[A-Za-z0-9]{20,}|ya29\.[A-Za-z0-9_-]{20,}|-----BEGIN [A-Z ]*PRIVATE KEY-----|\"refresh_token\"|\"client_secret\"|\"private_key\"" \
   --exclude-dir=node_modules --exclude-dir=.git --exclude-dir=.superpowers --exclude-dir=vendor --exclude=validate.sh .; then
  fail "possível segredo encontrado"
fi
# A chave web do Firebase (AIza…) é pública por natureza, mas só pode aparecer em js/config.js.
if grep -rnE "AIza[0-9A-Za-z_-]{30,}" --exclude-dir=node_modules --exclude-dir=.git --exclude-dir=.superpowers --exclude-dir=vendor \
   --exclude=config.js --exclude=validate.sh .; then
  fail "chave AIza fora de js/config.js"
fi

echo "OK: todas as validações passaram."
