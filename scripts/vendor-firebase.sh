#!/usr/bin/env bash
# Copia o SDK do Firebase (módulos ES do CDN oficial) para vendor/firebase/<versão>/, com a versão fixada,
# reescreve o import absoluto do firebase-auth.js para relativo e grava o SHA-256 dos arquivos.
# Uso: bash scripts/vendor-firebase.sh 12.19.0
set -euo pipefail
cd "$(dirname "$0")/.."
VERSION="${1:?informe a versão, ex.: 12.19.0}"
DIR="vendor/firebase/$VERSION"
mkdir -p "$DIR"
for f in firebase-app.js firebase-auth.js; do
  curl -fsS "https://www.gstatic.com/firebasejs/$VERSION/$f" -o "$DIR/$f"
done
sed -i.bak "s#https://www.gstatic.com/firebasejs/$VERSION/firebase-app.js#./firebase-app.js#g" "$DIR/firebase-auth.js"
rm "$DIR/firebase-auth.js.bak"
# O firebase-app.js traz a URL do CDN só como texto (nome do componente e do logger); o que não pode restar é import por URL.
if grep -qE "from *[\"'](https?:)?//|import *\(" "$DIR"/*.js; then
  echo "ainda há imports por URL" >&2
  exit 1
fi
printf '%s\n' "$VERSION" > vendor/firebase/VERSION
( cd vendor/firebase && shasum -a 256 "$VERSION"/*.js > SHA256SUMS )
echo "SDK $VERSION copiado e verificado"
