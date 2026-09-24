import { SUPABASE_URL, SUPABASE_ANON_KEY } from './config.js?v=2.2.0';

const STORE_ID = 'main';
let saveTimer = null;
let status = { mode: 'local', lastSync: null, error: '', reachable: false };

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

function headers(extra = {}) {
  return {
    apikey: SUPABASE_ANON_KEY,
    'Content-Type': 'application/json',
    ...extra
  };
}

async function parseError(response) {
  let body = null;
  try { body = await response.json(); } catch { body = null; }
  return body?.message || body?.details || body?.hint || body?.error || `HTTP ${response.status}`;
}

export async function pullCloudState() {
  if (!isCloudConfigured()) return null;
  const response = await fetch(
    `${SUPABASE_URL}/rest/v1/store_state_shared?select=data,updated_at&id=eq.${encodeURIComponent(STORE_ID)}&limit=1`,
    { headers: headers() }
  );
  if (!response.ok) throw new Error(await parseError(response));
  const rows = await response.json();
  const row = Array.isArray(rows) ? rows[0] : null;
  if (row?.updated_at) setStatus({ lastSync: row.updated_at });
  return row?.data || null;
}

export async function pushCloudState(appState) {
  if (!isCloudConfigured()) return false;
  const updatedAt = new Date().toISOString();
  const response = await fetch(`${SUPABASE_URL}/rest/v1/store_state_shared?on_conflict=id`, {
    method: 'POST',
    headers: headers({ Prefer: 'resolution=merge-duplicates,return=minimal' }),
    body: JSON.stringify({ id: STORE_ID, data: appState, updated_at: updatedAt })
  });
  if (!response.ok) {
    const message = await parseError(response);
    setStatus({ mode: 'error', reachable: false, error: message });
    throw new Error(message);
  }
  setStatus({ mode: 'cloud', reachable: true, lastSync: updatedAt, error: '' });
  return true;
}

export async function initCloud() {
  if (!isCloudConfigured()) {
    return setStatus({ mode: 'local', reachable: false, error: '' });
  }
  try {
    const remote = await pullCloudState();
    return { ...setStatus({ mode: 'cloud', reachable: true, error: '' }), data: remote };
  } catch (error) {
    return setStatus({ mode: 'error', reachable: false, error: error.message || String(error) });
  }
}

export function queueCloudSave(appState, onDone) {
  if (!isCloudConfigured()) return;
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
