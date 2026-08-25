const rawPath1 = '/api/proxy?proxy_path=v2/captcha&t=1724601449439&result_type=1';
let rawPath = rawPath1;
let targetPath = 'v2/captcha';

if (targetPath) {
  const urlObj = new URL(rawPath, 'http://localhost');
  urlObj.searchParams.delete('proxy_path');
  const [pathOnly, existingQuery] = targetPath.split('?');
  if (existingQuery) {
    const extraParams = new URLSearchParams(existingQuery);
    extraParams.forEach((v, k) => urlObj.searchParams.set(k, v));
  }
  const finalQuery = urlObj.searchParams.toString();
  rawPath = '/' + pathOnly.replace(/^\/+/, '') + (finalQuery ? '?' + finalQuery : '');
}
console.log("Result:", rawPath);
