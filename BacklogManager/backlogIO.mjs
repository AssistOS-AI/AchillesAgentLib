import { readFile, writeFile } from 'fs/promises';
import { resolve, extname } from 'path';

const DEFAULT_SAVE_INTERVAL = 5000;
const saveQueue = new Map();
let saveTimer = null;

function ensureSaveLoop(intervalMs = DEFAULT_SAVE_INTERVAL) {
  if (saveTimer) return;
  saveTimer = setInterval(() => flushModified().catch(() => {}), intervalMs);
  if (typeof saveTimer.unref === 'function') {
    saveTimer.unref();
  }
}

function ensureBacklogExtension(filePath) {
  const normalizedPath = resolve(filePath);
  const extension = extname(normalizedPath);
  if (normalizedPath.endsWith('/.backlog')) {
    return normalizedPath;
  }
  if (extension === '.backlog') {
    return normalizedPath;
  }
  return `${normalizedPath}.backlog`;
}

function buildHistoryPath(backlogPath) {
  return resolve(backlogPath.replace(/\.backlog$/i, '.history'));
}

function normalizeTask(task) {
  if (!task || typeof task !== 'object') {
    return {
      description: '',
      options: [],
      resolution: ''
    };
  }
  const rawOptions = Array.isArray(task.options) ? task.options : [];
  const options = rawOptions.map((option) => {
    if (typeof option === 'string') return option;
    if (option === null || typeof option === 'undefined') return '';
    return String(option);
  });
  return {
    description: typeof task.description === 'string' ? task.description : '',
    options,
    resolution: typeof task.resolution === 'string' ? task.resolution : ''
  };
}

function normalizeTasks(input) {
  if (!Array.isArray(input)) return [];
  return input.map((task) => normalizeTask(task));
}

function normalizeHistory(input) {
  if (!Array.isArray(input)) return [];
  return input.map((task) => normalizeTask(task));
}

async function readJsonFile(path, fallback) {
  try {
    const content = await readFile(path, 'utf8');
    if (!content.trim()) return fallback;
    return JSON.parse(content);
  } catch (error) {
    if (error?.code === 'ENOENT') {
      return fallback;
    }
    throw new Error(`Failed to read backlog: ${error.message}`);
  }
}

async function writeJsonFile(path, data) {
  try {
    await writeFile(path, `${JSON.stringify(data, null, 2)}\n`, 'utf8');
  } catch (error) {
    throw new Error(`Failed to write backlog: ${error.message}`);
  }
}

function toPersistedTask(task) {
  return normalizeTask(task);
}

async function flushModified() {
  for (const entry of saveQueue.values()) {
    if (!entry.modified) continue;
    entry.modified = false;
    const tasks = Array.isArray(entry.tasks) ? entry.tasks.map(toPersistedTask) : [];
    const history = Array.isArray(entry.history) ? entry.history.map(toPersistedTask) : [];
    await writeJsonFile(entry.backlogPath, tasks);
    await writeJsonFile(entry.historyPath, history);
  }
}

function getOrCreateCache(backlogPath, intervalMs) {
  ensureSaveLoop(intervalMs);
  const key = resolve(backlogPath);
  let entry = saveQueue.get(key);
  if (!entry) {
    entry = {
      backlogPath: key,
      historyPath: buildHistoryPath(key),
      tasks: [],
      history: [],
      loaded: false,
      modified: false
    };
    saveQueue.set(key, entry);
  }
  return entry;
}

export async function loadBacklogFile(filePath, options = {}) {
  const intervalMs = Number.isFinite(options.saveIntervalMs) ? options.saveIntervalMs : DEFAULT_SAVE_INTERVAL;
  const backlogPath = ensureBacklogExtension(filePath);
  const entry = getOrCreateCache(backlogPath, intervalMs);
  if (!entry.loaded) {
    const backlogData = await readJsonFile(entry.backlogPath, []);
    const historyData = await readJsonFile(entry.historyPath, []);
    const tasksSource = Array.isArray(backlogData) ? backlogData : backlogData?.tasks;
    const historySource = Array.isArray(historyData) ? historyData : historyData?.tasks;
    entry.tasks = normalizeTasks(tasksSource);
    entry.history = normalizeHistory(historySource);
    entry.loaded = true;
  }
  return entry;
}

export async function refreshBacklogFile(filePath, options = {}) {
  const intervalMs = Number.isFinite(options.saveIntervalMs) ? options.saveIntervalMs : DEFAULT_SAVE_INTERVAL;
  const backlogPath = ensureBacklogExtension(filePath);
  const entry = getOrCreateCache(backlogPath, intervalMs);
  const backlogData = await readJsonFile(entry.backlogPath, []);
  const historyData = await readJsonFile(entry.historyPath, []);
  const tasksSource = Array.isArray(backlogData) ? backlogData : backlogData?.tasks;
  const historySource = Array.isArray(historyData) ? historyData : historyData?.tasks;
  entry.tasks = normalizeTasks(tasksSource);
  entry.history = normalizeHistory(historySource);
  entry.loaded = true;
  entry.modified = false;
  return entry;
}

export async function saveBacklogFile(filePath, data, options = {}) {
  const intervalMs = Number.isFinite(options.saveIntervalMs) ? options.saveIntervalMs : DEFAULT_SAVE_INTERVAL;
  const backlogPath = ensureBacklogExtension(filePath);
  const entry = getOrCreateCache(backlogPath, intervalMs);
  if (data?.tasks) {
    entry.tasks = normalizeTasks(data.tasks);
  }
  if (data?.history) {
    entry.history = normalizeHistory(data.history);
  }
  entry.loaded = true;
  entry.modified = true;
}

export async function forceSave(filePath, options = {}) {
  const intervalMs = Number.isFinite(options.saveIntervalMs) ? options.saveIntervalMs : DEFAULT_SAVE_INTERVAL;
  const backlogPath = ensureBacklogExtension(filePath);
  const entry = getOrCreateCache(backlogPath, intervalMs);
  if (!entry.loaded) {
    await loadBacklogFile(backlogPath, options);
  }
  entry.modified = true;
  await flushModified();
}

export async function createBacklogFile(filePath, options = {}) {
  const intervalMs = Number.isFinite(options.saveIntervalMs) ? options.saveIntervalMs : DEFAULT_SAVE_INTERVAL;
  const backlogPath = ensureBacklogExtension(filePath);
  await writeJsonFile(backlogPath, []);
  await writeJsonFile(buildHistoryPath(backlogPath), []);
  const entry = getOrCreateCache(backlogPath, intervalMs);
  entry.tasks = [];
  entry.history = [];
  entry.loaded = true;
  entry.modified = false;
}

export function getHistoryPath(filePath) {
  const backlogPath = ensureBacklogExtension(filePath);
  return buildHistoryPath(backlogPath);
}
