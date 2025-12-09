#!/bin/bash
set -e

echo "Installing yt-dlp..."
pip3 install --user yt-dlp

echo "Building Go application..."
go build -o avi-backend main.go

echo "Build complete!"
