// @ts-nocheck
import { mount } from '@vue/test-utils'
import BaseFileDropzone from '../../app/components/BaseFileDropzone.vue'

/**
 * The per-row progress bar. A row animates whenever it is waiting on something
 * it cannot measure, and shows a real percentage only while its own bytes are
 * moving — so a row is never parked at a full bar with nothing apparently
 * happening.
 */
describe('Scenario: Showing an attachment row\'s progress', () => {
  function createAttachment(overrides = {}) {
    return {
      id: 'attachment-0',
      file: new File(['x'], 'screenshot.png', { type: 'image/png' }),
      name: 'screenshot.png',
      size: 1024,
      type: 'image/png',
      status: 'pending',
      progress: 0,
      isRejected: false,
      previewUrl: null,
      errorMessage: null,
      ...overrides,
    }
  }

  /** Mounted with PrimeVue's components stubbed — this is about props, not chrome. */
  function mountDropzone(attachment, props = {}) {
    return mount(BaseFileDropzone, {
      props: { attachments: [attachment], ...props },
      global: {
        stubs: {
          ProgressBar: { name: 'ProgressBar', props: ['mode', 'value', 'showValue'], template: '<div class="progressbar-stub" />' },
          Button: { name: 'Button', props: ['label', 'icon', 'disabled'], template: '<button />' },
          Tag: { name: 'Tag', template: '<span><slot /></span>' },
        },
        directives: { tooltip: {} },
      },
    })
  }

  function findProgressBar(wrapper) {
    return wrapper.findComponent({ name: 'ProgressBar' })
  }

  it('shows no bar on a queued row before the request is submitted', () => {
    const wrapper = mountDropzone(createAttachment({ status: 'pending' }))

    expect(findProgressBar(wrapper).exists()).toBe(false)
  })

  it('animates a queued row once Submit is running, since its wait cannot be measured', () => {
    const wrapper = mountDropzone(createAttachment({ status: 'pending' }), { disabled: true })

    expect(findProgressBar(wrapper).props('mode')).toBe('indeterminate')
  })

  it('shows the real percentage while the row\'s own bytes are going out', () => {
    const wrapper = mountDropzone(createAttachment({ status: 'uploading', progress: 42 }))

    const bar = findProgressBar(wrapper)
    expect(bar.props('mode')).toBe('determinate')
    expect(bar.props('value')).toBe(42)
    // A percentage label would not fit a 4px bar.
    expect(bar.props('showValue')).toBe(false)
  })

  it('switches back to animating at 100%, while the server finishes the transfer', () => {
    const wrapper = mountDropzone(createAttachment({ status: 'uploading', progress: 100 }))

    // Parked at a full bar is exactly what reads as stuck.
    expect(findProgressBar(wrapper).props('mode')).toBe('indeterminate')
  })

  it('leaves the bar full once the row is uploaded', () => {
    const wrapper = mountDropzone(createAttachment({ status: 'uploaded', progress: 100 }))

    const bar = findProgressBar(wrapper)
    expect(bar.props('mode')).toBe('determinate')
    expect(bar.props('value')).toBe(100)
  })

  it('drops the bar on a failed row, which shows its reason instead', () => {
    const wrapper = mountDropzone(
      createAttachment({ status: 'error', errorMessage: 'This file is empty' }),
      { disabled: true },
    )

    expect(findProgressBar(wrapper).exists()).toBe(false)
    expect(wrapper.text()).toContain('Error')
  })

  it('labels rows with the three statuses the design defines', () => {
    expect(mountDropzone(createAttachment({ status: 'pending' })).text()).toContain('Pending')
    expect(mountDropzone(createAttachment({ status: 'uploading' })).text()).toContain('Pending')
    expect(mountDropzone(createAttachment({ status: 'uploaded' })).text()).toContain('Uploaded')
    expect(mountDropzone(createAttachment({ status: 'error' })).text()).toContain('Error')
  })
})
