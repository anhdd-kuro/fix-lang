#!/bin/bash

# Create a directory for the iconset
mkdir -p FixkeyClone.iconset

# Generate different sizes of the icon
# Simple text-based icon with "Fix" text
for size in 16 32 64 128 256 512; do
  # Double size for retina display
  size2x=$((size * 2))
  
  # Create the icon with "Fix" text
  convert -size ${size}x${size} -background '#3B82F6' -fill white -gravity center -font Arial-Bold label:"Fix" FixkeyClone.iconset/icon_${size}x${size}.png
  
  # Create the 2x version
  if [ $size -lt 512 ]; then
    convert -size ${size2x}x${size2x} -background '#3B82F6' -fill white -gravity center -font Arial-Bold label:"Fix" FixkeyClone.iconset/icon_${size}x${size}@2x.png
  fi
done

# Create the icns file
iconutil -c icns FixkeyClone.iconset

# Move the icns file to the build directory
mkdir -p ../build
mv FixkeyClone.icns ../build/icon.icns

# Create a copy for Windows and Linux
convert ../build/icon.icns ../build/icon.ico
convert ../build/icon.icns ../build/icon.png

# Clean up
rm -rf FixkeyClone.iconset

echo "Icon files created in build directory"
