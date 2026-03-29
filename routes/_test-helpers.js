const request = require('supertest');

// Extract all Set-Cookie values as "name=value" pairs joined with "; "
function extractCookies(res) {
  return (res.headers['set-cookie'] || []).map(c => c.split(';')[0]).join('; ');
}

// Merge multiple cookie strings, later values override earlier ones
function mergeCookies(...cookieStrings) {
  const map = {};
  for (const cs of cookieStrings) {
    for (const part of cs.split('; ')) {
      if (!part) continue;
      const eq = part.indexOf('=');
      if (eq < 0) continue;
      const name = part.substring(0, eq);
      map[name] = part;
    }
  }
  return Object.values(map).join('; ');
}

// Extract a specific cookie value from a cookie string
function getCookieValue(cookieStr, name) {
  const match = cookieStr.match(new RegExp('(?:^|; )' + name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + '=([^;]*)'));
  return match ? match[1] : '';
}

// Creates an admin session and returns helpers for making authenticated requests
async function createAdminSession(app) {
  // First GET to get CSRF cookie (before login, since login is POST to /auth/ not /api/)
  const initRes = await request(app).get('/api/config');
  const initCookies = extractCookies(initRes);
  const csrfToken = getCookieValue(initCookies, 'csrf-token');

  // Login as admin, forwarding the csrf cookie
  const loginRes = await request(app).post('/auth/dev-login').set('Cookie', initCookies);
  const loginCookies = extractCookies(loginRes);

  // Merge: session cookie from login + csrf cookie from init
  const cookies = mergeCookies(initCookies, loginCookies);

  function post(url) {
    return request(app).post(url).set('Cookie', cookies).set('X-CSRF-Token', csrfToken);
  }
  function patch(url) {
    return request(app).patch(url).set('Cookie', cookies).set('X-CSRF-Token', csrfToken);
  }
  function del(url) {
    return request(app).delete(url).set('Cookie', cookies).set('X-CSRF-Token', csrfToken);
  }
  function get(url) {
    return request(app).get(url).set('Cookie', cookies);
  }

  return { post, patch, del, get, cookies, csrfToken };
}

// Creates a visitor session (no admin) with CSRF token
async function createVisitorSession(app) {
  const configRes = await request(app).get('/api/config');
  const cookies = extractCookies(configRes);
  const csrfToken = getCookieValue(cookies, 'csrf-token');

  function post(url) {
    return request(app).post(url).set('Cookie', cookies).set('X-CSRF-Token', csrfToken);
  }
  function del(url) {
    return request(app).delete(url).set('Cookie', cookies).set('X-CSRF-Token', csrfToken);
  }

  return { post, del, cookies, csrfToken };
}

module.exports = { extractCookies, mergeCookies, getCookieValue, createAdminSession, createVisitorSession };
