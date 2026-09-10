#!/bin/sh
# Build on macOS (locally or CI); users do not need Xcode or Homebrew.
set -eu
cd "$(dirname "$0")/.."
out=plugin/src/content/scripts/iris-voice-macos
mkdir -p "$out"
xcrun clang -fobjc-arc -fblocks -Os -arch arm64 -arch x86_64 \
  -mmacosx-version-min=11.0 -framework Cocoa -framework AVFoundation \
  plugin/macos/IrisVoice.m -o "$out/IrisVoice"
cp plugin/macos/Info.plist "$out/Info.plist"
app="$out/Iris Voice.app"
mkdir -p "$app/Contents/MacOS"
mv "$out/IrisVoice" "$app/Contents/MacOS/IrisVoice"
mv "$out/Info.plist" "$app/Contents/Info.plist"
codesign --force --sign - --identifier org.iris-zotero.voice "$app"
codesign --verify --deep --strict "$app"
ditto -c -k --keepParent "$app" "$out/IrisVoice.zip"
