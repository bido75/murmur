const authentication = require('./authentication');
const { addAuth } = require('./lib');
// eslint-disable-next-line no-unused-vars
const { toItem, ...recording } = require('./triggers/recording');
const task = require('./triggers/task');
const project = require('./triggers/project');
const findRecording = require('./searches/recording');
const completeTask = require('./creates/complete_task');

module.exports = {
  version: require('./package.json').version,
  platformVersion: require('zapier-platform-core').version,
  authentication,
  beforeRequest: [addAuth],
  triggers: { [recording.key]: recording, [task.key]: task, [project.key]: project },
  searches: { [findRecording.key]: findRecording },
  creates: { [completeTask.key]: completeTask },
};
