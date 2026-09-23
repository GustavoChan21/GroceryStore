import { SUPABASE_URL, SUPABASE_ANON_KEY } from './config.js';

let client = null;
let currentUser = null;
let saveTimer = null;
let status = { mode: 'local', user: null, lastSync: null, error: '' };

export const isCloudConfigured = () => Boolean(
  SUPABASE_URL && SUPABASE_ANON_KEY &&
  /^https:\/\//.test(SUPABASE_URL) &&
  !SUPABASE_URL.includes('TU_') && !SUPABASE_ANON_KEY.includes('TU_')
);

async function getClient() {
  if (!isCloudConfigured()) return null;
  if (!client) {
    const { createClient } = await import('https://esm.sh/@supabase/supabase-js@2');
    client = createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
      auth: { persistSession: true, autoRefreshToken: true, detectSessionInUrl: true }
    });
  }
  return client;
}

function setStatus(patch) {
  status = { ...status, ...patch };
  return { ...status };
}

export function getCloudStatus() { return { ...status }; }

export async function initCloud() {
  if (!isCloudConfigured()) return setStatus({ mode: 'local', user: null, error: '' });
  try {
    const sb = await getClient();
    const { data: { session }, error } = await sb.auth.getSession();
    if (error) throw error;
    currentUser = session?.user || null;
    if (!currentUser) return setStatus({ mode: 'configured', user: null, error: '' });
    const remote = await pullCloudState();
    return { ...setStatus({ mode: 'cloud', user: currentUser, error: '' }), data: remote };
  } catch (error) {
    return setStatus({ mode: 'error', user: null, error: error.message || String(error) });
  }
}

export async function signInCloud(email, password) {
  const sb = await getClient();
  if (!sb) throw new Error('Supabase aún no está configurado en config.js');
  const { data, error } = await sb.auth.signInWithPassword({ email, password });
  if (error) throw error;
  currentUser = data.user;
  const remote = await pullCloudState();
  setStatus({ mode: 'cloud', user: currentUser, error: '' });
  return { user: currentUser, data: remote };
}

export async function signUpCloud(email, password) {
  const sb = await getClient();
  if (!sb) throw new Error('Supabase aún no está configurado en config.js');
  const { data, error } = await sb.auth.signUp({ email, password });
  if (error) throw error;
  currentUser = data.session?.user || null;
  if (currentUser) setStatus({ mode: 'cloud', user: currentUser, error: '' });
  return { user: data.user, session: data.session };
}

export async function signOutCloud() {
  const sb = await getClient();
  if (sb) await sb.auth.signOut();
  currentUser = null;
  setStatus({ mode: isCloudConfigured() ? 'configured' : 'local', user: null, lastSync: null, error: '' });
}

export async function pullCloudState() {
  if (!currentUser) return null;
  const sb = await getClient();
  const { data, error } = await sb.from('store_state').select('data,updated_at').eq('user_id', currentUser.id).maybeSingle();
  if (error) throw error;
  if (data?.updated_at) setStatus({ lastSync: data.updated_at });
  return data?.data || null;
}

export async function pushCloudState(appState) {
  if (!currentUser) return false;
  const sb = await getClient();
  const updatedAt = new Date().toISOString();
  const { error } = await sb.from('store_state').upsert({
    user_id: currentUser.id,
    data: appState,
    updated_at: updatedAt
  }, { onConflict: 'user_id' });
  if (error) {
    setStatus({ mode: 'error', error: error.message || String(error) });
    throw error;
  }
  setStatus({ mode: 'cloud', lastSync: updatedAt, error: '' });
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
