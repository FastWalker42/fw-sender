import { TelegramClient, SentCode } from "@mtcute/bun";
import { API_ID, API_HASH } from "../config";

let client: TelegramClient | null = null;
let loggedIn = false;

/** Pending sign-in state (phone code hash) */
let pendingSignIn: { phone: string; phoneCodeHash: string } | null = null;

export function getPendingSignIn() {
  return pendingSignIn;
}

export function setPendingSignIn(state: { phone: string; phoneCodeHash: string } | null) {
  pendingSignIn = state;
}

function createClient(): TelegramClient {
  if (!API_ID || !API_HASH) {
    throw new Error("API_ID and API_HASH are required for userbot. Set them in .env");
  }
  return new TelegramClient({
    apiId: API_ID,
    apiHash: API_HASH,
    storage: "userbot.session",
  });
}

export async function initUserbot(): Promise<boolean> {
  if (!API_ID || !API_HASH) {
    console.log("[userbot] API_ID/API_HASH not set, skipping");
    return false;
  }

  try {
    client = createClient();
    await client.connect();
    const me = await client.getMe();
    loggedIn = true;
    console.log(`[userbot] connected as ${me.displayName}`);
    return true;
  } catch {
    loggedIn = false;
    console.log("[userbot] no active session");
    return false;
  }
}

export function getClient(): TelegramClient | null {
  return loggedIn ? client : null;
}

export function isLoggedIn(): boolean {
  return loggedIn;
}

export async function sendCode(phone: string): Promise<void> {
  if (!client) client = createClient();
  await client.connect();
  const result = await client.sendCode({ phone });
  if (!(result instanceof SentCode)) throw new Error("Already logged in");
  pendingSignIn = { phone, phoneCodeHash: result.phoneCodeHash };
}

export async function signIn(code: string): Promise<string> {
  if (!client || !pendingSignIn) throw new Error("No pending sign-in");
  try {
    const user = await client.signIn({
      phone: pendingSignIn.phone,
      phoneCodeHash: pendingSignIn.phoneCodeHash,
      phoneCode: code,
    });
    loggedIn = true;
    pendingSignIn = null;
    return user.displayName;
  } catch (err: any) {
    if (err?.text === "SESSION_PASSWORD_NEEDED") {
      throw new Error("2FA_REQUIRED");
    }
    throw err;
  }
}

export async function checkPassword(password: string): Promise<string> {
  if (!client) throw new Error("No client");
  const user = await client.checkPassword(password);
  loggedIn = true;
  pendingSignIn = null;
  return user.displayName;
}

export async function importStringSession(sessionString: string): Promise<string> {
  if (!client) client = createClient();
  await client.connect();
  await client.importSession(sessionString);
  const me = await client.getMe();
  loggedIn = true;
  return me.displayName;
}

export async function logout(): Promise<void> {
  if (client) {
    try {
      await client.logOut();
    } catch { /* ignore */ }
    try {
      await client.destroy();
    } catch { /* ignore */ }
    client = null;
  }
  loggedIn = false;
  pendingSignIn = null;
  // Remove session file
  try {
    const fs = await import("fs");
    if (fs.existsSync("userbot.session")) fs.unlinkSync("userbot.session");
  } catch { /* ignore */ }
}

export async function forwardToChannel(
  fromChatId: number,
  messageId: number,
  toChatId: string,
): Promise<void> {
  const c = getClient();
  if (!c) throw new Error("Userbot not connected");
  await c.forwardMessagesById({
    fromChatId,
    messages: [messageId],
    toChatId,
    noAuthor: true,
  });
}

export async function checkChannelMembership(chatId: string): Promise<boolean> {
  const c = getClient();
  if (!c) return false;
  try {
    await c.getChat(chatId);
    return true;
  } catch {
    return false;
  }
}
