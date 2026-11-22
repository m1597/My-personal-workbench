import { Dropdown as FluentDropdown, type DropdownProps, Option } from '@fluentui/react-components'
import { forwardRef } from 'react'

// Music uses inline listboxes so popups inherit the current component's material and theme.
export const Dropdown = forwardRef<HTMLButtonElement, DropdownProps>(function Dropdown(props, ref) {
  return (
    <FluentDropdown
      {...props}
      ref={ref}
      inlinePopup
      listbox={{ className: 'component-popup workbench-options' }}
    />
  )
})
export { Option }

type Choice = { value: string; label: string }
export function ChoiceDropdown({
  value,
  choices,
  onChange,
  ...props
}: {
  value: string
  choices: Choice[]
  onChange(value: string): void
} & Pick<DropdownProps, 'id' | 'aria-label' | 'disabled'>) {
  return (
    <Dropdown
      {...props}
      value={choices.find((c) => c.value === value)?.label ?? ''}
      selectedOptions={[value]}
      onOptionSelect={(_, data) => {
        if (data.optionValue !== undefined) onChange(data.optionValue)
      }}
    >
      {choices.map((c) => (
        <Option key={c.value} value={c.value}>
          {c.label}
        </Option>
      ))}
    </Dropdown>
  )
}
