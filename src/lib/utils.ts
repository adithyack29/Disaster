import { formatDistanceToNow, format } from 'date-fns';

export function formatTimeAgo(isoString: string): string {
  try {
    const date = new Date(isoString);
    return formatDistanceToNow(date, { addSuffix: true });
  } catch {
    return isoString;
  }
}

export function formatExactTime(isoString: string): string {
  try {
    const date = new Date(isoString);
    return format(date, 'HH:mm:ss dd MMM yyyy');
  } catch {
    return isoString;
  }
}

export function formatCoordinates(lat: number, lng: number): string {
  const latStr = `${Math.abs(lat).toFixed(4)}°${lat >= 0 ? 'N' : 'S'}`;
  const lngStr = `${Math.abs(lng).toFixed(4)}°${lng >= 0 ? 'E' : 'W'}`;
  return `${latStr}, ${lngStr}`;
}

/**
 * Strips HTML tags and unescapes HTML entities from text strings
 */
export function cleanText(text: string): string {
  if (!text) return '';
  return text
    .replace(/<img[^>]*>/gi, '')
    .replace(/<[^>]+>/g, '')
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/\s+/g, ' ')
    .trim();
}

/**
 * Strip news provider prefixes, raw hashtags, and HTML tags from incident headlines
 */
export function cleanHeadline(title: string): string {
  if (!title) return '';
  let cleaned = cleanText(title);
  // Strip raw Twitter/NWS hashtags like #NWS #flood #nwsflashflood #INwx
  cleaned = cleaned.replace(/(#[a-z0-9_]+\s*)+/gi, '').trim();
  cleaned = cleaned
    .replace(/^(the hindu|times of india|ndtv|newsapi|gnews|rss|pib|gdacs|usgs telemetry|nasa eonet|mastodon dispatch|bluesky post|r\/india post)[^:]*:\s*/i, '')
    .trim();
  return cleaned;
}
