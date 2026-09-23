import { SUPABASE_URL, SUPABASE_ANON_KEY } from './config.js?v=2.1.1';

const SESSION_KEY = 'grocery_supabase_session_v1';
let currentUser = null;
let session = null;
let saveTimer = null;
let status = { mode: 'local', user: null, lastSync: null, error: '', reachable: false };

export const isCloudConfigured = () => Boolean(
  SUPABASE_URL && SUPABASE_ANON_KEY &&
  /^https:\/\//.test(SUPABASE_URL) &&
  !SUPABASE_URL.includes('TU_') && !SUPABASE_ANON_KEY.includes('TU_')
);

function setStatus(patch) {
  status = { ...status, ...patch };
  return { ...status };
}

export function getCloudStatus() { return { ...status }; }

function authHeaders(accessToken = null) {
  return {
    apikey: SUPABASE_ANON_KEY,
    Authorization: `Bearer ${accessToken || SUPABASE_ANON_KEY}`,
    'Content-Type': 'application/json'
  };
}

function saveSession(next) {
  session = next || null;
  if (session) localStorage.setItem(SESSION_KEY, JSON.stringify(session));
  else localStorage.removeItem(SESSION_KEY);
}

function loadSession() {
  try { return JSON.parse(localStorage.getItem(SESSION_KEY) || 'null'); }
  catch { return null; }
}

function normalizeSession(payload) {
  if (!payload?.access_token) return null;
  const expiresAt = payload.expires_at || Math.floor(Date.now() / 1000) + Number(payload.expires_in || 3600);
  return {
    access_token: payload.access_token,
    refresh_token: payload.refresh_token,
    token_type: payload.token_type || 'bearer',
    expires_at: expiresAt,
    user: payload.user || session?.user || null
  };
}

async function jsonRequest(url, options = {}) {
  const response = await fetch(url, options);
  let body = null;
  try { body = await response.json(); } catch { body = null; }
  if (!response.ok) {
    const message = body?.msg || body?.message || body?.error_description || body?.error || `HTTP ${response.status}`;
    throw new Error(message);
  }
  return body;
}

export async function testCloudConnection() {
  if (!isCloudConfigured()) return false;
  try {
    const response = await fetch(`${SUPABASE_URL}/rest/v1/`, {
      method: 'GET',
      headers: { apikey: SUPABASE_ANON_KEY, Authorization: `Bearer ${SUPABASE_ANON_KEY}` }
    });
    const ok = response.ok;
    setStatus({ reachable: ok, mode: ok && !currentUser ? 'ready' : status.mode, error: ok ? '' : `HTTP ${response.status}` });
    return ok;
  } catch (error) {
    setStatus({ reachable: false, mode: 'error', error: error.message || String(error) });
    return false;
  }
}

async function refreshSessionIfNeeded() {
  if (!session?.refresh_token) return false;
  const expiresSoon = Number(session.expires_at || 0) <= Math.floor(Date.now() / 1000) + 60;
  if (!expiresSoon) return true;
  try {
    const data = await jsonRequest(`${SUPABASE_URL}/auth/v1/token?grant_type=refresh_token`, {
      method: 'POST',
      headers: authHeaders(),
      body: JSON.stringify({ refresh_token: session.refresh_token })
    });
    saveSession(normalizeSession(data));
    currentUser = session?.user || null;
    return Boolean(session?.access_token);
  } catch {
    saveSession(null);
    currentUser = null;
    return false;
  }
}

async function validateStoredSession() {
  session = loadSession();
  if (!session?.access_token) return false;
  await refreshSessionIfNeeded();
  if (!session?.access_token) return false;
  try {
    const user = await jsonRequest(`${SUPABASE_URL}/auth/v1/user`, {
      headers: authHeaders(session.access_token)
    });
    currentUser = user;
    session.user = user;
    saveSession(session);
    return true;
  } catch {
    saveSession(null);
    currentUser = null;
    return false;
  }
}

export async function initCloud() {
  if (!isCloudConfigured()) return setStatus({ mode: 'local', user: null, reachable: false, error: '' });
  try {
    const reachable = await testCloudConnection();
    if (!reachable) return getCloudStatus();
    const hasSession = await validateStoredSession();
    if (!hasSession) return setStatus({ mode: 'ready', user: null, reachable: true, error: '' });
    const remote = await pullCloudState();
    return { ...setStatus({ mode: 'cloud', user: currentUser, reachable: true, error: '' }), data: remote };
  } catch (error) {
    return setStatus({ mode: 'error', user: null, error: error.message || String(error) });
  }
}

export async function signInCloud(email, password) {
  if (!isCloudConfigured()) throw new Error('Supabase aún no está configurado en config.js');
  const data = await jsonRequest(`${SUPABASE_URL}/auth/v1/token?grant_type=password`, {
    method: 'POST',
    headers: authHeaders(),
    body: JSON.stringify({ email, password })
  });
  saveSession(normalizeSession(data));
  currentUser = session?.user || data.user || null;
  if (!currentUser) throw new Error('No fue posible obtener el usuario autenticado.');
  const remote = await pullCloudState();
  setStatus({ mode: 'cloud', user: currentUser, reachable: true, error: '' });
  return { user: currentUser, data: remote };
}

export async function signUpCloud(email, password) {
  if (!isCloudConfigured()) throw new Error('Supabase aún no está configurado en config.js');
  const data = await jsonRequest(`${SUPABASE_URL}/auth/v1/signup`, {
    method: 'POST',
    headers: authHeaders(),
    body: JSON.stringify({ email, password })
  });
  const nextSession = normalizeSession(data);
  if (nextSession) {
    saveSession(nextSession);
    currentUser = nextSession.user || data.user || null;
    setStatus({ mode: 'cloud', user: currentUser, reachable: true, error: '' });
  } else {
    currentUser = null;
    setStatus({ mode: 'ready', user: null, reachable: true, error: '' });
  }
  return { user: data.user || null, session: nextSession };
}

export async function signOutCloud() {
  if (session?.access_token) {
    try {
      await fetch(`${SUPABASE_URL}/auth/v1/logout`, {
        method: 'POST',
        headers: authHeaders(session.access_token)
      });
    } catch { /* local logout still proceeds */ }
  }
  saveSession(null);
  currentUser = null;
  setStatus({ mode: isCloudConfigured() ? 'ready' : 'local', user: null, lastSync: null, error: '', reachable: isCloudConfigured() });
}

async function ensureActiveSession() {
  if (!currentUser || !session?.access_token) return false;
  const ok = await refreshSessionIfNeeded();
  if (!ok) {
    currentUser = null;
    setStatus({ mode: 'ready', user: null, error: 'La sesión expiró. Inicia sesión nuevamente.' });
    return false;
  }
  return true;
}

export async function pullCloudState() {
  if (!(await ensureActiveSession())) return null;
  const rows = await jsonRequest(`${SUPABASE_URL}/rest/v1/store_state?select=data,updated_at&user_id=eq.${encodeURIComponent(currentUser.id)}&limit=1`, {
    headers: authHeaders(session.access_token)
  });
  const row = Array.isArray(rows) ? rows[0] : null;
  if (row?.updated_at) setStatus({ lastSync: row.updated_at });
  return row?.data || null;
}

export async function pushCloudState(appState) {
  if (!(await ensureActiveSession())) return false;
  const updatedAt = new Date().toISOString();
  const response = await fetch(`${SUPABASE_URL}/rest/v1/store_state?on_conflict=user_id`, {
    method: 'POST',
    headers: {
      ...authHeaders(session.access_token),
      Prefer: 'resolution=merge-duplicates,return=minimal'
    },
    body: JSON.stringify({ user_id: currentUser.id, data: appState, updated_at: updatedAt })
  });
  if (!response.ok) {
    let body = null; try { body = await response.json(); } catch {}
    const message = body?.message || body?.error || `HTTP ${response.status}`;
    setStatus({ mode: 'error', error: message });
    throw new Error(message);
  }
  setStatus({ mode: 'cloud', user: currentUser, reachable: true, lastSync: updatedAt, error: '' });
  return true;
}

export function queueCloudSave(appState, onDone) {
  if (!currentUser) return;
  clearTimeout(saveTimer);
  const snapshot = JSON.parse(JSON.stringify(appState));
  saveTimer = setTimeout(async () => {
    try {
      await pushCloudState(snapshot);
      onDone?.(null, getCloudStatus());
    } catch (error) {
      onDone?.(error, getCloudStatus());
    }
  }, 500);
}
