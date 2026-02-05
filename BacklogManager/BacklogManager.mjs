import { stat } from 'fs/promises';
import { resolve } from 'path';
import { loadBacklogFile, saveBacklogFile, forceSave, createBacklogFile } from './backlogIO.mjs';
export async function loadBacklog(filePath) {
  const backlogPath = resolve(filePath);
  const entry = await loadBacklogFile(backlogPath);
  let meta = null;
  try {
    const stats = await stat(entry.backlogPath);
    meta = { mtime: stats.mtime, size: stats.size };
  } catch {
    meta = null;
  }
  return { tasks: entry.tasks, history: entry.history, meta };
}

export async function createBacklog(filePath) {
  const backlogPath = resolve(filePath);
  await createBacklogFile(backlogPath);
}

export async function getTask(filePath, taskIndex) {
  const { tasks } = await loadBacklog(filePath);
  const index = toTaskIndex(taskIndex);
  if (index === null) return null;
  return tasks[index] || null;
}

export async function addOptionsFromText(filePath, taskIndex, text) {
  const { tasks, history } = await loadBacklog(filePath);
  const index = toTaskIndex(taskIndex);
  if (index === null) return null;
  const task = tasks[index];
  if (!task) return null;
  const items = parseOptionsText(text);
  if (items.length === 0) return task;
  for (const item of items) {
    task.options.push(item);
  }
  task.resolution = '';
  await saveBacklogFile(filePath, { tasks, history });
  return task;
}

export async function approveOption(filePath, taskIndex, optionIndex) {
  const { tasks, history } = await loadBacklog(filePath);
  const index = toTaskIndex(taskIndex);
  if (index === null) return null;
  const task = tasks[index];
  if (!task) return null;
  const optionPosition = Number.parseInt(optionIndex, 10);
  if (!Number.isFinite(optionPosition) || optionPosition < 1) return null;
  const optionValue = task.options[optionPosition - 1];
  if (typeof optionValue !== 'string') return null;
  task.resolution = optionValue;
  task.options = [];
  await saveBacklogFile(filePath, { tasks, history });
  return task;
}

export async function getApprovedTasks(filePath) {
  const { tasks } = await loadBacklog(filePath);
  const approved = [];
  for (let i = 0; i < tasks.length; i += 1) {
    const task = tasks[i];
    const options = Array.isArray(task?.options) ? task.options : [];
    if (!options.length && typeof task?.resolution === 'string' && task.resolution.trim()) {
      approved.push({ index: i + 1, ...task });
    }
  }
  return approved;
}

export async function getNewTasks(filePath) {
  const { tasks } = await loadBacklog(filePath);
  const fresh = [];
  for (let i = 0; i < tasks.length; i += 1) {
    const task = tasks[i];
    const options = Array.isArray(task?.options) ? task.options : [];
    const hasResolution = typeof task?.resolution === 'string' && task.resolution.trim();
    if (options.length || hasResolution || (!options.length && !hasResolution)) {
      fresh.push({ index: i + 1, ...task });
    }
  }
  return fresh;
}

export async function markDone(filePath, taskIndex) {
  const { tasks, history } = await loadBacklog(filePath);
  const index = toTaskIndex(taskIndex);
  if (index === null) return null;
  const task = tasks[index];
  if (!task) return null;
  const resolution = task.resolution && task.resolution.trim() ? task.resolution.trim() : 'Executed.';
  moveTaskToHistory(index, tasks, history, resolution);
  await saveBacklogFile(filePath, { tasks, history });
  return history[history.length - 1] || null;
}

export async function updateTask(filePath, taskIndex, updates) {
  const { tasks, history } = await loadBacklog(filePath);
  const index = toTaskIndex(taskIndex);
  if (index === null) return;
  const task = tasks[index];
  if (task) {
    const safeUpdates = normalizeTaskUpdates(updates);
    Object.assign(task, safeUpdates);
  }
  await saveBacklogFile(filePath, { tasks, history });
}

export async function addTask(filePath, initialContent) {
  const { tasks, history } = await loadBacklog(filePath);
  tasks.push({
    description: initialContent,
    options: [],
    resolution: ''
  });
  await saveBacklogFile(filePath, { tasks, history });
  return tasks.length;
}

export async function saveBacklog(filePath, data) {
  await saveBacklogFile(filePath, data);
}

export async function flush(filePath) {
  await forceSave(filePath);
}

function parseOptionsText(text) {
  if (!text || typeof text !== 'string') return [];
  const lines = text.split('\n');
  const items = [];
  let current = null;

  for (const rawLine of lines) {
    const line = rawLine.replace(/\r$/, '');
    const numberedMatch = line.match(/^\s*(\d+)[\.)]\s+(.+)$/);

    if (numberedMatch) {
      if (current) items.push(current);
      const title = numberedMatch[2];
      current = { title: title.trim(), details: '' };
      continue;
    }

    if (current && line.trim()) {
      const normalized = line.trim();
      current.details = current.details ? `${current.details}\n${normalized}` : normalized;
    }
  }

  if (current) items.push(current);
  return items.map((item) => {
    if (!item.details) return item.title;
    return `${item.title}\n${item.details}`;
  });
}

function normalizeTaskUpdates(updates) {
  if (!updates || typeof updates !== 'object') return {};
  const normalized = {};
  if (Object.prototype.hasOwnProperty.call(updates, 'description')) {
    normalized.description = typeof updates.description === 'string' ? updates.description : '';
  }
  if (Object.prototype.hasOwnProperty.call(updates, 'options')) {
    const rawOptions = Array.isArray(updates.options) ? updates.options : [];
    normalized.options = rawOptions.map((option) => {
      if (typeof option === 'string') return option;
      if (option === null || typeof option === 'undefined') return '';
      return String(option);
    });
  }
  if (Object.prototype.hasOwnProperty.call(updates, 'resolution')) {
    normalized.resolution = typeof updates.resolution === 'string' ? updates.resolution : '';
  }
  return normalized;
}

function moveTaskToHistory(taskIndex, tasks, history, resolutionText) {
  const task = tasks[taskIndex];
  if (!task) return;
  const resolution = resolutionText && resolutionText.trim()
    ? resolutionText.trim()
    : task.resolution && task.resolution.trim()
      ? task.resolution
      : 'Executed.';
  history.push({
    description: task.description,
    options: [],
    resolution
  });
  tasks.splice(taskIndex, 1);
}

function toTaskIndex(taskId) {
  const numericId = Number.parseInt(taskId, 10);
  if (!Number.isFinite(numericId)) return null;
  const index = numericId - 1;
  if (!Number.isFinite(index) || index < 0) return null;
  return index;
}
