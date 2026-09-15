import { createClient } from '@supabase/supabase-js';

const configuredUrl = import.meta.env.VITE_SUPABASE_URL?.trim();
const url = configuredUrl?.replace(/\/(?:rest|auth|storage)\/v1\/?$/, '').replace(/\/$/, '');
const key = import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY?.trim();

export const supabase = url && key ? createClient(url, key) : null;
