// Shared bits: the API base (one per Murmur deployment) and request helpers.
const BASE = process.env.MURMUR_API_BASE || 'https://YOUR-PROJECT.supabase.co/functions/v1/api/v1';

const url = (path) => `${BASE}${path}`;

/** Every request carries the personal API token the user pasted when connecting. */
const addAuth = (request, z, bundle) => {
  request.headers = request.headers || {};
  request.headers.Authorization = `Bearer ${bundle.authData.api_token}`;
  return request;
};

const check = (response) => {
  if (response.status === 401) throw new Error('Murmur rejected the token. Make a new one in Murmur → Settings → Claude, ChatGPT and other AI tools.');
  if (response.status >= 400) throw new Error((response.json && response.json.error) || `Murmur returned ${response.status}`);
  return response;
};

module.exports = { BASE, url, addAuth, check };
