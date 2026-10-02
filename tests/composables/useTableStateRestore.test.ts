// @ts-nocheck

const mocks = vi.hoisted(() => ({
  saveTableState: vi.fn(),
  getTableState: vi.fn(() => null),
  searchQuery: '',
}))

vi.mock('~/stores/search', () => ({
  useSearchStore: () => ({ searchQuery: mocks.searchQuery }),
}))

vi.mock('~/stores/tableState', () => ({
  useTableStateStore: () => ({
    saveTableState: mocks.saveTableState,
    getTableState: mocks.getTableState,
  }),
}))

import { useTableStateRestore } from '../../app/composables/useTableStateRestore'

describe('Scenario: Saving table rows with generated fields', () => {
  beforeEach(() => {
    mocks.saveTableState.mockReset()
    mocks.getTableState.mockReset().mockReturnValue(null)
    mocks.searchQuery = ''
  })

  it('omits configured transient fields without mutating the live rows', () => {
    const rows = ref([{
      id: 1,
      name: 'Example Manufacturer',
      logo_id: 'file-1',
      _logoSrc: '/directus/assets/file-1?access_token=expired',
      _logoSrcset: '/directus/assets/file-1?access_token=expired 1x',
    }])
    const tableRef = ref({ $el: { querySelector: () => null } })

    const { saveBeforeLeave } = useTableStateRestore('/manufacturers', {
      rows,
      currentPage: ref(1),
      hasMore: ref(true),
      totalRecords: ref(1),
      sortField: ref('name'),
      sortOrder: ref(1),
      isLoading: ref(false),
    }, tableRef, {
      transientRowFields: ['_logoSrc', '_logoSrcset'],
    })

    saveBeforeLeave()

    expect(mocks.saveTableState).toHaveBeenCalledWith('/manufacturers', expect.objectContaining({
      rows: [{ id: 1, name: 'Example Manufacturer', logo_id: 'file-1' }],
    }))
    expect(rows.value[0]._logoSrc).toContain('access_token=expired')
  })
})
