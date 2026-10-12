import { defineHexclaveConfig } from '@hexclave/js';

export const config = defineHexclaveConfig({
  apps: {
    installed: {
      authentication: { enabled: true },
      deploy: { enabled: true },
    },
  },
  auth: {
    allowSignUp: true,
  },
  'auth.otp': { allowSignIn: true },
  'auth.password': { allowSignIn: false },
  'auth.oauth': {
    accountMergeStrategy: 'link_method',
    providers: {
      google: { type: 'google', allowSignIn: true, allowConnectedAccounts: true },
    },
  },
});
