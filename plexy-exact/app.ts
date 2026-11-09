import type { Answer, Sources } from './app.contract.d.ts';

export const grants = '';
const sources: Sources = {
  readiness: () => ({
    title: 'Plexy · Local library',
    message: 'Native playback verification is pending. Your existing Plexy apps remain available.',
  }),
};
export const answer: Answer = (source, args, store, storage, native) =>
  sources[source](args, store, storage, native);
