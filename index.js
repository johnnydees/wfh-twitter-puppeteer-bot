// ───────────────────── index.js ─────────────────────
import { addExtra } from 'puppeteer-extra';
import Stealth from 'puppeteer-extra-plugin-stealth';
import puppeteerCore from 'puppeteer-core';
import { google } from 'googleapis';
import { JWT } from 'google-auth-library';
import fs from 'fs';
import path from 'path';

// ----- puppeteer with stealth -----
const puppeteer = addExtra(puppeteerCore);
puppeteer.use(Stealth());

// ----- constants -----
const PROFILE_DIR = '/railway/worker-data'; // persists cookies/profile
const SHEET_RANGE = 'Sheet1!A2:F';

// ----- Google Sheets auth -----
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

// ----- remove stale lock files if previous run crashed -----
function clearProfileLocks() {
  const lockFiles = ['SingletonLock', 'SingletonSocket'];
  for (const file of lockFiles) {
    const full = path.join(PROFILE_DIR, file);
    if (fs.existsSync(full)) {
      try {
        fs.rmSync(full);
      } catch (_) {
        /* ignore */
      }
    }
  }
}

async function main() {
  clearProfileLocks(); // ensure profile dir is usable

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

  // Inject cookies only the first time (subsequent runs reuse profile)
  if (process.env.AUTH_COOKIE) {
    const hasAuth = (await page.cookies()).some(c => c.name === 'auth_token');
    if (!hasAuth) {
      const baseCookies = [
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
        baseCookies.push({
          name: 'ct0',
          value: process.env.CT0.trim(),
          domain: '.twitter.com',
          path: '/',
          httpOnly: true,
          secure: true,
        });
      }
      if (process.env.TWID?.trim()) {
        baseCookies.push({
          name: 'twid',
          value: process.env.TWID.trim(),
          domain: '.twitter.com',
          path: '/',
          httpOnly: true,
          secure: true,
        });
      }
      await page.setCookie(...baseCookies);
    }
  }

  const rows = await getRows();
  let posted = 0;

  for (let i = 0; i < rows.length && posted < 5; i++) {
    if (rows[i][5]?.startsWith('YES')) continue;
    try {
      // 1. open home
      await page.goto('https://twitter.com/home', { waitUntil: 'networkidle2' });

      // 2. click “Post / New Tweet” button
      await page.waitForSelector(
        'a[aria-label="Post"], div[data-testid="SideNav_NewTweet_Button"], div[data-testid="AppTabBar_NewTweet_Button"]',
        { timeout: 40000 }
      );
      const postBtn =
        (await page.$('a[aria-label="Post"]')) ||
        (await page.$('div[data-testid="SideNav_NewTweet_Button"]')) ||
        (await page.$('div[data-testid="AppTabBar_NewTweet_Button"]'));
      await postBtn.click();

      // 3. wait for textarea
      await page.waitForSelector(
        'div[role="textbox"], div[data-testid="tweetTextarea_0"], textarea',
        { timeout: 60000 }
      );
      const box =
        (await page.$('div[role="textbox"]')) ||
        (await page.$('div[data-testid="tweetTextarea_0"]')) ||
        (await page.$('textarea'));
      await box.type(rows[i][4]);

      // 4. send
      await page.click('div[data-testid="tweetButtonInline"]');
      await page.waitForTimeout(3000);

      await markPosted(i);
      posted++;
    } catch (err) {
      console.error('Tweet failed on row', i + 2, err);
    }
  }

  await browser.close();
  // give Chromium time to release file locks
  await new Promise(r => setTimeout(r, 2000));
  console.log('Done, posted', posted);
}

main().catch(err => {
  console.error('Fatal error:', err);
  process.exit(1);
});
```

**What changed**

* Converted all stray bullet lines to `//` comments (or removed).  
* Defined `clearProfileLocks()` **before** it’s first used.  
* Wrapped the logic in an async `main()` for cleaner top-level error handling—ESM safe.  

Commit this file → Railway rebuilds → redeploy.  
There should be no more syntax errors, and the browser “SingletonLock” problem is prevented because we launch only once per run and clear stale locks before launching.

Let me know how the logs look after this run!

