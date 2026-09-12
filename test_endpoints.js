async function checkEndpoint(url) {
  try {
    const res = await fetch(url, { headers: { 'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64)' }, timeout: 10000 });
    const buffer = await res.arrayBuffer();
    return { url, status: res.status, contentType: res.headers.get('content-type'), size: buffer.byteLength };
  } catch (err) {
    return { url, error: err.message };
  }
}

async function run() {
  console.log(await checkEndpoint('https://result.bangladeshgov.org/captcha'));
  console.log(await checkEndpoint('https://eboardresults.com/v2/captcha'));
  console.log(await checkEndpoint('https://www.educationboardresults.gov.bd/v2/captcha'));
  console.log(await checkEndpoint('http://eboardresults.com/v2/captcha'));
}
run();
