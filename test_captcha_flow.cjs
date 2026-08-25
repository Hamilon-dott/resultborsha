const fs = require('fs');

async function testFlow() {
  const fetch = (await import('node-fetch')).default;

  // 1. Fetch captcha
  console.log("Fetching captcha...");
  const capRes = await fetch("https://www.educationboardresults.gov.bd/v2/captcha?t=" + Date.now(), {
    headers: {
      'user-agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/133.0.0.0 Safari/537.36',
      'accept': 'image/avif,image/webp,image/apng,image/svg+xml,image/*,*/*;q=0.8',
      'referer': 'https://www.educationboardresults.gov.bd/v2/home',
      'host': 'www.educationboardresults.gov.bd'
    }
  });

  const rawSetCookie = capRes.headers.raw()['set-cookie'] || [];
  console.log("Captcha status:", capRes.status);
  console.log("Captcha set-cookie:", rawSetCookie);

  const imgBuf = await capRes.buffer();
  fs.writeFileSync('captcha_test.jpg', imgBuf);
  console.log("Saved captcha_test.jpg, length:", imgBuf.length);
}

testFlow();
