const http = require('http');

const req = http.request({
  host: 'localhost',
  port: 3000,
  path: '/api/proxy?proxy_path=v2/getres',
  method: 'POST',
  headers: {
    'Content-Type': 'application/x-www-form-urlencoded'
  }
}, res => {
  let body = '';
  res.on('data', d => body += d);
  res.on('end', () => console.log(body));
});
req.write('result_type=1&exam=hsc&year=2023&board=dhaka&roll=123456&reg=1234567890&captcha=wrongcaptcha');
req.end();
