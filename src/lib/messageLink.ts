/** Telegram link to a message: t.me/<username>/<id> for public chats, t.me/c/<id> for supergroups, else null. */
export function messageLink(chat: { id: number; type?: string; username?: string | null }, messageId: number): string | null {
  if (chat.username) return `https://t.me/${chat.username}/${messageId}`;
  const id = String(chat.id);
  if (id.startsWith("-100")) return `https://t.me/c/${id.slice(4)}/${messageId}`;
  return null;
}
