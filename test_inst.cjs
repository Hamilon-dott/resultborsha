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
  res.on('end', () => console.log(body.substring(0, 500)));
});
req.write('result_type=2&exam=hsc&year=2023&board=dhaka&eiin=108161');
req.end();
