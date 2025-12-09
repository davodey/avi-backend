# Digital Ocean Deployment Files

This directory contains configuration files for deploying to Digital Ocean App Platform.

## Files

- **app.yaml**: App Platform spec using Dockerfile (recommended, includes all dependencies)
- **app-native.yaml**: App Platform spec using native Go build (faster builds)
- **deploy.sh**: Build script for native deployments

## Quick Start

### Using the Dashboard (Easiest)

1. Go to [Digital Ocean App Platform](https://cloud.digitalocean.com/apps)
2. Create new app from GitHub
3. Select **Dockerfile** as build method
4. Set environment variables:
   - `PORT` = `5055`
   - `OPENAI_API_KEY` = your OpenAI API key (mark as secret)
5. Deploy!

### Using doctl CLI

```bash
# Create new app with Dockerfile
doctl apps create --spec .do/app.yaml

# Or create with native Go build
doctl apps create --spec .do/app-native.yaml

# Update existing app
doctl apps update YOUR_APP_ID --spec .do/app.yaml
```

## Updating Existing Deployment

If you currently have Node.js deployed with `npm run dev`:

### Option A: Switch to Dockerfile
1. Settings → Components → Edit
2. Build Method: Dockerfile
3. Dockerfile Path: `Dockerfile`
4. Save and deploy

### Option B: Update to Native Go
1. Settings → Components → Edit
2. Build Command: `pip3 install --user yt-dlp && go build -o avi-backend main.go`
3. Run Command: `./avi-backend`
4. Save and deploy

## Environment Variables

Required:
- `OPENAI_API_KEY` - Your OpenAI API key (mark as SECRET)

Optional:
- `PORT` - Server port (default: 5055)
- `YTDLP_COOKIES_FILE` - Path to YouTube cookies file

## Health Checks

The app includes a health check endpoint:
- Path: `/api/health`
- Expected Response: `{"ok": true, "service": "phoenix-backend-transcriber", "time": "..."}`

## Monitoring

Access logs via:
```bash
doctl apps logs YOUR_APP_ID --follow
```

## Troubleshooting

See main README.md for troubleshooting tips.
