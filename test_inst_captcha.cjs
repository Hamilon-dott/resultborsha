const http = require('http');

http.get('http://localhost:3000/api/proxy?proxy_path=v2/captcha?t=123', res => {
  const cookies = res.headers['set-cookie'] || [];
  let cookieStr = cookies.map(c => c.split(';')[0]).join('; ');
  console.log('Got cookie:', cookieStr);
  
  // wait for captcha to be saved... wait, it's an image. We can't solve it automatically.
  // Wait, I can't read the captcha text here easily. 
});
