const fs = require('fs');
let code = fs.readFileSync('index.html', 'utf-8');

code = code.replace(/const timeoutId = setTimeout\(\(\) => controller\.abort\(\), \d+\);/g, 'const timeoutId = setTimeout(() => controller.abort(), 9500);');

fs.writeFileSync('index.html', code);
console.log('patched index.html');
