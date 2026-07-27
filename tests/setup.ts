// Mimic Nuxt's auto-imports for Vue reactivity primitives so composables
// written against the auto-import convention work in the vitest environment.
import {
  ref,
  computed,
  reactive,
  watch,
  unref,
  isRef,
  toRef,
  toRefs,
  readonly,
  shallowRef,
  shallowReactive,
  nextTick,
  onMounted,
  onBeforeUnmount,
  onUnmounted,
  onBeforeMount,
  onUpdated,
  onBeforeUpdate,
} from 'vue'

const globals = {
  ref, computed, reactive, watch, unref, isRef, toRef, toRefs, readonly,
  shallowRef, shallowReactive, nextTick,
  onMounted, onBeforeUnmount, onUnmounted, onBeforeMount, onUpdated, onBeforeUpdate,
}

for (const [key, value] of Object.entries(globals)) {
  // @ts-expect-error — injecting Nuxt-style auto-imports onto globalThis
  if (globalThis[key] === undefined) globalThis[key] = value
}
