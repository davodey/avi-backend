# How to Update Your Digital Ocean App to Use Go

## What Changed in the App Spec

The updated `app-spec-updated.yaml` file changes only the `avi-backend` service:

### Before (Node.js):
```yaml
- environment_slug: node-js
  run_command: npm run dev
  envs:
  - key: YOUTUBE_EMAIL
  - key: YOUTUBE_PASSWORD
```

### After (Go with Docker):
```yaml
- dockerfile_path: Dockerfile
  health_check:
    http_path: /api/health
  envs:
  - key: YTDLP_COOKIES_FILE
    value: ./cookies.txt
  - key: OPENAI_API_KEY
    type: SECRET
```

**Key changes:**
- ✅ Uses Dockerfile instead of Node.js buildpack
- ✅ Removed Node.js specific settings
- ✅ Added health check monitoring
- ✅ Marked OPENAI_API_KEY as SECRET
- ✅ Added YTDLP_COOKIES_FILE for bot detection
- ✅ Removed unused YOUTUBE_EMAIL and YOUTUBE_PASSWORD

## Apply the Update

### Method 1: Using doctl CLI (Fastest - 1 minute)

```bash
# 1. Get your app ID
doctl apps list

# 2. Update the app (replace YOUR_APP_ID with actual ID)
doctl apps update YOUR_APP_ID --spec app-spec-updated.yaml

# 3. Monitor deployment
doctl apps logs YOUR_APP_ID --follow
```

### Method 2: Using Digital Ocean Dashboard (5 minutes)

1. **Go to your app**: https://cloud.digitalocean.com/apps/YOUR_APP_ID

2. **Settings tab** → **App Spec**

3. **Edit Spec** button

4. **Replace the entire spec** with contents from `app-spec-updated.yaml`

5. **Save** → Review changes → **Update App**

6. **Wait for deployment** (3-5 minutes)

### Method 3: Manual Update (10 minutes)

If you prefer to edit just the backend service:

1. **Go to your app** → **Settings** → **Components**

2. **Click "avi-backend"** → **Edit**

3. **Update these fields**:
   - Remove: Environment (node-js)
   - Remove: Run Command (npm run dev)
   - **Add**: Dockerfile
     - Path: `Dockerfile`
   - **Update Environment Variables**:
     - Keep: `PORT` = `5055`
     - Keep: `OPENAI_API_KEY` (mark as **SECRET**)
     - Remove: `YOUTUBE_EMAIL`
     - Remove: `YOUTUBE_PASSWORD`
     - Add: `YTDLP_COOKIES_FILE` = `./cookies.txt`
   - **Add Health Check**:
     - Path: `/api/health`

4. **Save** → **Deploy**

## Verify the Update

After deployment completes (~3-5 minutes), verify it's working:

### 1. Check Logs
```bash
doctl apps logs YOUR_APP_ID --follow
```

**You should see**:
```
Server starting on port 5055
```

**NOT**:
```
> tsx watch src/server.ts
```

### 2. Test Health Endpoint
```bash
curl https://avisualidentity.com/server/api/health
```

**Expected response**:
```json
{
  "ok": true,
  "service": "phoenix-backend-transcriber",
  "time": "2025-12-09T..."
}
```

### 3. Test Transcribe Endpoint
```bash
curl -X POST https://avisualidentity.com/server/api/transcribe \
  -H 'Content-Type: application/json' \
  -d '{"url":"https://www.youtube.com/watch?v=dQw4w9WgXcQ"}'
```

Should return transcription with video metadata and timestamped segments.

## Rollback if Needed

If something goes wrong, you can rollback:

### Via Dashboard:
1. Go to your app → **Deployments** tab
2. Find the previous successful deployment
3. Click **Redeploy**

### Via CLI:
```bash
# List deployments
doctl apps list-deployments YOUR_APP_ID

# Redeploy a specific one
doctl apps redeploy YOUR_APP_ID DEPLOYMENT_ID
```

## Troubleshooting

### Build fails?
- Check that `Dockerfile` exists in your repo root
- Verify you're on the correct branch (`main`)

### Still seeing Node.js logs?
- The update wasn't applied. Try Method 1 (CLI) for guaranteed update

### Health check failing?
- Wait 30 seconds after deployment for app to initialize
- Check logs for errors: `doctl apps logs YOUR_APP_ID`

### Can't connect to backend?
- Verify ingress rule is still configured for `/server` prefix
- Check that HTTP port is set to `5055`

## Need Help?

- Check deployment logs: `doctl apps logs YOUR_APP_ID`
- Review full README.md for troubleshooting
- See DIGITAL_OCEAN_MIGRATION.md for more details
