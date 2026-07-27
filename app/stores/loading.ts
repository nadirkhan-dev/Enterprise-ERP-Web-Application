interface LoadingState {
  globalLoading: boolean
  sectionLoaders: Record<string, boolean>
}

export const useLoadingStore = defineStore('loading', {
  state: (): LoadingState => ({
    globalLoading: false,
    sectionLoaders: {},
  }),
  actions: {
    startGlobal() {
      this.globalLoading = true
    },
    stopGlobal() {
      this.globalLoading = false
    },
    startSection(key: string) {
      this.sectionLoaders[key] = true
    },
    stopSection(key: string) {
      delete this.sectionLoaders[key]
    },
  },
  getters: {
    isSectionLoading: (state): ((key: string) => boolean) => (key: string) => !!state.sectionLoaders[key],
  },
})
