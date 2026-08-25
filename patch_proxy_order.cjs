const fs = require('fs');
let code = fs.readFileSync('api/proxy.ts', 'utf-8');

// The UPSTREAM_CONFIGS array starts with eboardresults_https. Let's reorder them.
// We can just find the eboard_gov object and move it to the front.

code = code.replace(
  /const UPSTREAM_CONFIGS: UpstreamConfig\[\] = \[\s*\{\s*key: 'eboardresults_https'([\s\S]*?)\];/m,
  `const UPSTREAM_CONFIGS: UpstreamConfig[] = [
  {
    key: 'eboard_gov',
    baseUrl: 'https://www.educationboardresults.gov.bd',
    origin: 'https://www.educationboardresults.gov.bd',
    referer: 'https://www.educationboardresults.gov.bd/v2/home',
    buildPath: (p) => (!p.startsWith('/v2') && !p.startsWith('/app') ? '/v2' + (p.startsWith('/') ? p : '/' + p) : p)
  },
  {
    key: 'eboardresults_https',
    baseUrl: 'https://eboardresults.com',
    origin: 'https://eboardresults.com',
    referer: 'https://eboardresults.com/v2/home',
    buildPath: (p) => (p.startsWith('/') ? p : '/' + p)
  },
  {
    key: 'eboardresults_http',
    baseUrl: 'http://eboardresults.com',
    origin: 'http://eboardresults.com',
    referer: 'http://eboardresults.com/v2/home',
    buildPath: (p) => (p.startsWith('/') ? p : '/' + p)
  }
];`
);

fs.writeFileSync('api/proxy.ts', code);
console.log('reordered');
