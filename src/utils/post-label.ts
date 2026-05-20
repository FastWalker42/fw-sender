import type { Message } from "grammy/types";

const MAX_LEN = 30;

export function getPostLabel(msg: Message, index?: number): string {
  const n = index !== undefined ? ` #${index + 1}` : "";

  if (msg.text) return trunc(msg.text);
  if (msg.caption) return trunc(msg.caption);
  if (msg.video_note) return `КРУЖОЧЕК${n}`;
  if (msg.sticker) return `СТИКЕР${n}${msg.sticker.emoji ? ` ${msg.sticker.emoji}` : ""}`;
  if (msg.voice) return `ГОЛОСОВОЕ${n}`;
  if (msg.audio) return msg.audio.title ? trunc(msg.audio.title) : `АУДИО${n}`;
  if (msg.video) return `ВИДЕО${n}`;
  if (msg.photo) return `ФОТО${n}`;
  if (msg.document) return msg.document.file_name ? trunc(msg.document.file_name) : `ДОКУМЕНТ${n}`;
  if (msg.animation) return `GIF${n}`;
  if (msg.contact) return `КОНТАКТ${n}`;
  if (msg.location) return `ЛОКАЦИЯ${n}`;
  if (msg.poll) return trunc(msg.poll.question);

  return `ПОСТ${n}`;
}

function trunc(text: string): string {
  const line = text.split("\n")[0] ?? text;
  return line.length <= MAX_LEN ? line : line.slice(0, MAX_LEN - 1) + "…";
}
