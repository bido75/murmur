const { url } = require('./lib');

module.exports = {
  type: 'custom',
  fields: [
    {
      key: 'api_token',
      label: 'Personal API token',
      required: true,
      type: 'password',
      helpText: 'In Murmur, open Settings → Claude, ChatGPT and other AI tools → Create a token. It starts with mur_.',
    },
  ],
  test: async (z) => {
    const r = await z.request({ url: url('/projects') });
    return r.json;
  },
  connectionLabel: 'Murmur',
};
