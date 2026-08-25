import { proxyToEboard } from '../_proxy';

export const onRequest: PagesFunction = async (context) => {
  const url = new URL(context.request.url);
  const proxyPath = url.searchParams.get('proxy_path');
  let target = '';
  if (proxyPath) {
    target = '/' + proxyPath;
    const searchParams = new URLSearchParams(url.searchParams);
    searchParams.delete('proxy_path');
    const qs = searchParams.toString();
    if (qs) target += '?' + qs;
  } else {
    target = url.pathname.replace('/api/proxy', '') + url.search;
  }
  return proxyToEboard(context.request, target || '/');
};
