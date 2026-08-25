const fs = require('fs');
let code = fs.readFileSync('api/proxy.ts', 'utf-8');

code = code.replace(/const timeoutId = setTimeout\(\(\) => controller\.abort\(\), \d+\);/g, 'const timeoutId = setTimeout(() => controller.abort(), 2500);');
code = code.replace(/res\.end\(Buffer\.from\(arrayBuffer\)\);/g, 'res.send(Buffer.from(arrayBuffer));');

fs.writeFileSync('api/proxy.ts', code);
console.log('patched');
