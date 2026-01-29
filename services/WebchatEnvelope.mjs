/**
 * WebchatEnvelope - Protocol for structured webchat messages
 *
 * Provides serialization and parsing of webchat envelope format used
 * for communication between webchat UI and agent containers.
 *
 * Envelope format:
 * {
 *   "__webchatMessage": 1,
 *   "version": 1,
 *   "text": "user message",
 *   "attachments": [{ filename, mime, size, downloadUrl, localPath }],
 *   "user": { username, roles, sessionId, email },
 *   "settings": { maxTableRows }
 * }
 */

const ENVELOPE_FLAG = '__webchatMessage';
const CURRENT_VERSION = 1;

/**
 * Normalize attachment object
 * @param {Object} raw - Raw attachment data
 * @returns {Object|null} Normalized attachment or null
 */
function normalizeAttachment(raw) {
    if (!raw || typeof raw !== 'object') {
        return null;
    }

    const attachment = {
        id: typeof raw.id === 'string' ? raw.id : null,
        filename: typeof raw.filename === 'string' ? raw.filename : null,
        mime: typeof raw.mime === 'string' ? raw.mime : null,
        size: Number.isFinite(raw.size) ? raw.size : null,
        downloadUrl: typeof raw.downloadUrl === 'string' ? raw.downloadUrl : null,
        localPath: typeof raw.localPath === 'string' ? raw.localPath : null,
    };

    const hasData = Object.values(attachment).some((value) => value !== null);
    return hasData ? attachment : null;
}

/**
 * Normalize user object
 * @param {Object} raw - Raw user data
 * @returns {Object|null} Normalized user or null
 */
function normalizeUser(raw) {
    if (!raw || typeof raw !== 'object') {
        return null;
    }

    const username = typeof raw.username === 'string' ? raw.username : null;
    const role =
        typeof raw.role === 'string' && raw.role.trim() ? raw.role.trim() : null;
    const roles = Array.isArray(raw.roles)
        ? raw.roles
              .map((r) => (typeof r === 'string' ? r.trim() : ''))
              .filter(Boolean)
        : [];
    const sessionId =
        typeof raw.sessionId === 'string' && raw.sessionId.trim()
            ? raw.sessionId.trim()
            : null;
    const sessionToken =
        typeof raw.sessionToken === 'string' && raw.sessionToken.trim()
            ? raw.sessionToken.trim()
            : null;
    const token =
        typeof raw.token === 'string' && raw.token.trim()
            ? raw.token.trim()
            : null;
    const email =
        typeof raw.email === 'string' && raw.email.trim()
            ? raw.email.trim()
            : null;
    const source =
        typeof raw.source === 'string' && raw.source.trim()
            ? raw.source.trim()
            : null;
    const authenticatedAt =
        typeof raw.authenticatedAt === 'string' && raw.authenticatedAt.trim()
            ? raw.authenticatedAt.trim()
            : null;

    const normalized = {
        username,
        role: role || roles[0] || null,
        roles: roles.length ? roles : role ? [role] : [],
        sessionId: sessionId || sessionToken || token || null,
        sessionToken: sessionToken || null,
        token: token || null,
        email,
        source,
        authenticatedAt,
    };

    const hasValues = Object.values(normalized).some(
        (value) =>
            value !== null &&
            value !== undefined &&
            !(Array.isArray(value) && value.length === 0),
    );

    return hasValues ? normalized : null;
}

/**
 * Normalize settings object
 * @param {Object} raw - Raw settings data
 * @returns {Object|null} Normalized settings or null
 */
function normalizeSettings(raw) {
    if (!raw || typeof raw !== 'object') {
        return null;
    }

    const settings = {};

    // maxTableRows - the "View more" line limit from webchat settings
    if (Number.isFinite(raw.maxTableRows) && raw.maxTableRows > 0) {
        settings.maxTableRows = raw.maxTableRows;
    } else if (Number.isFinite(raw.lineLimit) && raw.lineLimit > 0) {
        // Alternative name used by webchat
        settings.maxTableRows = raw.lineLimit;
    }

    return Object.keys(settings).length > 0 ? settings : null;
}

/**
 * Serialize data into webchat envelope format
 * @param {Object} options - Data to serialize
 * @param {string} [options.text=''] - Message text
 * @param {Array} [options.attachments=[]] - Attachment objects
 * @param {Object} [options.user] - User info
 * @param {Object} [options.settings] - Settings
 * @returns {string} JSON string of envelope
 */
export function serializeWebchatEnvelope({ text = '', attachments = [], user = null, settings = null } = {}) {
    const normalizedAttachments = Array.isArray(attachments)
        ? attachments.map(normalizeAttachment).filter(Boolean)
        : [];

    const payload = {
        [ENVELOPE_FLAG]: CURRENT_VERSION,
        version: CURRENT_VERSION,
        text: typeof text === 'string' ? text : '',
        attachments: normalizedAttachments,
    };

    if (user) {
        const normalizedUser = normalizeUser(user);
        if (normalizedUser) {
            payload.user = normalizedUser;
        }
    }

    if (settings) {
        const normalizedSettings = normalizeSettings(settings);
        if (normalizedSettings) {
            payload.settings = normalizedSettings;
        }
    }

    return JSON.stringify(payload);
}

/**
 * Parse webchat envelope from raw input
 * @param {string} raw - Raw input string (may or may not be envelope)
 * @returns {Object|null} Parsed envelope or null if not valid envelope
 */
export function parseWebchatEnvelope(raw) {
    if (typeof raw !== 'string') {
        return null;
    }

    const trimmed = raw.trim();
    if (!trimmed.startsWith('{') || !trimmed.endsWith('}')) {
        return null;
    }

    let parsed;
    try {
        parsed = JSON.parse(trimmed);
    } catch (_) {
        return null;
    }

    if (
        !parsed ||
        typeof parsed !== 'object' ||
        parsed[ENVELOPE_FLAG] !== CURRENT_VERSION
    ) {
        return null;
    }

    const text = typeof parsed.text === 'string' ? parsed.text : '';
    const attachments = Array.isArray(parsed.attachments)
        ? parsed.attachments.map(normalizeAttachment).filter(Boolean)
        : [];
    const user = normalizeUser(parsed.user);
    const settings = normalizeSettings(parsed.settings);

    return {
        text,
        attachments,
        user,
        settings,
        raw: parsed,
    };
}

/**
 * Check if raw input is a webchat envelope
 * @param {string} raw - Raw input string
 * @returns {boolean} True if input is a valid webchat envelope
 */
export function isWebchatEnvelope(raw) {
    return parseWebchatEnvelope(raw) !== null;
}

/**
 * Extract plain text from input (handles both envelope and plain text)
 * @param {string} raw - Raw input string
 * @returns {string} Text content
 */
export function extractText(raw) {
    const envelope = parseWebchatEnvelope(raw);
    if (envelope) {
        return envelope.text;
    }
    return typeof raw === 'string' ? raw.trim() : '';
}

// Export constants for testing
export const WEBCHAT_ENVELOPE_FLAG = ENVELOPE_FLAG;
export const WEBCHAT_ENVELOPE_VERSION = CURRENT_VERSION;
