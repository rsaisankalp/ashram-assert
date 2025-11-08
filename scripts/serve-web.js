import { createServer } from 'node:http';
import { readFile, stat } from 'node:fs/promises';
import { readFileSync, existsSync } from 'node:fs';
import { extname, join, normalize, resolve } from 'node:path';
import { randomUUID, createHash } from 'node:crypto';
import process from 'node:process';

loadLocalEnv();

const PORT = Number(process.env.PORT) || 4173;
const HOST = process.env.HOST || '127.0.0.1';
const PUBLIC_DIR = resolve(process.cwd(), 'web');
const B2_CONFIG = {
  keyId: process.env.B2_KEY_ID,
  applicationKey: process.env.B2_APPLICATION_KEY,
  bucketId: process.env.B2_BUCKET_ID,
  bucketName: process.env.B2_BUCKET_NAME,
  downloadUrl: process.env.B2_DOWNLOAD_URL,
};

console.log('[B2] Configuration', {
  keyId: B2_CONFIG.keyId ? `${B2_CONFIG.keyId.slice(0, 4)}***` : null,
  bucketId: B2_CONFIG.bucketId ?? null,
  bucketName: B2_CONFIG.bucketName ?? null,
  downloadUrl: B2_CONFIG.downloadUrl ?? 'default',
});

const MIME_TYPES = {
  '.html': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.gif': 'image/gif',
  '.ico': 'image/x-icon',
  '.txt': 'text/plain; charset=utf-8',
};

function resolvePath(urlPath) {
  const decodedPath = decodeURIComponent(urlPath.split('?')[0]);
  let relativePath = decodedPath;
  if (relativePath === '/' || relativePath === '') {
    relativePath = '/index.html';
  }
  const normalized = normalize(relativePath);
  const absolutePath = resolve(PUBLIC_DIR, `.${normalized}`);
  if (!absolutePath.startsWith(PUBLIC_DIR)) {
    return null;
  }
  return absolutePath;
}

async function sendFile(res, filePath) {
  const ext = extname(filePath).toLowerCase();
  const mime = MIME_TYPES[ext] ?? 'application/octet-stream';
  const data = await readFile(filePath);
  res.writeHead(200, { 'Content-Type': mime, 'Cache-Control': 'no-cache' });
  res.end(data);
}

const server = createServer(async (req, res) => {
  if (req.url?.startsWith('/api/download') && req.method === 'GET') {
    await handleDownloadProxy(req, res);
    return;
  }
  if (req.method !== 'GET') {
    if (req.url.startsWith('/api/upload') && req.method === 'POST') {
      await handleFileUpload(req, res);
      return;
    }
    res.writeHead(405, { 'Content-Type': 'application/json; charset=utf-8' });
    res.end(JSON.stringify({ error: 'Method Not Allowed' }));
    return;
  }

  const filePath = resolvePath(req.url);
  if (!filePath) {
    res.writeHead(400, { 'Content-Type': 'text/plain; charset=utf-8' });
    res.end('Bad Request');
    return;
  }

  try {
    const fileStat = await stat(filePath);
    if (fileStat.isDirectory()) {
      const indexPath = join(filePath, 'index.html');
      await sendFile(res, indexPath);
    } else {
      await sendFile(res, filePath);
    }
  } catch (error) {
    if (error.code === 'ENOENT') {
      // SPA fallback
      try {
        await sendFile(res, join(PUBLIC_DIR, 'index.html'));
      } catch (fallbackError) {
        res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' });
        res.end('Not Found');
      }
    } else {
      res.writeHead(500, { 'Content-Type': 'text/plain; charset=utf-8' });
      res.end('Internal Server Error');
    }
  }
});

server.listen(PORT, HOST, () => {
  console.log(`Web UI available on http://${HOST}:${PORT}`);
});

function loadLocalEnv() {
  try {
    const envPath = resolve(process.cwd(), '.env');
    if (!existsSync(envPath)) {
      return;
    }
    const content = readFileSync(envPath, 'utf8');
    for (const line of content.split('\n')) {
      const trimmed = line.trim();
      if (!trimmed || trimmed.startsWith('#')) continue;
      const normalized = trimmed.startsWith('export ') ? trimmed.slice(7) : trimmed;
      const equalsIndex = normalized.indexOf('=');
      if (equalsIndex === -1) continue;
      const key = normalized.slice(0, equalsIndex).trim();
      let value = normalized.slice(equalsIndex + 1).trim();
      if (value.startsWith('"') && value.endsWith('"')) {
        value = value.slice(1, -1);
      } else if (value.startsWith("'") && value.endsWith("'")) {
        value = value.slice(1, -1);
      }
      if (key && !(key in process.env)) {
        process.env[key] = value;
      }
    }
  } catch {
    // ignore dotenv loading errors
  }
}

const cachedB2Auth = {
  token: null,
  apiUrl: null,
  downloadUrl: null,
  expiresAt: 0,
  downloadTokens: new Map(),
};

async function handleFileUpload(req, res) {
  if (!B2_CONFIG.keyId || !B2_CONFIG.applicationKey || !B2_CONFIG.bucketId || !B2_CONFIG.bucketName) {
    res.writeHead(500, { 'Content-Type': 'application/json; charset=utf-8' });
    res.end(
      JSON.stringify({
        error: 'Backblaze B2 is not configured. Set B2_KEY_ID, B2_APPLICATION_KEY, B2_BUCKET_ID, and B2_BUCKET_NAME.',
      }),
    );
    return;
  }

  const chunks = [];
  let size = 0;
  req.on('data', (chunk) => {
    chunks.push(chunk);
    size += chunk.length;
  });

  req.on('end', async () => {
    const buffer = Buffer.concat(chunks);
    const originalName = decodeURIComponent(req.headers['x-file-name'] ?? `upload-${Date.now()}`);
    const contentType = req.headers['x-file-type'] ?? 'application/octet-stream';
    const ashramId = req.headers['x-ashram-id'] ?? 'unassigned';
    const safeName = sanitizeFileName(originalName);
    const storagePath = `${ashramId}/${Date.now()}-${randomUUID()}-${safeName}`;

    try {
      const uploadResult = await uploadToB2({
        fileName: storagePath,
        contentType,
        data: buffer,
      });
      res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8' });
      res.end(
        JSON.stringify({
          fileName: originalName,
          storagePath,
          size,
          contentType,
          url: uploadResult.downloadUrl,
          bucketId: B2_CONFIG.bucketId,
          uploadedAt: new Date().toISOString(),
        }),
      );
      console.log('[B2] Uploaded', storagePath);
    } catch (error) {
      console.error('B2 upload failed', error);
      res.writeHead(500, { 'Content-Type': 'application/json; charset=utf-8' });
      res.end(JSON.stringify({ error: error.message ?? 'Upload failed' }));
    }
  });
}

function sanitizeFileName(name) {
  return name.replace(/[^a-zA-Z0-9._-]/g, '_');
}

async function authorizeB2() {
  if (!B2_CONFIG.keyId || !B2_CONFIG.applicationKey) {
    throw new Error('Missing B2 credentials. Set B2_KEY_ID and B2_APPLICATION_KEY.');
  }
  const now = Date.now();
  if (cachedB2Auth.token && cachedB2Auth.expiresAt > now + 60 * 1000) {
    return cachedB2Auth;
  }
  const credentials = Buffer.from(`${B2_CONFIG.keyId}:${B2_CONFIG.applicationKey}`).toString('base64');
  const response = await fetch('https://api.backblazeb2.com/b2api/v3/b2_authorize_account', {
    headers: { Authorization: `Basic ${credentials}` },
  });
  if (!response.ok) {
    throw new Error(`B2 authorization failed (${response.status})`);
  }
  const data = await response.json();
  cachedB2Auth.token = data.authorizationToken;
  const apiUrl = data.apiUrl ?? data.apiInfo?.storageApi?.apiUrl;
  const downloadUrlDefault = data.downloadUrl ?? data.apiInfo?.storageApi?.downloadUrl;
  if (!apiUrl || !downloadUrlDefault) {
    throw new Error('B2 authorization response missing apiUrl/downloadUrl');
  }
  cachedB2Auth.apiUrl = apiUrl;
  cachedB2Auth.downloadUrl = B2_CONFIG.downloadUrl ?? downloadUrlDefault;
  cachedB2Auth.expiresAt = now + 1000 * 60 * 30; // 30 minutes cache
  return cachedB2Auth;
}

async function getUploadUrl() {
  if (cachedB2Auth.uploadUrl && cachedB2Auth.uploadAuthToken && cachedB2Auth.uploadExpiresAt > Date.now() + 60 * 1000) {
    return cachedB2Auth;
  }
  const auth = await authorizeB2();
  const response = await fetch(`${auth.apiUrl}/b2api/v3/b2_get_upload_url`, {
    method: 'POST',
    headers: { Authorization: auth.token, 'Content-Type': 'application/json' },
    body: JSON.stringify({ bucketId: B2_CONFIG.bucketId }),
  });
  if (!response.ok) {
    throw new Error(`Failed to get B2 upload URL (${response.status})`);
  }
  const data = await response.json();
  cachedB2Auth.uploadUrl = data.uploadUrl;
  cachedB2Auth.uploadAuthToken = data.authorizationToken;
  cachedB2Auth.uploadExpiresAt = Date.now() + 1000 * 60 * 55;
  return cachedB2Auth;
}

async function uploadToB2({ fileName, contentType, data }) {
  const auth = await getUploadUrl();
  const sha1 = createHash('sha1').update(data).digest('hex');
  const response = await fetch(auth.uploadUrl, {
    method: 'POST',
    headers: {
      Authorization: auth.uploadAuthToken,
      'Content-Type': contentType,
      'X-Bz-File-Name': encodeURIComponent(fileName),
      'X-Bz-Content-Sha1': sha1,
    },
    body: data,
  });
  if (!response.ok) {
    const errorText = await response.text();
    throw new Error(`B2 upload failed (${response.status}): ${errorText}`);
  }
  const result = await response.json();
  const downloadUrl = `${cachedB2Auth.downloadUrl}/file/${B2_CONFIG.bucketName}/${encodeURI(fileName)}`;
  return { ...result, downloadUrl };
}

async function handleDownloadProxy(req, res) {
  try {
    if (!B2_CONFIG.bucketName || !B2_CONFIG.bucketId) {
      throw new Error('Backblaze B2 is not configured for downloads.');
    }
    const url = new URL(req.url, `http://${req.headers.host}`);
    const path = url.searchParams.get('path');
    if (!path) {
      res.writeHead(400, { 'Content-Type': 'application/json; charset=utf-8' });
      res.end(JSON.stringify({ error: 'Missing path query param' }));
      return;
    }
    if (path.includes('..')) {
      res.writeHead(400, { 'Content-Type': 'application/json; charset=utf-8' });
      res.end(JSON.stringify({ error: 'Invalid file path' }));
      return;
    }
    const token = await getDownloadToken(path);
    const encodedPath = encodeURI(path);
    const downloadUrl = `${cachedB2Auth.downloadUrl}/file/${B2_CONFIG.bucketName}/${encodedPath}?Authorization=${token}`;
    res.writeHead(302, { Location: downloadUrl });
    res.end();
  } catch (error) {
    console.error('B2 download failed', error);
    res.writeHead(500, { 'Content-Type': 'application/json; charset=utf-8' });
    res.end(JSON.stringify({ error: error.message ?? 'Download failed' }));
  }
}

async function getDownloadToken(filePath) {
  const now = Date.now();
  const cacheEntry = cachedB2Auth.downloadTokens.get(filePath);
  if (cacheEntry && cacheEntry.expiresAt > now + 10 * 1000) {
    return cacheEntry.token;
  }
  const auth = await authorizeB2();
  const body = {
    bucketId: B2_CONFIG.bucketId,
    fileNamePrefix: filePath,
    validDurationInSeconds: 60 * 5,
  };
  const response = await fetch(`${auth.apiUrl}/b2api/v3/b2_get_download_authorization`, {
    method: 'POST',
    headers: { Authorization: auth.token, 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  if (!response.ok) {
    const text = await response.text();
    throw new Error(`Failed to obtain download authorization (${response.status}): ${text}`);
  }
  const data = await response.json();
  cachedB2Auth.downloadTokens.set(filePath, {
    token: data.authorizationToken,
    expiresAt: now + data.validDurationInSeconds * 1000,
  });
  return data.authorizationToken;
}
