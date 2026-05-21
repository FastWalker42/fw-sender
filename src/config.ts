export const BOT_TOKEN = process.env.BOT_TOKEN || "";
export const ADMIN_IDS: number[] = (process.env.ADMIN_IDS || "")
  .split(",")
  .map((s) => parseInt(s.trim(), 10))
  .filter((n) => !isNaN(n));
export const BOT_USERNAME = process.env.BOT_USERNAME || "";
export const API_ID = parseInt(process.env.API_ID || "0", 10);
export const API_HASH = process.env.API_HASH || "";

if (!BOT_TOKEN) {
  console.error("BOT_TOKEN is required. Set it in .env file.");
  process.exit(1);
}

if (ADMIN_IDS.length === 0) {
  console.warn("ADMIN_IDS is empty. No one will have admin access.");
}
