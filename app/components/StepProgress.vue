<script setup lang="ts">
interface Step {
  number: number
  label: string
}

interface Props {
  steps: Step[]
  currentStep: number
  hideChrome?: boolean
}

const props = withDefaults(defineProps<Props>(), {
  hideChrome: false,
})

const nextStep = computed(() => {
  return props.steps.find((s) => s.number === props.currentStep + 1) || null
})

const isLastStep = computed(() => {
  return props.currentStep === props.steps.length
})

const bottomStep = computed(() => {
  if (nextStep.value) return nextStep.value
  if (isLastStep.value) return props.steps.find((s) => s.number === props.currentStep) || null
  return null
})

</script>

<template>
  <div class="step-progress">
    <div v-if="!hideChrome" class="step-header">
      <template
        v-for="(step, index) in steps"
        :key="step.number"
      >
        <div
          class="step-header__item"
          :class="{
            'step-header__item--active': currentStep === step.number,
            'step-header__item--completed': currentStep > step.number,
            'step-header__item--future': currentStep < step.number,
            'step-header__item--mobile-hidden': currentStep < step.number,
          }"
        >
          <div class="step-header__circle">{{ step.number }}</div>
          <span class="step-header__label">{{ step.label }}</span>
        </div>
        <div
          v-if="index < steps.length - 1"
          class="step-header__connector"
          :class="{
            'step-header__connector--completed': currentStep > step.number,
            'step-header__connector--future': currentStep <= step.number,
            'step-header__connector--mobile-hidden': currentStep < step.number + 1,
          }"
        />
      </template>
    </div>

    <!-- Content wrapper with left connector line on mobile -->
    <div
      class="step-body"
      :class="{
        'step-body--has-line': !hideChrome,
      }"
    >
      <slot />
    </div>

    <div
      v-if="!hideChrome && bottomStep && !isLastStep"
      class="step-bottom-indicator"
    >
      <div
        class="step-bottom-indicator__circle"
        :class="{ 'step-bottom-indicator__circle--active': isLastStep }"
      >{{ bottomStep.number }}</div>
      <span
        class="step-bottom-indicator__label"
        :class="{ 'step-bottom-indicator__label--active': isLastStep }"
      >
        {{ bottomStep.label }}
      </span>
    </div>
  </div>
</template>

<style scoped>
.step-progress {
    display: flex;
    flex-direction: column;
    width: 100%;
}

/* Step Header — mobile-first (vertical) */
.step-header {
    display: flex;
    flex-direction: column;
    align-items: flex-start;
    padding: var(--p-spacing-3) 0 var(--p-spacing-3);
    width: 100%;
    gap: var(--p-spacing-2);

    @media (min-width: 768px) {
        flex-direction: row;
        align-items: center;
        gap: 0;
    }
}

.step-header__item {
    display: flex;
    align-items: center;
    gap: var(--p-spacing-2);
    flex-shrink: 0;
}

.step-header__connector {
    display: none;

    @media (min-width: 768px) {
        display: block;
        flex: 1;
        width: auto;
        height: 2px;
        background: var(--p-gray-200);
        border-radius: var(--p-spacing-px);
        margin: 0 var(--p-spacing-3);
        min-width: var(--p-spacing-6);
    }
}

.step-header__circle {
    width: var(--p-spacing-8);
    height: var(--p-spacing-8);
    border-radius: 50%;
    display: grid;
    place-items: center;
    line-height: 1;
    padding-top: var(--p-spacing-px);
    font-size: var(--p-font-size-sm);
    font-weight: var(--p-font-weight-medium);
    color: var(--p-gray-800);
    border: 2px solid var(--p-gray-300);
    background: var(--p-surface-0);
    box-shadow: var(--p-shadow-md);
    flex-shrink: 0;
    transition: all var(--p-transition-duration-normal) var(--p-transition-timing-ease-in-out);
}

.step-header__item--active .step-header__circle {
    color: var(--p-primary-500);
    background: var(--p-surface-0);
    border-color: var(--p-primary-500);
}

.step-header__item--completed .step-header__circle {
    color: var(--p-vividgreen-500);
    background: var(--p-surface-0);
    border-color: var(--p-vividgreen-500);
}

.step-header__label {
    font-size: var(--p-font-size-sm);
    font-weight: var(--p-font-weight-normal);
    color: var(--p-gray-800);
    white-space: nowrap;
}

.step-header__item--active .step-header__label {
    color: var(--p-primary-500);
}

.step-header__item--completed .step-header__label {
    color: var(--p-vividgreen-500);
}

.step-header__connector--completed {
    background: var(--p-vividgreen-500);

    @media (min-width: 768px) {
        background: var(--p-vividgreen-500);
    }
}

.step-header__item--future {
    display: none;

    @media (min-width: 768px) {
        display: flex;
    }
}

.step-header__connector--future {
    display: none;

    @media (min-width: 768px) {
        display: block;
    }
}

.step-header__item--mobile-hidden {
    display: none;

    @media (min-width: 768px) {
        display: flex;
    }
}

.step-header__connector--mobile-hidden {
    display: none;

    @media (min-width: 768px) {
        display: block;
    }
}

.step-header__connector--inactive-step {
    @media (min-width: 768px) {
        visibility: hidden;
    }
}

/* Step Body — left connector line on mobile */
.step-body {
    display: flex;
    flex-direction: column;
    gap: var(--p-spacing-4);
}

.step-body--has-line {
    margin-left: calc(var(--p-spacing-8) / 2 - 1px);
    padding-left: var(--p-spacing-4);
    border-left: 2px solid var(--app-color-rule);

    @media (min-width: 768px) {
        margin-left: 0;
        padding-left: 0;
        border-left: none;
    }
}

/* Bottom Step Indicator — mobile only */
.step-bottom-indicator {
    display: flex;
    align-items: center;
    gap: var(--p-spacing-2);
    margin-top: var(--p-spacing-2);

    @media (min-width: 768px) {
        display: none;
    }
}

.step-bottom-indicator__circle {
    width: var(--p-spacing-8);
    height: var(--p-spacing-8);
    border-radius: 50%;
    display: grid;
    place-items: center;
    line-height: 1;
    padding-top: var(--p-spacing-px);
    font-size: var(--p-font-size-sm);
    font-weight: var(--p-font-weight-normal);
    color: var(--p-gray-400);
    border: 2px solid var(--p-gray-300);
    background: var(--p-surface-0);
}

.step-bottom-indicator__circle--active {
    color: var(--p-primary-500);
    border-color: var(--p-primary-500);
}

.step-bottom-indicator__label {
    font-size: var(--p-font-size-sm);
    font-weight: var(--p-font-weight-normal);
    color: var(--p-gray-800);
}

.step-bottom-indicator__label--active {
    color: var(--p-primary-500);
}

</style>
