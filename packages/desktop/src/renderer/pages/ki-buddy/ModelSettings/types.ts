import type { IProvider } from '@/common/config/storage';

/** Product form values; the adapter maps seconds and credential actions to Core. */
export type KiBuddyModelSettings = {
  manual: boolean;
  gateway?: {
    bearer?: boolean;
    proxy?: 'default' | 'direct';
    headers?: {
      name: string;
      value: string;
      sensitive?: boolean;
      configured?: boolean;
      credentialAction?: 'keep' | 'replace' | 'clear';
    }[];
    connectTimeoutSeconds?: number;
    readTimeoutSeconds?: number;
    totalTimeoutSeconds?: number;
    streamOptions?: boolean;
  };
};

/** Maps provider records at the existing IPC boundary once Core #22 is available. */
export type KiBuddyModelSettingsAdapter = {
  read(provider: IProvider): KiBuddyModelSettings | undefined;
  write(provider: IProvider, settings: KiBuddyModelSettings): IProvider;
};

/** Separate from the automatic form: private endpoints must never enter discovery. */
export type KiBuddyManualModelDraft = {
  name: string;
  endpoint: string;
  apiKey: string;
  modelIds: string;
};
