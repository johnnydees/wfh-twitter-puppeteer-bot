// ========================= index.js =========================
import puppeteer from 'puppeteer-core';
import { google } from 'googleapis';
import { JWT } from 'google-auth-library';
import fs from 'fs';
import path from 'path';

const PROFILE_DIR = '/railway/worker-data';
const SHEET_RANGE = 'Sheet1!A2:F';

// ── Google Sheets setup ───────────────────────────────────
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
    range: SHEET_RANGE,
  });
  return res.data.values ?? [];
}
async function markPosted(i) {
  await sheets.spreadsheets.values.update({
    spreadsheetId: process.env.SHEET_ID,
    range: `Sheet1!F${i + 2}`,
    valueInputOption: 'RAW',
    requestBody: { values: [[`YES ${new Date().toISOString().slice(0, 10)}`]] },
  });
}

// ── Wipe and re-create profile directory ─────────────────
function resetProfileDir() {
  if (fs.existsSync(PROFILE_DIR)) {
    try {
      fs.rmSync(PROFILE_DIR, { recursive: true, force: true });
    } catch (e) {
      console.warn('Could not fully delete profile dir:', e);
    }
  }
  try {
    fs.mkdirSync(PROFILE_DIR, { recursive: true });
  } catch (e) {
    console.warn('Could not recreate profile dir:', e);
  }
}

// ── Main Bot Function ──────────────────────────────────────
(async () => {
  resetProfileDir();

  const browser = await puppeteer.launch({
    headless: true,
    userDataDir: PROFILE_DIR,
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

  // ── Inject cookies every run ──────────────────────────────
  if (process.env.AUTH_COOKIE) {
    const cookieList = [
      {
        name: 'auth_token',
        value: process.env.AUTH_COOKIE,
        domain: '.twitter.com',
        path: '/',
        httpOnly: true,
        secure: true,
      },
    ];
    if (process.env.CT0?.trim()) {
      cookieList.push({
        name: 'ct0',
        value: process.env.CT0.trim(),
        domain: '.twitter.com',
        path: '/',
        httpOnly: true,
        secure: true,
      });
    }
    if (process.env.TWID?.trim()) {
      cookieList.push({
        name: 'twid',
        value: process.env.TWID.trim(),
        domain: '.twitter.com',
        path: '/',
        httpOnly: true,
        secure: true,
      });
    }
    await page.setCookie(...cookieList);
  }

  const rows = await getRows();
  let posted = 0;

  for (let i = 0; i < rows.length && posted < 5; i++) {
    if (rows[i][5]?.startsWith('YES')) continue;

    try {
      // 1. Navigate to mobile home
      await page.goto('https://mobile.twitter.com/home', {
        waitUntil: 'networkidle2',
      });

      // 2. Click the mobile "Tweet" button
      await page.waitForSelector('a[aria-label="Tweet"]', { timeout: 20000 });
      const tweetBtn = await page.$('a[aria-label="Tweet"]');
      await tweetBtn.click();

      // 3. Wait for the mobile textarea
      await page.waitForSelector('div[role="textbox"]', { timeout: 20000 });
      const box = await page.$('div[role="textbox"]');

      // 4. Type and post
      await box.type(rows[i][4]);
      await page.click('div[data-testid="tweetButton"]');
      await page.waitForTimeout(3000);

      await markPosted(i);
      posted++;
    } catch (err) {
      console.error(`Tweet failed on row ${i + 2}:`, err);
    }
  }

  await browser.close();
  // Give Chromium time to release locks (though we wipe each run)
  await new Promise((r) => setTimeout(r, 1000));
  console.log('Done, posted', posted);
})().catch((err) => {
  console.error('Fatal error:', err);
  process.exit(1);
});
// ======================= end index.js =========================
