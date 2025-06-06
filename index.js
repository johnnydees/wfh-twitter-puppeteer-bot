import { addExtra } from 'puppeteer-extra';
import Stealth from 'puppeteer-extra-plugin-stealth';
import puppeteerCore from 'puppeteer-core';
import { google } from 'googleapis';
import { JWT } from 'google-auth-library';

// ── puppeteer with stealth ──
const puppeteer = addExtra(puppeteerCore);
puppeteer.use(Stealth());

// ── Google Sheets auth ──
const creds = JSON.parse(process.env.GSHEET_KEY);
const jwt = new JWT({
  email: creds.client_email,
  key: creds.private_key,
  scopes: ['https://www.googleapis.com/auth/spreadsheets'],
});
const sheets = google.sheets({ version: 'v4', auth: jwt });

const SHEET_RANGE = 'Sheet1!A2:F';
const USER_DATA_DIR = '/railway/worker-data';          // persists cookies!

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

async function tweet(text) {
  const browser = await puppeteer.launch({
    headless: true,
    executablePath: process.env.PUPPETEER_EXECUTABLE_PATH || '/usr/bin/chromium',
    userDataDir: USER_DATA_DIR,            // <-- key line: keeps session files
    args: [
      '--no-sandbox',
      '--disable-setuid-sandbox',
      '--disable-blink-features=AutomationControlled',
      '--user-agent=Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/123 Safari/537.36',
    ],
  });

  const page = await browser.newPage();

  // first run only: inject cookies if provided (they'll persist afterwards)
  if (process.env.AUTH_COOKIE && !(await page.cookies()).some(c => c.name === 'auth_token')) {
    const baseCookies = [
      { name: 'auth_token', value: process.env.AUTH_COOKIE, domain: '.twitter.com', path: '/', httpOnly: true, secure: true },
    ];
    if (process.env.CT0?.trim()) baseCookies.push({ name: 'ct0', value: process.env.CT0.trim(), domain: '.twitter.com', path: '/', httpOnly: true, secure: true });
    if (process.env.TWID?.trim()) baseCookies.push({ name: 'twid', value: process.env.TWID.trim(), domain: '.twitter.com', path: '/', httpOnly: true, secure: true });
    await page.setCookie(...baseCookies);
  }

  /* 1. Home */
  await page.goto('https://twitter.com/home', { waitUntil: 'networkidle2' });

  /* 2. Click New-Tweet button */
  await page.waitForSelector(
    'a[aria-label="Post"], div[data-testid="SideNav_NewTweet_Button"], div[data-testid="AppTabBar_NewTweet_Button"]',
    { timeout: 40000 }
  );
  const postBtn =
    (await page.$('a[aria-label="Post"]')) ||
    (await page.$('div[data-testid="SideNav_NewTweet_Button"]')) ||
    (await page.$('div[data-testid="AppTabBar_NewTweet_Button"]'));
  await postBtn.click();

  /* 3. Wait for textarea */
  await page.waitForSelector(
    'div[role="textbox"], div[data-testid="tweetTextarea_0"], textarea',
    { timeout: 60000 }
  );
  const box =
    (await page.$('div[role="textbox"]')) ||
    (await page.$('div[data-testid="tweetTextarea_0"]')) ||
    (await page.$('textarea'));

  /* 4. Type & send */
  await box.type(text);
  await page.click('div[data-testid="tweetButtonInline"]');
  await page.waitForTimeout(4000);

  await browser.close();
}

(async () => {
  const rows = await getRows();
  let posted = 0;
  for (let i = 0; i < rows.length && posted < 5; i++) {
    if (rows[i][5]?.startsWith('YES')) continue;
    try {
      await tweet(rows[i][4]);
      await markPosted(i);
      posted++;
    } catch (e) {
      console.error('Tweet failed:', e);
    }
  }
  console.log('Done, posted', posted);
})();
// ------------------------- end index.js -----------------------------------
