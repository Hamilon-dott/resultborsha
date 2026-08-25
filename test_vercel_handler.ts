import handler from './api/proxy.ts';

const req = {
  method: 'GET',
  url: '/api/proxy?proxy_path=v2/captcha&t=1724601449439&result_type=1',
  query: { proxy_path: 'v2/captcha' },
  headers: {}
} as any;

const res = {
  setHeader: (k, v) => console.log('SetHeader:', k, v),
  status: (code) => { console.log('Status:', code); return res; },
  json: (data) => console.log('JSON:', data),
  end: (data) => console.log('End:', data ? data.length : 'empty'),
  send: (data) => console.log('Send:', data ? data.length : 'empty')
} as any;

handler(req, res).then(() => console.log('Done')).catch(console.error);
