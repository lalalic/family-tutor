import { readFileSync } from 'node:fs';

export const LEARNER_PROFILE_TEMPLATE_PATH = '/v1/learner-profile-template';
export const LEARNER_PROFILE_BOOTSTRAP_PATH = '/bootstrap/latest.md';

export const LEARNER_PROFILE_TEMPLATE = readFileSync(
  new URL('../../../skills/family-tutor/setup/learner-profile-template.md', import.meta.url),
  'utf8',
);

export const LATEST_BOOTSTRAP = readFileSync(
  new URL('../../../skills/family-tutor/bootstrap/latest.md', import.meta.url),
  'utf8',
);
