/**
 * marty health — check platform service health.
 */

import { Command } from 'commander';
import { get } from '../lib/apiAdapter.js';
import { getFormatter, withErrorHandler } from '../lib/output.js';

const STATUS_SYMBOLS = {
  healthy: '●',
  up: '●',
  ok: '●',
  degraded: '◐',
  warning: '◐',
  unhealthy: '○',
  down: '○',
  error: '○',
  unknown: '?',
};

function statusSymbol(status) {
  return STATUS_SYMBOLS[String(status).toLowerCase()] || '?';
}

export function registerHealthCommand(program) {
  program
    .command('health')
    .description('Check platform service health')
    .option('-o, --output <format>', 'Output format (table|json)', 'table')
    .action(withErrorHandler(async (opts) => {
      const data = await get('/health');

      if (opts.output.startsWith('json')) {
        const fmt = getFormatter(opts.output);
        fmt.print(data);
        return;
      }

      // Friendly table display
      const overall = data?.status || 'unknown';
      console.log(`Platform: ${statusSymbol(overall)} ${overall}\n`);

      if (data?.services) {
        const rows = Object.entries(data.services).map(([name, info]) => {
          const status = typeof info === 'string' ? info : info?.status || 'unknown';
          return { service: name, status: `${statusSymbol(status)} ${status}` };
        });
        const fmt = getFormatter('table');
        fmt.printList(rows, ['service', 'status'], {
          headers: { service: 'SERVICE', status: 'STATUS' },
        });
      }

      // Exit 1 if unhealthy, so CI can catch it
      if (['unhealthy', 'down', 'error'].includes(overall.toLowerCase())) {
        process.exit(1);
      }
    }));
}
