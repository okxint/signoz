import { QueryClient, QueryClientProvider } from 'react-query';
// eslint-disable-next-line no-restricted-imports
import { Provider } from 'react-redux';
import { MemoryRouter } from 'react-router-dom-v5-compat';
import K8sVolumesList from 'container/InfraMonitoringK8s/Volumes/K8sVolumesList';
import { server } from 'mocks-server/server';
import { rest } from 'msw';
import { AppContext } from 'providers/App/App';
import { QueryBuilderProvider } from 'providers/QueryBuilder';
// eslint-disable-next-line no-restricted-imports
import { applyMiddleware, legacy_createStore as createStore } from 'redux';
import thunk from 'redux-thunk';
import reducers from 'store/reducers';
import { act, fireEvent, render, screen, waitFor } from 'tests/test-utils';
import { getAppContextMock } from 'tests/test-utils';
import { UPDATE_TIME_INTERVAL } from 'types/actions/globalTime';

import { INFRA_MONITORING_K8S_PARAMS_KEYS } from '../../constants';

// jsdom does not implement IntersectionObserver — provide a no-op stub
const mockObserver = {
	observe: jest.fn(),
	unobserve: jest.fn(),
	disconnect: jest.fn(),
};
global.IntersectionObserver = jest
	.fn()
	.mockImplementation(() => mockObserver) as any;

const mockVolume = {
	persistentVolumeClaimName: 'test-pvc',
	volumeAvailable: 1000000,
	volumeCapacity: 5000000,
	volumeInodes: 100,
	volumeInodesFree: 50,
	volumeInodesUsed: 50,
	volumeUsage: 4000000,
	meta: {
		k8s_cluster_name: 'test-cluster',
		k8s_namespace_name: 'test-namespace',
		k8s_node_name: 'test-node',
		k8s_persistentvolumeclaim_name: 'test-pvc',
		k8s_pod_name: 'test-pod',
		k8s_pod_uid: 'test-pod-uid',
		k8s_statefulset_name: '',
	},
};

const mockVolumesResponse = {
	status: 'success',
	data: {
		type: '',
		records: [mockVolume],
		groups: null,
		total: 1,
		sentAnyHostMetricsData: false,
		isSendingK8SAgentMetrics: false,
	},
};

/** Renders K8sVolumesList with a real Redux store so dispatched actions affect state. */
function renderWithRealStore(
	initialEntries?: string[],
): { testStore: ReturnType<typeof createStore> } {
	const testStore = createStore(reducers, applyMiddleware(thunk as any));
	const queryClient = new QueryClient({
		defaultOptions: { queries: { retry: false } },
	});

	render(
		<QueryClientProvider client={queryClient}>
			<Provider store={testStore}>
				<AppContext.Provider value={getAppContextMock('ADMIN')}>
					<QueryBuilderProvider>
						<MemoryRouter initialEntries={initialEntries}>
							<K8sVolumesList
								isFiltersVisible={false}
								handleFilterVisibilityChange={jest.fn()}
								quickFiltersLastUpdated={-1}
							/>
						</MemoryRouter>
					</QueryBuilderProvider>
				</AppContext.Provider>
			</Provider>
		</QueryClientProvider>,
	);

	return { testStore };
}

describe('K8sVolumesList', () => {
	beforeEach(() => {
		server.use(
			rest.post('http://localhost/api/v1/pvcs/list', (_req, res, ctx) =>
				res(ctx.status(200), ctx.json(mockVolumesResponse)),
			),
			rest.get(
				'http://localhost/api/v3/autocomplete/attribute_keys',
				(_req, res, ctx) =>
					res(ctx.status(200), ctx.json({ data: { attributeKeys: [] } })),
			),
		);
	});

	it('renders volume rows from API response', async () => {
		render(
			<MemoryRouter>
				<K8sVolumesList
					isFiltersVisible={false}
					handleFilterVisibilityChange={jest.fn()}
					quickFiltersLastUpdated={-1}
				/>
			</MemoryRouter>,
		);

		await waitFor(() => {
			expect(screen.getAllByText('test-pvc').length).toBeGreaterThan(0);
		});
	});

	it('opens VolumeDetails when a volume row is clicked', async () => {
		render(
			<MemoryRouter>
				<K8sVolumesList
					isFiltersVisible={false}
					handleFilterVisibilityChange={jest.fn()}
					quickFiltersLastUpdated={-1}
				/>
			</MemoryRouter>,
		);

		await waitFor(() => {
			expect(screen.getAllByText('test-pvc').length).toBeGreaterThan(0);
		});

		const row = screen.getAllByText('test-pvc')[0].closest('tr');
		expect(row).not.toBeNull();
		fireEvent.click(row!);

		await waitFor(() => {
			expect(screen.getAllByText('test-pvc').length).toBeGreaterThan(1);
		});
	});

	it('closes VolumeDetails when the close button is clicked', async () => {
		render(
			<MemoryRouter>
				<K8sVolumesList
					isFiltersVisible={false}
					handleFilterVisibilityChange={jest.fn()}
					quickFiltersLastUpdated={-1}
				/>
			</MemoryRouter>,
		);

		await waitFor(() => {
			expect(screen.getAllByText('test-pvc').length).toBeGreaterThan(0);
		});

		const row = screen.getAllByText('test-pvc')[0].closest('tr');
		fireEvent.click(row!);

		await waitFor(() => {
			expect(screen.getByRole('button', { name: 'Close' })).toBeInTheDocument();
		});

		fireEvent.click(screen.getByRole('button', { name: 'Close' }));

		await waitFor(() => {
			expect(
				screen.queryByRole('button', { name: 'Close' }),
			).not.toBeInTheDocument();
		});
	});

	it('does not re-fetch the volumes list when time range changes after selecting a volume', async () => {
		let apiCallCount = 0;
		server.use(
			rest.post('http://localhost/api/v1/pvcs/list', (_req, res, ctx) => {
				apiCallCount += 1;
				return res(ctx.status(200), ctx.json(mockVolumesResponse));
			}),
		);

		const { testStore } = renderWithRealStore();

		await waitFor(() => expect(apiCallCount).toBe(1));

		const row = screen.getAllByText('test-pvc')[0].closest('tr');
		fireEvent.click(row!);
		await waitFor(() =>
			expect(screen.getAllByText('test-pvc').length).toBeGreaterThan(1),
		);

		const countAfterClick = apiCallCount;

		// There's a specific component causing the min/max time to be updated
		// After the volume loads, it triggers the change again
		// And then the query to fetch data for the selected volume enters in a loop
		act(() => {
			testStore.dispatch({
				type: UPDATE_TIME_INTERVAL,
				payload: {
					minTime: Date.now() * 1000000 - 30 * 60 * 1000 * 1000000,
					maxTime: Date.now() * 1000000,
					selectedTime: '30m',
				},
			} as any);
		});

		// Allow any potential re-fetch to settle
		await new Promise((resolve) => {
			setTimeout(resolve, 500);
		});

		expect(apiCallCount).toBe(countAfterClick);
	});

	it('does not re-fetch groupedByRowData when time range changes after expanding a volume row with groupBy', async () => {
		const groupByParam = encodeURIComponent(
			JSON.stringify([{ key: 'k8s_namespace_name' }]),
		);
		const initialEntries = [
			`/volumes?${INFRA_MONITORING_K8S_PARAMS_KEYS.GROUP_BY}=${groupByParam}`,
		];

		let groupedByRowDataCallCount = 0;
		server.use(
			rest.post('http://localhost/api/v1/pvcs/list', async (req, res, ctx) => {
				const body = await req.json();
				const isGroupedByRowDataRequest = body.filters?.items?.some(
					(item: { key?: { key?: string }; value?: string }) =>
						item.key?.key === 'k8s_namespace_name' && item.value === 'test-namespace',
				);
				if (isGroupedByRowDataRequest) {
					groupedByRowDataCallCount += 1;
				}
				return res(ctx.status(200), ctx.json(mockVolumesResponse));
			}),
			rest.get(
				'http://localhost/api/v3/autocomplete/attribute_keys',
				(_req, res, ctx) =>
					res(
						ctx.status(200),
						ctx.json({
							data: {
								attributeKeys: [{ key: 'k8s_namespace_name', dataType: 'string' }],
							},
						}),
					),
			),
		);

		const { testStore } = renderWithRealStore(initialEntries);

		await waitFor(() =>
			expect(screen.getAllByText('test-namespace').length).toBeGreaterThan(0),
		);

		const row = screen.getAllByText('test-namespace')[0].closest('tr');
		expect(row).not.toBeNull();
		fireEvent.click(row as HTMLElement);
		await waitFor(() => expect(groupedByRowDataCallCount).toBe(1));

		const countAfterExpand = groupedByRowDataCallCount;

		act(() => {
			testStore.dispatch({
				type: UPDATE_TIME_INTERVAL,
				payload: {
					minTime: Date.now() * 1000000 - 30 * 60 * 1000 * 1000000,
					maxTime: Date.now() * 1000000,
					selectedTime: '30m',
				},
			} as any);
		});

		// Allow any potential re-fetch to settle
		await new Promise((resolve) => {
			setTimeout(resolve, 500);
		});

		expect(groupedByRowDataCallCount).toBe(countAfterExpand);
	});
});
