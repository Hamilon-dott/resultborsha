const urlObj = new URL('/api/proxy?proxy_path=v2/captcha&t=123', 'http://localhost');
console.log(urlObj.searchParams.get('proxy_path'));
