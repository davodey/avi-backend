const express = require('express');
const cors = require('cors');
const puppeteer = require('puppeteer');
require('dotenv').config();

const app = express();
const PORT = process.env.PORT || 5055;

// Middleware
app.use(cors());
app.use(express.json({ limit: '50mb' }));

// Puppeteer launch options for App Platform
const puppeteerOptions = {
  headless: 'new',
  executablePath: process.env.PUPPETEER_EXECUTABLE_PATH || '/usr/bin/chromium-browser',
  args: [
    '--no-sandbox',
    '--disable-setuid-sandbox',
    '--disable-dev-shm-usage',
    '--disable-accelerated-2d-canvas',
    '--no-first-run',
    '--no-zygote',
    '--single-process', // Important for low-memory environments
    '--disable-gpu'
  ]
};

// Health check endpoint - must be fast for App Platform
app.get('/api/health', (req, res) => {
  res.json({
    ok: true,
    service: 'avi-backend-scraper',
    time: new Date().toISOString()
  });
});

// Scrape endpoint
app.post('/api/scrape', async (req, res) => {
  try {
    // Handle both formats: direct array or wrapped in {data: [...]}
    let urls = req.body;
    if (!Array.isArray(urls) && urls.data && Array.isArray(urls.data)) {
      urls = urls.data;
    }

    // Validate request
    if (!Array.isArray(urls) || urls.length === 0) {
      return res.status(400).json({
        ok: false,
        error: 'Request body must be an array of URL objects'
      });
    }

    console.log(`Scraping ${urls.length} URLs...`);

    // Launch browser once for all URLs (more efficient)
    console.log('Launching Puppeteer...');
    const browser = await puppeteer.launch(puppeteerOptions);
    console.log('Browser launched successfully');

    const results = [];

    // Scrape each URL
    for (const item of urls) {
      try {
        console.log(`Scraping: ${item.url}`);

        const page = await browser.newPage();

        // Set viewport and user agent
        await page.setViewport({ width: 1920, height: 1080 });
        await page.setUserAgent('Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36');

        // Navigate to URL with timeout
        await page.goto(item.url, {
          waitUntil: 'networkidle2',
          timeout: 30000
        });

        // Wait a bit for React to fully hydrate
        await page.waitForTimeout(2000);

        // Get the fully rendered HTML
        const html = await page.content();

        results.push({ data: html });

        await page.close();
        console.log(`✓ Scraped: ${item.url}`);
      } catch (error) {
        console.error(`✗ Error scraping ${item.url}:`, error.message);
        results.push({ data: '' });
      }
    }

    await browser.close();

    console.log(`Completed scraping ${results.length} URLs`);
    res.json(results);

  } catch (error) {
    console.error('Error in scrape endpoint:', error);
    res.status(500).json({
      ok: false,
      error: 'Failed to scrape URLs: ' + error.message
    });
  }
});

// Start server
app.listen(PORT, async () => {
  console.log(`Server running on port ${PORT}`);
  console.log(`Health check: http://localhost:${PORT}/api/health`);
  console.log(`Puppeteer executable: ${puppeteerOptions.executablePath}`);

  // Test Puppeteer on startup
  try {
    console.log('Testing Puppeteer launch...');
    const browser = await puppeteer.launch(puppeteerOptions);
    console.log('✓ Puppeteer can launch successfully');
    await browser.close();
  } catch (error) {
    console.error('✗ Puppeteer launch failed:', error.message);
    console.error('Full error:', error);
  }
});
