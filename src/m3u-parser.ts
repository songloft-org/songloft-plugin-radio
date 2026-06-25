export interface ParsedStation {
  url: string;
  title: string;
  artist: string;
  logo: string;
  group: string;
}

export interface ParseResult {
  stations: ParsedStation[];
  errors: string[];
}

const VALID_SCHEMES = ['http://', 'https://', 'rtmp://', 'rtsp://', 'mms://'];

const HLS_MARKERS = [
  '#EXT-X-TARGETDURATION',
  '#EXT-X-MEDIA-SEQUENCE',
  '#EXT-X-PLAYLIST-TYPE',
  '#EXT-X-MAP',
];

function isValidUrl(line: string): boolean {
  const lower = line.toLowerCase();
  return VALID_SCHEMES.some(s => lower.startsWith(s));
}

function isHLSMediaPlaylist(content: string): boolean {
  let hlsCount = 0;
  for (const marker of HLS_MARKERS) {
    if (content.includes(marker)) hlsCount++;
  }
  return hlsCount >= 2;
}

function extractAttribute(line: string, attr: string): string {
  const regex = new RegExp(`${attr}="([^"]*)"`, 'i');
  const match = line.match(regex);
  return match ? match[1].trim() : '';
}

function titleFromUrl(url: string): string {
  try {
    const pathname = new URL(url).pathname;
    const filename = pathname.split('/').pop() || '';
    const name = filename.replace(/\.[^.]+$/, '');
    return decodeURIComponent(name) || 'Unknown Station';
  } catch {
    return 'Unknown Station';
  }
}

export function parseM3U(content: string): ParseResult {
  const errors: string[] = [];
  const stations: ParsedStation[] = [];
  const seenUrls = new Set<string>();

  const normalized = content.replace(/\r\n/g, '\n').replace(/\r/g, '\n');

  if (isHLSMediaPlaylist(normalized)) {
    return {
      stations: [],
      errors: ['此文件是 HLS 媒体播放列表（切片列表），不是电台频道列表'],
    };
  }

  const lines = normalized.split('\n');
  const isExtended = lines[0]?.trim().toUpperCase().startsWith('#EXTM3U');

  let pendingInfo: { title: string; artist: string; logo: string; group: string } | null = null;

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i].trim();
    if (!line) continue;

    if (line.toUpperCase().startsWith('#EXTINF:')) {
      const afterTag = line.substring(8);
      const commaIdx = afterTag.indexOf(',');

      let title = '';
      let artist = '';
      let logo = '';
      let group = '';

      if (commaIdx !== -1) {
        const attrs = afterTag.substring(0, commaIdx);
        const rawTitle = afterTag.substring(commaIdx + 1).trim();

        logo = extractAttribute(attrs, 'tvg-logo');
        group = extractAttribute(attrs, 'group-title');
        const tvgName = extractAttribute(attrs, 'tvg-name');

        title = tvgName || rawTitle;

        if (!tvgName && rawTitle.includes(' - ')) {
          const parts = rawTitle.split(' - ');
          artist = parts[0].trim();
          title = parts.slice(1).join(' - ').trim();
        }
      } else {
        title = afterTag.trim();
      }

      pendingInfo = { title, artist, logo, group };
      continue;
    }

    if (line.startsWith('#')) continue;

    if (isValidUrl(line)) {
      if (seenUrls.has(line)) {
        continue;
      }
      seenUrls.add(line);

      if (pendingInfo) {
        stations.push({
          url: line,
          title: pendingInfo.title || titleFromUrl(line),
          artist: pendingInfo.artist,
          logo: pendingInfo.logo,
          group: pendingInfo.group,
        });
        pendingInfo = null;
      } else {
        stations.push({
          url: line,
          title: titleFromUrl(line),
          artist: '',
          logo: '',
          group: '',
        });
      }
    } else if (!line.startsWith('#')) {
      if (isExtended) {
        pendingInfo = null;
      }
    }
  }

  if (stations.length === 0 && errors.length === 0) {
    errors.push('未找到有效的电台 URL');
  }

  return { stations, errors };
}

export function parseJSON(content: string): ParseResult {
  const errors: string[] = [];
  const stations: ParsedStation[] = [];
  const seenUrls = new Set<string>();

  try {
    const data = JSON.parse(content);
    const items = data.items || data;

    if (!Array.isArray(items)) {
      return { stations: [], errors: ['JSON 格式不正确：缺少 items 数组'] };
    }

    for (const item of items) {
      const url = (item.url || '').trim();
      if (!url || !isValidUrl(url)) continue;
      if (seenUrls.has(url)) continue;
      seenUrls.add(url);

      let title = (item.name || item.title || '').trim();
      let artist = (item.artist || '').trim();

      if (!title) {
        title = titleFromUrl(url);
      } else if (!artist && title.includes(' - ')) {
        const parts = title.split(' - ');
        artist = parts[0].trim();
        title = parts.slice(1).join(' - ').trim();
      }

      stations.push({
        url,
        title,
        artist,
        logo: (item.logo || item.cover_url || '').trim(),
        group: (item.group || item.group_title || item.category || '').trim(),
      });
    }
  } catch {
    return { stations: [], errors: ['JSON 解析失败，请确认格式正确'] };
  }

  if (stations.length === 0 && errors.length === 0) {
    errors.push('未找到有效的电台 URL');
  }

  return { stations, errors };
}

export function isJSONContent(content: string): boolean {
  const trimmed = content.trim();
  if (!trimmed.startsWith('{') && !trimmed.startsWith('[')) return false;
  try {
    JSON.parse(trimmed);
    return true;
  } catch {
    return false;
  }
}
