import { definePreset } from '@primeuix/themes'
import Aura from '@primeuix/themes/aura'
import { components } from './components.js'
import { extend } from './extend.js'
import { primitive } from './primitive.js'
import { semantic } from './semantic.js'

export default definePreset(Aura, {
  primitive,
  semantic,
  extend,
  components,
})
