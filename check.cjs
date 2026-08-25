const https = require('https');
https.get('https://educationboardresults.gov.bd/v2/captcha', (res) => {
  console.log(res.statusCode);
}).on('error', (e) => {
  console.error(e);
});
