import { promises as fs } from 'node:fs';
import path from 'node:path';

const LOG_DIR_NAME = 'debuglogs';
const LOG_FILE_NAME = 'agentic-sessions.log';

function isEnabled() {
    const flag = String(process.env.ACHILLES_SESSION_DEBUG || '').toLowerCase();
    return flag === 'true' || flag === '1';
}

function formatTimestamp(date = new Date()) {
    const pad = (value) => String(value).padStart(2, '0');
    const day = pad(date.getDate());
    const month = pad(date.getMonth() + 1);
    const year = date.getFullYear();
    const hours = pad(date.getHours());
    const minutes = pad(date.getMinutes());
    return `${day}.${month}.${year} ${hours}:${minutes}`;
}

function normalizeContent(content) {
    if (content === null || content === undefined) {
        return '';
    }
    if (typeof content === 'string') {
        return content;
    }
    if (typeof content === 'number' || typeof content === 'boolean') {
        return String(content);
    }
    try {
        return JSON.stringify(content);
    } catch (error) {
        return String(content);
    }
}

function trimContent(text, limit) {
    if (!Number.isFinite(limit) || limit <= 0) {
        return text;
    }
    if (text.length <= limit) {
        return text;
    }
    return `${text.slice(0, limit)}...`;
}

async function ensureLogDir() {
    const dirPath = path.join(process.cwd(), LOG_DIR_NAME);
    await fs.mkdir(dirPath, { recursive: true });
    return dirPath;
}

export async function appendAgenticLog({ sessionType, label, content, trimLimit = null }) {
    if (!isEnabled()) {
        return;
    }
    const safeSessionType = sessionType || 'Session';
    const safeLabel = label || 'Log';
    const raw = normalizeContent(content);
    const payload = trimContent(raw, trimLimit);
    const timestamp = formatTimestamp();
    const dirPath = await ensureLogDir();
    const filePath = path.join(dirPath, LOG_FILE_NAME);
    const entry = `${timestamp}::  ${safeSessionType} ${safeLabel}: ${payload}\n--------------\n`;
    await fs.appendFile(filePath, entry, 'utf8');
}
