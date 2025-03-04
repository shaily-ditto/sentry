/**
 * Remove slugs from the path - we do not want them displayed in the Issues Stream (having them in issue details is ok)
 */

const SHORTENED_TYPE = {
  organizations: 'orgSlug',
  customers: 'customerSlug',
  projects: 'projectSlug',
  teams: 'teamSlug',
  issues: 'issueId',
  replays: 'replayId',
};

export function sanitizePath(path: string) {
  return path.replace(
    /(?<start>.*?)\/(?<type>organizations|issues|customers|projects|teams)\/(?<primarySlug>[^/]+)\/(?<contentType>[^/]+\/)?(?<tertiarySlug>[^/]+\/)?(?<end>.*)/,
    function (...args) {
      const matches = args[args.length - 1];
      const {start, type, contentType, tertiarySlug, end} = matches;
      // `customers` is org-like
      const isOrg = ['organizations', 'customers'].includes(type);
      const noOrgSlug = type === 'issues';
      const isProject = type === 'projects';
      const isRuleConditions = isProject && contentType === 'rule-conditions/';

      // `end` should always match and at least return empty string,
      // `tertiarySlug` can be undefined
      let suffix = `${tertiarySlug ?? ''}${end}`;

      if (isOrg && contentType === 'events/' && typeof tertiarySlug === 'string') {
        // https://github.com/getsentry/sentry/blob/8d4482f01aa2122c6f6670ab84f9263e6f021467/src/sentry/api/urls.py#L1004
        // r"^(?P<organization_slug>[^\/]+)/events/(?P<project_slug>[^\/]+):(?P<event_id>(?:\d+|[A-Fa-f0-9-]{32,36}))/$",
        suffix = tertiarySlug.replace(/[^:]+(.*)/, '{projectSlug}$1');
      } else if (isOrg && contentType === 'members/') {
        // https://github.com/getsentry/sentry/blob/8d4482f01aa2122c6f6670ab84f9263e6f021467/src/sentry/api/urls.py#L1235
        // r"^(?P<organization_slug>[^\/]+)/members/(?P<member_id>[^\/]+)/teams/(?P<team_slug>[^\/]+)/$",
        suffix = `${tertiarySlug}${end.replace(
          /teams\/([^/]+)\/$/,
          'teams/{teamSlug}/'
        )}`;
      } else if (isProject && tertiarySlug === 'teams/') {
        // https://github.com/getsentry/sentry/blob/8d4482f01aa2122c6f6670ab84f9263e6f021467/src/sentry/api/urls.py#L1894
        // r"^(?P<organization_slug>[^\/]+)/(?P<project_slug>[^\/]+)/teams/(?P<team_slug>[^\/]+)/$",
        suffix = `${tertiarySlug}{teamSlug}/`;
      } else if (
        (isProject && tertiarySlug === 'replays/') ||
        (isOrg && contentType === 'replays/')
      ) {
        // Projct replays endpoint
        // https://github.com/getsentry/sentry/blob/82074148753c21abf37f6f33408bb95691ed1597/src/sentry/api/urls.py#L2076
        // r"^(?P<organization_slug>[^/]+)/(?P<project_slug>[^\/]+)/replays/(?P<replay_id>[\w-]+)/$",

        // Org replays endpoint
        // https://github.com/getsentry/sentry/blob/e45aafb8a62b5728129aed67574cb37a4bd69075/src/sentry/api/urls.py#L1658
        // r"^(?P<organization_slug>[^/]+)/replays/(?P<replay_id>[\w-]+)/$"
        suffix = isOrg ? `{replayId}/` : `replays/{replayId}/`;
      } else if (isRuleConditions) {
        // https://github.com/getsentry/sentry/blob/8d4482f01aa2122c6f6670ab84f9263e6f021467/src/sentry/api/urls.py#L1595
        // r"^(?P<organization_slug>[^\/]+)/rule-conditions/$",
        suffix = '';
      } else if (type === 'issues' && contentType === 'events/') {
        suffix = contentType + tertiarySlug;
      }

      const contentTypeOrSecondarySlug = isOrg
        ? contentType ?? ''
        : isRuleConditions
        ? 'rule-conditions/'
        : `{${SHORTENED_TYPE[type]}}/`;

      const orgSlug = noOrgSlug ? '' : '{orgSlug}/';
      return `${start}/${type}/${orgSlug}${contentTypeOrSecondarySlug}${suffix}`;
    }
  );
}
