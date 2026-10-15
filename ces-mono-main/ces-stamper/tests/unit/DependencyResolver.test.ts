// SPDX-FileCopyrightText: Blue Heron Defense LLC and its licensors. All rights reserved.
// SPDX-License-Identifier: LicenseRef-BHD-Proprietary
// CONFIDENTIAL - TRADE SECRET. Unpublished work. Provided solely to perform work for Blue Heron Defense LLC at its direction.
// Any other use, copying, disclosure, or reuse, in whole or in part, is prohibited.
// Changes made to this file for Blue Heron Defense LLC are made on its behalf; it claims all rights in them.
// Submitting a change to this repository means you accept TERMS.md.
// Removing or altering this notice is prohibited (17 U.S.C. 1202). Ref: BHD-CES-MONO-2026A
// See LICENSE and TERMS.md.

import { DependencyResolver } from '../../src/core/DependencyResolver';
import { ExeTask } from '../../src/types/schema.types';

describe('DependencyResolver', () => {
  const createTask = (id: string, dependsOn: string[] = []): ExeTask => ({
    id,
    type: 'configuration',
    priority: 'p1',
    depends_on: dependsOn,
    action: {
      engine: 'powershell',
      command: `Task ${id}`,
      args: {}
    },
    inputs: [],
    outputs: [],
    controls: [],
    idempotency: 'safe',
    rollback: { strategy: 'none' }
  });

  describe('validateDependencies', () => {
    it('should validate acyclic dependency graph', () => {
      const tasks = [
        createTask('task-1'),
        createTask('task-2', ['task-1']),
        createTask('task-3', ['task-2'])
      ];

      const resolver = new DependencyResolver(tasks);

      expect(() => resolver.validateDependencies()).not.toThrow();
    });

    it('should detect simple cycles', () => {
      const tasks = [
        createTask('task-1', ['task-2']),
        createTask('task-2', ['task-1'])
      ];

      const resolver = new DependencyResolver(tasks);

      expect(() => resolver.validateDependencies()).toThrow('Circular dependency detected');
    });

    it('should detect complex cycles', () => {
      const tasks = [
        createTask('task-1', ['task-3']),
        createTask('task-2', ['task-1']),
        createTask('task-3', ['task-2'])
      ];

      const resolver = new DependencyResolver(tasks);

      expect(() => resolver.validateDependencies()).toThrow('Circular dependency detected');
    });

    it('should handle self-references by filtering them out', () => {
      const tasks = [
        createTask('task-1', ['task-1']) // Self-reference
      ];

      const resolver = new DependencyResolver(tasks);

      expect(() => resolver.validateDependencies()).not.toThrow();

      // Verify self-reference was removed
      const deps = resolver.getDependencies('task-1');
      expect(deps).toHaveLength(0);
    });
  });

  describe('topoSort', () => {
    it('should sort tasks in topological order', () => {
      const tasks = [
        createTask('task-3', ['task-1', 'task-2']),
        createTask('task-1'),
        createTask('task-2', ['task-1'])
      ];

      const resolver = new DependencyResolver(tasks);
      const sorted = resolver.topoSort(tasks);

      const task1Idx = sorted.findIndex(t => t.id === 'task-1');
      const task2Idx = sorted.findIndex(t => t.id === 'task-2');
      const task3Idx = sorted.findIndex(t => t.id === 'task-3');

      // task-1 should come before task-2
      expect(task1Idx).toBeLessThan(task2Idx);
      // task-2 should come before task-3
      expect(task2Idx).toBeLessThan(task3Idx);
      // task-1 should come before task-3
      expect(task1Idx).toBeLessThan(task3Idx);
    });

    it('should preserve original order for independent tasks', () => {
      const tasks = [
        createTask('task-1'),
        createTask('task-2'),
        createTask('task-3')
      ];

      const resolver = new DependencyResolver(tasks);
      const sorted = resolver.topoSort(tasks);

      // Order should be preserved when no dependencies exist
      expect(sorted[0].id).toBe('task-1');
      expect(sorted[1].id).toBe('task-2');
      expect(sorted[2].id).toBe('task-3');
    });

    it('should handle complex dependency graphs', () => {
      const tasks = [
        createTask('task-5', ['task-3', 'task-4']),
        createTask('task-3', ['task-1']),
        createTask('task-4', ['task-2']),
        createTask('task-1'),
        createTask('task-2')
      ];

      const resolver = new DependencyResolver(tasks);
      const sorted = resolver.topoSort(tasks);

      const getIndex = (id: string) => sorted.findIndex(t => t.id === id);

      expect(getIndex('task-1')).toBeLessThan(getIndex('task-3'));
      expect(getIndex('task-2')).toBeLessThan(getIndex('task-4'));
      expect(getIndex('task-3')).toBeLessThan(getIndex('task-5'));
      expect(getIndex('task-4')).toBeLessThan(getIndex('task-5'));
    });

    it('should filter dangling references', () => {
      const tasks = [
        createTask('task-1', ['nonexistent-task']),
        createTask('task-2', ['task-1'])
      ];

      const resolver = new DependencyResolver(tasks);
      const sorted = resolver.topoSort(tasks);

      expect(sorted).toHaveLength(2);

      // Verify dangling reference was removed
      const task1Deps = resolver.getDependencies('task-1');
      expect(task1Deps).toHaveLength(0);
    });
  });

  describe('verifyTopologicalOrder', () => {
    it('should verify correct topological order', () => {
      const tasks = [
        createTask('task-1'),
        createTask('task-2', ['task-1']),
        createTask('task-3', ['task-2'])
      ];

      const resolver = new DependencyResolver(tasks);
      const isValid = resolver.verifyTopologicalOrder(tasks);

      expect(isValid).toBe(true);
    });

    it('should reject incorrect topological order', () => {
      const tasks = [
        createTask('task-3', ['task-2']),
        createTask('task-1'),
        createTask('task-2', ['task-1'])
      ];

      const resolver = new DependencyResolver(tasks);
      const isValid = resolver.verifyTopologicalOrder(tasks);

      expect(isValid).toBe(false);
    });
  });

  describe('getReadyTasks', () => {
    it('should return tasks with no dependencies as ready', () => {
      const tasks = [
        createTask('task-1'),
        createTask('task-2', ['task-1']),
        createTask('task-3')
      ];

      const resolver = new DependencyResolver(tasks);
      const taskStates = new Map([
        ['task-1', 'pending' as const],
        ['task-2', 'pending' as const],
        ['task-3', 'pending' as const]
      ]);

      const ready = resolver.getReadyTasks(taskStates);

      expect(ready).toHaveLength(2);
      expect(ready.find(t => t.id === 'task-1')).toBeDefined();
      expect(ready.find(t => t.id === 'task-3')).toBeDefined();
    });

    it('should return tasks whose dependencies are completed', () => {
      const tasks = [
        createTask('task-1'),
        createTask('task-2', ['task-1']),
        createTask('task-3', ['task-2'])
      ];

      const resolver = new DependencyResolver(tasks);
      const taskStates = new Map([
        ['task-1', 'completed' as const],
        ['task-2', 'pending' as const],
        ['task-3', 'pending' as const]
      ]);

      const ready = resolver.getReadyTasks(taskStates);

      expect(ready).toHaveLength(1);
      expect(ready[0].id).toBe('task-2');
    });

    it('should not return tasks with incomplete dependencies', () => {
      const tasks = [
        createTask('task-1'),
        createTask('task-2', ['task-1']),
        createTask('task-3', ['task-1', 'task-2'])
      ];

      const resolver = new DependencyResolver(tasks);
      const taskStates = new Map([
        ['task-1', 'completed' as const],
        ['task-2', 'pending' as const],
        ['task-3', 'pending' as const]
      ]);

      const ready = resolver.getReadyTasks(taskStates);

      // Only task-2 is ready (task-3 still depends on task-2)
      expect(ready).toHaveLength(1);
      expect(ready[0].id).toBe('task-2');
    });
  });

  describe('canTaskRun', () => {
    it('should return true for task with completed dependencies', () => {
      const tasks = [
        createTask('task-1'),
        createTask('task-2', ['task-1'])
      ];

      const resolver = new DependencyResolver(tasks);
      const taskStates = new Map([
        ['task-1', 'completed' as const],
        ['task-2', 'pending' as const]
      ]);

      expect(resolver.canTaskRun('task-2', taskStates)).toBe(true);
    });

    it('should return false for task with incomplete dependencies', () => {
      const tasks = [
        createTask('task-1'),
        createTask('task-2', ['task-1'])
      ];

      const resolver = new DependencyResolver(tasks);
      const taskStates = new Map([
        ['task-1', 'pending' as const],
        ['task-2', 'pending' as const]
      ]);

      expect(resolver.canTaskRun('task-2', taskStates)).toBe(false);
    });

    it('should return false for already completed task', () => {
      const tasks = [createTask('task-1')];

      const resolver = new DependencyResolver(tasks);
      const taskStates = new Map([['task-1', 'completed' as const]]);

      expect(resolver.canTaskRun('task-1', taskStates)).toBe(false);
    });
  });

  describe('validateSemanticConstraints', () => {
    it('should inject MFA dependency for legacy auth tasks', () => {
      const tasks = [
        createTask('mfa-setup'),
        createTask('disable-basic-auth')
      ];

      // Simulate MFA pattern in command
      tasks[0].action.command = 'Set-AuthenticationMethod -RequireMFA $true';
      tasks[1].action.command = 'Set-CASMailbox -DisableBasicAuth $true';

      const resolver = new DependencyResolver(tasks);
      const result = resolver.validateSemanticConstraints(tasks);

      expect(result.warnings.length).toBeGreaterThan(0);
      expect(result.injectedEdges.length).toBeGreaterThan(0);

      const edge = result.injectedEdges[0];
      expect(edge.from).toBe('mfa-setup');
      expect(edge.to).toBe('disable-basic-auth');
    });

    it('should not inject dependency if MFA task already in dependency chain', () => {
      const tasks = [
        createTask('mfa-setup'),
        createTask('disable-basic-auth', ['mfa-setup'])
      ];

      tasks[0].action.command = 'Set-AuthenticationMethod -RequireMFA $true';
      tasks[1].action.command = 'Set-CASMailbox -DisableBasicAuth $true';

      const resolver = new DependencyResolver(tasks);
      const result = resolver.validateSemanticConstraints(tasks);

      expect(result.injectedEdges.length).toBe(0);
    });

    it('should handle tasks without semantic constraint patterns', () => {
      const tasks = [
        createTask('task-1'),
        createTask('task-2')
      ];

      const resolver = new DependencyResolver(tasks);
      const result = resolver.validateSemanticConstraints(tasks);

      expect(result.warnings.length).toBe(0);
      expect(result.injectedEdges.length).toBe(0);
    });
  });

  describe('helper methods', () => {
    it('should get task dependencies', () => {
      const tasks = [
        createTask('task-1'),
        createTask('task-2', ['task-1'])
      ];

      const resolver = new DependencyResolver(tasks);
      const deps = resolver.getDependencies('task-2');

      expect(deps).toEqual(['task-1']);
    });

    it('should get task dependents', () => {
      const tasks = [
        createTask('task-1'),
        createTask('task-2', ['task-1'])
      ];

      const resolver = new DependencyResolver(tasks);
      const dependents = resolver.getDependents('task-1');

      expect(dependents).toEqual(['task-2']);
    });

    it('should get task by id', () => {
      const tasks = [createTask('task-1')];

      const resolver = new DependencyResolver(tasks);
      const task = resolver.getTask('task-1');

      expect(task).toBeDefined();
      expect(task?.id).toBe('task-1');
    });

    it('should get all tasks', () => {
      const tasks = [
        createTask('task-1'),
        createTask('task-2'),
        createTask('task-3')
      ];

      const resolver = new DependencyResolver(tasks);
      const allTasks = resolver.getAllTasks();

      expect(allTasks).toHaveLength(3);
    });

    it('should get task count', () => {
      const tasks = [
        createTask('task-1'),
        createTask('task-2')
      ];

      const resolver = new DependencyResolver(tasks);
      expect(resolver.getTaskCount()).toBe(2);
    });

    it('should update and get task status', () => {
      const tasks = [createTask('task-1')];

      const resolver = new DependencyResolver(tasks);
      resolver.updateTaskStatus('task-1', 'completed');

      expect(resolver.getTaskStatus('task-1')).toBe('completed');
    });

    it('should get tasks by status', () => {
      const tasks = [
        createTask('task-1'),
        createTask('task-2')
      ];

      const resolver = new DependencyResolver(tasks);
      resolver.updateTaskStatus('task-1', 'completed');
      resolver.updateTaskStatus('task-2', 'pending');

      const completed = resolver.getTasksByStatus('completed');
      expect(completed).toHaveLength(1);
      expect(completed[0].id).toBe('task-1');

      const pending = resolver.getTasksByStatus('pending');
      expect(pending).toHaveLength(1);
      expect(pending[0].id).toBe('task-2');
    });
  });
});
