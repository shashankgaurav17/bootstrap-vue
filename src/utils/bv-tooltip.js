// Tooltip "Class" (Built as a renderless Vue instance)
//
// Handles trigger events, etc.
// Instantiates template on demand

import Vue from './vue'
import { arrayIncludes, concat, from as arrayFrom } from './array'
import { isNumber, isPlainObject, isString } from './inspect'
import {
  isElement,
  isDisabled,
  isVisible,
  closest,
  select,
  getById,
  hasClass,
  getAttr,
  setAttr,
  removeAttr,
  eventOn,
  eventOff
} from './dom'
import { HTMLElement } from './safe-types'

import { BvEvent } from './bv-event.class'
import { BVTooltipTemplate } from './bv-tooltip-template'

const NAME = 'BVTtooltip'

// Modal container selector for appending tooltip/popover
const MODAL_SELECTOR = '.modal-content'
// Modal `$root` hidden event
const MODAL_CLOSE_EVENT = 'bv::modal::hidden'

// For dropdown sniffing
const DROPDOWN_CLASS = 'dropdown'
const DROPDOWN_OPEN_SELECTOR = '.dropdown-menu.show'

// Options for Native Event Listeners (since we never call preventDefault)
const EvtOpts = { passive: true, capture: false }

export const props = {
  triggers: {
    // Overwritten by BVPopover
    type: [String, Array],
    default: 'click hover'
  },
  placement: {
    // Overwritten by BVPopover
    type: String,
    default: 'top'
  },
  title: {
    // Text string, Array<vNode>, vNode
    type: [String, Array, Object],
    default: ''
  },
  content: {
    // Text string, Array<vNode>, vNode
    // Alias/Alternate for title for tolltip
    type: [String, Array, Object],
    default: ''
  },
  variant: {
    type: String,
    default: null
  },
  customClass: {
    type: [String, Array, Object],
    default: null
  },
  target: {
    // Element or Component reference to the element that will have
    // the trigger events bound, and is default element for positioning
    type: [HTMLElement, Object],
    default: null
  },
  fallbackPlacement: {
    type: [String, Array],
    default: 'flip'
  },
  container: {
    // HTML ID, Element or Component reference
    type: [String, HTMLElement, Object],
    default: null // 'body'
  },
  noFade: {
    type: Boolean,
    default: false
  },
  boundary: {
    // 'scrollParent', 'viewport', 'window', Element, or Component reference
    type: [String, HTMLElement, Object],
    default: 'scrollParent'
  },
  boundaryPadding: {
    // Tooltip/popover will try and stay away from
    // boundary edge by this many pixels
    type: Number,
    default: 5
  },
  arrowPadding: {
    // Arrow of Tooltip/popover will try and stay away from
    // the edge of tooltip/popover edge by this many pixels
    type: Number,
    default: 6
  },
  offset: {
    type: Number,
    default: 0
  },
  delay: {
    type: [Number, String, Object],
    default: 0
  },
  disabled: {
    type: Boolean,
    default: false
  }
}

// @vue/component
export const BVTooltip = /*#__PURE__*/ Vue.extend({
  name: NAME,
  props,
  data() {
    return {
      localPlacementTarget: null,
      localContainer: null,
      localBoundary: 'scrollParent',
      activeTrigger: {
        hover: false,
        click: false,
        focus: false,
        manual: false
      },
      hoverState: '',
      localShow: false,
      enabled: !this.disabled
    }
  },
  computed: {
    templateType() {
      // Overwritten by BVPopover
      return 'tooltip'
    },
    templateProps() {
      // We create as an observed object, so that
      // the template will react to changes
      return {
        title: this.title,
        content: this.content,
        variant: this.variant,
        customClass: this.customClass,
        placement: this.placement,
        fallbackPlacement: this.fallbackPlacement,
        offset: this.offset,
        noFade: this.noFade,
        arrowPadding: this.arrowPadding,
        boundaryPadding: this.boundaryPadding,
        boundary: this.localBoundary,
        container: this.localContainer,
        target: this.localPlacementTarget
      }
    },
    templateAttrs() {
      return {
        id: this.computedId,
        tabindex: '-1'
      }
    },
    computedId() {
      return `__bv_${this.templateType}_${this._uid}__`
    },
    computedDelay() {
      // Normalizes delay into object form
      const delay = { show: 0, hide: 0 }
      if (isNumber(this.delay)) {
        delay.show = delay.hide = this.delay
      } else if (isString(this.delay)) {
        delay.show = delay.hide = Math.max(parseInt(this.delay, 10) || 0, 0)
      } else if (isPlainObject(this.delay)) {
        delay.show = isNumber(this.delay.show) ? this.delay.show : delay.show
        delay.hide = isNumber(this.delay.hide) ? this.delay.hide : delay.hide
      }
      return delay
    },
    computedTriggers() {
      // Returns the triggers in array form
      return concat(this.triggers)
        .filter(Boolean)
        .join(' ')
        .toLowerCase()
        .split(/\s+/)
    },
    isWithActiveTrigger() {
      for (const trigger in this.activeTrigger) {
        if (this.activeTrigger[trigger]) {
          return true
        }
      }
      return false
    }
  },
  watch: {
    computedtriggers(newVal, oldVal) {
      // Triggers have changed, so re-register them
      this.$netTick(() => {
        // TODO:
        //   Should we also clear any active triggers that
        //   are no longer in the list of triggers?
        this.unListen()
        this.listen()
      })
    },
    disabled(newVal, oldVal) {
      newVal ? this.disable() : this.enable()
    }
  },
  created() {
    // Create non-reactive properties
    this.$_tip = null
    this.$_hoverTimeout = null
    this.$_visibleInterval = null
    this.$_noop = () => {}

    // Set up all trigger handlers and listeners
    this.listen()

    // Destroy ourselves when the parent is destroyed
    if (this.$parent) {
      this.$parent.$once('hook:beforeDestroy', this.$destroy)
    }
  },
  deactivated() {
    // In a keepalive that has been deactivated, so hide
    // the tooltip/popover if it is showing
    this.forceHide()
  },
  beforDestroy() {
    // Remove all handler/listeners
    this.unListen()
    this.setWhileOpenListeners(false)

    // Clear any timeouts/Timers
    clearTimeout(this.$_hoverTimeout)
    this.$_hoverTimeout = null

    this.destroyTip()
  },
  methods: {
    //
    // Methods for creating and destroying the template
    //
    getTemplate() {
      // Overridden by BVPopover
      return BVTooltipTemplate
    },
    createTemplateAndShow() {
      // Creates the template instance and show it
      // this.destroyTemplate()
      this.localPlacementTarget = this.getPlacementTarget()
      this.localContainer = this.getContainer()
      this.localBoundary = this.getBoundary()
      const Template = this.getTemplate()
      // eslint-disable-next-line new-cap
      this.$_tip = new Template({
        parent: this,
        // We use "observed" objects so that the template updates reactivly
        propsData: this.templateProps,
        attrs: this.templateAttrs,
        on: {
          // When the template has mounted, but not visibly shown yet
          show: this.onTemplateShow,
          // When the template has completed showing
          shown: this.onTemplateShown,
          // When the template has started to hide
          hide: this.onTemplateHide,
          // When the template has completed hiding
          hidden: this.onTemplateHidden,
          // This will occur when the template fails to mount
          selfdestruct: this.destroyTemplate,
          // Convenience events from template
          // To save us from manually adding/removing DOM
          // listeners to tip element when it is open
          focusin: this.handleEvent,
          focusout: this.handleEvent,
          mouseenter: this.handleEvent,
          mouseleave: this.handleEvent
        }
      })
    },
    hideTemplate() {
      // Trigger the template to start hiding
      // The template will emit the `hide` event after this and
      // then emit the `hidden` event once it is fully hidden
      this.$_tip && this.$_tip.hide()
    },
    destroyTemplate() {
      // Destroy the template instance and reset state
      // TODO:
      //   check if tip is being destroyed or is already destroyed
      //   so that the $destroy() method doesn't choke if already destroyed
      //   Could wrap in a try {} catch {}
      // Reset state values
      this.setWhileOpenListeners(false)
      clearTimeout(this.$_hoverTimeout)
      this.$_hoverTimout = null
      this.localPlacementTarget = null
      this.localContainer = null
      this.localBoundary = 'scrollParent'
      this.clearActiveTriggers()
      this.hoverState = ''
      this.localShow = false
      try {
        this.$_tip && this.$_tip.$destroy()
      } catch {}
      this.$_tip = null
    },
    getTemplateElement() {
      return this.$_tip ? this.$_tip.$el : null
    },
    //
    // Show and Hide handlers
    //
    show() {
      // Show the tooltip
      const target = this.getTarget()

      // TODO:
      //   Test for existence of $_tip and exit if exists
      if (!target || !document.body.contains(target) || !isVisible(target) || this.dropdownOpen()) {
        // If trigger element isn't in the DOM or is not visible, or is on an open dropdown toggle
        return
      }

      // Create a cancelable BvEvent
      const showEvt = this.buildEvent('show', { cancelable: true })
      this.emitEvent(showEvt)
      if (showEvt.defaultPrevented) {
        // Don't show if event cancelled
        this.destroyTip()
        return
      }

      // Fix the title attribute on target
      this.fixTitle()

      // Set aria-describedby on target
      this.addAriaDescribedby()

      // Flag we are showing
      this.localShow = true
      // Create and how the tooltip
      this.createTemplateAndShow()
    },
    hide(force = false) {
      // Hide the tooltip
      const tip = this.getTemplateElement()
      if (!tip || !this.localShow) {
        /* istanbul ignore next */
        return
      }

      // Emit cancelable BvEvent 'hide'
      // We disable cancelling if `force` is true
      const hideEvt = this.buildEvent('hide', { cancelable: !force })
      this.emitEvent(hideEvt)
      if (hideEvt.defaultPrevented) {
        // Don't hide if event cancelled
        return
      }

      // Tell the template to hide
      this.hideTemplate()
      // TODO:
      //   The following could be added to hideTemplate()
      // Clear out any active triggers
      this.clearActiveTriggers()
      // Reset the hoverstate
      this.hoverState = ''
    },
    forceHide() {
      // Forcefully hides/destroys the template, regardless of any active triggers
      const tip = this.getTemplateElement()
      if (!tip || !this.localShow) {
        /* istanbul ignore next */
        return
      }
      // Disable while open listeners/watchers
      // This is also done in the template `hide` evt handler
      this.setWhileOpenListeners(false)
      // Clear any hover enter/leave event
      clearTimeout(this.hoverTimeout)
      this.hoverTimeout = null
      this.hoverState = ''
      this.clearActiveTriggers()
      // Hide the tip
      this.hide(true)
    },
    enable() {
      this.enabled = true
      // Create a non-cancelable BvEvent
      this.emitEvent(this.buildEvent('enabled', {}))
    },
    disable() {
      this.enabled = false
      // Create a non-cancelable BvEvent
      this.emitEvent(this.buildEvent('disabled', {}))
    },
    //
    // Handlers for template events
    //
    onTemplateShow() {
      // When template is inserted into DOM, but not yet shown
      // Enable while open listeners/watchers
      this.setWhileOpenListeners(true)
    },
    onTemplateShown() {
      // When template show transition completes
      const prevHoverState = this.hoverState
      this.hoverState = ''
      if (prevHoverState === 'out') {
        this.leave(null)
      }
      // Emit a non-cancelable BvEvent 'shown'
      this.emitEvent(this.buildEvent('shown', {}))
    },
    onTemplateHide() {
      // When template is starting to hide
      // Disable while open listeners/watchers
      this.setWhileOpenListeners(false)
    },
    onTemplateHidden() {
      // When template has completed closing (just before it self destructs)
      // TODO:
      //   The next two lines could be moved into `destroyTemplate()`
      this.removeAriaDescribedby()
      this.restoreTitle()
      this.destroyTemplate()
      // Emit a non-cancelable BvEvent 'shown'
      this.emitEvent(this.buildEvent('hidden', {}))
    },
    onTemplateDestruct() {
      // Called when the template is being destroyed due to force or failure
      // Although, should we emit hide/hidden events?
      this.destroyTemplate()
    },
    //
    // Utility methods
    //
    getTarget() {
      // Handle case where target may be a component ref
      let target = this.target ? this.target.$el || this.target : null
      // If an ID
      target = isString(target) ? getById(target.replace(/^#/, '')) : null
      // If an element ref
      return isElement(target) ? target : null
    },
    getPlacementTarget() {
      // This is the target that the tooltip will be placed on, which may not
      // necessarily be the same element that has the trigger event listeners
      // For now, this is the same as target
      // TODO:
      //   Add in child selector support
      //   Add in visibility checks for this element
      //   Fallback to target if not found
      return this.getTarget()
    },
    getTargetId() {
      // Returns the ID of the trigger element
      const target = this.getTarget()
      return target && target.id ? target.id : null
    },
    getContainer() {
      // Handle case where container may be a component ref
      const container = this.container ? this.container.$el || this.container : false
      const body = document.body
      const target = this.getTarget()
      // If we are in a modal, we append to the modal instead
      // of body, unless a container is specified
      // TODO:
      //   Template should periodically check to see if it is in dom
      //   And if not, self destruct (if container got v-if'ed out of DOM)
      //   Or this could possbily be part of the visibility check
      return container === false
        ? closest(MODAL_SELECTOR, target) || body
        : isString(container)
          ? getById(container.replace(/^#/, '')) || body
          : body
    },
    getBoundary() {
      return this.boundary ? this.boundary.$el || this.boundary : 'scrollParent'
    },
    isInModal() {
      const target = this.getTarget()
      return target && closest(MODAL_SELECTOR, target)
    },
    isDropdown() {
      // Returns true if trigger is a dropdown
      const target = this.getTarget()
      return target && hasClass(target, DROPDOWN_CLASS)
    },
    dropdownOpen() {
      // Returns true if trigger is a dropdown and the dropdown menu is open
      const target = this.getTarget()
      return this.isDropdown() && target && select(DROPDOWN_OPEN_SELECTOR, target)
    },
    clearActiveTriggers() {
      for (const trigger in this.activeTrigger) {
        this.activeTrigger[trigger] = false
      }
    },
    addAriaDescribedby() {
      // Add aria-describedby on trigger element, without removing any other IDs
      const target = this.getTarget()
      let desc = getAttr(target, 'aria-describedby') || ''
      desc = desc
        .split(/\s+/)
        .concat(this.computedId)
        .join(' ')
        .trim()
      // Update/add aria-described by
      setAttr(target, 'aria-describedby', desc)
    },
    removeAriaDescribedby() {
      // Remove aria-describedby on trigger element, without removing any other IDs
      const target = this.getTarget()
      let desc = getAttr(target, 'aria-describedby') || ''
      desc = desc
        .split(/\s+/)
        .filter(d => d !== this.computedId)
        .join(' ')
        .trim()
      // Update or remove aria-describedby
      if (desc) {
        /* istanbul ignore next */
        setAttr(target, 'aria-describedby', desc)
      } else {
        removeAttr(target, 'aria-describedby')
      }
    },
    fixTitle() {
      // If the target has a title attribute, null it out and
      // store on data-title
    },
    restoreTitle() {
      // If target had a title, restore the title attribute
      // and remove the data-title attribute
    },
    //
    // BvEvent helpers
    //
    buildEvent(type, opts = {}) {
      // Defaults to a non-cancellable event
      return new BvEvent(type, {
        cancelable: false,
        target: this.getTarget(),
        relatedTarget: this.getTemplateElement(),
        componentId: this.computedId,
        vueTarget: this,
        // Add in option overrides
        ...opts
      })
    },
    emitEvent(bvEvt) {
      // Emits a BvEvent on $root and this instance
      const evtName = bvEvt.type
      const $root = this.$root
      if ($root && $root.$emit) {
        // Emit an event on $root
        $root.$emit(`bv::${this.templateType}::${evtName}`, bvEvt)
      }
      this.$emit(evtName, bvEvt)
    },
    //
    // Event handler setup methods
    //
    listen() {
      // Enable trigger event handlers
      const el = this.getTarget()
      if (!el) {
        return
      }

      // Listen for global show/hide events
      this.setRootListener(true)

      // Set up our listeners on the target trigger element
      this.computedTriggers.forEach(trigger => {
        if (trigger === 'click') {
          eventOn(el, 'click', this.handleEvent, EvtOpts)
        } else if (trigger === 'focus') {
          eventOn(el, 'focusin', this.handleEvent, EvtOpts)
          eventOn(el, 'focusout', this.handleEvent, EvtOpts)
        } else if (trigger === 'blur') {
          // Used to close $tip when element looses focus
          eventOn(el, 'focusout', this.handleEvent, EvtOpts)
        } else if (trigger === 'hover') {
          eventOn(el, 'mouseenter', this.handleEvent, EvtOpts)
          eventOn(el, 'mouseleave', this.handleEvent, EvtOpts)
        }
      }, this)
    },
    unListen() {
      // Remove trigger event handlers
      const events = ['click', 'focusin', 'focusout', 'mouseenter', 'mouseleave']
      const target = this.getTarget()

      events.forEach(evt => {
        target && eventOff(target, evt, this.handleEvent, EvtOpts)
      }, this)

      // Stop listening for global show/hide/enable/disable events
      this.setRootListener(false)
    },
    setRootListener(on) {
      // Listen for global `bv::{hide|show}::{tooltip|popover}` hide request event
      const $root = this.$root
      if ($root) {
        const method = on ? '$on' : '$off'
        const type = this.templateType
        $root[method](`bv::hide::${type}`, this.doHide)
        $root[method](`bv::show::${type}`, this.doShow)
        $root[method](`bv::disable::${type}`, this.doDisable)
        $root[method](`bv::enable::${type}`, this.doEnable)
      }
    },
    setWhileOpenListeners(on) {
      // Events that are only registered when the template is showing
      // Modal close events
      this.setModalListener(on)
      // Dropdown open events (if we are attached to a dropdown)
      this.setDropdownListener(on)
      // Periodic $element visibility check
      // For handling when tip is in <keepalive>, tabs, carousel, etc
      this.visibleCheck(on)
      // On-touch start listeners
      this.setOnTouchStartListener(on)
    },
    visibleCheck(on) {
      // Handler for periodic visibility check
      // TODO:
      //   Could make this a MutationObserver or IntersectionObserver
      clearInterval(this.$_visibleInterval)
      this.$_visibleInterval = null
      if (on) {
        this.visibleInterval = setInterval(() => {
          const tip = this.getTemplateElement()
          // TODO:
          //   Change the hasClass check to check localShow status instead
          if (tip && !isVisible(this.getTarget()) && this.localShow) {
            // Element is no longer visible, so force-hide the tooltip
            this.forceHide()
          }
        }, 100)
      }
    },
    setModalListener(on) {
      // Handle case where tooltip/target is in a modal
      if (this.isInModal()) {
        // We can listen for modal hidden events on `$root`
        this.$root[on ? '$on' : '$off'](MODAL_CLOSE_EVENT, this.forceHide)
      }
    },
    setOnTouchStartListener(on) {
      // If this is a touch-enabled device we add extra empty
      // `mouseover` listeners to the body's immediate children
      // Only needed because of broken event delegation on iOS
      // https://www.quirksmode.org/blog/archives/2014/02/mouse_event_bub.html
      if ('ontouchstart' in document.documentElement) {
        /* istanbul ignore next: JSDOM does not support `ontouchstart` event */
        const method = on ? eventOn : eventOff
        arrayFrom(document.body.children).forEach(el => {
          method(el, 'mouseover', this.$_noop)
        })
      }
    },
    setDropdownListener(on) {
      const target = this.getTarget()
      if (!target || !this.$root || !this.isDropdown) {
        return
      }
      // We can listen for dropdown shown events on it's instance
      // TODO:
      //   We could grab the ID from the dropdown, and listen for
      //   $root events for that particular dropdown id
      //   Although dropdown doesn't emit $root events
      //   Note: Dropdown auto-ID happens in a $nextTick after mount
      if (target.__vue__) {
        target.__vue__[on ? '$on' : '$off']('shown', this.forceHide)
      }
    },
    //
    // Event handlers
    //
    handleEvent(evt) {
      // General trigger event handler
      // Will handle any native event when the event handler is just `this`
      // target is the trigger element
      const target = this.getTarget()
      if (!target || isDisabled(target) || !this.enabled || this.dropdownOpen()) {
        // If disabled or not enabled, or if a dropdown that is open, don't do anything
        // If tip is shown before element gets disabled, then tip will not
        // close until no longer disabled or forcefully closed
        return
      }
      const type = evt.type
      const triggers = this.computedTriggers

      if (type === 'click' && arrayIncludes(triggers, 'click')) {
        this.click(evt)
      } else if (type === 'mouseenter' && arrayIncludes(triggers, 'hover')) {
        // `mouseenter` is a non-bubbling event
        this.enter(evt)
      } else if (type === 'mouseleave' && arrayIncludes(triggers, 'hover')) {
        // `mouseleave` is a non-bubbling event
        this.leave(evt)
      } else if (type === 'focusin' && arrayIncludes(triggers, 'focus')) {
        // `focusin` is a bubbling event
        this.enter(evt)
      } else if (
        type === 'focusout' &&
        (arrayIncludes(triggers, 'focus') || arrayIncludes(triggers, 'blur'))
      ) {
        // `focusout` is a bubbling event
        // tip is the template (will be null if not open)
        const tip = this.getTemplateElement()
        // `evtTarget` is the element which is loosing focus and
        const evtTarget = evt.target
        // `relatedTarget` is the element gaining focus
        const relatedTarget = evt.relatedTarget
        /* istanbul ignore next */
        if (
          // From tip to target
          (tip && tip.contains(evtTarget) && target.contains(relatedTarget)) ||
          // From target to tip
          (tip && target.contains(evtTarget) && tip.contains(relatedTarget)) ||
          // Within tip
          (tip && tip.contains(evtTarget) && tip.contains(relatedTarget)) ||
          // Within target
          (target.contains(evtTarget) && target.contains(relatedTarget))
        ) {
          // If focus/hover moves within `tip` and `target`, don't trigger a leave
          // TODO:
          //   Maybe we should triger this.enter(evt) here ?
          // this.enter(evt)
          return
        }
        // Otherwise trigger a leave
        this.leave(evt)
      }
    },
    doHide(id) {
      // Programmatically hide tooltip or popover
      if (!id) {
        // Close all tooltips or popovers
        this.forceHide()
      } else if (this.getTargetId() === id || this.computedId === id) {
        // Close this specific tooltip or popover
        this.forceHide()
      }
    },
    doShow(id) {
      // Programmatically show tooltip or popover
      if (!id) {
        // Open all tooltips or popovers
        this.show()
      } else if (this.getTargetId() === id || this.computedId === id) {
        // Show this specific tooltip or popover
        this.show()
      }
    },
    doDisable(id) {
      // Programmatically disable tooltip or popover
      if (!id) {
        // Disable all tooltips or popovers
        this.disable()
      } else if (this.getTargetId() === id || this.computedId === id) {
        // Disable this specific tooltip or popover
        this.disable()
      }
    },
    doEnable(id) {
      // Programmatically enable tooltip or popover
      if (!id) {
        // Enable all tooltips or popovers
        this.enable()
      } else if (this.getTargetId() === id || this.computedId === id) {
        // Enable this specific tooltip or popover
        this.enable()
      }
    },
    click(evt) {
      if (!this.enabled || this.dropdownOpen()) {
        /* istanbul ignore next */
        return
      }
      this.activeTrigger.click = !this.activeTrigger.click
      if (this.isWithActiveTrigger) {
        this.enter(null)
      } else {
        this.leave(null)
      }
    },
    toggle() {
      // Manual toggle handler
      if (!this.enabled || this.dropdownOpen()) {
        /* istanbul ignore next */
        return
      }
      // Should we register as an active trigger?
      // this.activeTrigger.manual = !this.activeTrigger.manual
      if (this.localShow) {
        this.leave(null)
      } else {
        this.enter(null)
      }
    },
    enter(evt = null) {
      // Opening trigger handler
      // Note: Click events are sent with evt === null
      if (evt) {
        this.activeTrigger[evt.type === 'focusin' ? 'focus' : 'hover'] = true
      }
      if (this.localShow || this.hoverState === 'in') {
        this.hoverState = 'in'
        return
      }
      clearTimeout(this.hoverTimeout)
      this.hoverState = 'in'
      if (!this.computedDelay.show) {
        this.show()
      } else {
        this.hoverTimeout = setTimeout(() => {
          if (this.hoverState === 'in') {
            this.show()
          }
        }, this.computedDelay.show)
      }
    },
    leave(evt = null) {
      // Closing trigger handler
      // Note: Click events are sent with evt === null
      if (evt) {
        this.activeTrigger[evt.type === 'focusout' ? 'focus' : 'hover'] = false
        if (evt.type === 'focusout' && arrayIncludes(this.computedTriggers, 'blur')) {
          // Special case for `blur`: we clear out the other triggers
          this.activeTrigger.click = false
          this.activeTrigger.hover = false
        }
      }
      if (this.isWithActiveTrigger) {
        return
      }
      clearTimeout(this.hoverTimeout)
      this.hoverState = 'out'
      if (!this.computedDelay.hide) {
        this.hide()
      } else {
        this.$hoverTimeout = setTimeout(() => {
          if (this.hoverState === 'out') {
            this.hide()
          }
        }, this.computedDelay.hide)
      }
    }
  }
})