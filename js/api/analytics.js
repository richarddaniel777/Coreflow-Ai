import { supabase } from './supabase.js';

export const SALES_ANALYTICS_RPC = 'get_sales_analytics';

export async function getSalesAnalytics({ startDate = null, today }) {
  if (today && !/^\d{4}-\d{2}-\d{2}$/.test(today)) {
    throw new Error('Analytics requires today as a local YYYY-MM-DD date.');
  }
  const { data, error } = await supabase.rpc(SALES_ANALYTICS_RPC, {
    p_start_date: startDate,
    p_today: today,
  });
  if (error) {
    const detail = error.message || 'The analytics request failed.';
    const analyticsError = new Error(error.code ? `${detail} (${error.code})` : detail);
    analyticsError.code = error.code || 'unknown';
    throw analyticsError;
  }
  if (!data || typeof data !== 'object' || Array.isArray(data)) {
    const message = 'The analytics request returned an unexpected response.';
    const analyticsError = new Error(message);
    analyticsError.code = 'INVALID_RESPONSE';
    throw analyticsError;
  }
  return data;
}
