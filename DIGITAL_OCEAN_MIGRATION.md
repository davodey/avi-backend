# Digital Ocean Migration Guide: Node.js to Go

Your backend has been migrated from Node.js/TypeScript to Go. Follow these steps to update your Digital Ocean deployment.

## What Changed

- ✅ **Removed**: `src/server.ts`, `dist/`, `tsconfig.json` (TypeScript files)
- ✅ **Added**: `main.go` (Go implementation)
- ✅ **Updated**: `package.json` now runs Go instead of Node.js
- ✅ **New**: `.do/` directory with deployment configurations

## Current Issue

Your Digital Ocean app is still running the old TypeScript version using `npm run dev`. You need to update your app to use Go.

## Update Your Digital Ocean App (Choose One Method)

### Method 1: Update via Dashboard (Easiest)

1. **Go to your app**: [Digital Ocean Dashboard](https://cloud.digitalocean.com/apps)

2. **Click on your app** → **Settings** → **Components**

3. **Click "Edit" on your app component**

4. **Choose one of these options**:

   **Option A: Use Dockerfile (Recommended)**
   - Build Method: **Dockerfile**
   - Dockerfile Path: `Dockerfile`
   - HTTP Port: `5055`
   - Health Check Path: `/api/health`

   **Option B: Use Native Build Commands**
   - Build Command: `pip3 install --user yt-dlp && go build -o avi-backend main.go`
   - Run Command: `./avi-backend`
   - HTTP Port: `5055`
   - Health Check Path: `/api/health`

5. **Save Changes**

6. **Click "Deploy"** (or wait for auto-deploy from git push)

### Method 2: Use CLI with App Spec

```bash
# Get your app ID
doctl apps list

# Update with Dockerfile config
doctl apps update YOUR_APP_ID --spec .do/app.yaml

# OR update with native Go build
doctl apps update YOUR_APP_ID --spec .do/app-native.yaml
```

### Method 3: Let Git Auto-Deploy

If your app has auto-deploy enabled:

1. **Merge to main branch**:
   ```bash
   git checkout main
   git merge claude/migrate-backend-to-go-01BSv3vn3rHGZeXskQsevRwT
   git push origin main
   ```

2. **Update app settings** (one-time, via Dashboard or CLI) to use Dockerfile or Go build commands as shown above

3. Digital Ocean will auto-deploy on next push

## Environment Variables

Make sure these are set in your Digital Ocean app:

- `PORT` = `5055`
- `OPENAI_API_KEY` = your OpenAI API key (**mark as SECRET**)
- `YTDLP_COOKIES_FILE` = `./cookies.txt` (optional)

## Verify Deployment

After deployment, check:

1. **Health endpoint**:
   ```bash
   curl https://your-app.ondigitalocean.app/api/health
   ```

   Should return:
   ```json
   {
     "ok": true,
     "service": "phoenix-backend-transcriber",
     "time": "2025-12-09T..."
   }
   ```

2. **Check logs** for "Server starting on port 5055" (not "tsx watch src/server.ts")

## Troubleshooting

### Still seeing "tsx watch src/server.ts" in logs?

Your app hasn't been updated yet. Make sure to:
1. Update the build/run commands in DO settings
2. Trigger a new deployment (click Deploy or push to git)

### Build fails?

- For Dockerfile: Make sure "Build Method" is set to "Dockerfile"
- For native build: Make sure Go is detected (check that `go.mod` exists in repo root)

### Health check failing?

- Verify `PORT` environment variable is `5055`
- Check that app is listening on `0.0.0.0:5055`

## Need Help?

See the main README.md for more detailed Digital Ocean deployment instructions.
