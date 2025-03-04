import {render, screen, userEvent} from 'sentry-test/reactTestingLibrary';

import ProjectFilters from 'sentry/views/settings/project/projectFilters';

describe('ProjectFilters', function () {
  const org = TestStubs.Organization();
  const project = TestStubs.Project({options: {}});
  const PROJECT_URL = `/projects/${org.slug}/${project.slug}/`;

  const getFilterEndpoint = filter => `${PROJECT_URL}filters/${filter}/`;

  const createFilterMock = filter =>
    MockApiClient.addMockResponse({
      url: getFilterEndpoint(filter),
      method: 'PUT',
    });

  function renderComponent() {
    return render(
      <ProjectFilters
        params={{projectId: project.slug}}
        location={{}}
        project={project}
        organization={org}
      />
    );
  }

  beforeEach(function () {
    MockApiClient.clearMockResponses();
    MockApiClient.addMockResponse({
      url: PROJECT_URL,
      body: project,
    });

    MockApiClient.addMockResponse({
      url: `${PROJECT_URL}stats/`,
      body: [],
    });

    MockApiClient.addMockResponse({
      url: `${PROJECT_URL}filters/`,
      body: TestStubs.ProjectFilters(),
    });

    MockApiClient.addMockResponse({
      url: `${PROJECT_URL}tombstones/`,
      body: TestStubs.Tombstones(),
    });
  });

  it('has browser extensions enabled initially', async function () {
    renderComponent();

    const filter = 'browser-extensions';
    const mock = createFilterMock(filter);

    const control = screen.getByRole('checkbox', {
      name: 'Filter out errors known to be caused by browser extensions',
    });

    expect(control).toBeChecked();
    await userEvent.click(control);

    expect(mock).toHaveBeenCalledWith(
      getFilterEndpoint(filter),
      expect.objectContaining({
        method: 'PUT',
        data: {
          active: false,
        },
      })
    );
  });

  it('can toggle filters: localhost, web crawlers', async function () {
    renderComponent();

    const FILTERS = {
      localhost: 'Filter out events coming from localhost',
      'web-crawlers': 'Filter out known web crawlers',
    };

    for (const filter of Object.keys(FILTERS)) {
      const mock = createFilterMock(filter);

      await userEvent.click(screen.getByRole('checkbox', {name: FILTERS[filter]}));
      expect(mock).toHaveBeenCalledWith(
        getFilterEndpoint(filter),
        expect.objectContaining({
          method: 'PUT',
          data: {
            active: true,
          },
        })
      );
    }
  });

  it('has correct legacy browsers selected', function () {
    renderComponent();

    expect(
      screen.getByRole('checkbox', {name: 'Internet Explorer Version 8 and lower'})
    ).toBeChecked();

    expect(
      screen.getByRole('checkbox', {name: 'Internet Explorer Version 9'})
    ).toBeChecked();

    expect(
      screen.getByRole('checkbox', {name: 'Internet Explorer Version 10'})
    ).not.toBeChecked();
  });

  it('can toggle legacy browser', async function () {
    renderComponent();

    const filter = 'legacy-browsers';
    const mock = createFilterMock(filter);

    await userEvent.click(
      screen.getByRole('checkbox', {name: 'Safari Version 5 and lower'})
    );
    expect(mock.mock.calls[0][0]).toBe(getFilterEndpoint(filter));
    // Have to do this because no jest matcher for JS Set
    expect(Array.from(mock.mock.calls[0][1].data.subfilters)).toEqual([
      'ie_pre_9',
      'ie9',
      'safari_pre_6',
    ]);

    // Toggle filter off
    await userEvent.click(
      screen.getByRole('checkbox', {name: 'Internet Explorer Version 11'})
    );
    expect(Array.from(mock.mock.calls[1][1].data.subfilters)).toEqual([
      'ie_pre_9',
      'ie9',
      'safari_pre_6',
      'ie11',
    ]);

    mock.mockReset();

    // Click ie9 and < ie9
    await userEvent.click(
      screen.getByRole('checkbox', {name: 'Internet Explorer Version 9'})
    );
    await userEvent.click(
      screen.getByRole('checkbox', {name: 'Internet Explorer Version 8 and lower'})
    );

    expect(Array.from(mock.mock.calls[1][1].data.subfilters)).toEqual([
      'safari_pre_6',
      'ie11',
    ]);
  });

  it('can toggle all/none for legacy browser', async function () {
    renderComponent();

    const filter = 'legacy-browsers';
    const mock = createFilterMock(filter);

    await userEvent.click(screen.getByRole('button', {name: 'All'}));
    expect(mock.mock.calls[0][0]).toBe(getFilterEndpoint(filter));
    expect(Array.from(mock.mock.calls[0][1].data.subfilters)).toEqual([
      'ie_pre_9',
      'ie9',
      'ie10',
      'ie11',
      'safari_pre_6',
      'opera_pre_15',
      'opera_mini_pre_8',
      'android_pre_4',
    ]);

    await userEvent.click(screen.getByRole('button', {name: 'None'}));
    expect(Array.from(mock.mock.calls[1][1].data.subfilters)).toEqual([]);
  });

  it('can set ip address filter', async function () {
    renderComponent();

    const mock = MockApiClient.addMockResponse({
      url: PROJECT_URL,
      method: 'PUT',
    });

    await userEvent.type(
      screen.getByRole('textbox', {name: 'IP Addresses'}),
      'test\ntest2'
    );
    await userEvent.tab();

    expect(mock.mock.calls[0][0]).toBe(PROJECT_URL);
    expect(mock.mock.calls[0][1].data.options['filters:blacklisted_ips']).toBe(
      'test\ntest2'
    );
  });

  it('filter by release/error message are not enabled', function () {
    renderComponent();

    expect(screen.getByRole('textbox', {name: 'Releases'})).toBeDisabled();
    expect(screen.getByRole('textbox', {name: 'Error Message'})).toBeDisabled();
  });

  it('has custom inbound filters with flag + can change', async function () {
    render(
      <ProjectFilters
        organization={org}
        params={{projectId: project.slug, orgId: org.slug}}
        location={{}}
        project={{
          ...project,
          features: ['custom-inbound-filters'],
        }}
      />
    );

    expect(screen.getByRole('textbox', {name: 'Releases'})).toBeEnabled();
    expect(screen.getByRole('textbox', {name: 'Error Message'})).toBeEnabled();

    const mock = MockApiClient.addMockResponse({
      url: PROJECT_URL,
      method: 'PUT',
    });

    await userEvent.type(
      screen.getByRole('textbox', {name: 'Releases'}),
      'release\nrelease2'
    );
    await userEvent.tab();

    expect(mock.mock.calls[0][0]).toBe(PROJECT_URL);
    expect(mock.mock.calls[0][1].data.options['filters:releases']).toBe(
      'release\nrelease2'
    );

    await userEvent.type(
      screen.getByRole('textbox', {name: 'Error Message'}),
      'error\nerror2'
    );
    await userEvent.tab();

    expect(mock.mock.calls[1][1].data.options['filters:error_messages']).toBe(
      'error\nerror2'
    );
  });

  it('disables configuration for non project:write users', function () {
    render(
      <ProjectFilters
        organization={org}
        location={{}}
        params={{projectId: project.slug, orgId: org.slug}}
        project={project}
      />,
      {organization: TestStubs.Organization({access: []})}
    );

    screen.getAllByRole('checkbox').forEach(checkbox => {
      expect(checkbox).toBeDisabled();
    });
  });

  it('shows disclaimer if error message filter is populated', function () {
    render(
      <ProjectFilters
        organization={org}
        params={{projectId: project.slug, orgId: org.slug}}
        project={{
          ...project,
          features: ['custom-inbound-filters'],
          options: {
            'filters:error_messages': 'test',
          },
        }}
      />
    );

    expect(
      screen.getByText(
        "Minidumps, errors in the minified production build of React, and Internet Explorer's i18n errors cannot be filtered by message."
      )
    ).toBeInTheDocument(0);
  });

  it('disables undiscard tombstone for users without project:write', async () => {
    const discardProject = TestStubs.Project({
      ...project,
      features: ['discard-groups'],
    });
    const discardOrg = TestStubs.Organization({access: [], features: ['discard-groups']});

    render(
      <ProjectFilters
        organization={org}
        params={{
          projectId: discardProject.slug,
          orgId: discardOrg.slug,
          filterType: 'discarded-groups',
        }}
        location={{}}
        project={discardProject}
      />,
      {organization: discardOrg}
    );

    expect(await screen.findByRole('button', {name: 'Undiscard'})).toBeDisabled();
  });
});
