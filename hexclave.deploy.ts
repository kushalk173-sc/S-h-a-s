import type { HexclaveDeploymentConfig } from '@hexclave/js';

export const deploymentGroupId = 'statecraft';

/**
 * One public process. The match lives in that process, and a second instance
 * would be a second game. `server` is the single-instance type. `minInstances: 0`
 * is what the free plan accepts: the process suspends when idle and resumes
 * with its memory. A paid plan can set this to 1 so a live table never sleeps.
 *
 * Port 8787 is the port the server already binds when `PORT` is that value.
 * The image listens on `0.0.0.0`.
 */
export const deploy: HexclaveDeploymentConfig = () => ({
  services: {
    game: {
      type: 'server',
      public: true,
      ports: { 8787: { protocol: 'http' } },
      minInstances: 0,
      dockerfilePath: 'Dockerfile',
      devCommand: 'npm run dev:inner',
      env: {
        PORT: '8787',
        HOST: '0.0.0.0',
      },
    },
  },
});
