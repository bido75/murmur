const { url, check } = require('../lib');

module.exports = {
  key: 'find_recording',
  noun: 'Recording',
  display: { label: 'Find Recording', description: 'Searches your recordings’ transcripts, titles and notes.' },
  operation: {
    inputFields: [{ key: 'query', label: 'Words to search for', required: true }],
    perform: async (z, bundle) => check(await z.request({ url: url('/search'), params: { q: bundle.inputData.query, limit: 5 } })).json.data || [],
    sample: { id: '10000000-0000-0000-0000-000000000001', title: 'OAC #12', date: '2026-10-15', project: 'Riverside Lofts', status: 'ready', minutes: 30, snippet: '…the firestopping is missing around the conduit…', at_ms: 11000 },
  },
};
