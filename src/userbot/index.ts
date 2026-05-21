import { TelegramClient, SentCode } from "@mtcute/bun";
import { API_ID, API_HASH, BOT_ID, BOT_USERNAME } from "../config";

let client: TelegramClient | null = null;
let loggedIn = false;
let userbotId: number | null = null;
let botRelayReady = false;
let resolvedBotUsername = "";

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
    userbotId = me.id;
    console.log(`[userbot] connected as ${me.displayName}`);
    initBotRelay().catch((err) => console.error("[userbot] initBotRelay error:", err));
    return true;
  } catch {
    loggedIn = false;
    userbotId = null;
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

export function getUserbotId(): number | null {
  return userbotId;
}

export function isBotRelayReady(): boolean {
  return botRelayReady;
}

export function setBotInfo(username: string) {
  resolvedBotUsername = username;
  if (loggedIn && !botRelayReady) {
    initBotRelay().catch((err) => console.error("[userbot] initBotRelay error:", err));
  }
}

async function initBotRelay(): Promise<void> {
  const username = resolvedBotUsername || BOT_USERNAME;
  if (!client || !loggedIn || !username) {
    console.log("[userbot] relay disabled: missing bot username or not logged in");
    return;
  }
  try {
    await client.resolvePeer("@" + username);
    await client.sendText(BOT_ID, ".");
    botRelayReady = true;
    console.log("[userbot] bot relay initialized");
  } catch (err) {
    console.error("[userbot] failed to init bot relay:", err);
    botRelayReady = false;
  }
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
    userbotId = user.id;
    pendingSignIn = null;
    initBotRelay().catch((err2) => console.error("[userbot] initBotRelay error:", err2));
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
  userbotId = user.id;
  pendingSignIn = null;
  initBotRelay().catch((err) => console.error("[userbot] initBotRelay error:", err));
  return user.displayName;
}

export async function importStringSession(sessionString: string): Promise<string> {
  if (!client) client = createClient();
  await client.connect();
  await client.importSession(sessionString);
  const me = await client.getMe();
  loggedIn = true;
  userbotId = me.id;
  initBotRelay().catch((err) => console.error("[userbot] initBotRelay error:", err));
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
  userbotId = null;
  botRelayReady = false;
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
  const numericId = parseInt(toChatId, 10);
  await c.forwardMessagesById({
    fromChatId,
    messages: [messageId],
    toChatId: numericId,
    noAuthor: true,
  });
}

export async function relayViaBot(
  toChatId: string,
): Promise<void> {
  const c = getClient();
  if (!c) throw new Error("Userbot not connected");
  if (!botRelayReady) throw new Error("Bot relay not initialized");

  const history = await c.getHistory(BOT_ID, { limit: 1 });
  const latest = history[0];
  if (!latest) throw new Error("No messages from bot to relay");

  const numericId = parseInt(toChatId, 10);
  await c.forwardMessagesById({
    fromChatId: BOT_ID,
    messages: [latest.id],
    toChatId: numericId,
    noAuthor: true,
  });
}

export async function checkChannelMembership(chatId: string): Promise<boolean> {
  const c = getClient();
  if (!c) return false;
  try {
    const numericId = parseInt(chatId, 10);
    const chat = await c.getChat(numericId);
    return !!chat;
  } catch {
    return false;
  }
}
