# Build stage
FROM golang:1.22-alpine AS builder

# Install build dependencies
RUN apk add --no-cache git

WORKDIR /app

# Copy go mod files
COPY go.mod go.sum ./

# Download dependencies
RUN go mod download

# Copy source code
COPY . .

# Build the application
RUN CGO_ENABLED=0 GOOS=linux go build -a -installsuffix cgo -o main .

# Runtime stage
FROM alpine:latest

# Install runtime dependencies
RUN apk add --no-cache \
    ca-certificates \
    python3 \
    py3-pip \
    ffmpeg

# Install yt-dlp
RUN pip3 install --no-cache-dir --break-system-packages yt-dlp

WORKDIR /app

# Copy the binary from builder
COPY --from=builder /app/main .

# Copy .env file if it exists (optional)
COPY .env* ./

# Copy cookies file if it exists (optional)
COPY cookies.txt* ./ 2>/dev/null || true

# Expose port
EXPOSE 5055

# Run the application
CMD ["./main"]
