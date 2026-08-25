import { proxyToEboard } from '../_proxy';

export const onRequest: PagesFunction = async (context) => {
  const url = new URL(context.request.url);
  return proxyToEboard(context.request, url.pathname + url.search);
};
