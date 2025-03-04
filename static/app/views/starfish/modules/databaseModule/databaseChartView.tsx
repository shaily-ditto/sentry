import {Fragment} from 'react';
import styled from '@emotion/styled';
import {Location} from 'history';
import moment from 'moment';

import {CompactSelect} from 'sentry/components/compactSelect';
import {t} from 'sentry/locale';
import {space} from 'sentry/styles/space';
import {Series} from 'sentry/types/echarts';
import usePageFilters from 'sentry/utils/usePageFilters';
import Chart from 'sentry/views/starfish/components/chart';
import ChartPanel from 'sentry/views/starfish/components/chartPanel';
import {
  useQueryDbOperations,
  useQueryDbTables,
  useQueryTopDbOperationsChart,
  useQueryTopTablesChart,
} from 'sentry/views/starfish/modules/databaseModule/queries';
import {datetimeToClickhouseFilterTimestamps} from 'sentry/views/starfish/utils/dates';
import {zeroFillSeries} from 'sentry/views/starfish/utils/zeroFillSeries';

const INTERVAL = 12;

type Props = {
  action: string;
  location: Location;
  onChange: (action: string, value: string) => void;
  table: string;
};

function parseOptions(options, label) {
  const prefix = <span>{t('Operation')}</span>;

  return [
    {
      value: 'ALL',
      prefix,
      label: `ALL`,
    },
    ...options.map(action => {
      return {
        value: action.key,
        prefix,
        label: `${action.key || 'null'} - ${action.value} ${label}`,
      };
    }),
  ];
}

export default function APIModuleView({action, table, onChange}: Props) {
  const pageFilter = usePageFilters();
  const {start_timestamp, end_timestamp} = datetimeToClickhouseFilterTimestamps(
    pageFilter.selection.datetime
  );

  const {data: operationData} = useQueryDbOperations();
  const {data: tableData} = useQueryDbTables(action);
  const {isLoading: isTopGraphLoading, data: topGraphData} =
    useQueryTopDbOperationsChart(INTERVAL);
  const {isLoading: tableGraphLoading, data: tableGraphData} = useQueryTopTablesChart(
    action,
    INTERVAL
  );

  const seriesByDomain: {[action: string]: Series} = {};
  const tpmByDomain: {[action: string]: Series} = {};
  if (!tableGraphLoading) {
    tableGraphData.forEach(datum => {
      seriesByDomain[datum.domain] = {
        seriesName: datum.domain,
        data: [],
      };
      tpmByDomain[datum.domain] = {
        seriesName: datum.domain,
        data: [],
      };
    });

    tableGraphData.forEach(datum => {
      seriesByDomain[datum.domain].data.push({
        value: datum.p75,
        name: datum.interval,
      });
      tpmByDomain[datum.domain].data.push({
        value: datum.count,
        name: datum.interval,
      });
    });
  }

  const topDomains = Object.values(seriesByDomain).map(series =>
    zeroFillSeries(
      series,
      moment.duration(INTERVAL, 'hours'),
      moment(start_timestamp),
      moment(end_timestamp)
    )
  );
  const tpmDomains = Object.values(tpmByDomain).map(series =>
    zeroFillSeries(
      series,
      moment.duration(INTERVAL, 'hours'),
      moment(start_timestamp),
      moment(end_timestamp)
    )
  );

  const tpmByQuery: {[query: string]: Series} = {};

  const seriesByQuery: {[action: string]: Series} = {};
  if (!isTopGraphLoading) {
    topGraphData.forEach(datum => {
      seriesByQuery[datum.action] = {
        seriesName: datum.action,
        data: [],
      };
      tpmByQuery[datum.action] = {
        seriesName: datum.action,
        data: [],
      };
    });

    topGraphData.forEach(datum => {
      seriesByQuery[datum.action].data.push({
        value: datum.p75,
        name: datum.interval,
      });
      tpmByQuery[datum.action].data.push({
        value: datum.count,
        name: datum.interval,
      });
    });
  }

  const tpmData = Object.values(tpmByQuery).map(series =>
    zeroFillSeries(
      series,
      moment.duration(INTERVAL, 'hours'),
      moment(start_timestamp),
      moment(end_timestamp)
    )
  );
  const topData = Object.values(seriesByQuery).map(series =>
    zeroFillSeries(
      series,
      moment.duration(INTERVAL, 'hours'),
      moment(start_timestamp),
      moment(end_timestamp)
    )
  );

  return (
    <Fragment>
      <ChartsContainer>
        <ChartsContainerItem>
          <ChartPanel title={t('Slowest Operations P75')}>
            <Chart
              statsPeriod="24h"
              height={180}
              data={topData}
              start=""
              end=""
              loading={isTopGraphLoading}
              utc={false}
              grid={{
                left: '0',
                right: '0',
                top: '16px',
                bottom: '8px',
              }}
              definedAxisTicks={4}
              isLineChart
              showLegend
            />
          </ChartPanel>
        </ChartsContainerItem>
        <ChartsContainerItem>
          <ChartPanel title={t('Operation Throughput')}>
            <Chart
              statsPeriod="24h"
              height={180}
              data={tpmData}
              start=""
              end=""
              loading={isTopGraphLoading}
              utc={false}
              grid={{
                left: '0',
                right: '0',
                top: '16px',
                bottom: '8px',
              }}
              definedAxisTicks={4}
              showLegend
              isLineChart
            />
          </ChartPanel>
        </ChartsContainerItem>
      </ChartsContainer>
      <Selectors>
        Operation:
        <CompactSelect
          value={action}
          options={parseOptions(operationData, 'query')}
          menuTitle="Operation"
          onChange={opt => onChange('action', opt.value)}
        />
      </Selectors>
      {tableData.length === 1 && tableData[0].key === '' ? (
        <Fragment />
      ) : (
        <Fragment>
          <ChartsContainer>
            <ChartsContainerItem>
              <ChartPanel title={t('Slowest Tables P75')}>
                <Chart
                  statsPeriod="24h"
                  height={180}
                  data={topDomains}
                  start=""
                  end=""
                  loading={tableGraphLoading}
                  utc={false}
                  grid={{
                    left: '0',
                    right: '0',
                    top: '16px',
                    bottom: '8px',
                  }}
                  definedAxisTicks={4}
                  isLineChart
                  showLegend
                />
              </ChartPanel>
            </ChartsContainerItem>
            <ChartsContainerItem>
              <ChartPanel title={t('Table Throughput')}>
                <Chart
                  statsPeriod="24h"
                  height={180}
                  data={tpmDomains}
                  start=""
                  end=""
                  loading={isTopGraphLoading}
                  utc={false}
                  grid={{
                    left: '0',
                    right: '0',
                    top: '16px',
                    bottom: '8px',
                  }}
                  definedAxisTicks={4}
                  showLegend
                  isLineChart
                />
              </ChartPanel>
            </ChartsContainerItem>
          </ChartsContainer>
          <Selectors>
            Table:
            <CompactSelect
              value={table}
              options={parseOptions(tableData, 'p75')}
              menuTitle="Table"
              onChange={opt => onChange('table', opt.value)}
            />
          </Selectors>
        </Fragment>
      )}
    </Fragment>
  );
}

const Selectors = styled(`div`)`
  display: flex;
  margin-bottom: ${space(2)};
`;

const ChartsContainer = styled('div')`
  display: flex;
  flex-direction: row;
  flex-wrap: wrap;
  gap: ${space(2)};
`;

const ChartsContainerItem = styled('div')`
  flex: 1;
`;
