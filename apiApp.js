const express = require('express');
const axios = require('axios');
const cheerio = require('cheerio');

// Basit cache: username -> { url, ts }
const profilePicCache = new Map();
const CACHE_TTL_MS = 1000 * 60 * 10; // 10 dakika

class HttpError extends Error {
  constructor(status, message) {
    super(message);
    this.status = status;
  }
}

function normalizeInstagramUsername(raw) {
  if (!raw) return '';
  let s = String(raw).trim();
  if (/^https?:\/\//i.test(s)) {
    try {
      const u = new URL(s);
      const parts = u.pathname.split('/').filter(Boolean);
      if (parts.length > 0) s = parts[0];
    } catch (_) {}
  }
  if (s.startsWith('@')) s = s.slice(1);
  s = s.replace(/\s+/g, '');
  return s.toLowerCase();
}

async function fetchViaInstagramWebApi(username) {
  const apiUrl = `https://i.instagram.com/api/v1/users/web_profile_info/?username=${encodeURIComponent(username)}`;
  const resp = await axios.get(apiUrl, {
    headers: {
      'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36',
      'x-ig-app-id': '936619743392459',
      'Accept': 'application/json, text/plain, */*',
      'Accept-Language': 'tr-TR,tr;q=0.9,en-US;q=0.8,en;q=0.7'
    },
    timeout: 10000,
    validateStatus: () => true,
  });

  if (resp.status === 404) {
    throw new HttpError(404, 'Kullanıcı bulunamadı');
  }
  if (resp.status !== 200) {
    throw new Error(`Instagram API yanıtı başarısız (HTTP ${resp.status})`);
  }

  const data = resp.data;
  const user = data && data.data && data.data.user ? data.data.user : null;
  if (!user) {
    throw new HttpError(404, 'Kullanıcı bulunamadı');
  }
  if (user.profile_pic_url_hd) return user.profile_pic_url_hd;
  if (user.profile_pic_url) return user.profile_pic_url;
  throw new Error('Instagram API içinde profil fotoğrafı alanı bulunamadı');
}

async function fetchInstagramProfilePicUrl(username) {
  const cached = profilePicCache.get(username);
  const now = Date.now();
  if (cached && now - cached.ts < CACHE_TTL_MS) {
    return cached.url;
  }
  try {
    console.log(`[api] trying web_profile_info for @${username}`);
    const apiResultUrl = await fetchViaInstagramWebApi(username);
    profilePicCache.set(username, { url: apiResultUrl, ts: now });
    return apiResultUrl;
  } catch (e) {
    if (e && e.status === 404) throw e;
    console.log(`[api] web_profile_info failed for @${username}: ${e && e.message}`);
  }

  // Instagram profil sayfasını çek (Googlebot UA ile)
  const profileUrl = `https://www.instagram.com/${encodeURIComponent(username)}/`;
  const resp = await axios.get(profileUrl, {
    headers: {
      'User-Agent': 'Mozilla/5.0 (compatible; Googlebot/2.1; +http://www.google.com/bot.html)',
      'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,*/*;q=0.8',
      'Accept-Language': 'en-US,en;q=0.7,tr-TR;q=0.6,tr;q=0.5',
      'Referer': 'https://www.google.com/'
    },
    validateStatus: () => true,
  });
  if (resp.status === 404) {
    throw new HttpError(404, 'Kullanıcı bulunamadı');
  }
  if (resp.status < 400) {
    const html = resp.data;
    const $ = cheerio.load(html);
    const ogImage = $('meta[property="og:image"]').attr('content');
    if (ogImage) {
      profilePicCache.set(username, { url: ogImage, ts: now });
      return ogImage;
    }
    const twImage = $('meta[name="twitter:image"]').attr('content');
    if (twImage) {
      profilePicCache.set(username, { url: twImage, ts: now });
      return twImage;
    }
    const scriptTags = $('script');
    for (let i = 0; i < scriptTags.length; i += 1) {
      const text = $(scriptTags[i]).html() || '';
      if (text.includes('profile_pic_url_hd') || text.includes('profile_pic_url')) {
        const matchHd = text.match(/\"profile_pic_url_hd\"\s*:\s*\"(.*?)\"/);
        if (matchHd && matchHd[1]) {
          const url = JSON.parse(`\"${matchHd[1]}\"`);
          profilePicCache.set(username, { url, ts: now });
          return url;
        }
        const match = text.match(/\"profile_pic_url\"\s*:\s*\"(.*?)\"/);
        if (match && match[1]) {
          const url = JSON.parse(`\"${match[1]}\"`);
          profilePicCache.set(username, { url, ts: now });
          return url;
        }
      }
    }
  }

  // 4) r.jina.ai üzerinden Instagram Web API'yi dene (proxy)
  try {
    const proxyApiUrl = `https://r.jina.ai/http://i.instagram.com/api/v1/users/web_profile_info/?username=${encodeURIComponent(username)}`;
    const proxyResp = await axios.get(proxyApiUrl, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36'
      },
      timeout: 10000,
      responseType: 'text',
      validateStatus: () => true,
    });
    if (proxyResp.status === 404) {
      throw new HttpError(404, 'Kullanıcı bulunamadı');
    }
    if (proxyResp.status === 200 && typeof proxyResp.data === 'string') {
      try {
        const json = JSON.parse(proxyResp.data);
        const user = json && json.data && json.data.user ? json.data.user : null;
        if (user) {
          const url = user.profile_pic_url_hd || user.profile_pic_url;
          if (url) {
            profilePicCache.set(username, { url, ts: now });
            return url;
          }
        }
      } catch (_) {}
    }
  } catch (_) {}

  // 5) r.jina.ai üzerinden HTML metni çekip regex ile ara
  try {
    const proxyHtmlUrl = `https://r.jina.ai/http://www.instagram.com/${encodeURIComponent(username)}/`;
    const proxyHtmlResp = await axios.get(proxyHtmlUrl, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36'
      },
      timeout: 10000,
      responseType: 'text',
      validateStatus: () => true,
    });
    if (proxyHtmlResp.status === 404) {
      throw new HttpError(404, 'Kullanıcı bulunamadı');
    }
    if (proxyHtmlResp.status === 200 && typeof proxyHtmlResp.data === 'string') {
      const text = proxyHtmlResp.data;
      const hd = text.match(/"profile_pic_url_hd"\s*:\s*"(.*?)"/);
      if (hd && hd[1]) {
        const url = JSON.parse(`"${hd[1]}"`);
        profilePicCache.set(username, { url, ts: now });
        return url;
      }
      const normal = text.match(/"profile_pic_url"\s*:\s*"(.*?)"/);
      if (normal && normal[1]) {
        const url = JSON.parse(`"${normal[1]}"`);
        profilePicCache.set(username, { url, ts: now });
        return url;
      }
    }
  } catch (_) {}

  throw new HttpError(404, 'Profil fotoğrafı bulunamadı. Kullanıcı adı yanlış olabilir, hesap gizli olabilir ya da Instagram erişimi engellenmiş olabilir.');
}

async function processWithConcurrency(items, worker, concurrency) {
  const results = new Array(items.length);
  let nextIndex = 0;

  async function runOne() {
    // eslint-disable-next-line no-constant-condition
    while (true) {
      const currentIndex = nextIndex;
      if (currentIndex >= items.length) return;
      nextIndex += 1;
      const item = items[currentIndex];
      try {
        results[currentIndex] = await worker(item);
      } catch (error) {
        results[currentIndex] = { error: error && error.message ? error.message : String(error) };
      }
    }
  }

  const workers = [];
  const poolSize = Math.max(1, Math.min(concurrency, items.length));
  for (let i = 0; i < poolSize; i += 1) workers.push(runOne(i));
  await Promise.all(workers);
  return results;
}

const apiApp = express();
apiApp.use(express.json({ limit: '1mb' }));

apiApp.get('/profile-photo', async (req, res) => {
  const username = normalizeInstagramUsername(req.query.username || '');
  if (!username) {
    return res.status(400).json({ error: 'username parametresi zorunlu' });
  }
  try {
    const url = await fetchInstagramProfilePicUrl(username);
    return res.json({ url });
  } catch (err) {
    const status = err && Number.isInteger(err.status) ? err.status : 500;
    return res.status(status).json({ error: err.message || 'Bilinmeyen hata' });
  }
});

apiApp.post('/profile-photos', async (req, res) => {
  try {
    const raw = req.body && (req.body.usernames ?? req.body.text ?? '');
    let usernames = [];
    if (Array.isArray(raw)) {
      usernames = raw.map((x) => normalizeInstagramUsername(String(x))).filter(Boolean);
    } else if (typeof raw === 'string') {
      usernames = raw
        .split(/[\s,;]+/)
        .map((s) => normalizeInstagramUsername(s))
        .filter(Boolean);
    } else {
      return res.status(400).json({ error: 'usernames alanı (virgüllü string veya dizi) zorunlu.' });
    }

    const unique = Array.from(new Set(usernames));
    const MAX = 2000;
    const trimmed = unique.slice(0, MAX);

    const startedAt = Date.now();
    const CONCURRENCY = 2; // Netlify üzerinde anti-bot riskini azaltmak için düşük tutuldu

    const results = await processWithConcurrency(
      trimmed,
      async (username) => {
        try {
          const url = await fetchInstagramProfilePicUrl(username);
          return { username, url };
        } catch (e) {
          const status = e && Number.isInteger(e.status) ? e.status : undefined;
          return { username, error: e && e.message ? e.message : 'Hata', status };
        }
      },
      CONCURRENCY
    );

    const durationMs = Date.now() - startedAt;
    const success = results.filter((r) => r && r.url).length;
    const failed = results.length - success;
    return res.json({ results, meta: { total: results.length, success, failed, durationMs } });
  } catch (err) {
    return res.status(500).json({ error: err.message || 'Bilinmeyen hata' });
  }
});

// GET ile de toplu çalıştırma: /profile-photos?usernames=a,b,c
apiApp.get('/profile-photos', async (req, res) => {
  try {
    const raw = req.query.usernames || '';
    const usernames = String(raw)
      .split(/[\s,;]+/)
      .map((s) => normalizeInstagramUsername(s))
      .filter(Boolean);
    if (usernames.length === 0) {
      return res.json({ results: [], meta: { total: 0, success: 0, failed: 0, durationMs: 0 } });
    }

    const unique = Array.from(new Set(usernames));
    const MAX = 2000;
    const trimmed = unique.slice(0, MAX);

    const startedAt = Date.now();
    const CONCURRENCY = 2; // Netlify üzerinde anti-bot riskini azaltmak için düşük tutuldu

    const results = await processWithConcurrency(
      trimmed,
      async (username) => {
        try {
          const url = await fetchInstagramProfilePicUrl(username);
          return { username, url };
        } catch (e) {
          const status = e && Number.isInteger(e.status) ? e.status : undefined;
          return { username, error: e && e.message ? e.message : 'Hata', status };
        }
      },
      CONCURRENCY
    );

    const durationMs = Date.now() - startedAt;
    const success = results.filter((r) => r && r.url).length;
    const failed = results.length - success;
    return res.json({ results, meta: { total: results.length, success, failed, durationMs } });
  } catch (err) {
    return res.status(500).json({ error: err.message || 'Bilinmeyen hata' });
  }
});

// Görsel proxy ucu
apiApp.get('/profile-photo/image', async (req, res) => {
  const username = normalizeInstagramUsername(req.query.username || '');
  if (!username) {
    return res.status(400).json({ error: 'username parametresi zorunlu' });
  }
  try {
    const imageUrl = await fetchInstagramProfilePicUrl(username);
    // Netlify/Serverless ortamlarında akış (stream) cevapları sorun çıkarabildiği için
    // doğrudan kaynak görsele yönlendirelim
    if (process.env.NETLIFY || process.env.AWS_LAMBDA_FUNCTION_NAME) {
      return res.redirect(imageUrl);
    }
    try {
      const upstream = await axios.get(imageUrl, {
        responseType: 'stream',
        headers: {
          'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36',
          'Accept': 'image/avif,image/webp,image/apng,image/*,*/*;q=0.8',
          'Referer': 'https://www.instagram.com/',
        },
        validateStatus: () => true,
      });
      if (upstream.status >= 200 && upstream.status < 300) {
        const contentType = upstream.headers['content-type'] || 'image/jpeg';
        const cacheControl = upstream.headers['cache-control'] || 'public, max-age=600';
        res.setHeader('Content-Type', contentType);
        res.setHeader('Cache-Control', cacheControl);
        return upstream.data.pipe(res);
      }
      throw new Error(`upstream image status ${upstream.status}`);
    } catch (_) {
      const proxied = `https://images.weserv.nl/?url=${encodeURIComponent(imageUrl.replace(/^https?:\/\//, ''))}`;
      const alt = await axios.get(proxied, { responseType: 'stream', validateStatus: () => true });
      if (alt.status >= 200 && alt.status < 300) {
        const contentType = alt.headers['content-type'] || 'image/jpeg';
        res.setHeader('Content-Type', contentType);
        res.setHeader('Cache-Control', 'public, max-age=600');
        return alt.data.pipe(res);
      }
      return res.redirect(imageUrl);
    }
  } catch (err) {
    const status = err && Number.isInteger(err.status) ? err.status : 500;
    return res.status(status).json({ error: err.message || 'Bilinmeyen hata' });
  }
});

module.exports = { apiApp };


