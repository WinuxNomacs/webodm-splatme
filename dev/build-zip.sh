#!/usr/bin/env bash
# Builds the plugin's release zip from a commit (HEAD unless given): dist/splatme-<version>.zip, the committed splatme/
# folder as its single root (as WebODM's Upload Plugin and its plugin directory require), without the tests or
# anything git ignores (public/build, the generated webpack.config.js: WebODM builds the page scripts itself).
# Also its .sha256 (the hash WebODM-Plugins' directory.json lists) and checks that the manifest's
# version is the one given, when one is (a release tag's, without its "v").
#   dev/build-zip.sh [commit] [version]
set -euo pipefail
cd "$(dirname "$0")/.."
ref="${1:-HEAD}"
want="${2:-}"

version="$(git show "$ref:splatme/manifest.json" | python3 -c 'import json, sys; print(json.load(sys.stdin)["version"])')"
if [ -n "$want" ] && [ "$want" != "$version" ]; then
    echo "The manifest's version is $version, not $want: update splatme/manifest.json first." >&2
    exit 1
fi

zip="splatme-$version.zip"
mkdir -p dist
rm -f "dist/$zip" "dist/$zip.sha256"
# git archive: only committed files, each with the commit's time, so the same commit gives the same zip (in UTC:
# a zip's times are local, and the release workflow runs in UTC)
TZ=UTC git archive --format=zip -o "dist/$zip" "$ref" -- splatme ':!splatme/tests' ':!splatme/public/__tests__'
(cd dist && sha256sum "$zip" > "$zip.sha256")
echo "dist/$zip: SplatMe $version from $(git rev-parse --short "$ref"), sha256 $(cut -d' ' -f1 "dist/$zip.sha256")"
