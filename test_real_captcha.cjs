const http = require('http');

http.get('http://localhost:3000/api/proxy?proxy_path=v2/captcha?t=123', res => {
  const cookies = res.headers['set-cookie'] || [];
  let cookieStr = cookies.map(c => c.split(';')[0]).join('; ');
  
  const req = http.request({
    host: 'localhost',
    port: 3000,
    path: '/api/proxy?proxy_path=v2/getres',
    method: 'POST',
    headers: {
      'Content-Type': 'application/x-www-form-urlencoded',
      'X-Cookie': cookieStr
    }
  }, res2 => {
    let body = '';
    res2.on('data', d => body += d);
    res2.on('end', () => console.log('Response:', body));
  });
  req.write('result_type=1&exam=hsc&year=2023&board=dhaka&roll=123456&reg=1234567890&captcha=wrongcaptcha');
  req.end();
});
