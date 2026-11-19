/* Your two Supabase values. Both are safe to keep here: the publishable key is meant to be public,
   the database rules (schema.sql) protect your data. NEVER put a secret / service_role key in this file. */
window.CLASSHUB_CONFIG = {
  SUPABASE_URL: "https://zjxeuwbghlwzpxkxldbu.supabase.co",
  SUPABASE_ANON_KEY: "sb_publishable_qXtD5BbsWTu91lbNB4NnTg_bxyiRTKN",
  /* Public push key (safe to keep here). Paste the PUBLIC key from vapid-keys.html. NEVER paste the private key here. */
  VAPID_PUBLIC_KEY: "BJiTsuOfK7xw9POiqhHwpmdx7HiXaLmDBPOV_0hJUwS0lorCJDgSyC3vteFva8aQxZa8ocSC1agTRIcpGie_vy0"
  /* Only if sign up says the email is invalid, add:  , AUTH_DOMAIN: "gmail.com"  (see SETUP.md) */
};
