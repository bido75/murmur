const { url, check } = require('../lib');

module.exports = {
  key: 'complete_task',
  noun: 'Task',
  display: { label: 'Complete Task', description: 'Marks a Murmur task as done (or reopens it).' },
  operation: {
    inputFields: [
      { key: 'task_id', label: 'Task ID', required: true, helpText: 'From the New Task trigger.' },
      { key: 'status', label: 'Status', choices: { done: 'Done', open: 'Open' }, default: 'done', required: true },
    ],
    perform: async (z, bundle) =>
      check(await z.request({ url: url(`/tasks/${bundle.inputData.task_id}`), method: 'PATCH', body: { status: bundle.inputData.status || 'done' } })).json,
    sample: { id: '20000000-0000-0000-0000-000000000001', status: 'done' },
  },
};
