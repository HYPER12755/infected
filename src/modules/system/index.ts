import os from 'node:os';
import { execSync } from 'node:child_process';
import * as dns from 'node:dns';
import { Socket } from 'node:net';
import { z } from 'zod';
import { IUnifiedPlugin, UnifiedModuleContext, UnifiedModuleManifest } from '../../core/module-system/module-types.js';

const systemInfoSchema = z.object({});

const networkDiagsSchema = z.object({
  target: z.string().optional().describe('Hostname or IP to ping'),
  type: z.enum(['ping', 'dns', 'ports']).default('ping').describe('Type of diagnostics to run'),
});

export default class SystemModule implements IUnifiedPlugin {
  public manifest: UnifiedModuleManifest = {
    id: 'plugin.system',
    name: 'System Tools',
    version: '1.0.0',
    type: 'plugin',
    entry: 'index.js',
    description: 'System information and network diagnostics tools.',
    provides: ['tools'],
  };

  private deregisterFns: Array<() => void> = [];

  async onLoad(context: UnifiedModuleContext): Promise<void> {
    this.registerSystemInfo(context);
    this.registerNetworkDiags(context);
    context.logger.info('System Tools module loaded.', { component: this.manifest.id });
  }

  async onUnload(): Promise<void> {
    for (const deregister of this.deregisterFns) {
      deregister();
    }
    this.deregisterFns = [];
  }

  private registerSystemInfo(context: UnifiedModuleContext): void {
    const deregister = context.moduleManager.registerToolExecution(
      'get_system_info',
      async () => {
        const cpus = os.cpus();
        const cpuModel = cpus.length > 0 ? cpus[0].model : 'Unknown';
        const cpuCount = cpus.length;
        
        const totalMem = os.totalmem();
        const freeMem = os.freemem();
        const usedMem = totalMem - freeMem;
        
        const loadAvg = os.loadavg();
        
        const uptime = os.uptime();
        const days = Math.floor(uptime / 86400);
        const hours = Math.floor((uptime % 86400) / 3600);
        const minutes = Math.floor((uptime % 3600) / 60);
        
        const platform = os.platform();
        const release = os.release();
        const arch = os.arch();
        const hostname = os.hostname();
        
        // Wrap networkInterfaces in try-catch to handle EACCES (permission denied)
        let networks: string[] = [];
        try {
          const networkInterfaces = os.networkInterfaces();
          for (const [name, addrs] of Object.entries(networkInterfaces)) {
            if (addrs) {
              for (const addr of addrs) {
                if (addr.family === 'IPv4' && !addr.internal) {
                  networks.push(name + ': ' + addr.address);
                }
              }
            }
          }
        } catch (netErr) {
          // os.networkInterfaces() can fail with EACCES in some environments (containers, etc.)
          networks = ['(unavailable: ' + String(netErr) + ')'];
        }

        const info = '=== System Information ===\n' +
          'Hostname: ' + hostname + '\n' +
          'OS: ' + platform + ' ' + release + ' (' + arch + ')\n' +
          'CPU: ' + cpuModel + ' (' + cpuCount + ' cores)\n' +
          'Memory: ' + Math.round(usedMem / 1024 / 1024 / 1024 * 100) / 100 + ' GB / ' + Math.round(totalMem / 1024 / 1024 / 1024 * 100) / 100 + ' GB (' + Math.round(freeMem / totalMem * 100) + '% free)\n' +
          'Load Average: ' + loadAvg[0].toFixed(2) + ', ' + loadAvg[1].toFixed(2) + ', ' + loadAvg[2].toFixed(2) + '\n' +
          'Uptime: ' + days + 'd ' + hours + 'h ' + minutes + 'm\n' +
          'Network Interfaces:\n' +
          networks.join('\n');

        return {
          content: [{ type: 'text', text: info }],
          structuredContent: {
            hostname,
            platform,
            release,
            arch,
            cpu: { model: cpuModel, count: cpuCount },
            memory: { total: totalMem, free: freeMem, used: usedMem },
            loadAverage: loadAvg,
            uptime,
            networkInterfaces: networks
          }
        };
      },
      'get_system_info',
      'Get system information including OS, CPU, memory, and network details.',
      systemInfoSchema,
      this.manifest.id
    );
    this.deregisterFns.push(deregister);
  }

  private registerNetworkDiags(context: UnifiedModuleContext): void {
    const deregister = context.moduleManager.registerToolExecution(
      'network_diagnostics',
      async (rawArgs: unknown) => {
        const args = networkDiagsSchema.parse(rawArgs);
        
        if (args.type === 'ping') {
          return this.doPing(args.target || 'google.com');
        } else if (args.type === 'dns') {
          return this.doDnsLookup(args.target || 'google.com');
        } else if (args.type === 'ports') {
          return this.doPortCheck(args.target || 'localhost');
        }
        
        return {
          content: [{ type: 'text', text: 'Unknown diagnostics type' }],
          isError: true
        };
      },
      'network_diagnostics',
      'Run network diagnostics: ping, DNS lookup, or port check.',
      networkDiagsSchema,
      this.manifest.id
    );
    this.deregisterFns.push(deregister);
  }

  private async doPing(target: string): Promise<any> {
    try {
      const output = execSync(`ping -c 4 ${target}`, { encoding: 'utf-8', timeout: 10000 });
      return {
        content: [{ type: 'text', text: '=== Ping Results for ' + target + ' ===\n' + output }],
        structuredContent: { target, type: 'ping', output }
      };
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      return {
        content: [{ type: 'text', text: 'Ping failed: ' + message }],
        isError: true,
        structuredContent: { target, type: 'ping', error: message }
      };
    }
  }

  private async doDnsLookup(target: string): Promise<any> {
    return new Promise((resolve) => {
      dns.resolve4(target, (err: Error | null, addresses: string[]) => {
        if (err) {
          resolve({
            content: [{ type: 'text', text: 'DNS lookup failed: ' + err.message }],
            isError: true,
            structuredContent: { target, type: 'dns', error: err.message }
          });
        } else {
          const result = '=== DNS Results for ' + target + ' ===\nAddresses: ' + addresses.join(', ');
          resolve({
            content: [{ type: 'text', text: result }],
            structuredContent: { target, type: 'dns', addresses }
          });
        }
      });
    });
  }

  private async doPortCheck(target: string): Promise<any> {
    const commonPorts = [22, 80, 443, 3000, 3001, 3306, 5432, 6379, 8080, 8443];
    
    const results: string[] = [];
    const openPorts: number[] = [];
    
    const checkPort = (port: number): Promise<boolean> => {
      return new Promise((resolve) => {
        const sock = new Socket();
        sock.setTimeout(2000);
        sock.on('connect', () => {
          sock.destroy();
          resolve(true);
        });
        sock.on('timeout', () => {
          sock.destroy();
          resolve(false);
        });
        sock.on('error', () => {
          resolve(false);
        });
        sock.connect(port, target);
      });
    };
    
    for (const port of commonPorts) {
      const isOpen = await checkPort(port);
      if (isOpen) {
        openPorts.push(port);
        results.push('Port ' + port + ': OPEN');
      } else {
        results.push('Port ' + port + ': closed');
      }
    }
    
    const result = '=== Port Check for ' + target + ' ===\n' + results.join('\n');
    return {
      content: [{ type: 'text', text: result }],
      structuredContent: { target, type: 'ports', openPorts, allResults: results }
    };
  }
}
