import {browserHistory} from 'react-router';

import Breadcrumbs from 'sentry/components/breadcrumbs';
import * as Layout from 'sentry/components/layouts/thirds';
import LoadingError from 'sentry/components/loadingError';
import LoadingIndicator from 'sentry/components/loadingIndicator';
import SentryDocumentTitle from 'sentry/components/sentryDocumentTitle';
import {t} from 'sentry/locale';
import {setApiQueryData, useApiQuery, useQueryClient} from 'sentry/utils/queryClient';
import useOrganization from 'sentry/utils/useOrganization';
import usePageFilters from 'sentry/utils/usePageFilters';
import {useParams} from 'sentry/utils/useParams';
import {normalizeUrl} from 'sentry/utils/withDomainRequired';

import MonitorForm from './components/monitorForm';
import {Monitor} from './types';

export default function EditMonitor() {
  const {monitorSlug} = useParams();
  const {selection} = usePageFilters();
  const organization = useOrganization();
  const queryClient = useQueryClient();

  const queryKeyUrl = `/organizations/${organization.slug}/monitors/${monitorSlug}/`;

  const {
    isLoading,
    isError,
    data: monitor,
    refetch,
  } = useApiQuery<Monitor>([queryKeyUrl], {
    staleTime: 0,
  });

  function onSubmitSuccess(data: Monitor) {
    setApiQueryData(queryClient, [queryKeyUrl], data);
    browserHistory.push(
      normalizeUrl({
        pathname: `/organizations/${organization.slug}/crons/${data.slug}/`,
        query: {environment: selection.environments},
      })
    );
  }

  function getTitle() {
    if (monitor) {
      return `${monitor.name} - Crons - ${organization.slug}`;
    }
    return `Crons - ${organization.slug}`;
  }

  if (isLoading) {
    return <LoadingIndicator />;
  }

  if (isError) {
    return <LoadingError onRetry={refetch} message="Failed to load monitor." />;
  }

  return (
    <SentryDocumentTitle title={getTitle()}>
      <Layout.Page>
        <Layout.Header>
          <Layout.HeaderContent>
            <Breadcrumbs
              crumbs={[
                {
                  label: t('Crons'),
                  to: `/organizations/${organization.slug}/crons/`,
                },
                {
                  label: t('Editing %s', monitor.name),
                },
              ]}
            />
            <Layout.Title>{t('Edit Monitor')}</Layout.Title>
          </Layout.HeaderContent>
        </Layout.Header>
        <Layout.Body>
          <Layout.Main fullWidth>
            <MonitorForm
              monitor={monitor}
              apiMethod="PUT"
              apiEndpoint={`/organizations/${organization.slug}/monitors/${monitor.slug}/`}
              onSubmitSuccess={onSubmitSuccess}
            />
          </Layout.Main>
        </Layout.Body>
      </Layout.Page>
    </SentryDocumentTitle>
  );
}
