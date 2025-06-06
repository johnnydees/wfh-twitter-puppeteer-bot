// index.js  — main bot script
import puppeteer from 'puppeteer-core';
import { google } from 'googleapis';
import { JWT } from 'google-auth-library';

// ---------- Google Sheets setup ----------
const creds = JSON.parse(process.env.GSHEET_KEY);
const jwt = new JWT({
  email: creds.client_email,
  key: creds.private_key,
  scopes: ['https://www.googleapis.com/auth/spreadsheets'],
});
const sheets = google.sheets({ version: 'v4', auth: jwt });

async function getRows() {
  const res = await sheets.spreadsheets.values.get({
    spreadsheetId: process.env.SHEET_ID,
    range: 'Sheet1!A2:F',     // Title | Price | Link | AffLink | Tweet | Posted
  });
  return res.data.values ?? [];
}

async function markPosted(rowIndex) {
  await sheets.spreadsheets.values.update({
    spreadsheetId: process.env.SHEET_ID,
    range: `Sheet1!F${rowIndex + 2}`,
    valueInputOption: 'RAW',
    requestBody: { values: [[`YES ${new Date().toISOString().slice(0, 10)}`]] },
  });
}

// ---------- Twitter helper ----------
async function tweet(text) {
  const browser = await puppeteer.launch({
    headless: process.env.HEADLESS !== 'false',
    executablePath: process.env.PUPPETEER_EXECUTABLE_PATH || '/usr/bin/chromium',
    args: [
      '--no-sandbox',
      '--disable-setuid-sandbox',
      '--user-agent=Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/123 Safari/537.36'
    ],
  });

  const page = await browser.newPage();

  // ---- Inject cookies safely ----
  const cookies = [{
    name: 'auth_token',
    value: process.env.AUTH_COOKIE,
    domain: '.twitter.com',
    path: '/',
    httpOnly: true,
    secure: true,
  }];

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

  await page.setCookie(...cookies);

  // ---- Navigate & tweet ----
  await page.goto('https://twitter.com/compose/tweet', { waitUntil: 'networkidle2' });
  await page.waitForSelector('div[role="textbox"]', { timeout: 20000 });
  await page.type('div[role="textbox"]', text);
  await page.click('div[data-testid="tweetButtonInline"]');
  await page.waitForTimeout(4000); // allow network call
  await browser.close();
}

// ---------- main loop ----------
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
    } catch (e) {
      console.error('Tweet failed:', e);
    }
  }
  console.log('Done, posted', posted);
})();
