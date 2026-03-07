
import cron from 'node-cron';
import { monitorPositions } from './src/lib/monitor';

console.log('--- Professional LP Bot Scheduler Started ---');
console.log('Monitoring frequency: Every 30 minutes');

// 1. Initial check on startup
monitorPositions().catch(err => {
    console.error('Initial monitor run failed:', err.message);
});

// 2. Schedule every 30 minutes
cron.schedule('*/30 * * * *', async () => {
    try {
        await monitorPositions();
    } catch (err: any) {
        console.error('Scheduled monitor run failed:', err.message);
    }
});

process.on('SIGINT', () => {
    console.log('Scheduler stopping...');
    process.exit(0);
});
