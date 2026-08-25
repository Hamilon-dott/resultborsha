const express = require('express');
const app = express();

app.get('/test', (req, res) => {
  const buf = Buffer.from([0xFF, 0xD8, 0xFF, 0xE0, 0x00, 0x10, 0x4A, 0x46, 0x49, 0x46]);
  res.setHeader('Content-Type', 'image/jpeg');
  res.setHeader('Set-Cookie', ['a=1; Path=/', 'b=2; Path=/']);
  res.status(200);
  res.send(buf);
});

const server = app.listen(3456, async () => {
  const resp = await fetch('http://localhost:3456/test');
  console.log('Status:', resp.status);
  console.log('Content-Type:', resp.headers.get('content-type'));
  console.log('Cookies:', resp.headers.get('set-cookie'));
  const blob = await resp.blob();
  console.log('Blob size:', blob.size, 'type:', blob.type);
  server.close();
});
