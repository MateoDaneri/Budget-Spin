/* eslint-disable security/detect-non-literal-fs-filename -- CLI paths are supplied by the local operator, and output is checked and created exclusively. */
import { createHash, randomBytes, timingSafeEqual } from 'node:crypto';
import { createServer } from 'node:http';
import { readFile, writeFile, realpath } from 'node:fs/promises';
import { dirname, isAbsolute, resolve, relative } from 'node:path';
import { fileURLToPath } from 'node:url';

// Run locally with a browser. The output is created once with owner-only access.
const [credentialsPath, outputPath] = process.argv.slice(2);
if (!credentialsPath || !outputPath || !isAbsolute(outputPath)) {
  throw new Error('Usage: node scripts/gmail-oauth-bootstrap.mjs <desktop-client.json> <absolute-output-path>');
}
const repo = await realpath(resolve(dirname(fileURLToPath(import.meta.url)), '..'));
const outputParent = await realpath(dirname(outputPath));
const relativeOutput = relative(repo, resolve(outputParent, outputPath.split('/').at(-1)));
if (!relativeOutput.startsWith('..') || isAbsolute(relativeOutput)) throw new Error('Output must be outside the repository.');
const credentials = JSON.parse(await readFile(credentialsPath, 'utf8')).installed;
if (!credentials?.client_id || !credentials?.client_secret) throw new Error('Expected a Google Desktop OAuth client JSON.');
const verifier = randomBytes(32).toString('base64url');
const challenge = createHash('sha256').update(verifier).digest('base64url');
const state = randomBytes(32).toString('base64url');
const server = createServer();
await new Promise((resolveListen, reject) => { server.once('error', reject); server.listen(0, '127.0.0.1', resolveListen); });
const address = server.address();
const redirect = `http://127.0.0.1:${address.port}/callback`;
const url = new URL('https://accounts.google.com/o/oauth2/v2/auth');
for (const [key, value] of Object.entries({ client_id: credentials.client_id, redirect_uri: redirect, response_type: 'code', scope: 'https://www.googleapis.com/auth/gmail.readonly', access_type: 'offline', code_challenge: challenge, code_challenge_method: 'S256', state })) url.searchParams.set(key, value);
console.log(`Open this URL in a local browser:\n${url}`);
try {
  const code = await new Promise((resolveCode, reject) => {
    const timeout = setTimeout(() => reject(new Error('Authorization timed out.')), 300000);
    server.on('request', (request, response) => {
      const callback = new URL(request.url ?? '/', redirect);
      if (callback.pathname !== '/callback') { response.writeHead(404).end(); return; }
      const received = Buffer.from(callback.searchParams.get('state') ?? '');
      const expected = Buffer.from(state);
      if (received.length !== expected.length || !timingSafeEqual(received, expected)) { response.writeHead(400).end('Invalid state.'); return; }
      clearTimeout(timeout);
      const code = callback.searchParams.get('code');
      if (!code) { response.writeHead(400).end('Authorization denied.'); reject(new Error('Authorization denied.')); return; }
      response.writeHead(200, { 'Content-Type': 'text/plain', 'Cache-Control': 'no-store' }).end('Authorization received. You can close this tab.');
      resolveCode(code);
    });
  });
  const response = await fetch('https://oauth2.googleapis.com/token', { method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' }, body: new URLSearchParams({ code, client_id: credentials.client_id, client_secret: credentials.client_secret, redirect_uri: redirect, grant_type: 'authorization_code', code_verifier: verifier }) });
  if (!response.ok) throw new Error(`Token exchange failed (${response.status}).`);
  const tokens = await response.json();
  if (!tokens.refresh_token) throw new Error('Google did not return a refresh token. Revoke the prior grant and retry.');
  if (typeof tokens.scope !== 'string' || !tokens.scope.split(' ').includes('https://www.googleapis.com/auth/gmail.readonly')) throw new Error('Google did not grant Gmail read-only access.');
  await writeFile(outputPath, JSON.stringify({ clientId: credentials.client_id, clientSecret: credentials.client_secret, refreshToken: tokens.refresh_token }), { mode: 0o600, flag: 'wx' });
  console.log('Credentials stored in the requested file.');
} finally { server.close(); }
