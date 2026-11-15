const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const vm = require('node:vm');

const appSource = fs.readFileSync(path.join(__dirname, '..', 'app.js'), 'utf8');
const sandbox = {
    document: { addEventListener() {} },
    window: {},
    console
};

vm.createContext(sandbox);
vm.runInContext(`${appSource}
globalThis.taskPermissionTests = {
    setCurrentUser(profile) { currentUser = profile; },
    getVisibleTasks,
    getTaskAssignees,
    getTaskStatus,
    getNextTaskStatus,
    setTaskStatus
};`, sandbox);

const policy = sandbox.taskPermissionTests;

test('users see only their own and assigned tasks; Sargento sees all', () => {
    const tasks = [
        { id: 1, creator: 'maria', assignees: ['maria'] },
        { id: 2, creator: 'sargento', assignees: ['maria'] },
        { id: 3, creator: 'sargento', assignees: ['guapito'] },
        { id: 4, creator: 'guapito', assignees: ['guapito'] },
        { id: 5, creator: 'sargento', assignees: ['sargento'] },
        { id: 6, creator: 'super_usuario', status: 'pending' }
    ];

    policy.setCurrentUser('maria');
    assert.deepEqual(policy.getVisibleTasks(tasks).map(task => task.id), [1, 2, 6]);
    policy.setCurrentUser('guapito');
    assert.deepEqual(policy.getVisibleTasks(tasks).map(task => task.id), [3, 4]);
    policy.setCurrentUser('sargento');
    assert.equal(policy.getVisibleTasks(tasks).length, tasks.length);
});

test('legacy administrator tasks without recipients remain assigned to Maria', () => {
    assert.deepEqual(Array.from(policy.getTaskAssignees({ creator: 'super_usuario' })), ['maria']);
});

test('each assignee has an independent status and only Sargento can confirm assigned tasks', () => {
    const task = {
        creator: 'sargento',
        assignees: ['maria', 'guapito'],
        assigneeStatuses: { maria: 'pending', guapito: 'pending' }
    };

    policy.setCurrentUser('maria');
    assert.equal(policy.getNextTaskStatus(task, 'maria'), 'done');
    policy.setTaskStatus(task, 'maria', 'done');
    assert.equal(policy.getTaskStatus(task, 'maria'), 'done');
    assert.equal(policy.getTaskStatus(task, 'guapito'), 'pending');
    assert.equal(policy.getNextTaskStatus(task, 'maria'), 'pending');
    assert.equal(policy.getNextTaskStatus(task, 'maria', 'sargento'), 'completed');
});

test('a personal task can be completed by its creator without Sargento confirmation', () => {
    const task = {
        creator: 'guapito',
        assignees: ['guapito'],
        assigneeStatuses: { guapito: 'pending' }
    };

    policy.setCurrentUser('guapito');
    assert.equal(policy.getNextTaskStatus(task, 'guapito'), 'completed');
});
