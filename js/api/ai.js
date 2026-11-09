import { invokeFunction } from './edgeFunctions.js';

export async function scoreLead(leadId) {
  try {
    return await invokeFunction('score-lead', { lead_id: leadId });
  } catch (error) {
    const errorType = error?.name || error?.constructor?.name;
    let message = error?.message || 'AI scoring failed. Try again.';
    let status = error?.status || error?.context?.status;
    let retryAfter = null;
    let providerReason = null;
    let errorBody = null;
    try {
      const response = error?.context;
      if (response && typeof response.clone === 'function') errorBody = await response.clone().json();
    } catch { /* Preserve the SDK message if there is no JSON response body. */ }

    if (errorType === 'FunctionsFetchError') {
      message = 'The score-lead function could not be reached. Check that it is deployed and try again.';
    } else if (errorType === 'FunctionsRelayError') {
      message = 'Supabase could not route the request to the score-lead function. Please try again.';
    } else if (typeof errorBody?.error === 'string') {
      message = errorBody.error;
      status = error?.context?.status || status;
      const retryValue = Number(errorBody.retry_after_seconds ?? errorBody.retry_after);
      retryAfter = Number.isFinite(retryValue) && retryValue > 0 ? retryValue : null;
      providerReason = ['OVERLOADED', 'RATE_LIMITED', 'CONFIG_ERROR', 'INVALID_OUTPUT'].includes(errorBody.provider_reason)
        ? errorBody.provider_reason
        : null;
    }

    if (message === 'Please log in again.' || errorBody?.code === 'UNAUTHORIZED_NO_AUTH_HEADER') {
      message = 'Please log in again.';
    }
    if (status) message += ` (HTTP ${status})`;
    const result = new Error(message);
    result.status = status;
    result.retryAfter = retryAfter;
    result.retryAfterSeconds = retryAfter;
    result.providerReason = providerReason;
    throw result;
  }
}
