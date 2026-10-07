#!/usr/bin/env bash
# build-apk.sh — builds the Chesspirit Android app in Docker.
#
#   ./mobile/build-apk.sh        → mobile/dist/chesspirit-debug.apk
#
# The host needs only Docker. The first run builds the toolchain image
# (Dockerfile.build, ~2 GB) and creates the native project in mobile/android;
# later runs reuse both. The APK is debug-signed: fine for installing on your
# own phone, not for the Play Store.

set -euo pipefail

here="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
repo="$(dirname "$here")"
image=chesspirit-android-build

docker build --platform linux/amd64 -t "$image" -f "$here/Dockerfile.build" "$here"

# Gradle's and npm's downloads live in named volumes so a rebuild is quick.
# So does ~/.android, which holds the debug signing key: Android only installs
# an update over an app signed with the same key, so the key has to outlive
# the container. (Lose the volume and the next APK needs an uninstall first.)
toolchain() {
  docker run --rm --platform linux/amd64 \
    -v "$repo":/repo \
    -v chesspirit-gradle:/root/.gradle \
    -v chesspirit-android-home:/root/.android \
    -v chesspirit-npm:/root/.npm \
    -w /repo/mobile \
    "$image" bash -euo pipefail -c "$1"
}

# 1. Dependencies, and the native project — created once, then kept in git.
toolchain '
  npm install --no-audit --no-fund
  [ -d android ] || npx cap add android
'

# 2. App icon and splash from the web app's logo. This runs in a plain Node
#    container of the host's own architecture: the image library behind
#    @capacitor/assets (libvips) crashes under the amd64 emulation the Android
#    toolchain needs. Cosmetic, so a failure keeps the icons already in
#    mobile/android rather than failing the build.
docker run --rm \
  -v "$repo":/repo \
  -v chesspirit-assets-tool:/tool \
  -w /repo/mobile \
  node:22-bookworm-slim bash -euo pipefail -c '
    [ -x /tool/node_modules/.bin/capacitor-assets ] || npm install --prefix /tool --no-audit --no-fund @capacitor/assets@^3.0.5
    mkdir -p assets
    NODE_PATH=/tool/node_modules node -e "require(\"sharp\")(\"../web/public/icon.svg\", { density: 400 }).resize(1024, 1024).png().toFile(\"assets/logo.png\").catch((e) => { console.error(e); process.exit(1); })"
    /tool/node_modules/.bin/capacitor-assets generate --android \
      --iconBackgroundColor "#1f2330" --iconBackgroundColorDark "#1f2330" \
      --splashBackgroundColor "#1f2330" --splashBackgroundColorDark "#1f2330"
  ' || echo "warning: icon generation failed, keeping the existing icons"

# 3. The offline app (web/src/offline): Stockfish and puzzles on the device.
#    Built from the web workspace into mobile/www/offline, with the engine —
#    the single-threaded "lite" WebAssembly build of Stockfish from the
#    `stockfish` npm package (GPL-3.0), pinned by version and checksum — put
#    beside it. node_modules stays in a volume, off the host.
docker run --rm \
  -v "$repo":/repo \
  -v chesspirit-web-modules:/repo/node_modules \
  -v chesspirit-npm-native:/root/.npm \
  -w /repo \
  node:22-bookworm-slim bash -euo pipefail -c '
    npm ci --no-audit --no-fund --workspace web --include-workspace-root
    rm -rf mobile/www/offline/assets mobile/www/offline/offline.html
    npm exec --workspace web -- vite build --config vite.offline.config.ts

    engine=mobile/www/offline/engine
    sums="d3344124ab067fb0b90ee77873bb8e9fbf5fc01bc525fe714b0f942581e889e6  $engine/stockfish.js
57ac2d72312aba346760e3f173f687a8c211208e97a87268436f7f0e10bb5387  $engine/stockfish.wasm"
    if [ ! -f "$engine/COPYING.txt" ] || ! echo "$sums" | sha256sum --check --status 2>/dev/null; then
      mkdir -p "$engine" /tmp/sf
      (cd /tmp/sf && npm pack stockfish@19.0.0 --silent > /dev/null && tar xzf stockfish-19.0.0.tgz)
      cp /tmp/sf/package/bin/stockfish-19-lite-single.js "$engine/stockfish.js"
      cp /tmp/sf/package/bin/stockfish-19-lite-single.wasm "$engine/stockfish.wasm"
      cp /tmp/sf/package/Copying.txt "$engine/COPYING.txt"
      echo "$sums" | sha256sum --check
    fi
  '

# 4. Copy the web assets in and build.
toolchain '
  npx cap sync android

  # Self-hosted servers on a home network are plain http; Android refuses
  # that unless the app says so.
  manifest=android/app/src/main/AndroidManifest.xml
  grep -q usesCleartextTraffic "$manifest" \
    || sed -i "s/<application/<application android:usesCleartextTraffic=\"true\"/" "$manifest"

  (cd android && ./gradlew --no-daemon assembleDebug)

  mkdir -p dist
  cp android/app/build/outputs/apk/debug/app-debug.apk dist/chesspirit-debug.apk
  ls -lh dist/chesspirit-debug.apk
'
