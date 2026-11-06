// The Supabase project behind the leaderboard. Copy both values from the Supabase dashboard: the Connect
// button at the top of the project shows the project URL (https://<ref>.supabase.co) and the publishable
// key (sb_publishable_…); they are also under Project Settings → API Keys. An older project may still
// show a legacy "anon" key (a long string starting with eyJ), which works here too. Never the secret key.
// Both values are meant to be public: the browser sends them with every request, and the database side
// (supabase/schema.sql) lets that key do nothing but call the four leaderboard functions. Leave both
// empty and the game runs without a leaderboard.
export const SUPABASE_URL = 'https://zfetpqaztihirfltjawy.supabase.co';
export const SUPABASE_KEY = 'sb_publishable_Q8_mR-QXWRS8lvkf2A7K4A_SASCiKvG';
