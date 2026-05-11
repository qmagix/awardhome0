const puppeteer = require('puppeteer');

async function intercept() {
  const browser = await puppeteer.launch({ headless: 'new' });
  const page = await browser.newPage();

  // Intercept network requests
  page.on('request', request => {
    if (request.resourceType() === 'xhr' || request.resourceType() === 'fetch') {
      console.log('--- AJAX REQUEST ---');
      console.log('URL:', request.url());
      console.log('Method:', request.method());
      console.log('PostData:', request.postData());
    }
  });

  console.log("Navigating to page...");
  await page.goto('https://www.starbound.net/regional-winners/', { waitUntil: 'networkidle2' });

  console.log("Changing dropdown...");
  // Assuming the dropdown is #filter__year or a select element. Let's try to find a select element.
  const selectExists = await page.$('select');
  if (selectExists) {
    await page.select('select', '2023'); // Try selecting 2023
    await new Promise(r => setTimeout(r, 3000));
  } else {
    console.log("No select element found. Dumping HTML of body...");
    // maybe it's not a standard select
  }

  await browser.close();
}

intercept();
