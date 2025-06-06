// index.js  — main bot script
import puppeteer from 'puppeteer-core';
import { google } from 'googleapis';
import { JWT } from 'google-auth-library';

// ---------- Google Sheets auth ----------
const creds = JSON.parse(process.env.GSHEET_KEY);
const jwt = new JWT({
  email: creds.client_email,
  key: creds.private_key,
  scopes: ['https://www.googleapis.com/auth/spreadsheets'],
});
const sheets = google.sheets({ version: 'v4', auth: jwt });

// ---------- Helpers ----------
async function getRows() {
  const res = await sheets.spreadsheets.values.get({
    spreadsheetId: process.env.SHEET_ID,
    range: 'Sheet1!A2:F', // Title | Price | Link | AffLink | Tweet | Posted
  });
  return res.data.values ?? [];
}

async function markPosted(rowIdx) {
  await sheets.spreadsheets.values.update({
    spreadsheetId: process.env.SHEET_ID,
    range: `Sheet1!F${rowIdx + 2}`,
    valueInputOption: 'RAW',
    requestBody: {
      values: [[`YES ${new Date().toISOString().slice(0, 10)}`]],
    },
  });
}

// ---------- Tweet routine ----------
async function tweet(text) {
  const browser = await puppeteer.launch({
    headless: process.env.HEADLESS !== 'false',
    executablePath:
      process.env.PUPPETEER_EXECUTABLE_PATH || '/usr/bin/chromium',
    args: [
      '--no-sandbox',
      '--disable-setuid-sandbox',
      '--disable-blink-features=AutomationControlled',
      '--user-agent=Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/123 Safari/537.36',
    ],
  });

  const page = await browser.newPage();

  // ---- Build cookie list safely ----
  const cookies = [
    {
      name: 'auth_token',
      value: process.env.AUTH_COOKIE,
      domain: '.twitter.com',
      path: '/',
      httpOnly: true,
      secure: true,
    },
  ];

  if (process.env.CT0 && process.env.CT0.trim()) {
    cookies.push({
      name: 'ct0',
      value: process.env.CT0.trim(),
      domain: '.twitter.com',
      path: '/',
      httpOnly: true,
      secure: true,
    });
  }

  if (process.env.TWID && process.env.TWID.trim()) {
    cookies.push({
      name: 'twid',
      value: process.env.TWID.trim(),
      domain: '.twitter.com',
      path: '/',
      httpOnly: true,
      secure: true,
    });
  }

  await page.setCookie(...cookies);

  // ---- Navigate to compose screen ----
  await page.goto('https://twitter.com/compose/tweet', {
    waitUntil: 'networkidle2',
  });

  // DEBUG: save screenshot of whatever loaded
  try {
    await page.screenshot({ path: '/tmp/debug.png', fullPage: true });
    console.log('📸 Saved /tmp/debug.png');
  } catch (e) {
    console.warn('Screenshot failed', e);
  }

  // Wait for either old or new selector
  await page.waitForSelector(
    'div[role="textbox"], div[data-testid="tweetTextarea_0"]',
    { timeout: 20000 }
  );

  // Type tweet (pick whichever selector exists)
  const box =
    (await page.$('div[role="textbox"]')) ||
    (await page.$('div[data-testid="tweetTextarea_0"]'));
  await box.type(text);

  await page.click('div[data-testid="tweetButtonInline"]'); // press Tweet
  await page.waitForTimeout(4000);
  await browser.close();
}

// ---------- Main loop ----------
(async () => {
  const rows = await getRows();
  let posted = 0;

  for (let i = 0; i < rows.length && posted < 5; i++) {
    const row = rows[i];
    if (row[5] && row[5].startsWith('YES')) continue; // already tweeted
    const tweetText = row[4];

    try {
      await tweet(tweetText);
      await markPosted(i);
      posted++;
    } catch (err) {
      console.error('Tweet failed:', err);
    }
  }
  console.log('Done, posted', posted);
})();
