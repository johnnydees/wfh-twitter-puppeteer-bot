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
      // 1. Go to Home
      await page.goto('https://twitter.com/home', { waitUntil: 'networkidle2' });

      // Debug: log URL and title
      await page.waitForTimeout(3000);
      console.log('DEBUG current URL:', page.url());
      console.log('DEBUG page title:', await page.title());

      // Debug: screenshot to logs
      try {
        const buf = await page.screenshot({ type: 'png', fullPage: true });
        console.log('SCREENSHOT_BASE64_START');
        console.log(buf.toString('base64'));
        console.log('SCREENSHOT_BASE64_END');
      } catch (e) {
        console.warn('Screenshot failed', e);
      }

      // 2. Attempt to click "New Tweet"
      await page.waitForSelector(
        'a[aria-label="Post"], div[data-testid="SideNav_NewTweet_Button"], div[data-testid="AppTabBar_NewTweet_Button"]',
        { timeout: 20000 }
      );
      const postBtn =
        (await page.$('a[aria-label="Post"]')) ||
        (await page.$('div[data-testid="SideNav_NewTweet_Button"]')) ||
        (await page.$('div[data-testid="AppTabBar_NewTweet_Button"]'));
      await postBtn.click();

      // 3. Wait for textarea
      await page.waitForSelector(
        'div[role="textbox"], div[data-testid="tweetTextarea_0"], textarea',
        { timeout: 20000 }
      );
      const box =
        (await page.$('div[role="textbox"]')) ||
        (await page.$('div[data-testid="tweetTextarea_0"]')) ||
        (await page.$('textarea'));

      // 4. Type & send
      await box.type(rows[i][4]);
      await page.click('div[data-testid="tweetButtonInline"]');
      await page.waitForTimeout(3000);

      await markPosted(i);
      posted++;
    } catch (err) {
      console.error(`Tweet failed row ${i + 2}`, err);
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
