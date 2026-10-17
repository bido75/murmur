// Hidden: fills the Project dropdown.
const { url, check } = require('../lib');

module.exports = {
  key: 'project',
  noun: 'Project',
  display: { label: 'Project', description: 'Lists your projects.', hidden: true },
  operation: {
    perform: async (z) => check(await z.request({ url: url('/projects') })).json.data || [],
    sample: { id: '30000000-0000-0000-0000-000000000001', name: 'Riverside Lofts', team: 'Acme Builders' },
  },
};
