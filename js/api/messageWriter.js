import { invokeFunction } from './edgeFunctions.js';

export async function draftMessage({ leadId, messageType, channel, extraInstructions }) {
  try {
    return await invokeFunction('draft-message', {
      lead_id: leadId,
      message_type: messageType,
      ...(channel ? { channel } : {}),
      ...(extraInstructions ? { extra_instructions: extraInstructions } : {}),
    });
  } catch (error) {
    const kind = error?.name || error?.constructor?.name;
    let body = null;
    try {
      if (error?.context && typeof error.context.clone === 'function') body = await error.context.clone().json();
    } catch { /* Fall back to the SDK error message. */ }
    let message = body?.error || error?.message || 'The draft could not be generated. Try again.';
    const status = error?.context?.status || error?.status || null;
    if (kind === 'FunctionsFetchError') message = 'The draft-message function could not be reached. Check that it is deployed and try again.';
    if (kind === 'FunctionsRelayError') message = 'Supabase could not route the request to the draft-message function. Please try again.';
    if (body?.code === 'UNAUTHORIZED_NO_AUTH_HEADER' || message === 'Please log in again.') message = 'Please log in again.';
    const result = new Error(message + (status ? ` (HTTP ${status})` : ''));
    result.status = status;
    result.providerReason = ['OVERLOADED', 'RATE_LIMITED', 'CONFIG_ERROR', 'INVALID_OUTPUT'].includes(body?.provider_reason) ? body.provider_reason : null;
    result.retryAfterSeconds = Number(body?.retry_after_seconds) || null;
    throw result;
  }
}
