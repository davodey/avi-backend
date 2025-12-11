# Build stage
FROM golang:1.24-alpine AS builder

# Install build dependencies
RUN apk add --no-cache git

WORKDIR /app

# Copy go mod files
COPY go.mod go.sum ./

# Download dependencies
RUN go mod download

# Copy source code
COPY . .

# Ensure go.mod is up to date
RUN go mod tidy

# Build the application
RUN CGO_ENABLED=0 GOOS=linux go build -a -installsuffix cgo -o server .

# Runtime stage
FROM alpine:latest

# Install runtime dependencies including Chromium for web scraping
RUN apk add --no-cache \
    ca-certificates \
    python3 \
    py3-pip \
    ffmpeg \
    chromium \
    nss \
    freetype \
    harfbuzz \
    ttf-freefont \
    udev

# Install yt-dlp with latest version and PO token provider plugin
RUN pip3 install --no-cache-dir --break-system-packages -U yt-dlp bgutil-ytdlp-pot-provider

# Set Chrome path for chromedp
ENV CHROME_BIN=/usr/bin/chromium-browser \
    CHROME_PATH=/usr/lib/chromium/

WORKDIR /app

# Copy the binary from builder
COPY --from=builder /app/server .

# Expose port
EXPOSE 5055

# Run the application
CMD ["./server"]
