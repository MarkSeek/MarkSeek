// isomorphic-git HTTP client backed by undici.
//
// Why not 'isomorphic-git/http/node'? That client uses Node's raw http/https
// modules, which bypass undici's global dispatcher. Git push/pull traffic
// would therefore ignore the proxy configured in Settings -> Network, while
// AI and every other outbound request honors it. undici's request() always
// goes through the global dispatcher, so git traffic automatically follows
// the same unified network settings (direct / system / custom proxy).
//
// Implements the isomorphic-git HTTP contract:
//   request({ url, method, headers, body, agent, signal }) -> {
//     url, method, headers, body (async iterable), statusCode, statusMessage }

import { request as undiciRequest } from 'undici'

async function request({ url, method = 'GET', headers = {}, body, signal }) {
  const res = await undiciRequest(url, {
    method,
    headers,
    body: body ?? undefined,
    signal,
    // Push/pull of large repositories can legitimately take a long time;
    // disable undici's idle timeouts for git operations.
    headersTimeout: 0,
    bodyTimeout: 0,
  })

  // undici returns a plain lowercase-keyed headers object; isomorphic-git's
  // core expects plain-object access such as headers['content-type'].
  return {
    url,
    method,
    headers: res.headers,
    body: res.body, // async iterable of Buffers
    statusCode: res.statusCode,
    statusMessage: '',
  }
}

export default { request }
