#!/usr/bin/env bash
# ================================================================
# Voxel Drive: Infinite Horizon — APK builder (no Gradle)
# aapt2 -> javac -> d8 -> zipalign -> apksigner
# ================================================================
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
JAVA_HOME="${JAVA_HOME:-$ROOT/.tooling/jdk-17/Contents/Home}"
SDK="${ANDROID_HOME:-$HOME/Library/Android/sdk}"
BT="$SDK/build-tools/36.0.0"
PLATFORM="$SDK/platforms/android-35/android.jar"
JAVAC="$JAVA_HOME/bin/javac"
KEYTOOL="$JAVA_HOME/bin/keytool"
BUILD="$ROOT/.build-apk"
KS_DIR="$ROOT/.android/keystore"
KS="$KS_DIR/voxel-drive.jks"
PROPS="$KS_DIR/keystore.properties"
VERSION="2.1.0"
APK="$ROOT/apk/VoxelDrive-v$VERSION.apk"

export JAVA_HOME
export PATH="$JAVA_HOME/bin:$PATH"

for tool in "$JAVAC" "$KEYTOOL" "$BT/aapt2" "$BT/d8" "$BT/zipalign" "$BT/apksigner" "$PLATFORM"; do
  if [ ! -e "$tool" ]; then
    echo "ERRORE: manca $tool" >&2
    echo "Installa Android SDK build-tools 36.0.0 e platforms/android-35." >&2
    exit 1
  fi
done

echo "==> Pulizia build"
rm -rf "$BUILD"
mkdir -p "$BUILD/assets/www/icons" "$BUILD/assets/www/vendor" "$BUILD/res" \
         "$BUILD/classes" "$BUILD/dex" "$BUILD/gen" "$ROOT/apk"

echo "==> Copia asset web"
for f in index.html style.css physics.js cars.js world.js game.js manifest.webmanifest sw.js; do
  cp "$ROOT/$f" "$BUILD/assets/www/$f"
done
cp "$ROOT/vendor/three.min.js" "$BUILD/assets/www/vendor/three.min.js"
cp "$ROOT/icons/icon-192.png" "$BUILD/assets/www/icons/icon-192.png"
cp "$ROOT/icons/icon-512.png" "$BUILD/assets/www/icons/icon-512.png"

# Nell'APK l'asset locale è preferibile: elimina la dipendenza dalla CDN.
# La riga di fallback (vendor/three.min.js) resta e carica subito Three.js.
perl -0pi -e 's#<script src="https://cdnjs\.cloudflare\.com/ajax/libs/three\.js/r128/three\.min\.js"></script>\s*##g' \
  "$BUILD/assets/www/index.html"
if grep -q "cdnjs.cloudflare.com/ajax/libs/three" "$BUILD/assets/www/index.html"; then
  echo "ERRORE: la CDN non è stata rimossa dall'asset APK" >&2
  exit 1
fi

echo "==> Copia risorse Android + icone"
cp -R "$ROOT/android/res/." "$BUILD/res/"
for pair in "mdpi 48" "hdpi 72" "xhdpi 96" "xxhdpi 144" "xxxhdpi 192"; do
  set -- $pair
  mkdir -p "$BUILD/res/mipmap-$1"
  sips -z "$2" "$2" "$ROOT/icons/icon-512.png" \
    --out "$BUILD/res/mipmap-$1/ic_launcher.png" >/dev/null
done

echo "==> aapt2 compile"
"$BT/aapt2" compile --dir "$BUILD/res" -o "$BUILD/compiled-res.zip"

echo "==> aapt2 link (manifest + resources + assets)"
"$BT/aapt2" link \
  -o "$BUILD/unsigned.apk" \
  -I "$PLATFORM" \
  --manifest "$ROOT/android/AndroidManifest.xml" \
  -A "$BUILD/assets" \
  --java "$BUILD/gen" \
  --min-sdk-version 24 \
  --target-sdk-version 35 \
  --version-code 3 \
  --version-name "$VERSION" \
  "$BUILD/compiled-res.zip"

echo "==> javac"
cd "$ROOT"
find android/java -name '*.java' > "$BUILD/java-sources.txt"
find .build-apk/gen -name '*.java' >> "$BUILD/java-sources.txt"
"$JAVAC" --release 8 -classpath "$PLATFORM" -d "$BUILD/classes" @"$BUILD/java-sources.txt"

echo "==> d8 (dex)"
find .build-apk/classes -name '*.class' > "$BUILD/classes.txt"
# I percorsi relativi non contengono spazi: il word splitting è sicuro qui.
"$BT/d8" --lib "$PLATFORM" --min-api 24 --output "$BUILD/dex" $(cat "$BUILD/classes.txt")

cp "$BUILD/dex/classes.dex" "$BUILD/classes.dex"
(
  cd "$BUILD"
  zip -q -u unsigned.apk classes.dex
)

echo "==> zipalign"
"$BT/zipalign" -f 4 "$BUILD/unsigned.apk" "$BUILD/aligned.apk"

echo "==> Firma (keystore self-signed locale)"
mkdir -p "$KS_DIR"
if [ ! -f "$PROPS" ]; then
  storePassword="$(openssl rand -hex 16)"
  # PKCS#12 usa la stessa password per archivio e chiave.
  keyPassword="$storePassword"
  cat > "$PROPS" <<EOF
storePassword=$storePassword
keyPassword=$keyPassword
keyAlias=voxeldrive
EOF
  chmod 600 "$PROPS"
fi
# shellcheck disable=SC1090
. "$PROPS"
if [ ! -f "$KS" ]; then
  "$KEYTOOL" -genkeypair -v \
    -keystore "$KS" \
    -alias "$keyAlias" \
    -keyalg RSA -keysize 2048 -validity 10000 \
    -storepass "$storePassword" -keypass "$keyPassword" \
    -dname "CN=Voxel Drive, OU=Infinite Horizon, O=Voxel Drive, L=Italia, ST=Italia, C=IT"
  chmod 600 "$KS"
fi

"$BT/apksigner" sign \
  --ks "$KS" \
  --ks-key-alias "$keyAlias" \
  --ks-pass "pass:$storePassword" \
  --key-pass "pass:$storePassword" \
  --out "$APK" \
  "$BUILD/aligned.apk"

echo "==> Verifica firma"
"$BT/apksigner" verify --verbose --print-certs "$APK"

echo "==> Badging"
"$BT/aapt2" dump badging "$APK" | head -20

echo "==> SHA-256"
rm -f "$APK.idsig"
shasum -a 256 "$APK"
ls -lh "$APK"
echo "APK pronto: $APK"
