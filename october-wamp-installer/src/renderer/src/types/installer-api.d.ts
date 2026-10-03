import type { InstallerApi } from '../../../shared/contracts';

declare global {
  interface Window {
    installerApi?: InstallerApi;
  }
}

export {};
