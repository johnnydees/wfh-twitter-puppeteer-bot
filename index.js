import { addExtra } from 'puppeteer-extra';
import Stealth from 'puppeteer-extra-plugin-stealth';
import puppeteerCore from 'puppeteer-core';
import { google } from 'googleapis';
import { JWT } from 'google-auth-library';
import fs from 'fs';
import path from 'path';

const puppeteer = addExtra(puppeteerCore);
puppeteer.use(Stealth());

const PROFILE_DIR = '/railway/worker-data';
const SHEET_RANGE = 'Sheet1!A2:F';

// Google Sheets auth
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
async function markPosted(idx) {
  await sheets.spreadsheets.values.update({
    spreadsheetId: process.env.SHEET_ID,
    range: `Sheet1!F${idx + 2}`,
    valueInputOption: 'RAW',
    requestBody: {
      values: [[`YES ${new Date().toISOString().slice(0, 10)}`]],
    },
  });
}

// Remove stale lock files
function clearProfileLocks() {
  for (const f of ['SingletonLock', 'SingletonSocket']) {
    const p = path.join(PROFILE_DIR, f);
    if (fs.existsSync(p)) {
      try { fs.rmSync(p); } catch { /* ignore */ }
    }
  }
}

async function main() {
  clearProfileLocks();

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

  // One-time cookie injection
  if (process.env.AUTH_COOKIE) {
    const hasAuth = (await page.cookies()).some(c => c.name === 'auth_token');
    if (!hasAuth) {
      const base = [{
        name: 'auth_token',
        value: process.env.AUTH_COOKIE,
        domain: '.twitter.com',
        path: '/',
        httpOnly: true,
        secure: true,
      }];
      if (process.env.CT0?.trim()) {
        base.push({
          name: 'ct0',
          value: process.env.CT0.trim(),
          domain: '.twitter.com',
          path: '/',
          httpOnly: true,
          secure: true,
        });
      }
      if (process.env.TWID?.trim()) {
        base.push({
          name: 'twid',
          value: process.env.TWID.trim(),
          domain: '.twitter.com',
          path: '/',
          httpOnly: true,
          secure: true,
        });
      }
      await page.setCookie(...base);
    }
  }

  const rows = await getRows();
  let posted = 0;

  for (let i = 0; i < rows.length && posted < 5; i++) {
    if (rows[i][5]?.startsWith('YES')) continue;
    try {
      // 1. Go to mobile home
      await page.goto('https://mobile.twitter.com/home', { waitUntil: 'networkidle2' });

      // 2. Click the “Tweet” (+) button on mobile
      await page.waitForSelector('a[aria-label="Tweet"]', { timeout: 20000 });
      const tweetBtn = await page.$('a[aria-label="Tweet"]');
      await tweetBtn.click();

      // 3. Wait for mobile textarea
      await page.waitForSelector('div[role="textbox"]', { timeout: 20000 });
      const box = await page.$('div[role="textbox"]');

      // 4. Type & post
      await box.type(rows[i][4]);
      await page.click('div[data-testid="tweetButton"]');
      await page.waitForTimeout(3000);

      await markPosted(i);
      posted++;
    } catch (err) {
      console.error('Tweet failed row', i + 2, err);
    }
  }

  await browser.close();
  await new Promise(r => setTimeout(r, 2000));
  console.log('Done, posted', posted);
}

main().catch(err => {
  console.error('Fatal', err);
  process.exit(1);
});

main().catch(err => {
  console.error('Fatal', err);
  process.exit(1);
});
