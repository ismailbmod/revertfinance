import { Telegraf } from 'telegraf';

const token = process.env.TELEGRAM_BOT_TOKEN!;
export const bot = new Telegraf(token);

export async function sendNotification(chatId: string, message: string) {
    try {
        await bot.telegram.sendMessage(chatId, message, { parse_mode: 'Markdown' });
    } catch (error) {
        console.error('Error sending Telegram message:', error);
    }
}
