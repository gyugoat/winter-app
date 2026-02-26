#!/bin/bash
# deploy.sh — Clean build + atomic deploy for winter-app
# Usage: ./deploy.sh
set -e

DEPLOY_DIR="$HOME/.winter/workspace"
SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"

echo "[1/4] Building..."
cd "$SCRIPT_DIR"
npm run build

echo "[2/4] Cleaning old assets..."
rm -rf "$DEPLOY_DIR/assets"

echo "[3/4] Deploying assets..."
cp -r dist/assets "$DEPLOY_DIR/assets"

echo "[4/4] Updating index.html hashes..."
# Extract JS and CSS references from dist/index.html
JS_REF=$(grep -oP 'src="/assets/[^"]+\.js"' dist/index.html | head -1 | grep -oP '/assets/[^"]+')
CSS_REF=$(grep -oP 'href="/assets/[^"]+\.css"' dist/index.html | head -1 | grep -oP '/assets/[^"]+')

if [ -z "$JS_REF" ] || [ -z "$CSS_REF" ]; then
    echo "ERROR: Could not extract JS/CSS references from dist/index.html"
    exit 1
fi

# Update the deployed index.html (preserve bootstrap script)
sed -i "s|src=\"/assets/index-[^\"]*\.js\"|src=\"$JS_REF\"|g" "$DEPLOY_DIR/index.html"
sed -i "s|href=\"/assets/index-[^\"]*\.css\"|href=\"$CSS_REF\"|g" "$DEPLOY_DIR/index.html"

ASSET_COUNT=$(ls "$DEPLOY_DIR/assets" | wc -l)
echo ""
echo "Done! Deployed $ASSET_COUNT files."
echo "  JS:  $JS_REF"
echo "  CSS: $CSS_REF"
echo ""
echo "Restart proxy: systemctl --user restart winter-proxy"
