import { Application } from './app';
import { logger } from './logger';

async function main() {
    const app = new Application();
    await app.run();
}

process.on('unhandledRejection', (reason, promise) => {
    logger.error('Unhandled Rejection at:', promise, 'reason:', reason);
    process.exit(1);
});

process.on('uncaughtException', (error) => {
    logger.error('Uncaught Exception:', error);
    process.exit(1);
});

main().catch((error) => {
    logger.error('Failed to start application:', error);
    process.exit(1);
});
