// ───────────────────── index.js (single-browser, lock-safe) ──────────────────
import { addExtra } from 'puppeteer-extra';
import Stealth from 'puppeteer-extra-plugin-stealth';
import puppeteerCore from 'puppeteer-core';
import { google } from 'googleapis';
import { JWT } from 'google-auth-library';
import fs from 'fs';
import path from 'path';

// ── Puppeteer with stealth
const puppeteer = addExtra(puppeteerCore);
puppeteer.use(Stealth());

// ── Constants
const PROFILE_DIR = '/railway/worker-data';
const SHEET_RANGE = 'Sheet1!A2:F';

// ── Google Sheets auth
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

/* ── Clean up any stale lock files ───────────────────────── */
function clearProfileLocks() {
  const files = ['SingletonLock', 'SingletonSocket'];
  for (const f of files) {
    const p = path.join(PROFILE_DIR, f);
    if (fs.existsSync(p)) {
      try { fs.rmSync(p); }
      catch (_) { /* ignore */ }
    }
  }
}

/* ── Main runner ─────────────────────────────────────────── */
(async () => {
  /* 1. Remove stale locks then launch ONE browser */
  clearProfileLocks();
  const browser = await puppeteer.launch({
    headless: true,
    userDataDir: PROFILE_DIR,
    executablePath: process.env.PUPPETEER_EXECUTABLE_PATH || '/usr/bin/chromium',
    args: [
      '--no-sandbox',
      '--disable-setuid-sandbox',
      '--disable-blink-features=AutomationControlled',
      '--user-agent=Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/123 Safari/537.36',
    ],
  });
  const page = await browser.newPage();

  /* 2. First-run cookie injection (only if not already logged in) */
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
      if (process.env.CT0?.trim()) base.push({
        name: 'ct0',
        value: process.env.CT0.trim(),
        domain: '.twitter.com',
        path: '/',
        httpOnly: true,
        secure: true,
      });
      if (process.env.TWID?.trim()) base.push({
        name: 'twid',
        value: process.env.TWID.trim(),
        domain: '.twitter.com',
        path: '/',
        httpOnly: true,
        secure: true,
      });
      await page.setCookie(...base);
    }
  }

  /* 3. Fetch rows once */
  const rows = await getRows();
  let posted = 0;

  for (let i = 0; i < rows.length && posted < 5; i++) {
    if (rows[i][5]?.startsWith('YES')) continue;

    try {
      /* a. Go Home */
      await page.goto('https://twitter.com/home', { waitUntil: 'networkidle2' });

      /* b. Click New-Tweet button */
      await page.waitForSelector(
        'a[aria-label="Post"], div[data-testid="SideNav_NewTweet_Button"], div[data-testid="AppTabBar_NewTweet_Button"]',
        { timeout: 40000 }
      );
      const postBtn =
        (await page.$('a[aria-label="Post"]')) ||
        (await page.$('div[data-testid="SideNav_NewTweet_Button"]')) ||
        (await page.$('div[data-testid="AppTabBar_NewTweet_Button"]'));
      await postBtn.click();

      /* c. Wait textarea */
      await page.waitForSelector(
        'div[role="textbox"], div[data-testid="tweetTextarea_0"], textarea',
        { timeout: 60000 }
      );
      const box =
        (await page.$('div[role="textbox"]')) ||
        (await page.$('div[data-testid="tweetTextarea_0"]')) ||
        (await page.$('textarea'));
      await box.type(rows[i][4]);
      await page.click('div[data-testid="tweetButtonInline"]');
      await page.waitForTimeout(3000);

      await markPosted(i);
      posted++;
    } catch (err) {
      console.error('Tweet failed for row', i + 2, err);
    }
  }

  await browser.close();
  // small delay so Chromium fully exits before container stops
  await new Promise(r => setTimeout(r, 2000));
  console.log('Done, posted', posted);
})();
```

### Why this solves the “SingletonLock” crash

* **One browser instance** is shared for all tweets (no overlap).  
* If a previous run crashed, **`clearProfileLocks()`** removes leftover lock files before launching.  
* After `browser.close()` we wait 2 s to let Chrome finish shutting down.

### What to do

1. Replace your current `index.js` with the code above and commit.  
2. Rebuild (Railway auto) and **Redeploy latest**.  
3. Check logs—there should be **no** “ProcessSingleton” errors, and tweets should post.  

If any new message appears, copy the first red block here and we’ll adjust, but this pattern is stable on Railway for long-running Puppeteer bots.

// ------------------------- end index.js -----------------------------------
