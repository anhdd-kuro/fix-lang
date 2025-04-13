#!/bin/bash

# Build and package the Fixkey Clone app
# This script automates the build and packaging process

echo "🚀 Starting Fixkey Clone build process..."

# Check if Node.js is installed
if ! command -v node &> /dev/null; then
    echo "❌ Node.js is not installed. Please install Node.js and try again."
    exit 1
fi

# Check if npm is installed
if ! command -v npm &> /dev/null; then
    echo "❌ npm is not installed. Please install npm and try again."
    exit 1
fi

# Install dependencies if node_modules doesn't exist
if [ ! -d "node_modules" ]; then
    echo "📦 Installing dependencies..."
    npm install
fi

# Build the application
echo "🔨 Building the application..."
npm run build:dist

# Check if build was successful
if [ $? -eq 0 ]; then
    echo "✅ Build successful!"
    echo "📦 Packaged application is available in the release directory."
    
    # Open the release directory
    open release
else
    echo "❌ Build failed. Please check the error messages above."
    exit 1
fi

echo "🎉 Build process completed!"
