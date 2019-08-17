import Vue from './vue'
import { BVTooltipTemplate } from './bv-tooltip-template'

const NAME = 'BVPopoverTemplate'

export const BVPopoverTemplate = Vue.extend({
  name: NAME,
  extends: BVTooltipTemplate,
  computed: {
    type() {
      return 'popover'
    }
  },
  methods: {
    renderTemplate(h) {
      return h(
        'div',
        {
          staticClass: 'popover b-popover',
          class: this.templateClasses,
          attrs: this.templateAttributes
        },
        [
          h('div', { staticClass: 'arrow' }),
          this.title ? h('h3', { staticClass: 'popover-header' }, this.title) : h(),
          this.content ? h('div', { staticClass: 'popover-body' }, this.content) : h()
        ]
      )
    }
  }
})