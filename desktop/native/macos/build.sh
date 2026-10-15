#!/usr/bin/env bash
# Builds the universal (Apple silicon + Intel) SystemAudioCapture helper. Run on a Mac with Xcode tools.
set -euo pipefail
cd "$(dirname "$0")"
mkdir -p build
for arch in arm64 x86_64; do
  swiftc -O -target "${arch}-apple-macos13.0" \
    -framework ScreenCaptureKit -framework CoreMedia -framework AVFoundation \
    SystemAudioCapture.swift -o "build/SystemAudioCapture-${arch}"
done
lipo -create build/SystemAudioCapture-arm64 build/SystemAudioCapture-x86_64 -output build/SystemAudioCapture
rm build/SystemAudioCapture-arm64 build/SystemAudioCapture-x86_64
echo "Built native/macos/build/SystemAudioCapture"
