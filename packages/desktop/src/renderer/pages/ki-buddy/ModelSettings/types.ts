import type { IProvider } from '@/common/config/storage';

/** UI values only; these names are not a Ki-Core wire contract. */
export type KiBuddyModelSettings = {
  manual: boolean;
  gateway?: {
    bearer?: boolean;
    proxy?: 'system' | 'direct';
    headers?: { name: string; value: string }[];
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
