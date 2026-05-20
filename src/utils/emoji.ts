/**
 * Premium emoji IDs from TranslucentPack + special back emoji.
 * Usage:
 *   - In message text (HTML): e("📢", E.CHANNELS) → <tg-emoji emoji-id="...">📢</tg-emoji>
 *   - In button text: just use regular emoji (Bot API doesn't support custom emoji in buttons)
 */

export const E = {
	CHANNELS: '5278528159837348960', // 📢
	CAMPAIGN: '5278305362703835500', // 🔗
	ADD: '5242329690135356589', // ➕
	BACK: '5442781354347472279', // ◀️ (special, not from pack)
	ACTIVE: '5278411813468269386', // ✅
	STOPPED: '5278578973595427038', // 🚫
	SCHEDULE: '5276412364458059956', // 🕓
	AUTOSPAM: '5278589204207528856', // 📨
	PLAN: '5276220667182736079', // 📥
	START: '5206401524200145033', // 🔼
	PAUSE: '5206510891247371052', // 🔽
	RENAME: '5276314275994954605', // 🔨
	DELETE: '5276384644739129761', // 🗑
	ROBOT: '5276127848644503161', // 🤖
	SEARCH: '5276395476646653290', // 🔍
	CONFIRM: '5278411813468269386', // ✅
	CANCEL: '5278578973595427038', // 🚫
	WARNING: '5276240711795107620', // ⚠️
	INFO: '5278753302023004775', // ℹ️
	FILE: '5278227821364275264', // 📁
	PANEL: '5278778882848220741', // 📊
	HOME: '5278413853577734640', // 🏠
	CROWN: '5276229330131772747', // 👑
	BELL: '5206222720416643915', // 🔔
	STAR: '5276111746812112286', // ⭐️
	LOCK: '5278602437001767574', // 🔓
	SHIELD: '5276262671962892944', // 🛡
	GIFT: '5276422526350681413', // 🎁
	CHART: '5278778882848220741', // 📊
	PACKAGE: '5278540791336165644', // 📦
} as const

/** Wrap fallback emoji with premium tg-emoji tag for HTML messages */
export function e(fallback: string, emojiId: string): string {
	return `<tg-emoji emoji-id="${emojiId}">${fallback}</tg-emoji>`
}
