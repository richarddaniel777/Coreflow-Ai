const CHANNELS = [
  { value: 'whatsapp', label: 'WhatsApp', preferred: true, activityTypes: ['message', 'quotation_sent'] },
  { value: 'instagram', label: 'Instagram', preferred: true, activityTypes: ['message', 'quotation_sent'] },
  { value: 'facebook', label: 'Facebook', preferred: true, activityTypes: ['message', 'quotation_sent'] },
  { value: 'linkedin', label: 'LinkedIn', preferred: true, activityTypes: ['message', 'quotation_sent'] },
  { value: 'discord', label: 'Discord', preferred: true, activityTypes: ['message', 'quotation_sent'] },
  { value: 'telegram', label: 'Telegram', preferred: true, activityTypes: ['message', 'quotation_sent'] },
  { value: 'tiktok', label: 'TikTok', preferred: true, activityTypes: ['message', 'quotation_sent'] },
  { value: 'x_twitter', label: 'X (Twitter)', preferred: true, activityTypes: ['message', 'quotation_sent'] },
  { value: 'other_social', label: 'Other social', preferred: true, activityTypes: ['message', 'quotation_sent'] },
  { value: 'email', label: 'Email', preferred: true, activityTypes: ['message', 'email', 'quotation_sent'] },
  { value: 'phone', label: 'Phone', preferred: true, activityTypes: ['message', 'call', 'meeting'] },
  { value: 'sms', label: 'SMS', preferred: true, activityTypes: ['message', 'quotation_sent'] },
  { value: 'website_form', label: 'Website form', preferred: false, activityTypes: [] },
  { value: 'in_person', label: 'In person', preferred: true, activityTypes: ['message', 'meeting', 'visit', 'quotation_sent'] },
  { value: 'other', label: 'Other', preferred: true, activityTypes: ['message', 'call', 'email', 'meeting', 'visit', 'quotation_sent'] },
];

export const LEAD_SOURCES = [
  { value: 'whatsapp', label: 'WhatsApp' },
  { value: 'instagram', label: 'Instagram' },
  { value: 'facebook', label: 'Facebook' },
  { value: 'linkedin', label: 'LinkedIn' },
  { value: 'discord', label: 'Discord' },
  { value: 'telegram', label: 'Telegram' },
  { value: 'tiktok', label: 'TikTok' },
  { value: 'x_twitter', label: 'X (Twitter)' },
  { value: 'other_social', label: 'Other social' },
  { value: 'referral', label: 'Referral' },
  { value: 'phone_call', label: 'Phone call' },
  { value: 'website', label: 'Website' },
  { value: 'walk_in', label: 'Walk-in' },
  { value: 'email', label: 'Email' },
  { value: 'other', label: 'Other' },
];

export const PREFERRED_CHANNELS = CHANNELS.filter((channel) => channel.preferred);
export const ACTIVITY_CHANNELS = CHANNELS;
export const LEAD_STAGES = [
  { value: 'new', label: 'New', open: true, tone: 'info' },
  { value: 'contacted', label: 'Contacted', open: true, tone: 'info' },
  { value: 'quoted', label: 'Quoted', open: true, tone: 'info' },
  { value: 'negotiating', label: 'Negotiating', open: true, tone: 'info' },
  { value: 'won', label: 'Won', open: false, tone: 'success' },
  { value: 'lost', label: 'Lost', open: false, tone: 'neutral', requiresLostReason: true },
];
export const ACTIVITY_TYPES = [
  { value: 'message', label: 'Message' },
  { value: 'call', label: 'Call' },
  { value: 'email', label: 'Email' },
  { value: 'meeting', label: 'Meeting' },
  { value: 'visit', label: 'Visit' },
  { value: 'note', label: 'Note' },
  { value: 'quotation_sent', label: 'Quotation sent' },
];

const SOURCE_LABELS = new Map(LEAD_SOURCES.map(({ value, label }) => [value, label]));
const CHANNEL_LABELS = new Map(ACTIVITY_CHANNELS.map(({ value, label }) => [value, label]));
const STAGE_LABELS = new Map(LEAD_STAGES.map(({ value, label }) => [value, label]));

export function labelForSource(value) { return SOURCE_LABELS.get(value) || value || 'Other'; }
export function labelForChannel(value) { return CHANNEL_LABELS.get(value) || value || 'Not provided'; }
export function labelForStage(value) { return STAGE_LABELS.get(value) || value || 'New'; }
export function stageIsOpen(value) { return LEAD_STAGES.find((stage) => stage.value === value)?.open ?? true; }
export function toneForStage(value) { return LEAD_STAGES.find((stage) => stage.value === value)?.tone || 'info'; }
export function stageRequiresLostReason(value) { return LEAD_STAGES.find((stage) => stage.value === value)?.requiresLostReason || false; }
export function channelsForActivityType(type) {
  return ACTIVITY_CHANNELS.filter((channel) => channel.activityTypes.includes(type));
}
