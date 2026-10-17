// "New task": polls for new confirmed open tasks (Zapier de-duplicates by id).
const { url, check } = require('../lib');

module.exports = {
  key: 'new_task',
  noun: 'Task',
  display: { label: 'New Task', description: 'Triggers when a new confirmed task appears in your recordings.' },
  operation: {
    inputFields: [{ key: 'project_id', label: 'Project', dynamic: 'project.id.name', required: false, helpText: 'Only tasks from this project.' }],
    perform: async (z, bundle) => {
      const r = check(await z.request({ url: url('/tasks'), params: { status: 'open', limit: 50, ...(bundle.inputData.project_id ? { project_id: bundle.inputData.project_id } : {}) } }));
      return r.json.data || [];
    },
    sample: { id: '20000000-0000-0000-0000-000000000001', text: 'Send RFI 14 to the architect', owner: 'Maya', due: 'Friday', status: 'open', needs_review: false, recording_id: '10000000-0000-0000-0000-000000000001', recording: 'OAC #12', quote: "Maya, can you send RFI 14 by Friday?" },
  },
};
