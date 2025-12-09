# YouTube Cookie Extractor

This script automatically logs into YouTube and extracts cookies for bypassing bot detection.

## Setup on Your Digital Ocean Server

1. **Install Puppeteer** (one-time):
   ```bash
   npm install puppeteer --save-dev
   ```

2. **Run the cookie extractor**:
   ```bash
   YOUTUBE_EMAIL="your-email@gmail.com" \
   YOUTUBE_PASSWORD="your-password" \
   node scripts/get-youtube-cookies.js
   ```

3. **Restart your service**:
   ```bash
   npm run build
   pm2 restart your-app  # or however you restart
   ```

## Notes

- Cookies are saved to `cookies.txt` in the project root
- They last 6-12 months typically
- If you have 2FA enabled, you may need to disable it temporarily or use an app-specific password
- The script uses headless Chrome, so it needs sufficient server resources

## Alternative: Manual Cookie Export

If the automated script doesn't work (e.g., 2FA issues):

1. On your local computer, install: [Get cookies.txt LOCALLY](https://chrome.google.com/webstore/detail/get-cookiestxt-locally/cclelndahbckbenkjhflpdbgdldlbecc)
2. Log into YouTube
3. Click extension → Export for youtube.com
4. Upload `cookies.txt` to your server:
   ```bash
   scp cookies.txt user@your-server:/path/to/avi-backend/
   ```
