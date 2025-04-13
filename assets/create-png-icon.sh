#!/bin/bash

# Create build directory if it doesn't exist
mkdir -p ../build

# Use convert to create a simple icon
convert -size 512x512 xc:#3B82F6 -fill white -gravity center -font Arial-Bold -pointsize 120 -annotate 0 "Fix" ../build/icon.png

# Create copies for different platforms
convert ../build/icon.png ../build/icon.icns
convert ../build/icon.png ../build/icon.ico

echo "Icon files created in build directory"
