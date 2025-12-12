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
  protocolTimeout: 60000, // Increase timeout from default 180s to 60s per operation
  args: [
    '--no-sandbox',
    '--disable-setuid-sandbox',
    '--disable-dev-shm-usage',
    '--disable-accelerated-2d-canvas',
    '--no-first-run',
    '--no-zygote',
    '--disable-gpu',
    '--disable-extensions',
    '--disable-background-networking'
  ]
};

// Shared browser instance (reuse instead of launching multiple)
let browserInstance = null;

// Get or create browser instance
async function getBrowser() {
  if (!browserInstance) {
    console.log('Creating new browser instance...');
    browserInstance = await puppeteer.launch(puppeteerOptions);
    console.log('Browser instance created');
  }
  return browserInstance;
}

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
    // Debug logging
    console.log('Request Content-Type:', req.headers['content-type']);
    console.log('Request body type:', typeof req.body);
    console.log('Request body is array:', Array.isArray(req.body));

    // Handle both formats: direct array or wrapped in {data: [...]}
    let urls = req.body;

    // Handle if body came as string (shouldn't happen with express.json but just in case)
    if (typeof urls === 'string') {
      try {
        urls = JSON.parse(urls);
      } catch (e) {
        return res.status(400).json({
          ok: false,
          error: 'Invalid JSON in request body'
        });
      }
    }

    if (!Array.isArray(urls) && urls.data && Array.isArray(urls.data)) {
      urls = urls.data;
    }

    // Validate request
    if (!Array.isArray(urls) || urls.length === 0) {
      console.log('Validation failed - urls:', urls);
      return res.status(400).json({
        ok: false,
        error: 'Request body must be an array of URL objects'
      });
    }

    console.log(`Scraping ${urls.length} URLs...`);

    // Get or create shared browser instance
    const browser = await getBrowser();

    // Scrape function for a single URL
    const scrapeUrl = async (item, index) => {
      let page = null;
      try {
        console.log(`Scraping [${index + 1}/${urls.length}]: ${item.url}`);

        page = await browser.newPage();

        // Set viewport and user agent
        await page.setViewport({ width: 1920, height: 1080 });
        await page.setUserAgent('Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36');

        // Navigate to URL with timeout
        // Use 'domcontentloaded' instead of 'networkidle2' for speed
        await page.goto(item.url, {
          waitUntil: 'domcontentloaded',
          timeout: 10000
        });

        // Wait briefly for React to hydrate
        await page.waitForTimeout(1000);

        // Get the fully rendered HTML
        const html = await page.content();

        console.log(`✓ Scraped [${index + 1}/${urls.length}]: ${item.url}`);
        return { data: html };
      } catch (error) {
        console.error(`✗ Error scraping ${item.url}:`, error.message);
        return { data: '' };
      } finally {
        // Always close the page to prevent memory leaks
        if (page) {
          try {
            await page.close();
          } catch (e) {
            console.error('Error closing page:', e.message);
          }
        }
      }
    };

    // Configurable concurrency (how many URLs to scrape in parallel)
    const CONCURRENCY = parseInt(process.env.SCRAPE_CONCURRENCY || '10');

    // Recommended max per request to avoid gateway timeouts (can be overridden)
    const MAX_URLS_PER_REQUEST = parseInt(process.env.MAX_URLS_PER_REQUEST || '50');

    if (urls.length > MAX_URLS_PER_REQUEST) {
      console.warn(`⚠️  Warning: ${urls.length} URLs exceeds recommended max of ${MAX_URLS_PER_REQUEST}. Consider splitting into smaller batches.`);
      // Still process, but warn - user may want to split in n8n for better reliability
    }

    // Process all URLs in parallel with concurrency limit
    const results = new Array(urls.length);

    for (let i = 0; i < urls.length; i += CONCURRENCY) {
      const batch = urls.slice(i, i + CONCURRENCY);
      const batchResults = await Promise.all(
        batch.map((url, batchIndex) => scrapeUrl(url, i + batchIndex))
      );
      batchResults.forEach((result, batchIndex) => {
        results[i + batchIndex] = result;
      });
      console.log(`Completed batch ${Math.floor(i / CONCURRENCY) + 1}/${Math.ceil(urls.length / CONCURRENCY)} (${i + batch.length}/${urls.length} URLs)`);
    }

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

  // Initialize browser instance on startup
  try {
    console.log('Initializing browser instance...');
    await getBrowser();
    console.log('✓ Browser initialized and ready');
  } catch (error) {
    console.error('✗ Browser initialization failed:', error.message);
    console.error('Full error:', error);
  }
});
