import {initializeOrg} from 'sentry-test/initializeOrg';
import {reactHooks} from 'sentry-test/reactTestingLibrary';

import fetchReplayClicks from 'sentry/utils/replays/fetchReplayClicks';
import useInitialTimeOffsetMs from 'sentry/utils/replays/hooks/useInitialTimeOffsetMs';
import {useLocation} from 'sentry/utils/useLocation';

jest.mock('sentry/utils/useLocation');
jest.mock('sentry/utils/replays/fetchReplayClicks');

const MockUseLocation = useLocation as jest.MockedFunction<typeof useLocation>;
const MockFetchReplayClicks = fetchReplayClicks as jest.MockedFunction<
  typeof fetchReplayClicks
>;

const {organization, project} = initializeOrg();
const replay = TestStubs.ReplayRecord();

const NOON = '2023-04-14T12:00:00';
const FIVE_PAST_NOON = '2023-04-14T12:05:00';

function mockQuery(query: Record<string, string>) {
  MockUseLocation.mockReturnValue({
    pathname: '',
    search: '',
    query,
    hash: '',
    state: undefined,
    action: 'PUSH',
    key: '',
  });
}
describe('useInitialTimeOffsetMs', () => {
  beforeEach(() => {
    MockUseLocation.mockClear();
    MockFetchReplayClicks.mockClear();
  });

  describe('fromOffset', () => {
    it('should return an offset, in ms, if `t` exists in the query', async () => {
      const offsetInSeconds = 23;
      mockQuery({t: String(offsetInSeconds)});

      const {result, waitForNextUpdate} = reactHooks.renderHook(useInitialTimeOffsetMs, {
        initialProps: {
          orgSlug: organization.slug,
          projectSlug: project.slug,
          replayId: replay.id,
          replayStartTimestampMs: undefined,
        },
      });
      await waitForNextUpdate();

      expect(result.current).toBe(23 * 1000);
    });

    it('should prefer reading `t` over the other qs params', async () => {
      const offsetInSeconds = 23;
      mockQuery({
        t: String(offsetInSeconds),
        event_t: FIVE_PAST_NOON,
        query: 'click.tag:button',
      });

      const {result, waitForNextUpdate} = reactHooks.renderHook(useInitialTimeOffsetMs, {
        initialProps: {
          orgSlug: organization.slug,
          projectSlug: project.slug,
          replayId: replay.id,
          replayStartTimestampMs: undefined,
        },
      });
      await waitForNextUpdate();

      expect(result.current).toBe(23 * 1000);
      expect(MockFetchReplayClicks).toHaveBeenCalledTimes(0);
    });
  });

  describe('fromEventTimestamp', () => {
    it('should calculate the difference between an event timestamp and the replay start timestamp', async () => {
      const noon = '2023-04-14T12:00:00';
      const fivePastNoon = '2023-04-14T12:05:00';

      mockQuery({event_t: fivePastNoon});

      const {result, waitForNextUpdate} = reactHooks.renderHook(useInitialTimeOffsetMs, {
        initialProps: {
          orgSlug: organization.slug,
          projectSlug: project.slug,
          replayId: replay.id,
          replayStartTimestampMs: new Date(noon).getTime(),
        },
      });
      await waitForNextUpdate();

      // Expecting 5 minutes difference, in ms
      expect(result.current).toBe(5 * 60 * 1000);
    });

    it('should return 0 offset if there is no replayStartTimetsamp, then recalculate when the startTimestamp appears', async () => {
      mockQuery({event_t: FIVE_PAST_NOON});

      const {result, rerender, waitForNextUpdate} = reactHooks.renderHook(
        useInitialTimeOffsetMs,
        {
          initialProps: {
            orgSlug: organization.slug,
            projectSlug: project.slug,
            replayId: replay.id,
            replayStartTimestampMs: undefined,
          },
        }
      );

      await waitForNextUpdate();
      expect(result.current).toBe(0);

      rerender({
        orgSlug: organization.slug,
        projectSlug: project.slug,
        replayId: replay.id,
        replayStartTimestampMs: new Date(NOON).getTime(),
      });
      await waitForNextUpdate();

      // Expecting 5 minutes difference, in ms
      expect(result.current).toBe(5 * 60 * 1000);
    });

    it('should prefer reading `event_t` over the other search query params', async () => {
      mockQuery({
        event_t: FIVE_PAST_NOON,
        query: 'click.tag:button',
      });
      MockFetchReplayClicks.mockResolvedValue({
        fetchError: undefined,
        pageLinks: '',
        clicks: [],
      });

      const {result, waitForNextUpdate} = reactHooks.renderHook(useInitialTimeOffsetMs, {
        initialProps: {
          orgSlug: organization.slug,
          projectSlug: project.slug,
          replayId: replay.id,
          replayStartTimestampMs: new Date(NOON).getTime(),
        },
      });
      await waitForNextUpdate();

      expect(result.current).toBe(5 * 60 * 1000);
      expect(MockFetchReplayClicks).toHaveBeenCalledTimes(0);
    });
  });

  describe('fromListPageQuery', () => {
    it('should skip this strategy if there is no `click.*` term in the query', async () => {
      mockQuery({query: 'user.email:*@sentry.io'});

      const {result, waitForNextUpdate} = reactHooks.renderHook(useInitialTimeOffsetMs, {
        initialProps: {
          orgSlug: organization.slug,
          projectSlug: project.slug,
          replayId: replay.id,
          replayStartTimestampMs: new Date(NOON).getTime(),
        },
      });
      await waitForNextUpdate();

      expect(MockFetchReplayClicks).toHaveBeenCalledTimes(0);
      expect(result.current).toBe(0);
    });

    it('should request a list of click results, and calculate the offset from the first result', async () => {
      mockQuery({query: 'click.tag:button'});
      MockFetchReplayClicks.mockResolvedValue({
        fetchError: undefined,
        pageLinks: '',
        clicks: [{node_id: 7, timestamp: FIVE_PAST_NOON}],
      });

      const {result, waitForNextUpdate} = reactHooks.renderHook(useInitialTimeOffsetMs, {
        initialProps: {
          orgSlug: organization.slug,
          projectSlug: project.slug,
          replayId: replay.id,
          replayStartTimestampMs: new Date(NOON).getTime(),
        },
      });
      await waitForNextUpdate();

      expect(MockFetchReplayClicks).toHaveBeenCalledTimes(1);
      // Expecting 5 minutes difference, in ms
      expect(result.current).toBe(5 * 60 * 1000);
    });

    it('should not call call fetch twice when props change', async () => {
      mockQuery({query: 'click.tag:button'});
      MockFetchReplayClicks.mockResolvedValue({
        fetchError: undefined,
        pageLinks: '',
        clicks: [{node_id: 7, timestamp: FIVE_PAST_NOON}],
      });

      const {result, rerender, waitForNextUpdate} = reactHooks.renderHook(
        useInitialTimeOffsetMs,
        {
          initialProps: {
            orgSlug: organization.slug,
            projectSlug: project.slug,
            replayId: replay.id,
            replayStartTimestampMs: undefined,
          },
        }
      );
      await waitForNextUpdate();

      expect(MockFetchReplayClicks).toHaveBeenCalledTimes(0);
      expect(result.current).toBe(0);

      rerender({
        orgSlug: organization.slug,
        projectSlug: project.slug,
        replayId: replay.id,
        replayStartTimestampMs: new Date(NOON).getTime(),
      });
      await waitForNextUpdate();

      expect(MockFetchReplayClicks).toHaveBeenCalledTimes(1);
      expect(result.current).toBe(5 * 60 * 1000);
    });
  });
});
