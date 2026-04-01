/**
 * Error classification for LLM provider calls.
 * Determines if errors are retryable and their type.
 */

export function classifyError(status) {
  if (status === 400) return { retryable: false, type: 'invalid_request_error' };
  if (status === 401) return { retryable: false, type: 'authentication_error', critical: true };
  if (status === 402) return { retryable: false, type: 'payment_required' };
  if (status === 403) return { retryable: false, type: 'permission_error' };
  if (status === 404) return { retryable: false, type: 'model_not_found' };
  if (status === 429) return { retryable: true, type: 'rate_limit_error' };
  if (status === 500) return { retryable: true, type: 'server_error' };
  if (status === 502) return { retryable: true, type: 'bad_gateway' };
  if (status === 503) return { retryable: true, type: 'service_unavailable' };
  if (status === 504) return { retryable: true, type: 'gateway_timeout' };
  if (status === 408) return { retryable: true, type: 'timeout', maxRetries: 1 };
  return { retryable: false, type: 'unknown_error' };
}

export function classifyProviderError(err, providerKey) {
  const message = err?.message || String(err);

  const statusMatch = message.match(/\((\d{3})\)/);
  const status = statusMatch ? parseInt(statusMatch[1], 10) : 0;

  if (status) {
    const classification = classifyError(status);
    const classified = new Error(message);
    classified.status = status;
    classified.errorType = classification.type;
    classified.classification = classification;
    return classified;
  }

  if (err.name === 'AbortError' || message.includes('aborted')) {
    const e = new Error('Request aborted');
    e.status = 408;
    e.errorType = 'timeout';
    return e;
  }

  const code = err.code || err.cause?.code || '';
  if (code === 'ECONNREFUSED' || code === 'ECONNRESET' || code === 'ETIMEDOUT' ||
      code === 'UND_ERR_CONNECT_TIMEOUT' || message.includes('fetch failed')) {
    const e = new Error(`${providerKey} unreachable: ${code || message}`);
    e.status = 502;
    e.errorType = 'connection_error';
    return e;
  }

  const e = new Error(`${providerKey} error: ${message}`);
  e.status = 502;
  e.errorType = 'upstream_error';
  return e;
}
