interface ClientEnv {
  NEXT_PUBLIC_SUPABASE_URL: string;
  NEXT_PUBLIC_SUPABASE_ANON_KEY: string;
}

interface ServerEnv extends ClientEnv {
  SUPABASE_SERVICE_ROLE_KEY: string;
  DEEPSEEK_API_KEY: string;
  GEMINI_API_KEY: string;
}

function validateUrl(url: string, keyName: string): string {
  try {
    new URL(url);
    return url;
  } catch {
    throw new Error(`[Env Error] Invalid URL provided for ${keyName}: "${url}"`);
  }
}

export function getClientEnv(): ClientEnv {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;

  if (!url) throw new Error('[Env Error] Missing: NEXT_PUBLIC_SUPABASE_URL');
  if (!anonKey) throw new Error('[Env Error] Missing: NEXT_PUBLIC_SUPABASE_ANON_KEY');

  return {
    NEXT_PUBLIC_SUPABASE_URL: validateUrl(url, 'NEXT_PUBLIC_SUPABASE_URL'),
    NEXT_PUBLIC_SUPABASE_ANON_KEY: anonKey,
  };
}

export function getServerEnv(): ServerEnv {
  const clientEnv = getClientEnv();
  const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  const deepseekApiKey = process.env.DEEPSEEK_API_KEY;
  const geminiApiKey = process.env.GEMINI_API_KEY;

  const missingKeys: string[] = [];
  if (!serviceRoleKey) missingKeys.push('SUPABASE_SERVICE_ROLE_KEY');
  if (!deepseekApiKey) missingKeys.push('DEEPSEEK_API_KEY');
  if (!geminiApiKey) missingKeys.push('GEMINI_API_KEY');

  if (missingKeys.length > 0) {
    throw new Error(`[Env Error] Missing server variables: ${missingKeys.join(', ')}`);
  }

  return {
    ...clientEnv,
    SUPABASE_SERVICE_ROLE_KEY: serviceRoleKey!,
    DEEPSEEK_API_KEY: deepseekApiKey!,
    GEMINI_API_KEY: geminiApiKey!,
  };
}
