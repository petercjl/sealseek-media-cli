# ffprobe runtime dependency

This package depends on `@ffprobe-installer/ffprobe` (LGPL-2.1), which installs a platform-specific ffprobe executable from npm. The wrapper and platform packages retain their own licenses and binary build notices. This dependency does not change the license of this package's source code.

Wrapper source, platform build sources and licensing details: https://github.com/SavageCore/node-ffprobe-installer

FFmpeg / ffprobe upstream source and licensing: https://ffmpeg.org/download.html and https://ffmpeg.org/legal.html

Supported packaged targets: macOS arm64/x64, Windows ia32/x64, Linux arm/arm64/ia32/x64. Other targets may supply their own working ffprobe executable. Executables are invoked as separate processes; they are not linked into this package.
