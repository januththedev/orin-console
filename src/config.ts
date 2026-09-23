function required(name: string): string {
  const v = process.env[name];
  if (!v) throw new Error(`Missing required env: ${name}`);
  return v;
}

export const DATABASE_URL = () => required('DATABASE_URL');
export const TOKEN_KEY = () => {
  const k = required('TOKEN_ENCRYPTION_KEY');
  if (k.length < 32) throw new Error('TOKEN_ENCRYPTION_KEY must be >= 32 chars');
  return k;
};
