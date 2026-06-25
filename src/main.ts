/// <reference types="@songloft/plugin-sdk" />
import {jsonResponse, createRouter, parseQuery, HTTPRequest} from '@songloft/plugin-sdk';
import { parseM3U, parseJSON, isJSONContent } from './m3u-parser';

const MAX_CONTENT_SIZE = 20 * 1024 * 1024; // 20MB

const router = createRouter();

router.post('/api/parse', async (req) => {
  let content: string;
  try {
    const body = JSON.parse(req.body as unknown as string);
    content = body.content;
  } catch {
    return jsonResponse({ error: '请求体格式错误' }, 400);
  }

  if (!content || typeof content !== 'string') {
    return jsonResponse({ error: '缺少 content 字段' }, 400);
  }

  if (content.length > MAX_CONTENT_SIZE) {
    return jsonResponse({ error: '内容超过 20MB 限制' }, 400);
  }

  const result = isJSONContent(content) ? parseJSON(content) : parseM3U(content);
  return jsonResponse(result);
});

router.post('/api/fetch-url', async (req) => {
  let url: string;
  try {
    const body = JSON.parse(req.body as unknown as string);
    url = body.url;
  } catch {
    return jsonResponse({ error: '请求体格式错误' }, 400);
  }

  if (!url || typeof url !== 'string') {
    return jsonResponse({ error: '缺少 url 字段' }, 400);
  }

  if (!url.startsWith('http://') && !url.startsWith('https://')) {
    return jsonResponse({ error: 'URL 必须以 http:// 或 https:// 开头' }, 400);
  }

  try {
    const resp = await fetch(url, {
      headers: { 'User-Agent': 'Songloft-Radio-Plugin/1.0' },
    });

    if (!resp.ok) {
      return jsonResponse({ error: `远程服务器返回 ${resp.status}` }, 400);
    }

    const headers = resp.headers as unknown as Record<string, string>;
    const contentType = headers['content-type'] || headers['Content-Type'] || '';
    if (contentType.includes('text/html') && !url.match(/\.m3u8?$/i)) {
      return jsonResponse({ error: 'URL 返回的是 HTML 页面，请确认是 M3U/JSON 文件的直接链接' }, 400);
    }

    const text = await resp.text();

    if (text.length > MAX_CONTENT_SIZE) {
      return jsonResponse({ error: '文件超过 20MB 限制' }, 400);
    }

    return jsonResponse({ content: text });
  } catch (e: any) {
    return jsonResponse({ error: `获取失败: ${e.message}` }, 400);
  }
});

router.get('/api/playlists', async () => {
  const playlists = await songloft.playlists.list();
  const radioPlaylists = playlists.filter((p: any) => p.type === 'radio');
  return jsonResponse({ playlists: radioPlaylists });
});

router.get('/api/settings', async () => {
  const lastPlaylistId = (await songloft.storage.get('last_playlist_id')) as number | null;
  return jsonResponse({ last_playlist_id: lastPlaylistId ?? 2 });
});

router.post('/api/settings', async (req) => {
  try {
    const body = JSON.parse(req.body as unknown as string);
    if (body.last_playlist_id !== undefined) {
      await songloft.storage.set('last_playlist_id', body.last_playlist_id);
    }
  } catch {
    return jsonResponse({ error: '请求体格式错误' }, 400);
  }
  return jsonResponse({ ok: true });
});

globalThis.onHTTPRequest = async (req: HTTPRequest) => router.handle(req);
