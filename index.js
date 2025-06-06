// --------------------------- index.js -------------------------------------
import puppeteer from 'puppeteer-core';
import { google } from 'googleapis';
import { JWT } from 'google-auth-library';

/* ───────── Google Sheets auth ───────── */
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
    range: 'Sheet1!A2:F',
  });
  return res.data.values ?? [];
}
async function markPosted(rowIdx) {
  await sheets.spreadsheets.values.update({
    spreadsheetId: process.env.SHEET_ID,
    range: `Sheet1!F${rowIdx + 2}`,
    valueInputOption: 'RAW',
    requestBody: { values: [[`YES ${new Date().toISOString().slice(0, 10)}`]] },
  });
}

/* ───────── Tweet routine ───────── */
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

  /* ---- Insert cookies ---- */
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
  if (process.env.CT0?.trim()) {
    cookies.push({
      name: 'ct0',
      value: process.env.CT0.trim(),
      domain: '.twitter.com',
      path: '/',
      httpOnly: true,
      secure: true,
    });
  }
  if (process.env.TWID?.trim()) {
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

  /* ---- Step 1: go to Home ---- */
  await page.goto('https://twitter.com/home', { waitUntil: 'networkidle2' });

  /* ---- DEBUG: where are we? ---- */
  await page.waitForTimeout(5000); // let redirects finish
  console.log('DEBUG current URL:', page.url());
  console.log('DEBUG page title:', await page.title());

  /* ---- Step 2: click Post/New Tweet button ---- */
  await page.waitForSelector(
    'a[aria-label="Post"], div[data-testid="SideNav_NewTweet_Button"], div[data-testid="AppTabBar_NewTweet_Button"]',
    { timeout: 30000 }
  );
  const postBtn =
    (await page.$('a[aria-label="Post"]')) ||
    (await page.$('div[data-testid="SideNav_NewTweet_Button"]')) ||
    (await page.$('div[data-testid="AppTabBar_NewTweet_Button"]'));
  await postBtn.click();

  /* ---- Step 3: wait for textarea ---- */
  await page.waitForSelector(
    'div[role="textbox"], div[data-testid="tweetTextarea_0"], textarea',
    { timeout: 60000 }
  );
  const box =
    (await page.$('div[role="textbox"]')) ||
    (await page.$('div[data-testid="tweetTextarea_0"]')) ||
    (await page.$('textarea'));

  /* ---- Step 4: type & send ---- */
  await box.type(text);
  await page.click('div[data-testid="tweetButtonInline"]');
  await page.waitForTimeout(4000);

  /* ---- Screenshot to logs ---- */
  try {
    const buf = await page.screenshot({ type: 'png', fullPage: true });
    console.log('SCREENSHOT_BASE64_START');
    console.log(buf.toString('base64'));
    console.log('SCREENSHOT_BASE64_END');
  } catch (e) {
    console.warn('Screenshot failed', e);
  }

  await browser.close();
}

/* ───────── Main loop ───────── */
(async () => {
  const rows = await getRows();
  let posted = 0;

  for (let i = 0; i < rows.length && posted < 5; i++) {
    const row = rows[i];
    if (row[5]?.startsWith('YES')) continue;
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
// ------------------------- end index.js -----------------------------------
