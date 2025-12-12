const express = require('express');
const cors = require('cors');
const puppeteer = require('puppeteer');
const cheerio = require('cheerio');
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
  protocolTimeout: 120000, // 2 minutes for protocol operations
  args: [
    '--no-sandbox',
    '--disable-setuid-sandbox',
    '--disable-dev-shm-usage',
    '--disable-accelerated-2d-canvas',
    '--no-first-run',
    '--no-zygote',
    '--disable-gpu',
    '--disable-extensions',
    '--disable-background-networking',
    '--disable-blink-features=AutomationControlled' // Avoid bot detection
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

// Sanitize HTML for SEO analysis - remove bloat, keep semantic content
function sanitizeHtml(html) {
  const $ = cheerio.load(html);

  // Remove entire style blocks
  $('style').remove();

  // Remove all scripts
  $('script').remove();

  // Remove SVG elements (they bloat the payload)
  $('svg').remove();

  // Remove all inline styles
  $('[style]').removeAttr('style');

  // Remove all class attributes
  $('[class]').removeAttr('class');

  // Remove data-* attributes
  $('*').each(function() {
    const attrs = $(this).attr();
    if (attrs) {
      Object.keys(attrs).forEach(attr => {
        if (attr.startsWith('data-')) {
          $(this).removeAttr(attr);
        }
      });
    }
  });

  // Remove aria-* attributes (not needed for SEO)
  $('*').each(function() {
    const attrs = $(this).attr();
    if (attrs) {
      Object.keys(attrs).forEach(attr => {
        if (attr.startsWith('aria-')) {
          $(this).removeAttr(attr);
        }
      });
    }
  });

  // Remove id attributes (usually not needed for SEO)
  $('[id]').removeAttr('id');

  // Remove role attributes
  $('[role]').removeAttr('role');

  return $.html();
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

        // Set a longer default timeout for the page
        page.setDefaultTimeout(60000); // 60 seconds

        // Set viewport and user agent to look like a real browser
        await page.setViewport({ width: 1920, height: 1080 });
        await page.setUserAgent('Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36');

        // Remove webdriver property to avoid bot detection
        await page.evaluateOnNewDocument(() => {
          Object.defineProperty(navigator, 'webdriver', {
            get: () => false,
          });
        });

        // Navigate to URL with longer timeout
        await page.goto(item.url, {
          waitUntil: 'domcontentloaded',
          timeout: 60000 // 60 seconds
        });

        // Wait briefly for React to hydrate
        await page.waitForTimeout(1000);

        // Get the fully rendered HTML
        const html = await page.content();

        // Sanitize HTML to remove bloat and keep only SEO-relevant content
        const sanitizedHtml = sanitizeHtml(html);

        console.log(`✓ Scraped [${index + 1}/${urls.length}]: ${item.url}`);
        return { data: sanitizedHtml };
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

    // Process URLs one at a time (sequential)
    const results = [];

    for (let i = 0; i < urls.length; i++) {
      const result = await scrapeUrl(urls[i], i);
      results.push(result);
    }

    console.log(`✓ Completed scraping all ${results.length} URLs`);
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
