import crypto from 'node:crypto';

function base64url(buf) {
    return Buffer.from(buf).toString('base64url');
}

function base64urlJson(obj) {
    return base64url(Buffer.from(JSON.stringify(obj), 'utf8'));
}

export function canonicalJson(value) {
    if (value === null || typeof value !== 'object') {
        return JSON.stringify(value ?? null);
    }
    if (Array.isArray(value)) {
        return `[${value.map(canonicalJson).join(',')}]`;
    }
    const keys = Object.keys(value).sort();
    const parts = keys.map((k) => `${JSON.stringify(k)}:${canonicalJson(value[k])}`);
    return `{${parts.join(',')}}`;
}

export function bodyHashForRequest(bodyObject) {
    const str = canonicalJson(bodyObject ?? {});
    return crypto.createHash('sha256').update(str, 'utf8').digest('base64url');
}

export function signHmacJwt({ payload, secret }) {
    if (!secret || !Buffer.isBuffer(secret)) {
        throw new Error('signHmacJwt: secret (Buffer) required');
    }
    const header = base64urlJson({ alg: 'HS256', typ: 'JWT' });
    const body = base64urlJson(payload);
    const signingInput = `${header}.${body}`;
    const sig = base64url(crypto.createHmac('sha256', secret).update(signingInput).digest());
    return `${signingInput}.${sig}`;
}
