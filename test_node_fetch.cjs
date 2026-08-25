async function test() {
  const urls = [
    'https://www.educationboardresults.gov.bd/v2/captcha',
    'https://eboardresults.com/v2/captcha',
    'http://eboardresults.com/v2/captcha'
  ];

  for (const u of urls) {
    try {
      console.log('Testing', u);
      const res = await fetch(u, {
        headers: {
          'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/133.0.0.0 Safari/537.36',
          'Accept': 'image/avif,image/webp,image/apng,image/svg+xml,image/*,*/*;q=0.8',
          'Referer': u.includes('gov') ? 'https://www.educationboardresults.gov.bd/v2/home' : 'https://eboardresults.com/v2/home'
        }
      });
      console.log(u, 'Status:', res.status, 'Content-Type:', res.headers.get('content-type'), 'Cookies:', res.headers.get('set-cookie'));
      const buf = await res.arrayBuffer();
      console.log('Buffer size:', buf.byteLength);
    } catch (err) {
      console.error(u, 'FAILED:', err);
    }
  }
}
test();
